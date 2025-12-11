// FILE: apps/web/src/app/api/health/audit/route.ts
// FINAL VERSION – workspace audit health snapshot (Supabase only, no shared logger)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STALE_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_MS =
  STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

function getSupabaseClient() {
  const env = getEnv();
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase configuration is missing for audit health endpoint.",
    );
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * This endpoint returns a simple audit health snapshot for a workspace.
 *
 * For simplicity (and to avoid shared auth/logger issues), we accept
 * the workspace ID via query param:
 *   GET /api/health/audit?workspace_id=<uuid>
 *
 * You can later wire this to your auth context if desired.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspace_id");

    if (!workspaceId) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "COMPLIANCE_WORKSPACE_MISSING",
            message: "Workspace context (workspace_id) missing.",
          },
        },
        { status: 401 },
      );
    }

    const supabase = getSupabaseClient();

    const { data: lastEventData, error: lastEventError } = await supabase
      .from("events_audit")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEventError) {
      throw new Error(lastEventError.message);
    }

    const { count: totalCount } = await supabase
      .from("events_audit")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    const staleCutoff = new Date(
      Date.now() - STALE_THRESHOLD_MS,
    ).toISOString();

    const { count: staleCount } = await supabase
      .from("events_audit")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .lt("created_at", staleCutoff);

    const { data: recentIntegrations } = await supabase
      .from("events_audit")
      .select("event_type, created_at")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["stripe_sync", "oauth_tiktok_refreshed"])
      .order("created_at", { ascending: false })
      .limit(5);

    const health = {
      workspace_id: workspaceId,
      last_event_at: lastEventData?.created_at ?? null,
      total_events: totalCount ?? 0,
      stale_events: staleCount ?? 0,
      integrations: recentIntegrations ?? [],
    };

    // Simple console logging instead of shared logger
    console.log("Audit health check", health);

    return NextResponse.json({ ok: true, data: health });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load audit health.";
    console.error("Audit health endpoint failure", { error: message });

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "COMPLIANCE_HEALTH_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
