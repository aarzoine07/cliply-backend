// @ts-nocheck
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hasServiceRoleAccess(req: NextApiRequest) {
  const headerValue = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!headerValue) return false;

  const [scheme, token] = headerValue.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token === SERVICE_ROLE_KEY;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("✅ /api/jobs/[id] hit");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!hasServiceRoleAccess(req)) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  const jobIdParam = req.query.id;
  const jobId = Array.isArray(jobIdParam) ? jobIdParam[0] : jobIdParam;

  if (!jobId || typeof jobId !== "string") {
    return res.status(400).json({ ok: false, error: "INVALID_ID" });
  }

  try {
    const { data, error } = await client
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (error) {
      const message = error.message ?? "SUPABASE_ERROR";
      return res.status(500).json({ ok: false, error: message });
    }

    if (!data) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    return res.status(200).json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return res.status(500).json({ ok: false, error: message });
  }
}
