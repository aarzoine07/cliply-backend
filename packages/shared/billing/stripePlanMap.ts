import type { PlanName } from "@cliply/shared/types/auth";

export type DowngradeBehavior = "grace_period" | "immediate";
export type UpgradeBehavior = "immediate" | "prorate";

export interface StripePlanConfig {
  plan: PlanName;
  trial_days: number;
  downgrade_behavior: DowngradeBehavior;
  upgrade_behavior: UpgradeBehavior;
}

/**
 * Stripe Price IDs mapped to Cliply plans.
 * These are live production Price IDs from Stripe Dashboard.
 */
export const STRIPE_PLAN_MAP: Record<string, StripePlanConfig> = {
  price_1SPAJQJ2vBRZZMLQFeAuYJK5: {
    plan: "basic",
    trial_days: 7,
    downgrade_behavior: "grace_period",
    upgrade_behavior: "immediate",
  },
  price_1SPALSJ2vBRZZMLQjM9eLBkf: {
    plan: "pro",
    trial_days: 7,
    downgrade_behavior: "grace_period",
    upgrade_behavior: "immediate",
  },
  price_1SPAM7J2vBRZZMLQQaPkyiEW: {
    plan: "premium",
    trial_days: 14,
    downgrade_behavior: "grace_period",
    upgrade_behavior: "prorate",
  },
} as const;

/**
 * Resolve Cliply plan name from Stripe price identifier.
 */
export function getPlanFromPriceId(price_id: string): PlanName | null {
  return STRIPE_PLAN_MAP[price_id]?.plan ?? null;
}

/**
 * Fetch configured trial days for a given Cliply plan.
 */
export function getTrialDaysForPlan(plan: PlanName): number {
  const match = Object.values(STRIPE_PLAN_MAP).find((config) => config.plan === plan);
  return match?.trial_days ?? 0;
}
