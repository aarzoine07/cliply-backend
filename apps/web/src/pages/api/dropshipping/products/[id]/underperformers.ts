import type { NextApiRequest, NextApiResponse } from 'next';

import {
  UnderperformersQuery,
  UnderperformersQuery as UnderperformersQuerySchema,
} from '@cliply/shared/schemas/dropshipping';

import { HttpError } from '@/lib/errors';
import { handler, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as analyticsService from '@/lib/dropshipping/analyticsService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

  const productId = req.query.id as string;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!productId || !uuidPattern.test(productId)) {
    res.status(400).json(err('invalid_request', 'Invalid product ID'));
    return;
  }

  // Parse query params
  const queryParams: Record<string, unknown> = {};
  if (req.query.window) {
    queryParams.window = req.query.window;
  }
  if (req.query.minViews) {
    const minViews = Number(req.query.minViews);
    if (!isNaN(minViews)) {
      queryParams.minViews = minViews;
    }
  }
  if (req.query.maxCtr) {
    const maxCtr = Number(req.query.maxCtr);
    if (!isNaN(maxCtr)) {
      queryParams.maxCtr = maxCtr;
    }
  }

  const parsed = UnderperformersQuerySchema.safeParse(queryParams);
  if (!parsed.success) {
    res
      .status(400)
      .json(err('invalid_request', 'Invalid query parameters', parsed.error.flatten()));
    return;
  }

  const supabase = getAdminClient();

  try {
    const underperformers = await analyticsService.getUnderperformingPostsForProduct(
      workspaceId,
      productId,
      parsed.data,
      { supabase },
    );

    logger.info('product_underperformers_retrieved', {
      workspaceId,
      productId,
      window: parsed.data.window,
      count: underperformers.length,
    });

    // Explicitly match test expectations: { ok: true, data: underperformers[] }
    res.status(200).json({
      ok: true,
      data: underperformers,
    });
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

    logger.error('product_underperformers_failed', {
      workspaceId,
      productId,
      message: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to get underperformers'));
  }
});