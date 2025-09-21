import { ScheduleCancelInput } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('schedule_cancel_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId, supabase } = auth;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  const rate = await checkRateLimit(userId, 'schedules:cancel');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const idParam = (req.query?.id ?? '') as string | string[];
  const scheduleId = Array.isArray(idParam) ? idParam[0] : idParam;
  if (!scheduleId) {
    res.status(400).json(err('invalid_request', 'missing id'));
    return;
  }

  const parsed = ScheduleCancelInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const update = await supabase
    .from('schedules')
    .update({ status: 'canceled' })
    .eq('id', scheduleId)
    .eq('workspace_id', workspaceId);

  if (update.error) {
    logger.error('schedule_cancel_update_failed', { message: update.error.message, scheduleId });
    res.status(500).json(err('internal_error', 'Failed to cancel schedule'));
    return;
  }

  logger.info('schedule_cancel_success', {
    userId,
    scheduleId,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok());
});
