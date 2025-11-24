import { PublishTikTokInput } from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';

import { HttpError } from '@/lib/errors';
import { handler, ok, err } from '@/lib/http';
import { withIdempotency, keyFromRequest } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';
import * as connectedAccountsService from '@/lib/accounts/connectedAccountsService';
import * as experimentService from '@/lib/viral/experimentService';
import * as orchestrationService from '@/lib/viral/orchestrationService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { withPlanGate } from '@/lib/billing/withPlanGate';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('publish_tiktok_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  // Apply plan gating for publishing (using concurrent_jobs as proxy for publishing capability)
  return withPlanGate(auth, 'concurrent_jobs', async (req, res) => {

    const rate = await checkRateLimit(userId, 'publish:tiktok');
    if (!rate.allowed) {
      res.status(429).json(err('too_many_requests', 'Rate limited'));
      return;
    }

    const parsed = PublishTikTokInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    const admin = getAdminClient();

    // Verify workspaceId from auth context
    if (!workspaceId) {
      res.status(400).json(err('invalid_request', 'Workspace required'));
      return;
    }

    // Verify clip exists and belongs to workspace
    const clipRecord = await admin.from('clips').select('workspace_id,status,storage_path').eq('id', parsed.data.clipId).maybeSingle();
    if (clipRecord.error) {
      logger.error('publish_tiktok_clip_lookup_failed', { message: clipRecord.error.message });
      res.status(500).json(err('internal_error', 'Failed to load clip'));
      return;
    }
    if (!clipRecord.data) {
      res.status(404).json(err('not_found', 'Clip not found'));
      return;
    }

    const clipWorkspaceId = clipRecord.data.workspace_id as string | null;
    if (!clipWorkspaceId || clipWorkspaceId !== workspaceId) {
      res.status(403).json(err('invalid_request', 'Clip does not belong to workspace'));
      return;
    }

  // Verify clip is ready for publishing
  if (clipRecord.data.status !== 'ready') {
    res.status(400).json(err('invalid_request', 'Clip is not ready for publishing'));
    return;
  }

  if (!clipRecord.data.storage_path) {
    res.status(400).json(err('invalid_request', 'Clip has no storage path'));
    return;
  }

  // Resolve connected accounts for publishing (multi-account support)
  let resolvedAccountIds: string[] = [];
  try {
    // Determine which accounts to use
    const requestedAccountIds = parsed.data.connectedAccountIds || (parsed.data.connectedAccountId ? [parsed.data.connectedAccountId] : []);

    const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId,
        platform: 'tiktok',
        connectedAccountIds: requestedAccountIds.length > 0 ? requestedAccountIds : undefined,
      },
      { supabase: admin },
    );
    resolvedAccountIds = accounts.map((a) => a.id);

    if (resolvedAccountIds.length === 0) {
      logger.warn('publish_tiktok_no_accounts', {
        workspaceId,
        requestedIds: requestedAccountIds,
      });
      res.status(400).json(err('invalid_request', 'No active TikTok accounts found for workspace'));
      return;
    }
  } catch (error) {
    // Validation errors from getConnectedAccountsForPublish
    if ((error as Error)?.message?.includes('not found') || (error as Error)?.message?.includes('inactive')) {
      res.status(400).json(err('invalid_request', (error as Error).message));
      return;
    }
    logger.error('publish_tiktok_accounts_resolution_failed', {
      workspaceId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to resolve connected accounts'));
    return;
  }

  // Viral experiment hooks: attach clip to variant if experiment info provided
  if (parsed.data.experimentId && parsed.data.variantId) {
    try {
      await experimentService.attachClipToExperimentVariant(
        {
          workspaceId,
          clipId: parsed.data.clipId,
          experimentId: parsed.data.experimentId,
          variantId: parsed.data.variantId,
        },
        { supabase: admin },
      );

      // Create variant_posts for multi-account orchestration using resolved accounts
      await orchestrationService.createVariantPostsForClip(
        {
          workspaceId,
          clipId: parsed.data.clipId,
          experimentId: parsed.data.experimentId,
          variantId: parsed.data.variantId,
          platform: 'tiktok',
          connectedAccountIds: resolvedAccountIds,
        },
        { supabase: admin },
      );

      logger.info('publish_tiktok_viral_hooks_applied', {
        workspaceId,
        clipId: parsed.data.clipId,
        experimentId: parsed.data.experimentId,
        variantId: parsed.data.variantId,
        accountCount: resolvedAccountIds.length,
      });
    } catch (error) {
      // Log but don't fail the publish if viral hooks fail
      logger.warn('publish_tiktok_viral_hooks_failed', {
        workspaceId,
        clipId: parsed.data.clipId,
        error: (error as Error)?.message ?? 'unknown',
      });
    }
  }

  const idempotencyKey = keyFromRequest({ method: req.method, url: '/api/publish/tiktok', body: parsed.data });

  const result = await withIdempotency(idempotencyKey, async () => {
    // Create one job per account (multi-account publishing loop)
    const jobPayloads = resolvedAccountIds.map((connectedAccountId) => ({
      workspace_id: workspaceId,
      kind: 'PUBLISH_TIKTOK' as const,
      status: 'queued' as const,
      payload: {
        clipId: parsed.data.clipId,
        connectedAccountId,
        caption: parsed.data.caption,
        privacyLevel: parsed.data.privacyLevel || 'PUBLIC_TO_EVERYONE',
        experimentId: parsed.data.experimentId ?? null,
        variantId: parsed.data.variantId ?? null,
      },
    }));

    const jobInserts = await admin.from('jobs').insert(jobPayloads).select();

    if (jobInserts.error || !jobInserts.data || jobInserts.data.length === 0) {
      throw new HttpError(500, 'Failed to enqueue publish jobs', 'job_insert_failed', jobInserts.error?.message);
    }

    return { jobIds: jobInserts.data.map((j) => j.id), accountCount: resolvedAccountIds.length } as const;
  });

  const responsePayload = result.fresh
    ? result.value
    : await resolveExistingPublishResult(admin, workspaceId, parsed.data.clipId);

  logger.info('publish_tiktok_success', {
    userId,
    clipId: parsed.data.clipId,
    accountCount: resolvedAccountIds.length,
    idempotent: !result.fresh,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  // Normalize response: if single job, return jobId; if multiple, return jobIds
  const normalizedPayload = result.fresh && 'jobIds' in result.value
    ? { jobIds: result.value.jobIds, accountCount: result.value.accountCount }
    : responsePayload;

    res.status(200).json(ok({ ...(normalizedPayload ?? {}), idempotent: !result.fresh }));
  })(req, res);
});

async function resolveExistingPublishResult(
  admin: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  clipId: string,
): Promise<Record<string, unknown>> {
  const jobs = await admin
    .from('jobs')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'PUBLISH_TIKTOK')
    .eq('payload->>clipId', clipId)
    .order('created_at', { ascending: false });

  if (jobs.data && jobs.data.length > 0) {
    if (jobs.data.length === 1) {
      return { jobId: jobs.data[0].id };
    } else {
      return { jobIds: jobs.data.map((j) => j.id), accountCount: jobs.data.length };
    }
  }

  return {};
}

