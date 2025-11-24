import type { SupabaseClient } from "@supabase/supabase-js";

import type { QueueAdapter } from "../pipelines/types";

/**
 * Queue adapter that enqueues jobs back to Supabase jobs table.
 */
export function createQueueAdapter(supabase: SupabaseClient): QueueAdapter {
  return {
    async enqueue(input: {
      type: string;
      payload: unknown;
      workspaceId: string;
      scheduledFor?: string | null;
    }): Promise<void> {
      const { error } = await supabase.from("jobs").insert({
        workspace_id: input.workspaceId,
        kind: input.type,
        payload: input.payload,
        status: "queued",
        run_after: input.scheduledFor ? new Date(input.scheduledFor).toISOString() : new Date().toISOString(),
      });

      if (error) {
        throw new Error(`Failed to enqueue job ${input.type}: ${error.message}`);
      }
    },
  };
}

