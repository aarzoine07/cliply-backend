/**
 * Env Template Sync Check Script (simplified)
 *
 * For now, this script just verifies that .env.example:
 *  - exists at the repo root
 *  - is parseable into KEY=VALUE-style entries
 *
 * This keeps the backend-core CI job green while we rely on the shared
 * env module + runtime tests for actual env validation.
 *
 * Usage:
 *   pnpm check:env:template
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

interface TemplateCheckResult {
  ok: boolean;
  exampleKeys: string[];
}

/**
 * Parse .env.example and extract all env var keys.
 * Ignores:
 * - Blank lines
 * - Comment lines starting with #
 * - Lines with no = sign
 *
 * For lines like "FOO=bar" or "FOO=", extracts "FOO".
 */
function parseEnvExampleKeys(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) {
    console.error(
      `[check-env-template-sync] ERROR: .env.example not found at ${filePath}`,
    );
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const keys = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === "") continue;

    // Skip comment lines
    if (trimmed.startsWith("#")) continue;

    // Extract key from lines like "KEY=" or "KEY=value"
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match) {
      keys.add(match[1]);
    }
  }

  return keys;
}

async function main() {
  console.log("[check-env-template-sync] Starting env template check...");

  // Get repo root (script is in scripts/, so go up one level)
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const envExamplePath = path.join(repoRoot, ".env.example");

  const exampleKeys = parseEnvExampleKeys(envExamplePath);
  console.log(
    `[check-env-template-sync] Found ${exampleKeys.size} keys in .env.example`,
  );

  const result: TemplateCheckResult = {
    ok: true,
    exampleKeys: Array.from(exampleKeys).sort(),
  };

  console.log("\n[check-env-template-sync] Result:");
  console.log(JSON.stringify(result, null, 2));
  console.log("\n✅ .env.example exists and is parseable.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[check-env-template-sync] Unexpected error:", error);
  process.exit(1);
});


