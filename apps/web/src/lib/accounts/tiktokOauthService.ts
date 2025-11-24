// TikTok OAuth service layer for web app
// Wraps shared tiktokAuth service with connected account persistence
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildTikTokAuthUrl as buildAuthUrl,
  exchangeTikTokCodeForTokens,
  fetchTikTokUserInfo,
  type TikTokTokenData,
  type TikTokUserInfo,
} from "@cliply/shared/services/tiktokAuth";

import { logger } from "../logger";
import * as connectedAccountsService from "./connectedAccountsService";

/**
 * Build TikTok OAuth authorization URL for a workspace
 */
export function buildTikTokAuthUrl(params: {
  workspaceId: string;
  userId: string;
  redirectUri?: string;
}): { url: string; codeVerifier: string } {
  return buildAuthUrl(params);
}

/**
 * Complete TikTok OAuth flow: exchange code, fetch user info, save account
 */
export async function completeTikTokOAuthFlow(params: {
  workspaceId: string;
  userId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  state?: string;
}, ctx: { supabase: SupabaseClient }): Promise<{ accountId: string; userInfo: TikTokUserInfo }> {
  // Exchange code for tokens
  const tokenData = await exchangeTikTokCodeForTokens({
    code: params.code,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
  });

  // Fetch user info
  const userInfo = await fetchTikTokUserInfo(tokenData.accessToken);

  // Calculate expires_at
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();

  // Upsert connected account
  const account = await connectedAccountsService.createOrUpdateConnectedAccount(
    {
      workspaceId: params.workspaceId,
      userId: params.userId,
      platform: "tiktok",
      provider: "tiktok",
      external_id: userInfo.openId,
      display_name: userInfo.displayName || "TikTok Account",
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      scopes: tokenData.scope ? tokenData.scope.split(",") : [],
      expires_at: expiresAt,
    },
    ctx,
  );

  logger.info("tiktok_oauth_completed", {
    workspaceId: params.workspaceId,
    accountId: account.id,
    openId: userInfo.openId,
  });

  return {
    accountId: account.id,
    userInfo,
  };
}

