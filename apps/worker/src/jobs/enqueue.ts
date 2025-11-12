import { createClient } from "@supabase/supabase-js";
import type { JobRecord } from "./types.js";

export async function enqueueJob(workspace_id: string, type: string, payload: Record<string, any>) {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  // Try new schema first (type, status)
  let insertData: Record<string, any> = { workspace_id, type, payload, status: "pending" };
  let { data, error } = await supabase.from("jobs").insert([insertData]).select().single();
  
  // Fallback to old schema (kind, state) if new schema fails
  if (error && error.message.includes("column") && (error.message.includes("type") || error.message.includes("status"))) {
    insertData = { workspace_id, kind: type.toUpperCase(), payload, state: "queued" };
    const result = await supabase.from("jobs").insert([insertData]).select().single();
    if (result.error) throw new Error(`enqueueJob failed: ${result.error.message}`);
    // Map old schema to new schema format
    return {
      id: result.data.id,
      workspace_id: result.data.workspace_id,
      type: result.data.kind?.toLowerCase() || type,
      payload: result.data.payload || {},
      status: result.data.state === "queued" ? "pending" : result.data.state,
      attempts: result.data.attempts || 0,
      last_error: result.data.last_error,
      next_run_at: result.data.run_after || result.data.run_at || new Date().toISOString(),
      created_at: result.data.created_at,
      updated_at: result.data.updated_at,
    } as JobRecord;
  }
  
  if (error) throw new Error(`enqueueJob failed: ${error.message}`);
  return data as JobRecord;
}

