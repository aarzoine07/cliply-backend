import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import type { AdminReadyzResponse, HealthErrorResponse } from "@cliply/shared/types/health";
import { getAdminClient } from "@/lib/supabase";
import { mapToAdminReadyzResponse } from "@/lib/readiness/canonicalResponses";

/**
 * Admin/SRE-focused detailed readiness endpoint.
 * Returns canonical readiness response with checks, queue, ffmpeg status, and timestamp.
 * 
 * - 200: All checks pass
 * - 503: One or more critical checks failed
 * - 500: Unexpected internal error
 * - 405: Method not allowed (non-GET requests)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<AdminReadyzResponse | HealthErrorResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: { message: "method_not_allowed" } });
    return;
  }

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

    // Map to canonical admin readiness response shape (includes timestamp)
    const response = mapToAdminReadyzResponse(readiness);

    console.log("admin_readyz_check", {
      ok: response.ok,
      checks: response.checks,
      queue: response.queue,
      ffmpeg: response.ffmpeg,
      timestamp: response.timestamp,
    });

    const statusCode = readiness.ok ? 200 : 503;

    // Return canonical admin readiness response
    res.status(statusCode).json(response);
  } catch (error) {
    console.error("admin_readyz_check_error", error instanceof Error ? error.message : error);
    res.status(500).json({
      ok: false,
      error: { message: "internal_error" },
    });
  }
}
