// FILE: test/api/readyz.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest";
import readyzRoute from "../../apps/web/src/pages/api/readyz";
import { supertestHandler } from "../utils/supertest-next";

vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

const toApiHandler = (handler: typeof readyzRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe("GET /api/readyz (legacy contract)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 when all checks pass", async () => {
    vi.mocked(buildBackendReadinessReport).mockResolvedValue({
      ok: true,
      checks: {
        env: { ok: true },
        db: { ok: true },
        worker: { ok: true },
      },
      queue: {
        length: 1,
        oldestJobAge: 3000,
        warning: false,
      },
      ffmpeg: {
        ok: true,
      },
    });

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get(
      "/",
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("checks");
    expect(res.body).toHaveProperty("queue");
    expect(res.body).toHaveProperty("ffmpeg");
    expect(res.body.queue).toHaveProperty("length", 1);
    expect(res.body.queue).toHaveProperty("oldestJobAge", 3000);
  });

  it("returns 503 when database check fails", async () => {
    vi.mocked(buildBackendReadinessReport).mockResolvedValue({
      ok: false,
      checks: {
        env: { ok: true },
        db: { ok: false, message: "Connection timeout" },
        worker: { ok: true },
      },
      queue: {
        length: 0,
        oldestJobAge: null,
        warning: false,
      },
      ffmpeg: {
        ok: true,
      },
    });

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get(
      "/",
    );

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body.checks.db).toHaveProperty("ok", false);
    expect(res.body.checks.db).toHaveProperty(
      "message",
      "Connection timeout",
    );
  });

  it("returns 500 on unexpected exception", async () => {
    vi.mocked(buildBackendReadinessReport).mockRejectedValue(
      new Error("boom"),
    );

    const res = await supertestHandler(toApiHandler(readyzRoute), "get").get(
      "/",
    );

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("ok", false);
    expect(res.body).toHaveProperty("error");
  });
});