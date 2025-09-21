import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handler, ok } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  let userId: string | undefined;

  try {
    const auth = requireUser(req);
    userId = auth.userId;
    await checkRateLimit(auth.userId, 'oauth:google:callback');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      logger.info('oauth_google_callback_anonymous');
    } else if (error) {
      throw error;
    }
  }

  logger.info('oauth_google_callback', {
    userId: userId ?? 'anonymous',
    hasCode: typeof req.query?.code === 'string',
    durationMs: Date.now() - started,
  });

  res.status(200).json(ok({ connected: true }));
});
