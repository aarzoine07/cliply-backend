import { PublishTikTokInput } from '@cliply/shared/schemas';
import { ERROR_CODES } from '@cliply/shared/errorCodes';
import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { keyFromRequest } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';
import * as connectedAccountsService from '@/lib/accounts/connectedAccountsService';
import * as experimentService from '@/lib/viral/experimentService';
import * as orchestrationService from '@/lib/viral/orchestrationService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

// Inline plan gating for Pages API routes using shared billing helpers
import {
  BILLING_PLAN_LIMIT,
  BILLING_PLAN_REQUIRED,
  checkPlanAccess,
  enforcePlanAccess,
} from '@cliply/shared/billing/planGate';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('publish_tiktok_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  // ─────────────────────────────────────────────
  // Auth context
  // ─────────────────────────────────────────────
  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const userId = auth.userId || auth.user_id;
  const workspaceId = auth.workspaceId || auth.workspace_id;

  // ─────────────────────────────────────────────
  // Plan gating: require plan + concurrent_jobs feature
  // ─────────────────────────────────────────────
  const plan = (auth as any)?.plan;
  if (!plan) {
    res.status(403).json(err(BILLING_PLAN_REQUIRED, 'No active plan found.'));
    return;
  }

  const gate = checkPlanAccess(plan as any, 'concurrent_jobs' as any);
  if (!gate.active) {
    const code = gate.reason === 'limit' ? BILLING_PLAN_LIMIT : BILLING_PLAN_REQUIRED;
    const status = code === BILLING_PLAN_LIMIT ? 429 : 403;
    const message = gate.message ?? 'Publishing is not available on the current plan.';
    res.status(status).json(err(code, message));
    return;
  }

  // Enforce usage (no-op today, future-proof for quotas)
  enforcePlanAccess(plan as any, 'concurrent_jobs' as any);

  // ─────────────────────────────────────────────
  // Rate limiting (disabled under test env)
  // ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    const rate = await checkRateLimit(userId, 'publish:tiktok');
    if (!rate.allowed) {
      res.status(429).json(err('too_many_requests', 'Rate limited'));
      return;
    }
  }

  // ─────────────────────────────────────────────
  // Validate request body
  // ─────────────────────────────────────────────
  const parsed = PublishTikTokInput.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(
        err(
          'invalid_request',
          'Invalid payload',
          parsed.error.flatten(),
        ),
      );
    return;
  }

  const admin = getAdminClient();

  // Verify workspaceId from auth context
  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'Workspace required'));
    return;
  }

  // ─────────────────────────────────────────────
  // Clip lookup + workspace checks
  // ─────────────────────────────────────────────
  const clipRecord = await admin
    .from('clips')
    .select('workspace_id,status,storage_path')
    .eq('id', parsed.data.clipId)
    .maybeSingle();

  if (clipRecord.error) {
    logger.error('publish_tiktok_clip_lookup_failed', {
      message: clipRecord.error.message,
    });
    res.status(500).json(err('internal_error', 'Failed to load clip'));
    return;
  }

  if (!clipRecord.data) {
    res.status(404).json(err('not_found', 'Clip not found'));
    return;
  }

  const clipWorkspaceId = clipRecord.data.workspace_id as string | null;
  if (!clipWorkspaceId || clipWorkspaceId !== workspaceId) {
    res
      .status(403)
      .json(
        err('invalid_request', 'Clip does not belong to workspace'),
      );
    return;
  }

  // Block already published clips
  if (clipRecord.data.status === 'published') {
    res
      .status(400)
      .json(
        err(
          ERROR_CODES.clip_already_published,
          'Cannot publish an already published clip',
        ),
      );
    return;
  }

  // Verify clip is ready for publishing
  if (clipRecord.data.status !== 'ready') {
    res
      .status(400)
      .json(
        err(
          ERROR_CODES.invalid_clip_state,
          'Clip is not ready for publishing',
        ),
      );
    return;
  }

  if (!clipRecord.data.storage_path) {
    res
      .status(400)
      .json(
        err('invalid_request', 'Clip has no storage path'),
      );
    return;
  }

  // ─────────────────────────────────────────────
  // Resolve connected accounts for publishing (multi-account)
  // ─────────────────────────────────────────────
  let resolvedAccountIds: string[] = [];
  try {
    const requestedAccountIds =
      parsed.data.connectedAccountIds ||
      (parsed.data.connectedAccountId
        ? [parsed.data.connectedAccountId]
        : []);

    const accounts =
      await connectedAccountsService.getConnectedAccountsForPublish(
        {
          workspaceId,
          platform: 'tiktok',
          connectedAccountIds:
            requestedAccountIds.length > 0
              ? requestedAccountIds
              : undefined,
        },
        { supabase: admin },
      );
    resolvedAccountIds = accounts.map((a) => a.id);

    if (resolvedAccountIds.length === 0) {
      logger.warn('publish_tiktok_no_accounts', {
        workspaceId,
        requestedIds: requestedAccountIds,
      });
      res
        .status(400)
        .json(
          err(
            ERROR_CODES.missing_connected_account,
            'No active TikTok accounts found for workspace',
          ),
        );
      return;
    }
  } catch (error) {
    if (
      (error as Error)?.message?.includes('not found') ||
      (error as Error)?.message?.includes('inactive')
    ) {
      res
        .status(400)
        .json(err('invalid_request', (error as Error).message));
      return;
    }
    logger.error('publish_tiktok_accounts_resolution_failed', {
      workspaceId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res
      .status(500)
      .json(
        err(
          'internal_error',
          'Failed to resolve connected accounts',
        ),
      );
    return;
  }

  // ─────────────────────────────────────────────
  // Viral experiment hooks
  // ─────────────────────────────────────────────
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
      logger.warn('publish_tiktok_viral_hooks_failed', {
        workspaceId,
        clipId: parsed.data.clipId,
        error: (error as Error)?.message ?? 'unknown',
      });
      // Do not fail publish on viral hook issues
    }
  }

  // ─────────────────────────────────────────────
  // Enqueue publish job (simple shape, compatible with tests)
  // ─────────────────────────────────────────────
  const idempotencyKey = keyFromRequest({
    method: req.method,
    url: '/api/publish/tiktok',
    body: {
      clipId: parsed.data.clipId,
      connectedAccountIds: parsed.data.connectedAccountIds ?? null,
      connectedAccountId: parsed.data.connectedAccountId ?? null,
      experimentId: parsed.data.experimentId ?? null,
      variantId: parsed.data.variantId ?? null,
    },
  });

  try {
    const { data, error } = await admin
      .from('jobs')
      .insert({
        workspace_id: workspaceId,
        type: 'publish_tiktok',
        status: 'pending',
        idempotency_key: idempotencyKey,
        payload: {
          clipId: parsed.data.clipId,
          storagePath: clipRecord.data.storage_path,
          connectedAccountIds: resolvedAccountIds,
          experimentId: parsed.data.experimentId ?? null,
          variantId: parsed.data.variantId ?? null,
        },
        created_by: userId,
      })
      .select();

    if (error || !data || !data[0]) {
      logger.error('publish_tiktok_job_insert_failed', {
        workspaceId,
        clipId: parsed.data.clipId,
        error: error?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
      return;
    }

    const job = data[0];
    const durationMs = Date.now() - started;

    logger.info('publish_tiktok_enqueued', {
      workspaceId,
      clipId: parsed.data.clipId,
      jobId: job.id,
      accountCount: resolvedAccountIds.length,
      durationMs,
    });

    res.status(200).json(ok({ data: { jobId: job.id } }));
  } catch (error) {
    logger.error('publish_tiktok_unhandled', {
      workspaceId,
      clipId: parsed.data.clipId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
  }
});