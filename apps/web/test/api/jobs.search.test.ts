// @ts-nocheck
/**
 * Jobs Search API Tests
 *
 * Tests the /api/jobs/search endpoint:
 * - Returns paginated jobs for workspace
 * - Respects limit/offset parameters
 * - Filters by workspace_id
 *
 * Each test uses unique job markers to ensure isolation from other tests.
 */
import path from "path";
import * as crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDatabase } from "@cliply/shared/test/setup";

// ✅ dotenv loader (test env)
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ⛩️ Import handler directly
import handler from "../../src/pages/api/jobs/search.ts";

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

// Track test-specific job IDs for cleanup
const testJobIds: string[] = [];
const testMarker = `search-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("GET /api/jobs/search (in-process)", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    // 🔹 Seed 3 demo jobs with unique test marker in payload
    const inserts = Array.from({ length: 3 }).map((_, i) => ({
      workspace_id: WORKSPACE_ID,
      kind: "TRANSCRIBE",
      state: "queued",
      payload: { clip: "demo", testMarker, index: i },
    }));

    const { data, error } = await client.from("jobs").insert(inserts).select("id");
    if (error) throw error;
    
    // Track job IDs for cleanup
    if (data) {
      testJobIds.push(...data.map((j) => j.id));
    }
  });

  afterAll(async () => {
    // Clean up test-specific jobs
    if (testJobIds.length > 0) {
      // Delete job_events first (FK safety)
      await client.from("job_events").delete().in("job_id", testJobIds);
      // Delete jobs
      await client.from("jobs").delete().in("id", testJobIds);
    }
  });

  it("returns paginated jobs for workspace", async () => {
    const mockReq = {
      method: "GET",
      query: { workspace_id: WORKSPACE_ID, limit: "10", offset: "0" },
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

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(Array.isArray(jsonBody.data)).toBe(true);
    expect(jsonBody.count).toBeDefined();

    // Filter results to just our test jobs to avoid flakiness from other tests
    const ourJobs = jsonBody.data.filter(
      (j: any) => j.payload?.testMarker === testMarker
    );
    
    // Verify we got our seeded jobs
    expect(ourJobs.length).toBe(3);

    // Verify results are sorted by created_at DESC (most recent first)
    const timestamps = ourJobs.map((j: any) => new Date(j.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });

  it("respects limit parameter", async () => {
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

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.data.length).toBeLessThanOrEqual(2);
  });

  it("returns 401 without authorization", async () => {
    const mockReq = {
      method: "GET",
      query: { workspace_id: WORKSPACE_ID },
      headers: {},
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

    expect(statusCode).toBe(401);
    expect(jsonBody.ok).toBe(false);
  });

  it("returns 400 when workspace_id is missing", async () => {
    const mockReq = {
      method: "GET",
      query: {},
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

    expect(statusCode).toBe(400);
    expect(jsonBody.ok).toBe(false);
    expect(jsonBody.error).toBe("MISSING_WORKSPACE_ID");
  });

  it("returns 405 for non-GET methods", async () => {
    const mockReq = {
      method: "POST",
      query: { workspace_id: WORKSPACE_ID },
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    };

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      setHeader: () => {},
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

    expect(statusCode).toBe(405);
    expect(jsonBody.ok).toBe(false);
  });
});
