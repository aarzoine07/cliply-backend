import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUCKET_VIDEOS } from "@cliply/shared/constants";
import { YOUTUBE_DOWNLOAD } from "@cliply/shared/schemas/jobs";
import { logPipelineStep } from "@cliply/shared/observability/logging";

import type { Job, WorkerContext } from "./types";
import { downloadYouTubeVideo, extractYouTubeVideoId } from "../services/youtube/download";

const PIPELINE = "YOUTUBE_DOWNLOAD";

interface ProjectRow {
  id: string;
  workspace_id: string;
  source_path?: string | null;
  status?: string;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  try {
    const payload = YOUTUBE_DOWNLOAD.parse(job.payload);
    const workspaceId = job.workspaceId;
    const projectId = payload.projectId;
    const youtubeUrl = payload.youtubeUrl;

    // Validate YouTube URL and extract video ID
    const videoId = extractYouTubeVideoId(youtubeUrl);
    if (!videoId) {
      throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
    }

    // Fetch project to verify it exists and get workspace
    const project = await fetchProject(ctx, projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    if (project.workspace_id !== workspaceId) {
      throw new Error(`Project workspace mismatch: expected ${workspaceId}, got ${project.workspace_id}`);
    }

    // Determine target storage path
    const storageKey = `${workspaceId}/${projectId}/source.mp4`;
    const targetPath = storageKey;

    // Check if video already exists (idempotency)
    const exists = await ctx.storage.exists(BUCKET_VIDEOS, targetPath);
    if (exists) {
      ctx.logger.info("youtube_download_skip_existing", {
        pipeline: PIPELINE,
        jobId: job.id,
        projectId,
        workspaceId,
        youtubeUrl,
        storagePath: targetPath,
      });

      // Update project status if needed
      if (project.status === "queued") {
        await ctx.supabase.from("projects").update({ status: "processing" }).eq("id", projectId);
      }

      // Enqueue transcribe job if not already done
      await ctx.queue.enqueue({
        type: "TRANSCRIBE",
        workspaceId,
        payload: { projectId, sourceExt: "mp4" },
      });

      return;
    }

    ctx.logger.info("youtube_download_start", {
      pipeline: PIPELINE,
      jobId: job.id,
      projectId,
      workspaceId,
      youtubeUrl,
      videoId,
      storagePath: targetPath,
    });

    // Log pipeline step start
    logPipelineStep(
      { jobId: job.id, workspaceId, clipId: projectId },
      "download",
      "start",
      { videoId, storagePath: targetPath },
    );

    // Download video to temporary file
    let downloadResult;
    try {
      downloadResult = await downloadYouTubeVideo({
        youtubeUrl,
        targetBucket: BUCKET_VIDEOS,
        targetPath,
      });

      logPipelineStep(
        { jobId: job.id, workspaceId, clipId: projectId },
        "download",
        "success",
        { videoId, storagePath: targetPath },
      );
    } catch (error) {
      logPipelineStep(
        { jobId: job.id, workspaceId, clipId: projectId },
        "download",
        "error",
        { videoId, error: error instanceof Error ? error.message : String(error) },
      );
      throw error;
    }

    // Upload to Supabase storage
    await ctx.storage.upload(BUCKET_VIDEOS, targetPath, downloadResult.localPath, "video/mp4");

    // Clean up temporary file
    try {
      await fs.unlink(downloadResult.localPath);
      const tempDir = join(tmpdir(), "cliply-yt-download-");
      if (downloadResult.localPath.startsWith(tempDir)) {
        await fs.rmdir(tempDir).catch(() => {
          // Ignore errors cleaning up temp dir
        });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Update project status and source_path
    await ctx.supabase
      .from("projects")
      .update({
        status: "processing",
        source_path: `${BUCKET_VIDEOS}/${targetPath}`,
      })
      .eq("id", projectId);

    // Enqueue transcribe job to continue the pipeline
    await ctx.queue.enqueue({
      type: "TRANSCRIBE",
      workspaceId,
      payload: { projectId, sourceExt: "mp4" },
    });

    ctx.logger.info("youtube_download_success", {
      pipeline: PIPELINE,
      jobId: job.id,
      projectId,
      workspaceId,
      youtubeUrl,
      videoId,
      storagePath: targetPath,
      sizeBytes: downloadResult.sizeBytes,
    });
  } catch (error) {
    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE },
      extra: { jobId: String(job.id), workspaceId: job.workspaceId },
    });
    ctx.logger.error("youtube_download_error", {
      pipeline: PIPELINE,
      jobId: job.id,
      workspaceId: job.workspaceId,
      error: (error as Error)?.message ?? String(error),
    });
    throw error;
  }
}

export const pipeline = { run };

async function fetchProject(
  ctx: WorkerContext,
  projectId: string,
): Promise<ProjectRow | null> {
  const response = await ctx.supabase
    .from("projects")
    .select("id,workspace_id,source_path,status")
    .eq("id", projectId);
  const rows = response.data as ProjectRow[] | null;
  return rows?.[0] ?? null;
}

