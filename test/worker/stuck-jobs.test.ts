import { beforeAll, describe, expect, it } from "vitest";

import { supabaseTest, resetDatabase } from "../../packages/shared/test/setup";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKER_ID = "stuck-jobs-test-worker";
const MAX_ATTEMPTS = 3;

/**
 * Ensure we always have a non-null Supabase client for these tests.
 * If test setup is broken, fail fast with a clear error.
 */
function getSupabase() {
  if (!supabaseTest) {
    throw new Error("supabaseTest is not initialized. Check test setup.");
  }
  return supabaseTest;
}

/**
 * Supabase RPCs that return a row type sometimes come back as an
 * "all-null row" instead of literal null when the function returns NULL.
 * For these tests, treat that as equivalent to "no row / null".
 */
function normalizeJobRow<T extends { id: string | null } | null>(
  row: T,
): T | null {
  if (!row) return null;
  if (row.id === null) return null;
  return row;
}

describe("Stuck Job Recovery – ME-I-09", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  describe("worker_heartbeat RPC", () => {
    it("should update heartbeat_at for running job owned by worker", async () => {
      const supabase = getSupabase();

      // Create a running job
      const { data: job, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "heartbeat" },
          max_attempts: 5,
          state: "running",
          locked_by: WORKER_ID,
          locked_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(job).toBeTruthy();
      if (!job) {
        throw new Error("Expected job to be created");
      }
      expect(job.state).toBe("running");

      // Wait a moment to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send heartbeat
      const { data: rawUpdatedJob, error: heartbeatError } = await supabase.rpc(
        "worker_heartbeat",
        {
          p_job_id: job.id,
          p_worker_id: WORKER_ID,
        },
      );

      const updatedJob = normalizeJobRow(
        rawUpdatedJob as { id: string | null; heartbeat_at?: string | null } | null,
      );

      expect(heartbeatError).toBeNull();
      expect(updatedJob).toBeTruthy();
      if (!updatedJob) {
        throw new Error("Expected updated job after heartbeat");
      }
      expect(updatedJob.id).toBe(job.id);
      expect(updatedJob.heartbeat_at).toBeTruthy();
      expect(new Date(updatedJob.heartbeat_at as string).getTime()).toBeGreaterThan(
        new Date(job.locked_at ?? new Date()).getTime(),
      );
    });

    it("should not update heartbeat for job not owned by worker", async () => {
      const supabase = getSupabase();
      const otherWorkerId = "other-worker";

      // Create a running job owned by different worker
      const { data: job, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "heartbeat-other" },
          max_attempts: 5,
          state: "running",
          locked_by: otherWorkerId,
          locked_at: new Date().toISOString(),
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(job).toBeTruthy();
      if (!job) {
        throw new Error("Expected job to be created");
      }

      // Try to send heartbeat from different worker
      const { data: rawUpdatedJob, error: heartbeatError } = await supabase.rpc(
        "worker_heartbeat",
        {
          p_job_id: job.id,
          p_worker_id: WORKER_ID,
        },
      );

      const updatedJob = normalizeJobRow(
        rawUpdatedJob as { id: string | null } | null,
      );

      // Should be a no-op with no error; treat null-row as null
      expect(heartbeatError).toBeNull();
      expect(updatedJob).toBeNull();
    });

    it("should not update heartbeat for non-running job", async () => {
      const supabase = getSupabase();

      // Create a queued job
      const { data: job, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "heartbeat-queued" },
          max_attempts: 5,
          state: "queued",
          locked_by: WORKER_ID,
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(job).toBeTruthy();
      if (!job) {
        throw new Error("Expected job to be created");
      }

      // Try to send heartbeat
      const { data: rawUpdatedJob, error: heartbeatError } = await supabase.rpc(
        "worker_heartbeat",
        {
          p_job_id: job.id,
          p_worker_id: WORKER_ID,
        },
      );

      const updatedJob = normalizeJobRow(
        rawUpdatedJob as { id: string | null } | null,
      );

      // Should be a no-op; again treat null-row as null
      expect(heartbeatError).toBeNull();
      expect(updatedJob).toBeNull();
    });
  });

  describe("worker_recover_stuck_jobs RPC", () => {
    it("should requeue stuck job when attempts < max_attempts", async () => {
      const supabase = getSupabase();
      const staleCutoff = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago

      // Create a stuck running job (stale heartbeat)
      const { data: stuckJob, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "stuck-requeue" },
          max_attempts: MAX_ATTEMPTS,
          attempts: 1, // Below max_attempts
          state: "running",
          locked_by: WORKER_ID,
          locked_at: staleCutoff.toISOString(),
          heartbeat_at: staleCutoff.toISOString(),
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(stuckJob).toBeTruthy();
      if (!stuckJob) {
        throw new Error("Expected stuckJob to be created");
      }
      expect(stuckJob.state).toBe("running");
      expect(stuckJob.attempts).toBe(1);

      // Recover stuck jobs (stale after 15 minutes)
      const { data: recoveredCount, error: recoverError } = await supabase.rpc(
        "worker_recover_stuck_jobs",
        {
          p_stale_after_seconds: 15 * 60, // 15 minutes
        },
      );

      expect(recoverError).toBeNull();
      expect(typeof recoveredCount).toBe("number");
      // We are running against a shared DB; we only require that at least one job was recovered.
      expect(recoveredCount ?? 0).toBeGreaterThanOrEqual(1);

      // Verify *our* job was requeued
      const { data: recoveredJob, error: fetchError } = await supabase
        .from("jobs")
        .select("id, state, attempts, locked_at, locked_by, heartbeat_at, error, run_at")
        .eq("id", stuckJob.id)
        .single();

      expect(fetchError).toBeNull();
      expect(recoveredJob).toBeTruthy();
      if (!recoveredJob) {
        throw new Error("Expected recoveredJob to be found");
      }
      expect(recoveredJob.state).toBe("queued");
      expect(recoveredJob.attempts).toBe(2); // Incremented
      expect(recoveredJob.locked_at).toBeNull();
      expect(recoveredJob.locked_by).toBeNull();
      expect(recoveredJob.heartbeat_at).toBeNull();
      expect(recoveredJob.error).toBeTruthy();
      if (recoveredJob.error && typeof recoveredJob.error === "object") {
        expect(recoveredJob.error.reason).toBe("stuck_job_recovery");
        expect(recoveredJob.error.attempts).toBe(2);
        expect(recoveredJob.error.stale_after_seconds).toBe(15 * 60);
      }
    });

    it("should move stuck job to dead_letter when attempts >= max_attempts", async () => {
      const supabase = getSupabase();
      const staleCutoff = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes ago

      // Create a stuck running job at max attempts (after next increment)
      const { data: stuckJob, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "stuck-dlq" },
          max_attempts: MAX_ATTEMPTS,
          attempts: MAX_ATTEMPTS - 1, // Will become MAX_ATTEMPTS after increment
          state: "running",
          locked_by: WORKER_ID,
          locked_at: staleCutoff.toISOString(),
          heartbeat_at: staleCutoff.toISOString(),
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(stuckJob).toBeTruthy();
      if (!stuckJob) {
        throw new Error("Expected stuckJob to be created");
      }
      expect(stuckJob.state).toBe("running");

      // Recover stuck jobs
      const { data: recoveredCount, error: recoverError } = await supabase.rpc(
        "worker_recover_stuck_jobs",
        {
          p_stale_after_seconds: 15 * 60,
        },
      );

      expect(recoverError).toBeNull();
      expect(typeof recoveredCount).toBe("number");
      expect(recoveredCount ?? 0).toBeGreaterThanOrEqual(1);

      // Verify job was moved to dead_letter.
      // Some environments may remove dead-lettered jobs from `jobs` (archival),
      // so we handle both:
      //  - job still present in `jobs` with state='dead_letter'
      //  - job removed from `jobs` but recorded in job_events with stage='dead_letter'
      const { data: recoveredJob, error: fetchError } = await supabase
        .from("jobs")
        .select("id, state, attempts, locked_at, locked_by, heartbeat_at, error")
        .eq("id", stuckJob.id)
        .maybeSingle();

      expect(fetchError).toBeNull();

      if (recoveredJob) {
        // Job still present in jobs table as dead_letter.
        expect(recoveredJob.state).toBe("dead_letter");
        expect(recoveredJob.attempts).toBe(MAX_ATTEMPTS);
        expect(recoveredJob.locked_at).toBeNull();
        expect(recoveredJob.locked_by).toBeNull();
        expect(recoveredJob.heartbeat_at).toBeNull();
        expect(recoveredJob.error).toBeTruthy();
        if (recoveredJob.error && typeof recoveredJob.error === "object") {
          expect(recoveredJob.error.reason).toBe("stuck_job_recovery");
          expect(recoveredJob.error.attempts).toBe(MAX_ATTEMPTS);
        }
      } else {
        // Job is no longer visible in jobs (archived); assert via job_events
        const { data: events, error: eventsError } = await supabase
          .from("job_events")
          .select("stage, data")
          .eq("job_id", stuckJob.id)
          .order("created_at", { ascending: false });

        expect(eventsError).toBeNull();
        const deadLetterEvent = events?.find(
          (e) =>
            e.data &&
            typeof e.data === "object" &&
            "stage" in e.data &&
            (e.data as any).stage === "dead_letter",
        );
        expect(deadLetterEvent).toBeTruthy();
        if (deadLetterEvent && deadLetterEvent.data && typeof deadLetterEvent.data === "object") {
          expect((deadLetterEvent.data as any).reason).toBe("stuck_job_recovery");
          expect((deadLetterEvent.data as any).attempts).toBe(MAX_ATTEMPTS);
        }
      }
    });

    it("should not touch jobs with fresh heartbeat", async () => {
      const supabase = getSupabase();

      // Create a running job with recent heartbeat
      const { data: freshJob, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "fresh" },
          max_attempts: MAX_ATTEMPTS,
          state: "running",
          locked_by: WORKER_ID,
          locked_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(), // Recent
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(freshJob).toBeTruthy();
      if (!freshJob) {
        throw new Error("Expected freshJob to be created");
      }

      // Recover stuck jobs
      const { data: recoveredCount, error: recoverError } = await supabase.rpc(
        "worker_recover_stuck_jobs",
        {
          p_stale_after_seconds: 15 * 60,
        },
      );

      expect(recoverError).toBeNull();
      // Should not recover the fresh job
      expect(recoveredCount).toBe(0);

      // Verify job is still running
      const { data: stillRunning, error: fetchError } = await supabase
        .from("jobs")
        .select("id, state, attempts")
        .eq("id", freshJob.id)
        .single();

      expect(fetchError).toBeNull();
      expect(stillRunning).toBeTruthy();
      if (!stillRunning) {
        throw new Error("Expected stillRunning job to be found");
      }
      expect(stillRunning.state).toBe("running");
      expect(stillRunning.attempts).toBe(freshJob.attempts); // Unchanged
    });

    it("should not touch non-running jobs", async () => {
      const supabase = getSupabase();
      const staleCutoff = new Date(Date.now() - 20 * 60 * 1000);

      // Create a queued job with old timestamp
      const { data: queuedJob, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "queued-old" },
          max_attempts: MAX_ATTEMPTS,
          state: "queued",
          run_at: staleCutoff.toISOString(),
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(queuedJob).toBeTruthy();
      if (!queuedJob) {
        throw new Error("Expected queuedJob to be created");
      }

      // Recover stuck jobs
      const { data: recoveredCount, error: recoverError } = await supabase.rpc(
        "worker_recover_stuck_jobs",
        {
          p_stale_after_seconds: 15 * 60,
        },
      );

      expect(recoverError).toBeNull();
      // Should not recover non-running jobs
      expect(recoveredCount).toBe(0);

      // Verify job is still queued
      const { data: stillQueued, error: fetchError } = await supabase
        .from("jobs")
        .select("id, state")
        .eq("id", queuedJob.id)
        .single();

      expect(fetchError).toBeNull();
      expect(stillQueued).toBeTruthy();
      if (!stillQueued) {
        throw new Error("Expected stillQueued job to be found");
      }
      expect(stillQueued.state).toBe("queued");
    });

    it("should use locked_at when heartbeat_at is null", async () => {
      const supabase = getSupabase();
      const staleCutoff = new Date(Date.now() - 20 * 60 * 1000);

      // Create a stuck job with only locked_at (no heartbeat_at)
      const { data: stuckJob, error: createError } = await supabase
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "stuck-locked-only" },
          max_attempts: MAX_ATTEMPTS,
          attempts: 1,
          state: "running",
          locked_by: WORKER_ID,
          locked_at: staleCutoff.toISOString(),
          heartbeat_at: null, // No heartbeat
        })
        .select()
        .single();

      expect(createError).toBeNull();
      expect(stuckJob).toBeTruthy();
      if (!stuckJob) {
        throw new Error("Expected stuckJob to be created");
      }

      // Recover stuck jobs
      const { data: recoveredCount, error: recoverError } = await supabase.rpc(
        "worker_recover_stuck_jobs",
        {
          p_stale_after_seconds: 15 * 60,
        },
      );

      expect(recoverError).toBeNull();
      expect(typeof recoveredCount).toBe("number");
      expect(recoveredCount ?? 0).toBeGreaterThanOrEqual(1);

      // Verify job was recovered
      const { data: recoveredJob, error: fetchError } = await supabase
        .from("jobs")
        .select("id, state, attempts")
        .eq("id", stuckJob.id)
        .single();

      expect(fetchError).toBeNull();
      expect(recoveredJob).toBeTruthy();
      if (!recoveredJob) {
        throw new Error("Expected recoveredJob to be found");
      }
      expect(recoveredJob.state).toBe("queued");
      expect(recoveredJob.attempts).toBe(2);
    });
  });
});