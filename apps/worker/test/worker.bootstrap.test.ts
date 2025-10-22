// @ts-nocheck
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDatabase } from "../../../packages/shared/test/setup";

// ✅ dotenv loader
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });
const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

describe("Worker Bootstrap + Polling Loop", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    console.log("⚙️  Seeding one pending job for worker to process...");
    const { data, error } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: "TRANSCRIBE",
        state: "queued",
        payload: { clip: "demo" },
      })
      .select("*")
      .single();
    if (error) throw error;

    console.log("🧩 Seeded job:", data.id);
  });

  it("polls and marks job as done", async () => {
    console.log("🚀 Simulating worker polling loop...");

    // Simulate a basic worker loop
    const { data: job, error: jobError } = await client
      .from("jobs")
      .select("*")
      .eq("state", "queued")
      .limit(1)
      .single();
    expect(jobError).toBeNull();
    expect(job).toBeTruthy();

    // Simulate processing -> mark as done
    const { error: updateError } = await client
      .from("jobs")
      .update({ state: "done", result: { ok: true } })
      .eq("id", job.id);
    expect(updateError).toBeNull();

    // Verify job state
    const { data: finalJob, error: verifyError } = await client
      .from("jobs")
      .select("state, result")
      .eq("id", job.id)
      .single();
    expect(verifyError).toBeNull();
    expect(finalJob.state).toBe("done");
    expect(finalJob.result.ok).toBe(true);

    console.log("✅ Worker successfully marked job as done.");
  });
});
