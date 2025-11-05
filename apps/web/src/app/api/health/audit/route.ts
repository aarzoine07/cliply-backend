import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STALE_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

function getSupabaseClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase configuration is missing for audit health endpoint.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Lazy import shared modules to prevent Vercel from statically evaluating them
    const [{ buildAuthContext }, { logger }] = await Promise.all([
      import("@cliply/shared/auth/context"),
      import("@cliply/shared/logging/logger"),
    ]);

    const auth = await buildAuthContext(request);
    if (!auth.workspace_id) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "COMPLIANCE_WORKSPACE_MISSING",
            message: "Workspace context missing.",
          },
        },
        { status: 401 },
      );
    }

    const workspaceId = auth.workspace_id;
    const supabase = getSupabaseClient();

    const { data: lastEventData, error: lastEventError } = await supabase
      .from("events_audit")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEventError) throw new Error(lastEventError.message);

    const { count: totalCount } = await supabase
      .from("events_audit")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
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

    logger.info("Audit health check", { workspace_id: workspaceId }, health);
    return NextResponse.json({ ok: true, data: health });
  } catch (error) {
    const [{ logger }] = await Promise.all([
      import("@cliply/shared/logging/logger"),
    ]);
    const message =
      error instanceof Error ? error.message : "Failed to load audit health.";
    logger.error("Audit health endpoint failure", {}, { error: message });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "COMPLIANCE_HEALTH_ERROR", message },
      },
      { status: 500 },
    );
  }
}
