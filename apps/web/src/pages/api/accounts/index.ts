import type { NextApiRequest, NextApiResponse } from 'next';

import { CreateConnectedAccountInput, ConnectedAccountPlatform } from '@cliply/shared/schemas/accounts';

import { HttpError } from '@/lib/errors';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as connectedAccountsService from '@/lib/accounts/connectedAccountsService';
import { buildAuthContext, handleAuthError } from '@/lib/auth/context';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  let auth;
  try {
    auth = await buildAuthContext(req);
  } catch (error) {
    handleAuthError(error, res);
    return;
  }

  const userId = auth.userId || auth.user_id;
  const workspaceId = auth.workspaceId || auth.workspace_id;

  if (!workspaceId) {
    res.status(400).json(err('invalid_request', 'workspace required'));
    return;
  }

  const supabase = getAdminClient();

  if (req.method === 'GET') {
    try {
      const platform = req.query.platform as ConnectedAccountPlatform | undefined;
      if (platform && !ConnectedAccountPlatform.safeParse(platform).success) {
        res.status(400).json(err('invalid_request', 'Invalid platform'));
        return;
      }

      const accounts = await connectedAccountsService.listConnectedAccounts(
        {
          workspaceId,
          platform,
        },
        { supabase },
      );

      logger.info('accounts_listed', {
        workspaceId,
        platform,
        count: accounts.length,
      });

      res.status(200).json(ok({ data: { accounts } }));
    } catch (error) {
      logger.error('accounts_list_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to list accounts'));
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

    const parsed = CreateConnectedAccountInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).json(err('invalid_request', 'Invalid payload', parsed.error.flatten()));
      return;
    }

    try {
      const account = await connectedAccountsService.createOrUpdateConnectedAccount(
        {
          workspaceId,
          userId,
          ...parsed.data,
        },
        { supabase },
      );

      logger.info('account_created_or_updated', {
        workspaceId,
        accountId: account.id,
        platform: account.platform,
      });

      res.status(200).json(ok({ data: account }));
    } catch (error) {
      logger.error('account_create_failed', {
        workspaceId,
        message: (error as Error)?.message ?? 'unknown',
      });
      res.status(500).json(err('internal_error', 'Failed to create or update account'));
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json(err('method_not_allowed', 'Method not allowed'));
});


