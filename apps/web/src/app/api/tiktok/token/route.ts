import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { buildAuthContext } from "@cliply/shared/auth/context";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase credentials are not configured for TikTok token proxy.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function sealedBoxDecryptRef(ref: string): Promise<string> {
  if (!ref.startsWith("sbx:")) throw new Error("Invalid sealed-box reference");
  return Buffer.from(ref.slice(4), "base64url").toString("utf8");
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await buildAuthContext(request);
    if (!auth.workspace_id) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "OAUTH_WORKSPACE_MISSING", message: "Missing workspace context." },
        },
        { status: 401 },
      );
    }

    const { data, error } = await supabase
      .from("connected_accounts")
      .select("access_token_encrypted_ref, expires_at")
      .eq("workspace_id", auth.workspace_id)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "OAUTH_TOKEN_NOT_FOUND", message: "No TikTok account connected." },
        },
        { status: 404 },
      );
    }

    const { access_token_encrypted_ref, expires_at } = data;
    if (!access_token_encrypted_ref || !expires_at) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "OAUTH_TOKEN_NOT_FOUND", message: "TikTok account is incomplete." },
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

    const accessToken = await sealedBoxDecryptRef(access_token_encrypted_ref);
    const proxyPayload = {
      access_token: accessToken,
      expires_in: 60,
      issued_at: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, data: proxyPayload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to issue proxy token.";
    console.error("💥 TikTok token proxy error:", message);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "OAUTH_PROXY_ERROR", message },
      },
      { status: 500 },
    );
  }
}
