// FILE: apps/web/src/lib/withAuthContext.ts
// FINAL VERSION – Next.js App Router auth-context helper

import { NextResponse, type NextRequest } from "next/server";

import { buildAuthContext as buildAuthContextShared } from "@cliply/shared/auth/context";
import {
  AuthErrorCode,
  type AuthErrorCode as AuthErrorCodeType,
  authErrorResponse,
  type AuthContext,
} from "@cliply/shared/types/auth";

export type { AuthContext } from "@cliply/shared/types/auth";

type AuthedRequest = NextRequest & { context: AuthContext };

type AuthError = {
  code: AuthErrorCodeType;
  message: string;
  status: number;
};

/**
 * JSON error helper that wraps authErrorResponse, using the shared AuthErrorCode
 * constant for value-level codes and a separate type alias for typing.
 */
function jsonError(
  code: AuthErrorCodeType,
  message: string,
  status: number,
): NextResponse {
  const payload = authErrorResponse(code, message, status);
  return NextResponse.json(payload, { status: payload.status ?? status });
}

/**
 * withAuthContext – App Router middleware-style helper
 *
 * Usage:
 *   export const POST = withAuthContext(async (req) => {
 *     const { context } = req;
 *     // ...
 *   });
 */
export function withAuthContext(
  handler: (req: AuthedRequest) => Promise<NextResponse>,
) {
  return async function wrapped(req: NextRequest): Promise<NextResponse> {
    try {
      // NextRequest is compatible with the Fetch Request interface expected
      // by the shared buildAuthContext; cast for TypeScript.
      const context = await buildAuthContextShared(req as unknown as Request);

      const authedReq = req as AuthedRequest;
      (authedReq as any).context = context;

      return await handler(authedReq);
    } catch (error: unknown) {
      // Known auth errors thrown by shared auth/context
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        "status" in error &&
        "message" in error
      ) {
        const authError = error as AuthError;
        return jsonError(authError.code, authError.message, authError.status);
      }

      // Unexpected failures: treat as INTERNAL_ERROR with a generic message.
      return jsonError(
        AuthErrorCode.INTERNAL_ERROR,
        "Authentication middleware failed unexpectedly.",
        500,
      );
    }
  };
}

/**
 * mapStatus – helper to normalize HTTP status codes based on auth error code.
 * Keeping the signature so any existing call sites / tests still type-check.
 */
export function mapStatus(status: number, _code: AuthErrorCodeType): number {
  // For now, just return the provided status. You can refine this if needed.
  return status;
}
