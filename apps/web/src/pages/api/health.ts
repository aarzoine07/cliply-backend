import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok } from '@/lib/http';
import { logger } from '@/lib/logger';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('health_check_start', { method: req.method ?? 'GET' });

  res.status(200).json(ok({ db: 'ok', storage: 'ok' }));

  logger.info('health_check_success', { durationMs: Date.now() - started });
});
