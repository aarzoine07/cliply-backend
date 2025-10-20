// @ts-nocheck
import * as path from "path";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import * as dotenv from "dotenv";
import { resetDatabase } from "@cliply/shared/test/setup";

// ✅ Load .env.test
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

describe("Service-Role Function Access", () => {
  beforeAll(async () => {
    await resetDatabase?.();
  });

  it("can insert and update jobs via service role RPC", async () => {
    // 1️⃣ Insert a job directly
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

    // 2️⃣ Update state using service-role privileges
    const { data: updated, error: updateError } = await client
      .from("jobs")
      .update({ state: "processing" })
      .eq("id", inserted.id)
      .select("*")
      .single();

    expect(updateError).toBeNull();
    expect(updated.state).toBe("processing");
  });
});
