import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../logging/logger";

/**
 * Parameters for incrementing workspace usage.
 */
export interface IncrementUsageParams {
  workspaceId: string;
  clipRenders?: number;
  minutes?: number;
}

/**
 * Format period start as YYYY-MM-DD (first day of month) for database storage.
 */
function formatPeriodStart(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/**
 * Canonical usage writer function.
 * Locates the current (open) usage period for a workspace, creates one if none exists,
 * and increments counters atomically.
 *
 * Never throws on usage write - logs errors and returns null instead.
 */
export async function incrementUsage(
  client: SupabaseClient,
  params: IncrementUsageParams,
): Promise<null | void> {
  const { workspaceId, clipRenders = 0, minutes = 0 } = params;

  if (clipRenders === 0 && minutes === 0) {
    return;
  }

  try {
    // Get current period start (first day of current month as YYYY-MM-DD)
    const now = new Date();
    const periodStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const periodStartStr = formatPeriodStart(periodStartDate);

    // Find the current open period (where period_end IS NULL)
    const { data: existing, error: fetchError } = await client
      .from("workspace_usage")
      .select("id, clips_count, source_minutes")
      .eq("workspace_id", workspaceId)
      .eq("period_start", periodStartStr)
      .is("period_end", null)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      logger.error("usage_increment_fetch_failed", {
        workspaceId,
        error: fetchError.message,
      });
      return null;
    }

    if (existing) {
      // Update existing period
      const { error: updateError } = await client
        .from("workspace_usage")
        .update({
          clips_count: (existing.clips_count ?? 0) + clipRenders,
          source_minutes: (Number(existing.source_minutes) || 0) + minutes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        logger.error("usage_increment_update_failed", {
          workspaceId,
          error: updateError.message,
        });
        return null;
      }
    } else {
      // Create new period with period_start as date (YYYY-MM-DD)
      const { error: insertError } = await client.from("workspace_usage").insert({
        workspace_id: workspaceId,
        period_start: periodStartStr,
        clips_count: clipRenders,
        source_minutes: minutes,
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        logger.error("usage_increment_insert_failed", {
          workspaceId,
          error: insertError.message,
        });
        return null;
      }
    }

    logger.info("usage_incremented", {
      workspaceId,
      clipRenders,
      minutes,
      periodStart: periodStartStr,
    });
  } catch (error) {
    logger.error("usage_increment_error", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

