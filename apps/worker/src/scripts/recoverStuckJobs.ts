/**
 * Script to recover stuck jobs by calling worker_recover_stuck_jobs RPC.
 * This can be run periodically via cron to clean up jobs that have stale heartbeats.
 * 
 * Usage:
 *   STUCK_JOB_STALE_AFTER_SECONDS=900 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts
 */

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

const env = getEnv();

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  const staleAfterSeconds = Number(process.env.STUCK_JOB_STALE_AFTER_SECONDS ?? "900"); // Default: 15 minutes

  if (!Number.isFinite(staleAfterSeconds) || staleAfterSeconds <= 0) {
    throw new Error(`Invalid STUCK_JOB_STALE_AFTER_SECONDS: ${process.env.STUCK_JOB_STALE_AFTER_SECONDS}`);
  }

  logger.info("stuck_jobs_recover_start", {
    service: "worker",
    staleAfterSeconds,
  });

  const { data, error } = await supabase.rpc("worker_recover_stuck_jobs", {
    p_stale_after_seconds: staleAfterSeconds,
  });

  if (error) {
    logger.error("stuck_jobs_recover_failed", {
      service: "worker",
      staleAfterSeconds,
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    process.exitCode = 1;
    return;
  }

  const recoveredCount = typeof data === "number" ? data : 0;

  logger.info("stuck_jobs_recovered", {
    service: "worker",
    staleAfterSeconds,
    recoveredCount,
  });

  if (recoveredCount > 0) {
    logger.info("stuck_jobs_recovered_details", {
      service: "worker",
      staleAfterSeconds,
      recoveredCount,
      message: `Recovered ${recoveredCount} stuck job(s)`,
    });
  }
}

main().catch((err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  logger.error("stuck_jobs_recover_exception", {
    service: "worker",
    error: errorMessage,
  });
  process.exitCode = 1;
});

