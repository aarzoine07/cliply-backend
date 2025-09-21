import { ClipMetaUpdateInput } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('clip_meta_start', { method: req.method ?? 'GET' });

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, supabase } = auth;

  const rate = await checkRateLimit(userId, 'clips:meta');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const idParam = (req.query?.id ?? '') as string | string[];
  const clipId = Array.isArray(idParam) ? idParam[0] : idParam;

  if (!clipId) {
    res.status(400).json(err('invalid_request', 'missing id'));
    return;
  }

  const parsed = ClipMetaUpdateInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const { error } = await supabase.from('clips').update(parsed.data).eq('id', clipId);
  if (error) {
    logger.error('clip_meta_update_failed', { clipId, message: error.message });
    res.status(500).json(err('internal_error', 'Failed to update clip metadata'));
    return;
  }

  logger.info('clip_meta_success', {
    userId,
    clipId,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok());
});
