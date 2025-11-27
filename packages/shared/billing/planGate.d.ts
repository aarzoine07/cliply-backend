import { type PlanLimits } from "./planMatrix";
import type { PlanName } from "../types/auth";
declare const BILLING_PLAN_REQUIRED: "BILLING_PLAN_REQUIRED";
declare const BILLING_PLAN_LIMIT: "BILLING_PLAN_LIMIT";
type PlanGateResult = {
    active: true;
} | {
    active: false;
    message: string;
    reason?: "plan" | "limit";
};
/**
 * Compute the feature or quota availability for the given plan.
 * Returns a structured result that middleware and APIs can inspect.
 */
export declare function checkPlanAccess(plan: PlanName, feature: keyof PlanLimits): PlanGateResult;
/**
 * Enforce plan access by throwing a standardized billing error when unavailable.
 * Downstream handlers can catch and return the error payload directly.
 */
export declare function enforcePlanAccess(plan: PlanName, feature: keyof PlanLimits): void;
export { BILLING_PLAN_LIMIT, BILLING_PLAN_REQUIRED };
