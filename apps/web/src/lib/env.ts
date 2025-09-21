import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SENTRY_DSN: z.string().url().optional(),
    YOUTUBE_API_KEY: z.string().min(1).optional(),
  })
  .strict();

type ParsedEnv = z.infer<typeof EnvSchema>;

export type Env = ParsedEnv & {
  SUPABASE_URL: string;
};

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const raw: Record<keyof ParsedEnv, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  };

  const parsed = EnvSchema.parse(raw);
  cachedEnv = {
    ...parsed,
    SUPABASE_URL: parsed.NEXT_PUBLIC_SUPABASE_URL,
  };

  return cachedEnv;
}

/** Test helper to clear cached env between test cases. */
export function resetEnvForTesting(): void {
  cachedEnv = null;
}
