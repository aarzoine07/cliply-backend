import { config } from "dotenv";

import path from "path";

// ✅ Force-load .env.test from monorepo root, no matter where test is run from
config({ path: path.resolve(__dirname, "../../../../../.env.test"), override: true });

import { getEnv } from "@cliply/shared/env";
import { log } from "@cliply/shared/logging/logger";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll } from "vitest";

// 🔍 Diagnostic logging to confirm env is loaded
console.log("🔎 process.env.SUPABASE_URL =", process.env.SUPABASE_URL);

const env = getEnv();
console.log("🔎 env.SUPABASE_URL =", env.SUPABASE_URL);

if (!env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL missing in test environment");
}

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY missing in test environment");
}

export const supabaseTest = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// ✅ Seed test workspace so job inserts don’t fail foreign key
async function seedWorkspace(id: string) {
  await supabaseTest.from("workspaces").insert({
    id,
    name: "Test Workspace",
    stripe_customer_id: null,
    created_by: id,
  });
}

beforeAll(async () => {
  await seedWorkspace("00000000-0000-0000-0000-000000000001");
  log({ service: "shared", event: "test_boot", force: true });
  await supabaseTest.from("jobs").select("id").limit(1);
});

afterAll(async () => {
  log({ service: "shared", event: "test_shutdown", force: true });
});

export async function resetDatabase(): Promise<void> {
  try {
    await supabaseTest.rpc("truncate_test_data");
    log({ service: "shared", event: "test_db_reset", force: true });
  } catch (error) {
    log({
      service: "shared",
      event: "test_db_reset_skipped",
      level: "warn",
      message: error instanceof Error ? error.message : String(error),
      force: true,
    });
  }
}
