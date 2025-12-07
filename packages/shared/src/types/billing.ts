// packages/shared/src/types/billing.ts
/**
 * Shared billing-related types used across backend and web.
 * 
 * Mirrors the pattern from types/auth.ts for consistency.
 */

/**
 * High-level billing error codes shared by API and web.
 * 
 * These are used as string-based codes (not enum) to allow
 * property access like `BillingErrorCode.RATE_LIMITED`.
 */
export const BillingErrorCode = {
  RATE_LIMITED: "RATE_LIMITED",
  WORKSPACE_MISSING: "WORKSPACE_MISSING",
  BILLING_PLAN_REQUIRED: "BILLING_PLAN_REQUIRED",
  BILLING_PLAN_LIMIT: "BILLING_PLAN_LIMIT",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

/**
 * Type derived from BillingErrorCode constant for type-checking.
 */
export type BillingErrorCode = (typeof BillingErrorCode)[keyof typeof BillingErrorCode] | (string & {});

/**
 * Standard billing error payload shape.
 */
export interface BillingErrorResponse {
  ok: false;
  code: BillingErrorCode;
  message: string;
  status?: number;
  // Allow extra metadata if needed
  [key: string]: unknown;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Rate limit exceeded",
  WORKSPACE_MISSING: "Workspace context is required",
  BILLING_PLAN_REQUIRED: "A billing plan is required for this feature",
  BILLING_PLAN_LIMIT: "Billing plan limit exceeded",
  INVALID_SIGNATURE: "Invalid signature",
  INTERNAL_ERROR: "An internal billing error occurred",
};

/**
 * Helper for building a consistent billing error response payload.
 * 
 * @param code - The billing error code
 * @param message - Optional custom message (uses default if omitted)
 * @param status - Optional HTTP status code
 * @returns Serializable error payload for JSON responses
 */
export function billingErrorResponse(
  code: BillingErrorCode,
  message?: string,
  status?: number,
): BillingErrorResponse {
  return {
    ok: false,
    code,
    message: message ?? DEFAULT_MESSAGES[code] ?? "Billing error",
    ...(status ? { status } : {}),
  };
}

