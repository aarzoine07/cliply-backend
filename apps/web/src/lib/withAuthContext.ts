// FILE: apps/web/src/lib/withAuthContext.ts
// FINAL VERSION – App Router auth-context wrapper (looser typings to avoid cross-package mismatch)

import { NextRequest, NextResponse } from "next/server";

import { buildAuthContext } from "@cliply/shared/auth/context";
import {
  type AuthErrorCode,
  authErrorResponse,
} from "@cliply/shared/types/auth";

// Request type that downstream handlers see: NextRequest + a `context` bag.
// We keep this as `any` to avoid type incompatibilities between built/shared types.
export type ApiRequestWithContext = NextRequest & { context: any };

// Handler type used by routes that want auth context.
export type ApiHandler = (req: ApiRequestWithContext) => Promise<NextResponse>;

type AuthError = { code: AuthErrorCode; message: string; status: number };

const AUTH_ERROR_CODES = new Set<string>([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_TOKEN",
  "MISSING_WORKSPACE",
  "INTERNAL_ERROR",
]);

function jsonError(
  code: AuthErrorCode,
  message: string,
  status: number,
): NextResponse {
  const payload = authErrorResponse(code, message, status);
  return NextResponse.json(payload, { status: payload.status ?? status });
}

/**
 * Wrap an App Router handler so it receives an auth `context` on the request.
 *
 * Usage in a route:
 *   export const GET = withAuthContext(async (req) => {
 *     const { workspace_id, user_id } = req.context;
 *     ...
 *   });
 */
export function withAuthContext(
  handler: ApiHandler,
): (req: NextRequest) => Promise<NextResponse> {
  return async function withContext(req: NextRequest): Promise<NextResponse> {
    try {
      // 1. Build auth context from the incoming request (JWT + workspace membership).
      const authContext = await buildAuthContext(req as unknown as Request);

      // 2. Attach the derived context to the request object for downstream handlers.
      (req as any).context = authContext;

      // 3. Delegate to the wrapped handler with enriched request data.
      return await handler(req as ApiRequestWithContext);
    } catch (error: unknown) {
      // 4. Normalize known AUTH_* errors raised by context builder/middleware.
      if (isAuthError(error)) {
        const status = mapStatus(error.status, error.code);
        return jsonError(error.code, error.message, status);
      }

      // 5. Handle unexpected exceptions with a generic internal error response.
      return jsonError(
        "INTERNAL_ERROR",
        "Authentication middleware failed unexpectedly.",
        500,
      );
    }
  };
}

function isAuthError(value: unknown): value is AuthError {
  if (!value || typeof value !== "object") return false;
  const cast = value as Partial<AuthError>;
  return (
    typeof cast.code === "string" &&
    AUTH_ERROR_CODES.has(cast.code) &&
    typeof cast.message === "string" &&
    typeof cast.status === "number"
  );
}

function mapStatus(status: number, code: AuthErrorCode): number {
  if (status >= 400) return status;
  if (code === "FORBIDDEN" || code === "MISSING_WORKSPACE") return 403;
  return 401;
}
