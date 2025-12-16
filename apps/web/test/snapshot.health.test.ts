/**
 * Infra-only snapshot test: requires Docker + Supabase CLI + local supabase.
 *
 * Opt-in by running:
 *   RUN_SNAPSHOT_HEALTH=true pnpm test apps/web/test/snapshot.health.test.ts
 *
 * Default (RUN_SNAPSHOT_HEALTH !== "true"):
 *   - The suite is skipped so standard `pnpm test` stays green without Docker.
 */
import "../../../packages/shared/test/loadEnv"; // ✅ load env first

import { execSync } from "child_process";

import fetch from "node-fetch";
import { describe, expect, it } from "vitest";

const RUN_SNAPSHOT_HEALTH = process.env.RUN_SNAPSHOT_HEALTH === "true";
const HEALTH_URL = process.env.SNAPSHOT_HEALTH_URL ?? "http://localhost:3000/api/analytics/health";

if (!RUN_SNAPSHOT_HEALTH) {
  describe.skip("System Snapshot – Health Summary (requires RUN_SNAPSHOT_HEALTH=true)", () => {
    it("is skipped unless explicitly opted in", () => {
      expect(true).toBe(true);
    });
  });
} else {
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
}
