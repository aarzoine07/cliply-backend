// @ts-nocheck
import { createClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";

// ✅ Load env dynamically at runtime to match Vitest timing
const getEnv = () => ({
  SUPABASE_URL: process.env.SUPABASE_URL || "http://127.0.0.1:54321",
  SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz",
});

function hasServiceRoleAccess(req: NextApiRequest) {
  const { SERVICE_ROLE_KEY } = getEnv();
  const headerValue = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (!headerValue) return false;

  const [scheme, token] = headerValue.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === SERVICE_ROLE_KEY;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { SUPABASE_URL, SERVICE_ROLE_KEY } = getEnv();
  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("✅ /api/cron/scan-schedules hit");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!hasServiceRoleAccess(req)) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }

  // Stubbed cron logic
  return res.status(200).json({ ok: true, message: "Scan initiated (stub)" });
}
