/**
 * Pages Router plan gating helper for Next.js API routes
 * Works with buildAuthContext from @/lib/auth/context
 */
import type { NextApiRequest, NextApiResponse } from "next";
import type { AuthContext } from "@cliply/shared/auth/context";
import {
  BILLING_PLAN_LIMIT,
  BILLING_PLAN_REQUIRED,
  checkPlanAccess,
  enforcePlanAccess,
} from "@cliply/shared/billing/planGate";
import type { PlanLimits } from "@cliply/shared/billing/planMatrix";
import { AuthErrorCode, authErrorResponse } from "@cliply/shared/types/auth";
import { err } from "@/lib/http";

type ApiHandler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

/**
 * Wrap an API handler with plan gating based on a specific feature flag or limit.
 * Requires AuthContext to be built before calling this function.
 *
 * @example
 * ```ts
 * export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
 *   let auth;
 *   try {
 *     auth = await buildAuthContext(req);
 *   } catch (error) {
 *     handleAuthError(error, res);
 *     return;
 *   }
 *
 *   return withPlanGate(auth, 'uploads_per_day', async (req, res) => {
 *     // Handler logic here
 *   })(req, res);
 * });
 * ```
 */
export function withPlanGate(
  auth: AuthContext,
  feature: keyof PlanLimits,
  handler: ApiHandler,
): ApiHandler {
  return async function withPlan(req: NextApiRequest, res: NextApiResponse): Promise<void> {
    // 1. Ensure auth context and plan are available before gating features.
    const plan = auth.plan;
    if (!plan) {
      const payload = authErrorResponse(BILLING_PLAN_REQUIRED, "No active plan found.", 403);
      res.status(payload.status).json({ ok: false, error: payload.error });
      return;
    }

    try {
      // 2. Check capability availability without mutating state.
      // Extract planId from ResolvedPlan object (plan.planId is the PlanName string)
      const planName = plan.planId;
      const gate = checkPlanAccess(planName, feature);
      if (!gate.active) {
        const code = gate.reason === "limit" ? BILLING_PLAN_LIMIT : BILLING_PLAN_REQUIRED;
        const status = code === BILLING_PLAN_LIMIT ? 429 : 403;
        const message =
          gate.message ?? `${String(feature)} not available on current plan.`;
        const payload = authErrorResponse(code, message, status);
        res.status(payload.status).json({ ok: false, error: payload.error });
        return;
      }

      // 3. Enforce plan access (no-op today for quotas, future support for limits).
      // Note: We've already checked with checkPlanAccess above, so enforcePlanAccess shouldn't throw.
      // But we wrap it in try-catch just in case, since it throws plain objects, not Error instances.
      try {
        enforcePlanAccess(planName, feature);
      } catch (enforceError: any) {
        // If enforcePlanAccess throws (shouldn't happen since we checked above), handle it
        if (enforceError && typeof enforceError === 'object' && 'code' in enforceError) {
          const code = enforceError.code === BILLING_PLAN_LIMIT ? BILLING_PLAN_LIMIT : BILLING_PLAN_REQUIRED;
          const status = code === BILLING_PLAN_LIMIT ? 429 : 403;
          const message = enforceError.message ?? `${String(feature)} not available on current plan.`;
          const payload = authErrorResponse(code, message, status);
          res.status(payload.status).json({ ok: false, error: payload.error });
          return;
        }
        // Re-throw if it's not a plan gating error
        throw enforceError;
      }

      // 4. Delegate to the downstream handler when gating succeeds.
      await handler(req, res);
    } catch (error) {
      // 5. Normalize unexpected failures into a billing internal error response.
      // Handle both Error instances and plain objects
      let message = "Plan gate failed unexpectedly.";
      if (error instanceof Error) {
        message = error.message;
      } else if (error && typeof error === 'object' && 'message' in error) {
        message = String((error as any).message);
      }
      const payload = authErrorResponse(AuthErrorCode.INTERNAL_ERROR, message, 500);
      res.status(payload.status).json({ ok: false, error: payload.error });
    }
  };
}

