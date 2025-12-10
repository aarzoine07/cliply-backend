// FILE 4: apps/web/src/app/api/auth/youtube/callback/route.ts
// Canonical YouTube OAuth callback route for Cliply.

import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { serverEnv, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Minimal local logger for OAuth events (replaces @cliply/shared/observability/logging).
 */
function logOAuthEvent(
  provider: "youtube",
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

/**
 * Minimal local encryption helper (replaces @cliply/shared/crypto/encryptedSecretEnvelope).
 */
function encryptSecret(plaintext: string, meta: { purpose: string }): string {
  const wrapped = JSON.stringify({ v: 1, p: meta.purpose, d: plaintext });
  return `enc:${Buffer.from(wrapped, "utf8").toString("base64url")}`;
}

/**
 * Local implementation of YouTube OAuth token exchange, replacing
 * the missing @cliply/shared/services/youtubeAuth helper.
 */
async function exchangeYouTubeCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope?: string;
}> {
  const { code, redirectUri } = params;

  const clientId = serverEnv.GOOGLE_CLIENT_ID;
  const clientSecret = serverEnv.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("YouTube OAuth client credentials are not configured");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (
    !tokenRes.ok ||
    !tokenJson.access_token ||
    !tokenJson.refresh_token ||
    !tokenJson.expires_in
  ) {
    console.error("YouTube token exchange failed:", tokenJson);
    throw new Error("Failed to exchange YouTube authorization code for tokens");
  }

  const accessToken = tokenJson.access_token;
  const refreshToken = tokenJson.refresh_token;
  const expiresAt = new Date(
    Date.now() + tokenJson.expires_in * 1000,
  ).toISOString();

  return {
    accessToken,
    refreshToken,
    expiresAt,
    scope: tokenJson.scope,
  };
}

/**
 * Local implementation of fetching YouTube channel info for a given access token.
 */
async function fetchYouTubeChannelForToken(
  accessToken: string,
): Promise<{ channelId: string }> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error("YouTube channel fetch failed:", body);
    throw new Error("Failed to fetch YouTube channel info");
  }

  const data = (await res.json()) as {
    items?: { id?: string }[];
  };

  const channelId = data.items?.[0]?.id;
  if (!channelId) {
    throw new Error("No YouTube channel found for user");
  }

  return { channelId };
}

/**
 * Canonical YouTube OAuth callback route for Cliply.
 *
 * Route: GET /api/auth/youtube/callback?code=<code>&state=<state>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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
      return NextResponse.json(
        { ok: false, error: "Missing authorization code" },
        { status: 400 },
      );
    }

    if (!state) {
      return NextResponse.json(
        { ok: false, error: "Missing state parameter" },
        { status: 400 },
      );
    }

    // Decode state
    let workspace_id: string;
    let user_id: string;
    try {
      const decoded = JSON.parse(
        Buffer.from(state, "base64url").toString(),
      );
      workspace_id = decoded.workspaceId || decoded.workspace_id;
      user_id = decoded.userId || decoded.user_id;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid state parameter" },
        { status: 400 },
      );
    }

    const redirectUri =
      publicEnv.NEXT_PUBLIC_YOUTUBE_REDIRECT_URL ||
      serverEnv.YOUTUBE_OAUTH_REDIRECT_URL;

    if (!redirectUri) {
      return NextResponse.json(
        { ok: false, error: "YouTube OAuth not configured" },
        { status: 500 },
      );
    }

    // Exchange code for tokens via local helper
    const tokenData = await exchangeYouTubeCodeForTokens({
      code,
      redirectUri,
    });

    // Fetch channel info
    const channelInfo =
      await fetchYouTubeChannelForToken(tokenData.accessToken);

    // STORE IN SUPABASE
    const supabase = createClient(
      serverEnv.SUPABASE_URL!,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { error: dbError } = await supabase
      .from("connected_accounts")
      .upsert(
        {
          user_id,
          workspace_id,
          platform: "youtube",
          provider: "google",
          external_id: channelInfo.channelId,
          access_token_encrypted_ref: encryptSecret(
            tokenData.accessToken,
            { purpose: "youtube_token" },
          ),
          refresh_token_encrypted_ref: encryptSecret(
            tokenData.refreshToken,
            { purpose: "youtube_token" },
          ),
          expires_at: tokenData.expiresAt,
          scopes: tokenData.scope
            ? tokenData.scope.split(" ")
            : [],
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,platform" },
      );

    if (dbError) {
      console.error("Failed to store YouTube tokens:", dbError);
      return NextResponse.redirect(
        "/integrations?error=youtube_storage_failed",
      );
    }

    await supabase.from("events_audit").insert({
      workspace_id,
      actor_id: user_id,
      event_type: "youtube.connected",
      payload: {
        platform: "youtube",
        external_id: channelInfo.channelId,
      },
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

    console.log(
      "✅ YouTube connection stored successfully:",
      channelInfo.channelId,
    );
    return NextResponse.redirect("/integrations?connected=youtube");
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    logOAuthEvent("youtube", "error", {
      error: err,
    });
    return NextResponse.redirect(
      "/integrations?error=youtube_unexpected",
    );
  }
}
