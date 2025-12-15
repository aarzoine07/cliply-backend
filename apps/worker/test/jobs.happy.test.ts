import { beforeAll, describe, expect, it } from "vitest";

import { supabaseTest, resetDatabase } from "@cliply/shared/test/setup";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000101";
const WORKER_ID = "test-worker";

describe("Background Job System – Happy Path", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("enqueues and completes a TRANSCRIBE job", async () => {
    // Assert once for TS + runtime safety
    expect(supabaseTest).not.toBeNull();
    const sb = supabaseTest!;

    const enqueuePayload = {
      workspace_id: WORKSPACE_ID,
      kind: "TRANSCRIBE",
      payload: { test: true },
      priority: 5,
    };

    const { data: jobRow, error: enqueueError } = await sb
      .from("jobs")
      .insert(enqueuePayload)
      .select()
      .single();

    expect(enqueueError).toBeNull();
    expect(jobRow).toBeTruthy();
    expect(jobRow.state).toBe("queued");

    const { data: claimed, error: claimError } = await sb.rpc("worker_claim_next_job", {
      p_worker_id: WORKER_ID,
    });

    expect(claimError).toBeNull();
    expect(claimed?.id).toBe(jobRow.id);
    expect(claimed?.state).toBe("running");
    expect(claimed?.locked_by).toBe(WORKER_ID);

    const { error: finishError } = await sb.rpc("worker_finish", {
      p_job_id: claimed.id,
      p_worker_id: WORKER_ID,
      p_result: { ok: true },
    });

    expect(finishError).toBeNull();

    const { data: job, error: jobFetchError } = await sb
      .from("jobs")
      .select("*")
      .eq("id", claimed.id)
      .single();

    expect(jobFetchError).toBeNull();
    expect(job.state).toBe("done");
    expect(job.result).toMatchObject({ ok: true });

    const { data: events, error: eventsError } = await sb
      .from("job_events")
      .select("stage")
      .eq("job_id", claimed.id)
      .order("created_at", { ascending: true });

    expect(eventsError).toBeNull();
    const stages = (events ?? []).map((event) => event.stage);
    expect(stages).toContain("claimed");
    expect(stages).toContain("finished");
  });
});