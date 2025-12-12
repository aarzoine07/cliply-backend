// @ts-nocheck

import { describe, it, expect } from "vitest";
import { buildAuthContext } from "@cliply/shared/auth/context";

describe("auth debug headers smoke test", () => {
  it("prints what buildAuthContext sees in test mode", async () => {
    console.log("ENV DEBUG (process.env.NODE_ENV):", process.env.NODE_ENV);

    const req = new Request("http://localhost/api/test", {
      method: "GET",
      headers: {
        "x-debug-user": "00000000-0000-0000-0000-000000000001",
        "x-debug-workspace": "11111111-1111-1111-1111-111111111111",
        "x-workspace-id": "11111111-1111-1111-1111-111111111111",
      },
    });

    try {
      const ctx = await buildAuthContext(req as any);
      console.log("AUTH CTX SUCCESS:", ctx);
    } catch (err: any) {
      console.log("AUTH CTX ERROR:", {
        name: err?.name,
        code: err?.code,
        status: err?.status,
        message: err?.message,
      });
    }

    // We don't care about pass/fail yet — just inspecting the logs.
    expect(true).toBe(true);
  });
});

