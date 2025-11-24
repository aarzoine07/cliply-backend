import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { getAdminClient } from '@/lib/supabase';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('schedules_list_start', { method: req.method ?? 'GET' });

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const userId = auth.userId || auth.user_id;
  const workspaceId = auth.workspaceId || auth.workspace_id;
  const supabase = getAdminClient();

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  const rate = await checkRateLimit(userId, 'schedules:list');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const { data, error } = await supabase.from('schedules').select('*').eq('workspace_id', workspaceId);
  if (error) {
    logger.error('schedules_list_query_failed', { message: error.message, workspaceId });
    res.status(500).json(err('internal_error', 'Failed to fetch schedules'));
    return;
  }

  logger.info('schedules_list_success', {
    userId,
    workspaceId,
    count: data?.length ?? 0,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok({ items: data ?? [] }));
});