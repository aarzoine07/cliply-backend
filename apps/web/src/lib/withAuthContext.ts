import { NextRequest, NextResponse } from "next/server";
import { buildAuthContext, type AuthContext } from "@cliply/shared/auth/context";
import { AuthErrorCode, authErrorResponse } from "@cliply/shared/types/auth";

type ApiHandler = (req: NextRequest & { context: AuthContext }) => Promise<NextResponse>;

type KnownAuthErrorCode =
  | AuthErrorCode.UNAUTHORIZED
  | AuthErrorCode.FORBIDDEN
  | AuthErrorCode.WORKSPACE_MISMATCH
  | AuthErrorCode.MISSING_HEADER
  | AuthErrorCode.INTERNAL_ERROR;

type AuthError = { code: KnownAuthErrorCode; message: string; status: number };

const AUTH_ERROR_CODES = new Set(Object.values(AuthErrorCode));

function jsonError(code: AuthErrorCode, message: string, status: number): NextResponse {
  const payload = authErrorResponse(code, message, status);
  return NextResponse.json(payload, { status: payload.status });
}

export function withAuthContext(handler: ApiHandler): ApiHandler {
  return async function withContext(req: NextRequest & { context?: AuthContext }) {
    try {
      // 1. Build auth context from incoming request (JWT + workspace membership).
      const authContext = await buildAuthContext(req as Request);

      // 2. Attach the derived context to the request object for downstream handlers.
      req.context = authContext;

      // 3. Delegate to the wrapped handler with enriched request data.
      return await handler(req as NextRequest & { context: AuthContext });
    } catch (error: unknown) {
      // 4. Normalize known AUTH_* errors raised by context builder/middleware.
      if (isAuthError(error)) {
        const status = mapStatus(error.status, error.code);
        return jsonError(error.code, error.message, status);
      }

      // 5. Handle unexpected exceptions with a generic internal error response.
      return jsonError(
        AuthErrorCode.INTERNAL_ERROR,
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
    AUTH_ERROR_CODES.has(cast.code as AuthErrorCode) &&
    typeof cast.message === "string" &&
    typeof cast.status === "number"
  );
}

function mapStatus(status: number, code: KnownAuthErrorCode): number {
  if (status >= 400) return status;
  if (code === AuthErrorCode.FORBIDDEN || code === AuthErrorCode.WORKSPACE_MISMATCH) return 403;
  return 401;
}
