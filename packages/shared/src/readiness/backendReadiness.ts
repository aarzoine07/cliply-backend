import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getEnv } from "@cliply/shared/env";
import { STRIPE_PLAN_MAP } from "../billing/stripePlanMap";

// ─────────────────────────────────────────────
// Queue staleness thresholds used by health / readiness
// ─────────────────────────────────────────────
export const QUEUE_AGE_WARNING_MS = 60_000; // 60 seconds
export const QUEUE_AGE_HARD_FAIL_MS = 300_000; // 5 minutes

// WorkerEnvStatus type (duplicated to avoid circular dependency)
export type WorkerEnvStatus = {
  ok: boolean;
  ffmpegOk: boolean;
  ytDlpOk: boolean;
  missingEnv: string[];
};

// Internal constants
const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const OPTIONAL_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "DEEPGRAM_API_KEY",
  "OPENAI_API_KEY",
] as const;

const CRITICAL_TABLES = [
  "workspaces",
  "jobs",
  "schedules",
  "subscriptions",
] as const;

// ─────────────────────────────────────────────
// Public result types
// ─────────────────────────────────────────────

export type EnvCheckResult = {
  ok: boolean;
  missing: string[];
  optionalMissing: string[];
};

export type DbCheckResult = {
  ok: boolean;
  error?: string;
  tablesChecked: string[];
  missingTables: string[];
};

export type StripeCheckResult = {
  ok: boolean;
  missingEnv: string[];
  priceIdsConfigured: number;
};

export type SentryCheckResult = {
  ok: boolean;
  missingEnv: string[];
};

export type BackendReadinessChecks = {
  env: EnvCheckResult;
  db: DbCheckResult;
  stripe: StripeCheckResult;
  sentry: SentryCheckResult;
  worker?: WorkerEnvStatus;
};

// This is the shape consumed by admin/readyz and tests
export type BackendReadinessReport = {
  ok: boolean;

  // Individual checks (for internal use)
  env: EnvCheckResult;
  worker?: WorkerEnvStatus;
  db: DbCheckResult;
  stripe: StripeCheckResult;
  sentry: SentryCheckResult;

  // Aggregated map used by /api/admin/readyz
  checks: BackendReadinessChecks;

  // Optional higher-level fields populated by engine health helpers
  queue?: unknown;
  ffmpeg?: unknown;
};

// ─────────────────────────────────────────────
// Check helpers
// ─────────────────────────────────────────────

/**
 * Checks environment variables and returns missing required and optional ones.
 */
export function checkEnvironment(): EnvCheckResult {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    // If getEnv() throws, it means required vars are missing
    const errorMessage = error instanceof Error ? error.message : String(error);
    const missing: string[] = [];

    // Check each required var to see if it's mentioned in the error
    for (const key of REQUIRED_ENV_VARS) {
      if (errorMessage.includes(key) || !process.env[key]) {
        missing.push(key);
      }
    }

    // If we couldn't determine specific missing vars, assume all are missing
    if (missing.length === 0) {
      return {
        ok: false,
        missing: REQUIRED_ENV_VARS.slice(),
        optionalMissing: [],
      };
    }

    return {
      ok: false,
      missing,
      optionalMissing: [],
    };
  }

  // Check required vars on the parsed env object
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    const value = (env as Record<string, unknown>)[key];
    if (!value || (typeof value === "string" && value.trim() === "")) {
      missing.push(key);
    }
  }

  const optionalMissing: string[] = [];
  for (const key of OPTIONAL_ENV_VARS) {
    const value = (env as Record<string, unknown>)[key];
    if (!value || (typeof value === "string" && value.trim() === "")) {
      optionalMissing.push(key);
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    optionalMissing,
  };
}

/**
 * Checks database connectivity and verifies critical tables exist.
 */
export async function checkDatabase(): Promise<DbCheckResult> {
  let env;
  try {
    env = getEnv();
  } catch {
    return {
      ok: false,
      error: "Failed to load environment variables",
      tablesChecked: [],
      missingTables: CRITICAL_TABLES.slice(),
    };
  }

  const envRecord = env as Record<string, unknown>;
  const supabaseUrl = envRecord.SUPABASE_URL as string | undefined;
  const supabaseServiceRoleKey = envRecord.SUPABASE_SERVICE_ROLE_KEY as
    | string
    | undefined;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      ok: false,
      error: "Missing Supabase credentials",
      tablesChecked: [],
      missingTables: CRITICAL_TABLES.slice(),
    };
  }

  try {
    // Create Supabase client with service role key (bypasses RLS)
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    let dbError: string | undefined;
    const tablesChecked: string[] = [];
    const missingTables: string[] = [];

    // Check each critical table exists by attempting a lightweight query
    for (const table of CRITICAL_TABLES) {
      const { error: tableError } = await supabase
        .from(table)
        .select("id")
        .limit(1);

      if (tableError) {
        // Table missing
        if (
          tableError.message?.includes("does not exist") ||
          tableError.message?.includes("relation") ||
          tableError.code === "PGRST116"
        ) {
          missingTables.push(table);
        } else {
          // Unexpected DB error
          dbError = `Error checking table '${table}': ${tableError.message}`;
          break;
        }
      } else {
        tablesChecked.push(table);
      }
    }

    if (dbError) {
      return {
        ok: false,
        error: dbError,
        tablesChecked,
        missingTables,
      };
    }

    return {
      ok: missingTables.length === 0,
      tablesChecked,
      missingTables,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      tablesChecked: [],
      missingTables: CRITICAL_TABLES.slice(),
    };
  }
}

/**
 * Checks Stripe configuration.
 */
export function checkStripe(): StripeCheckResult {
  let env;
  try {
    env = getEnv();
  } catch {
    // If getEnv() fails, Stripe is effectively "not configured" (optional)
    return {
      ok: true,
      missingEnv: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      priceIdsConfigured: Object.keys(STRIPE_PLAN_MAP).length,
    };
  }

  const envRecord = env as Record<string, unknown>;
  const missingEnv: string[] = [];

  const stripeSecretKey = envRecord.STRIPE_SECRET_KEY as string | undefined;
  const stripeWebhookSecret = envRecord.STRIPE_WEBHOOK_SECRET as string | undefined;

  if (!stripeSecretKey) {
    missingEnv.push("STRIPE_SECRET_KEY");
  }
  if (!stripeWebhookSecret) {
    missingEnv.push("STRIPE_WEBHOOK_SECRET");
  }

  // Verify Stripe key format (basic validation without network call)
  let keyValid = false;
  if (stripeSecretKey) {
    try {
      if (stripeSecretKey.startsWith("sk_")) {
        new Stripe(stripeSecretKey, {
          apiVersion: "2025-10-29.clover",
        });
        keyValid = true;
      }
    } catch {
      // Invalid key format – fall through with keyValid = false
    }
  }

  const priceIdsConfigured = Object.keys(STRIPE_PLAN_MAP).length;

  // Stripe is OK if:
  // 1. All env vars present and key is valid, OR
  // 2. Stripe is not configured at all (secret key missing)
  const ok = missingEnv.length === 0 && (keyValid || !stripeSecretKey);

  return {
    ok,
    missingEnv,
    priceIdsConfigured,
  };
}

/**
 * Checks Sentry configuration.
 */
export function checkSentry(): SentryCheckResult {
  let env;
  try {
    env = getEnv();
  } catch {
    // If getEnv() fails, Sentry is treated as "not configured" (optional)
    return {
      ok: true,
      missingEnv: ["SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN"],
    };
  }

  const envRecord = env as Record<string, unknown>;
  const missingEnv: string[] = [];

  const sentryDsn = envRecord.SENTRY_DSN as string | undefined;
  const publicSentryDsn = envRecord.NEXT_PUBLIC_SENTRY_DSN as string | undefined;

  if (!sentryDsn && !publicSentryDsn) {
    missingEnv.push("SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN");
  }

  return {
    ok: true,
    missingEnv,
  };
}

// ─────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────

/**
 * Builds a comprehensive backend readiness report.
 *
 * @param options.includeWorkerEnv  Whether to include worker environment checks
 * @param options.workerStatus      Pre-computed worker status (from engine surface)
 */
export async function buildBackendReadinessReport(options?: {
  includeWorkerEnv?: boolean;
  workerStatus?: WorkerEnvStatus;
}): Promise<BackendReadinessReport> {
  const { includeWorkerEnv = false, workerStatus: providedWorkerStatus } =
    options ?? {};

  // Core checks
  const envCheck = checkEnvironment();
  const workerStatus = includeWorkerEnv ? providedWorkerStatus : undefined;
  const dbCheck = await checkDatabase();
  const stripeCheck = checkStripe();
  const sentryCheck = checkSentry();

  const checks: BackendReadinessChecks = {
    env: envCheck,
    db: dbCheck,
    stripe: stripeCheck,
    sentry: sentryCheck,
    worker: workerStatus,
  };

  const ok =
    envCheck.ok &&
    dbCheck.ok &&
    stripeCheck.ok &&
    sentryCheck.ok &&
    (workerStatus === undefined || workerStatus.ok);

  return {
    ok,
    env: envCheck,
    worker: workerStatus,
    db: dbCheck,
    stripe: stripeCheck,
    sentry: sentryCheck,
    checks,
    // Queue / ffmpeg fields can be filled by higher-level engine health helpers.
    queue: undefined,
    ffmpeg: undefined,
  };
}
