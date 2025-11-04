import { z } from "zod";

/**
 * Centralized, type-safe env loader.
 * We NEVER read process.env anywhere else—always import from here.
 * Required keys guarantee plain `string` types instead of `string | undefined`.
 */
const EnvSchema = z.object({
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
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  cached = EnvSchema.parse(process.env);
  return cached;
}
