// FILE: packages/shared/src/idempotency/idempotencyHelper.ts
// Minimal idempotency helper shared between API routes.
//
// NOTE:
// This is a conservative, "no-op" idempotency implementation that always
// executes the operation once and never reuses stored responses.
// It is designed to:
//   - Match the existing billing checkout contract
//   - Be safe in production
//   - Avoid assumptions about database schema
//
// A future upgrade can plug in real Supabase-backed idempotency without
// changing the public API of this module.

export interface IdempotencyContext<TBody = unknown> {
  supabaseAdminClient: unknown;
  workspaceId: string;
  userId: string;
  key: string;
  endpoint: string;
}

export interface RunIdempotentOptions {
  /**
   * When true, callers intend for the response to be stored as JSON for later
   * replay. This implementation does not persist anything yet, but we keep
   * the option for forward compatibility.
   */
  storeResponseJson?: boolean;
}

export interface RunIdempotentResult<TResponse = unknown> {
  /**
   * Whether this response came from a prior stored execution.
   * This minimal implementation always returns false (no reuse).
   */
  reused: boolean;

  /**
   * Live response from the wrapped operation.
   */
  response: TResponse;

  /**
   * Optional stored response payload when reused === true.
   * Not used in this implementation but kept for API compatibility.
   */
  storedResponse?: unknown;
}

/**
 * Extract an idempotency key from a request's headers.
 *
 * This is intentionally very generic so it works with:
 *  - NextApiRequest
 *  - NextRequest
 *  - Any object that exposes a `headers` bag with string or string[] values.
 */
export function extractIdempotencyKey(
  req: { headers?: Record<string, string | string[] | undefined> },
  headerName = "x-idempotency-key",
): string | null {
  const headers = req.headers;
  if (!headers) return null;

  const keyLower = headerName.toLowerCase();
  const raw =
    headers[headerName] ??
    headers[keyLower] ??
    headers[headerName.toUpperCase()];

  if (!raw) return null;

  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return raw;
}

/**
 * Run an operation in an idempotent fashion.
 *
 * CURRENT IMPLEMENTATION:
 *  - Does not perform any persistence
 *  - Does not attempt replay
 *  - Always executes the provided operation exactly once
 *
 * This is still a valid, conservative fallback: callers that provide an
 * idempotency key get a single execution, and future implementations can
 * layer real Supabase-backed behavior behind this API.
 */
export async function runIdempotent<
  TRequest extends Record<string, unknown> = Record<string, unknown>,
  TResponse = unknown,
>(
  _context: IdempotencyContext<TRequest>,
  _requestBody: TRequest,
  operation: () => Promise<TResponse>,
  _options?: RunIdempotentOptions,
): Promise<RunIdempotentResult<TResponse>> {
  const response = await operation();

  return {
    reused: false,
    response,
  };
}
