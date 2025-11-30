import { createClient } from "@supabase/supabase-js";
import { env } from "../../../../../packages/shared/test/setup";
/**
 * logAuditEvent
 *
 * Inserts an audit event into public.events_audit
 * Used by: apps/web/test/api/audit-logging.test.ts
 */
export async function logAuditEvent({
  workspaceId,
  actorId,
  eventType,
  targetId,
  payload = {},
}: {
  workspaceId: string;
  actorId?: string | null;
  eventType: string;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}) {
  // In tests: use service role client
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { error } = await supabase
    .from("events_audit")
    .insert({
      workspace_id: workspaceId,
      actor_id: actorId || null, // must allow NULL to avoid FK error
      event_type: eventType,
      target_id: targetId || null,
      payload: payload ?? {},
    });

  return { error };
}