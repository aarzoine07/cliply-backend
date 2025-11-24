import type { NextApiRequest, NextApiResponse } from "next";

import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

/**
 * Admin readiness endpoint that performs lightweight backend health checks.
 * Returns 200 if all checks pass, 503 if any critical check fails.
 * Does not include worker environment checks (no child_process calls).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    // Build readiness report without worker env checks (lighter, no child_process)
    const report = await buildBackendReadinessReport({
      includeWorkerEnv: false,
    });

    // Return 200 if OK, 503 if not OK (but still return the report)
    const statusCode = report.ok ? 200 : 503;

    res.status(statusCode).json(report);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      ok: false,
      fatal: true,
      error: errorMessage,
    });
  }
}

