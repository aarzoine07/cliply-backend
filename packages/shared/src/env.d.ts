import { z } from "zod";
/**
 * Centralized, type-safe env loader.
 * We NEVER read process.env anywhere else—always import from here.
 * Required keys guarantee plain `string` types instead of `string | undefined`.
 */
declare const EnvSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        production: "production";
        test: "test";
    }>>;
    SUPABASE_URL: z.ZodString;
    SUPABASE_ANON_KEY: z.ZodString;
    SUPABASE_SERVICE_ROLE_KEY: z.ZodString;
    WORKER_POLL_MS: z.ZodOptional<z.ZodString>;
    WORKER_HEARTBEAT_MS: z.ZodOptional<z.ZodString>;
    WORKER_RECLAIM_MS: z.ZodOptional<z.ZodString>;
    WORKER_STALE_SECONDS: z.ZodOptional<z.ZodString>;
    LOG_SAMPLE_RATE: z.ZodDefault<z.ZodString>;
    SENTRY_DSN: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodOptional<z.ZodString>;
    STRIPE_SECRET_KEY: z.ZodOptional<z.ZodString>;
    STRIPE_WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
    DEEPGRAM_API_KEY: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type Env = z.infer<typeof EnvSchema>;
export declare function getEnv(): Env;
export {};
