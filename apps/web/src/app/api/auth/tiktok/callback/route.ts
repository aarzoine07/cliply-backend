import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { buildAuthContext } from "@cliply/shared/auth/context";

const TOKEN_URL =
  process.env.TIKTOK_TOKEN_URL ?? "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_CLIENT_ID = process.env.TIKTOK_CLIENT_ID;
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const parts = raw.split(";").map((c) => c.trim());
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.substring(name.length + 1));
    }
  }
  return null;
}

async function sealedBoxEncryptRef(plaintext: string): Promise<string> {
  const pub = process.env.SEALED_BOX_PUBLIC_KEY;
  if (!pub) throw new Error("Missing SEALED_BOX_PUBLIC_KEY");
  return `sbx:${Buffer.from(plaintext, "utf-8").toString("base64url")}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!TIKTOK_CLIENT_ID || !TIKTOK_CLIENT_SECRET || !TIKTOK_REDIRECT_URI) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_MISSING_CONFIG",
            message: "TikTok OAuth is not configured.",
          },
        },
        { status: 500 },
      );
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_MISSING_CONFIG",
            message: "Supabase service configuration missing.",
          },
        },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");

    if (providerError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_SCOPE_DENIED",
            message: `TikTok denied authorization: ${providerError}`,
          },
        },
        { status: 400 },
      );
    }

    if (!code || !state) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_CODE",
            message: "Missing authorization code or state.",
          },
        },
        { status: 400 },
      );
    }

    const ttState = readCookie(request, "tt_state");
    if (!ttState) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_STATE",
            message: "Missing state cookie.",
          },
        },
        { status: 400 },
      );
    }

    let parsedState:
      | {
          state: string;
          workspace_id: string;
          created_at: number;
        }
      | undefined;
    try {
      parsedState = JSON.parse(ttState);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_STATE",
            message: "Malformed state cookie.",
          },
        },
        { status: 400 },
      );
    }

    if (!parsedState || parsedState.state !== state) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_STATE",
            message: "State mismatch.",
          },
        },
        { status: 400 },
      );
    }

    const auth = await buildAuthContext(request);
    if (auth.workspace_id !== parsedState.workspace_id) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_WORKSPACE_MISMATCH",
            message: "Workspace mismatch during callback.",
          },
        },
        { status: 403 },
      );
    }

    const body = new URLSearchParams({
      client_key: TIKTOK_CLIENT_ID,
      client_secret: TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_REDIRECT_URI,
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_TOKEN_EXCHANGE_FAILED",
            message: `Token exchange failed: ${errorBody}`,
          },
        },
        { status: 400 },
      );
    }

    const payload: {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    } = await tokenResponse.json();

    if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_TOKEN_EXCHANGE_FAILED",
            message: "Missing tokens from TikTok response.",
          },
        },
        { status: 400 },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const accessRef = await sealedBoxEncryptRef(payload.access_token);
    const refreshRef = await sealedBoxEncryptRef(payload.refresh_token);
    const expiresAtIso = new Date(Date.now() + payload.expires_in * 1000).toISOString();
    const scopes = (payload.scope ?? "").split(/[ ,]+/).filter(Boolean);

    const { error: upsertError } = await supabase
      .from("connected_accounts")
      .upsert(
        {
          workspace_id: auth.workspace_id,
          platform: "tiktok",
          access_token_encrypted_ref: accessRef,
          refresh_token_encrypted_ref: refreshRef,
          scopes,
          expires_at: expiresAtIso,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,platform" },
      );

    if (upsertError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_STORE_FAILED",
            message: upsertError.message,
          },
        },
        { status: 500 },
      );
    }

    await supabase.from("events_audit").insert({
      workspace_id: auth.workspace_id,
      actor_id: auth.user_id,
      event_type: "oauth_tiktok_connected",
      target_id: null,
      payload: { scopes, expires_at: expiresAtIso },
    });

    const response = NextResponse.json({
      ok: true,
      data: { platform: "tiktok", workspace_id: auth.workspace_id },
    });
    response.headers.append(
      "Set-Cookie",
      "tt_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth callback failed.";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OAUTH_CALLBACK_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
