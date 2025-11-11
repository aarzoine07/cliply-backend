import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUCKET_TRANSCRIPTS } from '@cliply/shared/constants';
import { HIGHLIGHT_DETECT } from '@cliply/shared/schemas/jobs';

import type { Job, WorkerContext } from './types.js';

const PIPELINE = 'HIGHLIGHT_DETECT';

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

interface HighlightCandidate {
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
    const transcriptKey = `${workspaceId}/${payload.projectId}/transcript.json`;

    const exists = await ctx.storage.exists(BUCKET_TRANSCRIPTS, transcriptKey);
    if (!exists) {
      throw new Error(`transcript missing: ${transcriptKey}`);
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-highlight-'));
    const localPath = join(tempDir, 'transcript.json');
    await ctx.storage.download(BUCKET_TRANSCRIPTS, transcriptKey, localPath);
    const raw = await fs.readFile(localPath, 'utf8');
    const parsed = JSON.parse(raw) as { segments?: TranscriptSegment[] };
    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];

    if (segments.length === 0) {
      ctx.logger.warn('highlight_no_segments', {
        pipeline: PIPELINE,
        projectId: payload.projectId,
        workspaceId,
      });
      return;
    }

    const groups = groupSegments(segments, payload.minGapSec);
    const candidates = groups
      .map((group) => buildCandidate(group, payload.keywords))
      .filter((candidate): candidate is HighlightCandidate => candidate !== null);

    if (candidates.length === 0) {
      ctx.logger.info('highlight_no_candidates', {
        pipeline: PIPELINE,
        projectId: payload.projectId,
        workspaceId,
      });
      await ensureProjectStatus(ctx, payload.projectId, 'clips_proposed');
      return;
    }

    candidates.sort((a, b) => b.score - a.score || a.start - b.start);
    const topCandidates = candidates.slice(0, payload.maxClips);

    const existing = await fetchExistingClips(ctx, payload.projectId);
    const existingKeys = new Set(existing.map((clip) => `${clip.start_s.toFixed(3)}:${clip.end_s.toFixed(3)}`));

    const inserts = topCandidates
      .filter((candidate) => !existingKeys.has(`${candidate.start.toFixed(3)}:${candidate.end.toFixed(3)}`))
      .map((candidate) => {
        existingKeys.add(`${candidate.start.toFixed(3)}:${candidate.end.toFixed(3)}`);
        return {
          project_id: payload.projectId,
          workspace_id: workspaceId,
          start_s: Number(candidate.start.toFixed(3)),
          end_s: Number(candidate.end.toFixed(3)),
          title: candidate.title,
          confidence: Number(candidate.confidence.toFixed(3)),
          status: 'proposed',
        };
      });

    if (inserts.length > 0) {
      await ctx.supabase.from('clips').insert(inserts);
    }

    await ensureProjectStatus(ctx, payload.projectId, 'clips_proposed');

    ctx.logger.info('pipeline_completed', {
      pipeline: PIPELINE,
      projectId: payload.projectId,
      workspaceId,
      candidates: candidates.length,
      inserted: inserts.length,
    });
  } catch (error) {
    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE },
      extra: { jobId: String(job.id), workspaceId: job.workspaceId },
    });
    ctx.logger.error('pipeline_failed', {
      pipeline: PIPELINE,
      jobId: job.id,
      workspaceId: job.workspaceId,
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

function buildCandidate(segments: TranscriptSegment[], keywords: string[]): HighlightCandidate | null {
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
): Promise<Array<{ start_s: number; end_s: number }>> {
  const response = await ctx.supabase.from('clips').select('start_s,end_s').eq('project_id', projectId);
  const rows = response.data as Array<{ start_s: number; end_s: number }> | null;
  return rows ?? [];
}

async function ensureProjectStatus(ctx: WorkerContext, projectId: string, status: string): Promise<void> {
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
