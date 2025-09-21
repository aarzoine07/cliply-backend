import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('dashboard_ready_start', { method: req.method ?? 'GET' });

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId, supabase } = auth;

  const rate = await checkRateLimit(userId, 'dashboard:ready');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  let query = supabase.from('clips').select('*').eq('status', 'ready');
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('dashboard_ready_query_failed', { message: error.message });
    res.status(500).json(err('internal_error', 'Failed to fetch ready clips'));
    return;
  }

  logger.info('dashboard_ready_success', {
    userId,
    count: data?.length ?? 0,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok({ items: data ?? [] }));
});