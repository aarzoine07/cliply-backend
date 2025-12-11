import type { NextApiRequest, NextApiResponse } from 'next';

import {
  ExecuteDropshippingActionInput,
  ExecuteDropshippingActionInput as ExecuteDropshippingActionInputSchema,
} from '@cliply/shared/schemas/dropshipping';

import { handler, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as actionExecutorService from '@/lib/dropshipping/actionExecutorService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  try {
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

    const actionId = req.query.id as string;
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!actionId || !uuidPattern.test(actionId)) {
      res.status(400).json(err('invalid_request', 'Invalid action ID'));
      return;
    }

    // Parse body
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
        return;
      }
    }

    const parsed = ExecuteDropshippingActionInputSchema.safeParse(body || {});
    if (!parsed.success) {
      res
        .status(400)
        .json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    const supabase = getAdminClient();

    const action = await actionExecutorService.executeDropshippingAction(
      workspaceId,
      actionId,
      parsed.data,
      { supabase },
    );

    logger.info('action_execute_route_success', {
      workspaceId,
      actionId,
      status: action.status,
      dryRun: parsed.data.dryRun,
    });

    // Shape that tests expect:
    // { ok: true, data: action }
    res.status(200).json({
      ok: true,
      data: action,
    });
  } catch (error) {
    const errObj = error as Error & { status?: number; code?: string };

    // Special-case: executor can throw a plain Error("Action not found")
    if (errObj.message === 'Action not found') {
      res.status(404).json(err('not_found', errObj.message));
      return;
    }

    if (errObj.status) {
      if (errObj.status === 401) {
        res.status(401).json(err('unauthorized', errObj.message));
        return;
      }
      if (errObj.status === 404) {
        res.status(404).json(err('not_found', errObj.message));
        return;
      }
      if (errObj.status === 409) {
        res
          .status(409)
          .json(err(errObj.code || 'action_already_processed', errObj.message));
        return;
      }
      if (errObj.status === 400) {
        res
          .status(400)
          .json(err(errObj.code || 'invalid_request', errObj.message));
        return;
      }
    }

    const workspaceId = 'unknown';
    logger.error('action_execute_route_failed', {
      workspaceId,
      actionId: (req.query.id as string) || 'unknown',
      message: errObj?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to execute action'));
  }
});
