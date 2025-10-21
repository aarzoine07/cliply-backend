// @ts-nocheck
import path from "path";

import { resetDatabase } from "@cliply/shared/test/setup";
import { describe, expect, it } from "vitest";

// ✅ dotenv loader
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });
const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

// ⛩️ Import handler directly
import handler from "../../src/pages/api/cron/scan-schedules.ts";

describe("POST /api/cron/scan-schedules (in-process)", () => {
  it("returns forbidden without service-role header", async () => {
    const mockReq = { method: "POST", headers: {} };

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

    console.log("🚫 Unauthorized output:", jsonBody);

    expect(statusCode).toBe(403);
    expect(jsonBody.ok).toBe(false);
  });

  it("returns ok when authorized", async () => {
    const mockReq = {
      method: "POST",
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

    console.log("✅ Authorized output:", jsonBody);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
  });
});
