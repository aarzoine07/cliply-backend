import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "../src/env";

// Create service-role client helper
// Note: This matches the pattern from @cliply/shared/supabase/server
// If that helper exists, this can be replaced with an import
function createServiceRoleClient(): SupabaseClient {
  const env = getEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export interface AuditEventInput {
  workspaceId: string;
  actorId?: string | null;
  eventType: string; // replaces category
  targetId?: string | null; // replaces action.target concept
  action: string; // stored inside payload.action
  meta?: Record<string, unknown>;
}

/**
 * Logs audit events to events_audit table using service-role client.
 * Writes to events_audit using real schema fields:
 * - workspace_id
 * - actor_id
 * - event_type
 * - target_id
 * - payload (containing action and meta)
 */
export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const client = createServiceRoleClient();

  const { error } = await client.from("events_audit").insert({
    workspace_id: input.workspaceId,
    actor_id: input.actorId ?? null,
    event_type: input.eventType,
    target_id: input.targetId ?? null,
    payload: {
      action: input.action,
      meta: input.meta ?? {},
    },
  });

  if (error) {
    console.error("logAuditEvent error", { error });
  }
}

