import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

describe("T2 RLS proof (psql)", () => {
  it("enforces workspace-member access model for surface tables", () => {
    const scriptPath = path.resolve(__dirname, "rls.t2.proof.sql");
    expect(existsSync(scriptPath)).toBe(true);

    const dbUrl =
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

    // Deterministic user IDs used by the SQL script (script cleans these up).
    const u1 = "11111111-1111-1111-1111-111111111112";
    const u2 = "22222222-2222-2222-2222-222222222223";

    let stdout = "";
    try {
      stdout = execFileSync(
        "psql",
        [
          "-d",
          dbUrl,
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          `u1=${u1}`,
          "-v",
          `u2=${u2}`,
          "-f",
          scriptPath,
        ],
        { encoding: "utf8" },
      );
    } catch (e: any) {
      const msg =
        (e?.stdout ? String(e.stdout) : "") +
        "\n" +
        (e?.stderr ? String(e.stderr) : "");
      throw new Error(
        `T2 RLS proof script failed.\n` +
          `DB_URL=${dbUrl}\n` +
          `\n--- psql output ---\n${msg}\n`,
      );
    }

    expect(stdout).toContain("--- T2 RLS PROOF: done ---");
  });
});
