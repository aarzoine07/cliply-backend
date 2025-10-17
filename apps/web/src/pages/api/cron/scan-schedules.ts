import type { NextApiRequest, NextApiResponse } from "next";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

import { captureException } from "@/lib/sentry";

const env = getEnv();

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for cron route.");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" },
    });
    return;
  }

  try {
    // TODO: In v2, query schedules table where run_at <= now() and enqueue PUBLISH_TIKTOK jobs.

    logger.info(
      "cron_scan_schedules_stub",
      { service: "api", route: "/api/cron/scan-schedules" },
      { message: "Stub executed successfully", enqueued: 0 },
    );

    res.status(200).json({ ok: true, enqueued: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron scan failed";

    captureException(error, {
      route: "/api/cron/scan-schedules",
    });

    logger.error(
      "cron_scan_schedules_error",
      { service: "api", route: "/api/cron/scan-schedules" },
      { error: message },
    );

    res.status(500).json({
      ok: false,
      error: { code: "CRON_SCAN_FAILED", message },
    });
  }
}
