import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';

const CompleteBody = z.object({ projectId: z.string().uuid() }).strict();

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('upload_complete_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId } = auth;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  const rate = await checkRateLimit(userId, 'upload:complete');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const admin = getAdminClient();
  const { error } = await admin.from('jobs').insert({
    workspace_id: workspaceId,
    kind: 'TRANSCRIBE',
    status: 'queued',
    payload: { projectId: parsed.data.projectId },
  });

  if (error) {
    logger.error('upload_complete_enqueue_failed', {
      workspaceId,
      message: error.message,
    });
    res.status(500).json(err('internal_error', 'Failed to enqueue transcript job'));
    return;
  }

  logger.info('upload_complete_success', {
    userId,
    workspaceId,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok());
});
