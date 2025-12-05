import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanName } from "../types/auth";

export type ResolvedPlan = {
  planId: PlanName;
  status: "free" | "trialing" | "active" | "canceled" | "past_due" | "incomplete";
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
};

/**
 * Resolves the effective plan for a workspace by looking up active subscriptions.
 * Returns the plan from the most recent active or trialing subscription, or "free" if none exists.
 *
 * This is the single source of truth for plan resolution used by withPlanGate and other gating logic.
 */
export async function resolveWorkspacePlan(
  workspaceId: string,
  ctx: { supabase: SupabaseClient },
): Promise<ResolvedPlan> {
  // Query subscriptions table for the workspace
  // Prioritize active/trialing subscriptions, ordered by current_period_end (most recent first)
  const { data: subscription, error } = await ctx.supabase
    .from("subscriptions")
    .select("plan_name, status, current_period_end, stripe_subscription_id")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "trialing"])
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Log error but return default plan rather than throwing
    // This ensures plan gating doesn't break if there's a transient DB issue
    console.error(`Failed to resolve workspace plan for ${workspaceId}:`, error);
    return {
      planId: "basic",
      status: "free",
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
    };
  }

  // If we have an active or trialing subscription, use it
  if (subscription) {
    const planName = subscription.plan_name as PlanName;
    const status = mapSubscriptionStatusToResolvedStatus(subscription.status);

    return {
      planId: planName === "basic" || planName === "pro" || planName === "premium" ? planName : "basic",
      status,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end) : null,
      stripeSubscriptionId: subscription.stripe_subscription_id ?? null,
    };
  }

  // No active subscription found - return free plan
  return {
    planId: "basic",
    status: "free",
    currentPeriodEnd: null,
    stripeSubscriptionId: null,
  };
}

/**
 * Maps subscription status from database to ResolvedPlan status.
 */
function mapSubscriptionStatusToResolvedStatus(
  status: string,
): ResolvedPlan["status"] {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "canceled":
      return "canceled";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    default:
      return "free";
  }
}

