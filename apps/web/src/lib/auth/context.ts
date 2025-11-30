/**
 * Next.js API route auth context helper
 * Wraps the shared buildAuthContext to work with Next.js API routes
 */
import type { NextApiRequest } from "next";
import { buildAuthContext as buildAuthContextShared, type AuthContext as SharedAuthContext } from "@cliply/shared/auth/context";
import { AuthErrorCode, authErrorResponse } from "@cliply/shared/types/auth";

export type { AuthContext } from "@cliply/shared/types/auth";

/**
 * Convert NextApiRequest or Express Request to a Request-like object for buildAuthContext
 */
function nextRequestToRequest(req: NextApiRequest | { headers?: Record<string, string | string[] | undefined>; url?: string; method?: string }): Request {
  // Create a minimal Request object from NextApiRequest or Express Request
  const headers = new Headers();
  
  // Copy all headers from request
  // Express/Next.js normalizes headers to lowercase, so we need to handle that
  const reqHeaders = req.headers || {};
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value !== undefined && value !== null) {
      // Headers API is case-insensitive, but we'll use lowercase for consistency
      const normalizedKey = key.toLowerCase();
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v !== undefined && v !== null) {
            headers.append(normalizedKey, String(v));
          }
        }
      } else {
        headers.set(normalizedKey, String(value));
      }
    }
  }

  // Create a minimal Request object
  // Request constructor requires a full URL, so we use a dummy base URL for test/dev
  const url = req.url || "/";
  const method = req.method || "GET";
  // Use a dummy base URL since Request constructor requires a full URL
  const fullUrl = url.startsWith("http") ? url : `http://localhost${url}`;
  
  return new Request(fullUrl, {
    method,
    headers,
    // Body is not needed for auth context building
  });
}

/**
 * Build auth context from Next.js API request or Express Request
 * Supports debug headers in dev/test environments only
 */
export async function buildAuthContext(req: NextApiRequest | { headers?: Record<string, string | string[] | undefined>; url?: string; method?: string }): Promise<SharedAuthContext> {
  try {
    const request = nextRequestToRequest(req);
    return await buildAuthContextShared(request);
  } catch (error: unknown) {
    // Re-throw auth errors as-is, they're already properly formatted
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }
    
    // Wrap unexpected errors
    const message = error instanceof Error ? error.message : "Authentication failed";
    throw {
      code: AuthErrorCode.INTERNAL_ERROR,
      message,
      status: 500,
    };
  }
}

/**
 * Helper to handle auth errors in Next.js API routes
 */
export function handleAuthError(error: unknown, res: any): void {
  if (error && typeof error === "object" && "code" in error && "status" in error && "message" in error) {
    const authError = error as { code: string; status: number; message: string };
    const payload = authErrorResponse(authError.code as AuthErrorCode, authError.message, authError.status);
    res.status(payload.status).json(payload);
    return;
  }

  // Fallback for unexpected errors
  res.status(500).json(authErrorResponse(AuthErrorCode.INTERNAL_ERROR, "Authentication failed", 500));
}

