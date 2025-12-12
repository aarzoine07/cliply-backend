import { beforeAll, describe, expect, it } from "vitest";

import { supabaseTest, resetDatabase } from "../../packages/shared/test/setup";
import { requeueDeadLetterJob } from "../../apps/worker/src/lib/jobAdmin";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKER_ID = "dlq-test-worker";
const MAX_ATTEMPTS = 3; // Use smaller number for faster tests

/**
 * These tests run against a shared Supabase instance that may contain other queued jobs.
 * Therefore, tests assert behavioral properties (e.g., "DLQ jobs are never claimed")
 * rather than strict job ordering or exact job ID matches from worker_claim_next_job.
 */
describe("Dead-Letter Queue (DLQ) – ME-I-07", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  describe("Poison job moves to DLQ", () => {
    it("moves job to dead_letter state after max_attempts exceeded", async () => {
      const enqueuePayload = {
        workspace_id: WORKSPACE_ID,
        kind: "CLIP_RENDER",
        payload: { test: true },
        max_attempts: MAX_ATTEMPTS,
      };

      const insertResult = await supabaseTest!
        .from("jobs")
        .insert(enqueuePayload)
        .select()
        .single();

      const insertError = insertResult.error;
      const inserted = insertResult.data;

      expect(insertError).toBeNull();
      expect(inserted).toBeTruthy();

      let jobState = inserted!;

      // Simulate repeated failures up to max_attempts
      // We call worker_claim_next_job to exercise the RPC, but we don't assume
      // it will claim our specific job (there may be other jobs in the queue).
      // Instead, we directly call worker_fail on our test job by ID.
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        // Exercise the claim RPC (may claim any eligible job, not necessarily ours)
        const claimResult = await supabaseTest!.rpc("worker_claim_next_job", {
          p_worker_id: WORKER_ID,
        });

        const claimError = claimResult.error;
        const claimed = claimResult.data as any | null;

        expect(claimError).toBeNull();
        // Don't assert which job was claimed - just verify the RPC works
        if (claimed) {
          const state = claimed.state ?? claimed.status ?? null;
          if (state !== null) {
            expect(state).toBe("running");
          }
        }

        // Fetch our test job to get current attempt count
        const currentResult = await supabaseTest!
          .from("jobs")
          .select("attempts, max_attempts")
          .eq("id", jobState.id)
          .single();

        const fetchError = currentResult.error;
        const currentJob = currentResult.data as any | null;

        expect(fetchError).toBeNull();
        expect(currentJob).toBeTruthy();

        // worker_fail will increment attempts, so the next attempt number is current + 1
        const currentAttempts = currentJob!.attempts ?? 0;
        const nextAttempt = currentAttempts + 1;
        const expectedBackoff = Math.min(2 ** currentAttempts * 10, 1800);

        // Directly fail our test job by ID (regardless of what was claimed)
        // Note: worker_fail increments attempts internally
        const failResult = await supabaseTest!.rpc("worker_fail", {
          p_job_id: jobState.id,
          p_worker_id: WORKER_ID,
          p_error: `Simulated failure #${nextAttempt}`,
          p_backoff_seconds: expectedBackoff,
        });

        const failError = failResult.error;
        expect(failError).toBeNull();

        const refreshResult = await supabaseTest!
          .from("jobs")
          .select(
            "id, state, attempts, max_attempts, last_error, error, run_at",
          )
          .eq("id", jobState.id)
          .single();

        const refreshError = refreshResult.error;
        const refreshed = refreshResult.data as any | null;

        expect(refreshError).toBeNull();
        expect(refreshed).toBeTruthy();

        if (refreshed!.attempts >= MAX_ATTEMPTS) {
          // After max_attempts, job should be in dead_letter state
          expect(refreshed!.state).toBe("dead_letter");
          expect(refreshed!.attempts).toBe(MAX_ATTEMPTS);
          expect(refreshed!.last_error).toBe(
            `Simulated failure #${MAX_ATTEMPTS}`,
          );
          // Check that structured error is stored
          expect(refreshed!.error).toBeTruthy();
          if (refreshed!.error) {
            expect(refreshed!.error.message).toBe(
              `Simulated failure #${MAX_ATTEMPTS}`,
            );
            expect(refreshed!.error.attempts).toBe(MAX_ATTEMPTS);
            expect(refreshed!.error.max_attempts).toBe(MAX_ATTEMPTS);
          }
          jobState = refreshed!;
          break;
        }

        // Before max_attempts, job should be queued for retry
        expect(refreshed!.state).toBe("queued");
        jobState = refreshed!;
      }

      // Verify final state
      expect(jobState.state).toBe("dead_letter");

      // Check job_events for dead_letter event
      const eventsResult = await supabaseTest!
        .from("job_events")
        .select("stage, data")
        .eq("job_id", jobState.id)
        .order("created_at", { ascending: false });

      const eventsError = eventsResult.error;
      const events = (eventsResult.data ?? []) as any[];

      expect(eventsError).toBeNull();

      const deadLetterEvent = events.find(
        (e) =>
          e.data &&
          typeof e.data === "object" &&
          "stage" in e.data &&
          e.data.stage === "dead_letter",
      );

      expect(deadLetterEvent).toBeTruthy();
      if (
        deadLetterEvent &&
        deadLetterEvent.data &&
        typeof deadLetterEvent.data === "object"
      ) {
        expect(deadLetterEvent.data.reason).toBe("max_attempts_exceeded");
        expect(deadLetterEvent.data.attempts).toBe(MAX_ATTEMPTS);
      }
    });
  });

  describe("DLQ jobs are not claimed", () => {
    it("excludes dead_letter jobs from worker_claim_next_job", async () => {
      // Create a pending job
      const pendingResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "pending" },
          max_attempts: 5,
          state: "queued",
        })
        .select()
        .single();

      const pendingError = pendingResult.error;
      const pendingJob = pendingResult.data as any | null;

      expect(pendingError).toBeNull();
      expect(pendingJob).toBeTruthy();

      // Create a dead_letter job
      const dlqResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "dead_letter" },
          max_attempts: 5,
          attempts: 5,
          state: "dead_letter",
          last_error: "Exceeded max attempts",
        })
        .select()
        .single();

      const dlqError = dlqResult.error;
      const deadLetterJob = dlqResult.data as any | null;

      expect(dlqError).toBeNull();
      expect(deadLetterJob).toBeTruthy();

      // Try to claim next job - should NOT get the dead_letter job
      const claimResult = await supabaseTest!.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      const claimError = claimResult.error;
      const claimed = claimResult.data as any | null;

      expect(claimError).toBeNull();
      // Verify that if a job was claimed, it's not the dead_letter job
      // We don't assert which job was claimed (could be pendingJob or any other queued job)
      if (claimed) {
        const state = claimed.state ?? claimed.status ?? null;
        if (state !== null) {
          expect(state).toBe("running");
        }
        expect(claimed.id).not.toBe(deadLetterJob!.id);
      }

      // Verify dead_letter job is still untouched
      const dlqCheckResult = await supabaseTest!
        .from("jobs")
        .select("state")
        .eq("id", deadLetterJob!.id)
        .single();

      const dlqCheckError = dlqCheckResult.error;
      const dlqCheck = dlqCheckResult.data as any | null;

      expect(dlqCheckError).toBeNull();
      expect(dlqCheck?.state).toBe("dead_letter");
    });
  });

  describe("Requeue helper", () => {
    it("requeues a dead_letter job back to queued state", async () => {
      // Create a dead_letter job
      const createResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "CLIP_RENDER",
          payload: { test: "requeue" },
          max_attempts: 5,
          attempts: 5,
          state: "dead_letter",
          last_error: "Test error for requeue",
          error: {
            message: "Test error for requeue",
            attempts: 5,
            max_attempts: 5,
            failed_at: new Date().toISOString(),
          },
        })
        .select()
        .single();

      const createError = createResult.error;
      const deadLetterJob = createResult.data as any | null;

      expect(createError).toBeNull();
      expect(deadLetterJob).toBeTruthy();
      expect(deadLetterJob!.state).toBe("dead_letter");

      // Requeue the job
      await requeueDeadLetterJob({
        supabaseClient: supabaseTest!,
        jobId: deadLetterJob!.id,
      });

      // Verify job is now queued by fetching it directly
      const requeueResult = await supabaseTest!
        .from("jobs")
        .select("id, state, attempts, error, run_at, locked_at, locked_by")
        .eq("id", deadLetterJob!.id)
        .single();

      const requeueError = requeueResult.error;
      const requeued = requeueResult.data as any | null;

      expect(requeueError).toBeNull();
      expect(requeued).toBeTruthy();
      expect(requeued!.state).toBe("queued");
      expect(requeued!.attempts).toBe(0); // Attempts should be reset
      expect(requeued!.locked_at).toBeNull();
      expect(requeued!.locked_by).toBeNull();
      // Note: requeueDeadLetterJob doesn't clear the error field, so we don't assert on it

      // Verify job can be claimed again (but don't assume it will be the one claimed)
      const claimResult = await supabaseTest!.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      const claimError = claimResult.error;
      const claimed = claimResult.data as any | null;

      expect(claimError).toBeNull();
      // If a job was claimed, verify it's in running state
      // We don't assert which job was claimed (could be requeued job or any other queued job)
      if (claimed) {
        const state = claimed.state ?? claimed.status ?? null;
        if (state !== null) {
          expect(state).toBe("running");
        }
      }
    });

    it("throws error when trying to requeue non-dead_letter job", async () => {
      // Create a queued job
      const createResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "safety" },
          max_attempts: 5,
          state: "queued",
        })
        .select()
        .single();

      const createError = createResult.error;
      const queuedJob = createResult.data as any | null;

      expect(createError).toBeNull();
      expect(queuedJob).toBeTruthy();

      // Try to requeue - should throw
      await expect(
        requeueDeadLetterJob({
          supabaseClient: supabaseTest!,
          jobId: queuedJob!.id,
        }),
      ).rejects.toThrow(/Cannot requeue job .*expected "dead_letter"/i);

      // Verify job state is unchanged
      const checkResult = await supabaseTest!
        .from("jobs")
        .select("state")
        .eq("id", queuedJob!.id)
        .single();

      const checkError = checkResult.error;
      const unchanged = checkResult.data as any | null;

      expect(checkError).toBeNull();
      expect(unchanged?.state).toBe("queued");
    });

    it("throws error when job does not exist", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000999";

      await expect(
        requeueDeadLetterJob({
          supabaseClient: supabaseTest!,
          jobId: nonExistentId,
        }),
      ).rejects.toThrow();
    });

    it("does not requeue jobs in other states (completed, running)", async () => {
      // Create a completed job
      const completedResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "completed" },
          max_attempts: 5,
          state: "done",
        })
        .select()
        .single();

      const completedError = completedResult.error;
      const completedJob = completedResult.data as any | null;

      expect(completedError).toBeNull();
      expect(completedJob).toBeTruthy();

      // Try to requeue - should throw
      await expect(
        requeueDeadLetterJob({
          supabaseClient: supabaseTest!,
          jobId: completedJob!.id,
        }),
      ).rejects.toThrow();

      // Create a running job
      const runningResult = await supabaseTest!
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          payload: { test: "running" },
          max_attempts: 5,
          state: "running",
        })
        .select()
        .single();

      const runningError = runningResult.error;
      const runningJob = runningResult.data as any | null;

      expect(runningError).toBeNull();
      expect(runningJob).toBeTruthy();

      // Try to requeue - should throw
      await expect(
        requeueDeadLetterJob({
          supabaseClient: supabaseTest!,
          jobId: runningJob!.id,
        }),
      ).rejects.toThrow();
    });
  });
});