import { PUBLISH_YOUTUBE } from "@cliply/shared/schemas/jobs";
import { getFreshYouTubeAccessToken } from "@cliply/shared/services/youtubeAuth";
import type { Job, WorkerContext } from "./types";
import { YouTubeClient } from "../services/youtube/client";
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
import { isStageAtLeast } from "@cliply/shared/engine/pipelineStages";
import { cleanupTempFileSafe } from "../lib/tempCleanup";

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
  let tempPath: string | null = null;

  try {
    const payload = PUBLISH_YOUTUBE.parse(job.payload);
    const workspaceId = job.workspaceId;

    const clip = await fetchClip(ctx, payload.clipId);
    if (!clip) {
      throw new Error(`clip not found: ${payload.clipId}`);
    }

    if (clip.status !== "ready" || !clip.storage_path) {
      throw new Error(`clip not ready for publish: ${payload.clipId}`);
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
        clipId: payload.clipId,
        workspaceId,
        projectId: clip.project_id,
        stage: 'PUBLISHED',
        currentStage: projectStage,
        reason: 'project_already_published',
      });
      return;
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

    // Load posting history for anti-spam guard
    const postingHistory = await fetchPostingHistory(ctx, workspaceId, payload.connectedAccountId, 'youtube_shorts');
    
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
        platform: 'youtube_shorts',
        accountId: payload.connectedAccountId,
      });

      ctx.logger.info('posting_guard_checked', {
        pipeline: PIPELINE,
        clipId: payload.clipId,
        workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'youtube_shorts',
        planName,
        historyCount: postingHistory.length,
        limits: postingLimits,
      });
    } catch (error) {
      if (error instanceof PostingLimitExceededError) {
        ctx.logger.warn('posting_guard_limit_exceeded', {
          pipeline: PIPELINE,
          clipId: payload.clipId,
          workspaceId,
          accountId: payload.connectedAccountId,
          platform: 'youtube_shorts',
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
        clipId: payload.clipId,
        workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'youtube_shorts',
        metric: 'posts',
        amount: 1,
      });
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        ctx.logger.warn('posting_usage_limit_exceeded', {
          pipeline: PIPELINE,
          clipId: payload.clipId,
          workspaceId,
          accountId: payload.connectedAccountId,
          platform: 'youtube_shorts',
          metric: error.metric,
          used: error.used,
          limit: error.limit,
        });
        // Re-throw so surface code can handle it appropriately
        throw error;
      }
      throw error;
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

    // Record posts usage after successful publish
    try {
      await recordUsage({
        workspaceId: job.workspaceId,
        metric: 'posts',
        amount: 1,
        at: now,
      });
      
      ctx.logger.info('posting_usage_recorded', {
        pipeline: PIPELINE,
        clipId: payload.clipId,
        workspaceId: job.workspaceId,
        accountId: payload.connectedAccountId,
        platform: 'youtube_shorts',
        metric: 'posts',
        amount: 1,
      });
    } catch (error) {
      // Log but don't fail the publish if usage recording fails
      ctx.logger.warn("posting_usage_record_failed", {
        pipeline: PIPELINE,
        clipId: payload.clipId,
        workspaceId: job.workspaceId,
        error: (error as Error)?.message ?? String(error),
      });
    }

    // Advance project pipeline stage to PUBLISHED after successful publish
    // Only advance if not already at PUBLISHED (atomic conditional update)
    if (!isStageAtLeast(projectStage, 'PUBLISHED')) {
      const { data: updatedProject, error: stageError } = await ctx.supabase
        .from('projects')
        .update({ pipeline_stage: 'PUBLISHED' })
        .eq('id', clip.project_id)
        // Conditional update: only if stage is not already PUBLISHED
        .neq('pipeline_stage', 'PUBLISHED')
        .select('id, pipeline_stage')
        .maybeSingle();

      if (stageError) {
        ctx.logger.warn('publish_youtube_stage_advancement_failed', {
          pipeline: PIPELINE,
          clipId: payload.clipId,
          workspaceId: job.workspaceId,
          projectId: clip.project_id,
          error: stageError.message,
        });
        // Don't fail the publish - stage advancement is best-effort
      } else if (updatedProject) {
        // Only log if we actually updated (not already PUBLISHED)
        ctx.logger.info('pipeline_stage_advanced', {
          pipeline: PIPELINE,
          clipId: payload.clipId,
          workspaceId: job.workspaceId,
          projectId: clip.project_id,
          from: projectStage ?? 'RENDERED',
          to: 'PUBLISHED',
        });
      }
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
export function pipelinePublishYouTubeStub(): "publish" {
  return "publish";
}
