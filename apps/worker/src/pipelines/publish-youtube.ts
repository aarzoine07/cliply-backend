import { PUBLISH_YOUTUBE } from "@cliply/shared/schemas/jobs";
import { getFreshYouTubeAccessToken } from "@cliply/shared/services/youtubeAuth";
import type { Job, WorkerContext } from "./types";
import { YouTubeClient } from "../services/youtube/client";
import * as variantPostsService from "../services/viral/variantPosts";

const PIPELINE = "PUBLISH_YOUTUBE";

interface ClipRow {
  id: string;
  project_id: string;
  workspace_id: string;
  status: string;
  storage_path?: string | null;
  external_id?: string | null;
}

interface ScheduleRow {
  id: string;
  clip_id: string;
  provider: string;
  status: string;
  sent_at?: string | null;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  try {
    const payload = PUBLISH_YOUTUBE.parse(job.payload);

    const clip = await fetchClip(ctx, payload.clipId);
    if (!clip) {
      throw new Error(`clip not found: ${payload.clipId}`);
    }

    if (clip.status !== "ready" || !clip.storage_path) {
      throw new Error(`clip not ready for publish: ${payload.clipId}`);
    }

    // Check if already published for this specific account (idempotency per account)
    // Note: We check variant_posts to see if this account already posted this clip
    if (payload.experimentId && payload.variantId) {
      const { data: existingPost } = await ctx.supabase
        .from("variant_posts")
        .select("id, status, platform_post_id")
        .eq("clip_id", payload.clipId)
        .eq("connected_account_id", payload.connectedAccountId)
        .eq("variant_id", payload.variantId)
        .eq("platform", "youtube_shorts")
        .maybeSingle();

      if (existingPost && existingPost.status === "posted" && existingPost.platform_post_id) {
        ctx.logger.info("publish_skip_existing_variant_post", {
          pipeline: PIPELINE,
          clipId: payload.clipId,
          connectedAccountId: payload.connectedAccountId,
          variantPostId: existingPost.id,
        });
        return;
      }
    } else if (clip.external_id) {
      // For non-experiment posts, check clip.external_id (legacy behavior)
      ctx.logger.info("publish_skip_existing", { pipeline: PIPELINE, clipId: payload.clipId });
      return;
    }

    const downloadPath = clip.storage_path.replace(/^renders\//, "");
    const tempPath = await ctx.storage.download("renders", downloadPath, downloadPath.split("/").pop() ?? "video.mp4");

    // Get fresh access token (refreshes if needed)
    let accessToken: string;
    try {
      accessToken = await getFreshYouTubeAccessToken(payload.connectedAccountId, { supabase: ctx.supabase });
    } catch (error) {
      ctx.logger.error("publish_youtube_token_fetch_failed", {
        pipeline: PIPELINE,
        clipId: payload.clipId,
        connectedAccountId: payload.connectedAccountId,
        error: (error as Error)?.message ?? String(error),
      });
      throw new Error(`Failed to get YouTube access token: ${(error as Error)?.message ?? "unknown"}`);
    }

    const youtube = new YouTubeClient({ accessToken });
    const response = await youtube.uploadShort({
      filePath: tempPath,
      title: payload.title ?? "Cliply Short",
      description: payload.description,
      tags: payload.tags,
      visibility: payload.visibility,
    });

    // Update clip status (only if not already published, or update external_id per account)
    // For multi-account, we may want to track per-account external_ids, but for now we update the clip
    if (!clip.external_id) {
      await ctx.supabase
        .from("clips")
        .update({
          status: "published",
          external_id: response.videoId,
          published_at: new Date().toISOString(),
        })
        .eq("id", payload.clipId);
    }

    // Update variant_posts after successful publish
    // TODO: B3 - Handle delete/repost flow for underperforming variants
    try {
      await variantPostsService.updateVariantPostAfterPublish(
        {
          clipId: payload.clipId,
          workspaceId: job.workspaceId,
          platformPostId: response.videoId,
          platform: "youtube_shorts",
          connectedAccountId: payload.connectedAccountId, // Now we have it in the schema
        },
        { supabase: ctx.supabase },
      );
    } catch (error) {
      // Log but don't fail the publish if variant_post update fails
      ctx.logger.warn("publish_variant_post_update_failed", {
        pipeline: PIPELINE,
        clipId: payload.clipId,
        connectedAccountId: payload.connectedAccountId,
        error: (error as Error)?.message ?? String(error),
      });
    }

    await markScheduleSent(ctx, payload.clipId);

    ctx.logger.info("pipeline_completed", {
      pipeline: PIPELINE,
      clipId: payload.clipId,
      videoId: response.videoId,
      workspaceId: job.workspaceId,
      connectedAccountId: payload.connectedAccountId,
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
    .select("id,project_id,workspace_id,status,storage_path,external_id")
    .eq("id", clipId);
  const rows = response.data as ClipRow[] | null;
  return rows?.[0] ?? null;
}

async function markScheduleSent(ctx: WorkerContext, clipId: string): Promise<void> {
  const response = await ctx.supabase
    .from("schedules")
    .select("id,status,provider")
    .eq("clip_id", clipId)
    .eq("provider", "youtube");

  const rows = response.data as ScheduleRow[] | null;
  const schedule = rows?.find((row) => row.status === "queued");
  if (!schedule) {
    return;
  }

  await ctx.supabase
    .from("schedules")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", schedule.id);
}

// Backwards compatibility for legacy imports.
export function pipelinePublishYouTubeStub(): "publish" {
  return "publish";
}
