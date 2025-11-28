// packages/shared/test/setup.ts
import { beforeAll } from "vitest";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { execa } from "execa";
import jwt from "jsonwebtoken";

// -------------------------------------------------------
// ESM __dirname shim
// -------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -------------------------------------------------------
// Load .env.test explicitly (Vitest does NOT load it automatically)
// -------------------------------------------------------
const envPath = resolve(__dirname, "../../../.env.test");
dotenv.config({ path: envPath });

console.log("🔧 [SETUP] dotenv loaded from:", envPath);
console.log("🔧 [SETUP] SUPABASE_URL =", process.env.SUPABASE_URL);

// -------------------------------------------------------
// Export env map for tests
// -------------------------------------------------------
export const env = {
  NODE_ENV: "test",
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
};

// -------------------------------------------------------
// Supabase service client for test helpers
// -------------------------------------------------------
export const supabaseTest = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// -------------------------------------------------------
// JWT generator (used in auth tests)
// -------------------------------------------------------
export function createTestJwt(userId: string, workspaceId: string) {
  const payload = {
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    workspace_id: workspaceId,
  };

  return jwt.sign(payload, env.SUPABASE_SERVICE_ROLE_KEY, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}

// -------------------------------------------------------
// The NEW resetDatabase() — guaranteed not to hang
// -------------------------------------------------------
export async function resetDatabase() {
  console.log("🧹 [SETUP] Running supabase db reset...");

  const proc = execa("supabase", ["db", "reset"], {
    stdout: "inherit",
    stderr: "inherit",
  });

  // 💡 Critical – wait fully and catch errors
  try {
    await proc;
    console.log("🧹 [SETUP] supabase db reset completed.");
  } catch (error) {
    console.error("❌ [SETUP] supabase db reset failed:", error);
    throw error;
  }
}

// -------------------------------------------------------
// Vitest Global Hook — with hard timeout safety
// -------------------------------------------------------
beforeAll(
  async () => {
    console.log("🔧 [SETUP] Global beforeAll → running resetDatabase()");
    await resetDatabase();
  },
  // ⏳ Increase hook timeout to avoid false failures
  120_000 // 120 seconds
)