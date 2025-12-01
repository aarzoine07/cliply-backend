// C2: YouTube OAuth service layer for web app
// Wraps shared youtubeAuth service with connected account persistence
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildYouTubeAuthUrl as buildAuthUrl,
  exchangeYouTubeCodeForTokens,
  fetchYouTubeChannelForToken,
  type YouTubeChannelInfo,
  type YouTubeTokenData,
} from "@cliply/shared/services/youtubeAuth";
import { encryptSecret } from "@cliply/shared/crypto/encryptedSecretEnvelope";

import { logger } from "../logger";
import * as connectedAccountsService from "./connectedAccountsService";
import { getEnv, type Env } from "@cliply/shared/env";

type GetEnv = typeof getEnv;

/**
 * Build YouTube OAuth authorization URL for a workspace
 * Accepts optional getEnv for dependency injection in tests
 */
export function buildYouTubeAuthUrl(
  params: {
    workspaceId: string;
    userId: string;
    redirectUri?: string;
  },
  deps?: { getEnv?: GetEnv }
): string {
  // Pass through DI
  return buildAuthUrl(params, { getEnv: deps?.getEnv ?? getEnv });
}

/**
 * Complete YouTube OAuth flow: exchange code, fetch channel, save account
 */
export async function completeYouTubeOAuthFlow(params: {
  workspaceId: string;
  userId: string;
  code: string;
  redirectUri: string;
  state?: string;
}, ctx: { supabase: SupabaseClient }): Promise<{ accountId: string; channelInfo: YouTubeChannelInfo }> {
  // Exchange code for tokens
  const tokenData = await exchangeYouTubeCodeForTokens({
    code: params.code,
    redirectUri: params.redirectUri,
  });

  // Fetch channel info
  const channelInfo = await fetchYouTubeChannelForToken(tokenData.accessToken);

  // Encrypt tokens before storing (same pattern as TikTok)
  const encryptedAccessToken = encryptSecret(tokenData.accessToken, { purpose: "youtube_token" });
  const encryptedRefreshToken = tokenData.refreshToken
    ? encryptSecret(tokenData.refreshToken, { purpose: "youtube_token" })
    : undefined;

  // Upsert connected account
  const account = await connectedAccountsService.createOrUpdateConnectedAccount(
    {
      workspaceId: params.workspaceId,
      userId: params.userId,
      platform: "youtube",
      provider: "google",
      external_id: channelInfo.channelId,
      display_name: channelInfo.channelTitle,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      scopes: tokenData.scope ? tokenData.scope.split(" ") : [],
      expires_at: tokenData.expiresAt,
    },
    ctx,
  );

  logger.info("youtube_oauth_completed", {
    workspaceId: params.workspaceId,
    accountId: account.id,
    channelId: channelInfo.channelId,
  });

  return {
    accountId: account.id,
    channelInfo,
  };
}

