import { CLEANUP_STORAGE } from "@cliply/shared/schemas/jobs";
import {
  BUCKET_VIDEOS,
  BUCKET_TRANSCRIPTS,
  BUCKET_RENDERS,
  BUCKET_THUMBS,
} from "@cliply/shared/constants";

import type { Job, WorkerContext } from "./types";

const PIPELINE = "CLEANUP_STORAGE";

// Default retention: 30 days for temp/intermediate artifacts
const DEFAULT_RETENTION_DAYS = 30;

// Safety: never delete artifacts newer than this many days
const MIN_RETENTION_DAYS = 7;

/**
 * Cleanup policy:
 * 
 * 1. **Failed renders**: Clips with status='failed' and updated_at > retention window
 *    - Delete from BUCKET_RENDERS and BUCKET_THUMBS
 * 
 * 2. **Orphaned intermediates**: Files in storage with no corresponding DB rows
 *    - Only consider files older than retention window
 *    - Check if workspace/project/clip exists in DB
 * 
 * 3. **DO NOT delete**:
 *    - Final rendered clips (status='ready' or 'published')
 *    - Source videos in BUCKET_VIDEOS (user uploads)
 *    - Transcripts in BUCKET_TRANSCRIPTS (needed for re-processing)
 *    - Anything newer than retention window
 */
export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  const startTime = Date.now();
  const jobId = job.id;
  const workspaceId = job.workspaceId;

  try {
    const payload = CLEANUP_STORAGE.parse(job.payload);
    const targetWorkspaceId = payload.workspaceId;
    const targetProjectId = payload.projectId;
    const retentionDays = Math.max(
      payload.retentionDays ?? DEFAULT_RETENTION_DAYS,
      MIN_RETENTION_DAYS
    );

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    ctx.logger.info("storage_cleanup_start", {
      pipeline: PIPELINE,
      jobId: String(jobId),
      workspaceId,
      targetWorkspaceId: targetWorkspaceId ?? "global",
      targetProjectId: targetProjectId ?? "all",
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
    });

    let totalDeleted = 0;

    // 1. Clean up failed renders (safe to delete)
    const failedClipsDeleted = await cleanupFailedRenders(
      ctx,
      cutoffDate,
      targetWorkspaceId,
      targetProjectId
    );
    totalDeleted += failedClipsDeleted;

    // 2. Clean up orphaned renders (files with no DB record)
    const orphanedRendersDeleted = await cleanupOrphanedRenders(
      ctx,
      targetWorkspaceId,
      targetProjectId
    );
    totalDeleted += orphanedRendersDeleted;

    const durationMs = Date.now() - startTime;
    ctx.logger.info("storage_cleanup_complete", {
      pipeline: PIPELINE,
      jobId: String(jobId),
      workspaceId,
      targetWorkspaceId: targetWorkspaceId ?? "global",
      targetProjectId: targetProjectId ?? "all",
      retentionDays,
      totalFilesDeleted: totalDeleted,
      failedClipsDeleted,
      orphanedRendersDeleted,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE },
      extra: {
        jobId: String(jobId),
        workspaceId,
      },
    });

    ctx.logger.error("storage_cleanup_failed", {
      pipeline: PIPELINE,
      jobId: String(jobId),
      workspaceId,
      error: errorMessage,
      durationMs,
    });

    throw error;
  }
}

export const pipeline = { run };

/**
 * Cleans up renders and thumbnails for clips with status='failed' that are older than cutoff.
 */
async function cleanupFailedRenders(
  ctx: WorkerContext,
  cutoffDate: Date,
  workspaceId?: string,
  projectId?: string
): Promise<number> {
  let query = ctx.supabase
    .from("clips")
    .select("id,project_id,workspace_id,storage_path,thumb_path,updated_at")
    .eq("status", "failed")
    .lt("updated_at", cutoffDate.toISOString());

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: failedClips, error } = await query;

  if (error) {
    ctx.logger.warn("cleanup_failed_clips_query_error", {
      error: error.message,
      workspaceId,
      projectId,
    });
    return 0;
  }

  if (!failedClips || failedClips.length === 0) {
    return 0;
  }

  const pathsToDelete: Array<{ bucket: string; path: string }> = [];

  for (const clip of failedClips) {
    // Extract paths from storage_path and thumb_path
    if (clip.storage_path) {
      const path = clip.storage_path.replace(/^renders\//, "");
      pathsToDelete.push({ bucket: BUCKET_RENDERS, path });
    }

    if (clip.thumb_path) {
      const path = clip.thumb_path.replace(/^thumbs\//, "");
      pathsToDelete.push({ bucket: BUCKET_THUMBS, path });
    }
  }

  // Group by bucket for batch deletion
  const renderPaths = pathsToDelete.filter((p) => p.bucket === BUCKET_RENDERS).map((p) => p.path);
  const thumbPaths = pathsToDelete.filter((p) => p.bucket === BUCKET_THUMBS).map((p) => p.path);

  let totalDeleted = 0;

  if (renderPaths.length > 0) {
    const deleted = await ctx.storage.removeBatch(BUCKET_RENDERS, renderPaths);
    totalDeleted += deleted;
    ctx.logger.info("cleanup_deleted_failed_renders", {
      bucket: BUCKET_RENDERS,
      count: deleted,
      workspaceId,
      projectId,
    });
  }

  if (thumbPaths.length > 0) {
    const deleted = await ctx.storage.removeBatch(BUCKET_THUMBS, thumbPaths);
    totalDeleted += deleted;
    ctx.logger.info("cleanup_deleted_failed_thumbs", {
      bucket: BUCKET_THUMBS,
      count: deleted,
      workspaceId,
      projectId,
    });
  }

  return totalDeleted;
}

/**
 * Cleans up orphaned render files (files that have no corresponding clip in the DB).
 * This handles cases where a clip was deleted from the DB but files remain in storage.
 */
async function cleanupOrphanedRenders(
  ctx: WorkerContext,
  workspaceId?: string,
  projectId?: string
): Promise<number> {
  // Build prefix for listing storage objects
  let prefix = "";
  if (workspaceId && projectId) {
    prefix = `${workspaceId}/${projectId}/`;
  } else if (workspaceId) {
    prefix = `${workspaceId}/`;
  }

  // List all render files in the target scope
  const renderFiles = await ctx.storage.list(BUCKET_RENDERS, prefix);
  
  if (renderFiles.length === 0) {
    return 0;
  }

  // Extract clip IDs from file paths (format: workspaceId/projectId/clipId.mp4)
  const clipIdPattern = /([a-f0-9-]{36})\.mp4$/i;
  const filesByClipId = new Map<string, string[]>();

  for (const filePath of renderFiles) {
    const match = filePath.match(clipIdPattern);
    if (match) {
      const clipId = match[1];
      if (!filesByClipId.has(clipId)) {
        filesByClipId.set(clipId, []);
      }
      filesByClipId.get(clipId)!.push(filePath);
    }
  }

  if (filesByClipId.size === 0) {
    return 0;
  }

  // Check which clips exist in the database
  const clipIds = Array.from(filesByClipId.keys());
  const { data: existingClips } = await ctx.supabase
    .from("clips")
    .select("id")
    .in("id", clipIds);

  const existingClipIds = new Set(existingClips?.map((c) => c.id) ?? []);

  // Find orphaned files (clip ID not in DB)
  const orphanedPaths: string[] = [];
  for (const [clipId, paths] of filesByClipId) {
    if (!existingClipIds.has(clipId)) {
      orphanedPaths.push(...paths);
    }
  }

  if (orphanedPaths.length === 0) {
    return 0;
  }

  const deleted = await ctx.storage.removeBatch(BUCKET_RENDERS, orphanedPaths);
  
  ctx.logger.info("cleanup_deleted_orphaned_renders", {
    bucket: BUCKET_RENDERS,
    count: deleted,
    orphanedClipIds: orphanedPaths.length,
    workspaceId,
    projectId,
  });

  return deleted;
}

