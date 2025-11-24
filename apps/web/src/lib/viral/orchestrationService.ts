import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "../logger";
import * as connectedAccountsService from "../accounts/connectedAccountsService";

/**
 * Create variant_posts for a clip across multiple connected accounts
 * Supports multi-account orchestration for viral experiments
 */
export async function createVariantPostsForClip(
  params: {
    workspaceId: string;
    clipId: string;
    experimentId: string;
    variantId: string;
    platform: "tiktok" | "youtube_shorts" | "instagram_reels";
    connectedAccountIds?: string[];
  },
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Verify clip belongs to workspace and has experiment/variant
  const { data: clip, error: clipError } = await ctx.supabase
    .from("clips")
    .select("id, workspace_id, experiment_id, experiment_variant_id")
    .eq("id", params.clipId)
    .eq("workspace_id", params.workspaceId)
    .single();

  if (clipError || !clip) {
    logger.warn("orchestration_clip_not_found", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      error: clipError?.message,
    });
    throw new Error("Clip not found or does not belong to workspace");
  }

  // Verify experiment and variant match
  if (clip.experiment_id !== params.experimentId || clip.experiment_variant_id !== params.variantId) {
    logger.warn("orchestration_experiment_mismatch", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      clipExperimentId: clip.experiment_id,
      clipVariantId: clip.experiment_variant_id,
      expectedExperimentId: params.experimentId,
      expectedVariantId: params.variantId,
    });
    throw new Error("Clip experiment/variant mismatch");
  }

  // Determine which connected accounts to use via service layer
  // Map platform to provider (for now, they're the same)
  const platformMap: Record<string, "youtube" | "tiktok" | "instagram"> = {
    youtube_shorts: "youtube",
    tiktok: "tiktok",
    instagram_reels: "instagram",
  };
  const provider = platformMap[params.platform] || params.platform;

  let accounts;
  try {
    accounts = await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId: params.workspaceId,
        platform: provider,
        connectedAccountIds: params.connectedAccountIds,
      },
      ctx,
    );
  } catch (error) {
    logger.error("orchestration_accounts_fetch_failed", {
      workspaceId: params.workspaceId,
      platform: params.platform,
      error: (error as Error)?.message ?? "unknown",
    });
    throw error;
  }

  if (!accounts || accounts.length === 0) {
    logger.warn("orchestration_no_accounts", {
      workspaceId: params.workspaceId,
      platform: params.platform,
    });
    // Don't throw - just log and return (no accounts to post to)
    return;
  }

  // Accounts are already validated by getConnectedAccountsForPublish
  const accountIds = accounts.map((a) => a.id);

  // Check for existing variant_posts to avoid duplicates (idempotency)
  const { data: existing, error: existingError } = await ctx.supabase
    .from("variant_posts")
    .select("connected_account_id")
    .eq("variant_id", params.variantId)
    .eq("clip_id", params.clipId)
    .in("connected_account_id", accountIds);

  if (existingError) {
    logger.error("orchestration_check_existing_failed", {
      workspaceId: params.workspaceId,
      error: existingError.message,
    });
    throw new Error(`Failed to check existing posts: ${existingError.message}`);
  }

  const existingAccountIds = new Set(existing?.map((p) => p.connected_account_id) || []);
  const newAccountIds = accountIds.filter((id) => !existingAccountIds.has(id));

  if (newAccountIds.length === 0) {
    logger.info("orchestration_all_posts_exist", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      variantId: params.variantId,
      accountCount: accountIds.length,
    });
    return; // All variant_posts already exist
  }

  // Create variant_posts for new accounts
  const inserts = newAccountIds.map((accountId) => ({
    variant_id: params.variantId,
    clip_id: params.clipId,
    connected_account_id: accountId,
    platform: params.platform,
    status: "pending",
  }));

  const { error: insertError } = await ctx.supabase.from("variant_posts").insert(inserts);

  if (insertError) {
    logger.error("orchestration_create_posts_failed", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      variantId: params.variantId,
      error: insertError.message,
    });
    throw new Error(`Failed to create variant posts: ${insertError.message}`);
  }

  logger.info("orchestration_posts_created", {
    workspaceId: params.workspaceId,
    clipId: params.clipId,
    variantId: params.variantId,
    platform: params.platform,
    createdCount: newAccountIds.length,
    skippedCount: existingAccountIds.size,
  });
}

