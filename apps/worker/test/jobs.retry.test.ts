import { beforeAll, describe, expect, it } from "vitest";

import { supabaseTest, resetDatabase } from "@cliply/shared/test/setup";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000101";
const WORKER_ID = "retry-worker";
const MAX_ATTEMPTS = 5;

describe("Background Job System – Retry & Backoff", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    if (!supabaseTest) {
      throw new Error("supabaseTest is null — check .env.test and test setup");
    }
  });

  it("retries failed job and ends in dead_letter after max attempts", async () => {
    if (!supabaseTest) {
      throw new Error("supabaseTest is null — check .env.test and test setup");
    }
    const supabase = supabaseTest;

    const enqueuePayload = {
      workspace_id: WORKSPACE_ID,
      kind: "CLIP_RENDER",
      payload: { test: true },
      priority: 5,
      max_attempts: MAX_ATTEMPTS,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();
    if (!inserted) throw new Error("inserted job row is null");

    expect(inserted.state).toBe("queued");
    const jobId = inserted.id;

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const { data: claimed, error: claimError } = await supabase.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

      expect(claimError).toBeNull();
      expect(claimed).toBeTruthy();
      if (!claimed) throw new Error("claimed job is null");

      expect(claimed.id).toBe(jobId);
      expect(claimed.state).toBe("running");

      const attempts = claimed.attempts ?? 1;
      const expectedBackoff = Math.min(2 ** (attempts - 1) * 10, 1800);

      const { error: failError } = await supabase.rpc("worker_fail", {
        p_job_id: claimed.id,
        p_worker_id: WORKER_ID,
        p_error: `Simulated failure #${attempts}`,
        p_backoff_seconds: expectedBackoff,
      });

      expect(failError).toBeNull();

      const { data: refreshed, error: refreshError } = await supabase
        .from("jobs")
        .select("id,state,attempts,run_at")
        .eq("id", jobId)
        .single();

      expect(refreshError).toBeNull();
      expect(refreshed).toBeTruthy();
      if (!refreshed) throw new Error("refreshed job row is null");

      if ((refreshed.attempts ?? 0) >= MAX_ATTEMPTS) {
        expect(refreshed.state).toBe("dead_letter");
        break;
      }

      expect(refreshed.state).toBe("queued");

      // Make it immediately claimable for next loop iteration (avoid waiting on run_at)
      const { error: bumpError } = await supabase
        .from("jobs")
        .update({ run_at: new Date().toISOString() })
        .eq("id", jobId);

      expect(bumpError).toBeNull();
    }

    const { data: finalJob, error: finalJobError } = await supabase
      .from("jobs")
      .select("id,state,attempts")
      .eq("id", jobId)
      .single();

    expect(finalJobError).toBeNull();
    expect(finalJob).toBeTruthy();
    if (!finalJob) throw new Error("finalJob is null");

    expect(finalJob.state).toBe("dead_letter");
    expect(finalJob.attempts ?? 0).toBeGreaterThanOrEqual(MAX_ATTEMPTS);

    const { data: events, error: eventsError } = await supabase
      .from("job_events")
      .select("stage")
      .eq("job_id", jobId);

    expect(eventsError).toBeNull();

    // This DB only logs "claimed" stages here; validate retries happened via count.
    const stages = (events ?? []).map((e) => e.stage);
    const claimedCount = stages.filter((s) => s === "claimed").length;
    expect(claimedCount).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
  });
});