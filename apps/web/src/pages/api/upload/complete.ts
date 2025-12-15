import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getAdminClient, getRlsClient } from '@/lib/supabase';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { checkPlanAccess } from '@cliply/shared/billing/planGate';

const CompleteBody = z.object({ projectId: z.string().uuid() }).strict();

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('upload_complete_start', { method: req.method ?? 'GET' });

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
  const accessToken = auth.accessToken || auth.access_token;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  // T2 (M2): any surface-table access must be via RLS client
  if (!accessToken) {
    res.status(401).json(err('unauthorized', 'Authentication required'));
    return;
  }

  // Plan gate: use concurrent_jobs as proxy for upload completion capability
  const gate = checkPlanAccess(auth.plan, 'concurrent_jobs');
  if (!gate.active) {
    const status = gate.reason === 'limit' ? 429 : 403;
    res.status(status).json(
      err(
        gate.reason === 'limit' ? 'plan_limit' : 'plan_required',
        gate.message ?? 'Your current plan does not allow completing uploads.',
      ),
    );
    return;
  }

  const rate = await checkRateLimit(userId, 'upload:complete');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const parsed = CompleteBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const { projectId } = parsed.data;

  const rls = getRlsClient(accessToken);
  const admin = getAdminClient();

  // Verify the project exists AND is accessible to this workspace member (RLS)
  const { data: project, error: projectError } = await rls
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();

  if (projectError) {
    logger.error('upload_complete_project_check_failed', {
      workspaceId,
      projectId,
      message: projectError.message,
    });
    res.status(500).json(err('internal_error', 'Failed to verify project'));
    return;
  }

  if (!project) {
    res.status(404).json(err('not_found', 'Project not found'));
    return;
  }

  // Enqueue transcript job (non-surface table; admin is OK)
  const { error } = await admin.from('jobs').insert({
    workspace_id: workspaceId,
    kind: 'TRANSCRIBE',
    status: 'queued',
    payload: { projectId },
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