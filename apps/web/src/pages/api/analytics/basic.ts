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
  const authHeader = firstHeaderValue(req.headers.authorization);
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/, 2);
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
      // ignore malformed cookies
    }
  }

  return null;
}

function extractWorkspaceId(user: { [key: string]: unknown }): string | null {
  const candidateKeys = [
    "workspace_id",
    "active_workspace_id",
  ];

  for (const key of candidateKeys) {
    const appMeta = (user.app_metadata as Record<string, unknown> | undefined)?.[key];
    if (typeof appMeta === "string" && appMeta.trim()) {
      return appMeta;
    }

    const userMeta = (user.user_metadata as Record<string, unknown> | undefined)?.[key];
    if (typeof userMeta === "string" && userMeta.trim()) {
      return userMeta;
    }
  }

  const direct = user["workspace_id"];
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  return null;
}

function buildError(code: string, message: string) {
  return { ok: false as const, error: { code, message } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res
      .status(405)
      .json(buildError("METHOD_NOT_ALLOWED", "Use GET"));
    return;
  }

  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    res.status(401).json(buildError("UNAUTHORIZED", "Invalid or missing session"));
    return;
  }

  const supabase = createClient(
    SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    },
  );


  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) {
    logger.warn("analytics_basic_unauthorized", undefined, {
      reason: authError?.message ?? "no_user",
    });
    res.status(401).json(buildError("UNAUTHORIZED", "Invalid or missing session"));
    return;
  }

  const workspaceId = extractWorkspaceId(user as any);
  if (!workspaceId) {
    logger.warn("analytics_basic_workspace_missing", { user_id: user.id });
    res
      .status(403)
      .json(buildError("WORKSPACE_CLAIM_MISSING", "Workspace claim missing from session"));
    return;
  }

  try {
    const { data: byState, error: stateError } = await supabase
      .from("jobs")
      .select("state, count:id")
   //   .group("state");

    if (stateError) {
      throw stateError;
    }

    const { data: byKind, error: kindError } = await supabase
      .from("jobs")
      .select("kind, count:id")
//

    if (kindError) {
      throw kindError;
    }

    const total =
      byState?.reduce<number>((acc, row) => acc + Number(row.count ?? 0), 0) ?? 0;

    const stats = {
      total,
      byState: Object.fromEntries(
        (byState ?? []).map((row) => [row.state, Number(row.count ?? 0)]),
      ),
      byKind: Object.fromEntries(
        (byKind ?? []).map((row) => [row.kind, Number(row.count ?? 0)]),
      ),
    };

    logger.info(
      "analytics_basic_success",
      { workspace_id: workspaceId, user_id: user.id },
      { total: stats.total },
    );

    res.status(200).json({ ok: true, data: stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load analytics";

    captureException(error, {
      route: "/api/analytics/basic",
      workspaceId,
      userId: user.id,
    });

    logger.error(
      "analytics_basic_failed",
      { workspace_id: workspaceId, user_id: user.id },
      { error: message },
    );

    res
      .status(500)
      .json(buildError("ANALYTICS_FETCH_FAILED", message));
  }
}
