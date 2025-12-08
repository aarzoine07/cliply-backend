import { PUBLISH_TIKTOK } from "@cliply/shared/schemas/jobs";
import { getFreshTikTokAccessToken } from "@cliply/shared/services/tiktokAuth";
import type { ConnectedAccountRow } from "@cliply/shared/db/connected-account";
import type { Job, WorkerContext } from "./types";
import { TikTokClient, TikTokApiError } from "../services/tiktok/client";
import * as variantPostsService from "../services/viral/variantPosts";
import {
  enforcePostLimits,
  getDefaultPostingLimitsForPlan,
  PostHistoryEvent,
  PostingLimitExceededError,
} from "@cliply/shared/engine/postingGuard";
import {
  assertWithinUsage,
  recordUsage,
  UsageLimitExceededError,
} from "@cliply/shared/billing/usageTracker";
import type { PlanName } from "@cliply/shared/types/auth";
import { isStageAtLeast, nextStageAfter } from "@cliply/shared/engine/pipelineStages";
import { cleanupTempFileSafe } from "../lib/tempCleanup";

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
  let tempPath: string | null = null;

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

    // Load project pipeline stage to check if already published
    const { data: projectRows } = await ctx.supabase
      .from('projects')
      .select('id,pipeline_stage')
      .eq('id', clip.project_id)
      .maybeSingle();
    const projectStage = projectRows?.pipeline_stage ?? null;

    // Skip if project is already at PUBLISHED stage (additional safeguard)
    // Note: We still check variant_posts below for per-clip+account idempotency
    if (isStageAtLeast(projectStage, 'PUBLISHED')) {
      ctx.logger.info('pipeline_stage_skipped', {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        projectId: clip.project_id,
        stage: 'PUBLISHED',
        currentStage: projectStage,
        reason: 'project_already_published',
      });
      return;
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

   // Connected accounts table has no status column.
   // Presence of the row means the Tiktokaccount is active.

    // Load posting history for anti-spam guard
    const postingHistory = await fetchPostingHistory(ctx, workspaceId, payload.connectedAccountId, 'tiktok');
    
    // Fetch workspace plan to derive posting limits
    const planName = await getWorkspacePlanForPosting(ctx, workspaceId);
    const postingLimits = getDefaultPostingLimitsForPlan(planName);

    // Enforce posting limits (anti-spam guard)
    const now = new Date();
    try {
      enforcePostLimits({
        now,
        history: postingHistory,
        limits: postingLimits,
        platform: 'tiktok',
        accountId: payload.connectedAccountId,
      });

      ctx.logger.info('posting_guard_checked', {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'tiktok',
        planName,
        historyCount: postingHistory.length,
        limits: postingLimits,
      });
    } catch (error) {
      if (error instanceof PostingLimitExceededError) {
        ctx.logger.warn('posting_guard_limit_exceeded', {
          pipeline: PIPELINE,
          job_kind: PIPELINE,
          jobId,
          workspaceId,
          accountId: payload.connectedAccountId,
          platform: 'tiktok',
          reason: error.reason,
          remainingMs: error.remainingMs,
        });
        // Re-throw so surface code can handle it appropriately
        throw error;
      }
      throw error;
    }

    // Check workspace-level posts usage (plan-based limit)
    try {
      await assertWithinUsage(workspaceId, 'posts', 1, now);
      
      ctx.logger.info('posting_usage_checked', {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'tiktok',
        metric: 'posts',
        amount: 1,
      });
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        ctx.logger.warn('posting_usage_limit_exceeded', {
          pipeline: PIPELINE,
          job_kind: PIPELINE,
          jobId,
          workspaceId,
          accountId: payload.connectedAccountId,
          platform: 'tiktok',
          metric: error.metric,
          used: error.used,
          limit: error.limit,
        });
        // Re-throw so surface code can handle it appropriately
        throw error;
      }
      throw error;
    }

    // Download clip from storage
    const storagePath = clip.storage_path.replace(/^renders\//, "");
    tempPath = await ctx.storage.download("renders", storagePath, storagePath.split("/").pop() ?? "video.mp4");

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

    // Record posts usage after successful publish
    try {
      await recordUsage({
        workspaceId,
        metric: 'posts',
        amount: 1,
        at: now,
      });
      
      ctx.logger.info('posting_usage_recorded', {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'tiktok',
        metric: 'posts',
        amount: 1,
      });
    } catch (error) {
      // Log but don't fail the publish if usage recording fails
      ctx.logger.warn("posting_usage_record_failed", {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        clipId: payload.clipId,
        error: (error as Error)?.message ?? String(error),
      });
    }

    // Advance project pipeline stage to PUBLISHED after successful publish
    // Only advance if not already at PUBLISHED
    if (!isStageAtLeast(projectStage, 'PUBLISHED')) {
      await ctx.supabase
        .from('projects')
        .update({ pipeline_stage: 'PUBLISHED' })
        .eq('id', clip.project_id);

      ctx.logger.info('pipeline_stage_advanced', {
        pipeline: PIPELINE,
        job_kind: PIPELINE,
        jobId,
        workspaceId,
        projectId: clip.project_id,
        clipId: payload.clipId,
        from: projectStage ?? 'RENDERED',
        to: 'PUBLISHED',
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
  } finally {
    // Clean up temporary downloaded file on both success and failure
    if (tempPath) {
      await cleanupTempFileSafe(tempPath, ctx.logger);
    }
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

/**
 * Fetches the workspace plan for posting guard limits.
 * Falls back to 'basic' if plan lookup fails or plan is invalid.
 */
async function getWorkspacePlanForPosting(
  ctx: WorkerContext,
  workspaceId: string,
): Promise<PlanName> {
  try {
    const { data: workspace, error } = await ctx.supabase
      .from('workspaces')
      .select('plan')
      .eq('id', workspaceId)
      .maybeSingle();

    if (error) {
      ctx.logger.warn('posting_guard_plan_lookup_failed', {
        pipeline: PIPELINE,
        workspaceId,
        error: error.message,
      });
      return 'basic';
    }

    const planName = workspace?.plan;
    if (planName === 'basic' || planName === 'pro' || planName === 'premium') {
      ctx.logger.info('posting_guard_plan_resolved', {
        pipeline: PIPELINE,
        workspaceId,
        planName,
      });
      return planName;
    }

    // Invalid or missing plan - fallback to basic
    ctx.logger.warn('posting_guard_plan_fallback', {
      pipeline: PIPELINE,
      workspaceId,
      planName: planName ?? 'null',
      reason: 'invalid_or_missing_plan',
    });
    return 'basic';
  } catch (error) {
    ctx.logger.warn('posting_guard_plan_lookup_exception', {
      pipeline: PIPELINE,
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'basic';
  }
}

async function fetchPostingHistory(
  ctx: WorkerContext,
  workspaceId: string,
  accountId: string,
  platform: string,
): Promise<PostHistoryEvent[]> {
  // Query variant_posts for recent posts by this account
  // We need to join with clips to get workspace_id since variant_posts doesn't have it directly
  const { data: rows } = await ctx.supabase
    .from("variant_posts")
    .select("clip_id, posted_at, clips!inner(workspace_id)")
    .eq("connected_account_id", accountId)
    .eq("platform", platform)
    .eq("status", "posted")
    .not("posted_at", "is", null)
    .gte("posted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
    .order("posted_at", { ascending: false });

  if (!rows || rows.length === 0) {
    return [];
  }

  // Map DB rows to PostHistoryEvent
  // Type assertion needed for Supabase join result
  return rows
    .filter((row: any) => row.posted_at && row.clips?.workspace_id === workspaceId)
    .map((row: any) => ({
      workspaceId,
      accountId,
      platform,
      clipId: row.clip_id,
      postedAt: new Date(row.posted_at),
    }));
}

// Backwards compatibility for legacy imports.
export function pipelinePublishTikTokStub(): "publish" {
  return "publish";
}

