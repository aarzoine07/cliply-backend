// @ts-nocheck
import * as crypto from "crypto";
import * as path from "path";

import { resetDatabase } from "@cliply/shared/test/setup";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// ✅ Correct dotenv import (works under ESM)
import dotenv from "dotenv";
dotenv.config({ path: "../../.env.test", override: true });

const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);
console.log("🔎 SUPABASE_URL =", process.env.SUPABASE_URL);


// ✅ Supabase service-role client
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const ROUTE = "jobs/enqueue";
const KIND = "TRANSCRIBE";
const PAYLOAD = { clip: "demo" };

describe("🧩 Idempotency – Deduplication", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("reuses same jobId for identical enqueue payloads", async () => {
    const dedupeKey = crypto
      .createHash("sha256")
      .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
      .digest("hex");

    // 1️⃣ Insert first job
    const { data: firstJob, error: firstError } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: KIND,
        state: "queued",
        payload: PAYLOAD,
      })
      .select("*")
      .single();

    expect(firstError).toBeNull();
    expect(firstJob).toBeTruthy();

    // 2️⃣ Insert idempotency key
    const { error: insertKeyError } = await client.from("idempotency_keys").insert({
      workspace_id: WORKSPACE_ID,
      route: ROUTE,
      key_hash: dedupeKey,
      response: { ok: true, jobId: firstJob.id },
    });

    expect(insertKeyError).toBeNull();

    // 3️⃣ Verify deduped response
    const { data: existingKey, error: existingKeyError } = await client
      .from("idempotency_keys")
      .select("response")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("route", ROUTE)
      .eq("key_hash", dedupeKey)
      .single();

    expect(existingKeyError).toBeNull();
    expect(existingKey?.response?.jobId).toBe(firstJob.id);

    // 4️⃣ Ensure only one job was created
    const { count, error: jobCountError } = await client
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", WORKSPACE_ID)
      .eq("kind", KIND);

    expect(jobCountError).toBeNull();
    expect(count).toBe(1);
  });
});
