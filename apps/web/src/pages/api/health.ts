import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";
import { setDeprecationHeaders } from "@/lib/readiness/deprecationHeaders";

/**
 * Lightweight health indicator endpoint.
 * 
 * @deprecated Use /api/healthz for liveness checks or /api/readyz for readiness checks.
 * This endpoint will be removed on 2026-03-01.
 * 
 * Returns only { ok: boolean } without exposing queue/ffmpeg details.
 * 
 * - 200: Service is healthy
 * - 503: Service is unhealthy
 * - 500: Unexpected internal error
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  // Set deprecation headers pointing to canonical liveness endpoint
  setDeprecationHeaders(res, "/api/healthz");

  try {
    const readiness = await buildBackendReadinessReport();

    console.log("health_check", { ok: readiness.ok });

    const statusCode = readiness.ok ? 200 : 503;
    res.status(statusCode).json({ ok: readiness.ok });
  } catch (error) {
    console.error("health_check_error", error instanceof Error ? error.message : error);
    res.status(500).json({
      ok: false,
      error: { message: "internal_error" },
    });
  }
}
