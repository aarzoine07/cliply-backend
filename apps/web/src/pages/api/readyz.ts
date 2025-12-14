import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import { getAdminClient } from "@/lib/supabase";
import { mapToReadyzResponse } from "@/lib/readiness/canonicalResponses";

/**
 * Main public readiness endpoint.
 * Returns canonical readiness response with checks, queue, and ffmpeg status.
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

    // Map to canonical response shape
    const response = mapToReadyzResponse(readiness);

    console.log("readyz_check", {
      ok: response.ok,
      checks: response.checks,
      queue: response.queue,
      ffmpeg: response.ffmpeg,
    });

    const statusCode = readiness.ok ? 200 : 503;

    // Return canonical readiness response
    res.status(statusCode).json(response);
  } catch (error) {
    console.error("readyz_check_error", error instanceof Error ? error.message : error);
    res.status(500).json({
      ok: false,
      error: { message: "internal_error" },
    });
  }
}
