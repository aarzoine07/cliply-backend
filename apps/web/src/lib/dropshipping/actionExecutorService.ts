import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type DropshippingActionDto,
  type ExecuteDropshippingActionInput,
  ExecuteDropshippingActionInput as ExecuteDropshippingActionInputSchema,
  DropshippingActionDto as DropshippingActionDtoSchema,
} from "@cliply/shared/schemas/dropshipping";

import { HttpError } from "../errors";
import { logger } from "../logger";

/**
 * Map action row to DTO
 */
function mapActionToDto(action: any): DropshippingActionDto | null {
  try {
    const dto = DropshippingActionDtoSchema.parse({
      id: action.id,
      workspaceId: action.workspace_id,
      productId: action.product_id,
      clipId: action.clip_id,
      variantPostId: action.variant_post_id,
      actionType: action.action_type,
      status: action.status,
      reasons: action.reasons || [],
      plannedCreative: action.planned_creative || {},
      createdAt: action.created_at,
      executedAt: action.executed_at,
      skippedAt: action.skipped_at,
    });
    return dto;
  } catch (error) {
    logger.warn("action_executor_map_dto_failed", {
      actionId: action.id,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Execute a dropshipping action
 */
export async function executeDropshippingAction(
  workspaceId: string,
  actionId: string,
  input: ExecuteDropshippingActionInput,
  ctx: { supabase: SupabaseClient },
): Promise<DropshippingActionDto> {
  const parsed = ExecuteDropshippingActionInputSchema.parse(input);

  // Load action
  const { data: action, error: actionError } = await ctx.supabase
    .from("dropshipping_actions")
    .select("*")
    .eq("id", actionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (actionError) {
    logger.error("action_executor_load_failed", {
      workspaceId,
      actionId,
      error: actionError.message,
    });
    throw new Error(`Failed to load action: ${actionError.message}`);
  }

  if (!action) {
    throw new HttpError(404, "Action not found", undefined, "not_found");
  }

  // Validate action state
  if (action.status !== "planned") {
    throw new HttpError(409, "Action already executed or skipped", "action_already_processed");
  }

  if (action.action_type !== "repost") {
    throw new HttpError(400, `Unsupported action type: ${action.action_type}`, "unsupported_action_type");
  }

  if (!action.variant_post_id) {
    throw new HttpError(400, "Action missing variant_post_id", "missing_variant_post");
  }

  // Load variant_post
  const { data: variantPost, error: variantPostError } = await ctx.supabase
    .from("variant_posts")
    .select(`
      id,
      clip_id,
      connected_account_id,
      platform,
      variant_id,
      experiment_variants!inner(
        experiment_id
      )
    `)
    .eq("id", action.variant_post_id)
    .maybeSingle();

  if (variantPostError) {
    logger.error("action_executor_variant_post_load_failed", {
      workspaceId,
      actionId,
      variantPostId: action.variant_post_id,
      error: variantPostError.message,
    });
    throw new Error(`Failed to load variant post: ${variantPostError.message}`);
  }

  if (!variantPost) {
    throw new HttpError(404, "Variant post not found", "variant_post_not_found");
  }

  const platform = variantPost.platform;
  const clipId = variantPost.clip_id;
  const connectedAccountId = variantPost.connected_account_id;
  const variant = variantPost.experiment_variants as any;
  const experimentId = variant?.experiment_id;
  const variantId = variantPost.variant_id;

  // Validate platform
  if (platform !== "youtube_shorts" && platform !== "tiktok") {
    throw new HttpError(400, `Unsupported platform for action: ${platform}`, "unsupported_platform");
  }

  // Load clip to verify it's ready
  const { data: clip, error: clipError } = await ctx.supabase
    .from("clips")
    .select("id, workspace_id, status, storage_path")
    .eq("id", clipId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (clipError) {
    logger.error("action_executor_clip_load_failed", {
      workspaceId,
      actionId,
      clipId,
      error: clipError.message,
    });
    throw new Error(`Failed to load clip: ${clipError.message}`);
  }

  if (!clip) {
    throw new HttpError(404, "Clip not found", "clip_not_found");
  }

  if (clip.status !== "ready") {
    throw new HttpError(400, `Clip is not ready for publishing: status=${clip.status}`, "clip_not_ready");
  }

  if (!clip.storage_path) {
    throw new HttpError(400, "Clip has no storage path", "clip_no_storage_path");
  }

  // Get planned creative
  const plannedCreative = action.planned_creative as {
    caption?: string;
    script?: string;
    hashtags?: string[];
    hook?: string;
    soundIdea?: string;
  };

  // Build job payload based on platform
  let jobKind: "PUBLISH_YOUTUBE" | "PUBLISH_TIKTOK";
  let jobPayload: Record<string, unknown>;

  if (platform === "youtube_shorts") {
    jobKind = "PUBLISH_YOUTUBE";
    // For YouTube: use hook or first part of caption as title, full caption as description
    const title = plannedCreative.hook || plannedCreative.caption?.split("\n")[0] || null;
    const description = plannedCreative.caption || null;
    const tags = plannedCreative.hashtags || [];

    jobPayload = {
      clipId,
      connectedAccountId,
      title,
      description,
      tags: tags.length > 0 ? tags : undefined,
      visibility: "public" as const,
      experimentId: experimentId || null,
      variantId: variantId || null,
    };
  } else {
    // TikTok
    jobKind = "PUBLISH_TIKTOK";
    const caption = plannedCreative.caption || null;

    jobPayload = {
      clipId,
      connectedAccountId,
      caption,
      privacyLevel: "PUBLIC_TO_EVERYONE" as const,
      experimentId: experimentId || null,
      variantId: variantId || null,
    };
  }

  // Dry run: return what would be enqueued without actually doing it
  if (parsed.dryRun) {
    logger.info("action_executor_dry_run", {
      workspaceId,
      actionId,
      platform,
      jobKind,
      jobPayload,
    });

    // Return action unchanged (still planned)
    const dto = mapActionToDto(action);
    if (!dto) {
      throw new Error("Failed to map action to DTO");
    }

    // Add debug info to plannedCreative (for dry run inspection)
    return {
      ...dto,
      plannedCreative: {
        ...dto.plannedCreative,
        rawModelOutput: {
          ...(dto.plannedCreative.rawModelOutput as Record<string, unknown> || {}),
          _dryRunJob: {
            kind: jobKind,
            payload: jobPayload,
          },
        },
      },
    };
  }

  // Enqueue publish job
  const { data: job, error: jobError } = await ctx.supabase
    .from("jobs")
    .insert({
      workspace_id: workspaceId,
      kind: jobKind,
      status: "queued",
      payload: jobPayload,
    })
    .select()
    .single();

  if (jobError) {
    logger.error("action_executor_job_enqueue_failed", {
      workspaceId,
      actionId,
      platform,
      error: jobError.message,
    });
    throw new Error(`Failed to enqueue publish job: ${jobError.message}`);
  }

  if (!job) {
    throw new Error("Failed to enqueue publish job: no job returned");
  }

  // Update action status to executed
  const { data: updatedAction, error: updateError } = await ctx.supabase
    .from("dropshipping_actions")
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
    })
    .eq("id", actionId)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (updateError) {
    logger.error("action_executor_update_failed", {
      workspaceId,
      actionId,
      error: updateError.message,
    });
    // Job was enqueued but action update failed - log but don't fail the request
    // The action can be manually updated later if needed
    logger.warn("action_executor_update_failed_after_job_enqueued", {
      workspaceId,
      actionId,
      jobId: job.id,
    });
  }

  const finalAction = updatedAction || action;
  const dto = mapActionToDto(finalAction);
  if (!dto) {
    throw new Error("Failed to map updated action to DTO");
  }

  logger.info("action_executor_executed", {
    workspaceId,
    actionId,
    platform,
    jobId: job.id,
    jobKind,
  });

  return dto;
}

