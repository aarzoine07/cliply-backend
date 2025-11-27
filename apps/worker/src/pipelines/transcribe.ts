import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUCKET_TRANSCRIPTS, BUCKET_VIDEOS, EXTENSION_MIME_MAP } from '@cliply/shared/constants';
import { TRANSCRIBE } from '@cliply/shared/schemas/jobs';
import { assertWithinUsage, recordUsage, UsageLimitExceededError } from '@cliply/shared/billing/usageTracker';
import { logPipelineStep } from '@cliply/shared/observability/logging';
import type { ProjectStatus } from '@cliply/shared';

import type { Job, WorkerContext } from './types';
import { getTranscriber } from '../services/transcriber';

const PIPELINE = 'TRANSCRIBE';
const TRANSCRIPT_SRT = 'transcript.srt';
const TRANSCRIPT_JSON = 'transcript.json';

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  try {
    const payload = TRANSCRIBE.parse(job.payload);
    const workspaceId = job.workspaceId;

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

    // Set project status to 'processing' when transcription starts
    await ctx.supabase
      .from('projects')
      .update({ status: 'processing' as ProjectStatus })
      .eq('id', payload.projectId);

    logPipelineStep(
      { jobId: String(job.id)        , workspaceId, clipId: payload.projectId },
      'transcribe',
      'start',
      { sourceKey },
    );

    const tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-transcribe-'));
    const localSource = join(tempDir, 'source');
    const downloadedPath = await ctx.storage.download(BUCKET_VIDEOS, sourceKey, localSource);

    const transcriber = getTranscriber();
    let result;
    try {
      result = await transcriber.transcribe(downloadedPath);
      logPipelineStep(
        { jobId: String(job.id)          , workspaceId, clipId: payload.projectId },
        'transcribe',
        'success',
        { durationSec: result.durationSec },
      );
    } catch (error) {
      logPipelineStep(
        { jobId: String(job.id)          , workspaceId, clipId: payload.projectId },
        'transcribe',
        'error',
        { error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }

    await Promise.all([
      ensureTranscriptUploaded(ctx, workspaceId, payload.projectId, TRANSCRIPT_SRT, result.srt, 'text/plain', tempDir),
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

    const project = await fetchProject(ctx, payload.projectId);
    // TODO: Legacy status check - 'transcribed' and 'clips_proposed' are not in the lifecycle
    // but may exist in DB from before lifecycle standardization. Keep processing status.
    const alreadyTranscribed = project?.status === 'transcribed' || project?.status === 'clips_proposed';

    if (!alreadyTranscribed) {
      // Record actual source minutes usage (idempotent - only record once per project)
      if (result.durationSec !== undefined && result.durationSec > 0) {
        const minutes = Math.ceil(result.durationSec / 60);
        await recordUsage({
          workspaceId,
          metric: 'source_minutes',
          amount: minutes,
        });
      }

      // Keep project in 'processing' status - highlight detection will continue the pipeline
      // Project status will be set to 'ready' when all clips are rendered
      await ctx.queue.enqueue({
        type: 'HIGHLIGHT_DETECT',
        workspaceId,
        payload: { projectId: payload.projectId },
      });
    }

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
  }
}

export const pipeline = { run };

async function resolveSourceKey(
  ctx: WorkerContext,
  workspaceId: string,
  projectId: string,
  explicitExt?: string,
): Promise<string> {
  if (explicitExt) {
    const candidate = `${workspaceId}/${projectId}/source.${explicitExt}`;
    const exists = await ctx.storage.exists(BUCKET_VIDEOS, candidate);
    if (!exists) {
      throw new Error(`source object missing: ${candidate}`);
    }
    return candidate;
  }

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
): Promise<{ id: string; status?: string; workspace_id?: string } | null> {
  const response = await ctx.supabase.from('projects').select('id,status,workspace_id').eq('id', projectId);
  const rows = response.data as Array<{ id: string; status?: string; workspace_id?: string }> | null;
  return rows?.[0] ?? null;
}

// Backwards compatibility for legacy imports.
export function pipelineTranscribeStub(): 'transcribe' {
  return 'transcribe';
}
