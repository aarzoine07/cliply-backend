// @ts-nocheck
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDatabase } from "@cliply/shared/test/setup";
// ✅ dotenv is already loaded by packages/shared/test/setup.ts (via vitest setupFiles)

// ✅ Supabase service-role client
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

describe("🧩 Service-Role Function Verification", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("allows service-role to insert and update jobs", async () => {
    // 1️⃣ Insert job
    const { data: inserted, error: insertError } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: "TRANSCRIBE",
        state: "queued",
        payload: { demo: true },
      })
      .select("*")
      .single();

    expect(insertError).toBeNull();
    expect(inserted).toBeTruthy();

    // 2️⃣ Update job state
    const { data: updated, error: updateError } = await client
      .from("jobs")
      .update({ state: "running" })
      .eq("id", inserted.id)
      .select("*")
      .single();

    expect(updateError).toBeNull();
    expect(updated.state).toBe("running");
  });
});
