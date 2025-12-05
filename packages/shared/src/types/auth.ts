// packages/shared/src/types/auth.ts

/**
 * Shared auth-related types used across backend and web.
 *
 * This implementation is intentionally permissive so it doesn't
 * break any existing call sites. You can refine it later if needed.
 */

export type PlanName = string;

/**
 * High-level auth error codes shared by API and web.
 */
export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_TOKEN"
  | "MISSING_WORKSPACE"
  | "INTERNAL_ERROR"
  | (string & {});

/**
 * Standard auth error payload shape.
 */
export interface AuthErrorBody {
  ok: false;
  code: AuthErrorCode;
  message: string;
  status?: number;
  // Allow extra metadata if needed
  [key: string]: unknown;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "You do not have access to this resource",
  INVALID_TOKEN: "The authentication token is invalid",
  MISSING_WORKSPACE: "No workspace selected",
  INTERNAL_ERROR: "An internal error occurred",
};

/**
 * Helper for building a consistent auth error response payload.
 */
export function authErrorResponse(
  code: AuthErrorCode,
  message?: string,
  status?: number,
): AuthErrorBody {
  return {
    ok: false,
    code,
    message: message ?? DEFAULT_MESSAGES[code] ?? "Authentication error",
    ...(status ? { status } : {}),
  };
}

/**
 * Shared AuthContext – kept intentionally flexible.
 */
export interface AuthContext {
  userId?: string | null;
  workspaceId?: string | null;
  email?: string | null;
  roles?: string[];
  // Allow additional fields without breaking callers
  [key: string]: unknown;
}