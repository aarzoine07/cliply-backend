import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";

import { captureException } from "@/lib/sentry";

import { enqueueJob } from "@/lib/enqueueJob";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(["TRANSCRIBE", "HIGHLIGHT_DETECT", "CLIP_RENDER", "PUBLISH_TIKTOK", "ANALYTICS_INGEST"]),
  payload: z.record(z.string(), z.any()),
  priority: z.number().int().min(1).max(9).optional(),
  runAt: z.string().datetime().optional(),
  dedupeKey: z.string().optional(),
});

const env = getEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}

if (!SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY is not configured");
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry) {
        const trimmed = entry.trim();
        if (trimmed) return trimmed;
      }
    }
    return undefined;
  }
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractAccessToken(req: NextApiRequest): string | null {
  const headerValue = firstHeaderValue(req.headers.authorization);
  if (headerValue) {
    const [scheme, token] = headerValue.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const cookieToken = req.cookies["sb-access-token"] ?? req.cookies["sb_token"];
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
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

function extractWorkspaceIdFromUser(user: User | null): string | null {
  if (!user) return null;

  const lookupSources: Array<unknown> = [
    user.app_metadata?.workspace_id,
    user.app_metadata?.active_workspace_id,
    user.user_metadata?.workspace_id,
    user.user_metadata?.active_workspace_id,
  ];

  for (const candidate of lookupSources) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const claim = (user as unknown as { [key: string]: unknown })["workspace_id"];
  if (typeof claim === "string" && claim.trim()) {
    return claim;
  }

  return null;
}

function buildError(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json(buildError("METHOD_NOT_ALLOWED", "Use POST"));
    return;
  }

  const rawIdempotencyKey = firstHeaderValue(req.headers["idempotency-key"]);
  if (!rawIdempotencyKey) {
    res
      .status(400)
      .json(buildError("MISSING_IDEMPOTENCY_KEY", "Header Idempotency-Key required"));
    return;
  }
  const idempotencyKey = rawIdempotencyKey;

  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    res
      .status(401)
      .json(buildError("UNAUTHORIZED", "Invalid or missing Supabase session"));
    return;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    logger.warn("jobs_enqueue_unauthorized", undefined, {
      reason: authError?.message ?? "no_user",
    });
    res
      .status(401)
      .json(buildError("UNAUTHORIZED", "Invalid or missing Supabase session"));
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json(buildError("INVALID_BODY", parsed.error.message ?? "Invalid request body"));
    return;
  }

  const { workspaceId: bodyWorkspaceId, dedupeKey: bodyDedupeKey, ...rest } = parsed.data;
  const workspaceId = extractWorkspaceIdFromUser(user);

  if (!workspaceId) {
    logger.warn("jobs_enqueue_missing_workspace_claim", { user_id: user.id });
    res
      .status(403)
      .json(buildError("WORKSPACE_CLAIM_MISSING", "Workspace claim missing from session"));
    return;
  }

  if (bodyWorkspaceId !== workspaceId) {
    logger.warn("jobs_enqueue_workspace_mismatch", { user_id: user.id, workspace_id: workspaceId }, { requested_workspace_id: bodyWorkspaceId });
    res
      .status(403)
      .json(buildError("WORKSPACE_MISMATCH", "Workspace mismatch between session and payload"));
    return;
  }

  const dedupeKey = bodyDedupeKey ? `${idempotencyKey}:${bodyDedupeKey}` : idempotencyKey;

  try {
    const result = await enqueueJob({
      workspaceId,
      dedupeKey,
      ...rest,
    });

    if (!result.ok || !result.jobId) {
      throw new Error(result.error ?? "Unknown enqueue error");
    }

    logger.info("jobs_enqueue_success", { workspace_id: workspaceId }, {
      job_id: result.jobId,
      idempotency_key: idempotencyKey,
    });

    res.status(200).json({ ok: true, jobId: result.jobId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue job";

    captureException(error, {
      route: "/api/jobs/enqueue",
      workspaceId,
      userId: user.id,
      idempotencyKey,
    });

    logger.error(
      "jobs_enqueue_failed",
      { workspace_id: workspaceId, user_id: user.id },
      {
        error: message,
        idempotency_key: idempotencyKey,
      },
    );

    res
      .status(500)
      .json(buildError("JOBS_ENQUEUE_FAILED", message));
  }
}
