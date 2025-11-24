import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type DropshippingActionDto,
  type ViralPlanQuery,
  type UnderperformingPostDto,
  ViralPlanQuery as ViralPlanQuerySchema,
  DropshippingActionDto as DropshippingActionDtoSchema,
} from "@cliply/shared/schemas/dropshipping";
import { type DropshippingCreativeInput } from "@cliply/shared/schemas/dropshippingCreative";

import { logger } from "../logger";
import * as productService from "./productService";
import * as analyticsService from "./analyticsService";
import * as creativeService from "./creativeService";

/**
 * Derive angle override from underperformer reasons
 */
function deriveAngleOverride(reasons: UnderperformingPostDto["reason"]): string | undefined {
  if (reasons.includes("low_ctr")) {
    return "test a much stronger hook and clearer benefit";
  }
  if (reasons.includes("low_watch_time")) {
    return "front-load the benefit and shorten the script";
  }
  if (reasons.includes("below_product_median")) {
    return "try a different angle that stands out from the average";
  }
  return undefined;
}

/**
 * Plan reposts for underperforming posts
 */
export async function planRepostsForUnderperformers(
  workspaceId: string,
  productId: string,
  query: ViralPlanQuery,
  ctx: { supabase: SupabaseClient },
): Promise<DropshippingActionDto[]> {
  const parsed = ViralPlanQuerySchema.parse(query);

  // Verify product belongs to workspace
  const product = await productService.getProductById(workspaceId, productId, ctx);
  if (!product) {
    throw new Error("Product not found or does not belong to workspace");
  }

  // Get underperforming posts
  const underperformers = await analyticsService.getUnderperformingPostsForProduct(
    workspaceId,
    productId,
    {
      window: parsed.window,
      minViews: parsed.minViews,
      maxCtr: parsed.maxCtr,
    },
    ctx,
  );

  // Limit to maxActions
  const postsToProcess = underperformers.slice(0, parsed.maxActions);

  if (postsToProcess.length === 0) {
    logger.info("viral_planner_no_underperformers", {
      workspaceId,
      productId,
    });
    return [];
  }

  const actions: DropshippingActionDto[] = [];

  for (const underperformer of postsToProcess) {
    // Check if action already exists for this variant_post
    const { data: existingAction, error: checkError } = await ctx.supabase
      .from("dropshipping_actions")
      .select("*")
      .eq("variant_post_id", underperformer.variantPostId)
      .eq("status", "planned")
      .maybeSingle();

    if (checkError) {
      logger.error("viral_planner_check_existing_failed", {
        workspaceId,
        productId,
        variantPostId: underperformer.variantPostId,
        error: checkError.message,
      });
      // Continue to next post rather than failing entire operation
      continue;
    }

    // If action already exists, reuse it
    if (existingAction) {
      const mapped = mapActionToDto(existingAction);
      if (mapped) {
        actions.push(mapped);
      }
      continue;
    }

    // Derive angle override from reasons
    const angleOverride = deriveAngleOverride(underperformer.reason);

    // Generate new creative
    try {
      const creativeInput: DropshippingCreativeInput = {
        productId,
        clipId: underperformer.clipId,
        platform: underperformer.platform,
        language: "en",
        angleOverride,
      };

      const creative = await creativeService.generateCreativeForProduct(creativeInput, {
        workspaceId,
        supabase: ctx.supabase,
      });

      // Build planned creative object
      const plannedCreative = {
        caption: creative.caption,
        script: creative.script,
        hashtags: creative.hashtags,
        hook: creative.hook,
        soundIdea: creative.soundIdea,
        rawModelOutput: creative.rawModelOutput,
      };

      // Insert action
      const { data: action, error: insertError } = await ctx.supabase
        .from("dropshipping_actions")
        .insert({
          workspace_id: workspaceId,
          product_id: productId,
          clip_id: underperformer.clipId,
          variant_post_id: underperformer.variantPostId,
          action_type: "repost",
          status: "planned",
          reasons: underperformer.reason,
          planned_creative: plannedCreative,
        })
        .select()
        .single();

      if (insertError) {
        // Check for unique constraint violation (shouldn't happen due to check above, but handle gracefully)
        if (insertError.code === "23505" || insertError.message.includes("unique")) {
          logger.warn("viral_planner_duplicate_action", {
            workspaceId,
            productId,
            variantPostId: underperformer.variantPostId,
          });
          // Try to fetch the existing one
          const { data: existing } = await ctx.supabase
            .from("dropshipping_actions")
            .select("*")
            .eq("variant_post_id", underperformer.variantPostId)
            .eq("status", "planned")
            .maybeSingle();
          if (existing) {
            const mapped = mapActionToDto(existing);
            if (mapped) {
              actions.push(mapped);
            }
          }
          continue;
        }

        logger.error("viral_planner_insert_failed", {
          workspaceId,
          productId,
          variantPostId: underperformer.variantPostId,
          error: insertError.message,
        });
        // Continue to next post rather than failing entire operation
        continue;
      }

      if (!action) {
        logger.warn("viral_planner_no_action_returned", {
          workspaceId,
          productId,
          variantPostId: underperformer.variantPostId,
        });
        continue;
      }

      const mapped = mapActionToDto(action);
      if (mapped) {
        actions.push(mapped);
      }
    } catch (error) {
      logger.error("viral_planner_creative_generation_failed", {
        workspaceId,
        productId,
        variantPostId: underperformer.variantPostId,
        error: (error as Error).message,
      });
      // Continue to next post rather than failing entire operation
      continue;
    }
  }

  logger.info("viral_planner_actions_created", {
    workspaceId,
    productId,
    count: actions.length,
    requested: parsed.maxActions,
  });

  return actions;
}

/**
 * Map database action row to DTO
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
    logger.warn("viral_planner_map_dto_failed", {
      actionId: action.id,
      error: (error as Error).message,
    });
    return null;
  }
}

