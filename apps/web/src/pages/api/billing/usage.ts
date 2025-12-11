// D1: Billing usage endpoint - returns usage-only data for lightweight frontend queries
import type { NextApiRequest, NextApiResponse } from "next";

import { requireUser } from "@/lib/auth";
import { getWorkspaceUsageSummary } from "@/lib/billing/usageService";
import { HttpError } from "@/lib/errors";
import { handler, ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase";

/**
 * GET /api/billing/usage
 *
 * Returns usage-only data for a workspace (lighter payload than /api/billing/status).
 *
 * Response shape:
 * {
 *   ok: true,
 *   data: {
 *     minutes: { used, limit, remaining, softLimit, hardLimit },
 *     clips: { used, limit, remaining, softLimit, hardLimit },
 *     projects: { used, limit, remaining, softLimit, hardLimit },
 *     posts: { used, limit, remaining, softLimit, hardLimit }
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
    logger.warn("billing_usage_missing_workspace", { userId });
    res.status(400).json(err("invalid_request", "Missing workspace context"));
    return;
  }

  try {
    const admin = getAdminClient();

    try {
      const summary = await getWorkspaceUsageSummary(workspaceId, admin);

      logger.info("billing_usage_fetched", {
        workspaceId,
        plan: summary.plan.tier,
      });

      // Return only the usage section for a lighter payload
      // Tests expect: res.body.data.minutes, not res.body.data.data.minutes
      res.status(200).json(ok(summary.usage));
    } catch (serviceError) {
      const errorMessage =
        serviceError instanceof Error ? serviceError.message : "Unknown error";

      // Handle workspace not found
      if (errorMessage.includes("Workspace not found")) {
        logger.warn("billing_usage_workspace_not_found", { workspaceId });
        res
          .status(404)
          .json(err("workspace_not_found", "Workspace not found"));
        return;
      }

      // Re-throw other errors
      throw serviceError;
    }
  } catch (error) {
    // Re-throw HttpErrors so the handler wrapper can process them
    if (error instanceof HttpError) {
      throw error;
    }

    logger.error("billing_usage_fetch_failed", {
      message: (error as Error)?.message ?? "unknown",
    });
    res
      .status(500)
      .json(
        err("internal_error", "Unexpected error while fetching usage data"),
      );
  }
});

