import crypto from "crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { resetDatabase, supabaseTest } from "@cliply/shared/test/setup";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const ROUTE = "jobs/enqueue";
const KIND = "TRANSCRIBE";
const PAYLOAD = { clip: "demo" };

describe("Idempotency – Deduplication", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("reuses same jobId for identical enqueue payloads", async () => {
    const dedupeKey = crypto
      .createHash("sha256")
      .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
      .digest("hex");

    const { data: firstJob, error: firstError } = await supabaseTest
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: KIND,
        payload: PAYLOAD,
        state: "queued",
      })
      .select()
      .single();

    expect(firstError).toBeNull();
    expect(firstJob).toBeTruthy();

    const { error: insertKeyError } = await supabaseTest.from("idempotency_keys").insert({
      workspace_id: WORKSPACE_ID,
      route: ROUTE,
      key_hash: dedupeKey,
      response: { ok: true, jobId: firstJob.id },
    });

    expect(insertKeyError).toBeNull();

    const { data: existingKey, error: existingKeyError } = await supabaseTest
      .from("idempotency_keys")
      .select("response")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("route", ROUTE)
      .eq("key_hash", dedupeKey)
      .single();

    expect(existingKeyError).toBeNull();
    expect(existingKey?.response?.jobId).toBe(firstJob.id);

    const { count, error: jobCountError } = await supabaseTest
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", WORKSPACE_ID)
      .eq("kind", KIND);

    expect(jobCountError).toBeNull();
    expect(count).toBe(1);
  });
});
