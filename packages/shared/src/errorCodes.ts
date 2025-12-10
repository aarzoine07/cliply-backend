/**
 * Central registry of API error codes used across Cliply.
 *
 * This file serves as the error code reference for the product:
 * - ERROR_CODES: canonical string constants for machine-surface error codes.
 * - ErrorCode: typed union of all recognized error codes.
 *
 * API routes should:
 * - Use these codes in `error.code` on failures.
 * - Return JSON in the shape: { ok: false, error: { code, message } }.
 * - Avoid inventing new codes inline; add them here instead.
 */

export const ERROR_CODES = {
  usage_limit_exceeded: "usage_limit_exceeded",
  posting_limit_exceeded: "posting_limit_exceeded",
  missing_connected_account: "missing_connected_account",
  invalid_connected_account: "invalid_connected_account",
  invalid_clip_state: "invalid_clip_state",
  video_too_long_for_plan: "video_too_long_for_plan",
  video_too_short: "video_too_short",
  workspace_not_configured: "workspace_not_configured",
  clip_already_published: "clip_already_published",
  plan_insufficient: "plan_insufficient",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
