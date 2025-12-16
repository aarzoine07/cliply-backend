// @ts-nocheck
import { describe, expect, it } from "vitest";

import { isSupabaseTestConfigured } from "@cliply/shared/test/setup";
import adminReadyzRoute from "../../src/pages/api/admin/readyz";
import { supertestHandler } from "../../../../test/utils/supertest-next";

const toApiHandler = (handler: typeof adminReadyzRoute) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

describe.skipIf(!isSupabaseTestConfigured())(
  "GET /api/admin/readyz (Integration)",
  () => {
    it("returns 200 or 503 with full readiness object including timestamp (real DB)", async () => {
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

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

      // Admin endpoint should have timestamp
      expect(res.body).toHaveProperty("timestamp");
      expect(typeof res.body.timestamp).toBe("string");

      // Timestamp should be valid ISO 8601 string
      const timestamp = new Date(res.body.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();

      // Timestamp should be recent (within last 5 seconds)
      const now = Date.now();
      const timestampMs = timestamp.getTime();
      expect(Math.abs(now - timestampMs)).toBeLessThan(5000);
    });

    it("returns correct JSON shape with all required fields including timestamp", async () => {
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

      expect([200, 503]).toContain(res.status);

      // Verify exact JSON shape (canonical contract with timestamp)
      const expectedKeys = ["ok", "checks", "queue", "ffmpeg", "timestamp"];
      expect(Object.keys(res.body).sort()).toEqual(expectedKeys.sort());

      // Verify checks structure
      expect(Object.keys(res.body.checks).sort()).toEqual(["db", "worker"].sort());

      // Verify queue structure
      expect(Object.keys(res.body.queue).sort()).toEqual(
        expect.arrayContaining(["length", "oldestJobAge"]),
      );

      // Verify ffmpeg structure
      expect(res.body.ffmpeg).toHaveProperty("ok");

      // Verify timestamp is ISO 8601
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("returns 405 for non-GET requests", async () => {
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "post").post("/");

      expect(res.status).toBe(405);
      expect(res.body).toHaveProperty("ok", false);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("message", "method_not_allowed");
    });

    it("validates queue metrics are fetched from real database", async () => {
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

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
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

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
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");

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

    it("includes timestamp that is recent and valid ISO 8601", async () => {
      const beforeRequest = Date.now();
      const res = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");
      const afterRequest = Date.now();

      expect([200, 503]).toContain(res.status);

      // Timestamp should be present
      expect(res.body).toHaveProperty("timestamp");
      expect(typeof res.body.timestamp).toBe("string");

      // Parse timestamp
      const timestamp = new Date(res.body.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();

      // Timestamp should be between before and after request time
      const timestampMs = timestamp.getTime();
      expect(timestampMs).toBeGreaterThanOrEqual(beforeRequest - 1000); // Allow 1s margin
      expect(timestampMs).toBeLessThanOrEqual(afterRequest + 1000); // Allow 1s margin
    });
  },
);

