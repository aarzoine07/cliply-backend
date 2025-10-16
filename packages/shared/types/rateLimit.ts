import { BillingErrorCode } from "./billing";

/**
 * Core type definitions for rate-limit metadata.
 */
export type RateLimitFeature = "upload" | "render" | "publish" | "ai_caption";

export interface RateLimitDefinition {
  capacity: number;
  refill_rate: number; // tokens per hour
}

export interface RateLimitStatus {
  workspace_id: string;
  feature: RateLimitFeature;
  tokens_remaining: number;
  capacity: number;
  refill_rate: number;
  last_refill_at: string;
}

/**
 * Standardized error handling for rate-limit violations.
 */
export enum RateLimitErrorCode {
  RATE_LIMIT_EXCEEDED = "BILLING_RATE_LIMITED",
  RATE_LIMIT_INTERNAL_ERROR = "BILLING_INTERNAL_ERROR",
}

export interface RateLimitError {
  code: RateLimitErrorCode | BillingErrorCode;
  message: string;
  status: number;
}

/**
 * Helper for consistent API error responses.
 */
export function rateLimitErrorResponse(err: RateLimitError) {
  return {
    ok: false as const,
    error: {
      code: err.code,
      message: err.message,
    },
  };
}
