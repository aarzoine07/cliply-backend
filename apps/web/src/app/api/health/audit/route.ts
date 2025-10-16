import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { buildAuthContext } from "@cliply/shared/auth/context";
import { logger } from "@cliply/shared/logging/logger";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase configuration is missing for audit health endpoint.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STALE_THRESHOLD_DAYS = 90;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await buildAuthContext(request);
    if (!auth.workspace_id) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "COMPLIANCE_WORKSPACE_MISSING", message: "Workspace context missing." },
        },
        { status: 401 },
      );
    }

    const workspaceId = auth.workspace_id;

    const { data: lastEventData, error: lastEventError } = await supabase
      .from("events_audit")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastEventError) {
      throw new Error(`Failed to fetch last audit event: ${lastEventError.message}`);
    }

    const { count: totalCount, error: totalCountError } = await supabase
      .from("events_audit")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);

    if (totalCountError) {
      throw new Error(`Failed to count audit events: ${totalCountError.message}`);
    }

    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    const { count: staleCount, error: staleCountError } = await supabase
      .from("events_audit")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .lt("created_at", staleCutoff);

    if (staleCountError) {
      throw new Error(`Failed to count stale events: ${staleCountError.message}`);
    }

    const { data: recentIntegrations, error: integrationError } = await supabase
      .from("events_audit")
      .select("event_type, created_at")
      .eq("workspace_id", workspaceId)
      .in("event_type", ["stripe_sync", "oauth_tiktok_refreshed"])
      .order("created_at", { ascending: false })
      .limit(5);

    if (integrationError) {
      throw new Error(`Failed to fetch integration audit events: ${integrationError.message}`);
    }

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
    const message = error instanceof Error ? error.message : "Failed to load audit health.";
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
