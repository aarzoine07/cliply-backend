/**
 * Canonical YouTube OAuth callback route for Cliply.
 * 
 * This is the primary endpoint for handling YouTube OAuth callbacks.
 * All new integrations should use this route.
 * 
 * Route: GET /api/auth/youtube/callback?code=<code>&state=<state>
 * 
 * Legacy routes (dev-only, disabled in production):
 * - /api/oauth/google/callback (Pages Router)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { encryptSecret } from "@cliply/shared/crypto/encryptedSecretEnvelope";
import { logOAuthEvent } from "@cliply/shared/observability/logging";
import {
  exchangeYouTubeCodeForTokens,
  fetchYouTubeChannelForToken,
} from "@cliply/shared/services/youtubeAuth";
import { serverEnv, publicEnv } from "@/lib/env";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      console.error("YouTube OAuth error:", error);
      logOAuthEvent("youtube", "error", {
        error: new Error(`YouTube OAuth error: ${error}`),
      });
      return NextResponse.redirect("/integrations?error=youtube_auth_failed");
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
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      workspace_id = decoded.workspaceId || decoded.workspace_id;
      user_id = decoded.userId || decoded.user_id;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid state parameter" }, { status: 400 });
    }

    const redirectUri = publicEnv.NEXT_PUBLIC_YOUTUBE_REDIRECT_URL || serverEnv.YOUTUBE_OAUTH_REDIRECT_URL;
    if (!redirectUri) {
      return NextResponse.json({ ok: false, error: "YouTube OAuth not configured" }, { status: 500 });
    }

    // Exchange code for tokens
    const tokenData = await exchangeYouTubeCodeForTokens({
      code,
      redirectUri,
    });

    // Fetch channel info
    const channelInfo = await fetchYouTubeChannelForToken(tokenData.accessToken);

    // STORE IN SUPABASE
    const supabase = createClient(
      serverEnv.SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { error: dbError } = await supabase.from("connected_accounts").upsert(
      {
        user_id,
        workspace_id,
        platform: "youtube",
        provider: "google",
        external_id: channelInfo.channelId,
        access_token_encrypted_ref: encryptSecret(tokenData.accessToken, { purpose: "youtube_token" }),
        refresh_token_encrypted_ref: encryptSecret(tokenData.refreshToken, { purpose: "youtube_token" }),
        expires_at: tokenData.expiresAt,
        scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,platform" }
    );

    if (dbError) {
      console.error("Failed to store YouTube tokens:", dbError);
      return NextResponse.redirect("/integrations?error=youtube_storage_failed");
    }

    await supabase.from("events_audit").insert({
      workspace_id,
      actor_id: user_id,
      event_type: "youtube.connected",
      payload: { platform: "youtube", external_id: channelInfo.channelId },
    });

    // Get connected account ID for logging
    const { data: account } = await supabase
      .from("connected_accounts")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("platform", "youtube")
      .maybeSingle();

    logOAuthEvent("youtube", "success", {
      workspaceId: workspace_id,
      userId: user_id,
      connectedAccountId: account?.id,
      externalId: channelInfo.channelId,
    });

    console.log("✅ YouTube connection stored successfully:", channelInfo.channelId);
    return NextResponse.redirect("/integrations?connected=youtube");
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    logOAuthEvent("youtube", "error", {
      error: err,
    });
    return NextResponse.redirect("/integrations?error=youtube_unexpected");
  }
}

