import { execSync } from "child_process";

import fetch from "node-fetch";
import { describe, expect, it } from "vitest";

const HEALTH_URL = process.env.SNAPSHOT_HEALTH_URL ?? "http://localhost:3000/api/analytics/health";

describe("System Snapshot – Health Summary", () => {
  it("passes migrations, typecheck, and health API", async () => {
    const migrate = execSync("pnpm exec supabase db reset", { encoding: "utf8" });
    expect(migrate).toMatch(/Applying migration/);

    const typecheck = execSync("pnpm typecheck", { encoding: "utf8" });
    expect(typecheck).toMatch(/Found 0 errors/);

    const response = await fetch(HEALTH_URL);
    expect(response.ok).toBe(true);
    const json = (await response.json()) as { ok: boolean; db: string };
    expect(json.ok).toBe(true);
    expect(json.db).toBe("ok");

    const summary = {
      migrate: /OK|Success|Finished/i.test(migrate),
      typecheck: /Found 0 errors/.test(typecheck),
      health: json.ok,
    };

    console.log("Snapshot ✅", summary);
  });
});
