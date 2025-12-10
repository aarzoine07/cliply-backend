import { randomUUID } from 'node:crypto';

import {
  BUCKET_VIDEOS,
  SIGNED_URL_TTL_SEC,
  getExtension,
} from '@cliply/shared/constants';
import {
  UploadInitFileOut,
  UploadInitInput,
  UploadInitYtOut,
} from '@cliply/shared/schemas';
import type { NextApiRequest, NextApiResponse } from 'next';
import { projectSourcePath } from '@cliply/shared/storage/paths';

import {
  assertWithinUsage,
  recordUsage,
  UsageLimitExceededError,
} from '@cliply/shared/billing/usageTracker';
import { logEvent } from '@cliply/shared/logging/logger';
import { checkPlanAccess } from '@cliply/shared/billing/planGate';

import { handler, ok, err } from '@/lib/http';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSignedUploadUrl } from '@/lib/storage';
import { getAdminClient } from '@/lib/supabase';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('upload_init_start', { method: req.method ?? 'GET' });

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

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  // Plan gate: uploads_per_day
  const gate = checkPlanAccess(auth.plan, 'uploads_per_day');
  if (!gate.active) {
    const status = gate.reason === 'limit' ? 429 : 403;
    res.status(status).json(
      err(
        gate.reason === 'limit' ? 'plan_limit' : 'plan_required',
        gate.message ?? 'Your current plan does not allow new uploads.',
      ),
    );
    return;
  }

  const rate = await checkRateLimit(userId, 'upload:init');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
      return;
    }
  }

  const parsed = UploadInitInput.safeParse(body);
  if (!parsed.success) {
    res
      .status(400)
      .json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const input = parsed.data;
  const admin = getAdminClient();

  // FILE UPLOAD FLOW
  if (input.source === 'file') {
    const projectId = randomUUID();
    const extension = getExtension(input.filename) ?? '.mp4';
    const normalizedExtension = extension.startsWith('.')
      ? extension
      : `.${extension}`;
    const extensionWithoutDot = normalizedExtension.startsWith('.')
      ? normalizedExtension.slice(1)
      : normalizedExtension;
    const storageKey = projectSourcePath(
      workspaceId,
      projectId,
      extensionWithoutDot,
    );
    const storagePath = `${BUCKET_VIDEOS}/${storageKey}`;

    try {
      // Rough heuristic: ~1MB per minute for compressed video (conservative)
      const estimatedMinutes = Math.max(
        1,
        Math.ceil(input.size / (1024 * 1024)),
      );

      // Check usage limits before creating project
      try {
        await assertWithinUsage(workspaceId, 'projects', 1);
        await assertWithinUsage(
          workspaceId,
          'source_minutes',
          estimatedMinutes,
        );
      } catch (error) {
        if (error instanceof UsageLimitExceededError) {
          logger.warn('upload_init_usage_limit_exceeded', {
            workspaceId,
            metric: error.metric,
            used: error.used,
            limit: error.limit,
          });
          res.status(429).json({
            ok: false,
            error: {
              code: 'usage_limit_exceeded',
              message: error.message,
              metric: error.metric,
              used: error.used,
              limit: error.limit,
            },
          });
          return;
        }
        throw error;
      }

      const signedUrl = await getSignedUploadUrl(
        storageKey,
        SIGNED_URL_TTL_SEC,
        BUCKET_VIDEOS,
      );

      const title = deriveTitle(input.filename);
      const { data: project, error: insertError } = await admin
        .from('projects')
        .insert({
          id: projectId,
          workspace_id: workspaceId,
          title,
          source_type: 'file',
          source_path: storagePath,
          status: 'queued',
        })
        .select()
        .maybeSingle();

      if (insertError || !project) {
        logger.error('upload_init_project_insert_failed', {
          workspaceId,
          message: insertError?.message,
        });
        res.status(500).json(err('internal_error', 'Failed to create project'));
        return;
      }

      // Record project creation usage
      await recordUsage({
        workspaceId,
        metric: 'projects',
        amount: 1,
      });

      const payload = UploadInitFileOut.parse({
        uploadUrl: signedUrl,
        storagePath,
        projectId,
      });

      logEvent({
        service: 'web',
        event: 'upload_init_complete',
        workspaceId,
        projectId,
        meta: {
          source: 'file',
          durationMs: Date.now() - started,
          remainingTokens: rate.remaining,
          filename: input.filename,
          size: input.size,
        },
      });

      logger.info('upload_init_success', {
        userId,
        workspaceId,
        source: 'file',
        durationMs: Date.now() - started,
        remainingTokens: rate.remaining,
      });

      res.status(200).json(ok(payload));
      return;
    } catch (error) {
      logger.error('upload_init_file_flow_failed', {
        message: (error as Error)?.message ?? 'unknown',
        workspaceId,
      });
      res.status(500).json(err('internal_error', 'Failed to prepare upload'));
      return;
    }
  }

  // YOUTUBE IMPORT FLOW
  try {
    // Conservative default; real duration recorded later in pipeline
    const estimatedMinutes = 10;

    try {
      await assertWithinUsage(workspaceId, 'projects', 1);
      await assertWithinUsage(workspaceId, 'source_minutes', estimatedMinutes);
    } catch (error) {
      if (error instanceof UsageLimitExceededError) {
        logger.warn('upload_init_youtube_usage_limit_exceeded', {
          workspaceId,
          metric: error.metric,
          used: error.used,
          limit: error.limit,
        });
        res.status(429).json({
          ok: false,
          error: {
            code: 'usage_limit_exceeded',
            message: error.message,
            metric: error.metric,
            used: error.used,
            limit: error.limit,
          },
        });
        return;
      }
      throw error;
    }

    const projectId = randomUUID();
    const { data: project, error: insertError } = await admin
      .from('projects')
      .insert({
        id: projectId,
        workspace_id: workspaceId,
        title: `YouTube Import ${new Date().toISOString()}`,
        source_type: 'youtube',
        source_path: input.url,
        status: 'queued',
      })
      .select()
      .maybeSingle();

    if (insertError || !project) {
      logger.error('upload_init_youtube_insert_failed', {
        workspaceId,
        message: insertError?.message,
      });
      res.status(500).json(err('internal_error', 'Failed to create project'));
      return;
    }

    // Record project creation usage
    await recordUsage({
      workspaceId,
      metric: 'projects',
      amount: 1,
    });

    // Enqueue YouTube download job
    const { error: jobError } = await admin.from('jobs').insert({
      workspace_id: workspaceId,
      kind: 'YOUTUBE_DOWNLOAD',
      status: 'queued',
      payload: {
        projectId,
        youtubeUrl: input.url,
      },
    });

    if (jobError) {
      logger.error('upload_init_youtube_job_enqueue_failed', {
        workspaceId,
        projectId,
        message: jobError.message,
      });
      // Don’t fail the request, just log
    }

    const payload = UploadInitYtOut.parse({ projectId });

    logEvent({
      service: 'web',
      event: 'upload_init_complete',
      workspaceId,
      projectId,
      meta: {
        source: 'youtube',
        durationMs: Date.now() - started,
        remainingTokens: rate.remaining,
        youtubeUrl: input.url,
      },
    });

    logger.info('upload_init_success', {
      userId,
      workspaceId,
      source: 'youtube',
      projectId,
      durationMs: Date.now() - started,
      remainingTokens: rate.remaining,
    });

    res.status(200).json(ok(payload));
    return;
  } catch (error) {
    logger.error('upload_init_youtube_flow_failed', {
      message: (error as Error)?.message ?? 'unknown',
      workspaceId,
    });
    res.status(500).json(err('internal_error', 'Failed to create project'));
    return;
  }
});

function deriveTitle(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    return trimmed || 'Untitled Project';
  }
  const base = trimmed.slice(0, lastDot).trim();
  return base || 'Untitled Project';
}

