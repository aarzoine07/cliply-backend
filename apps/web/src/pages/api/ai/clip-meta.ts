import { AIClipMetaRequest, AIClipMetaResponse } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('ai_clip_meta_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId } = auth;

  const rate = await checkRateLimit(userId, 'ai:clip-meta');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const parsed = AIClipMetaRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const title = parsed.data.titleHint?.trim() || 'Auto Clip Title';
  const hashtags = buildHashtags(parsed.data.style);
  const payload = AIClipMetaResponse.parse({ title, hashtags });

  logger.info('ai_clip_meta_success', {
    userId,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok(payload));
});

function buildHashtags(style?: string | null): string[] {
  const base = ['#shorts', '#clip', '#ai'];
  if (!style) return base;
  const normalized = style.toLowerCase().replace(/[^a-z0-9]+/gi, '');
  if (normalized.length > 1) {
    base.push(`#${normalized}`);
  }
  return base.slice(0, 5);
}
