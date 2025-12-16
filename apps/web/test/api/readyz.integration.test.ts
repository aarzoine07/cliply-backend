// @ts-nocheck
import { describe, expect, it } from "vitest";

import { isSupabaseTestConfigured } from "@cliply/shared/test/setup";
import readyzRoute from "../../src/pages/api/readyz";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof readyzRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe.skipIf(!isSupabaseTestConfigured())(
  "GET /api/readyz (Integration)",
  () => {
    it("returns 200 or 503 with full readiness object (real DB)", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      // Status should be 200 or 503 depending on actual system state
      expect([200, 503]).toContain(res.status);

      // Response should have ok field
      expect(res.body).toHaveProperty("ok");
      expect(typeof res.body.ok).toBe("boolean");

      // Response should have checks field
      expect(res.body).toHaveProperty("checks");
      expect(res.body.checks).toHaveProperty("db");
      expect(res.body.checks.db).toHaveProperty("ok");
      expect(typeof res.body.checks.db.ok).toBe("boolean");

      expect(res.body.checks).toHaveProperty("worker");
      expect(res.body.checks.worker).toHaveProperty("ok");
      expect(typeof res.body.checks.worker.ok).toBe("boolean");

      // Response should have queue field
      expect(res.body).toHaveProperty("queue");
      expect(res.body.queue).toHaveProperty("length");
      expect(typeof res.body.queue.length).toBe("number");
      expect(res.body.queue.length).toBeGreaterThanOrEqual(0);

      expect(res.body.queue).toHaveProperty("oldestJobAge");
      expect(
        res.body.queue.oldestJobAge === null || typeof res.body.queue.oldestJobAge === "number",
      ).toBe(true);

      // Response should have ffmpeg field
      expect(res.body).toHaveProperty("ffmpeg");
      expect(res.body.ffmpeg).toHaveProperty("ok");
      expect(typeof res.body.ffmpeg.ok).toBe("boolean");
    });

    it("returns correct JSON shape with all required fields", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);

      // Verify exact JSON shape (canonical contract)
      const expectedKeys = ["ok", "checks", "queue", "ffmpeg"];
      expect(Object.keys(res.body).sort()).toEqual(expectedKeys.sort());

      // Verify checks structure
      expect(Object.keys(res.body.checks).sort()).toEqual(["db", "worker"].sort());

      // Verify queue structure
      expect(Object.keys(res.body.queue).sort()).toEqual(
        expect.arrayContaining(["length", "oldestJobAge"]),
      );

      // Verify ffmpeg structure
      expect(res.body.ffmpeg).toHaveProperty("ok");
    });

    it("does not include timestamp in response (only admin endpoint has it)", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);
      expect(res.body).not.toHaveProperty("timestamp");
    });

    it("does not include deprecation headers (canonical endpoint)", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);
      expect(res.headers["deprecation"]).toBeUndefined();
      expect(res.headers["sunset"]).toBeUndefined();
      expect(res.headers["link"]).toBeUndefined();
    });

    it("validates queue metrics are fetched from real database", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);

      // Queue length should be a non-negative number
      expect(typeof res.body.queue.length).toBe("number");
      expect(res.body.queue.length).toBeGreaterThanOrEqual(0);

      // Oldest job age should be null or a number
      if (res.body.queue.oldestJobAge !== null) {
        expect(typeof res.body.queue.oldestJobAge).toBe("number");
        expect(res.body.queue.oldestJobAge).toBeGreaterThanOrEqual(0);
      }
    });

    it("validates database connectivity check", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);

      // DB check should have ok field
      expect(res.body.checks.db).toHaveProperty("ok");
      expect(typeof res.body.checks.db.ok).toBe("boolean");

      // If DB check fails, there should be a message
      if (!res.body.checks.db.ok) {
        expect(res.body.checks.db).toHaveProperty("message");
        expect(typeof res.body.checks.db.message).toBe("string");
      }
    });

    it("validates FFmpeg check (may be unavailable in test environment)", async () => {
      const res = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);

      // FFmpeg check should have ok field
      expect(res.body.ffmpeg).toHaveProperty("ok");
      expect(typeof res.body.ffmpeg.ok).toBe("boolean");

      // FFmpeg may not be available in test environment, which is acceptable
      // If it's not ok, there should be a message
      if (!res.body.ffmpeg.ok) {
        expect(res.body.ffmpeg).toHaveProperty("message");
        expect(typeof res.body.ffmpeg.message).toBe("string");
      }
    });
  },
);

