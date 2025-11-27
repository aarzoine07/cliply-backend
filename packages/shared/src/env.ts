import { z } from "zod";

/**
 * Centralized, type-safe environment variable schema for Cliply backend.
 * This is the single source of truth for all environment variables.
 * 
 * Server-side code should import from this module instead of accessing process.env directly.
 * Client-side code (Next.js) should use the web adapter which exposes only NEXT_PUBLIC_* vars.
 */
const EnvSchema = z.object({
  // ─── Core ────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ─── Supabase ────────────────────────────────────────────────
  SUPABASE_URL: z.string().url({
    message: "SUPABASE_URL must be a valid URL",
  }),
  SUPABASE_ANON_KEY: z.string().min(20, "SUPABASE_ANON_KEY missing or too short"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(
    20,
    "SUPABASE_SERVICE_ROLE_KEY missing or too short",
  ),

  // ─── Worker config (optional) ────────────────────────────────
  WORKER_POLL_MS: z.string().optional(),
  WORKER_HEARTBEAT_MS: z.string().optional(),
  WORKER_RECLAIM_MS: z.string().optional(),
  WORKER_STALE_SECONDS: z.string().optional(),
  LOG_SAMPLE_RATE: z.string().default("1"),

  // ─── External services (optional) ────────────────────────────
  SENTRY_DSN: z.string().default(""),
  DATABASE_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // ─── YouTube/Google OAuth (optional for test, required for production) ────────────────────────────
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_OAUTH_REDIRECT_URL: z.string().url().optional(),

  // ─── TikTok OAuth (optional for test, required for production) ────────────────────────────
  TIKTOK_CLIENT_ID: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_OAUTH_REDIRECT_URL: z.string().url().optional(),
  TIKTOK_TOKEN_URL: z.string().url().optional(),
  TIKTOK_ENCRYPTION_KEY: z
    .string()
    .min(1, "TIKTOK_ENCRYPTION_KEY is required for TikTok token encryption")
    .describe("Base64-encoded 32-byte key for encrypting TikTok tokens at rest"),

  // ─── Cron & Automation ────────────────────────────────────────────────
  CRON_SECRET: z.string().optional(),
  VERCEL_AUTOMATION_BYPASS_SECRET: z.string().optional(),

  // ─── Next.js Public Variables (for client-side) ────────────────────────────
  // These are exposed to the browser and must be prefixed with NEXT_PUBLIC_
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_TIKTOK_REDIRECT_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

// Export the schema for testing purposes
export { EnvSchema };

let cached: Env | null = null;

const DISABLE_ENV_CACHE =
  process.env.NODE_ENV === "test" ||
  process.env.DISABLE_ENV_CACHE === "1";

/**
 * Get the parsed environment variables.
 * This function parses and validates env vars on first call, then caches the result.
 * 
 * @throws {z.ZodError} If required env vars are missing or invalid
 */
export function getEnv(): Env {
  // ⛔ Disable caching during test mode
  if (cached && !DISABLE_ENV_CACHE) return cached;
  
  try {
    cached = EnvSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `${path}: ${issue.message}`;
        })
        .join("\n  ");
      throw new Error(
        `Environment variable validation failed:\n  ${issues}\n\n` +
        "Please check your .env file or environment configuration."
      );
    }
    throw error;
  }
  
  return cached;
}

/**
 * Get or access the parsed environment variables.
 * This is the preferred way to access env vars - it ensures validation on first use.
 * 
 * Usage:
 *   const { SUPABASE_URL } = getEnv();
 *   or
 *   const env = getEnv();
 *   const url = env.SUPABASE_URL;
 * 
 * Note: getEnv is already exported above as a function declaration.
 */

// For testing: clear cache to allow env changes
export function clearEnvCache(): void {
  cached = null;
}
