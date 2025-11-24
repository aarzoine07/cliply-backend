/**
 * LEGACY / DEV-ONLY ROUTE:
 * This endpoint uses the shared TikTok OAuth service but is not the canonical flow.
 * 
 * Canonical TikTok OAuth callback route:
 * - App Router: /api/auth/tiktok/connect/callback (apps/web/src/app/api/auth/tiktok/connect/callback/route.ts)
 * 
 * All new integrations should use the canonical App Router flow.
 */
// TikTok OAuth callback endpoint
// Note: This endpoint is called by TikTok, so it doesn't require user auth
// State parameter contains workspace/user info for validation
import type { NextApiRequest, NextApiResponse } from 'next';

import { getEnv } from '@cliply/shared/env';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import { completeTikTokOAuthFlow } from '@/lib/accounts/tiktokOauthService';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  // Fence: Disable in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(410).json(err('legacy_route_removed', 'This legacy route is no longer available in production. Use /api/auth/tiktok/connect/callback instead.'));
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const started = Date.now();

  try {
    // Parse OAuth callback params
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      logger.error('oauth_tiktok_callback_error', {
        error,
        errorDescription: req.query.error_description as string | undefined,
      });
      res.status(400).json(err('oauth_error', `OAuth error: ${error}`));
      return;
    }

    if (!code) {
      res.status(400).json(err('invalid_request', 'Missing authorization code'));
      return;
    }

    if (!state) {
      res.status(400).json(err('invalid_request', 'Missing state parameter'));
      return;
    }

    // Decode state to get workspace info and code_verifier
    let workspaceId: string;
    let userId: string;
    let codeVerifier: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      workspaceId = decoded.workspaceId;
      userId = decoded.userId;
      codeVerifier = decoded.code_verifier;
    } catch {
      res.status(400).json(err('invalid_request', 'Invalid state parameter'));
      return;
    }

    if (!codeVerifier) {
      res.status(400).json(err('invalid_request', 'Missing code_verifier in state'));
      return;
    }

    // Get redirect URI from env
    const env = getEnv();
    const redirectUri = env.TIKTOK_OAUTH_REDIRECT_URL;
    if (!redirectUri) {
      logger.error('oauth_tiktok_callback_missing_config');
      res.status(500).json(err('internal_error', 'OAuth redirect URI not configured'));
      return;
    }

    // Complete OAuth flow
    const supabase = getAdminClient();
    const result = await completeTikTokOAuthFlow(
      {
        workspaceId,
        userId,
        code,
        redirectUri,
        codeVerifier,
        state,
      },
      { supabase },
    );

    logger.info('oauth_tiktok_callback_success', {
      userId,
      workspaceId,
      accountId: result.accountId,
      openId: result.userInfo.openId,
      durationMs: Date.now() - started,
    });

    // Return success (frontend can redirect to settings page)
    res.status(200).json(ok({
      success: true,
      accountId: result.accountId,
      openId: result.userInfo.openId,
      displayName: result.userInfo.displayName,
    }));
  } catch (error) {
    logger.error('oauth_tiktok_callback_failed', {
      message: (error as Error)?.message ?? 'unknown',
      durationMs: Date.now() - started,
    });

    if ((error as Error)?.message?.includes('not configured')) {
      res.status(500).json(err('internal_error', 'TikTok OAuth not configured'));
      return;
    }

    res.status(500).json(err('internal_error', 'Failed to complete OAuth flow'));
  }
});

