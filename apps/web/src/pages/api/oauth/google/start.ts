// C2: YouTube OAuth start endpoint
import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildYouTubeAuthUrl } from '@/lib/accounts/youtubeOauthService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
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

    // ✅ New: make sure userId is present and narrow its type to `string`
    if (!userId) {
      logger.warn('oauth_google_start_missing_user', {
        workspaceId,
        durationMs: Date.now() - started,
      });

      res.status(401).json(err('missing_user', 'user required'));
      return;
    }

    await checkRateLimit(userId, 'oauth:google:start');

    const redirectUri = req.query.redirect_uri as string | undefined;
    const authUrl = buildYouTubeAuthUrl({
      workspaceId,
      userId,
      redirectUri,
    });

    logger.info('oauth_google_start', {
      userId,
      workspaceId,
      durationMs: Date.now() - started,
    });

    res.status(200).json(ok({ url: authUrl }));
  } catch (error) {
    // Handle auth errors
    if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
      handleAuthError(error, res);
      return;
    }

    logger.error('oauth_google_start_failed', {
      message: (error as Error)?.message ?? 'unknown',
      durationMs: Date.now() - started,
    });

    if ((error as Error)?.message?.includes('not configured')) {
      res.status(500).json(err('internal_error', 'YouTube OAuth not configured'));
      return;
    }

    res.status(500).json(err('internal_error', 'Failed to start OAuth flow'));
  }
});