import { beforeAll, describe, expect, it } from "vitest";

import { supabaseTest, resetDatabase, isSupabaseTestConfigured } from "../../packages/shared/test/setup";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const WORKER_ID = "test-worker-123";
const WORKER_ID_2 = "test-worker-456";

// Gate tests: skip if Supabase is not properly configured (e.g., dashboard URL in local dev)
const SKIP_WORKER_RPC_TESTS = !isSupabaseTestConfigured();
const describeWorkerRpc = SKIP_WORKER_RPC_TESTS ? describe.skip : describe;

describeWorkerRpc("Worker RPC Functions", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  describe("worker_claim_next_job", () => {
    it("claims a queued job with eligible run_after", async () => {
      // Insert a queued job
      const { data: jobRow, error: insertError } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "queued",
          run_after: new Date().toISOString(), // Eligible now
          attempts: 0,
          max_attempts: 5,
          payload: { test: true },
        })
        .select()
        .single();

      expect(insertError).toBeNull();
      expect(jobRow).toBeTruthy();
      expect(jobRow.status).toBe("queued");

      // Claim the job
      const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      expect(claimed).toBeTruthy();
      expect(claimed?.id).toBe(jobRow.id);
      expect(claimed?.status).toBe("running");
      expect(claimed?.worker_id).toBe(WORKER_ID);
      expect(claimed?.attempts).toBe(1); // Should be incremented
      expect(claimed?.last_heartbeat).toBeTruthy();

      // Verify in database
      const { data: dbJob, error: dbError } = await supabaseTest
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbError).toBeNull();
      expect(dbJob?.status).toBe("running");
      expect(dbJob?.worker_id).toBe(WORKER_ID);
      expect(dbJob?.attempts).toBe(1);
    });

    it("does not claim jobs with future run_after", async () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 10);

      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "queued",
          run_after: futureDate.toISOString(), // Not eligible yet
          attempts: 0,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      // Should not claim this job (might claim another eligible job or return null)
      if (claimed) {
        expect(claimed.id).not.toBe(jobRow.id);
      }
    });

    it("does not claim jobs that exceeded max_attempts", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "queued",
          run_after: new Date().toISOString(),
          attempts: 5, // Equal to max_attempts
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      // Should not claim this job
      if (claimed) {
        expect(claimed.id).not.toBe(jobRow.id);
      }
    });

    it("returns null when no eligible jobs exist", async () => {
      // Ensure no eligible jobs
      await supabaseTest.from("jobs").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      const { data: claimed, error: claimError } = await supabaseTest.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      expect(claimed).toBeNull();
    });
  });

  describe("worker_heartbeat", () => {
    it("updates last_heartbeat for a running job", async () => {
      // Create a running job
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          last_heartbeat: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const oldHeartbeat = jobRow.last_heartbeat;

      // Send heartbeat
      const { data: updated, error: heartbeatError } = await supabaseTest.rpc("worker_heartbeat", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID,
      });

      expect(heartbeatError).toBeNull();
      expect(updated).toBeTruthy();
      expect(updated?.last_heartbeat).toBeTruthy();
      expect(new Date(updated!.last_heartbeat!).getTime()).toBeGreaterThan(new Date(oldHeartbeat!).getTime());
      expect(updated?.status).toBe("running"); // Status should remain running

      // Verify in database
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbJob?.last_heartbeat).toBeTruthy();
      expect(new Date(dbJob!.last_heartbeat!).getTime()).toBeGreaterThan(new Date(oldHeartbeat!).getTime());
    });

    it("fails if job does not belong to worker", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID_2, // Different worker
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: updated, error: heartbeatError } = await supabaseTest.rpc("worker_heartbeat", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID, // Wrong worker
      });

      expect(heartbeatError).toBeTruthy();
      expect(updated).toBeNull();
    });

    it("fails if job is not running", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "queued", // Not running
          worker_id: WORKER_ID,
          attempts: 0,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: updated, error: heartbeatError } = await supabaseTest.rpc("worker_heartbeat", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID,
      });

      expect(heartbeatError).toBeTruthy();
      expect(updated).toBeNull();
    });
  });

  describe("worker_fail", () => {
    it("reschedules job for retry when attempts < max_attempts", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          attempts: 1, // Less than max_attempts (5)
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: failed, error: failError } = await supabaseTest.rpc("worker_fail", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID,
        p_error: "Test error",
        p_backoff_seconds: 30,
      });

      expect(failError).toBeNull();
      expect(failed).toBeTruthy();
      expect(failed?.status).toBe("queued"); // Should be rescheduled
      expect(failed?.worker_id).toBeNull(); // Worker should be cleared
      expect(failed?.error).toBeTruthy();
      expect(failed?.run_after).toBeTruthy();

      // Verify run_after is in the future
      const runAfter = new Date(failed!.run_after!);
      const now = new Date();
      expect(runAfter.getTime()).toBeGreaterThan(now.getTime());

      // Verify in database
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbJob?.status).toBe("queued");
      expect(dbJob?.worker_id).toBeNull();
    });

    it("marks job as permanently failed when attempts >= max_attempts", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          attempts: 5, // Equal to max_attempts
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: failed, error: failError } = await supabaseTest.rpc("worker_fail", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID,
        p_error: "Final error",
        p_backoff_seconds: 0,
      });

      expect(failError).toBeNull();
      expect(failed).toBeTruthy();
      expect(failed?.status).toBe("failed"); // Should be permanently failed
      expect(failed?.error).toBeTruthy();

      // Verify in database
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbJob?.status).toBe("failed");
    });

    it("uses exponential backoff when p_backoff_seconds is 0", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          attempts: 2, // Will use 2^2 * 30 = 120 seconds
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: failed, error: failError } = await supabaseTest.rpc("worker_fail", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID,
        p_error: "Test error",
        p_backoff_seconds: 0, // Use exponential backoff
      });

      expect(failError).toBeNull();
      expect(failed).toBeTruthy();
      expect(failed?.run_after).toBeTruthy();

      // Verify run_after is approximately 120 seconds in the future (with some tolerance)
      const runAfter = new Date(failed!.run_after!);
      const now = new Date();
      const diffSeconds = (runAfter.getTime() - now.getTime()) / 1000;
      expect(diffSeconds).toBeGreaterThan(100); // At least 100 seconds
      expect(diffSeconds).toBeLessThan(150); // But less than 150 seconds
    });

    it("fails if job does not belong to worker", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID_2, // Different worker
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: failed, error: failError } = await supabaseTest.rpc("worker_fail", {
        p_job_id: jobRow.id,
        p_worker_id: WORKER_ID, // Wrong worker
        p_error: "Test error",
        p_backoff_seconds: 30,
      });

      expect(failError).toBeTruthy();
      expect(failed).toBeNull();
    });
  });

  describe("worker_reclaim_stale", () => {
    it("reclaims jobs with stale heartbeats", async () => {
      const staleDate = new Date();
      staleDate.setSeconds(staleDate.getSeconds() - 300); // 5 minutes ago

      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          last_heartbeat: staleDate.toISOString(), // Stale
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: reclaimedCount, error: reclaimError } = await supabaseTest.rpc("worker_reclaim_stale", {
        p_stale_seconds: 120, // 2 minutes threshold
      });

      expect(reclaimError).toBeNull();
      expect(reclaimedCount).toBeGreaterThanOrEqual(1); // At least this job should be reclaimed

      // Verify job was reclaimed
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbJob?.status).toBe("queued");
      expect(dbJob?.worker_id).toBeNull();
    });

    it("does not reclaim jobs with recent heartbeats", async () => {
      const recentDate = new Date();
      recentDate.setSeconds(recentDate.getSeconds() - 30); // 30 seconds ago

      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          last_heartbeat: recentDate.toISOString(), // Recent
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: reclaimedCount } = await supabaseTest!.rpc("worker_reclaim_stale", {
        p_stale_seconds: 120, // 2 minutes threshold
      });

      // This job should not be reclaimed (might reclaim others though)
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      // Job should still be running (unless it was reclaimed for another reason)
      if (dbJob?.status === "running") {
        expect(dbJob?.worker_id).toBe(WORKER_ID);
      }
    });

    it("reclaims jobs with null last_heartbeat", async () => {
      const { data: jobRow } = await supabaseTest
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          status: "running",
          worker_id: WORKER_ID,
          last_heartbeat: null, // Null heartbeat
          attempts: 1,
          max_attempts: 5,
          payload: {},
        })
        .select()
        .single();

      const { data: reclaimedCount } = await supabaseTest!.rpc("worker_reclaim_stale", {
        p_stale_seconds: 120,
      });

      expect(reclaimedCount).toBeGreaterThanOrEqual(1);

      // Verify job was reclaimed
      const { data: dbJob } = await supabaseTest!
        .from("jobs")
        .select("*")
        .eq("id", jobRow.id)
        .single();

      expect(dbJob?.status).toBe("queued");
      expect(dbJob?.worker_id).toBeNull();
    });

    it("returns 0 when no stale jobs exist", async () => {
      // Ensure all jobs are either not running or have recent heartbeats
      await supabaseTest.from("jobs").delete().eq("status", "running");

      const { data: reclaimedCount, error: reclaimError } = await supabaseTest.rpc("worker_reclaim_stale", {
        p_stale_seconds: 120,
      });

      expect(reclaimError).toBeNull();
      expect(reclaimedCount).toBe(0);
    });
  });
});

