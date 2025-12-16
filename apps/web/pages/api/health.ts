import type { NextApiRequest, NextApiResponse } from "next";

import { setDeprecationHeaders } from "@/lib/readiness/deprecationHeaders";

/**
 * Legacy stub health endpoint.
 * 
 * @deprecated Use /api/healthz for liveness checks or /api/readyz for readiness checks.
 * This endpoint will be removed on 2026-03-01.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Set deprecation headers pointing to canonical liveness endpoint
  setDeprecationHeaders(res, "/api/healthz");

  return res.status(200).json({ ok: true, message: "Cliply backend healthy" });
}
