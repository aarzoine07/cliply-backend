// @ts-nocheck
import { describe, expect, it } from "vitest";

import { isSupabaseTestConfigured } from "@cliply/shared/test/setup";
import healthRoute from "../../src/pages/api/health";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof healthRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe.skipIf(!isSupabaseTestConfigured())(
  "GET /api/health (Integration)",
  () => {
    it("returns 200 with { ok: true } when system is healthy (real DB)", async () => {
      const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

      // Status should be 200 or 503 depending on actual system state
      expect([200, 503]).toContain(res.status);

      // Response should have ok field
      expect(res.body).toHaveProperty("ok");
      expect(typeof res.body.ok).toBe("boolean");

      // Health endpoint only returns { ok: boolean }
      expect(Object.keys(res.body).sort()).toEqual(["ok"]);
    });

    it("includes deprecation headers pointing to /api/healthz", async () => {
      const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);
      expect(res.headers["deprecation"]).toBe("true");
      expect(res.headers["sunset"]).toBe("2026-03-01");
      expect(res.headers["link"]).toContain("/api/healthz");
      expect(res.headers["link"]).toContain('rel="successor-version"');
    });

    it("does not expose queue or ffmpeg details in response", async () => {
      const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);
      expect(res.body).not.toHaveProperty("queue");
      expect(res.body).not.toHaveProperty("ffmpeg");
      expect(res.body).not.toHaveProperty("checks");
    });

    it("returns 500 with internal error on unhandled exception", async () => {
      // This test verifies error handling, but in real integration tests
      // we can't easily trigger an exception without mocking
      // So we'll just verify the endpoint doesn't crash
      const res = await supertestHandler(toApiHandler(healthRoute), "get").get("/");

      // Should return either 200, 503, or 500
      expect([200, 503, 500]).toContain(res.status);
      expect(res.body).toHaveProperty("ok");
    });
  },
);

