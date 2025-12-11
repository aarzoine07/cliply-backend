import type { NextApiRequest, NextApiResponse } from "next";

import { getAdminClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { scanSchedules } from "@/lib/cron/scanSchedules";
import { serverEnv } from "@/lib/env";

function isAuthorizedCronRequest(req: NextApiRequest): boolean {
  // Get secrets from environment
  const cronSecret = serverEnv.CRON_SECRET;
  const bypassSecret = serverEnv.VERCEL_AUTOMATION_BYPASS_SECRET;

  // Extract provided secret from header, query param, or Bearer token
  let providedSecret: string | null = null;

  // 1) Check X-CRON-SECRET header
  const headerSecret = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : req.headers["x-cron-secret"];
  if (headerSecret) {
    providedSecret = headerSecret as string;
  }

  // 2) Check query parameter (`?secret=...`)
  if (!providedSecret) {
    let querySecret: string | null = null;

    // Normal Next.js case: req.query is populated
    const rawQuerySecret =
      typeof req.query === "object" && req.query
        ? // @ts-expect-error - Next's query typing is loose
          (req.query.secret as string | string[] | undefined)
        : undefined;

    if (Array.isArray(rawQuerySecret)) {
      querySecret = rawQuerySecret[0] ?? null;
    } else if (typeof rawQuerySecret === "string") {
      querySecret = rawQuerySecret;
    }

    // Test / non-Next fallback: parse from req.url if query object is missing
    if (!querySecret && req.url) {
      try {
        const url = new URL(
          req.url,
          req.url.startsWith("http") ? undefined : "http://localhost",
        );
        const fromUrl = url.searchParams.get("secret");
        if (fromUrl) {
          querySecret = fromUrl;
        }
      } catch {
        // ignore URL parse errors, we'll just fall through
      }
    }

    if (querySecret) {
      providedSecret = querySecret;
    }
  }

  // 3) Check Bearer token in Authorization header
  if (!providedSecret) {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    if (authHeader) {
      const [scheme, token] = authHeader.split(/\s+/, 2);
      if (scheme?.toLowerCase() === "bearer" && token) {
        providedSecret = token;
      }
    }
  }

  if (!providedSecret) {
    return false;
  }

  // Check against CRON_SECRET
  if (cronSecret && providedSecret === cronSecret) {
    return true;
  }

  // Check against VERCEL_AUTOMATION_BYPASS_SECRET
  if (bypassSecret && providedSecret === bypassSecret) {
    return true;
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

