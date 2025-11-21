import { createClient } from "@supabase/supabase-js";
import { logEvent } from "./services/logging.js";

// @ts-ignore – CJS module imported into ESM
import SentryModule from "@cliply/shared/sentry";

const initSentry = SentryModule.initSentry;
const captureError = SentryModule.captureError;


// Env (CJS build → must import default and access properties at runtime)
// @ts-ignore – CJS module imported into ESM
import EnvModule from "@cliply/shared/env";
const getEnv = EnvModule.getEnv;

import type { JobRecord } from "./jobs/types.js";

const env = getEnv();
console.log("WORKER DB URL =", env.SUPABASE_URL);
console.log("WORKER SERVICE ROLE KEY LENGTH =", env.SUPABASE_SERVICE_ROLE_KEY?.length);

const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

const MAX_ATTEMPTS = 5;

// Init Sentry
if (env.SENTRY_DSN) {
  initSentry(env.SENTRY_DSN);
}

/**
 * CLAIM NEXT JOB  — Pure SQL
 * Matches your actual DB:
 *   status: queued | running | succeeded | failed
 *   state : queued | running | done | error
 *   kind  : TRANSCRIBE | ...
 */
async function claimNextJobs(): Promise<JobRecord[]> {
  // 1) Direct SELECT
  const { data: jobs, error: selectErr } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .lte("next_run_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectErr) throw selectErr;
  if (!jobs || jobs.length === 0) return [];

  const job = jobs[0];

  // 2) Update → running
  const { data: updated, error: updateErr } = await supabase
    .from("jobs")
    .update({
      status: "running",
      state: "running", // required for your schema
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select()
    .single();

  if (updateErr || !updated) return [];
  return [updated as JobRecord];
}

/**
 * DISPATCH LOOP
 */
export async function dispatcherLoop() {
  while (true) {
    try {
      const jobs = await claimNextJobs();

      for (const job of jobs) {
        const start = Date.now();

        const jobType = job.kind ?? job.type ?? "UNKNOWN";
        logEvent(job.id, `${jobType}:start`);

        try {
          await runJob(job);

          await supabase
            .from("jobs")
            .update({
              status: "succeeded",
              state: "done",
            })
            .eq("id", job.id);

          logEvent(job.id, `${jobType}:success`, {
            duration_ms: Date.now() - start,
          });

        } catch (err) {
          const attempts = (job.attempts || 0) + 1;

          const backoffSeconds = Math.min(
            300,
            Math.pow(2, attempts) * 30
          );

          const updateData = {
            attempts,
            last_error: (err as Error).message,
            next_run_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
            state: attempts >= MAX_ATTEMPTS ? "error" : "queued",
            status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
          };

          await supabase.from("jobs").update(updateData).eq("id", job.id);

          logEvent(job.id, `${jobType}:failure`, {
            attempts,
            backoffSeconds,
          });

          captureError(err, {
            jobId: job.id,
            jobType,
            attempts,
          });
        }
      }

      await new Promise((r) => setTimeout(r, 3000));

    } catch (err) {
      console.error("Dispatcher error:", err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * RUN JOB
 */
async function runJob(job: JobRecord) {
  const jobType = job.kind ?? job.type ?? "UNKNOWN";

  switch (jobType) {
    case "TRANSCRIBE":
      // TODO implement real work
      return;

    case "RENDER":
      // TODO implement real work
      return;

    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

/**
 * MAIN
 */
async function main() {
  console.log("Starting worker dispatcher...");
  await dispatcherLoop();
}

main().catch((err) => {
  captureError(err as Error, { service: "worker", event: "fatal" });
  console.error("Worker fatal error:", err);
  process.exit(1);
});

