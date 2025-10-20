// @ts-nocheck
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import * as dotenv from "dotenv-defaults";

import path from "path";

import { resetDatabase } from "@cliply/shared/test/setup";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env.test"), override: true });

describe("⚙️ Enqueue API Functionality", () => {
  beforeAll(async () => {
    console.log("⚙️  resetDatabase() called (stubbed for local tests)");
    await resetDatabase?.();
  });

  it("creates a new queued job with correct defaults", async () => {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await client
      .from("jobs")
      .insert([{ workspace_id: "00000000-0000-0000-0000-000000000001", kind: "TRANSCRIBE" }])
      .select("*")
      .single();

    console.log("insert error:", error);
    expect(error).toBeNull();
    expect(data.state).toBe("queued");
    expect(data.priority).toBe(5);
  });
});
