import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import { getAdminClient } from "@/lib/supabase";

/**
 * Admin/SRE-focused detailed readiness endpoint.
 * Returns full readiness object with checks, queue, ffmpeg status, and timestamp.
 * 
 * - 200: All checks pass
 * - 503: One or more critical checks failed
 * - 500: Unexpected internal error
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    console.log("admin_readyz_check", {
      ok: readiness.ok,
      checks: readiness.checks,
      queue: readiness.queue,
      ffmpeg: readiness.ffmpeg,
    });

    const statusCode = readiness.ok ? 200 : 503;

    // Return structured readiness response with timestamp for admin
    res.status(statusCode).json({
      ok: readiness.ok,
      checks: readiness.checks,
      queue: readiness.queue,
      ffmpeg: readiness.ffmpeg,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("admin_readyz_check_error", error instanceof Error ? error.message : error);
    res.status(500).json({
      ok: false,
      error: { message: "internal_error" },
    });
  }
}
