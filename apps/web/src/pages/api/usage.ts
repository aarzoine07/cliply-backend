import type { NextApiRequest, NextApiResponse } from 'next';

import { getUsageSummary } from '@cliply/shared/billing/usageTracker';

import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
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

  try {
    const summary = await getUsageSummary(workspaceId);

    // Transform to API response format
    const response = {
      plan: summary.planName,
      periodStart: summary.periodStart.toISOString(),
      metrics: Object.entries(summary.metrics).reduce(
        (acc, [key, value]) => {
          if (value) {
            acc[key] = {
              used: value.used,
              limit: value.limit,
            };
          }
          return acc;
        },
        {} as Record<string, { used: number; limit: number | null }>,
      ),
    };

    logger.info('usage_summary_fetched', {
      workspaceId,
      plan: summary.planName,
    });

    res.status(200).json(ok(response));
  } catch (error) {
    logger.error('usage_summary_fetch_failed', {
      workspaceId,
      message: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to fetch usage summary'));
  }
});


