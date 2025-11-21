import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { buildAuthContext } from "@cliply/shared/auth/context";
import sodiumMod from "libsodium-wrappers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getSupabaseClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase credentials are not configured for TikTok token proxy.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sealedBoxDecryptRef(ref: string): Promise<string> {
  if (!ref.startsWith("sbx:")) throw new Error("Invalid sealed-box reference");
  return Buffer.from(ref.slice(4), "base64url").toString("utf8");
}

async function openSeal(sealedB64: string) {
  await sodiumMod.ready;
  const sodium = sodiumMod as typeof sodiumMod;
  const pub = Buffer.from(process.env.SODIUM_PUBLIC_KEY_B64!, "base64");
  const sec = Buffer.from(process.env.SODIUM_SECRET_KEY_B64!, "base64");
  const cipher = Buffer.from(sealedB64, "base64");
  const plain = sodium.crypto_box_seal_open(cipher, pub, sec);
  return Buffer.from(plain).toString("utf8");
}

async function seal(plaintext: string) {
  await sodiumMod.ready;
  const sodium = sodiumMod as typeof sodiumMod;
  const pub = Buffer.from(process.env.SODIUM_PUBLIC_KEY_B64!, "base64");
  const sealed = sodium.crypto_box_seal(Buffer.from(plaintext), pub);
  return Buffer.from(sealed).toString("base64");
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

    const supabase = getSupabaseClient();
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

export async function POST(req: NextRequest) {
  try {
    const { account_id } = await req.json().catch(() => ({}));
    if (!account_id) return NextResponse.json({ ok: false, error: "ACCOUNT_ID_REQUIRED" }, { status: 400 });

    const supabase = getSupabaseClient();
    const { data: acct, error: qErr } = await supabase
      .from("connected_accounts")
      .select("id, workspace_id, platform, refresh_token_encrypted_ref")
      .eq("id", account_id)
      .eq("platform", "tiktok")
      .single();
    if (qErr || !acct?.refresh_token_encrypted_ref) {
      return NextResponse.json({ ok: false, error: "ACCOUNT_NOT_FOUND_OR_NO_REFRESH" }, { status: 404 });
    }

    // Try to decrypt - handle both old format (sbx:) and new format (Base64 sealed-box)
    let refresh_token: string;
    try {
      if (acct.refresh_token_encrypted_ref.startsWith("sbx:")) {
        refresh_token = await sealedBoxDecryptRef(acct.refresh_token_encrypted_ref);
      } else {
        refresh_token = await openSeal(acct.refresh_token_encrypted_ref);
      }
    } catch (decryptError) {
      return NextResponse.json({ ok: false, error: "TOKEN_DECRYPT_FAILED" }, { status: 500 });
    }

    const body = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token,
    });
    const tokenRes = await fetch("https://open-api.tiktok.com/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data?.access_token) {
      return NextResponse.json({ ok: false, error: "REFRESH_FAILED" }, { status: 400 });
    }

    const accessEnc = await seal(String(data.access_token));
    const refreshEnc = data.refresh_token ? await seal(String(data.refresh_token)) : null;
    const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
    const { error: uErr } = await supabase
      .from("connected_accounts")
      .update({
        access_token_encrypted_ref: accessEnc,
        refresh_token_encrypted_ref: refreshEnc ?? undefined,
        expires_at: expiresAt ?? undefined,
      })
      .eq("id", account_id);
    if (uErr) return NextResponse.json({ ok: false, error: "DB_UPDATE_FAILED" }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh token.";
    return NextResponse.json({ ok: false, error: "REFRESH_ERROR" }, { status: 500 });
  }
}
