import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('cron_scan_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId } = auth;

  const rate = await checkRateLimit(userId, 'cron:scan');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from('schedules')
    .select('id, clip_id, workspace_id, run_at')
    .eq('status', 'scheduled')
    .lte('run_at', nowIso);

  if (error) {
    logger.error('cron_scan_query_failed', { message: error.message });
    res.status(500).json(err('internal_error', 'Failed to query schedules'));
    return;
  }

  let enqueued = 0;
  const items = due ?? [];

  for (const schedule of items) {
    const jobInsert = await admin
      .from('jobs')
      .insert({
        workspace_id: schedule.workspace_id,
        kind: 'PUBLISH_YOUTUBE',
        status: 'queued',
        payload: { clipId: schedule.clip_id },
      });

    if (jobInsert.error) {
      logger.error('cron_scan_job_insert_failed', {
        scheduleId: schedule.id,
        message: jobInsert.error.message,
      });
      continue;
    }

    const update = await admin
      .from('schedules')
      .update({ status: 'executed' })
      .eq('id', schedule.id);

    if (update.error) {
      logger.error('cron_scan_schedule_update_failed', {
        scheduleId: schedule.id,
        message: update.error.message,
      });
      continue;
    }

    enqueued += 1;
  }

  logger.info('cron_scan_success', { durationMs: Date.now() - started, enqueued, inspected: items.length });
  res.status(200).json(ok({ enqueued, inspected: items.length }));
});