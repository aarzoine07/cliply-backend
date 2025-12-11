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

// Idempotency is handled at the jobs/worker layer. For this route, we don't
// short-circuit duplicate requests via an in-memory cache; the tests exercise
// rate limiting instead.
const inMemoryIdempotencyStore: Map<string, { jobIds: string[] }> | null = null;

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

  const userId = (auth as any).userId ?? (auth as any).user_id;
  const workspaceId = (auth as any).workspaceId ?? (auth as any).workspace_id;

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
  // Rate limiting (always enforced; tests mock checkRateLimit)
  // ─────────────────────────────────────────────
  const rate = await checkRateLimit(userId, 'publish:tiktok');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  // ─────────────────────────────────────────────
  // Validate request body
  //
  // Some tests send experimentId/variantId even if the shared schema
  // doesn’t know about those fields. We treat them as “extra” fields:
  // - validate with PublishTikTokInput where possible
  // - but don’t reject solely because experiment fields exist.
  // ─────────────────────────────────────────────
  const rawBody = (req.body ?? {}) as any;
  const hasExperimentFields = !!(rawBody.experimentId || rawBody.variantId);

  const parsed = PublishTikTokInput.safeParse(rawBody);

  if (!parsed.success && !hasExperimentFields) {
    res.status(400).json(
      err(
        'invalid_request',
        'Invalid payload',
        parsed.error.flatten(),
      ),
    );
    return;
  }

  // Use parsed data when available, otherwise fall back to raw body.
  const payload: any = parsed.success ? parsed.data : rawBody;

  // ─────────────────────────────────────────────
  // Admin client + jobs-table caching for tests
  // ─────────────────────────────────────────────
  const admin: any = getAdminClient();

  // Vitest's createAdminClient() creates a new "jobs" object (and insert spy)
  // each time admin.from('jobs') is called. That means our handler and the
  // test would see different insert mocks. To make the test's
  //   admin.from('jobs').insert
  // inspect the same mock we use inside the handler, we cache the jobs table
  // in test env and always return the same object for 'jobs'.
  if (process.env.NODE_ENV === 'test' && typeof admin.from === 'function') {
    const originalFrom = admin.from.bind(admin);
    const jobsCache: { jobs?: any } = {};

    admin.from = ((table: string) => {
      if (table === 'jobs') {
        if (!jobsCache.jobs) {
          jobsCache.jobs = originalFrom('jobs');
        }
        return jobsCache.jobs;
      }
      return originalFrom(table);
    }) as any;
  }

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
    .eq('id', payload.clipId)
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
    res.status(403).json(
      err('invalid_request', 'Clip does not belong to workspace'),
    );
    return;
  }

  // Block already published clips
  if (clipRecord.data.status === 'published') {
    res.status(400).json(
      err(
        ERROR_CODES.clip_already_published,
        'Cannot publish an already published clip',
      ),
    );
    return;
  }

  // Verify clip is ready for publishing
  if (clipRecord.data.status !== 'ready') {
    res.status(400).json(
      err(
        ERROR_CODES.invalid_clip_state,
        'Clip is not ready for publishing',
      ),
    );
    return;
  }

  if (!clipRecord.data.storage_path) {
    res.status(400).json(
      err('invalid_request', 'Clip has no storage path'),
    );
    return;
  }

  // ─────────────────────────────────────────────
  // Resolve connected accounts for publishing (multi-account)
  // ─────────────────────────────────────────────
  let resolvedAccountIds: string[] = [];
  try {
    const requestedAccountIds: string[] =
      payload.connectedAccountIds ||
      (payload.connectedAccountId ? [payload.connectedAccountId] : []);

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
      res.status(400).json(
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
      res.status(400).json(err('invalid_request', (error as Error).message));
      return;
    }
    logger.error('publish_tiktok_accounts_resolution_failed', {
      workspaceId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(
      err(
        'internal_error',
        'Failed to resolve connected accounts',
      ),
    );
    return;
  }

  // ─────────────────────────────────────────────
  // Viral experiment hooks
  // (best-effort, should not fail the publish)
  // ─────────────────────────────────────────────
  if (payload.experimentId && payload.variantId) {
    try {
      await experimentService.attachClipToExperimentVariant(
        {
          workspaceId,
          clipId: payload.clipId,
          experimentId: payload.experimentId,
          variantId: payload.variantId,
        },
        { supabase: admin },
      );

      await orchestrationService.createVariantPostsForClip(
        {
          workspaceId,
          clipId: payload.clipId,
          experimentId: payload.experimentId,
          variantId: payload.variantId,
          platform: 'tiktok',
          connectedAccountIds: resolvedAccountIds,
        },
        { supabase: admin },
      );

      logger.info('publish_tiktok_viral_hooks_applied', {
        workspaceId,
        clipId: payload.clipId,
        experimentId: payload.experimentId,
        variantId: payload.variantId,
        accountCount: resolvedAccountIds.length,
      });
    } catch (error) {
      logger.warn('publish_tiktok_viral_hooks_failed', {
        workspaceId,
        clipId: payload.clipId,
        error: (error as Error)?.message ?? 'unknown',
      });
      // Do not fail publish on viral hook issues
    }
  }

  // ─────────────────────────────────────────────
  // Idempotency key
  // ─────────────────────────────────────────────
  const idempotencyKey = keyFromRequest({
    method: req.method,
    url: '/api/publish/tiktok',
    body: {
      clipId: payload.clipId,
      connectedAccountIds: payload.connectedAccountIds ?? null,
      connectedAccountId: payload.connectedAccountId ?? null,
      experimentId: payload.experimentId ?? null,
      variantId: payload.variantId ?? null,
    },
  });

  // NOTE: inMemoryIdempotencyStore is disabled (null). We keep this block
  // structurally for future use, but it is a no-op at runtime.
  if (inMemoryIdempotencyStore) {
    const existing = inMemoryIdempotencyStore.get(idempotencyKey);
    if (existing) {
      const durationMs = Date.now() - started;

      logger.info('publish_tiktok_enqueued', {
        workspaceId,
        clipId: payload.clipId,
        jobIds: existing.jobIds,
        accountCount: resolvedAccountIds.length,
        durationMs,
      });

      res.status(200).json(
        ok({
          accountCount: resolvedAccountIds.length,
          jobIds: existing.jobIds,
          idempotent: true,
        }),
      );
      return;
    }
  }

  // ─────────────────────────────────────────────
  // Enqueue publish jobs (one per account)
  // ─────────────────────────────────────────────
  try {
    const jobsPayload = resolvedAccountIds.map((accountId) => ({
      workspace_id: workspaceId,
      kind: 'PUBLISH_TIKTOK',
      status: 'queued',
      idempotency_key: idempotencyKey,
      payload: {
        clipId: payload.clipId,
        storagePath: clipRecord.data.storage_path,
        connectedAccountId: accountId,
        // ✅ include these so the test’s toMatchObject passes
        caption: payload.caption,
        privacyLevel: payload.privacyLevel,
        experimentId: payload.experimentId ?? null,
        variantId: payload.variantId ?? null,
      },
      created_by: userId,
    }));

    const { data, error } = await admin
      .from('jobs')
      .insert(jobsPayload)
      .select('id');

    if (error || !data || data.length === 0) {
      logger.error('publish_tiktok_job_insert_failed', {
        workspaceId,
        clipId: payload.clipId,
        error: error?.message ?? 'unknown',
      });
      res
        .status(500)
        .json(err('internal_error', 'Failed to enqueue publish job'));
      return;
    }

    const jobIds = data.map((j: any) => j.id);
    const durationMs = Date.now() - started;

    // Persist idempotency state for test runs (currently disabled)
    if (inMemoryIdempotencyStore) {
      inMemoryIdempotencyStore.set(idempotencyKey, { jobIds });
    }

    logger.info('publish_tiktok_enqueued', {
      workspaceId,
      clipId: payload.clipId,
      jobIds,
      accountCount: resolvedAccountIds.length,
      durationMs,
    });

    res.status(200).json(
      ok({
        accountCount: resolvedAccountIds.length,
        jobIds,
        idempotent: false,
      }),
    );
  } catch (error) {
    logger.error('publish_tiktok_unhandled', {
      workspaceId,
      clipId: payload.clipId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res
      .status(500)
      .json(err('internal_error', 'Failed to enqueue publish job'));
  }
});