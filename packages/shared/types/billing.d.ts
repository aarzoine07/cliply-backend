import { z } from "zod";
export declare enum BillingErrorCode {
    PLAN_REQUIRED = "BILLING_PLAN_REQUIRED",
    PLAN_LIMIT = "BILLING_PLAN_LIMIT",
    RATE_LIMITED = "BILLING_RATE_LIMITED",
    INVALID_SIGNATURE = "BILLING_INVALID_SIGNATURE",
    WEBHOOK_ERROR = "BILLING_WEBHOOK_ERROR",
    WORKSPACE_MISSING = "BILLING_WORKSPACE_MISSING",
    INTERNAL_ERROR = "BILLING_INTERNAL_ERROR"
}
export declare const BillingErrorSchema: z.ZodEnum<typeof BillingErrorCode>;
export interface BillingError {
    code: BillingErrorCode;
    message: string;
    status: number;
}
export declare function billingErrorResponse(code: BillingErrorCode, message: string, status: number): {
    ok: false;
    error: {
        code: BillingErrorCode;
        message: string;
    };
    status: number;
};
export interface BillingPlanFeatureDescriptor {
    key: string;
    label: string;
    description?: string;
}
export interface BillingPlanGateResult {
    active: boolean;
    message?: string;
}
