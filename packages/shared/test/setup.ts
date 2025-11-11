console.log("🔍 CI ENV SNAPSHOT:", {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
});
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import jwt from "jsonwebtoken";

// ✅ Force .env.test load manually
const envPath = path.resolve(process.cwd(), ".env.test");
dotenv.config({ path: path.resolve(__dirname, "../../../.env.test") });

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

if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing in test environment");
if (!env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY missing in test environment");

export const supabaseTest = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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
