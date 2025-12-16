// FILE: apps/web/src/lib/auth/context.ts
// FINAL VERSION – Next.js Pages Router auth-context helper

/**
 * Next.js API route auth context helper
 * Wraps the shared buildAuthContext to work with Next.js API routes
 *
 * IMPORTANT (tests):
 * - Our API tests use x-debug-user + x-debug-workspace without an Authorization header.
 * - Surface APIs require an access token to build an RLS client.
 * - In NODE_ENV=test, we auto-mint a signed Supabase-style JWT from x-debug-user
 *   and inject it as Authorization: Bearer <jwt> so RLS can work.
 */
import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { buildAuthContext as buildAuthContextShared } from "@cliply/shared/auth/context";
import {
  AuthErrorCode,
  type AuthErrorCode as AuthErrorCodeType,
  authErrorResponse,
} from "@cliply/shared/types/auth";

export type { AuthContext } from "@cliply/shared/types/auth";

function signTestJwt(userId: string): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: "supabase-demo",
    aud: "authenticated",
    role: "authenticated",
    sub: userId,
    iat: now,
    exp: now + 60 * 60, // 1h
  };

  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");

  return `${signingInput}.${signature}`;
}

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

  // ✅ Test-only: if debug headers exist but no Authorization header,
  // mint a JWT so RLS requests work in API tests.
  if (process.env.NODE_ENV === "test") {
    const debugUserId = headers.get("x-debug-user")?.trim();
    const existingAuth = headers.get("authorization")?.trim();

    if (debugUserId && !existingAuth) {
      const jwt = signTestJwt(debugUserId);
      if (jwt) {
        headers.set("authorization", `Bearer ${jwt}`);
      }
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
    const message = error instanceof Error ? error.message : "Authentication failed";
    const code: AuthErrorCodeType = AuthErrorCode.INTERNAL_ERROR;
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
      authError.code as AuthErrorCodeType,
      authError.message,
      authError.status,
    );
    res.status(payload.status ?? 500).json(payload);
    return;
  }

  // Fallback for unexpected errors
  const payload = authErrorResponse(AuthErrorCode.INTERNAL_ERROR, "Authentication failed", 500);
  res.status(500).json(payload);
}