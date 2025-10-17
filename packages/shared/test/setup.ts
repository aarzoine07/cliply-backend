import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, afterAll } from "vitest";

import { getEnv } from "@cliply/shared/env";
import { log } from "@cliply/shared/logging/logger";

config({ path: ".env.test", override: true });

const env = getEnv();

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

beforeAll(async () => {
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
