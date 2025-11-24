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

import { buildRenderCommand } from "../services/ffmpeg/build-commands";
import { runFFmpeg } from "../services/ffmpeg/run";
import type { Job, WorkerContext } from "./types";

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
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
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

    const sourceKey = await resolveSourceKey(ctx, workspaceId, projectId);
    const subtitlesKey = `${workspaceId}/${projectId}/transcript.srt`;
    const videoKey = `${workspaceId}/${projectId}/${clipId}.mp4`;
    const thumbKey = `${workspaceId}/${projectId}/${clipId}.jpg`;

    const videoExists = await ctx.storage.exists(BUCKET_RENDERS, videoKey);
    if (videoExists && clip.status === "ready") {
      ctx.logger.info("render_skip_ready", { pipeline: PIPELINE, clipId });
      return;
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), "cliply-render-"));
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

await runFFmpeg(render.args, ctx.logger);

// Verify output files were created
await ensureFileExists(tempVideo);
await ensureFileExists(tempThumb);

    await uploadIfMissing(ctx, BUCKET_RENDERS, videoKey, tempVideo, "video/mp4");
    await uploadIfMissing(ctx, BUCKET_THUMBS, thumbKey, tempThumb, "image/jpeg");

    await ctx.supabase
      .from("clips")
      .update({
        status: "ready",
        storage_path: `${BUCKET_RENDERS}/${videoKey}`,
        thumb_path: `${BUCKET_THUMBS}/${thumbKey}`,
      })
      .eq("id", clipId);

    // Check if all clips for this project are now ready, and update project status accordingly
    await checkAndUpdateProjectStatus(ctx, projectId, workspaceId);

    ctx.logger.info("pipeline_completed", {
      pipeline: PIPELINE,
      clipId,
      projectId,
      workspaceId,
      videoKey,
      thumbKey,
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
  const response = await ctx.supabase.from("projects").select("id,workspace_id").eq("id", projectId);
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
): Promise<void> {
  // Fetch all clips for this project
  const { data: clips, error: clipsError } = await ctx.supabase
    .from("clips")
    .select("id,status")
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId);

  if (clipsError) {
    ctx.logger.warn("clip_render_status_check_failed", {
      pipeline: PIPELINE,
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
    // All clips are ready - update project status to 'ready'
    const { error: updateError } = await ctx.supabase
      .from("projects")
      .update({ status: "ready" })
      .eq("id", projectId)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      ctx.logger.warn("clip_render_project_status_update_failed", {
        pipeline: PIPELINE,
        projectId,
        workspaceId,
        error: updateError.message,
      });
    } else {
      ctx.logger.info("clip_render_project_ready", {
        pipeline: PIPELINE,
        projectId,
        workspaceId,
        totalClips: clips.length,
      });
    }
  } else if (anyFailed && clips.every((clip) => clip.status === "ready" || clip.status === "failed")) {
    // All clips are either ready or failed - mark project as ready (with some failed clips)
    // This allows the UI to show the project as ready even if some clips failed
    const { error: updateError } = await ctx.supabase
      .from("projects")
      .update({ status: "ready" })
      .eq("id", projectId)
      .eq("workspace_id", workspaceId);

    if (updateError) {
      ctx.logger.warn("clip_render_project_status_update_failed", {
        pipeline: PIPELINE,
        projectId,
        workspaceId,
        error: updateError.message,
      });
    } else {
      ctx.logger.info("clip_render_project_ready_with_failures", {
        pipeline: PIPELINE,
        projectId,
        workspaceId,
        totalClips: clips.length,
        readyClips: clips.filter((c) => c.status === "ready").length,
        failedClips: clips.filter((c) => c.status === "failed").length,
      });
    }
  }
}
