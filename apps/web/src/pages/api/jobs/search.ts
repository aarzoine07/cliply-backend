import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

import { captureException } from "@/lib/sentry";

const env = getEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY is not configured");
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry) continue;
      const trimmed = entry.trim();
      if (trimmed) return trimmed;
    }
    return undefined;
  }

  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractAccessToken(req: NextApiRequest): string | null {
  const headerToken = firstHeaderValue(req.headers.authorization);
  if (headerToken) {
    const [scheme, token] = headerToken.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const cookieToken = firstHeaderValue(req.cookies["sb-access-token"] ?? req.cookies["sb_token"]);
  if (cookieToken) {
    return cookieToken;
  }

  const supabaseAuthToken = req.cookies["supabase-auth-token"];
  if (supabaseAuthToken) {
    try {
      const decoded = decodeURIComponent(supabaseAuthToken);
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed[0];
      }
    } catch {
      // ignore malformed cookie payloads
    }
  }

  return null;
}

const ISO_DATE_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3,})?Z$/;

function isValidIso(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function buildError(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json(buildError("METHOD_NOT_ALLOWED", "Use GET"));
    return;
  }

  const accessToken = extractAccessToken(req);

  if (!accessToken) {
    res.status(401).json(buildError("UNAUTHORIZED", "Invalid or missing session"));
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    logger.warn("jobs_search_unauthorized", undefined, {
      reason: authError?.message ?? "no_user",
    });
    res.status(401).json(buildError("UNAUTHORIZED", "Invalid or missing session"));
    return;
  }

  const workspaceId =
    (user.app_metadata?.workspace_id as string | undefined) ??
    (user.app_metadata?.active_workspace_id as string | undefined) ??
    (user.user_metadata?.workspace_id as string | undefined) ??
    (user.user_metadata?.active_workspace_id as string | undefined) ??
    ((user as unknown as Record<string, unknown>)["workspace_id"] as string | undefined);

  if (!workspaceId) {
    logger.warn("jobs_search_missing_workspace", { user_id: user.id });
    res
      .status(403)
      .json(buildError("WORKSPACE_CLAIM_MISSING", "Workspace claim missing from session"));
    return;
  }

  const { state, kind, from, to, limit = "25", cursor } = req.query;

  const parsedLimit = Number(limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    res.status(400).json(buildError("INVALID_LIMIT", "Limit must be between 1 and 100"));
    return;
  }

  const filters: Array<(query: ReturnType<typeof supabase.from>) => typeof query> = [];

  if (state && typeof state === "string") {
    filters.push((query) => query.eq("state", state));
  }

  if (kind && typeof kind === "string") {
    filters.push((query) => query.eq("kind", kind));
  }

  if (from && typeof from === "string") {
    if (!isValidIso(from)) {
      res.status(400).json(buildError("INVALID_FROM", "Parameter 'from' must be an ISO timestamp"));
      return;
    }
    filters.push((query) => query.gte("created_at", from));
  }

  if (to && typeof to === "string") {
    if (!isValidIso(to)) {
      res.status(400).json(buildError("INVALID_TO", "Parameter 'to' must be an ISO timestamp"));
      return;
    }
    filters.push((query) => query.lte("created_at", to));
  }

  if (cursor && typeof cursor === "string") {
    if (!isValidIso(cursor)) {
      res
        .status(400)
        .json(buildError("INVALID_CURSOR", "Cursor must be an ISO timestamp"));
      return;
    }
    filters.push((query) => query.lt("created_at", cursor));
  }

  try {
    let query = supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(parsedLimit);

    for (const apply of filters) {
      query = apply(query);
    }

    const { data: jobs, error: jobsError } = await query;
    if (jobsError) {
      throw jobsError;
    }

    const nextCursor =
      jobs && jobs.length === parsedLimit ? jobs[jobs.length - 1]?.created_at ?? null : null;

    logger.info(
      "jobs_search_success",
      { workspace_id: workspaceId, user_id: user.id },
      {
        count: jobs?.length ?? 0,
        next_cursor: nextCursor,
      },
    );

    res.status(200).json({
      ok: true,
      jobs: jobs ?? [],
      nextCursor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search jobs";

    captureException(error, {
      route: "/api/jobs/search",
      workspaceId,
      userId: user.id,
    });

    logger.error(
      "jobs_search_failed",
      { workspace_id: workspaceId, user_id: user.id },
      { error: message },
    );

    res
      .status(500)
      .json(buildError("JOBS_SEARCH_FAILED", message));
  }
}
