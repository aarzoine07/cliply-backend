import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { getEnv } from "@cliply/shared/env";
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
    // Try to extract which specific vars are missing from the error message
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

  // Check if the returned env object has all required keys
  // Handle both real Env objects and mocked objects from tests
  const missing: string[] = [];
  for (const key of REQUIRED_ENV_VARS) {
    // Use bracket notation to access potentially missing keys
    const value = (env as Record<string, unknown>)[key];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      missing.push(key);
    }
  }

  const optionalMissing: string[] = [];
  for (const key of OPTIONAL_ENV_VARS) {
    const value = (env as Record<string, unknown>)[key];
    if (!value || (typeof value === 'string' && value.trim() === '')) {
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

  // Handle both real Env objects and mocked objects from tests
  const envRecord = env as Record<string, unknown>;
  const supabaseUrl = envRecord.SUPABASE_URL as string | undefined;
  const supabaseServiceRoleKey = envRecord.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

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
  let env;
  try {
    env = getEnv();
  } catch {
    // If getEnv() fails, Stripe is not configured
    return {
      ok: true, // Stripe is optional
      missingEnv: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      priceIdsConfigured: Object.keys(STRIPE_PLAN_MAP).length,
    };
  }

  // Handle both real Env objects and mocked objects from tests
  const envRecord = env as Record<string, unknown>;
  const missingEnv: string[] = [];

  // Check for required Stripe env vars (if billing is enabled)
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
      // Stripe keys start with sk_ for secret keys
      if (stripeSecretKey.startsWith("sk_")) {
        // Try to instantiate Stripe client (no network call)
        new Stripe(stripeSecretKey, {
          apiVersion: "2025-10-29.clover",
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
function checkSentry(): {
  ok: boolean;
  missingEnv: string[];
} {
  let env;
  try {
    env = getEnv();
  } catch {
    // If getEnv() fails, Sentry is not configured (optional)
    return {
      ok: true,
      missingEnv: ["SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN"],
    };
  }

  // Handle both real Env objects and mocked objects from tests
  const envRecord = env as Record<string, unknown>;
  const missingEnv: string[] = [];

  // Sentry is optional, but log if DSNs are missing
  const sentryDsn = envRecord.SENTRY_DSN as string | undefined;
  const publicSentryDsn = envRecord.NEXT_PUBLIC_SENTRY_DSN as string | undefined;
  
  if (!sentryDsn && !publicSentryDsn) {
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

