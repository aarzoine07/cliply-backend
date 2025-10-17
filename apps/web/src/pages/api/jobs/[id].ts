import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type User } from "@supabase/supabase-js";

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
  const authorization = firstHeaderValue(req.headers.authorization);
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const cookieToken = firstHeaderValue(req.cookies["sb-access-token"] ?? req.cookies["sb_token"]);
  if (cookieToken) {
    return cookieToken;
  }

  const supabaseAuthCookie = req.cookies["supabase-auth-token"];
  if (supabaseAuthCookie) {
    try {
      const decoded = decodeURIComponent(supabaseAuthCookie);
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed[0];
      }
    } catch {
      // Ignore malformed cookie payloads
    }
  }

  return null;
}

function extractWorkspaceIdFromUser(user: User | null): string | null {
  if (!user) return null;

  const candidates: Array<unknown> = [
    user.app_metadata?.workspace_id,
    user.app_metadata?.active_workspace_id,
    user.user_metadata?.workspace_id,
    user.user_metadata?.active_workspace_id,
    (user as unknown as Record<string, unknown>)["workspace_id"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
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

  const jobIdParam = req.query.id;
  const jobId = Array.isArray(jobIdParam) ? jobIdParam[0] : jobIdParam;

  if (!jobId || typeof jobId !== "string") {
    res
      .status(400)
      .json(buildError("INVALID_JOB_ID", "Missing or invalid job id"));
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
    logger.warn("jobs_fetch_unauthorized", undefined, {
      reason: authError?.message ?? "no_user",
    });
    res.status(401).json(buildError("UNAUTHORIZED", "Invalid or missing session"));
    return;
  }

  const workspaceId = extractWorkspaceIdFromUser(user);
  if (!workspaceId) {
    logger.warn("jobs_fetch_missing_workspace", { user_id: user.id });
    res
      .status(403)
      .json(buildError("WORKSPACE_CLAIM_MISSING", "Workspace claim missing from session"));
    return;
  }

  try {
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      throw jobError;
    }

    if (!job) {
      res.status(404).json(buildError("NOT_FOUND", "Job not found"));
      return;
    }

    if (job.workspace_id !== workspaceId) {
      logger.warn(
        "jobs_fetch_workspace_mismatch",
        { user_id: user.id, workspace_id: workspaceId },
        { job_id: jobId, job_workspace_id: job.workspace_id },
      );
      res.status(404).json(buildError("NOT_FOUND", "Job not found"));
      return;
    }

    const { data: events, error: eventsError } = await supabase
      .from("job_events")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    if (eventsError) {
      throw eventsError;
    }

    logger.info(
      "jobs_fetch_success",
      { workspace_id: workspaceId, user_id: user.id },
      { job_id: jobId, event_count: events?.length ?? 0 },
    );

    res.status(200).json({ ok: true, job, events: events ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch job";

    captureException(error, {
      route: "/api/jobs/[id]",
      jobId,
      workspaceId,
      userId: user.id,
    });

    logger.error(
      "jobs_fetch_failed",
      { workspace_id: workspaceId, user_id: user.id },
      { error: message, job_id: jobId },
    );

    res
      .status(500)
      .json(buildError("JOBS_FETCH_FAILED", message));
  }
}
