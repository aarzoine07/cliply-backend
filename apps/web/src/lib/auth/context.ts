// FILE: apps/web/src/lib/auth/context.ts
// FINAL VERSION – Next.js Pages Router auth-context helper

/**
 * Next.js API route auth context helper
 * Wraps the shared buildAuthContext to work with Next.js API routes
 */
import type { NextApiRequest, NextApiResponse } from "next";

import {
  buildAuthContext as buildAuthContextShared,
} from "@cliply/shared/auth/context";
import {
  type AuthErrorCode,
  authErrorResponse,
} from "@cliply/shared/types/auth";

export type { AuthContext } from "@cliply/shared/types/auth";

/**
 * Convert NextApiRequest to a Request-like object for buildAuthContext
 */
function nextRequestToRequest(req: NextApiRequest): Request {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || value === null) continue;
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

  const url = req.url || "/";
  const method = req.method || "GET";
  const fullUrl = url.startsWith("http") ? url : `http://localhost${url}`;

  return new Request(fullUrl, {
    method,
    headers,
  });
}

/**
 * Build auth context from Next.js API request
 * Supports debug headers in dev/test environments only
 */
export async function buildAuthContext(req: NextApiRequest) {
  try {
    const request = nextRequestToRequest(req);
    // Let TypeScript infer the exact AuthContext type from the shared helper
    return await buildAuthContextShared(request);
  } catch (error: unknown) {
    // Re-throw auth errors as-is, they're already properly formatted
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    // Wrap unexpected errors
    const message =
      error instanceof Error ? error.message : "Authentication failed";
    const code: AuthErrorCode = "INTERNAL_ERROR";
    throw {
      code,
      message,
      status: 500,
    };
  }
}

/**
 * Helper to handle auth errors in Next.js API routes
 */
export function handleAuthError(error: unknown, res: NextApiResponse): void {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "status" in error &&
    "message" in error
  ) {
    const authError = error as {
      code: string;
      status: number;
      message: string;
    };
    const payload = authErrorResponse(
      authError.code as AuthErrorCode,
      authError.message,
      authError.status,
    );
    res.status(payload.status ?? 500).json(payload);
    return;
  }

  // Fallback for unexpected errors
  const payload = authErrorResponse(
    "INTERNAL_ERROR",
    "Authentication failed",
    500,
  );
  res.status(500).json(payload);
}
