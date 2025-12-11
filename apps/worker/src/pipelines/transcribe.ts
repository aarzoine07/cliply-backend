import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUCKET_TRANSCRIPTS, BUCKET_VIDEOS, EXTENSION_MIME_MAP } from '@cliply/shared/constants';
import { TRANSCRIBE } from '@cliply/shared/schemas/jobs';
import { assertWithinUsage, recordUsage, UsageLimitExceededError } from '@cliply/shared/billing/usageTracker';
import { logPipelineStep } from '@cliply/shared/observability/logging';
import { isStageAtLeast } from '@cliply/shared/engine/pipelineStages';

import type { Job, WorkerContext } from './types';
import { getTranscriber } from '../services/transcriber';
import { cleanupTempDirSafe } from '../lib/tempCleanup';

const PIPELINE = 'TRANSCRIBE';
const TRANSCRIPT_SRT = 'transcript.srt';
const TRANSCRIPT_JSON = 'transcript.json';

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  let tempDir: string | null = null;

  try {
    const payload = TRANSCRIBE.parse(job.payload);
    const workspaceId = job.workspaceId;

    // Load current pipeline stage to check if transcription is already done
    const project = await fetchProject(ctx, payload.projectId);
    const currentStage = project?.pipeline_stage ?? null;

    // Skip if already transcribed or beyond
    if (isStageAtLeast(currentStage, 'TRANSCRIBED')) {
      ctx.logger.info('pipeline_stage_skipped', {
        pipeline: PIPELINE,
        jobId: job.id,
        workspaceId,
        projectId: payload.projectId,
        stage: 'TRANSCRIBED',
        currentStage,
        reason: 'already_completed',
      });
      return;
    }

    // Check usage limits before heavy transcription work
    // We check for at least 1 minute remaining (conservative, actual duration will be recorded after transcription)
    try {
      await assertWithinUsage(workspaceId, 'source_minutes', 1);
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        ctx.logger.warn('transcribe_usage_limit_exceeded', {
          pipeline: PIPELINE,
          jobId: job.id,
          workspaceId,
          metric: error.metric,
          used: error.used,
          limit: error.limit,
        });
        // Mark job as failed but don't crash - let the job system handle retries/backoff
        throw error;
      }
      throw error;
    }

    const sourceKey = await resolveSourceKey(ctx, workspaceId, payload.projectId, payload.sourceExt);

    logPipelineStep(
      { jobId: String(job.id), workspaceId, clipId: payload.projectId },
      'transcribe',
      'start',
      { sourceKey },
    );

    tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-transcribe-'));
    const localSource = join(tempDir, 'source');
    const downloadedPath = await ctx.storage.download(BUCKET_VIDEOS, sourceKey, localSource);

    const transcriber = getTranscriber();
    let result;
    try {
      result = await transcriber.transcribe(downloadedPath);
      logPipelineStep(
        { jobId: String(job.id), workspaceId, clipId: payload.projectId },
        'transcribe',
        'success',
        { durationSec: result.durationSec },
      );
    } catch (error) {
      logPipelineStep(
        { jobId: String(job.id), workspaceId, clipId: payload.projectId },
        'transcribe',
        'error',
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }

    await Promise.all([
      ensureTranscriptUploaded(
        ctx,
        workspaceId,
        payload.projectId,
        TRANSCRIPT_SRT,
        result.srt,
        'text/plain',
        tempDir,
      ),
      ensureTranscriptUploaded(
        ctx,
        workspaceId,
        payload.projectId,
        TRANSCRIPT_JSON,
        JSON.stringify(result.json ?? {}, null, 2),
        'application/json',
        tempDir,
      ),
    ]);

    // Record actual source minutes usage (idempotent - only record once per project)
    if (result.durationSec !== undefined && result.durationSec > 0) {
      const minutes = Math.ceil(result.durationSec / 60);
      await recordUsage({
        workspaceId,
        metric: 'source_minutes',
        amount: minutes,
      });
    }

    // ─────────────────────────────────────────────
    // Advance pipeline stage to TRANSCRIBED
    // (We only reach here if we were NOT already at/after TRANSCRIBED)
    // ─────────────────────────────────────────────
    const {
      data: updatedProjects,
      error: updateError,
    } = await ctx.supabase
      .from('projects')
      .update({
        pipeline_stage: 'TRANSCRIBED',
      })
      .eq('id', payload.projectId)
      .select('id,pipeline_stage,status');

    if (updateError) {
      ctx.logger.error('pipeline_stage_update_failed', {
        pipeline: PIPELINE,
        jobId: job.id,
        workspaceId,
        projectId: payload.projectId,
        error: updateError.message,
        details: updateError,
      });
      throw updateError;
    }

    ctx.logger.info('pipeline_stage_update_success', {
      pipeline: PIPELINE,
      jobId: job.id,
      workspaceId,
      projectId: payload.projectId,
      updatedProjects,
    });

    ctx.logger.info('pipeline_stage_advanced', {
      pipeline: PIPELINE,
      jobId: job.id,
      workspaceId,
      projectId: payload.projectId,
      from: currentStage ?? 'UPLOADED',
      to: 'TRANSCRIBED',
    });

    // Enqueue next pipeline stage
    await ctx.queue.enqueue({
      type: 'HIGHLIGHT_DETECT',
      workspaceId,
      payload: { projectId: payload.projectId },
    });

    ctx.logger.info('pipeline_completed', {
      pipeline: PIPELINE,
      jobId: job.id,
      projectId: payload.projectId,
      workspaceId,
      storagePath: sourceKey,
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
  } finally {
    // Clean up temp directory on both success and failure
    if (tempDir) {
      await cleanupTempDirSafe(tempDir, ctx.logger);
    }
  }
}

export const pipeline = { run };

async function resolveSourceKey(
  ctx: WorkerContext,
  workspaceId: string,
  projectId: string,
  explicitExt?: string,
): Promise<string> {
  // 1) If explicit extension is provided, try the legacy path first
  if (explicitExt) {
    const candidate = `${workspaceId}/${projectId}/source.${explicitExt}`;
    const exists = await ctx.storage.exists(BUCKET_VIDEOS, candidate);
    if (exists) {
      return candidate;
    }
    // If it doesn't exist, fall through to DB-based lookup
  }

  // 2) Prefer the source_path stored on the project row
  const { data: project, error } = await ctx.supabase
    .from('projects')
    .select('workspace_id, source_path')
    .eq('id', projectId)
    .single();

  if (error) {
    throw error;
  }

  if (project?.source_path) {
    const key = project.source_path as string;
    const exists = await ctx.storage.exists(BUCKET_VIDEOS, key);
    if (!exists) {
      throw new Error(`no source object found for project ${projectId}`);
    }
    return key;
  }

  // 3) Fallback: legacy discovery using bucket listing + file extensions
  const prefix = `${workspaceId}/${projectId}/`;
  const objects = await ctx.storage.list(BUCKET_VIDEOS, prefix);
  const normalized = objects.map((entry) => (entry.startsWith(prefix) ? entry : `${prefix}${entry}`));
  const extensions = Object.keys(EXTENSION_MIME_MAP);
  const match = normalized.find((entry) => {
    const lower = entry.toLowerCase();
    return extensions.some((ext) => lower.endsWith(`source${ext}`));
  });

  if (!match) {
    throw new Error(`no source object found for project ${projectId}`);
  }

  return match;
}

async function ensureTranscriptUploaded(
  ctx: WorkerContext,
  workspaceId: string,
  projectId: string,
  filename: string,
  contents: string,
  contentType: string,
  tempDir: string,
): Promise<void> {
  const key = `${workspaceId}/${projectId}/${filename}`;
  const exists = await ctx.storage.exists(BUCKET_TRANSCRIPTS, key);
  if (exists) return;

  const localPath = join(tempDir, filename);
  await fs.writeFile(localPath, contents, 'utf8');
  await ctx.storage.upload(BUCKET_TRANSCRIPTS, key, localPath, contentType);
}

async function fetchProject(
  ctx: WorkerContext,
  projectId: string,
): Promise<{ id: string; status?: string; workspace_id?: string; pipeline_stage?: string | null } | null> {
  const response = await ctx.supabase
    .from('projects')
    .select('id,status,workspace_id,pipeline_stage')
    .eq('id', projectId);
  const rows = response.data as Array<{ id: string; status?: string; workspace_id?: string; pipeline_stage?: string | null }> | null;
  return rows?.[0] ?? null;
}

// Backwards compatibility for legacy imports.
export function pipelineTranscribeStub(): 'transcribe' {
  return 'transcribe';
}

