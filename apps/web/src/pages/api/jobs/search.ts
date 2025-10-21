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

function toSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log("✅ /api/jobs/search hit");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (!hasServiceRoleAccess(req)) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  const workspaceId = toSingleValue(req.query.workspace_id);
  if (!workspaceId) {
    return res.status(400).json({ ok: false, error: "MISSING_WORKSPACE_ID" });
  }

  const limitParam = toSingleValue(req.query.limit);
  const offsetParam = toSingleValue(req.query.offset);

  const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;
  const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ ok: false, error: "INVALID_LIMIT" });
  }

  if (!Number.isFinite(offset) || offset < 0) {
    return res.status(400).json({ ok: false, error: "INVALID_OFFSET" });
  }

  const rangeStart = offset;
  const rangeEnd = offset + limit - 1;

  try {
    const { data, error, count } = await client
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(rangeStart, rangeEnd);

    if (error) {
      const message = error.message ?? "SUPABASE_ERROR";
      return res.status(500).json({ ok: false, error: message });
    }

    return res
      .status(200)
      .json({ ok: true, data: data ?? [], count: typeof count === "number" ? count : 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return res.status(500).json({ ok: false, error: message });
  }
}
