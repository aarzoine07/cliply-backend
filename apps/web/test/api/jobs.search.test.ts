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

// ⛩️ Import handler directly
import handler from "../../src/pages/api/jobs/search.ts";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const KIND = "TRANSCRIBE";

describe("GET /api/jobs/search (in-process)", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    // 🔹 Seed 3 demo jobs
    const inserts = Array.from({ length: 3 }).map(() => ({
      workspace_id: WORKSPACE_ID,
      kind: KIND,
      state: "queued", // ✅ valid enum
      payload: { clip: "demo" },
    }));

    const { error } = await client.from("jobs").insert(inserts);
    if (error) throw error;
    console.log("🧩 Seeded 3 demo jobs for search");
  });

  it("returns paginated jobs for workspace", async () => {
    const mockReq = {
      method: "GET",
      query: { workspace_id: WORKSPACE_ID, limit: "2", offset: "0" },
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    };

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

    await handler(mockReq, mockRes);

    console.log("🔍 Handler output:", jsonBody);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(Array.isArray(jsonBody.data)).toBe(true);
    expect(jsonBody.data.length).toBeGreaterThan(0);
    expect(jsonBody.count).toBeDefined();
  });
});
