/**
 * Env Template Sync Check Script
 *
 * Ensures that .env.example is always aligned with the canonical EnvSchema.
 *
 * This script:
 * - Extracts all keys from EnvSchema (the single source of truth)
 * - Parses .env.example to extract all keys (ignoring comments and blank lines)
 * - Compares the two sets and reports any missing or extra keys
 * - Exits with 0 if in sync, 1 if there are mismatches
 *
 * Usage:
 *   pnpm check:env:template
 *
 * This is wired into CI's backend-core job to ensure documentation stays in sync.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Import the env schema from source so we don't depend on a built dist/ folder in CI
import * as envModule from "../packages/shared/src/env";

interface SyncResult {
  ok: boolean;
  missingInExample: string[];
  extraInExample: string[];
}

/**
 * Extract all keys from the EnvSchema.
 * Uses Zod's shape property to get the object keys.
 */
function getSchemaKeys(): Set<string> {
  // Access EnvSchema from the module; handle both named and default export patterns
  const maybeModule = envModule as any;
  const EnvSchema = maybeModule.EnvSchema || maybeModule.default || maybeModule;

  const shape = EnvSchema.shape;
  return new Set(Object.keys(shape));
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

/**
 * Compare schema keys vs .env.example keys and return a sync result.
 */
function checkSync(
  schemaKeys: Set<string>,
  exampleKeys: Set<string>,
): SyncResult {
  const missingInExample: string[] = [];
  const extraInExample: string[] = [];

  // Find keys in schema but not in example
  for (const key of schemaKeys) {
    if (!exampleKeys.has(key)) {
      missingInExample.push(key);
    }
  }

  // Find keys in example but not in schema
  for (const key of exampleKeys) {
    if (!schemaKeys.has(key)) {
      extraInExample.push(key);
    }
  }

  // Sort for deterministic output
  missingInExample.sort();
  extraInExample.sort();

  const ok = missingInExample.length === 0 && extraInExample.length === 0;

  return {
    ok,
    missingInExample,
    extraInExample,
  };
}

/**
 * Main entry point
 */
async function main() {
  console.log("[check-env-template-sync] Starting env template sync check...");

  // Get repo root (script is in scripts/, so go up one level)
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const envExamplePath = path.join(repoRoot, ".env.example");

  // Extract keys from schema
  const schemaKeys = getSchemaKeys();
  console.log(
    `[check-env-template-sync] Found ${schemaKeys.size} keys in EnvSchema`,
  );

  // Parse .env.example
  const exampleKeys = parseEnvExampleKeys(envExamplePath);
  console.log(
    `[check-env-template-sync] Found ${exampleKeys.size} keys in .env.example`,
  );

  // Check sync
  const result = checkSync(schemaKeys, exampleKeys);

  // Output machine-readable JSON
  console.log("\n[check-env-template-sync] Result:");
  console.log(JSON.stringify(result, null, 2));

  // Human-friendly summary
  if (result.ok) {
    console.log("\n✅ .env.example is in sync with EnvSchema!");
    process.exit(0);
  } else {
    console.error("\n❌ .env.example is OUT OF SYNC with EnvSchema!");

    if (result.missingInExample.length > 0) {
      console.error("\nMissing in .env.example (add these keys):");
      for (const key of result.missingInExample) {
        console.error(`  - ${key}`);
      }
    }

    if (result.extraInExample.length > 0) {
      console.error("\nExtra in .env.example (remove these keys or add to schema):");
      for (const key of result.extraInExample) {
        console.error(`  - ${key}`);
      }
    }

    console.error("\nTo fix:");
    console.error(
      "  1. Review the missing/extra keys above",
    );
    console.error(
      "  2. Update .env.example to match EnvSchema (packages/shared/src/env.ts)",
    );
    console.error(
      "  3. Or, if a key should exist, add it to EnvSchema first",
    );

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[check-env-template-sync] Unexpected error:", error);
  process.exit(1);
});


