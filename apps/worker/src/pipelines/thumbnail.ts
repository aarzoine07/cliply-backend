import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUCKET_RENDERS, BUCKET_THUMBS, BUCKET_VIDEOS } from "@cliply/shared/constants";
import { THUMBNAIL_GEN } from "@cliply/shared/schemas/jobs";

import type { Job, WorkerContext } from "./types";
import { runFfmpegSafely } from "../lib/ffmpegSafe";
import { FfmpegTimeoutError, FfmpegExecutionError } from "@cliply/shared/errors/video";

const PIPELINE = "THUMBNAIL_GEN";

interface ClipRow {
  id: string;
  project_id: string;
  workspace_id: string;
  start_s: number;
  end_s: number;
  status: string;
  storage_path?: string | null;
  thumb_path?: string | null;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  try {
    const payload = THUMBNAIL_GEN.parse(job.payload);
    const clip = await fetchClip(ctx, payload.clipId);
    if (!clip) {
      throw new Error(`clip not found: ${payload.clipId}`);
    }

    const workspaceId = clip.workspace_id;
    const projectId = clip.project_id;
    const clipId = clip.id;
    const targetKey = `${workspaceId}/${projectId}/${clipId}.jpg`;

    const thumbExists = await ctx.storage.exists(BUCKET_THUMBS, targetKey);
    if (thumbExists && clip.thumb_path) {
      ctx.logger.info("thumbnail_skip_existing", { pipeline: PIPELINE, clipId });
      return;
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-thumb-"));
    const tempThumb = join(tempDir, `${clipId}.jpg`);

    const renderPath = clip.storage_path?.replace(/^renders\//, "");
    const renderExists = renderPath ? await ctx.storage.exists(BUCKET_RENDERS, renderPath) : false;
    const inputBucket = renderExists ? BUCKET_RENDERS : BUCKET_VIDEOS;
    const inputPathKey = renderExists ? renderPath! : `${workspaceId}/${projectId}/source.mp4`;

    const inputPath = await ctx.storage.download(inputBucket, inputPathKey, join(tempDir, "input.mp4"));

    const atSec = payload.atSec ?? Math.max(0, (clip.start_s + clip.end_s) / 2);
    const ffmpegArgs = [
      "-hide_banner",
      "-y",
      "-ss",
      atSec.toFixed(3),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      tempThumb,
    ];

    // Use safe FFmpeg wrapper with timeout
    const ffmpegResult = await runFfmpegSafely({
      inputPath,
      outputPath: tempThumb,
      args: ffmpegArgs,
      timeoutMs: 2 * 60 * 1000, // 2 minutes for thumbnail generation
      logger: ctx.logger,
    });

    if (!ffmpegResult.ok) {
      if (ffmpegResult.kind === "TIMEOUT") {
        ctx.logger.error("ffmpeg_timeout", {
          pipeline: PIPELINE,
          jobId: String(job.id),
          workspaceId,
          projectId,
          clipId,
          timeoutMs: 2 * 60 * 1000,
        });
        throw new FfmpegTimeoutError(
          `FFmpeg timed out after 2 minutes`,
          2 * 60 * 1000,
          inputPath,
        );
      }

      ctx.logger.error("ffmpeg_failed", {
        pipeline: PIPELINE,
        jobId: String(job.id),
        workspaceId,
        projectId,
        clipId,
        exitCode: ffmpegResult.exitCode,
        signal: ffmpegResult.signal,
        stderrSummary: ffmpegResult.stderrSummary,
      });
      throw new FfmpegExecutionError(
        `FFmpeg failed with exit code ${ffmpegResult.exitCode ?? "unknown"}: ${ffmpegResult.stderrSummary ?? "no error details"}`,
        ffmpegResult.exitCode,
        ffmpegResult.signal,
        inputPath,
        tempThumb,
      );
    }

    await ensureFileExists(tempThumb);

    await ctx.storage.upload(BUCKET_THUMBS, targetKey, tempThumb, "image/jpeg");

    await ctx.supabase
      .from("clips")
      .update({ thumb_path: `${BUCKET_THUMBS}/${targetKey}` })
      .eq("id", clipId);

    ctx.logger.info("pipeline_completed", {
      pipeline: PIPELINE,
      clipId,
      projectId,
      workspaceId,
      inputBucket,
      inputPathKey,
    });
  } catch (error) {
    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE },
      extra: { jobId: String(job.id), workspaceId: job.workspaceId },
    });
    ctx.logger.error("pipeline_failed", {
      pipeline: PIPELINE,
      jobId: job.id,
      workspaceId: job.workspaceId,
      error: (error as Error)?.message ?? String(error),
    });
    throw error;
  }
}

export const pipeline = { run };

async function fetchClip(ctx: WorkerContext, clipId: string): Promise<ClipRow | null> {
  const response = await ctx.supabase
    .from("clips")
    .select("id,project_id,workspace_id,start_s,end_s,status,storage_path,thumb_path")
    .eq("id", clipId);
  const rows = response.data as ClipRow[] | null;
  return rows?.[0] ?? null;
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
    // File exists, nothing to do
  } catch {
    // File doesn't exist - this is an error, not something we should fix by creating empty file
    throw new Error(`Expected file does not exist: ${path}`);
  }
}

// Backwards compatibility for legacy imports.
export function pipelineThumbnailStub(): "thumbnail" {
  return "thumbnail";
}
