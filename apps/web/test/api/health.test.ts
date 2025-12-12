// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared readiness module before importing the route
vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import healthRoute from "../../src/pages/api/health";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof healthRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const mockBuildReadiness = vi.mocked(buildBackendReadinessReport);

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with { ok: true } when system is healthy", async () => {
    mockBuildReadiness.mockResolvedValue({
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 503 with { ok: false } when system is unhealthy", async () => {
    mockBuildReadiness.mockResolvedValue({
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: false, message: "Connection failed" }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: true },
      db: { ok: false, error: "Connection failed", tablesChecked: [], missingTables: ["jobs"] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
  });

  it("returns 503 when FFmpeg is unavailable", async () => {
    mockBuildReadiness.mockResolvedValue({
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 0, oldestJobAge: null },
      ffmpeg: { ok: false, message: "FFmpeg unavailable" },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
  });

  it("returns 500 with internal error on unhandled exception", async () => {
    mockBuildReadiness.mockRejectedValue(new Error("Unexpected failure"));

    const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toHaveProperty("message", "internal_error");
  });

  it("does not expose queue or ffmpeg details in response", async () => {
    mockBuildReadiness.mockResolvedValue({
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 5, oldestJobAge: 30000 },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    });

    const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.body).not.toHaveProperty("queue");
    expect(res.body).not.toHaveProperty("ffmpeg");
    expect(res.body).not.toHaveProperty("checks");
  });
});
