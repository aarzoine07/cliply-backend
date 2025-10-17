import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

import { captureException } from "@/lib/sentry";

const env = getEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { error: pingError } = await supabase.from("jobs").select("id").limit(1);
    if (pingError) {
      throw pingError;
    }

    const now = new Date();
    const heartbeatCutoff = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

    const { count: activeWorkers, error: heartbeatError } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("state", "running")
      .gte("heartbeat_at", heartbeatCutoff);

    if (heartbeatError) {
      throw heartbeatError;
    }

    const payload = {
      ok: true,
      ts: now.toISOString(),
      db: "ok" as const,
      activeWorkers: activeWorkers ?? 0,
    };

    logger.info(
      "analytics_health_success",
      { service: "api", route: "/api/analytics/health" },
      { active_workers: payload.activeWorkers },
    );

    res.status(200).json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";

    captureException(error, {
      route: "/api/analytics/health",
    });

    logger.error(
      "analytics_health_failed",
      { service: "api", route: "/api/analytics/health" },
      { error: message },
    );

    res.status(500).json({
      ok: false,
      error: { code: "HEALTH_CHECK_FAILED", message },
    });
  }
}
