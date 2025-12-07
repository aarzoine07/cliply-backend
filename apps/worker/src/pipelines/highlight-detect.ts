import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUCKET_TRANSCRIPTS } from '@cliply/shared/constants';
import { HIGHLIGHT_DETECT } from '@cliply/shared/schemas/jobs';
import { assertWithinUsage, recordUsage, UsageLimitExceededError } from '@cliply/shared/billing/usageTracker';
import type { ClipStatus } from '@cliply/shared';
import { setPipelineStage } from '@cliply/shared/pipeline/stages';
import { PIPELINE_HIGHLIGHT_DETECT } from '@cliply/shared/pipeline/names';
import { PLAN_MATRIX } from '@cliply/shared/billing/planMatrix';
import { computeMaxClipsForVideo } from '@cliply/shared/engine/clipCount';
import { consolidateClipCandidates, type ClipCandidate as OverlapClipCandidate } from '@cliply/shared/engine/clipOverlap';
import type { PlanName } from '@cliply/shared/types/auth';

import type { Job, WorkerContext } from './types';

const PIPELINE = 'HIGHLIGHT_DETECT';

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

interface TranscriptJson {
  segments?: TranscriptSegment[];
  durationSec?: number;
}

// ClipCandidate represents potential highlights detected from transcript segments.
// These will be inserted into the clips table with status='proposed' (see docs/machine-mapping.md)
interface ClipCandidate {
  start: number;
  end: number;
  duration: number;
  confidence: number;
  score: number;
  title: string;
  text: string;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  try {
    const payload = HIGHLIGHT_DETECT.parse(job.payload);
    const workspaceId = job.workspaceId;

    // Fetch workspace plan to compute smart max clips
    const { data: workspace } = await ctx.supabase
      .from('workspaces')
      .select('plan')
      .eq('id', workspaceId)
      .maybeSingle();
    
    const planName: PlanName = 
      workspace?.plan === 'basic' || workspace?.plan === 'pro' || workspace?.plan === 'premium'
        ? workspace.plan
        : 'basic';
    
    const planLimits = PLAN_MATRIX[planName].limits;

    // Download and parse transcript JSON to get duration
    const transcriptKey = `${workspaceId}/${payload.projectId}/transcript.json`;

    const exists = await ctx.storage.exists(BUCKET_TRANSCRIPTS, transcriptKey);
    if (!exists) {
      throw new Error(`transcript missing: ${transcriptKey}`);
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-highlight-'));
    const localPath = join(tempDir, 'transcript.json');
    await ctx.storage.download(BUCKET_TRANSCRIPTS, transcriptKey, localPath);
    const raw = await fs.readFile(localPath, 'utf8');
    const parsed = JSON.parse(raw) as TranscriptJson;
    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];

    // Compute smart max clips based on duration and plan
    // Use transcript duration if available, otherwise fallback to 3 minutes (180 seconds)
    const durationSec = parsed.durationSec ?? 180;
    const durationMs = durationSec * 1000;

    const maxClips = computeMaxClipsForVideo({
      durationMs,
      planName,
      planLimits,
      requestedMaxClips: payload.maxClips,
    });

    ctx.logger.info('highlight_detect_max_clips_computed', {
      pipeline: PIPELINE_HIGHLIGHT_DETECT,
      jobKind: job.type,
      jobId: job.id,
      workspaceId,
      projectId: payload.projectId,
      durationSec,
      planName,
      requestedMaxClips: payload.maxClips,
      computedMaxClips: maxClips,
    });

    // Check usage limits before processing highlights
    // We check for at least maxClips remaining (conservative, actual count will be recorded after processing)
    try {
      await assertWithinUsage(workspaceId, 'clips', maxClips);
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        ctx.logger.warn('highlight_detect_usage_limit_exceeded', {
          pipeline: PIPELINE_HIGHLIGHT_DETECT,
          jobKind: job.type,
          jobId: job.id,
          workspaceId,
          projectId: payload.projectId,
          metric: error.metric,
          used: error.used,
          limit: error.limit,
          requestedClips: maxClips,
        });
        // Mark job as failed but don't crash - let the job system handle retries/backoff
        throw error;
      }
      throw error;
    }

    // Set pipeline_stage to 'analyzing' when starting highlight detection
    const { data: projectRows } = await ctx.supabase
      .from('projects')
      .select('id,pipeline_stage')
      .eq('id', payload.projectId);
    const project = projectRows?.[0];
    if (project) {
      setPipelineStage(PIPELINE_HIGHLIGHT_DETECT, 'analyzing');
      await ctx.supabase
        .from('projects')
        .update({ pipeline_stage: project.pipeline_stage })
        .eq('id', payload.projectId);
    }

    if (segments.length === 0) {
      ctx.logger.warn('highlight_no_segments', {
        pipeline: PIPELINE_HIGHLIGHT_DETECT,
        jobKind: job.type,
        jobId: String(job.id),
        projectId: payload.projectId,
        workspaceId,
      });
      return;
    }

    const groups = groupSegments(segments, payload.minGapSec);
    const candidates = groups
      .map((group) => buildCandidate(group, payload.keywords))
      .filter((candidate): candidate is ClipCandidate => candidate !== null);

    if (candidates.length === 0) {
      ctx.logger.info('highlight_no_candidates', {
        pipeline: PIPELINE_HIGHLIGHT_DETECT,
        jobKind: job.type,
        jobId: String(job.id),
        projectId: payload.projectId,
        workspaceId,
      });
      await ensureProjectStatus(ctx, payload.projectId, 'clips_proposed');
      return;
    }

    // Fetch existing clips to avoid creating duplicates
    const existing = await fetchExistingClips(ctx, payload.projectId);

    // Map candidates to overlap-detection format
    const candidatesForConsolidation: OverlapClipCandidate[] = candidates.map((c) => ({
      start_s: c.start,
      end_s: c.end,
      score: c.score,
    }));

    // Map existing clips to overlap-detection format
    const existingForConsolidation: OverlapClipCandidate[] = existing.map((clip) => ({
      id: clip.id,
      start_s: clip.start_s,
      end_s: clip.end_s,
      score: clip.score ?? 0,
    }));

    // Consolidate: remove overlaps, near-duplicates, and respect maxClips
    const consolidated = consolidateClipCandidates({
      candidates: candidatesForConsolidation,
      existingClips: existingForConsolidation,
      maxClips,
      // Use default nearDuplicateThresholdSec (1.5s)
    });

    // Log consolidation summary for observability
    ctx.logger.info('highlight_detect_consolidation', {
      pipeline: PIPELINE_HIGHLIGHT_DETECT,
      jobKind: job.type,
      jobId: job.id,
      workspaceId,
      projectId: payload.projectId,
      rawCandidates: candidates.length,
      existingClips: existing.length,
      maxClips,
      consolidatedClips: consolidated.length,
    });

    // Map consolidated clips back to original candidates to preserve metadata
    const consolidatedSet = new Set(
      consolidated.map((c) => `${c.start_s.toFixed(3)}:${c.end_s.toFixed(3)}`)
    );
    const topCandidates = candidates.filter((c) =>
      consolidatedSet.has(`${c.start.toFixed(3)}:${c.end.toFixed(3)}`)
    );

    // Prepare inserts for DB
    const inserts = topCandidates.map((candidate) => ({
      project_id: payload.projectId,
      workspace_id: workspaceId,
      start_s: Number(candidate.start.toFixed(3)),
      end_s: Number(candidate.end.toFixed(3)),
      title: candidate.title,
      confidence: Number(candidate.confidence.toFixed(3)),
      status: 'proposed' as ClipStatus,
    }));

    if (inserts.length > 0) {
      const { data: insertedClips, error: insertError } = await ctx.supabase
        .from('clips')
        .insert(inserts)
        .select('id');

      if (insertError) {
        throw new Error(`Failed to insert clips: ${insertError.message}`);
      }

      // Record clips usage (idempotent - only count newly inserted clips)
      await recordUsage({
        workspaceId,
        metric: 'clips',
        amount: inserts.length,
      });

      // Automatically enqueue CLIP_RENDER jobs for all newly created clips
      if (insertedClips && insertedClips.length > 0) {
        const renderJobs = insertedClips.map((clip) => ({
          workspace_id: workspaceId,
          kind: 'CLIP_RENDER',
          status: 'queued',
          payload: { clipId: clip.id },
        }));

        const { error: jobError } = await ctx.supabase.from('jobs').insert(renderJobs);
        if (jobError) {
          ctx.logger.warn('highlight_detect_render_enqueue_failed', {
            pipeline: PIPELINE_HIGHLIGHT_DETECT,
            jobKind: job.type,
            jobId: String(job.id),
            projectId: payload.projectId,
            workspaceId,
            error: jobError.message,
            clipCount: insertedClips.length,
          });
          // Don't fail the whole pipeline if render job enqueue fails - they can be manually triggered
        } else {
          ctx.logger.info('highlight_detect_render_enqueued', {
            pipeline: PIPELINE_HIGHLIGHT_DETECT,
            jobKind: job.type,
            jobId: String(job.id),
            projectId: payload.projectId,
            workspaceId,
            clipCount: insertedClips.length,
          });
        }
      }
    }

    await ensureProjectStatus(ctx, payload.projectId, 'clips_proposed');

    // Set pipeline_stage to 'clips_proposed' after creating clip proposals
    if (project) {
      setPipelineStage(PIPELINE_HIGHLIGHT_DETECT, 'clips_proposed');
      await ctx.supabase
        .from('projects')
        .update({ pipeline_stage: project.pipeline_stage })
        .eq('id', payload.projectId);
    }

    ctx.logger.info('pipeline_completed', {
      pipeline: PIPELINE_HIGHLIGHT_DETECT,
      jobKind: job.type,
      jobId: String(job.id),
      projectId: payload.projectId,
      workspaceId,
      candidates: candidates.length,
      inserted: inserts.length,
    });
  } catch (error) {
    // Set pipeline_stage to 'failed' on error
    try {
      const payload = HIGHLIGHT_DETECT.parse(job.payload);
      const { data: projectRows } = await ctx.supabase
        .from('projects')
        .select('id,pipeline_stage')
        .eq('id', payload.projectId);
      const failedProject = projectRows?.[0];
      if (failedProject) {
        setPipelineStage(PIPELINE_HIGHLIGHT_DETECT, 'failed');
        await ctx.supabase
          .from('projects')
          .update({ pipeline_stage: failedProject.pipeline_stage })
          .eq('id', payload.projectId);
      }
    } catch (stageUpdateError) {
      // Ignore stage update errors - don't prevent main error from being thrown
    }

    const payload = HIGHLIGHT_DETECT.parse(job.payload);
    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE_HIGHLIGHT_DETECT, jobKind: job.type },
      extra: { 
        jobId: String(job.id), 
        workspaceId: job.workspaceId,
        projectId: payload.projectId 
      },
    });
    ctx.logger.error('pipeline_failed', {
      pipeline: PIPELINE_HIGHLIGHT_DETECT,
      jobKind: job.type,
      jobId: job.id,
      workspaceId: job.workspaceId,
      projectId: payload.projectId,
      error: (error as Error)?.message ?? String(error),
    });
    throw error;
  }
}

export const pipeline = { run };

function groupSegments(segments: TranscriptSegment[], minGapSec: number): TranscriptSegment[][] {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const groups: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];

  for (const segment of sorted) {
    if (current.length === 0) {
      current.push(segment);
      continue;
    }

    const last = current[current.length - 1];
    const gap = Math.max(0, segment.start - last.end);
    if (gap > minGapSec) {
      groups.push(current);
      current = [segment];
    } else {
      current.push(segment);
    }
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function buildCandidate(segments: TranscriptSegment[], keywords: string[]): ClipCandidate | null {
  const start = segments[0]?.start ?? 0;
  const end = segments[segments.length - 1]?.end ?? start;
  let adjustedEnd = end;
  let duration = adjustedEnd - start;

  if (duration < 10) {
    return null;
  }

  if (duration > 60) {
    adjustedEnd = start + 60;
    duration = 60;
  }

  const text = segments.map((segment) => segment.text).join(' ').trim();
  const confidences = segments.map((segment) => segment.confidence ?? 0.75);
  const avgConfidence = confidences.reduce((total, value) => total + value, 0) / confidences.length;

  const lowerText = text.toLowerCase();
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const keywordHits = normalizedKeywords.reduce(
    (total, keyword) => (lowerText.includes(keyword) ? total + 1 : total),
    0,
  );

  const score = keywordHits + avgConfidence;
  let title = deriveTitle(segments[0]?.text ?? '');

  if (!title && keywordHits > 0) {
    const matched = normalizedKeywords.find((keyword) => lowerText.includes(keyword));
    title = matched ? matched.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Highlight';
  }

  if (!title) {
    title = 'Highlight';
  }

  return {
    start,
    end: adjustedEnd,
    duration,
    confidence: avgConfidence,
    score,
    title,
    text,
  };
}

function deriveTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  const clause = trimmed.split(/(?<=[.!?])/)[0]?.trim();
  return clause || trimmed.slice(0, 80);
}

async function fetchExistingClips(
  ctx: WorkerContext,
  projectId: string,
): Promise<Array<{ id?: string; start_s: number; end_s: number; score?: number }>> {
  // Fetch all clips for this project (regardless of status) to avoid any duplicates
  const response = await ctx.supabase
    .from('clips')
    .select('id,start_s,end_s,confidence')
    .eq('project_id', projectId);
  const rows = response.data as Array<{ id: string; start_s: number; end_s: number; confidence?: number }> | null;
  
  // Map confidence to score for overlap detection
  return (rows ?? []).map((clip) => ({
    id: clip.id,
    start_s: clip.start_s,
    end_s: clip.end_s,
    score: clip.confidence ?? 0,
  }));
}

async function ensureProjectStatus(ctx: WorkerContext, projectId: string, status: string): Promise<void> {
  // TODO: Legacy function - 'clips_proposed' is not in the lifecycle but may exist in DB
  // This function is kept for backward compatibility but should be refactored to use ProjectStatus
  const response = await ctx.supabase.from('projects').select('id,status').eq('id', projectId);
  const rows = response.data as Array<{ id: string; status?: string }> | null;
  const current = rows?.[0]?.status;
  if (current === status) {
    return;
  }
  await ctx.supabase.from('projects').update({ status }).eq('id', projectId);
}

// Backwards compatibility for legacy imports.
export function pipelineHighlightDetectStub(): 'highlight' {
  return 'highlight';
}
