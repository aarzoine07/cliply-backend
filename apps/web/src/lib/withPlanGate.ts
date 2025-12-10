import { NextRequest, NextResponse } from "next/server";

import type { AuthContext } from "@cliply/shared/auth/context";
import {
  BILLING_PLAN_LIMIT,
  BILLING_PLAN_REQUIRED,
  checkPlanAccess,
  enforcePlanAccess,
} from "@cliply/shared/billing/planGate";
import type { PlanLimits } from "@cliply/shared/billing/planMatrix";
import { type AuthErrorCode, authErrorResponse } from "@cliply/shared/types/auth";

type ApiRequest = NextRequest & { context: AuthContext };
type ApiHandler = (req: ApiRequest) => Promise<NextResponse>;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(authErrorResponse(code as AuthErrorCode, message, status), {
    status,
  });
}

/**
 * Wrap an API handler with plan gating based on a specific feature flag or limit.
 * Must be composed after withAuthContext so req.context is populated.
 */
export function withPlanGate(
  handler: ApiHandler,
  feature: keyof PlanLimits,
): ApiHandler {
  return async function withPlan(req: ApiRequest): Promise<NextResponse> {
    // 1. Ensure auth context and plan are available before gating features.
    const plan = req.context?.plan;
    if (!plan) {
      return jsonError(BILLING_PLAN_REQUIRED, "No active plan found.", 403);
    }

    try {
      // 2. Check capability availability without mutating state.
      const gate = checkPlanAccess(plan, feature);
      if (!gate.active) {
        const code = gate.reason === "limit" ? BILLING_PLAN_LIMIT : BILLING_PLAN_REQUIRED;
        const status = code === BILLING_PLAN_LIMIT ? 429 : 403;
        const message =
          gate.message ?? `${String(feature)} not available on current plan.`;
        return jsonError(code, message, status);
      }

      // 3. Enforce plan access (no-op today for quotas, future support for limits).
      enforcePlanAccess(plan, feature);

      // 4. Delegate to the downstream handler when gating succeeds.
      return handler(req);
    } catch (error) {
      // 5. Normalize unexpected failures into a billing internal error response.
      const message =
      error instanceof Error
        ? error.message
        : "Plan gate failed unexpectedly.";
    return jsonError("INTERNAL_ERROR", message, 500);
    }
  };
}
