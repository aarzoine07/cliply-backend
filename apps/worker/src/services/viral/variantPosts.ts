import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@cliply/shared/logging/logger";

/**
 * Update variant_posts after successful platform publish
 * Called from worker pipelines after a clip is successfully posted
 */
export async function updateVariantPostAfterPublish(
  params: {
    clipId: string;
    workspaceId: string;
    platformPostId: string;
    platform: "tiktok" | "youtube_shorts" | "instagram_reels";
    connectedAccountId?: string; // Optional: if provided, only update posts for this account
  },
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Build update query
  let query = ctx.supabase
    .from("variant_posts")
    .update({
      status: "posted",
      platform_post_id: params.platformPostId,
      posted_at: new Date().toISOString(),
    })
    .eq("clip_id", params.clipId)
    .eq("platform", params.platform)
    .in("status", ["pending"]); // Only update pending posts

  // If connectedAccountId is provided, filter by it
  if (params.connectedAccountId) {
    query = query.eq("connected_account_id", params.connectedAccountId);
  }

  const { data: updated, error } = await query.select();

  if (error) {
    logger.warn("variant_post_update_failed", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      platformPostId: params.platformPostId,
      error: error.message,
    });
    // Don't throw - log and continue (publish succeeded, variant_post update is secondary)
    return;
  }

  if (!updated || updated.length === 0) {
    // No variant_posts found - this is fine, clip might not be part of an experiment
    logger.info("variant_post_update_none_found", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      platform: params.platform,
    });
    return;
  }

  logger.info("variant_posts_updated", {
    workspaceId: params.workspaceId,
    clipId: params.clipId,
    platformPostId: params.platformPostId,
    updatedCount: updated.length,
  });
}

