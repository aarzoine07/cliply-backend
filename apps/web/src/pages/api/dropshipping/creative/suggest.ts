import type { NextApiRequest, NextApiResponse } from 'next';

import { DropshippingCreativeInput } from '@cliply/shared/schemas/dropshippingCreative';

import { HttpError } from '@/lib/errors';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as creativeService from '@/lib/dropshipping/creativeService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  const started = Date.now();
  logger.info('dropshipping_creative_suggest_start', { method: req.method ?? 'GET' });

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

  const parsed = DropshippingCreativeInput.safeParse(body);
  if (!parsed.success) {
    res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
    return;
  }

  const supabase = getAdminClient();

  try {
    const creative = await creativeService.generateCreativeForProduct(parsed.data, {
      workspaceId,
      supabase,
    });

    logger.info('dropshipping_creative_suggest_success', {
      workspaceId,
      productId: parsed.data.productId,
      clipId: parsed.data.clipId,
      durationMs: Date.now() - started,
    });

    res.status(200).json(ok(creative));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) {
        res.status(404).json(err('not_found', error.message));
        return;
      }
    }

    if ((error as Error)?.message?.includes('not found')) {
      res.status(404).json(err('not_found', (error as Error).message));
      return;
    }

    logger.error('dropshipping_creative_suggest_failed', {
      workspaceId,
      productId: parsed.data.productId,
      message: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to generate creative'));
  }
});


