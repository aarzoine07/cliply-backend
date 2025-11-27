import type { PlanName } from "../types/auth";
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
export declare const STRIPE_PLAN_MAP: Record<string, StripePlanConfig>;
/**
 * Resolve Cliply plan name from Stripe price identifier.
 */
export declare function getPlanFromPriceId(price_id: string): PlanName | null;
/**
 * Fetch configured trial days for a given Cliply plan.
 */
export declare function getTrialDaysForPlan(plan: PlanName): number;
