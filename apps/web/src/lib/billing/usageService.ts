// D1: Usage & Billing Service - provides consolidated usage, plan, trial, and limit info
// This service is the single source of truth for frontend usage UX

import type { SupabaseClient } from "@supabase/supabase-js";

import { PLAN_MATRIX } from "@cliply/shared/billing/planMatrix";
import { getUsageSummary } from "@cliply/shared/billing/usageTracker";
import type { PlanName } from "@cliply/shared/types/auth";

import { logger } from "../logger";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type PlanTier = "basic" | "pro" | "premium";

export interface UsageBucket {
  used: number;
  limit: number | null; // null for "unlimited"
  remaining: number | null; // null for "unlimited"
  softLimit: boolean; // true when used >= 80% of limit
  hardLimit: boolean; // true when used >= limit
}

export interface TrialInfo {
  active: boolean;
  endsAt: string | null; // ISO string
}

export interface BillingStatusSummary {
  plan: {
    tier: PlanTier;
    billingStatus: string | null;
    trial: TrialInfo;
  };
  usage: {
    minutes: UsageBucket;
    clips: UsageBucket;
    projects: UsageBucket;
    posts: UsageBucket;
  };
}

// -----------------------------------------------------------------------------
// Plan Limits Configuration
// TODO: These values are placeholders and should be finalized based on product requirements.
// They are derived from PLAN_MATRIX but posts limits are not yet defined there.
// -----------------------------------------------------------------------------

interface PlanLimits {
  minutes: number | null;
  clips: number | null;
  projects: number | null;
  posts: number | null;
}

function getPlanLimits(tier: PlanTier): PlanLimits {
  const planDef = PLAN_MATRIX[tier];

  // Posts limits are not in PLAN_MATRIX yet - using placeholder values
  // TODO: Add posts_per_month to PLAN_MATRIX when ready
  const postsLimits: Record<PlanTier, number | null> = {
    basic: 50, // TODO: placeholder
    pro: 200, // TODO: placeholder
    premium: null, // null = unlimited
  };

  return {
    minutes: planDef?.limits.source_minutes_per_month ?? null,
    clips: planDef?.limits.clips_per_month ?? null,
    projects: planDef?.limits.projects_per_month ?? null,
    posts: postsLimits[tier],
  };
}

// -----------------------------------------------------------------------------
// Soft/Hard Limit Computation
// -----------------------------------------------------------------------------

const SOFT_LIMIT_THRESHOLD = 0.8; // 80%

function computeUsageBucket(used: number, limit: number | null): UsageBucket {
  if (limit === null) {
    // Unlimited
    return {
      used,
      limit: null,
      remaining: null,
      softLimit: false,
      hardLimit: false,
    };
  }

  const remaining = Math.max(limit - used, 0);
  const hardLimit = used >= limit;
  const softLimit = !hardLimit && used >= SOFT_LIMIT_THRESHOLD * limit;

  return {
    used,
    limit,
    remaining,
    softLimit,
    hardLimit,
  };
}

// -----------------------------------------------------------------------------
// Main Service Function
// -----------------------------------------------------------------------------

/**
 * Get comprehensive usage and billing summary for a workspace.
 * This is the single source of truth for frontend usage UX.
 *
 * @param workspaceId - The workspace UUID
 * @param admin - Supabase admin client (service role)
 * @returns BillingStatusSummary with plan info, usage buckets, and trial state
 * @throws Error if workspace is not found
 */
export async function getWorkspaceUsageSummary(
  workspaceId: string,
  admin: SupabaseClient,
): Promise<BillingStatusSummary> {
  // 1. Fetch workspace plan and billing status
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("plan, billing_status")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceError) {
    logger.error("usage_service_workspace_fetch_failed", {
      workspaceId,
      error: workspaceError.message,
    });
    throw new Error(`Failed to fetch workspace: ${workspaceError.message}`);
  }

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  // Validate and default plan tier
  const rawPlan = workspace.plan;
  const tier: PlanTier =
    rawPlan === "basic" || rawPlan === "pro" || rawPlan === "premium"
      ? rawPlan
      : "basic";

  const billingStatus = workspace.billing_status ?? null;

  // 2. Fetch usage from shared usage tracker
  const usageSummary = await getUsageSummary(workspaceId);

  const minutesUsed = usageSummary.metrics.source_minutes?.used ?? 0;
  const clipsUsed = usageSummary.metrics.clips?.used ?? 0;
  const projectsUsed = usageSummary.metrics.projects?.used ?? 0;

  // 3. Fetch posts usage
  // TODO: Integrate with posting usage helper when available.
  // Currently no posts_count column exists in workspace_usage.
  // Setting to 0 as placeholder until posting usage tracking is implemented.
  const postsUsed = 0;

  // 4. Fetch trial info from subscriptions table
  const trial = await fetchTrialInfo(workspaceId, admin);

  // 5. Get plan limits
  const limits = getPlanLimits(tier);

  // 6. Compute usage buckets with soft/hard limit flags
  const usage = {
    minutes: computeUsageBucket(minutesUsed, limits.minutes),
    clips: computeUsageBucket(clipsUsed, limits.clips),
    projects: computeUsageBucket(projectsUsed, limits.projects),
    posts: computeUsageBucket(postsUsed, limits.posts),
  };

  logger.info("usage_service_summary_fetched", {
    workspaceId,
    tier,
    billingStatus,
    trialActive: trial.active,
  });

  return {
    plan: {
      tier,
      billingStatus,
      trial,
    },
    usage,
  };
}

/**
 * Fetch trial information from subscriptions table.
 * Returns trial.active = true if subscription status is 'trialing' AND trial_end > now.
 */
async function fetchTrialInfo(
  workspaceId: string,
  admin: SupabaseClient,
): Promise<TrialInfo> {
  // TODO: If the codebase has a dedicated helper for trial resolution, use it.
  // For now, we query subscriptions directly.

  const { data: subscription, error } = await admin
    .from("subscriptions")
    .select("status, trial_end")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Non-fatal: log and return default trial info
    logger.warn("usage_service_trial_fetch_failed", {
      workspaceId,
      error: error.message,
    });
    return { active: false, endsAt: null };
  }

  if (!subscription) {
    // No subscription record - no trial
    return { active: false, endsAt: null };
  }

  const isTrialing = subscription.status === "trialing";
  const trialEndStr = subscription.trial_end as string | null;

  if (!isTrialing || !trialEndStr) {
    return { active: false, endsAt: trialEndStr ?? null };
  }

  // Check if trial is still active (trial_end > now)
  const trialEndDate = new Date(trialEndStr);
  const now = new Date();
  const active = trialEndDate > now;

  return {
    active,
    endsAt: trialEndStr,
  };
}
