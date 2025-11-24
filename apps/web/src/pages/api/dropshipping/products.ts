import type { NextApiRequest, NextApiResponse } from 'next';

import { CreateProductInput } from '@cliply/shared/schemas/dropshipping';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as productService from '@/lib/dropshipping/productService';
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

  const supabase = getAdminClient();

  if (req.method === 'GET') {
    try {
      const products = await productService.listProductsForWorkspace(workspaceId, { supabase });

      logger.info('products_listed', {
        workspaceId,
        count: products.length,
      });

      res.status(200).json(ok({ products }));
    } catch (error) {
      logger.error('products_list_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to list products'));
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

    const parsed = CreateProductInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    try {
      const product = await productService.createProductForWorkspace(workspaceId, parsed.data, { supabase });

      logger.info('product_created', {
        workspaceId,
        productId: product.id,
      });

      res.status(201).json(ok(product));
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        res.status(409).json(err('duplicate_slug', error.message));
        return;
      }

      logger.error('product_create_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to create product'));
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});


