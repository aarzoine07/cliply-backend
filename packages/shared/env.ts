import { z } from "zod";

export const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // ✅ Supabase
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string(),

    // ✅ Database + integrations
    DATABASE_URL: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    SENTRY_DSN: z.string().optional().or(z.literal("")).default(""),
  })
  .readonly();

export type EnvType = z.infer<typeof Env>;

export function getEnv(): EnvType {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`ENV_INVALID: ${issues}`);
  }
  return parsed.data;
}
