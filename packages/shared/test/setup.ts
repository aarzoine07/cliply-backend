import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import jwt from "jsonwebtoken";

// ✅ Force .env.test load manually (ESM-safe path resolution)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env.test");
dotenv.config({ path: envPath });

/**
 * ✅ Ensure NODE_ENV === "test" for shared getEnv()/auth fast-path.
 * Some runtimes define process.env.NODE_ENV as non-writable; assignment throws.
 * We only set it if missing, and do so via defineProperty.
 */
function ensureNodeEnvTest(): void {
  if (process.env.NODE_ENV) return;

  try {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "test",
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch {
    // If we can't set it, tests that depend on shared auth debug fast-path will fail.
    // Keep noise low but surface the root cause.
    // eslint-disable-next-line no-console
    console.warn("⚠️ Unable to define process.env.NODE_ENV='test' (read-only env).");
  }
}

ensureNodeEnvTest();

// Derive NODE_ENV for our test env config (should now be "test")
const NODE_ENV = process.env.NODE_ENV ?? "test";

// Set STRIPE_SECRET_KEY for tests (required by billing/checkout route)
if (!process.env.STRIPE_SECRET_KEY) {
  process.env.STRIPE_SECRET_KEY = "sk_test_mock_key_for_tests";
}

console.log(`✅ dotenv loaded from: ${envPath}`);
console.log("🔎 process.env.SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("🔎 process.env.NODE_ENV =", process.env.NODE_ENV);

export const env = {
  NODE_ENV,
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  DATABASE_URL: process.env.DATABASE_URL || "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  SENTRY_DSN: process.env.SENTRY_DSN || "",
};

console.log("🔎 env.SUPABASE_URL =", env.SUPABASE_URL);

const isCi = process.env.CI === "true";

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  if (isCi) {
    if (!env.SUPABASE_URL) {
      throw new Error("SUPABASE_URL missing in test environment (CI)");
    }
    if (!env.SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_ANON_KEY missing in test environment (CI)");
    }
  } else {
    console.warn(
      [
        "⚠️  SUPABASE env missing in test setup (local dev).",
        `  SUPABASE_URL present? ${!!env.SUPABASE_URL}`,
        `  SUPABASE_ANON_KEY present? ${!!env.SUPABASE_ANON_KEY}`,
        "  Tests may be flaky when they depend on Supabase.",
        "  In CI (CI=true), these are required and will cause a hard failure.",
      ].join("\n"),
    );
  }
}

export const supabaseTest =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

// ✅ Deterministic test IDs used by multiple test suites
const TEST_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const TEST_OWNER_ID = "00000000-0000-0000-0000-000000000002";
const TEST_WORKSPACE_WKA = "123e4567-e89b-12d3-a456-426614174000";

// ✅ HS256 local JWT generator for Supabase tests
export function createTestJwt(userId: string, workspaceId: string) {
  const payload = {
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    workspace_id: workspaceId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour
  };

  return jwt.sign(payload, env.SUPABASE_SERVICE_ROLE_KEY, {
    algorithm: "HS256",
  });
}

export async function resetDatabase() {
  if (!supabaseTest) {
    console.warn("⚠️ resetDatabase() skipped: supabaseTest not configured");
    return;
  }

  console.log("⚙️  resetDatabase() clearing jobs-related tables...");

  // FK-safe order: job_events -> jobs
  const { error: jobEventsError } = await supabaseTest
    .from("job_events")
    .delete()
    .neq("id", 0);

  if (jobEventsError) {
    throw new Error(
      `resetDatabase(): failed to clear job_events: ${jobEventsError.message}`,
    );
  }

  // idempotency_keys may not be exposed via PostgREST schema cache in some local states
  const { error: idemError } = await supabaseTest
    .from("idempotency_keys")
    .delete()
    .neq("id", 0);

  if (idemError) {
    const msg = `${idemError.message ?? ""}`.toLowerCase();
    const code = (idemError as any)?.code;

    const ignorable =
      msg.includes("could not find the table") || // PostgREST schema cache miss
      msg.includes("does not exist") || // DB relation missing
      code === "PGRST205"; // PostgREST "not found in schema cache" (common)

    if (!ignorable) {
      throw new Error(
        `resetDatabase(): failed to clear idempotency_keys: ${idemError.message}`,
      );
    }
  }

  const { error: jobsError } = await supabaseTest
    .from("jobs")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (jobsError) {
    throw new Error(`resetDatabase(): failed to clear jobs: ${jobsError.message}`);
  }

  // ✅ Seed deterministic workspace used by worker/job tests.
  const { error: wsError } = await supabaseTest
    .from("workspaces")
    .upsert(
      [
        {
          id: TEST_WORKSPACE_ID,
          name: "Test Workspace",
          owner_id: TEST_OWNER_ID,
          org_id: null,
        },
        {
          id: TEST_WORKSPACE_WKA,
          name: "Test Workspace A",
          owner_id: TEST_OWNER_ID,
          org_id: null,
        },
      ],
      { onConflict: "id" },
    );

  if (wsError) {
    throw new Error(`resetDatabase(): failed to seed workspaces: ${wsError.message}`);
  }

  console.log("✅ resetDatabase() done");
}

// Import clearEnvCache for test reset functionality
import { clearEnvCache } from "../src/env";

/**
 * Test helper: reset any cached env-related state between tests.
 */
export function resetEnvForTesting(): void {
  clearEnvCache();
}

/**
 * Checks if Supabase test client is configured and usable for real DB operations.
 */
export function isSupabaseTestConfigured(): boolean {
  if (!supabaseTest) {
    return false;
  }

  const url = env.SUPABASE_URL || "";
  if (url.includes("/dashboard/")) {
    return false;
  }

  if (!url.match(/\.supabase\.(co|io)/)) {
    return false;
  }

  return true;
}
