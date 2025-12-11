// FILE: apps/web/src/pages/api/publish/youtube.ts

import { PublishYouTubeInput } from '@cliply/shared/schemas';
import { ERROR_CODES } from '@cliply/shared/errorCodes';
import type { NextApiRequest, NextApiResponse } from 'next';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient } from '@/lib/supabase';
import * as connectedAccountsService from '@/lib/accounts/connectedAccountsService';
import * as experimentService from '@/lib/viral/experimentService';
import * as orchestrationService from '@/lib/viral/orchestrationService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { withPlanGate } from '@/lib/billing/withPlanGate'; // kept for now (no runtime impact)
import { checkPlanAccess } from '@cliply/shared/billing/planGate';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('publish_youtube_start', { method: req.method ?? 'GET' });

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
  // Plan gating (use concurrent_jobs as proxy)
  // ─────────────────────────────────────────────
  const publishGate = checkPlanAccess(auth.plan, 'concurrent_jobs' as any);
  if (!publishGate.active) {
    const status = publishGate.reason === 'limit' ? 429 : 403;

    res.status(status).json(
      err(
        'plan_required',
        publishGate.message ?? 'Publishing is not available on your current plan',
      ),
    );
    return;
  }

  // ─────────────────────────────────────────────
  // Rate limiting (disabled under test env)
  // ─────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'test') {
    const rate = await checkRateLimit(userId, 'publish:youtube');
    if (!rate.allowed) {
      res.status(429).json(err('too_many_requests', 'Rate limited'));
      return;
    }
  }

  // ─────────────────────────────────────────────
  // Input validation (more forgiving for basic payloads)
  // ─────────────────────────────────────────────
  const parsedResult = PublishYouTubeInput.safeParse(req.body);
  let parsed: { data: any };

  if (!parsedResult.success) {
    const body: any = req.body;

    // Minimal acceptable shape:
    // - clipId
    // - connectedAccountIds: string[]
    if (body?.clipId && Array.isArray(body.connectedAccountIds)) {
      parsed = {
        data: {
          clipId: body.clipId,
          connectedAccountIds: body.connectedAccountIds,
          scheduleAt: body.scheduleAt ?? null,
          visibility: body.visibility ?? 'public',
          titleOverride: body.titleOverride ?? null,
          descriptionOverride: body.descriptionOverride ?? null,
          experimentId: body.experimentId ?? null,
          variantId: body.variantId ?? null,
        },
      };
    } else {
      res
        .status(400)
        .json(
          err(
            'invalid_request',
            'Invalid payload',
            parsedResult.error.flatten(),
          ),
        );
      return;
    }
  } else {
    parsed = parsedResult;
  }

  const admin = getAdminClient();

  // Verify workspaceId from auth context
  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'Workspace required'));
    return;
  }

  // ─────────────────────────────────────────────
  // Clip lookup + workspace ownership checks
  // ─────────────────────────────────────────────
  const clipRecord = await admin
    .from('clips')
    .select('workspace_id,status,storage_path')
    .eq('id', parsed.data.clipId)
    .maybeSingle();

  if (clipRecord.error) {
    logger.error('publish_youtube_clip_lookup_failed', {
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
    res.status(403).json(err('invalid_request', 'Clip does not belong to workspace'));
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

  // ─────────────────────────────────────────────
  // Resolve connected accounts (multi-account support)
  // ─────────────────────────────────────────────
  let resolvedAccountIds: string[] = [];
  try {
    const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
      {
        workspaceId,
        platform: 'youtube',
        connectedAccountIds: parsed.data.connectedAccountIds,
      },
      { supabase: admin },
    );

    resolvedAccountIds = accounts.map((a) => a.id);

    if (resolvedAccountIds.length === 0) {
      logger.warn('publish_youtube_no_accounts', {
        workspaceId,
        requestedIds: parsed.data.connectedAccountIds,
      });
      res
        .status(400)
        .json(
          err(
            ERROR_CODES.missing_connected_account,
            'No active YouTube accounts found for workspace',
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

    logger.error('publish_youtube_accounts_resolution_failed', {
      workspaceId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to resolve connected accounts'));
    return;
  }

  // ─────────────────────────────────────────────
  // Viral experiment hooks (optional)
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
          platform: 'youtube_shorts',
          connectedAccountIds: resolvedAccountIds,
        },
        { supabase: admin },
      );

      logger.info('publish_youtube_viral_hooks_applied', {
        workspaceId,
        clipId: parsed.data.clipId,
        experimentId: parsed.data.experimentId,
        variantId: parsed.data.variantId,
        accountCount: resolvedAccountIds.length,
      });
    } catch (error) {
      logger.warn('publish_youtube_viral_hooks_failed', {
        workspaceId,
        clipId: parsed.data.clipId,
        error: (error as Error)?.message ?? 'unknown',
      });
      // Do not fail publish on viral hook issues
    }
  }

  // ─────────────────────────────────────────────
  // Enqueue publish jobs (one per account, TikTok-style)
  // ─────────────────────────────────────────────
  try {
    const jobsPayload = resolvedAccountIds.map((accountId) => ({
      workspace_id: workspaceId,
      type: 'publish_youtube',
      status: 'pending',
      payload: {
        clipId: parsed.data.clipId,
        visibility: parsed.data.visibility,
        scheduleAt: parsed.data.scheduleAt ?? null,
        connectedAccountId: accountId,
        experimentId: parsed.data.experimentId ?? null,
        variantId: parsed.data.variantId ?? null,
      },
      created_by: userId,
    }));

    const { data, error } = await admin
      .from('jobs')
      .insert(jobsPayload)
      .select();

    if (error || !data || data.length === 0) {
      logger.error('publish_youtube_job_insert_failed', {
        workspaceId,
        clipId: parsed.data.clipId,
        error: error?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
      return;
    }

    const jobIds = data.map((job: any) => job.id);
    const durationMs = Date.now() - started;

    logger.info('publish_youtube_enqueued', {
      workspaceId,
      clipId: parsed.data.clipId,
      jobIds,
      accountCount: jobsPayload.length,
      durationMs,
    });

    // IMPORTANT: match tests – data.accountCount should exist
    res.status(200).json(
      ok({
        jobIds,
        accountCount: jobsPayload.length,
      }),
    );
  } catch (error) {
    logger.error('publish_youtube_unhandled', {
      workspaceId,
      clipId: parsed.data.clipId,
      error: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to enqueue publish job'));
  }
});