import type { NextApiRequest, NextApiResponse } from 'next';

import { getUsageSummary } from '@cliply/shared/billing/usageTracker';
import { calculateUsageAlerts, getPreviousAlertLevel } from '@cliply/shared/billing/usageAlerts';

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

    // Calculate usage alerts
    const alerts = calculateUsageAlerts(summary);

    // Track previous alert levels to detect threshold crossings
    // This is a simple in-memory cache per request cycle.
    // In production, you might use Redis or a database to persist this across requests.
    // For now, we'll log on every call if a metric is in warning/exceeded state.
    // The logging system's sampling will help prevent spam.
    const previousAlerts = (req as any).__previousUsageAlerts as typeof alerts | null;

    // Log threshold crossings (idempotent-ish: log when level changes or when first detected)
    for (const metricStatus of alerts.metrics) {
      const previousLevel = previousAlerts
        ? getPreviousAlertLevel(metricStatus.metric, previousAlerts)
        : null;

      // Log when crossing into warning or exceeded state
      if (metricStatus.level === 'warning' && previousLevel !== 'warning') {
        logger.warn('workspace_usage_warning', {
          workspaceId,
          metric: metricStatus.metric,
          used: metricStatus.used,
          limit: metricStatus.limit,
          percent: metricStatus.percent,
          plan: summary.planName,
        });
      } else if (metricStatus.level === 'exceeded' && previousLevel !== 'exceeded') {
        logger.warn('workspace_usage_exceeded', {
          workspaceId,
          metric: metricStatus.metric,
          used: metricStatus.used,
          limit: metricStatus.limit,
          percent: metricStatus.percent,
          plan: summary.planName,
        });
      }
    }

    // Store current alerts for next request (simple in-memory approach)
    // Note: This won't persist across requests, so logging may happen on each call.
    // This is acceptable as the logging system has sampling to prevent spam.
    (req as any).__previousUsageAlerts = alerts;

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
      alerts: {
        metrics: alerts.metrics.map((m) => ({
          metric: m.metric,
          used: m.used,
          limit: m.limit,
          percent: m.percent,
          level: m.level,
        })),
        hasWarning: alerts.hasWarning,
        hasExceeded: alerts.hasExceeded,
      },
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


