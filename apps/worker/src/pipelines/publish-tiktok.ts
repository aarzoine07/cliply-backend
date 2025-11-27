import { PUBLISH_TIKTOK } from "@cliply/shared/schemas/jobs";
import { getFreshTikTokAccessToken } from "@cliply/shared/services/tiktokAuth";
import type { ConnectedAccountRow } from "@cliply/shared/db/connected-account";
import type { Job, WorkerContext } from "./types";
import { TikTokClient, TikTokApiError } from "../services/tiktok/client";
import * as variantPostsService from "../services/viral/variantPosts";

const PIPELINE = "PUBLISH_TIKTOK";

interface ClipRow {
  id: string;
  project_id: string;
  workspace_id: string;
  status: string;
  storage_path?: string | null;
  external_id?: string | null;
  caption_suggestion?: string | null;
}

export async function run(job: Job<unknown>, ctx: WorkerContext): Promise<void> {
  const startTime = Date.now();
  const jobId = job.id;
  const workspaceId = job.workspaceId;

  try {
    const payload = PUBLISH_TIKTOK.parse(job.payload);

    // Log pipeline start
    ctx.logger.info("publish_tiktok_start", {
      pipeline: PIPELINE,
      job_kind: PIPELINE,
      jobId,
      workspaceId,
      clipId: payload.clipId,
      connectedAccountId: payload.connectedAccountId,
    });

    const clip = await fetchClip(ctx, payload.clipId);
    if (!clip) {
      throw new Error(`clip not found: ${payload.clipId}`);
    }

    if (clip.status !== "ready" || !clip.storage_path) {
      throw new Error(`clip not ready for publish: ${payload.clipId} (status: ${clip.status}, storage_path: ${clip.storage_path ? "present" : "missing"})`);
    }

    // Check idempotency: check variant_posts for this account + clip + platform
    // This works for both experiment and non-experiment posts
    const { data: existingPost } = await ctx.supabase
      .from("variant_posts")
      .select("id, status, platform_post_id")
      .eq("clip_id", payload.clipId)
      .eq("connected_account_id", payload.connectedAccountId)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (existingPost && existingPost.status === "posted" && existingPost.platform_post_id) {
      ctx.logger.info("publish_tiktok_already_posted", {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        connectedAccountId: payload.connectedAccountId,
        variantPostId: existingPost.id,
        platformPostId: existingPost.platform_post_id,
      });
      return;
    }

    // Also check legacy external_id for non-experiment posts (backward compatibility)
    if (!payload.experimentId && clip.external_id) {
      ctx.logger.info("publish_tiktok_already_posted_legacy", {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        externalId: clip.external_id,
      });
      return;
    }

    // Fetch connected account
    const account = await fetchConnectedAccount(ctx, payload.connectedAccountId, workspaceId);
    if (!account) {
      throw new Error(`TikTok connected account not found: ${payload.connectedAccountId}`);
    }

    if (account.platform !== "tiktok") {
      throw new Error(`Connected account is not TikTok: ${payload.connectedAccountId} (platform: ${account.platform})`);
    }

    if (account.status !== "active" && account.status !== null) {
      throw new Error(`TikTok connected account is not active: ${payload.connectedAccountId} (status: ${account.status})`);
    }

    // Download clip from storage
    const storagePath = clip.storage_path.replace(/^renders\//, "");
    const tempPath = await ctx.storage.download("renders", storagePath, storagePath.split("/").pop() ?? "video.mp4");

    // Get fresh access token (refreshes if needed)
    let accessToken: string;
    try {
      accessToken = await getFreshTikTokAccessToken(payload.connectedAccountId, { supabase: ctx.supabase });
    } catch (error) {
      ctx.logger.error("publish_tiktok_token_fetch_failed", {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        connectedAccountId: payload.connectedAccountId,
        error: (error as Error)?.message ?? String(error),
      });
      throw new Error(`Failed to get TikTok access token: ${(error as Error)?.message ?? "unknown"}`);
    }

    // Upload to TikTok
    const tiktok = new TikTokClient({ accessToken });
    const caption = payload.caption || clip.caption_suggestion || "";
    
    let response: { videoId: string; rawResponse: unknown };
    try {
      response = await tiktok.uploadVideo({
        filePath: tempPath,
        caption,
        privacyLevel: payload.privacyLevel || "PUBLIC_TO_EVERYONE",
      });
    } catch (error) {
      // Handle TikTokApiError with proper logging and error mapping
      if (error instanceof TikTokApiError) {
        ctx.logger.error("publish_tiktok_api_error", {
          pipeline: PIPELINE,
          job_kind: PIPELINE,
          jobId,
          workspaceId,
          clipId: payload.clipId,
          connectedAccountId: payload.connectedAccountId,
          tiktokStatus: error.status,
          tiktokErrorCode: error.tiktokErrorCode,
          tiktokErrorMessage: error.tiktokErrorMessage,
          retryable: error.retryable,
          error: error.message,
        });

        // For auth errors, throw a clear non-retryable error
        if (error.status === 401 || error.status === 403) {
          throw new Error(
            `TikTok authentication failed (${error.status}): ${error.tiktokErrorMessage || error.message}. Please reconnect your TikTok account.`,
          );
        }

        // For rate limits and transient errors, rethrow as-is so job system can retry
        if (error.retryable) {
          throw error;
        }

        // For other errors, wrap in a clear error message
        throw new Error(
          `TikTok API error (${error.status}): ${error.tiktokErrorMessage || error.message}`,
        );
      }

      // For non-TikTokApiError errors, rethrow as-is
      throw error;
    }

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
    try {
      await variantPostsService.updateVariantPostAfterPublish(
        {
          clipId: payload.clipId,
          workspaceId,
          platformPostId: response.videoId,
          platform: "tiktok",
          connectedAccountId: payload.connectedAccountId,
        },
        { supabase: ctx.supabase },
      );
    } catch (error) {
      // Log but don't fail the publish if variant_post update fails
      ctx.logger.warn("publish_tiktok_variant_post_update_failed", {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        connectedAccountId: payload.connectedAccountId,
        videoId: response.videoId,
        error: (error as Error)?.message ?? String(error),
      });
    }

    const durationMs = Date.now() - startTime;
    ctx.logger.info("publish_tiktok_completed", {
      pipeline: PIPELINE,
      job_kind: PIPELINE,
      jobId,
      workspaceId,
      clipId: payload.clipId,
      videoId: response.videoId,
      connectedAccountId: payload.connectedAccountId,
      durationMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTikTokApiError = error instanceof TikTokApiError;

    ctx.sentry.captureException(error, {
      tags: { pipeline: PIPELINE },
      extra: {
        jobId: String(jobId),
        workspaceId,
        tiktokError: isTikTokApiError,
        retryable: isTikTokApiError ? error.retryable : undefined,
      },
    });

    ctx.logger.error("publish_tiktok_failed", {
      pipeline: PIPELINE,
      job_kind: PIPELINE,
      jobId,
      workspaceId,
      error: errorMessage,
      durationMs,
      ...(isTikTokApiError
        ? {
            tiktokStatus: error.status,
            tiktokErrorCode: error.tiktokErrorCode,
            tiktokErrorMessage: error.tiktokErrorMessage,
            retryable: error.retryable,
          }
        : {}),
    });

    throw error;
  }
}

export const pipeline = { run };

async function fetchClip(ctx: WorkerContext, clipId: string): Promise<ClipRow | null> {
  const response = await ctx.supabase
    .from("clips")
    .select("id,project_id,workspace_id,status,storage_path,external_id,caption_suggestion")
    .eq("id", clipId);
  const rows = response.data as ClipRow[] | null;
  return rows?.[0] ?? null;
}

async function fetchConnectedAccount(
  ctx: WorkerContext,
  accountId: string,
  workspaceId: string,
): Promise<ConnectedAccountRow | null> {
  const response = await ctx.supabase
    .from("connected_accounts")
    .select("id,workspace_id,platform,status")
    .eq("id", accountId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return response.data as ConnectedAccountRow | null;
}

// Backwards compatibility for legacy imports.
export function pipelinePublishTikTokStub(): "publish" {
  return "publish";
}

