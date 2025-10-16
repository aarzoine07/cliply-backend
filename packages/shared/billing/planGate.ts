import { PLAN_MATRIX, type PlanLimits, type PlanName } from "@cliply/shared/billing/planMatrix";

const BILLING_PLAN_REQUIRED = "BILLING_PLAN_REQUIRED" as const;
const BILLING_PLAN_LIMIT = "BILLING_PLAN_LIMIT" as const;

type PlanGateResult =
  | { active: true }
  | { active: false; message: string; reason?: "plan" | "limit" };

/**
 * Compute the feature or quota availability for the given plan.
 * Returns a structured result that middleware and APIs can inspect.
 */
export function checkPlanAccess(plan: PlanName, feature: keyof PlanLimits): PlanGateResult {
  const definition = PLAN_MATRIX[plan];
  if (!definition) {
    // Unknown plan should soft-fail and prompt upgrade flow.
    return { active: false, message: "Invalid plan provided.", reason: "plan" };
  }

  // Look up the configured value for the requested limit or flag.
  const value = definition.limits[feature];
  if (value === undefined) {
    return {
      active: false,
      message: `${String(feature)} is not tracked for the ${plan} plan.`,
      reason: "plan",
    };
  }

  // Numeric limits represent quotas; by default we just acknowledge availability.
  if (typeof value === "number") {
    return { active: true };
  }

  // Boolean feature flags signal availability.
  if (typeof value === "boolean") {
    return value
      ? { active: true }
      : {
          active: false,
          message: `${String(feature)} is not active on the ${plan} plan.`,
          reason: "plan",
        };
  }

  // Safety net for unexpected configuration types.
  return {
    active: false,
    message: `Unsupported plan feature type for ${String(feature)}.`,
    reason: "plan",
  };
}

/**
 * Enforce plan access by throwing a standardized billing error when unavailable.
 * Downstream handlers can catch and return the error payload directly.
 */
export function enforcePlanAccess(plan: PlanName, feature: keyof PlanLimits): void {
  const result = checkPlanAccess(plan, feature);
  if (!result.active) {
    // Map the reason to a stable billing error code and HTTP status.
    const code = result.reason === "limit" ? BILLING_PLAN_LIMIT : BILLING_PLAN_REQUIRED;
    throw {
      code,
      message: result.message ?? `${String(feature)} requires an upgraded plan.`,
      status: code === BILLING_PLAN_LIMIT ? 429 : 403,
    };
  }
}

export { BILLING_PLAN_LIMIT, BILLING_PLAN_REQUIRED };
