import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getEnv } from "../env";
import { STRIPE_PLAN_MAP } from "../../billing/stripePlanMap";

// WorkerEnvStatus type (duplicated to avoid circular dependency)
export type WorkerEnvStatus = {
  ok: boolean;
  ffmpegOk: boolean;
  ytDlpOk: boolean;
  missingEnv: string[];
};

export type BackendReadinessReport = {
  ok: boolean;
  env: {
    ok: boolean;
    missing: string[];
    optionalMissing: string[];
  };
  worker?: WorkerEnvStatus;
  db: {
    ok: boolean;
    error?: string;
    tablesChecked: string[];
    missingTables: string[];
  };
  stripe: {
    ok: boolean;
    missingEnv: string[];
    priceIdsConfigured: number;
  };
  sentry: {
    ok: boolean;
    missingEnv: string[];
  };
};

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

/**
 * Checks environment variables and returns missing required and optional ones.
 */
function checkEnvironment(): {
  ok: boolean;
  missing: string[];
  optionalMissing: string[];
} {
  let env;
  try {
    env = getEnv();
  } catch (error) {
    // If getEnv() throws, it means required vars are missing
    return {
      ok: false,
      missing: REQUIRED_ENV_VARS.slice(),
      optionalMissing: [],
    };
  }

  const missing: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  const optionalMissing: string[] = [];
  for (const key of OPTIONAL_ENV_VARS) {
    if (!env[key]) {
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
async function checkDatabase(): Promise<{
  ok: boolean;
  error?: string;
  tablesChecked: string[];
  missingTables: string[];
}> {
  const env = getEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      error: "Missing Supabase credentials",
      tablesChecked: [],
      missingTables: CRITICAL_TABLES.slice(),
    };
  }

  try {
    // Create Supabase client with service role key (bypasses RLS)
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
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
      const { error: tableError } = await supabase.from(table).select("id").limit(1);
      
      if (tableError) {
        // Check if table doesn't exist
        if (
          tableError.message?.includes("does not exist") ||
          tableError.message?.includes("relation") ||
          tableError.code === "PGRST116"
        ) {
          missingTables.push(table);
        } else {
          // Permission errors or other critical errors should stop the check
          // With service role key, we shouldn't get permission errors, so this is unexpected
          dbError = `Error checking table '${table}': ${tableError.message}`;
          break;
        }
      } else {
        // Query succeeded - table exists and is accessible
        tablesChecked.push(table);
      }
    }

    // If we encountered a critical error, return early
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
function checkStripe(): {
  ok: boolean;
  missingEnv: string[];
  priceIdsConfigured: number;
} {
  const env = getEnv();
  const missingEnv: string[] = [];

  // Check for required Stripe env vars (if billing is enabled)
  if (!env.STRIPE_SECRET_KEY) {
    missingEnv.push("STRIPE_SECRET_KEY");
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    missingEnv.push("STRIPE_WEBHOOK_SECRET");
  }

  // Verify Stripe key format (basic validation without network call)
  let keyValid = false;
  if (env.STRIPE_SECRET_KEY) {
    try {
      // Stripe keys start with sk_ for secret keys
      if (env.STRIPE_SECRET_KEY.startsWith("sk_")) {
        // Try to instantiate Stripe client (no network call)
        new Stripe(env.STRIPE_SECRET_KEY, {
          apiVersion: "2023-10-16",
        });
        keyValid = true;
      }
    } catch {
      // Invalid key format
    }
  }

  const priceIdsConfigured = Object.keys(STRIPE_PLAN_MAP).length;

  // Stripe is OK if:
  // 1. All env vars present and key is valid, OR
  // 2. Stripe is not configured at all (all optional for basic functionality)
  // If STRIPE_SECRET_KEY is provided, it must be valid
  const ok = missingEnv.length === 0 && (keyValid || !env.STRIPE_SECRET_KEY);

  return {
    ok,
    missingEnv,
    priceIdsConfigured,
  };
}

/**
 * Checks Sentry configuration.
 */
function checkSentry(): {
  ok: boolean;
  missingEnv: string[];
} {
  const env = getEnv();
  const missingEnv: string[] = [];

  // Sentry is optional, but log if DSNs are missing
  if (!env.SENTRY_DSN && !env.NEXT_PUBLIC_SENTRY_DSN) {
    missingEnv.push("SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN");
  }

  // Sentry is always OK (it's optional)
  return {
    ok: true,
    missingEnv,
  };
}

/**
 * Builds a comprehensive backend readiness report.
 *
 * @param options Configuration options
 * @param options.includeWorkerEnv Whether to include worker environment checks (requires child_process calls)
 * @param options.workerStatus Optional pre-computed worker status (to avoid importing worker code in shared package)
 * @returns Readiness report with all checks
 */
export async function buildBackendReadinessReport(options?: {
  includeWorkerEnv?: boolean;
  workerStatus?: WorkerEnvStatus;
}): Promise<BackendReadinessReport> {
  const { includeWorkerEnv = false, workerStatus: providedWorkerStatus } = options ?? {};

  // Check environment
  const envCheck = checkEnvironment();

  // Use provided worker status or leave undefined
  const workerStatus = includeWorkerEnv ? providedWorkerStatus : undefined;

  // Check database
  const dbCheck = await checkDatabase();

  // Check Stripe
  const stripeCheck = checkStripe();

  // Check Sentry
  const sentryCheck = checkSentry();

  // Overall status: OK only if all critical checks pass
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
  };
}

