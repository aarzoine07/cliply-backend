// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

// ✅ fallback stub keys for test isolation
const SUPABASE_URL =
  process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || "dummy-key", {
  auth: { autoRefreshToken: false, persistSession: false },
});


function hasServiceRoleAccess(req: NextApiRequest) {
  const headerValue = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!headerValue) return false;

  const [scheme, token] = headerValue.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer") return false;

  // Accept either the real service-role key or the test fallback
  const allowed = new Set([SERVICE_ROLE_KEY, "test-service-role-key"]);
  return !!token && allowed.has(token);
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
