// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared readiness module before importing the route
vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import adminReadyzRoute from "../../src/pages/api/admin/readyz";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof adminReadyzRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const mockBuildReadiness = vi.mocked(buildBackendReadinessReport);

describe("GET /api/admin/readyz", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with full readiness object and timestamp when system is healthy", async () => {
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 1, oldestJobAge: 3000 },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs", "workspaces"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("checks");
    expect(res.body.checks).toHaveProperty("db");
    expect(res.body.checks).toHaveProperty("worker");
    expect(res.body).toHaveProperty("queue");
    expect(res.body.queue).toHaveProperty("length", 1);
    expect(res.body.queue).toHaveProperty("oldestJobAge", 3000);
    expect(res.body).toHaveProperty("ffmpeg");
    expect(res.body.ffmpeg).toHaveProperty("ok", true);
    
    // Admin-specific: must have timestamp
    expect(res.body).toHaveProperty("timestamp");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("returns 503 when FFmpeg is unavailable", async () => {
    const mockReadiness = {
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: false, message: "FFmpeg unavailable" },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.ffmpeg).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("timestamp");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("returns 503 when queue is critically backed up", async () => {
    const mockReadiness = {
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: false, message: "Worker not ready" } },
      queue: { length: 100, oldestJobAge: 400000, warning: true },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.queue).toHaveProperty("length", 100);
    expect(res.body.queue).toHaveProperty("oldestJobAge", 400000);
    expect(res.body.queue).toHaveProperty("warning", true);
    expect(res.body).toHaveProperty("timestamp");
  });

  it("returns 503 when database check fails", async () => {
    const mockReadiness = {
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: false, message: "Connection timeout" }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: true },
      db: { ok: false, error: "Connection timeout", tablesChecked: [], missingTables: ["jobs"] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.checks.db).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("timestamp");
  });

  it("returns 500 with internal error on unhandled exception", async () => {
    mockBuildReadiness.mockRejectedValue(new Error("Unexpected database error"));

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("message", "internal_error");
  });

  it("returns 405 for non-GET requests", async () => {
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "post").post("/");

    expect(res.status).toBe(405);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("message", "method_not_allowed");
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("timestamp");
    
    // Verify timestamp is valid ISO 8601
    const timestamp = res.body.timestamp;
    const date = new Date(timestamp);
    expect(date.toISOString()).toBe(timestamp);
  });

  it("returns correct JSON shape with all required fields including timestamp", async () => {
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 5, oldestJobAge: 15000 },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    
    // Verify exact JSON shape (admin includes timestamp)
    const expectedKeys = ["ok", "checks", "queue", "ffmpeg", "timestamp"];
    expect(Object.keys(res.body).sort()).toEqual(expectedKeys.sort());
    
    // Verify checks structure
    expect(res.body.checks).toHaveProperty("db");
    expect(res.body.checks).toHaveProperty("worker");
    
    // Verify queue structure
    expect(res.body.queue).toHaveProperty("length");
    expect(res.body.queue).toHaveProperty("oldestJobAge");
    
    // Verify ffmpeg structure
    expect(res.body.ffmpeg).toHaveProperty("ok");
    
    // Verify timestamp is present and is a string
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("includes queue warning flag when present", async () => {
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 50, oldestJobAge: 90000, warning: true },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body.queue).toHaveProperty("warning", true);
    expect(res.body).toHaveProperty("timestamp");
  });
});
