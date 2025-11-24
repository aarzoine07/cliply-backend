import type { NextApiRequest, NextApiResponse } from 'next';

import { CreateExperimentInput } from '@cliply/shared/schemas/viral';

import { handler, ok, err } from '@/lib/http';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as experimentService from '@/lib/viral/experimentService';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
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

  const supabase = getAdminClient();

  if (req.method === 'GET') {
    try {
      const experiments = await experimentService.listExperiments({
        workspaceId,
        supabase,
      });

      logger.info('experiments_listed', {
        workspaceId,
        count: experiments.length,
      });

      res.status(200).json(ok({ experiments }));
    } catch (error) {
      logger.error('experiments_list_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to list experiments'));
    }
    return;
  }

  if (req.method === 'POST') {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
        return;
      }
    }

    const parsed = CreateExperimentInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    try {
      const experiment = await experimentService.createExperimentWithVariants(parsed.data, {
        workspaceId,
        supabase,
      });

      logger.info('experiment_created', {
        workspaceId,
        experimentId: experiment.id,
      });

      res.status(201).json(ok(experiment));
    } catch (error) {
      logger.error('experiment_create_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to create experiment'));
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});


