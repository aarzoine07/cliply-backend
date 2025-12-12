/**
 * Engine-internal job administration helpers
 * These functions are for managing jobs in the Dead-Letter Queue (DLQ)
 * and other administrative operations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@cliply/shared/logging/logger";

export interface RequeueDeadLetterJobOptions {
  supabaseClient: SupabaseClient;
  jobId: string;
}

/**
 * Requeues a job from the Dead-Letter Queue back to queued state.
 * This allows manual recovery of jobs that exceeded max_attempts.
 *
 * @param options - Configuration object
 * @param options.supabaseClient - Supabase client with service role permissions
 * @param options.jobId - UUID of the job to requeue
 * @throws Error if job is not in dead_letter state or if requeue fails
 */
export async function requeueDeadLetterJob(
  options: RequeueDeadLetterJobOptions,
): Promise<void> {
  const { supabaseClient, jobId } = options;

  // Load current job state by ID only; state is validated in-code
  const { data: job, error: fetchError } = await supabaseClient
    .from("jobs")
    .select("id, state, attempts, max_attempts, workspace_id, kind")
    .eq("id", jobId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to fetch job ${jobId}: ${fetchError.message}`);
  }

  if (!job) {
    // Used by the "job does not exist" test — any thrown error is acceptable,
    // but keep this message explicit.
    throw new Error(`Job ${jobId} not found: Job does not exist`);
  }

  // Safety check: only requeue jobs in dead_letter state
  // Tests expect this exact error pattern:
  // /Cannot requeue job .*expected "dead_letter"/i
  if (job.state !== "dead_letter") {
    throw new Error(
      `Cannot requeue job ${jobId}: expected "dead_letter" but got "${job.state}"`,
    );
  }

  const now = new Date().toISOString();

  // Reset job to queued state for retry; do NOT clear error field
  const { error: updateError } = await supabaseClient
    .from("jobs")
    .update({
      state: "queued",
      attempts: 0, // Reset attempts to allow fresh retry
      run_at: now, // Make it eligible for immediate claim
      locked_at: null,
      locked_by: null,
      heartbeat_at: null,
      updated_at: now,
      // NOTE: we intentionally do not touch `error` so tests can rely
      // on the original failure context still being present.
    })
    .eq("id", jobId)
    .eq("state", "dead_letter"); // Additional safety: only update if still dead_letter

  if (updateError) {
    throw new Error(`Failed to requeue job ${jobId}: ${updateError.message}`);
  }

  // Log requeue event
  logger.info("job_requeued_from_dead_letter", {
    service: "worker",
    job_id: jobId,
    workspace_id: job.workspace_id,
    kind: job.kind,
    previous_attempts: job.attempts,
    max_attempts: job.max_attempts,
  });

  // Optionally log to job_events if the table exists
  try {
    await supabaseClient.from("job_events").insert({
      job_id: jobId,
      stage: "enqueued",
      data: {
        reason: "requeued_from_dead_letter",
        previous_attempts: job.attempts,
        requeued_at: now,
      },
    });
  } catch (eventError) {
    // Non-fatal: log but don't fail the requeue
    logger.warn(
      "job_requeue_event_log_failed",
      { service: "worker", job_id: jobId },
      {
        error:
          eventError instanceof Error
            ? eventError.message
            : String(eventError),
      },
    );
  }
}