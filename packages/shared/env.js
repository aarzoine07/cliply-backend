import { z } from "zod";
export const Env = z
    .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // ✅ Supabase
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),
    // ✅ Worker config
    WORKER_POLL_MS: z.string().optional(),
    WORKER_HEARTBEAT_MS: z.string().optional(),
    WORKER_RECLAIM_MS: z.string().optional(),
    WORKER_STALE_SECONDS: z.string().optional(),
    LOG_SAMPLE_RATE: z.string().default("1"),
    // ✅ Database + integrations
    DATABASE_URL: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    DEEPGRAM_API_KEY: z.string().optional(),
    SENTRY_DSN: z.string().optional().or(z.literal("")).default(""),
})
    .readonly();
export function getEnv() {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
        throw new Error(`ENV_INVALID: ${issues}`);
    }
    return parsed.data;
}
