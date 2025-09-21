import { z } from "zod";

/**
 * Centralized, type-safe env loader.
 * We NEVER read process.env anywhere else—always import from here.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Supabase (server-side only; never expose service role to the browser)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  // Sentry / Stripe / Deepgram placeholders (we’ll add later steps)
  SENTRY_DSN: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  // IMPORTANT: do not serialize full env to logs.
  cached = EnvSchema.parse(process.env);
  return cached;
}
