// @ts-nocheck
import path from "path";

import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDatabase } from "@cliply/shared/test/setup";

// ✅ dotenv loader (test env)
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });
const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ⛩️ Import the actual API handler directly instead of using fetch
import handler from "../../src/pages/api/jobs/[id].ts";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const KIND = "TRANSCRIBE";

describe("GET /api/jobs/:id (in-process)", () => {
  let jobId: string;

  beforeAll(async () => {
    await resetDatabase?.();

    // 🔹 Insert a demo job with valid enum state
    const { data, error } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: KIND,
        state: "queued", // ✅ valid state for constraint
        payload: { clip: "demo" },
      })
      .select("id")
      .single();
    if (error) throw error;
    jobId = data.id;
    console.log("🧩 seeded jobId =", jobId);
  });

  it("returns job data directly via handler", async () => {
    const mockReq = {
      method: "GET",
      query: { id: jobId },
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    };

    // mock response collector
    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
    };

    // 🧠 invoke handler directly
    await handler(mockReq, mockRes);

    console.log("🔍 Handler output:", jsonBody);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.data.id).toBe(jobId);
    expect(jsonBody.data.workspace_id).toBe(WORKSPACE_ID);
    expect(jsonBody.data.kind).toBe(KIND);
  });
});
