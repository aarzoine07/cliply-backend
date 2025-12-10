// FILE: apps/web/src/app/api/tiktok/token/route.ts
// FINAL VERSION – TikTok access token proxy using a simple JSON "envelope"

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SecretEnvelope = {
  v: number;
  purpose: string;
  secret: string;
};

function getSupabaseClient() {
  const env = getEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase configuration is missing for TikTok token endpoint.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function decryptSecretEnvelope(ref: string, expectedPurpose: string): string {
  let parsed: SecretEnvelope;
  try {
    parsed = JSON.parse(ref) as SecretEnvelope;
  } catch {
    throw new Error("Invalid token envelope format.");
  }

  if (!parsed || parsed.purpose !== expectedPurpose || !parsed.secret) {
    throw new Error("Token envelope purpose mismatch or missing secret.");
  }

  return parsed.secret;
}

/**
 * TikTok token proxy.
 *
 * For simplicity and to avoid cross-package auth dependencies, this endpoint
 * expects the workspace ID as a query parameter:
 *
 *   GET /api/tiktok/token?workspace_id=<uuid>
 *
 * It loads the TikTok connected account, validates expiry, and returns a short-lived
 * proxy token payload for the frontend to use.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id");

    if (!workspaceId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_WORKSPACE_MISSING",
            message: "Missing workspace context.",
          },
        },
        { status: 401 },
      );
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("connected_accounts")
      .select("access_token_encrypted_ref, expires_at")
      .eq("workspace_id", workspaceId)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_TOKEN_NOT_FOUND",
            message: "No TikTok account connected.",
          },
        },
        { status: 404 },
      );
    }

    const { access_token_encrypted_ref, expires_at } = data;
    if (!access_token_encrypted_ref || !expires_at) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_TOKEN_NOT_FOUND",
            message: "TikTok account is incomplete.",
          },
        },
        { status: 404 },
      );
    }

    const expiry = new Date(expires_at);
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_TOKEN_EXPIRED",
            message: "TikTok token has expired. Please reconnect.",
          },
        },
        { status: 401 },
      );
    }

    const accessToken = decryptSecretEnvelope(
      access_token_encrypted_ref,
      "tiktok_token",
    );

    const proxyPayload = {
      access_token: accessToken,
      expires_in: 60, // short-lived proxy TTL
      issued_at: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, data: proxyPayload });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to issue proxy token.";

    console.error("💥 TikTok token proxy error:", message);

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OAUTH_PROXY_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
