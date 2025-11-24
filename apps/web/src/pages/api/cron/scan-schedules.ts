import type { NextApiRequest, NextApiResponse } from "next";

import { getAdminClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { scanSchedules } from "@/lib/cron/scanSchedules";
import { serverEnv } from "@/lib/env";

function isAuthorizedCronRequest(req: NextApiRequest): boolean {
  // Vercel Cron Jobs send Authorization: Bearer <CRON_SECRET>
  const cronSecret = serverEnv.CRON_SECRET;
  if (cronSecret) {
    const headerValue = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    if (headerValue) {
      const [scheme, token] = headerValue.split(/\s+/, 2);
      if (scheme?.toLowerCase() === "bearer" && token === cronSecret) {
        return true;
      }
    }
  }

  // Alternative: Check X-CRON-SECRET header if provided
  const cronSecretHeader = serverEnv.CRON_SECRET;
  if (cronSecretHeader) {
    const headerValue = Array.isArray(req.headers["x-cron-secret"])
      ? req.headers["x-cron-secret"][0]
      : req.headers["x-cron-secret"];
    if (headerValue && headerValue === cronSecretHeader) {
      return true;
    }
  }

  // Fallback: Service role key for testing (optional)
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    const headerValue = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    if (headerValue) {
      const [scheme, token] = headerValue.split(/\s+/, 2);
      if (scheme?.toLowerCase() === "bearer" && token === serviceRoleKey) {
        return true;
      }
    }
  }

  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!isAuthorizedCronRequest(req)) {
    logger.warn("cron_scan_schedules_unauthorized", {
      headers: Object.keys(req.headers),
    });
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  try {
    const supabase = getAdminClient();
    const result = await scanSchedules(supabase);

    logger.info("cron_scan_schedules_success", {
      scanned: result.scanned,
      claimed: result.claimed,
      enqueued: result.enqueued,
      enqueued_tiktok: result.enqueued_tiktok,
      enqueued_youtube: result.enqueued_youtube,
      skipped: result.skipped,
      failed: result.failed,
      durationMs: Date.now() - startTime,
    });

    return res.status(200).json({
      ok: true,
      scanned: result.scanned,
      claimed: result.claimed,
      enqueued: result.enqueued,
      enqueued_tiktok: result.enqueued_tiktok,
      enqueued_youtube: result.enqueued_youtube,
      skipped: result.skipped,
      failed: result.failed,
    });
  } catch (error) {
    logger.error("cron_scan_schedules_error", {
      error: (error as Error)?.message ?? "unknown",
      stack: (error as Error)?.stack,
      durationMs: Date.now() - startTime,
    });

    return res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "Failed to scan schedules",
    });
  }
}
