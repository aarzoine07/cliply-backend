import path from "path";

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// ✅ Force .env.test load manually
const envPath = path.resolve(process.cwd(), "../../.env.test");
dotenv.config({ path: envPath });

console.log(`✅ dotenv loaded from: ${envPath}`);
console.log("🔎 process.env.SUPABASE_URL =", process.env.SUPABASE_URL);

export const env = {
  NODE_ENV: process.env.NODE_ENV || "test",
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  DATABASE_URL: process.env.DATABASE_URL!,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
  SENTRY_DSN: process.env.SENTRY_DSN || "",
};

console.log("🔎 env.SUPABASE_URL =", env.SUPABASE_URL);

// ✅ Validate existence manually (not via zod)
if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing in test environment");
if (!env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY missing in test environment");

// ✅ Create reusable Supabase client for tests
export const supabaseTest = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

// ✅ Minimal reset stub
export async function resetDatabase() {
  console.log("⚙️  resetDatabase() called (stubbed for local tests)");
}
