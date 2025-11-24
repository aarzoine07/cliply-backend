#!/usr/bin/env node

/**
 * Worker readiness check script
 * Exits with code 0 if ready, 1 if not ready
 * Can be invoked via: pnpm -C apps/worker readyz
 */

import { createClient } from "@supabase/supabase-js";
import { checkEnvForWorker, checkSupabaseConnection } from "@cliply/shared/health/readyChecks";
import { getEnv } from "@cliply/shared/env";

interface ReadinessResult {
  ok: boolean;
  service: "worker";
  checks: Record<string, boolean>;
  errors?: Record<string, string>;
  ts: string;
}

async function checkReadiness(): Promise<ReadinessResult> {
  const checks: Record<string, boolean> = {};
  const errors: Record<string, string> = {};
  let allReady = true;

  // Check environment variables
  const envCheck = checkEnvForWorker();
  checks.env = envCheck.ok;
  if (!envCheck.ok) {
    allReady = false;
    errors.env = `Missing: ${envCheck.missing?.join(", ") || "unknown"}`;
  }

  // Check Supabase connection
  if (envCheck.ok) {
    try {
      const env = getEnv();
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const dbCheck = await checkSupabaseConnection(supabase, { timeoutMs: 5000, skipInTest: true });
      checks.db = dbCheck.ok;
      if (!dbCheck.ok) {
        allReady = false;
        errors.db = dbCheck.error || "connection_failed";
      }

      // Optional: Check if we can read from jobs table
      if (dbCheck.ok) {
        try {
          const { error } = await supabase.from("jobs").select("id").limit(1);
          checks.queue = !error;
          if (error) {
            allReady = false;
            errors.queue = error.message || "queue_read_failed";
          }
        } catch (err: unknown) {
          checks.queue = false;
          allReady = false;
          errors.queue = err instanceof Error ? err.message : String(err);
        }
      } else {
        checks.queue = false;
      }
    } catch (err: unknown) {
      checks.db = false;
      checks.queue = false;
      allReady = false;
      errors.db = err instanceof Error ? err.message : String(err);
    }
  } else {
    checks.db = false;
    checks.queue = false;
  }

  return {
    ok: allReady,
    service: "worker",
    checks,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
    ts: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  try {
    const result = await checkReadiness();

    // Log JSON summary (for parsing by orchestrators)
    console.log(JSON.stringify(result, null, 2));

    // Exit with appropriate code
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const errorResult: ReadinessResult = {
      ok: false,
      service: "worker",
      checks: { env: false, db: false, queue: false },
      errors: { fatal: error instanceof Error ? error.message : String(error) },
      ts: new Date().toISOString(),
    };

    console.error(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

// Run if called directly (tsx/node execution)
void main();

