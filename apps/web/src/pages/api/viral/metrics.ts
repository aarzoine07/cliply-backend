import type { NextApiRequest, NextApiResponse } from 'next';

import { RecordMetricsInput } from '@cliply/shared/schemas/viral';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as metricsService from '@/lib/viral/metricsService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
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

  const workspaceId = auth.workspaceId || auth.workspace_id;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
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

  const parsed = RecordMetricsInput.safeParse(body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const supabase = getAdminClient();

  try {
    await metricsService.recordVariantMetrics(parsed.data, {
      workspaceId,
      supabase,
    });

    logger.info('metrics_recorded', {
      workspaceId,
      variantPostId: parsed.data.variant_post_id,
    });

    res.status(200).json(ok({ success: true }));
  } catch (error) {
    logger.error('metrics_record_failed', {
      workspaceId,
      message: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to record metrics'));
  }
});


