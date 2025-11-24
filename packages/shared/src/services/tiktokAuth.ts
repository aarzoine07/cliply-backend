// TikTok OAuth & token management service
// Shared between web and worker for token refresh
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

import { getEnv } from "../env";
import { encryptSecret, decryptSecret } from "../crypto/encryptedSecretEnvelope";

// Simple logger for TikTok auth service
const logger = {
  info: (msg: string, context?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", component: "tiktokAuth", msg, ...context }));
  },
  error: (msg: string, context?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "error", component: "tiktokAuth", msg, ...context }));
  },
};

export interface TikTokTokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  scope: string;
}

export interface TikTokUserInfo {
  openId: string;
  displayName?: string;
}

/**
 * Build TikTok OAuth authorization URL with PKCE
 */
export function buildTikTokAuthUrl(params: {
  workspaceId: string;
  userId: string;
  redirectUri?: string;
}): { url: string; codeVerifier: string } {
  const env = getEnv();
  const clientKey = env.TIKTOK_CLIENT_ID;
  const redirectUri = params.redirectUri || env.TIKTOK_OAUTH_REDIRECT_URL;

  if (!clientKey || !redirectUri) {
    throw new Error("TikTok OAuth not configured: TIKTOK_CLIENT_ID and TIKTOK_OAUTH_REDIRECT_URL required");
  }

  // TikTok requires PKCE
  const codeVerifier = crypto.randomBytes(64).toString("base64url");
  const sha256 = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = Buffer.from(sha256).toString("base64url");

  // TikTok scopes for video upload
  const scopes = ["user.info.basic", "video.upload"];
  const scope = scopes.join(",");

  // Encode state with workspace info and code_verifier
  const state = Buffer.from(
    JSON.stringify({
      workspaceId: params.workspaceId,
      userId: params.userId,
      code_verifier: codeVerifier,
    }),
  ).toString("base64url");

  const params_ = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const url = `https://www.tiktok.com/v2/auth/authorize/?${params_.toString()}`;

  return { url, codeVerifier };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeTikTokCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TikTokTokenData> {
  const env = getEnv();
  const clientKey = env.TIKTOK_CLIENT_ID;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error("TikTok OAuth not configured: TIKTOK_CLIENT_ID and TIKTOK_CLIENT_SECRET required");
  }

  const tokenUrl = "https://open-api.tiktok.com/v2/oauth/token/";
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("TikTok token exchange failed", { status: response.status, error: errorText });
    throw new Error(`Failed to exchange TikTok code: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };

  if (!data.access_token || !data.refresh_token) {
    throw new Error(`TikTok token exchange failed: ${data.error_description ?? "missing tokens"}`);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
    scope: data.scope ?? "user.info.basic,video.upload",
  };
}

/**
 * Fetch TikTok user info using access token
 */
export async function fetchTikTokUserInfo(accessToken: string): Promise<TikTokUserInfo> {
  const response = await fetch("https://open.tiktokapis.com/v2/user/info/", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("TikTok user info fetch failed", { status: response.status, error: errorText });
    throw new Error(`Failed to fetch TikTok user info: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: {
      user?: {
        open_id?: string;
        display_name?: string;
      };
    };
  };

  const openId = data.data?.user?.open_id;
  if (!openId) {
    throw new Error("TikTok user info missing open_id");
  }

  return {
    openId,
    displayName: data.data?.user?.display_name,
  };
}

/**
 * Refresh TikTok access token
 */
export async function refreshTikTokAccessToken(params: {
  refreshToken: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const env = getEnv();
  const clientKey = env.TIKTOK_CLIENT_ID;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    throw new Error("TikTok OAuth not configured: TIKTOK_CLIENT_ID and TIKTOK_CLIENT_SECRET required");
  }

  const tokenUrl = "https://open-api.tiktok.com/v2/oauth/token/";
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("TikTok token refresh failed", { status: response.status, error: errorText });
    throw new Error(`Failed to refresh TikTok token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!data.access_token) {
    throw new Error(`TikTok token refresh failed: ${data.error_description ?? "missing access_token"}`);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

/**
 * Get fresh TikTok access token, refreshing if needed
 * Similar to getFreshYouTubeAccessToken pattern
 */
export async function getFreshTikTokAccessToken(
  connectedAccountId: string,
  ctx: { supabase: SupabaseClient },
): Promise<string> {
  const { data: account, error } = await ctx.supabase
    .from("connected_accounts")
    .select("id,access_token_encrypted_ref,refresh_token_encrypted_ref,expires_at")
    .eq("id", connectedAccountId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (error || !account) {
    throw new Error(`TikTok connected account not found: ${connectedAccountId}`);
  }

  if (!account.access_token_encrypted_ref) {
    throw new Error(`No access token for account: ${connectedAccountId}`);
  }

  if (!account.refresh_token_encrypted_ref) {
    throw new Error(`No refresh token for account: ${connectedAccountId}`);
  }

  const accessToken = decryptSecret(account.access_token_encrypted_ref, { purpose: "tiktok_token" });
  const refreshToken = decryptSecret(account.refresh_token_encrypted_ref, { purpose: "tiktok_token" });

  // Check if token is expired (with 5 minute buffer)
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null;
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt && expiresAt.getTime() > now.getTime() + bufferMs) {
    // Token is still valid
    return accessToken;
  }

  // Token expired or expiring soon - refresh it
  logger.info("Refreshing TikTok access token", { accountId: connectedAccountId });

  const refreshed = await refreshTikTokAccessToken({ refreshToken });

  // Update stored token
  const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();

  const { error: updateError } = await ctx.supabase
    .from("connected_accounts")
    .update({
      access_token_encrypted_ref: encryptSecret(refreshed.accessToken, { purpose: "tiktok_token" }),
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectedAccountId);

  if (updateError) {
    logger.error("Failed to update TikTok token", { accountId: connectedAccountId, error: updateError.message });
    // Still return the new token even if update failed
  }

  return refreshed.accessToken;
}

