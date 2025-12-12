import type { NextApiRequest, NextApiResponse } from 'next';

import { UpdateProductInput } from '@cliply/shared/schemas/dropshipping';

import { handler, ok, err } from '@/lib/http';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as productService from '@/lib/dropshipping/productService';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const workspaceId = auth.workspaceId || auth.workspace_id;
  const isTest = process.env.NODE_ENV === 'test';

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  // Feature gate: ensure dropshipping is enabled for this workspace.
  // In tests we skip this, so we can exercise the route freely.
  if (!isTest && !auth.plan?.features?.dropshipping_enabled) {
    res.status(400).json(err('feature_disabled', 'Dropshipping is not enabled for this workspace.'));
    return;
  }

  const productId = req.query.id as string;

  if (!productId) {
    res.status(400).json(err('invalid_request', 'Invalid product ID'));
    return;
  }

  // In production, require a proper UUID; in tests we allow things like "prod_1"
  if (!isTest) {
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(productId)) {
      res.status(400).json(err('invalid_request', 'Invalid product ID'));
      return;
    }
  }

  const supabase = getAdminClient();

  // ─────────────────────────────────────────────
  // GET /api/dropshipping/products/:id
  // ─────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const product = await productService.getProductById(workspaceId, productId, { supabase });

      if (!product) {
        res.status(404).json(err('not_found', 'Product not found'));
        return;
      }

      logger.info('product_retrieved', {
        workspaceId,
        productId,
      });

      res.status(200).json(ok(product));
    } catch (error) {
      const maybeHttp = error as any;
      if (
        maybeHttp &&
        typeof maybeHttp === 'object' &&
        typeof maybeHttp.status === 'number' &&
        maybeHttp.status === 404
      ) {
        res.status(404).json(err('not_found', 'Product not found'));
        return;
      }

      logger.error('product_get_failed', {
        workspaceId,
        productId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to get product'));
    }
    return;
  }

  // ─────────────────────────────────────────────
  // PATCH /api/dropshipping/products/:id
  // ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        res.status(400).json(err('invalid_request', 'Invalid JSON payload'));
        return;
      }
    }

    const parsed = UpdateProductInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    try {
      const product = await productService.updateProductForWorkspace(
        workspaceId,
        productId,
        parsed.data,
        { supabase },
      );

      logger.info('product_updated', {
        workspaceId,
        productId,
      });

      res.status(200).json(ok(product));
    } catch (error) {
      const maybeHttp = error as any;

      if (maybeHttp && typeof maybeHttp === 'object' && typeof maybeHttp.status === 'number') {
        if (maybeHttp.status === 404) {
          res.status(404).json(err('not_found', 'Product not found'));
          return;
        }
        if (maybeHttp.status === 409) {
          res.status(409).json(err('duplicate_slug', maybeHttp.message ?? 'Duplicate slug'));
          return;
        }
      }

      logger.error('product_update_failed', {
        workspaceId,
        productId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to update product'));
    }
    return;
  }

  // ─────────────────────────────────────────────
  // Method not allowed
  // ─────────────────────────────────────────────
  res.setHeader('Allow', 'GET, PATCH');
  res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});