/** HTTP error helper types for API routes and worker surfaces */

import type { ErrorCode } from "./errorCodes";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Factory helpers */
export const errBadRequest = (msg = 'invalid_request', details?: unknown) =>
  new HttpError(400, msg, 'bad_request', details);
export const errUnauthorized = (msg = 'unauthorized', details?: unknown) =>
  new HttpError(401, msg, 'unauthorized', details);
export const errForbidden = (msg = 'forbidden', details?: unknown) =>
  new HttpError(403, msg, 'forbidden', details);
export const errNotFound = (msg = 'not_found', details?: unknown) =>
  new HttpError(404, msg, 'not_found', details);
export const errConflict = (msg = 'conflict', details?: unknown) =>
  new HttpError(409, msg, 'conflict', details);
export const errTooManyRequests = (msg = 'rate_limited', details?: unknown) =>
  new HttpError(429, msg, 'too_many_requests', details);
export const errInternal = (msg = 'internal_error', details?: unknown) =>
  new HttpError(500, msg, 'internal', details);

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

// Legacy stub retained for backwards compatibility
export class StubError extends Error {
  constructor(message = 'stub') {
    super(message);
  }
}

/**
 * Create an HttpError using a registered error code.
 * Maps codes to appropriate HTTP status codes.
 */
export function httpErr(code: ErrorCode, message?: string, details?: unknown): HttpError {
  const statusMap: Record<ErrorCode, number> = {
    usage_limit_exceeded: 429,
    posting_limit_exceeded: 429,
    missing_connected_account: 400,
    invalid_connected_account: 400,
    invalid_clip_state: 400,
    video_too_long_for_plan: 400,
    video_too_short: 400,
    workspace_not_configured: 400,
    clip_already_published: 400,
    plan_insufficient: 403,
  };

  const status = statusMap[code] ?? 400;
  const msg = message ?? code.replace(/_/g, ' ');

  return new HttpError(status, msg, code, details);
}

