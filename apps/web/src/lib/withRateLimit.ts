import { NextRequest, NextResponse } from "next/server";

import type { AuthContext } from "@cliply/shared/auth/context";
import { checkRateLimit } from "@cliply/shared/billing/checkRateLimit";
import { BillingErrorCode, billingErrorResponse } from "@cliply/shared/types/billing";

type RateLimitHandler = (req: NextRequest & { context: AuthContext }) => Promise<NextResponse>;

type BillingErrorShape = {
  code: BillingErrorCode;
  message: string;
  status: number;
};

function isBillingError(value: unknown): value is BillingErrorShape {
  if (!value || typeof value !== "object") return false;
  const cast = value as Partial<BillingErrorShape>;
  return (
    typeof cast.code === "string" &&
    typeof cast.message === "string" &&
    typeof cast.status === "number"
  );
}

function jsonError(code: BillingErrorCode, message: string, status: number): NextResponse {
  const payload = billingErrorResponse(code, message, status);
  return NextResponse.json(payload, { status: payload.status });
}

/**
 * Higher-order middleware that enforces rate limits per workspace feature.
 * Must be composed after withAuthContext so req.context is available.
 */
export function withRateLimit(handler: RateLimitHandler, feature: string): RateLimitHandler {
  return async function rateLimitWrapper(req: NextRequest & { context?: AuthContext }) {
    const workspaceId = req.context?.workspace_id;
    if (!workspaceId) {
      return jsonError(
        BillingErrorCode.WORKSPACE_MISSING,
        "Missing workspace context.",
        401,
      );
    }

    try {
      // 1. Attempt to consume a token for the requested feature.
      await checkRateLimit(workspaceId, feature);

      // 2. Invoke the downstream handler when the rate limit allows execution.
      return await handler(req as NextRequest & { context: AuthContext });
    } catch (error) {
      if (isBillingError(error) && error.code === BillingErrorCode.RATE_LIMITED) {
        return jsonError(
          BillingErrorCode.RATE_LIMITED,
          error.message || `Rate limit exceeded for ${feature}.`,
          error.status || 429,
        );
      }

      console.error("💥 Unexpected rate-limit middleware failure:", error);
      return jsonError(
        BillingErrorCode.INTERNAL_ERROR,
        "Unexpected rate-limit middleware failure.",
        500,
      );
    }
  };
}
