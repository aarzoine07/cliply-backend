// FILE: apps/web/src/app/api/auth/tiktok/connect/route.ts
// Canonical TikTok OAuth connect route for Cliply (App Router, self-contained).

/**
 * This route initiates the TikTok OAuth flow.
 *
 * Route: GET /api/auth/tiktok/connect?workspace_id=<uuid>
 *
 * It builds a PKCE-compliant TikTok authorize URL and redirects the user there.
 * The `state` parameter encodes:
 *   { workspace_id, user_id, code_verifier }
 *
 * The callback route at /api/auth/tiktok/connect/callback decodes that state
 * and completes the token exchange.
 */

import crypto from "crypto";
import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";

import { serverEnv, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Minimal local logger for OAuth events (replaces @cliply/shared/observability/logging).
 */
function logOAuthEvent(
  provider: "tiktok",
  outcome: "start" | "success" | "error",
  details: Record<string, unknown>,
): void {
  const payload = { provider, outcome, ...details };
  if (outcome === "error") {
    console.error("oauth_event", payload);
  } else {
    console.info("oauth_event", payload);
  }
}

// ✅ TEMP: bypass Supabase auth for local TikTok OAuth testing.
// In production you should derive user_id from your real auth context.
const TEST_BYPASS_AUTH = true;
const HARDCODED_TEST_USER_ID = "a0d97448-74e0-4b24-845e-b4de43749a3c";

// Scopes that match TikTok Sandbox configuration
const SCOPES = ["user.info.basic", "video.upload"];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspace_id");

    if (!workspaceId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_WORKSPACE",
            message: "Missing workspace_id",
          },
        },
        { status: 400 },
      );
    }

    const TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
    const TIKTOK_CLIENT_KEY = serverEnv.TIKTOK_CLIENT_ID;
    const TIKTOK_REDIRECT_URI = publicEnv.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

    if (!TIKTOK_CLIENT_KEY || !TIKTOK_REDIRECT_URI) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_MISSING_CONFIG",
            message: "TikTok OAuth environment variables are not configured.",
          },
        },
        { status: 500 },
      );
    }

    const userId = HARDCODED_TEST_USER_ID;

    // Log OAuth start
    logOAuthEvent("tiktok", "start", {
      workspaceId,
      userId,
    });

    // --- BYPASS MODE ---
    if (TEST_BYPASS_AUTH) {
      // PKCE generation
      const codeVerifier = crypto.randomBytes(64).toString("base64url");
      const sha256 = crypto.createHash("sha256").update(codeVerifier).digest();
      const codeChallenge = Buffer.from(sha256).toString("base64url");

      // Pack state (workspace_id, user_id, code_verifier)
      const statePayload = {
        workspace_id: workspaceId,
        user_id: userId,
        code_verifier: codeVerifier,
      };
      const state = Buffer.from(
        JSON.stringify(statePayload),
        "utf8",
      ).toString("base64url");

      // Build TikTok authorization URL
      const scope = SCOPES.join(",");
      const authUrl = `${TIKTOK_AUTH_BASE}?client_key=${encodeURIComponent(
        TIKTOK_CLIENT_KEY,
      )}&response_type=code&scope=${encodeURIComponent(
        scope,
      )}&redirect_uri=${encodeURIComponent(
        TIKTOK_REDIRECT_URI,
      )}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

      // Redirect straight to TikTok consent screen
      return NextResponse.redirect(authUrl, { status: 302 });
    }
    // --- END BYPASS ---

    // In non-bypass mode, you would:
    // 1. Resolve the authenticated userId from your auth context.
    // 2. Optionally validate that workspaceId belongs to that user.
    // 3. Build the same PKCE + state payload and redirect as above.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OAUTH_DISABLED",
          message: "TikTok connect bypass is not active.",
        },
      },
      { status: 403 },
    );
  } catch (err) {
    console.error("TikTok OAuth connect error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected error";
    logOAuthEvent("tiktok", "error", {
      workspaceId: undefined,
      error: err,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OAUTH_CONNECT_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
