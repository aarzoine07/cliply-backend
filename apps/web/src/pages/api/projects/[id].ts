import type { NextApiRequest, NextApiResponse } from 'next';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('project_detail_start', { method: req.method ?? 'GET' });

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  const auth = requireUser(req);
  const { userId, workspaceId, supabase } = auth;

  const rate = await checkRateLimit(userId, 'projects:detail');
  if (!rate.allowed) {
    res.status(429).json(err('too_many_requests', 'Rate limited'));
    return;
  }

  const idParam = (req.query?.id ?? '') as string | string[];
  const projectId = Array.isArray(idParam) ? idParam[0] : idParam;

  if (!projectId) {
    res.status(400).json(err('invalid_request', 'missing id'));
    return;
  }

  const project = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (project.error) {
    logger.error('project_detail_query_failed', { message: project.error.message, projectId });
    res.status(500).json(err('internal_error', 'Failed to fetch project'));
    return;
  }

  if (project.data && workspaceId && project.data.workspace_id && project.data.workspace_id !== workspaceId) {
    res.status(403).json(err('forbidden', 'Project not accessible'));
    return;
  }

  const clips = await supabase.from('clips').select('*').eq('project_id', projectId);
  if (clips.error) {
    logger.error('project_detail_clips_failed', { message: clips.error.message, projectId });
    res.status(500).json(err('internal_error', 'Failed to fetch clips'));
    return;
  }

  logger.info('project_detail_success', {
    userId,
    projectId,
    durationMs: Date.now() - started,
    remainingTokens: rate.remaining,
  });

  res.status(200).json(ok({ project: project.data ?? null, clips: clips.data ?? [] }));
});