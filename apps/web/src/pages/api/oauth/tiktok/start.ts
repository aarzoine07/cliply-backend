/**
 * LEGACY / DEV-ONLY ROUTE:
 * This endpoint uses the shared TikTok OAuth service but is not the canonical flow.
 * 
 * Canonical TikTok OAuth connect route:
 * - App Router: /api/auth/tiktok/connect (apps/web/src/app/api/auth/tiktok/connect/route.ts)
 * 
 * All new integrations should use the canonical App Router flow.
 */
// TikTok OAuth start endpoint
import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildTikTokAuthUrl } from '@/lib/accounts/tiktokOauthService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  // Fence: Disable in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(410).json(err('legacy_route_removed', 'This legacy route is no longer available in production. Use /api/auth/tiktok/connect instead.'));
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const started = Date.now();

  try {
    const auth = await buildAuthContext(req);
    const userId = auth.userId || auth.user_id;
    const workspaceId = auth.workspaceId || auth.workspace_id;

    if (!workspaceId) {
      res.status(400).json(err('invalid_request', 'workspace required'));
      return;
    }

    await checkRateLimit(userId, 'oauth:tiktok:start');

    const redirectUri = req.query.redirect_uri as string | undefined;
    const { url } = buildTikTokAuthUrl({
      workspaceId,
      userId,
      redirectUri,
    });

    logger.info('oauth_tiktok_start', {
      userId,
      workspaceId,
      durationMs: Date.now() - started,
    });

    res.status(200).json(ok({ url }));
  } catch (error) {
    // Handle auth errors
    if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
      handleAuthError(error, res);
      return;
    }

    logger.error('oauth_tiktok_start_failed', {
      message: (error as Error)?.message ?? 'unknown',
      durationMs: Date.now() - started,
    });

    if ((error as Error)?.message?.includes('not configured')) {
      res.status(500).json(err('internal_error', 'TikTok OAuth not configured'));
      return;
    }

    res.status(500).json(err('internal_error', 'Failed to start OAuth flow'));
  }
});

