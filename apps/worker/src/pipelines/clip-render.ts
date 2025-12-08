import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUCKET_RENDERS,
  BUCKET_THUMBS,
  BUCKET_TRANSCRIPTS,
  BUCKET_VIDEOS,
  EXTENSION_MIME_MAP,
} from "@cliply/shared/constants";
import { CLIP_RENDER } from "@cliply/shared/schemas/jobs";
import type { ClipStatus, ProjectStatus } from "@cliply/shared";
import { incrementUsage } from "@cliply/shared/billing/usage";
import { logEvent } from "@cliply/shared/logging/logger";
import { 
  transcriptSrtPath, 
  clipRenderPath, 
  clipThumbnailPath 
} from '@cliply/shared/storage/paths';
import { PIPELINE_CLIP_RENDER } from '@cliply/shared/pipeline/names';
import { isStageAtLeast, nextStageAfter } from '@cliply/shared/engine/pipelineStages';

import { buildRenderCommand } from "../services/ffmpeg/build-commands";
import { runFfmpegSafely } from "../lib/ffmpegSafe";
import { FfmpegTimeoutError, FfmpegExecutionError } from "@cliply/shared/errors/video";
import type { Job, WorkerContext } from "./types";
import { cleanupTempDirSafe } from "../lib/tempCleanup";

const PIPELINE = "CLIP_RENDER";

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

interface ProjectRow {
  id: string;
  workspace_id: string;
  pipeline_stage?: string | null;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  let tempDir: string | null = null;

  try {
    const payload = CLIP_RENDER.parse(job.payload);

    const clip = await fetchClip(ctx, payload.clipId);
    if (!clip) {
      throw new Error(`clip not found: ${payload.clipId}`);
    }

    const project = await fetchProject(ctx, clip.project_id);
    if (!project) {
      throw new Error(`project not found: ${clip.project_id}`);
    }

    const workspaceId = clip.workspace_id;
    const projectId = clip.project_id;
    const clipId = clip.id;

    // Load project pipeline stage to check if rendering is already done
    const projectStage = project.pipeline_stage ?? null;
    
    // If project is already at RENDERED or beyond, check if this specific clip is already rendered
    if (isStageAtLeast(projectStage, 'RENDERED')) {
      const videoKey = clipRenderPath(workspaceId, projectId, clipId, 'mp4');
      const videoExists = await ctx.storage.exists(BUCKET_RENDERS, videoKey);
      if (videoExists && clip.status === "ready") {
        ctx.logger.info("pipeline_stage_skipped", {
          pipeline: PIPELINE_CLIP_RENDER,
          jobKind: job.type,
          jobId: String(job.id),
          workspaceId,
          projectId,
          clipId,
          stage: 'RENDERED',
          currentStage: projectStage,
          reason: 'already_completed',
        });
        return;
      }
    }

    // Set clip status to 'rendering' when render job starts
    // After rendering, this becomes a generated_clip with status='ready' (see docs/machine-mapping.md)
    await ctx.supabase
      .from("clips")
      .update({ status: "rendering" as ClipStatus })
      .eq("id", clipId);

    logEvent({
      service: 'worker',
      event: 'clip_render_start',
      workspaceId,
      jobId: String(job.id),
      projectId,
      clipId,
      meta: {
        startSec: clip.start_s,
        endSec: clip.end_s,
      },
    });

    const sourceKey = await resolveSourceKey(ctx, workspaceId, projectId);
    const subtitlesKey = transcriptSrtPath(workspaceId, projectId);
    const videoKey = clipRenderPath(workspaceId, projectId, clipId, 'mp4');
    const thumbKey = clipThumbnailPath(workspaceId, projectId, clipId, 'jpg');

    // Double-check: if video already exists and clip is ready, skip rendering
    const videoExists = await ctx.storage.exists(BUCKET_RENDERS, videoKey);
    if (videoExists && clip.status === "ready") {
      ctx.logger.info("pipeline_stage_skipped", {
        pipeline: PIPELINE_CLIP_RENDER,
        jobKind: job.type,
        jobId: String(job.id),
        workspaceId,
        projectId,
        clipId,
        stage: 'RENDERED',
        currentStage: projectStage,
        reason: 'clip_already_rendered',
      });
      return;
    }

    tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-render-"));
    const tempVideo = join(tempDir, `${clipId}.mp4`);
    const tempThumb = join(tempDir, `${clipId}.jpg`);

    const subtitlesPath = (await ctx.storage.exists(BUCKET_TRANSCRIPTS, subtitlesKey))
      ? await ctx.storage.download(BUCKET_TRANSCRIPTS, subtitlesKey, join(tempDir, "subs.srt"))
      : undefined;

    const sourcePath = await ctx.storage.download(BUCKET_VIDEOS, sourceKey, join(tempDir, "source"));

    const render = buildRenderCommand(sourcePath, tempVideo, {
      clipStart: clip.start_s,
      clipEnd: clip.end_s,
      subtitlesPath,
      makeThumb: {
        outPath: tempThumb,
        atSec: (clip.start_s + clip.end_s) / 2,
      },
    });

    // Use safe FFmpeg wrapper with timeout and error handling
    const ffmpegResult = await runFfmpegSafely({
      inputPath: sourcePath,
      outputPath: tempVideo,
      args: render.args,
      timeoutMs: 10 * 60 * 1000, // 10 minutes for clip rendering
      logger: ctx.logger,
    });

    if (!ffmpegResult.ok) {
      if (ffmpegResult.kind === "TIMEOUT") {
        ctx.logger.error("ffmpeg_timeout", {
          pipeline: PIPELINE_CLIP_RENDER,
          jobId: String(job.id),
          workspaceId,
          projectId,
          clipId,
          timeoutMs: 10 * 60 * 1000,
        });
        throw new FfmpegTimeoutError(
          `FFmpeg timed out after 10 minutes`,
          10 * 60 * 1000,
          sourcePath,
        );
      }

      ctx.logger.error("ffmpeg_failed", {
        pipeline: PIPELINE_CLIP_RENDER,
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
        sourcePath,
        tempVideo,
      );
    }

// Verify output files were created
await ensureFileExists(tempVideo);
await ensureFileExists(tempThumb);

    await uploadIfMissing(ctx, BUCKET_RENDERS, videoKey, tempVideo, "video/mp4");
    await uploadIfMissing(ctx, BUCKET_THUMBS, thumbKey, tempThumb, "image/jpeg");

    // Update to generated_clip status='ready' after successful render
    await ctx.supabase
      .from("clips")
      .update({
        status: "ready" as ClipStatus,
        storage_path: `${BUCKET_RENDERS}/${videoKey}`,
        thumb_path: `${BUCKET_THUMBS}/${thumbKey}`,
      })
      .eq("id", clipId);

    // Increment usage for successful clip render
    await incrementUsage(ctx.supabase, {
      workspaceId,
      clipRenders: 1,
    });

    // Check if all clips for this project are now ready, and update project status and stage accordingly
    await checkAndUpdateProjectStatus(ctx, projectId, workspaceId, projectStage);

    logEvent({
      service: 'worker',
      event: 'clip_render_complete',
      workspaceId,
      jobId: String(job.id),
      projectId,
      clipId,
      meta: {
        videoKey,
        thumbKey,
      },
    });

    ctx.logger.info("pipeline_completed", {
      pipeline: PIPELINE_CLIP_RENDER,
      jobKind: job.type,
      jobId: String(job.id),
      clipId,
      projectId,
      workspaceId,
      videoKey,
      thumbKey,
    });
  } catch (error) {
    // Set clip status to 'failed' on unrecoverable error
    let clipIdForError: string | undefined;
    try {
      const payload = CLIP_RENDER.parse(job.payload);
      clipIdForError = payload.clipId;
      const { data: failedClipRows } = await ctx.supabase
        .from("clips")
        .update({ status: "failed" as ClipStatus })
        .eq("id", payload.clipId)
        .select();
      
      // Clip status is already set to 'failed' above
    } catch (updateError) {
      ctx.logger.warn("clip_render_failed_status_update_failed", {
        pipeline: PIPELINE_CLIP_RENDER,
        jobKind: job.type,
        jobId: job.id,
        workspaceId: job.workspaceId,
        ...(clipIdForError && { clipId: clipIdForError }),
        error: (updateError as Error)?.message ?? String(updateError),
      });
    }

    const payload = CLIP_RENDER.parse(job.payload);
    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE_CLIP_RENDER, jobKind: job.type },
      extra: { 
        jobId: String(job.id), 
        workspaceId: job.workspaceId,
        clipId: payload.clipId 
      },
    });
    ctx.logger.error("pipeline_failed", {
      pipeline: PIPELINE_CLIP_RENDER,
      jobKind: job.type,
      jobId: job.id,
      workspaceId: job.workspaceId,
      clipId: payload.clipId,
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

async function resolveSourceKey(ctx: WorkerContext, workspaceId: string, projectId: string): Promise<string> {
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

async function fetchClip(ctx: WorkerContext, clipId: string): Promise<ClipRow | null> {
  const response = await ctx.supabase
    .from("clips")
    .select("id,project_id,workspace_id,start_s,end_s,status,storage_path,thumb_path")
    .eq("id", clipId);
  const rows = response.data as ClipRow[] | null;
  return rows?.[0] ?? null;
}

async function fetchProject(ctx: WorkerContext, projectId: string): Promise<ProjectRow | null> {
  const response = await ctx.supabase
    .from("projects")
    .select("id,workspace_id,pipeline_stage")
    .eq("id", projectId);
  const rows = response.data as ProjectRow[] | null;
  return rows?.[0] ?? null;
}

async function uploadIfMissing(
  ctx: WorkerContext,
  bucket: string,
  key: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  const exists = await ctx.storage.exists(bucket, key);
  if (exists) {
    return;
  }
  await ctx.storage.upload(bucket, key, localPath, contentType);
}

// Backwards compatibility for legacy imports.
export function pipelineClipRenderStub(): "render" {
  return "render";
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

async function checkAndUpdateProjectStatus(
  ctx: WorkerContext,
  projectId: string,
  workspaceId: string,
  currentStage: string | null,
): Promise<void> {
  // Fetch all clips for this project
  const { data: clips, error: clipsError } = await ctx.supabase
    .from("clips")
    .select("id,status")
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId);

  if (clipsError) {
    ctx.logger.warn("clip_render_status_check_failed", {
      pipeline: PIPELINE_CLIP_RENDER,
      projectId,
      workspaceId,
      error: clipsError.message,
    });
    return;
  }

  if (!clips || clips.length === 0) {
    // No clips yet, don't update project status
    return;
  }

  // Check if all clips are ready
  const allReady = clips.every((clip) => clip.status === "ready");
  const anyFailed = clips.some((clip) => clip.status === "failed");

  if (allReady) {
    // All clips are ready - update project status and advance pipeline stage to RENDERED
    const nextStage = nextStageAfter(currentStage);
    const updates: { status: ProjectStatus; pipeline_stage?: string } = {
      status: "ready" as ProjectStatus,
    };
    
    if (nextStage === 'RENDERED') {
      updates.pipeline_stage = 'RENDERED';
    }

    // Conditional update: only advance if not already at RENDERED or beyond
    // This prevents concurrent clip-render jobs from causing race conditions
    const { data: updatedProject, error: updateError } = await ctx.supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      // Only update if stage is less than RENDERED (atomic check)
      .not('pipeline_stage', 'in', '(RENDERED,PUBLISHED)')
      .select('id, pipeline_stage')
      .maybeSingle();

    if (updateError) {
      ctx.logger.warn("clip_render_project_status_update_failed", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        error: updateError.message,
      });
    } else if (updatedProject) {
      // Only log if we actually updated (not already at RENDERED)
      if (nextStage === 'RENDERED') {
        ctx.logger.info("pipeline_stage_advanced", {
          pipeline: PIPELINE_CLIP_RENDER,
          jobKind: 'CLIP_RENDER',
          workspaceId,
          projectId,
          from: currentStage ?? 'CLIPS_GENERATED',
          to: 'RENDERED',
        });
      }
      ctx.logger.info("clip_render_project_ready", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        totalClips: clips.length,
      });
    } else {
      // No rows updated - stage was already at RENDERED or beyond
      ctx.logger.info("clip_render_project_already_ready", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        totalClips: clips.length,
        currentStage: currentStage ?? 'unknown',
      });
    }
  } else if (anyFailed && clips.every((clip) => clip.status === "ready" || clip.status === "failed")) {
    // All clips are either ready or failed - mark project as ready (with some failed clips)
    // This allows the UI to show the project as ready even if some clips failed
    // Also advance pipeline stage if appropriate
    const nextStage = nextStageAfter(currentStage);
    const updates: { status: ProjectStatus; pipeline_stage?: string } = {
      status: "ready" as ProjectStatus,
    };
    
    if (nextStage === 'RENDERED') {
      updates.pipeline_stage = 'RENDERED';
    }

    // Conditional update: only advance if not already at RENDERED or beyond
    const { data: updatedProject, error: updateError } = await ctx.supabase
      .from("projects")
      .update(updates)
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      // Only update if stage is less than RENDERED (atomic check)
      .not('pipeline_stage', 'in', '(RENDERED,PUBLISHED)')
      .select('id, pipeline_stage')
      .maybeSingle();

    if (updateError) {
      ctx.logger.warn("clip_render_project_status_update_failed", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        error: updateError.message,
      });
    } else if (updatedProject) {
      // Only log if we actually updated (not already at RENDERED)
      if (nextStage === 'RENDERED') {
        ctx.logger.info("pipeline_stage_advanced", {
          pipeline: PIPELINE_CLIP_RENDER,
          jobKind: 'CLIP_RENDER',
          workspaceId,
          projectId,
          from: currentStage ?? 'CLIPS_GENERATED',
          to: 'RENDERED',
        });
      }
      ctx.logger.info("clip_render_project_ready_with_failures", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        totalClips: clips.length,
        readyClips: clips.filter((c) => c.status === "ready").length,
        failedClips: clips.filter((c) => c.status === "failed").length,
      });
    } else {
      // No rows updated - stage was already at RENDERED or beyond
      ctx.logger.info("clip_render_project_already_ready_with_failures", {
        pipeline: PIPELINE_CLIP_RENDER,
        projectId,
        workspaceId,
        totalClips: clips.length,
        readyClips: clips.filter((c) => c.status === "ready").length,
        failedClips: clips.filter((c) => c.status === "failed").length,
        currentStage: currentStage ?? 'unknown',
      });
    }
  }
}
