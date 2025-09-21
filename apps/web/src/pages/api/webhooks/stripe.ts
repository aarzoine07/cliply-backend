import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  logger.info('stripe_webhook_received', {
    hasBody: Boolean(req.body),
    eventType: typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>).type : undefined,
  });

  res.status(200).json(ok());
});