import "dotenv/config";
import process from "node:process";
import * as sharedEnv from "../packages/shared/src/env";

/**
 * Resolve the validated environment object from the shared env module.
 *
 * This helper is defensive: it supports multiple export shapes so that
 * check-env.ts stays stable even if the env module evolves.
 */
function getValidatedEnv() {
  const anyEnv = sharedEnv as any;

  // Prefer explicit getter functions if present
  if (typeof anyEnv.getEnv === "function") {
    return anyEnv.getEnv();
  }

  if (typeof anyEnv.getServerEnv === "function") {
    return anyEnv.getServerEnv();
  }

  // Fallback to common object-style exports
  if (anyEnv.serverEnv && typeof anyEnv.serverEnv === "object") {
    return anyEnv.serverEnv;
  }

  if (anyEnv.env && typeof anyEnv.env === "object") {
    return anyEnv.env;
  }

  // Last-resort fallback: use process.env directly
  return process.env as Record<string, string | undefined> & {
    NODE_ENV?: string;
  };
}

/**
 * Lightweight environment validation script.
 *
 * Validates that required environment variables are present and correctly formatted
 * for both API (web) and Worker services.
 *
 * Exits with:
 *   0 - All environment checks passed
 *   1 - One or more environment checks failed
 *
 * Usage:
 *   pnpm check:env
 */

/**
 * Check if required environment variables for API are present
 */
function checkEnvForApi() {
  try {
    const env = getValidatedEnv();
    const required = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ] as const;
    const missing: string[] = [];

    for (const key of required) {
      const value = env[key];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missing.push(key);
      }
    }

    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  } catch {
    // If anything goes wrong accessing env, treat as validation failure
    return { ok: false, missing: ["ENV_VALIDATION_FAILED"] };
  }
}

/**
 * Check if required environment variables for worker are present
 */
function checkEnvForWorker() {
  try {
    const env = getValidatedEnv();
    const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
    const missing: string[] = [];

    for (const key of required) {
      const value = env[key];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missing.push(key);
      }
    }

    return missing.length === 0 ? { ok: true } : { ok: false, missing };
  } catch {
    // If anything goes wrong accessing env, treat as validation failure
    return { ok: false, missing: ["ENV_VALIDATION_FAILED"] };
  }
}

async function main() {
  console.log("🔍 [check-env] Starting environment validation...\n");

  // Step 1: Load and validate environment schema (via shared env module)
  let env: ReturnType<typeof getValidatedEnv>;
  try {
    env = getValidatedEnv();
    console.log("✅ [check-env] Environment schema validation passed");
  } catch (error) {
    console.error("❌ [check-env] Environment schema validation FAILED\n");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    console.error("\n💡 Tip: Check your .env.local or .env file against .env.example");
    console.error("📖 Documentation: ENV.md\n");
    process.exit(1);
  }

  console.log(`   NODE_ENV: ${env.NODE_ENV}`);
  console.log("");

  // Step 2: Check API-required environment variables
  console.log("🌐 [check-env] Checking API environment...");
  const apiResult = checkEnvForApi();

  if (apiResult.ok) {
    console.log("✅ [check-env] API environment: OK");
  } else {
    console.log("❌ [check-env] API environment: FAILED");
    if (apiResult.missing && apiResult.missing.length > 0) {
      console.log("   Missing or invalid variables:");
      for (const missing of apiResult.missing) {
        console.log(`   - ${missing}`);
      }
    }
  }
  console.log("");

  // Step 3: Check Worker-required environment variables
  console.log("⚙️  [check-env] Checking Worker environment...");
  const workerResult = checkEnvForWorker();

  if (workerResult.ok) {
    console.log("✅ [check-env] Worker environment: OK");
  } else {
    console.log("❌ [check-env] Worker environment: FAILED");
    if (workerResult.missing && workerResult.missing.length > 0) {
      console.log("   Missing or invalid variables:");
      for (const missing of workerResult.missing) {
        console.log(`   - ${missing}`);
      }
    }
  }
  console.log("");

  // Step 4: Aggregate results and exit
  const allOk = apiResult.ok && workerResult.ok;

  if (!allOk) {
    console.error("❌ [check-env] Environment validation FAILED");
    console.error("");
    console.error("💡 Next steps:");
    console.error("   1. Copy template: cp .env.example .env.local");
    console.error("   2. Fill in missing values (see ENV.md for details)");
    console.error("   3. Run: pnpm check:env");
    console.error("");
    process.exit(1);
  }

  console.log("✅ [check-env] Environment validation PASSED");
  console.log("");
  console.log("🎉 Your environment is ready for:");
  console.log("   - pnpm build");
  console.log("   - pnpm test:core");
  console.log("   - pnpm dev");
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ [check-env] Unexpected error:", error);
  process.exit(1);
});
