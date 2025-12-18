// Jobs Idempotency Tests (enqueueJob + idempotency_keys)
//
// Reality:
// - enqueueJob() implements dedupe via public.idempotency_keys
//   (workspace_id, route="jobs/enqueue", key_hash, response jsonb)
//
// The old test referenced public.idempotency + a "response" column that does not exist.

import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { env, resetDatabase } from "../../../packages/shared/test/setup";
import { enqueueJob } from "../src/lib/enqueueJob";

const SUPABASE_URL = env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

describe("Idempotency – Deduplication (enqueueJob)", () => {
  beforeEach(async () => {
    // Keep tests hermetic and avoid cross-test leakage
    await resetDatabase?.();
  });

  it("reuses the same jobId for identical enqueue payloads (same runAt)", async () => {
    const testId = `test-reuse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const kind = "TRANSCRIBE";
    const payload = { clip: "demo", testId };

    // IMPORTANT: enqueueJob's key includes runAt in the hash,
    // so we must keep runAt identical to hit dedupe.
    const runAt = new Date().toISOString();

    const first = await enqueueJob({
      workspaceId: WORKSPACE_ID,
      kind,
      payload,
      runAt,
    });

    console.log("enqueueJob first:", first);

    expect(first.ok).toBe(true);
    expect(first.jobId).toBeTruthy();

    const second = await enqueueJob({
      workspaceId: WORKSPACE_ID,
      kind,
      payload,
      runAt,
    });

    console.log("enqueueJob second:", second);

    expect(second.ok).toBe(true);
    expect(second.jobId).toBeTruthy();

    expect(second.jobId).toBe(first.jobId);

    // Verify only one job exists for this payload marker
    const { data: jobs, error: jobsErr } = await client
      .from("jobs")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("kind", kind)
      .contains("payload", { testId });

    expect(jobsErr).toBeNull();
    expect(jobs?.length).toBe(1);
  });

  it("does not create duplicates for the same key (dedupe guard)", async () => {
    const testId = `test-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const kind = "TRANSCRIBE";
    const payload = { clip: "demo", testId };

    const runAt = new Date().toISOString();

    const a = await enqueueJob({ workspaceId: WORKSPACE_ID, kind, payload, runAt });
    console.log("enqueueJob a:", a);

    const b = await enqueueJob({ workspaceId: WORKSPACE_ID, kind, payload, runAt });
    console.log("enqueueJob b:", b);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(b.jobId).toBe(a.jobId);

    const { data: jobs, error: jobsErr } = await client
      .from("jobs")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("kind", kind)
      .contains("payload", { testId });

    expect(jobsErr).toBeNull();
    expect(jobs?.length).toBe(1);
  });
});
