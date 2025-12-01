import type { NextApiRequest, NextApiResponse } from "next";

import { getAdminClient } from "@/lib/supabase";
import { err, ok } from "@/lib/http";
import { logger } from "@/lib/logger";

function hasServiceRoleAccess(req: NextApiRequest): boolean {
  const headerValue = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!headerValue) return false;

  const [scheme, token] = headerValue.split(/\s+/, 2);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return scheme?.toLowerCase() === "bearer" && token === serviceRoleKey;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json(err("method_not_allowed", "Method not allowed"));
    return;
  }

  if (!hasServiceRoleAccess(req)) {
    res.status(403).json(err("forbidden", "Admin access required"));
    return;
  }

  const jobIdParam = req.query.id;
  const jobId = Array.isArray(jobIdParam) ? jobIdParam[0] : jobIdParam;

  if (!jobId || typeof jobId !== "string") {
    res.status(400).json(err("invalid_request", "Invalid job ID"));
    return;
  }

  const admin = getAdminClient();

  try {
    // Load the job
    const { data: job, error: fetchError } = await admin
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchError) {
      logger.error("admin_job_retry_fetch_failed", {
        jobId,
        error: fetchError.message,
      });
      res.status(500).json(err("internal_error", "Failed to load job"));
      return;
    }

    if (!job) {
      res.status(404).json(err("not_found", "Job not found"));
      return;
    }

    const statusBefore = job.status;
    const stateBefore = (job as any).state;

    // Validate that job can be retried
    // Allow retry for: failed, queued (if stuck), or succeeded (if admin wants to rerun)
    // Don't allow retry for: running (use cancel/unlock first)
    if (statusBefore === "running") {
      res.status(400).json(
        err("invalid_request", "Cannot retry a running job. Cancel or unlock it first."),
      );
      return;
    }

    // Reset job to queued state
    const { data: updatedJob, error: updateError } = await admin
      .from("jobs")
      .update({
        status: "queued",
        state: "queued", // Also update state if it exists
        worker_id: null,
        last_heartbeat: null,
        run_after: new Date().toISOString(), // Make it immediately eligible
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select()
      .single();

    if (updateError) {
      logger.error("admin_job_retry_update_failed", {
        jobId,
        error: updateError.message,
      });
      res.status(500).json(err("internal_error", "Failed to update job"));
      return;
    }

    logger.info("admin_job_retry_requested", {
      jobId,
      workspaceId: job.workspace_id,
      statusBefore,
      stateBefore,
      statusAfter: updatedJob.status,
    });

    res.status(200).json(ok({ job: updatedJob }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("admin_job_retry_error", {
      jobId,
      error: message,
    });
    res.status(500).json(err("internal_error", message));
  }
}

