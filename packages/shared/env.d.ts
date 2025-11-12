import { z } from "zod";
export declare const Env: z.ZodReadonly<z.ZodObject<{
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
    DATABASE_URL: z.ZodOptional<z.ZodString>;
    STRIPE_SECRET_KEY: z.ZodOptional<z.ZodString>;
    STRIPE_WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
    DEEPGRAM_API_KEY: z.ZodOptional<z.ZodString>;
    SENTRY_DSN: z.ZodDefault<z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>>;
}, z.core.$strip>>;
export type EnvType = z.infer<typeof Env>;
export declare function getEnv(): EnvType;
