// D1: Workspace plan service - manages workspace plan and billing status
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingStatus } from "@cliply/shared/billing/status";
import type { PlanName } from "@cliply/shared/types/auth";
import { logger } from "../logger";

/**
 * Get workspace plan from workspaces table
 */
export async function getWorkspacePlan(
  workspaceId: string,
  ctx: { supabase: SupabaseClient },
): Promise<PlanName> {
  const { data: workspace, error } = await ctx.supabase
    .from("workspaces")
    .select("plan")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("workspace_plan_get_failed", {
      workspaceId,
      error: error.message,
    });
    throw new Error(`Failed to get workspace plan: ${error.message}`);
  }

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const plan = workspace.plan;
  if (plan === "basic" || plan === "pro" || plan === "premium") {
    return plan;
  }

  // Default to basic if invalid plan
  logger.warn("workspace_plan_invalid", {
    workspaceId,
    plan,
  });
  return "basic";
}

/**
 * Set workspace plan and optionally billing status
 */
export async function setWorkspacePlan(
  workspaceId: string,
  plan: PlanName,
  ctx: { supabase: SupabaseClient },
  options?: {
    billingStatus?: BillingStatus;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  },
): Promise<void> {
  const updateData: Record<string, unknown> = {
    plan,
    updated_at: new Date().toISOString(),
  };

  if (options?.billingStatus !== undefined) {
    updateData.billing_status = options.billingStatus;
  }

  if (options?.stripeCustomerId !== undefined) {
    updateData.stripe_customer_id = options.stripeCustomerId;
  }

  if (options?.stripeSubscriptionId !== undefined) {
    updateData.stripe_subscription_id = options.stripeSubscriptionId;
  }

  const { error } = await ctx.supabase
    .from("workspaces")
    .update(updateData)
    .eq("id", workspaceId);

  if (error) {
    logger.error("workspace_plan_set_failed", {
      workspaceId,
      plan,
      error: error.message,
    });
    throw new Error(`Failed to set workspace plan: ${error.message}`);
  }

  logger.info("workspace_plan_updated", {
    workspaceId,
    plan,
    billingStatus: options?.billingStatus,
  });
}

