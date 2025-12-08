import type { NextApiRequest, NextApiResponse } from "next";

import { checkEnvForApi, checkSupabaseConnection } from "@cliply/shared/health/readyChecks.js";
import { getAdminClient } from "@/lib/supabase";

/**
 * Readiness check endpoint
 * Returns 200 if all critical dependencies are ready
 * Returns 503 if any dependency is not ready
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const checks: Record<string, boolean> = {};
  const errors: Record<string, string> = {};
  let allReady = true;

  // Check environment variables
  const envCheck = checkEnvForApi();
  checks.env = envCheck.ok;
  if (!envCheck.ok) {
    allReady = false;
    errors.env = `Missing: ${envCheck.missing?.join(", ") || "unknown"}`;
  }

  // Check Supabase connection
  try {
    const supabase = getAdminClient();
    const dbCheck = await checkSupabaseConnection(supabase, { timeoutMs: 3000, skipInTest: true });
    checks.db = dbCheck.ok;
    if (!dbCheck.ok) {
      allReady = false;
      errors.db = dbCheck.error || "connection_failed";
    }
  } catch (err: unknown) {
    checks.db = false;
    allReady = false;
    errors.db = err instanceof Error ? err.message : String(err);
  }

  const body = {
    ok: allReady,
    service: "api",
    checks,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
    ts: new Date().toISOString(),
  };

  res.status(allReady ? 200 : 503).json(body);
}

