import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sodiumMod from "libsodium-wrappers";

export const dynamic = "force-dynamic";

async function seal(plaintext: string) {
  await sodiumMod.ready;
  const sodium = sodiumMod as typeof sodiumMod;
  const pub = Buffer.from(process.env.SODIUM_PUBLIC_KEY_B64!, "base64");
  const sealed = sodium.crypto_box_seal(Buffer.from(plaintext), pub);
  return Buffer.from(sealed).toString("base64");
}

function getWorkspaceId(req: NextRequest) {
  // Adjust to your auth: read from session/cookie/header as appropriate
  const ws = req.cookies.get("wsid")?.value;
  return ws || null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("tt_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.json({ ok: false, error: "STATE_MISMATCH" }, { status: 400 });
  }
  const workspace_id = getWorkspaceId(req);
  if (!workspace_id) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    client_secret: process.env.TIKTOK_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL!,
  });

  const tokenRes = await fetch("https://open-api.tiktok.com/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok || !data?.access_token) {
    return NextResponse.json({ ok: false, error: "TOKEN_EXCHANGE_FAILED" }, { status: 400 });
  }

  // Fetch TikTok user info to get external_id (required by DB schema)
  let externalId = "unknown";
  try {
    const userInfoRes = await fetch("https://open.tiktokapis.com/v2/user/info/", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      externalId = userInfo.data?.user?.open_id || "unknown";
    }
  } catch {
    // Continue with "unknown" if fetch fails
  }

  // Get a user_id from workspace_members (required by DB schema)
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: member } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspace_id)
    .limit(1)
    .maybeSingle();

  if (!member?.user_id) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_USER_NOT_FOUND" }, { status: 400 });
  }

  const accessEnc = await seal(String(data.access_token));
  const refreshEnc = data.refresh_token ? await seal(String(data.refresh_token)) : null;
  const expiresAt = data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;

  const { error } = await supabase.from("connected_accounts").upsert(
    {
      user_id: member.user_id,
      workspace_id,
      platform: "tiktok",
      provider: "tiktok",
      external_id: externalId,
      access_token_encrypted_ref: accessEnc,
      refresh_token_encrypted_ref: refreshEnc,
      expires_at: expiresAt,
    },
    { onConflict: "workspace_id,platform" }
  );
  if (error) {
    return NextResponse.json({ ok: false, error: "DB_UPSERT_FAILED" }, { status: 500 });
  }

  const res = NextResponse.redirect("/integrations?connected=tiktok", 302);
  res.cookies.delete("tt_state");
  return res;
}

