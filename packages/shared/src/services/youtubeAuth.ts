// C2: YouTube OAuth & token management service
// Shared between web and worker for token refresh
import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "../env";

// Simple logger for YouTube auth service
const logger = {
  info: (msg: string, context?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: "info", component: "youtubeAuth", msg, ...context }));
  },
  error: (msg: string, context?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: "error", component: "youtubeAuth", msg, ...context }));
  },
};

export interface YouTubeTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO datetime
  scope: string;
}

export interface YouTubeChannelInfo {
  channelId: string;
  channelTitle: string;
}

/**
 * Build YouTube OAuth authorization URL
 */
export function buildYouTubeAuthUrl(params: {
  workspaceId: string;
  userId: string;
  redirectUri?: string;
}): string {
  const env = getEnv();
  const clientId = env.GOOGLE_CLIENT_ID;
  const redirectUri = params.redirectUri || env.YOUTUBE_OAUTH_REDIRECT_URL;

  if (!clientId || !redirectUri) {
    throw new Error("YouTube OAuth not configured: GOOGLE_CLIENT_ID and YOUTUBE_OAUTH_REDIRECT_URL required");
  }

  // YouTube upload scope
  const scope = "https://www.googleapis.com/auth/youtube.upload";
  const responseType = "code";
  const accessType = "offline"; // Required to get refresh token
  const prompt = "consent"; // Force consent to get refresh token

  // Encode state with workspace info
  const state = Buffer.from(
    JSON.stringify({
      workspaceId: params.workspaceId,
      userId: params.userId,
    }),
  ).toString("base64url");

  const params_ = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope,
    access_type: accessType,
    prompt,
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params_.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeYouTubeCodeForTokens(params: {
  code: string;
  redirectUri: string;
}): Promise<YouTubeTokenData> {
  const env = getEnv();
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("YouTube OAuth not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required");
  }

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
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
    logger.error("youtube_oauth_token_exchange_failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Failed to exchange code for tokens: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  if (!data.access_token) {
    throw new Error("No access token in response");
  }

  // Calculate expiry (expires_in is in seconds)
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "", // May be missing if refresh token already exists
    expiresAt,
    scope: data.scope || "",
  };
}

/**
 * Fetch YouTube channel info using access token
 */
export async function fetchYouTubeChannelForToken(accessToken: string): Promise<YouTubeChannelInfo> {
  const apiUrl = "https://www.googleapis.com/youtube/v3/channels";
  const params = new URLSearchParams({
    part: "snippet",
    mine: "true",
  });

  const response = await fetch(`${apiUrl}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("youtube_channel_fetch_failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Failed to fetch YouTube channel: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
      };
    }>;
  };

  if (!data.items || data.items.length === 0) {
    throw new Error("No YouTube channel found");
  }

  const channel = data.items[0];
  if (!channel.id || !channel.snippet?.title) {
    throw new Error("Invalid channel data");
  }

  return {
    channelId: channel.id,
    channelTitle: channel.snippet.title,
  };
}

/**
 * Refresh YouTube access token
 */
export async function refreshYouTubeAccessToken(refreshToken: string): Promise<Omit<YouTubeTokenData, "refreshToken">> {
  const env = getEnv();
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("YouTube OAuth not configured: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required");
  }

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
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
    logger.error("youtube_token_refresh_failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  if (!data.access_token) {
    throw new Error("No access token in refresh response");
  }

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

  return {
    accessToken: data.access_token,
    expiresAt,
    scope: data.scope || "",
  };
}

/**
 * Get a fresh YouTube access token for a connected account
 * Refreshes if needed (expires within 5 minutes)
 */
export async function getFreshYouTubeAccessToken(
  accountId: string,
  ctx: { supabase: SupabaseClient },
): Promise<string> {
  // Fetch account with tokens
  const { data: account, error } = await ctx.supabase
    .from("connected_accounts")
    .select("id, access_token_encrypted_ref, refresh_token_encrypted_ref, expires_at, platform")
    .eq("id", accountId)
    .eq("platform", "youtube")
    .single();

  if (error || !account) {
    throw new Error(`Connected account not found: ${accountId}`);
  }

  if (!account.access_token_encrypted_ref) {
    throw new Error(`No access token for account: ${accountId}`);
  }

  // Check if token is expired or expiring soon (within 5 minutes)
  const now = new Date();
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() < now.getTime() + 5 * 60 * 1000;

  if (!needsRefresh) {
    return account.access_token_encrypted_ref; // Return existing token
  }

  // Need to refresh
  if (!account.refresh_token_encrypted_ref) {
    throw new Error(`No refresh token for account: ${accountId}`);
  }

  logger.info("youtube_token_refreshing", {
    accountId,
    expiresAt: account.expires_at,
  });

  const refreshed = await refreshYouTubeAccessToken(account.refresh_token_encrypted_ref);

  // Update account with new token
  const { error: updateError } = await ctx.supabase
    .from("connected_accounts")
    .update({
      access_token_encrypted_ref: refreshed.accessToken,
      expires_at: refreshed.expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  if (updateError) {
    logger.error("youtube_token_update_failed", {
      accountId,
      error: updateError.message,
    });
    throw new Error(`Failed to update token: ${updateError.message}`);
  }

  logger.info("youtube_token_refreshed", {
    accountId,
    newExpiresAt: refreshed.expiresAt,
  });

  return refreshed.accessToken;
}

