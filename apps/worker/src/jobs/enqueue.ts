console.log("LOADED enqueue.ts FROM:", import.meta.url);

import { createClient } from "@supabase/supabase-js";
import type { JobRecord } from "./types.js";

export async function enqueueJob(
  workspace_id: string,
  type: string,
  payload: Record<string, any>
) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Insert with real DB columns
  const { data: created, error: insertErr } = await supabase
    .from("jobs")
    .insert({
      workspace_id,
      kind: type.toUpperCase(), // your real enum
      payload,
    })
    .select()
    .single();

  if (insertErr) throw new Error(`enqueueJob failed: ${insertErr.message}`);

  // Force next_run_at in the past
  const past = new Date(Date.now() - 60_000).toISOString();

  const { data: updated, error: updateErr } = await supabase
    .from("jobs")
    .update({ next_run_at: past })
    .eq("id", created.id)
    .select()
    .single();

  if (updateErr)
    throw new Error(`enqueueJob failed to update next_run_at: ${updateErr.message}`);

  return updated as JobRecord;
}