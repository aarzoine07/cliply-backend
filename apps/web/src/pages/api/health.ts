import type { NextApiRequest, NextApiResponse } from "next";
import { getEnv } from "@cliply/shared/env";
import { logJSON } from "../../../../../packages/shared/logger";
import { pgCheck } from "../../lib/supabase";

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();
  try {
    const env = getEnv();
    const db = await pgCheck();
    const body = {
      ok: true,
      service: "api",
      env: env.NODE_ENV,
      uptime_ms: Math.floor(process.uptime() * 1000),
      db: db.ok ? "ok" : "error",
      ...(db.ok ? { db_name: db.db } : { db_error: db.error }),
    };
    logJSON({ service: "api", route: "/api/health", result: body.db, ms: Date.now() - t0 });
    res.status(200).json(body);
  } catch (e: any) {
    const body = {
      ok: true,
      service: "api",
      env: process.env.NODE_ENV ?? "development",
      uptime_ms: Math.floor(process.uptime() * 1000),
      db: "error",
      db_error: e?.message ?? "env_or_db_error",
    };
    logJSON({ service: "api", route: "/api/health", result: "error", ms: Date.now() - t0 });
    res.status(200).json(body);
  }
}

