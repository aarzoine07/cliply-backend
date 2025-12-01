/**
 * Stripe Price IDs mapped to Cliply plans.
 * These are live production Price IDs from Stripe Dashboard.
 */
export const STRIPE_PLAN_MAP = {
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
};
/**
 * Resolve Cliply plan name from Stripe price identifier.
 */
export function getPlanFromPriceId(price_id) {
    return STRIPE_PLAN_MAP[price_id]?.plan ?? null;
}
/**
 * Fetch configured trial days for a given Cliply plan.
 */
export function getTrialDaysForPlan(plan) {
    const match = Object.values(STRIPE_PLAN_MAP).find((config) => config.plan === plan);
    return match?.trial_days ?? 0;
}
