import { PublishYouTubeInput } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { handler, ok, err } from '@/lib/http';
import { withIdempotency, keyFromRequest } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('publish_youtube_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId } = auth;

  const rate = await checkRateLimit(userId, 'publish:youtube');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const parsed = PublishYouTubeInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const admin = getAdminClient();
  const clipRecord = await admin.from('clips').select('workspace_id').eq('id', parsed.data.clipId).maybeSingle();
  if (clipRecord.error) {
    logger.error('publish_youtube_clip_lookup_failed', { message: clipRecord.error.message });
    res.status(500).json(err('internal_error', 'Failed to load clip'));
    return;
  }
  if (!clipRecord.data) {
    res.status(404).json(err('not_found', 'Clip not found'));
    return;
  }

  const workspaceId = clipRecord.data.workspace_id as string | null;
  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'Clip missing workspace'));
    return;
  }

  const idempotencyKey = keyFromRequest({ method: req.method, url: '/api/publish/youtube', body: parsed.data });

  const result = await withIdempotency(idempotencyKey, async () => {
    const scheduleAt = parsed.data.scheduleAt ? new Date(parsed.data.scheduleAt) : null;

    if (scheduleAt && scheduleAt.getTime() > Date.now()) {
      const existing = await admin
        .from('schedules')
        .select('id,status')
        .eq('workspace_id', workspaceId)
        .eq('clip_id', parsed.data.clipId)
        .eq('status', 'scheduled')
        .maybeSingle();

      if (existing.error) {
        throw new HttpError(500, 'Failed to inspect existing schedules', 'schedule_lookup_failed', existing.error.message);
      }

      if (existing.data) {
        return { scheduled: true, scheduleId: existing.data.id } as const;
      }

      const insert = await admin
        .from('schedules')
        .insert({
          workspace_id: workspaceId,
          clip_id: parsed.data.clipId,
          run_at: scheduleAt.toISOString(),
          status: 'scheduled',
        })
        .select()
        .maybeSingle();

      if (insert.error || !insert.data) {
        throw new HttpError(500, 'Failed to schedule clip', 'schedule_insert_failed', insert.error?.message);
      }

      return { scheduled: true, scheduleId: insert.data.id } as const;
    }

    const jobInsert = await admin
      .from('jobs')
      .insert({
        workspace_id: workspaceId,
        kind: 'PUBLISH_YOUTUBE',
        status: 'queued',
        payload: {
          clipId: parsed.data.clipId,
          visibility: parsed.data.visibility,
          scheduleAt: parsed.data.scheduleAt ?? null,
          accountId: parsed.data.accountId ?? null,
          titleOverride: parsed.data.titleOverride ?? null,
          descriptionOverride: parsed.data.descriptionOverride ?? null,
        },
      })
      .select()
      .maybeSingle();

    if (jobInsert.error || !jobInsert.data) {
      throw new HttpError(500, 'Failed to enqueue publish job', 'job_insert_failed', jobInsert.error?.message);
    }

    return { jobId: jobInsert.data.id } as const;
  });

  const responsePayload = result.fresh
    ? result.value
    : await resolveExistingPublishResult(admin, workspaceId, parsed.data.clipId, parsed.data.scheduleAt ?? null);

  logger.info('publish_youtube_success', {
    userId,
    clipId: parsed.data.clipId,
    idempotent: !result.fresh,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok({ ...(responsePayload ?? {}), idempotent: !result.fresh }));
});

async function resolveExistingPublishResult(
  admin: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  clipId: string,
  scheduleAt: string | null,
): Promise<Record<string, unknown>> {
  if (scheduleAt && new Date(scheduleAt).getTime() > Date.now()) {
    const existing = await admin
      .from('schedules')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('clip_id', clipId)
      .eq('status', 'scheduled')
      .maybeSingle();

    if (existing.data) {
      return { scheduled: true, scheduleId: existing.data.id };
    }
  } else {
    const job = await admin
      .from('jobs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'PUBLISH_YOUTUBE')
      .eq('payload->>clipId', clipId)
      .limit(1)
      .maybeSingle();

    if (job.data) {
      return { jobId: job.data.id };
    }
  }

  return {};
}
