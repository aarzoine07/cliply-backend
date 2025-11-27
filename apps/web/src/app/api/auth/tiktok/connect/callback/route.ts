/**
 * Canonical TikTok OAuth callback route for Cliply.
 * 
 * This is the primary endpoint for handling TikTok OAuth callbacks.
 * All new integrations should use this route.
 * 
 * Route: GET /api/auth/tiktok/connect/callback?code=<code>&state=<state>
 * 
 * Legacy routes (dev-only, disabled in production):
 * - /api/auth/tiktok_legacy/callback (Pages Router)
 * - /api/oauth/tiktok/callback (Pages Router)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { encryptSecret } from "@cliply/shared/crypto/encryptedSecretEnvelope";
import { logOAuthEvent } from "@cliply/shared/observability/logging";
import { serverEnv, publicEnv } from "@/lib/env";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("TikTok OAuth error:", error);
      logOAuthEvent("tiktok", "error", {
        error: new Error(`TikTok OAuth error: ${error}`),
      });
      return NextResponse.redirect("/integrations?error=tiktok_auth_failed");
    }

    if (!code) {
      return NextResponse.json({ ok: false, error: "Missing authorization code" }, { status: 400 });
    }

    if (!state) {
      return NextResponse.json({ ok: false, error: "Missing state parameter" }, { status: 400 });
    }

    // Decode state
    let workspace_id: string;
    let user_id: string;
    let code_verifier: string | undefined;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      workspace_id = decoded.workspace_id;
      user_id = decoded.user_id;
      code_verifier = decoded.code_verifier;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid state parameter" }, { status: 400 });
    }

    const clientKey = serverEnv.TIKTOK_CLIENT_ID;
    const clientSecret = serverEnv.TIKTOK_CLIENT_SECRET;
    const redirectUri = publicEnv.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

    if (!clientKey || !clientSecret || !redirectUri) {
      return NextResponse.json({ ok: false, error: "TikTok OAuth not configured" }, { status: 500 });
    }

    // TOKEN EXCHANGE
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    if (code_verifier) params.append("code_verifier", code_verifier);

    const tokenRes = await fetch("https://open-api.tiktok.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("TikTok token exchange failed:", tokenData);
      logOAuthEvent("tiktok", "error", {
        workspaceId: workspace_id,
        userId: user_id,
        error: new Error("Token exchange failed"),
      });
      return NextResponse.redirect("/integrations?error=tiktok_token_failed");
    }

    // USER INFO FETCH
    const userInfoRes = await fetch("https://open.tiktokapis.com/v2/user/info/", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let externalId = "unknown";
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      externalId = userInfo.data?.user?.open_id || "unknown";
    }

    // STORE IN SUPABASE
    const supabase = createClient(
      serverEnv.SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: dbError } = await supabase.from("connected_accounts").upsert(
      {
        user_id,
        workspace_id,
        platform: "tiktok",
        provider: "tiktok",
        external_id: externalId,
        access_token_encrypted_ref: encryptSecret(tokenData.access_token, { purpose: "tiktok_token" }),
        refresh_token_encrypted_ref: encryptSecret(tokenData.refresh_token, { purpose: "tiktok_token" }),
        expires_at: expiresAt,
        scopes: tokenData.scope ? tokenData.scope.split(",") : ["user.info.basic", "video.upload"],
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,platform" }
    );

    if (dbError) {
      console.error("Failed to store TikTok tokens:", dbError);
      return NextResponse.redirect("/integrations?error=tiktok_storage_failed");
    }

    await supabase.from("events_audit").insert({
      workspace_id,
      actor_id: user_id,
      event_type: "tiktok.connected",
      payload: { platform: "tiktok", external_id: externalId },
    });

    // Get connected account ID for logging
    const { data: account } = await supabase
      .from("connected_accounts")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("platform", "tiktok")
      .maybeSingle();

    logOAuthEvent("tiktok", "success", {
      workspaceId: workspace_id,
      userId: user_id,
      connectedAccountId: account?.id,
      externalId,
    });

    console.log("✅ TikTok connection stored successfully:", externalId);
    return NextResponse.redirect("/integrations?connected=tiktok");
  } catch (err) {
    console.error("TikTok OAuth callback error:", err);
    logOAuthEvent("tiktok", "error", {
      error: err,
    });
    return NextResponse.redirect("/integrations?error=tiktok_unexpected");
  }
}
