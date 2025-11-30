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

// Ensure NODE_ENV is set to "test" for test environment
// This must be set before any modules that cache env are imported
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

console.log(`✅ dotenv loaded from: ${envPath}`);
console.log("🔎 process.env.SUPABASE_URL =", process.env.SUPABASE_URL);

export const env = {
  NODE_ENV: process.env.NODE_ENV || "test",
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
      ].join("\n")
    );
  }
}

export const supabaseTest = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

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
  console.log("⚙️  resetDatabase() called (stubbed for local tests)");
}

/**
 * Checks if Supabase test client is configured and usable for real DB operations.
 * Returns false if:
 * - supabaseTest is null (missing credentials)
 * - SUPABASE_URL is a dashboard URL (contains '/dashboard/') instead of an API URL
 * 
 * @returns true if Supabase is properly configured for tests, false otherwise
 */
export function isSupabaseTestConfigured(): boolean {
  if (!supabaseTest) {
    return false;
  }
  
  // Check if URL is a dashboard URL (not a real API URL)
  // Dashboard URLs: https://supabase.com/dashboard/project/...
  // API URLs: https://xxx.supabase.co or https://xxx.supabase.io
  const url = env.SUPABASE_URL || "";
  if (url.includes("/dashboard/")) {
    return false;
  }
  
  // Check if it looks like a real Supabase API URL
  // Real URLs typically end with .supabase.co or .supabase.io
  if (!url.match(/\.supabase\.(co|io)/)) {
    return false;
  }
  
  return true;
}
