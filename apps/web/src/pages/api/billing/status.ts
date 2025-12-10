// D1: Billing status endpoint - returns plan, usage, limits, and remaining
// Updated to use usageService for consolidated billing/usage summary
import type { NextApiRequest, NextApiResponse } from "next";

import { requireUser } from "@/lib/auth";
import {
  getWorkspaceUsageSummary,
  type BillingStatusSummary,
} from "@/lib/billing/usageService";
import { HttpError } from "@/lib/errors";
import { handler, ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase";

/**
 * GET /api/billing/status
 *
 * Returns comprehensive billing and usage status for a workspace.
 *
 * Response shape:
 * {
 *   ok: true,
 *   data: {
 *     plan: { tier, billingStatus, trial: { active, endsAt } },
 *     usage: {
 *       minutes: { used, limit, remaining, softLimit, hardLimit },
 *       clips: { used, limit, remaining, softLimit, hardLimit },
 *       projects: { used, limit, remaining, softLimit, hardLimit },
 *       posts: { used, limit, remaining, softLimit, hardLimit }
 *     },
 *     softLimit: boolean,  // true if ANY bucket is at soft limit
 *     hardLimit: boolean   // true if ANY bucket is at hard limit
 *   }
 * }
 */
export default handler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  // Auth check - let HttpError propagate to handler wrapper
  const auth = requireUser(req);
  const { userId, workspaceId } = auth;

  if (!workspaceId) {
    logger.warn("billing_status_missing_workspace", { userId });
    res.status(400).json(err("invalid_request", "Missing workspace context"));
    return;
  }

  try {
    const admin = getAdminClient();

    let summary: BillingStatusSummary;
    try {
      summary = await getWorkspaceUsageSummary(workspaceId, admin);
    } catch (serviceError) {
      const errorMessage =
        serviceError instanceof Error ? serviceError.message : "Unknown error";

      // Handle workspace not found
      if (errorMessage.includes("Workspace not found")) {
        logger.warn("billing_status_workspace_not_found", { workspaceId });
        res
          .status(404)
          .json(err("workspace_not_found", "Workspace not found"));
        return;
      }

      // Re-throw other errors
      throw serviceError;
    }

    // Compute top-level soft/hard limit flags for UX convenience
    const softLimit =
      summary.usage.minutes.softLimit ||
      summary.usage.clips.softLimit ||
      summary.usage.projects.softLimit ||
      summary.usage.posts.softLimit;

    const hardLimit =
      summary.usage.minutes.hardLimit ||
      summary.usage.clips.hardLimit ||
      summary.usage.projects.hardLimit ||
      summary.usage.posts.hardLimit;

    logger.info("billing_status_fetched", {
      workspaceId,
      plan: summary.plan.tier,
      billingStatus: summary.plan.billingStatus,
      softLimit,
      hardLimit,
    });

    // ok() wraps in { ok: true, data: {...} }, so don't double-wrap
    res.status(200).json(
      ok({
        plan: summary.plan,
        usage: summary.usage,
        softLimit,
        hardLimit,
      }),
    );
  } catch (error) {
    // Re-throw HttpErrors so the handler wrapper can process them
    if (error instanceof HttpError) {
      throw error;
    }

    logger.error("billing_status_fetch_failed", {
      message: (error as Error)?.message ?? "unknown",
    });
    res
      .status(500)
      .json(
        err("internal_error", "Unexpected error while fetching billing status"),
      );
  }
});
