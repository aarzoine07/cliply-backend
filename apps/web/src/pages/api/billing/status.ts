// D1: Billing status endpoint - returns plan, usage, limits, and remaining
import type { NextApiRequest, NextApiResponse } from 'next';

import { PLAN_MATRIX } from '@cliply/shared/billing/planMatrix';
import { getUsageSummary } from '@cliply/shared/billing/usageTracker';
import type { PlanName } from '@cliply/shared/types/auth';

import { requireUser } from '@/lib/auth';
import { handler, ok, err } from '@/lib/http';
import { logger } from '@/lib/logger';
import { getAdminClient } from '@/lib/supabase';
import * as workspacePlanService from '@/lib/billing/workspacePlanService';

export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json(err('method_not_allowed', 'Method not allowed'));
    return;
  }

  try {
    const auth = requireUser(req);
    const { workspaceId } = auth;

    if (!workspaceId) {
      res.status(400).json(err('invalid_request', 'workspace required'));
      return;
    }

    const supabase = getAdminClient();

    // Get workspace plan and billing status
    const plan = await workspacePlanService.getWorkspacePlan(workspaceId, { supabase });

    // Get workspace billing status
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('billing_status')
      .eq('id', workspaceId)
      .maybeSingle();

    if (workspaceError) {
      logger.error('billing_status_workspace_fetch_failed', {
        workspaceId,
        error: workspaceError.message,
      });
    }

    const billingStatus = workspace?.billing_status ?? 'active';

    // Get usage summary
    const usageSummary = await getUsageSummary(workspaceId);

    // Get plan limits from planMatrix
    const planDefinition = PLAN_MATRIX[plan];
    if (!planDefinition) {
      logger.error('billing_status_invalid_plan', {
        workspaceId,
        plan,
      });
      res.status(500).json(err('internal_error', 'Invalid plan configuration'));
      return;
    }

    const limits = {
      source_minutes: planDefinition.limits.source_minutes_per_month ?? null,
      clips: planDefinition.limits.clips_per_month ?? null,
      projects: planDefinition.limits.projects_per_month ?? null,
    };

    // Calculate remaining
    const remaining = {
      source_minutes:
        limits.source_minutes !== null
          ? Math.max(0, limits.source_minutes - (usageSummary.metrics.source_minutes?.used ?? 0))
          : null,
      clips:
        limits.clips !== null
          ? Math.max(0, limits.clips - (usageSummary.metrics.clips?.used ?? 0))
          : null,
      projects:
        limits.projects !== null
          ? Math.max(0, limits.projects - (usageSummary.metrics.projects?.used ?? 0))
          : null,
    };

    // Build usage object
    const usage = {
      source_minutes: usageSummary.metrics.source_minutes?.used ?? 0,
      clips: usageSummary.metrics.clips?.used ?? 0,
      projects: usageSummary.metrics.projects?.used ?? 0,
    };

    const response = {
      plan,
      billingStatus,
      limits,
      usage,
      remaining,
    };

    logger.info('billing_status_fetched', {
      workspaceId,
      plan,
      billingStatus,
    });

    res.status(200).json(ok(response));
  } catch (error) {
    logger.error('billing_status_fetch_failed', {
      message: (error as Error)?.message ?? 'unknown',
    });
    res.status(500).json(err('internal_error', 'Failed to fetch billing status'));
  }
});

