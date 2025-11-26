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
export declare function resolveWorkspacePlan(workspaceId: string, ctx: {
    supabase: SupabaseClient;
}): Promise<ResolvedPlan>;
//# sourceMappingURL=planResolution.d.ts.map