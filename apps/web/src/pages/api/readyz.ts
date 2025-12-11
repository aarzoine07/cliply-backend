import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import { getAdminClient } from "@/lib/supabase";

/**
 * Main public readiness endpoint.
 * Returns full readiness object with checks, queue, and ffmpeg status.
 * 
 * - 200: All checks pass
 * - 503: One or more critical checks failed
 * - 500: Unexpected internal error
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get Supabase client for queue metrics
    let supabaseClient;
    try {
      supabaseClient = getAdminClient();
    } catch {
      // If Supabase client creation fails, continue without queue metrics
      supabaseClient = undefined;
    }

    const readiness = await buildBackendReadinessReport({
      includeDetailedHealth: true,
      supabaseClient,
    });

    console.log("readyz_check", {
      ok: readiness.ok,
      checks: readiness.checks,
      queue: readiness.queue,
      ffmpeg: readiness.ffmpeg,
    });

    const statusCode = readiness.ok ? 200 : 503;

    // Return structured readiness response
    res.status(statusCode).json({
      ok: readiness.ok,
      checks: readiness.checks,
      queue: readiness.queue,
      ffmpeg: readiness.ffmpeg,
    });
  } catch (error) {
    console.error("readyz_check_error", error instanceof Error ? error.message : error);
    res.status(500).json({
      ok: false,
      error: { message: "internal_error" },
    });
  }
}
