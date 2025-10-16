import { z } from "zod";

export enum BillingErrorCode {
  PLAN_REQUIRED = "BILLING_PLAN_REQUIRED",
  PLAN_LIMIT = "BILLING_PLAN_LIMIT",
  RATE_LIMITED = "BILLING_RATE_LIMITED",
  INVALID_SIGNATURE = "BILLING_INVALID_SIGNATURE",
  WEBHOOK_ERROR = "BILLING_WEBHOOK_ERROR",
  WORKSPACE_MISSING = "BILLING_WORKSPACE_MISSING",
  INTERNAL_ERROR = "BILLING_INTERNAL_ERROR",
}

export const BillingErrorSchema = z.nativeEnum(BillingErrorCode);

export interface BillingError {
  code: BillingErrorCode;
  message: string;
  status: number;
}

export function billingErrorResponse(code: BillingErrorCode, message: string, status: number) {
  return {
    ok: false as const,
    error: { code, message },
    status,
  };
}

export interface BillingPlanFeatureDescriptor {
  key: string;
  label: string;
  description?: string;
}

export interface BillingPlanGateResult {
  active: boolean;
  message?: string;
}
