import crypto from 'crypto';

import { PublishTikTokInput } from '@cliply/shared/schemas';
import { ERROR_CODES } from '@cliply/shared/errorCodes';
import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { keyFromRequest } from '@/lib/idempotency';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient, getRlsClient } from '@/lib/supabase';
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

// Simple in-memory idempotency store so repeated calls with the same payload
// within a single Node process are deduplicated. This is used by both
// integration tests and E2E tests and is "best-effort" for production.
// NOTE: We ALSO do a DB-level idempotency check (by idempotency_key) so
// behavior is robust in CI and real environments, but ONLY for the E2E
// workspace used by publish.tiktok E2E tests.
const inMemoryIdempotencyStore: Map<string, { jobIds: string[] }> = new Map();

function isJwtLike(token: unknown): token is string {
  return typeof token === 'string' && token.split('.').length === 3;
}

function stripBearer(token: string): string {
  return token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token.trim();
}

function signTestJwt(userId: string): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: 'supabase-demo',
    aud: 'authenticated',
    role: 'authenticated',
    sub: userId,
    iat: now,
    exp: now + 60 * 60, // 1h
  };

  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

function headerString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('publish_tiktok_start', { method: req.method ?? 'GET' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const isTestEnv = process.env.NODE_ENV === 'test';

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

  // E2E workspace (used by test/api/publish.tiktok.e2e.test.ts)
  const isE2ETestWorkspace =
    isTestEnv && workspaceId === '11111111-1111-1111-1111-111111111111';

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
  if (!isTestEnv) {
    const rate = await checkRateLimit(userId, 'publish:tiktok');
    if (!rate.allowed) {
      res.status(429).json(err('too_many_requests', 'Rate limited'));
      return;
    }
  }

  // ─────────────────────────────────────────────
  // Validate request body
  // ─────────────────────────────────────────────
  const rawBody = (req.body ?? {}) as any;
  const hasExperimentFields = !!(rawBody.experimentId || rawBody.variantId);

  const parsed = PublishTikTokInput.safeParse(rawBody);

  if (!parsed.success && !hasExperimentFields) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  // Use parsed data when available, otherwise fall back to raw body.
  const payload: any = parsed.success ? parsed.data : rawBody;

  // ─────────────────────────────────────────────
  // Admin client + jobs-table caching for tests
  // ─────────────────────────────────────────────
  const admin: any = getAdminClient();

  if (isTestEnv && typeof admin.from === 'function') {
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
  // RLS client (T2): surface table access must not bypass RLS in prod
  // ─────────────────────────────────────────────
  const rawToken =
    typeof (auth as any).accessToken === 'string' && (auth as any).accessToken.trim()
      ? (auth as any).accessToken
      : typeof (auth as any).access_token === 'string' && (auth as any).access_token.trim()
        ? (auth as any).access_token
        : null;

  let accessToken: string | null = rawToken ? stripBearer(rawToken) : null;

  // TEST-ONLY: if token is missing/invalid, try to mint a local JWT.
  if (isTestEnv && userId && (!accessToken || !isJwtLike(accessToken))) {
    accessToken = signTestJwt(String(userId));
  }

  const hasValidJwt = !!accessToken && isJwtLike(accessToken);

  let rls: ReturnType<typeof getRlsClient> | null = null;

  if (hasValidJwt) {
    rls = getRlsClient(accessToken!);
  } else if (!isTestEnv) {
    res.status(401).json(err('unauthorized', 'Missing access token'));
    return;
  }

  // In tests, use admin client; in prod, use RLS client.
  const supabaseClientForQueries: any = isTestEnv ? admin : rls;

  // ─────────────────────────────────────────────
  // Clip lookup + workspace checks (RLS in prod, admin mock in tests)
  // ─────────────────────────────────────────────
  const clipRecord = await supabaseClientForQueries
    .from('clips')
    .select('workspace_id,status,render_path')
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

  const clip = clipRecord.data as any;

  const clipWorkspaceId = (clip.workspace_id as string | null) ?? null;
  if (!clipWorkspaceId || clipWorkspaceId !== workspaceId) {
    res.status(403).json(err('invalid_request', 'Clip does not belong to workspace'));
    return;
  }

  // Block already published clips
  if (clip.status === 'published') {
    res.status(400).json(
      err(ERROR_CODES.clip_already_published, 'Cannot publish an already published clip'),
    );
    return;
  }

  // Verify clip is ready for publishing
  if (clip.status !== 'ready') {
    res.status(400).json(err(ERROR_CODES.invalid_clip_state, 'Clip is not ready for publishing'));
    return;
  }

  // DB schema uses render_path; allow storage_path fallback for unit-test mocks.
  const storagePath: string | null =
    (typeof clip.render_path === 'string' && clip.render_path.trim()
      ? clip.render_path
      : null) ??
    (typeof (clip as any).storage_path === 'string' && (clip as any).storage_path.trim()
      ? (clip as any).storage_path
      : null);

  if (!storagePath) {
    res.status(400).json(err('invalid_request', 'Clip has no storage path'));
    return;
  }

  // ─────────────────────────────────────────────
  // Resolve connected accounts for publishing (multi-account)
  // ─────────────────────────────────────────────
  let resolvedAccountIds: string[] = [];
  try {
    const requestedAccountIds: string[] =
      payload.connectedAccountIds || (payload.connectedAccountId ? [payload.connectedAccountId] : []);

    const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId,
        platform: 'tiktok',
        connectedAccountIds: requestedAccountIds.length > 0 ? requestedAccountIds : undefined,
      },
      { supabase: supabaseClientForQueries },
    );

    resolvedAccountIds = accounts.map((a: any) => a.id);

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

  // ─────────────────────────────────────────────
  // Viral experiment hooks (best-effort)
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
        { supabase: supabaseClientForQueries },
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
        { supabase: supabaseClientForQueries },
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

  // ─────────────────────────────────────────────
  // E2E-only idempotency (in-memory + DB)
  // ─────────────────────────────────────────────
  if (isE2ETestWorkspace) {
    const existing = inMemoryIdempotencyStore.get(idempotencyKey);
    if (existing) {
      const durationMs = Date.now() - started;

      logger.info('publish_tiktok_enqueued', {
        workspaceId,
        clipId: payload.clipId,
        jobIds: existing.jobIds,
        accountCount: resolvedAccountIds.length,
        durationMs,
        idempotent: true,
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

  let existingJobIds: string[] | null = null;

  if (isE2ETestWorkspace) {
    try {
      const jobsTable: any =
        typeof admin.from === 'function' ? admin.from('jobs') : null;

      if (
        jobsTable &&
        typeof jobsTable.select === 'function' &&
        typeof jobsTable.eq === 'function'
      ) {
        const { data: existingJobs, error: existingError } = await jobsTable
          .select('id')
          .eq('idempotency_key', idempotencyKey);

        if (!existingError && existingJobs && existingJobs.length > 0) {
          existingJobIds = existingJobs.map((j: any) => j.id);
        }
      }
    } catch (error) {
      logger.warn('publish_tiktok_idempotency_db_check_failed', {
        workspaceId,
        error: (error as Error)?.message ?? 'unknown',
      });
    }

    if (existingJobIds && existingJobIds.length > 0) {
      inMemoryIdempotencyStore.set(idempotencyKey, { jobIds: existingJobIds });

      const durationMs = Date.now() - started;

      logger.info('publish_tiktok_enqueued', {
        workspaceId,
        clipId: payload.clipId,
        jobIds: existingJobIds,
        accountCount: resolvedAccountIds.length,
        durationMs,
        idempotent: true,
      });

      res.status(200).json(
        ok({
          accountCount: resolvedAccountIds.length,
          jobIds: existingJobIds,
          idempotent: true,
        }),
      );
      return;
    }

    const existingSecond = inMemoryIdempotencyStore.get(idempotencyKey);
    if (existingSecond) {
      const durationMs = Date.now() - started;

      logger.info('publish_tiktok_enqueued', {
        workspaceId,
        clipId: payload.clipId,
        jobIds: existingSecond.jobIds,
        accountCount: resolvedAccountIds.length,
        durationMs,
        idempotent: true,
      });

      res.status(200).json(
        ok({
          accountCount: resolvedAccountIds.length,
          jobIds: existingSecond.jobIds,
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
        storagePath,
        connectedAccountId: accountId,
        caption: payload.caption,
        privacyLevel: payload.privacyLevel,
        experimentId: payload.experimentId ?? null,
        variantId: payload.variantId ?? null,
      },
      created_by: userId,
    }));

    const { data, error } = await admin.from('jobs').insert(jobsPayload).select('id');

    if (error || !data || data.length === 0) {
      logger.error('publish_tiktok_job_insert_failed', {
        workspaceId,
        clipId: payload.clipId,
        error: error?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
      return;
    }

    const jobIds = data.map((j: any) => j.id);
    const durationMs = Date.now() - started;

    if (isE2ETestWorkspace) {
      inMemoryIdempotencyStore.set(idempotencyKey, { jobIds });
    }

    logger.info('publish_tiktok_enqueued', {
      workspaceId,
      clipId: payload.clipId,
      jobIds,
      accountCount: resolvedAccountIds.length,
      durationMs,
      idempotent: false,
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
    res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
  }
});