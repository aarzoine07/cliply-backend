import type { NextApiRequest, NextApiResponse } from 'next';

import {
  UpsertProductCreativeSpecInput,
  UpsertProductCreativeSpecInput as UpsertProductCreativeSpecInputSchema,
} from '@cliply/shared/schemas/dropshippingCreative';

import { HttpError } from '@/lib/errors';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as creativeService from '@/lib/dropshipping/creativeService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

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

  const productId = req.query.id as string;
  if (!productId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    res.status(400).json(err('invalid_request', 'Invalid product ID'));
    return;
  }

  const supabase = getAdminClient();

  if (req.method === 'GET') {
    try {
      const spec = await creativeService.getCreativeSpecForProduct(workspaceId, productId, { supabase });

      if (!spec) {
        res.status(404).json(err('not_found', 'Product not found'));
        return;
      }

      logger.info('creative_spec_retrieved', {
        workspaceId,
        productId,
      });

      res.status(200).json(ok(spec));
    } catch (error) {
      logger.error('creative_spec_get_failed', {
        workspaceId,
        productId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to get creative spec'));
    }
    return;
  }

  if (req.method === 'PUT') {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
        return;
      }
    }

    const parsed = UpsertProductCreativeSpecInputSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    try {
      const spec = await creativeService.upsertCreativeSpecForProduct(workspaceId, productId, parsed.data, { supabase });

      logger.info('creative_spec_upserted', {
        workspaceId,
        productId,
      });

      res.status(200).json(ok(spec));
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 404) {
          res.status(404).json(err('not_found', 'Product not found'));
          return;
        }
      }

      if ((error as Error)?.message?.includes('not found')) {
        res.status(404).json(err('not_found', (error as Error).message));
        return;
      }

      logger.error('creative_spec_upsert_failed', {
        workspaceId,
        productId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to upsert creative spec'));
    }
    return;
  }

  res.setHeader('Allow', 'GET, PUT');
  res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});


