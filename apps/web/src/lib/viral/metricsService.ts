import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type RecordMetricsInput,
  RecordMetricsInput as RecordMetricsInputSchema,
} from "@cliply/shared/schemas/viral";

import { logger } from "../logger";

/**
 * Record metrics snapshot for a variant post
 */
export async function recordVariantMetrics(
  input: RecordMetricsInput,
  ctx: { workspaceId: string; supabase: SupabaseClient },
): Promise<void> {
  const parsed = RecordMetricsInputSchema.parse(input);

  // Verify variant_post belongs to workspace
  const { data: variantPost, error: postError } = await ctx.supabase
    .from("variant_posts")
    .select(`
      id,
      variant_id,
      experiment_variants!inner(
        experiment_id,
        experiments!inner(
          workspace_id
        )
      )
    `)
    .eq("id", parsed.variant_post_id)
    .single();

  if (postError || !variantPost) {
    logger.warn("metrics_record_post_not_found", {
      workspaceId: ctx.workspaceId,
      variantPostId: parsed.variant_post_id,
      error: postError?.message,
    });
    throw new Error("Variant post not found");
  }

  // Type assertion for nested structure
  const experiment = (variantPost as any).experiment_variants?.experiments;
  if (!experiment || experiment.workspace_id !== ctx.workspaceId) {
    logger.warn("metrics_record_workspace_mismatch", {
      workspaceId: ctx.workspaceId,
      variantPostId: parsed.variant_post_id,
    });
    throw new Error("Variant post does not belong to workspace");
  }

  // Build metrics object (only include provided fields)
  const metricsData: Record<string, unknown> = {
    variant_post_id: parsed.variant_post_id,
    snapshot_at: new Date().toISOString(),
  };

  if (parsed.views !== undefined) metricsData.views = parsed.views;
  if (parsed.likes !== undefined) metricsData.likes = parsed.likes;
  if (parsed.comments !== undefined) metricsData.comments = parsed.comments;
  if (parsed.shares !== undefined) metricsData.shares = parsed.shares;
  if (parsed.watch_time_seconds !== undefined) metricsData.watch_time_seconds = parsed.watch_time_seconds;
  if (parsed.ctr !== undefined) metricsData.ctr = parsed.ctr;

  // Set defaults for missing fields
  if (!metricsData.views) metricsData.views = 0;
  if (!metricsData.likes) metricsData.likes = 0;
  if (!metricsData.comments) metricsData.comments = 0;
  if (!metricsData.shares) metricsData.shares = 0;
  if (!metricsData.watch_time_seconds) metricsData.watch_time_seconds = 0;

  const { error: metricsError } = await ctx.supabase
    .from("variant_metrics")
    .insert(metricsData);

  if (metricsError) {
    logger.error("metrics_record_failed", {
      workspaceId: ctx.workspaceId,
      variantPostId: parsed.variant_post_id,
      error: metricsError.message,
    });
    throw new Error(`Failed to record metrics: ${metricsError.message}`);
  }

  logger.info("metrics_recorded", {
    workspaceId: ctx.workspaceId,
    variantPostId: parsed.variant_post_id,
  });
}

/**
 * Create a variant_post when a clip is posted to a connected account
 * This is a helper for light integration with existing posting flows
 */
export async function createVariantPost(
  input: {
    variantId: string;
    clipId: string;
    connectedAccountId: string;
    platform: "tiktok" | "youtube_shorts" | "instagram_reels";
  },
  ctx: { workspaceId: string; supabase: SupabaseClient },
): Promise<string> {
  // Verify variant belongs to workspace
  const { data: variant, error: variantError } = await ctx.supabase
    .from("experiment_variants")
    .select(`
      id,
      experiment_id,
      experiments!inner(
        workspace_id
      )
    `)
    .eq("id", input.variantId)
    .single();

  if (variantError || !variant) {
    logger.warn("variant_post_create_variant_not_found", {
      workspaceId: ctx.workspaceId,
      variantId: input.variantId,
      error: variantError?.message,
    });
    throw new Error("Variant not found");
  }

  const experiment = (variant as any).experiments;
  if (!experiment || experiment.workspace_id !== ctx.workspaceId) {
    throw new Error("Variant does not belong to workspace");
  }

  // Verify clip belongs to workspace
  const { data: clip, error: clipError } = await ctx.supabase
    .from("clips")
    .select("id, workspace_id")
    .eq("id", input.clipId)
    .eq("workspace_id", ctx.workspaceId)
    .single();

  if (clipError || !clip) {
    logger.warn("variant_post_create_clip_not_found", {
      workspaceId: ctx.workspaceId,
      clipId: input.clipId,
      error: clipError?.message,
    });
    throw new Error("Clip not found or does not belong to workspace");
  }

  // Verify connected account belongs to workspace
  const { data: account, error: accountError } = await ctx.supabase
    .from("connected_accounts")
    .select("id, workspace_id")
    .eq("id", input.connectedAccountId)
    .eq("workspace_id", ctx.workspaceId)
    .single();

  if (accountError || !account) {
    logger.warn("variant_post_create_account_not_found", {
      workspaceId: ctx.workspaceId,
      connectedAccountId: input.connectedAccountId,
      error: accountError?.message,
    });
    throw new Error("Connected account not found or does not belong to workspace");
  }

  // Create variant_post
  const { data: variantPost, error: postError } = await ctx.supabase
    .from("variant_posts")
    .insert({
      variant_id: input.variantId,
      clip_id: input.clipId,
      connected_account_id: input.connectedAccountId,
      platform: input.platform,
      status: "pending",
    })
    .select()
    .single();

  if (postError || !variantPost) {
    logger.error("variant_post_create_failed", {
      workspaceId: ctx.workspaceId,
      variantId: input.variantId,
      clipId: input.clipId,
      error: postError?.message,
    });
    throw new Error(`Failed to create variant post: ${postError?.message ?? "unknown"}`);
  }

  logger.info("variant_post_created", {
    workspaceId: ctx.workspaceId,
    variantPostId: variantPost.id,
    variantId: input.variantId,
    clipId: input.clipId,
    platform: input.platform,
  });

  return variantPost.id;
}

