import { createClient } from "@supabase/supabase-js";
import { logEvent } from "./services/logging.js";
import { initSentry, captureError } from "@cliply/shared/sentry";
import { getEnv } from "@cliply/shared/env";
import type { JobRecord } from "./jobs/types.js";

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

const MAX_ATTEMPTS = 5;

// Initialize Sentry if DSN is configured
if (env.SENTRY_DSN) {
  initSentry(env.SENTRY_DSN);
}

async function claimNextJobs(): Promise<JobRecord[]> {
  // Try RPC first, fallback to atomic update
  try {
    const { data, error } = await supabase.rpc("claim_next_jobs");
    if (!error && data) {
      return Array.isArray(data) ? (data as JobRecord[]) : [data as JobRecord];
    }
  } catch {
    // RPC doesn't exist, use atomic update approach
  }

  // Fallback: atomic claim using update with WHERE clause
  const { data: jobs, error: sqlError } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lte("next_run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);

  if (sqlError) throw sqlError;
  if (!jobs || jobs.length === 0) return [];

  // Atomically update status to processing (acts as a lock)
  const job = jobs[0];
  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({ status: "processing" })
    .eq("id", job.id)
    .eq("status", "pending")
    .select()
    .single();

  if (updateError || !updated) return [];
  return [updated as JobRecord];
}

export async function dispatcherLoop() {
  while (true) {
    try {
      const jobs = await claimNextJobs();

      for (const job of jobs) {
        const start = Date.now();
        logEvent(job.id, `${job.type}:start`);

        try {
          await runJob(job);
          await supabase.from("jobs").update({ status: "completed" }).eq("id", job.id);
          logEvent(job.id, `${job.type}:success`, { duration_ms: Date.now() - start });
    } catch (err) {
          const attempts = (job.attempts || 0) + 1;
          const backoffSeconds = Math.min(300, Math.pow(2, attempts) * 30);
          const nextRunAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

          const updateData: Partial<JobRecord> = {
            attempts,
            last_error: (err as Error).message,
            next_run_at: nextRunAt,
          };

          if (attempts >= MAX_ATTEMPTS) {
            updateData.status = "failed";
          } else {
            updateData.status = "pending";
          }

          await supabase.from("jobs").update(updateData).eq("id", job.id);
          logEvent(job.id, `${job.type}:failure`, { attempts, backoffSeconds });
          captureError(err, { jobId: job.id, jobType: job.type, attempts });
        }
      }

      await new Promise((r) => setTimeout(r, 5000));
    } catch (error) {
      console.error("Dispatcher error:", error);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function runJob(job: JobRecord) {
  switch (job.type) {
    case "transcribe":
      // placeholder: implement transcription logic
      break;
    case "render":
      // placeholder: implement rendering logic
      break;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

// Main entry point
async function main() {
  console.log("Starting worker dispatcher...");
  await dispatcherLoop();
}

main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  captureError(err, { service: "worker", event: "worker_fatal" });
  console.error("Worker fatal error:", err);
  process.exit(1);
});
