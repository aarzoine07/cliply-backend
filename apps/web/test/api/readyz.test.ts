// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared readiness module before importing the route
vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import readyzRoute from "../../src/pages/api/readyz";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof readyzRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const mockBuildReadiness = vi.mocked(buildBackendReadinessReport);

describe("GET /api/readyz", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with full readiness object when system is healthy", async () => {
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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.ffmpeg).toHaveProperty("ok", false);
    expect(res.body.ffmpeg).toHaveProperty("message", "FFmpeg unavailable");
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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.queue).toHaveProperty("length", 100);
    expect(res.body.queue).toHaveProperty("oldestJobAge", 400000);
    expect(res.body.queue).toHaveProperty("warning", true);
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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.checks.db).toHaveProperty("ok", false);
    expect(res.body.checks.db).toHaveProperty("message", "Connection timeout");
  });

  it("returns 500 with internal error on unhandled exception", async () => {
    mockBuildReadiness.mockRejectedValue(new Error("Unexpected database error"));

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("message", "internal_error");
  });

  it("does not include timestamp in response (only admin endpoint has it)", async () => {
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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("timestamp");
  });

  it("returns correct JSON shape with all required fields", async () => {
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

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

    expect(res.status).toBe(200);
    
    // Verify exact JSON shape
    const expectedKeys = ["ok", "checks", "queue", "ffmpeg"];
    expect(Object.keys(res.body).sort()).toEqual(expectedKeys.sort());
    
    // Verify checks structure
    expect(res.body.checks).toHaveProperty("db");
    expect(res.body.checks).toHaveProperty("worker");
    
    // Verify queue structure
    expect(res.body.queue).toHaveProperty("length");
    expect(res.body.queue).toHaveProperty("oldestJobAge");
    
    // Verify ffmpeg structure
    expect(res.body.ffmpeg).toHaveProperty("ok");
  });
});
