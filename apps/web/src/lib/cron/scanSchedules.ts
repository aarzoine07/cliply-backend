import * as crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { enqueueJob } from "@/lib/enqueueJob";
import * as connectedAccountsService from "@/lib/accounts/connectedAccountsService";
import * as publishConfigService from "@/lib/accounts/publishConfigService";

export interface ScheduleRow {
  id: string;
  workspace_id: string;
  clip_id: string;
  platform: "tiktok" | "youtube" | null;
  run_at: string;
  status: string;
}

export interface ScanResult {
  scanned: number;
  claimed: number;
  enqueued: number;
  enqueued_tiktok: number;
  enqueued_youtube: number;
  skipped: number;
  failed: number;
}

/**
 * Core function to scan and enqueue schedules for publishing.
 * This function is idempotent - it atomically claims schedules to avoid duplicates.
 */
export async function scanSchedules(
  supabase: SupabaseClient
): Promise<ScanResult> {
  const runId = crypto.randomUUID();
  const startTime = Date.now();

  logger.info("cron_scan_schedules_start", {
    runId,
    timestamp: new Date().toISOString(),
  });

  // Step 1: Atomically claim all due schedules
  // Use UPDATE ... WHERE status = 'scheduled' AND run_at <= now() with RETURNING
  // Note: PostgREST supports .update().eq().lte().select() which returns updated rows
  // This is reasonably atomic, though for true atomicity a PostgreSQL function would be better
  const now = new Date().toISOString();
  const { data: claimedSchedules, error: claimError } = await supabase
    .from("schedules")
    .update({ status: "processing", updated_at: now })
    .eq("status", "scheduled")
    .lte("run_at", now)
    .select("id, workspace_id, clip_id, platform, run_at, status");

  if (claimError) {
    logger.error("cron_scan_schedules_claim_failed", {
      runId,
      error: claimError.message,
    });
    throw new Error(`Failed to claim schedules: ${claimError.message}`);
  }

  const claimed = (claimedSchedules as ScheduleRow[]) || [];
  const scanned = claimed.length; // In a real implementation, you'd query total count separately

  logger.info("cron_scan_schedules_claimed", {
    runId,
    claimed_count: claimed.length,
  });

  if (claimed.length === 0) {
    logger.info("cron_scan_schedules_complete", {
      runId,
      scanned: 0,
      claimed: 0,
      enqueued: 0,
      enqueued_tiktok: 0,
      enqueued_youtube: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - startTime,
    });
    return {
      scanned: 0,
      claimed: 0,
      enqueued: 0,
      enqueued_tiktok: 0,
      enqueued_youtube: 0,
      skipped: 0,
      failed: 0,
    };
  }

  // Step 2: Enqueue jobs for each claimed schedule
  let enqueued = 0;
  let enqueuedTiktok = 0;
  let enqueuedYoutube = 0;
  let skipped = 0;
  let failed = 0;

  for (const schedule of claimed) {
    try {
      // Skip schedules without platform (backward compatibility - should be rare)
      if (!schedule.platform) {
        logger.warn("cron_scan_schedules_skip_no_platform", {
          runId,
          scheduleId: schedule.id,
          clipId: schedule.clip_id,
        });
        skipped++;
        continue;
      }

      // Get connected accounts for this platform
      let accountIds: string[] = [];
      try {
        // Try to get accounts from publish_config first
        const publishConfig = await publishConfigService.getPublishConfig(
          {
            workspaceId: schedule.workspace_id,
            platform: schedule.platform as "tiktok" | "youtube",
          },
          { supabase }
        );

        // Use default accounts from config if available
        if (
          publishConfig.default_connected_account_ids &&
          publishConfig.default_connected_account_ids.length > 0
        ) {
          const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
            {
              workspaceId: schedule.workspace_id,
              platform: schedule.platform as "tiktok" | "youtube",
              connectedAccountIds: publishConfig.default_connected_account_ids,
            },
            { supabase }
          );
          accountIds = accounts.map((a) => a.id);
        } else {
          // Fall back to all active accounts for platform
          const accounts = await connectedAccountsService.getConnectedAccountsForPublish(
            {
              workspaceId: schedule.workspace_id,
              platform: schedule.platform as "tiktok" | "youtube",
            },
            { supabase }
          );
          accountIds = accounts.map((a) => a.id);
        }
      } catch (error) {
        logger.warn("cron_scan_schedules_accounts_failed", {
          runId,
          scheduleId: schedule.id,
          platform: schedule.platform,
          error: (error as Error)?.message ?? "unknown",
        });
        // Continue without accounts - will skip this schedule
      }

      if (accountIds.length === 0) {
        logger.warn("cron_scan_schedules_no_accounts", {
          runId,
          scheduleId: schedule.id,
          platform: schedule.platform,
          workspaceId: schedule.workspace_id,
        });
        skipped++;
        continue;
      }

      // Determine job kind based on platform
      const jobKind = schedule.platform === "tiktok" ? "PUBLISH_TIKTOK" : "PUBLISH_YOUTUBE";

      // Enqueue one job per account
      for (const accountId of accountIds) {
        const payload: Record<string, unknown> = {
          clipId: schedule.clip_id,
          connectedAccountId: accountId,
        };

        // Add platform-specific fields if needed
        if (schedule.platform === "youtube") {
          // Use defaults from publish_config if available
          // For now, we'll let the worker use defaults
        } else if (schedule.platform === "tiktok") {
          // Use defaults from publish_config if available
          payload.privacyLevel = "PUBLIC_TO_EVERYONE";
        }

        const result = await enqueueJob({
          workspaceId: schedule.workspace_id,
          kind: jobKind,
          payload,
          dedupeKey: `${schedule.id}-${accountId}`, // Ensure idempotency per schedule+account
        });

        if (result.ok) {
          enqueued++;
          if (schedule.platform === "tiktok") {
            enqueuedTiktok++;
          } else if (schedule.platform === "youtube") {
            enqueuedYoutube++;
          }
        } else {
          logger.error("cron_scan_schedules_enqueue_failed", {
            runId,
            scheduleId: schedule.id,
            accountId,
            platform: schedule.platform,
            error: result.error,
          });
          failed++;
        }
      }
    } catch (error) {
      logger.error("cron_scan_schedules_schedule_error", {
        runId,
        scheduleId: schedule.id,
        error: (error as Error)?.message ?? "unknown",
      });
      failed++;
    }
  }

  logger.info("cron_scan_schedules_complete", {
    runId,
    scanned,
    claimed: claimed.length,
    enqueued,
    enqueued_tiktok: enqueuedTiktok,
    enqueued_youtube: enqueuedYoutube,
    skipped,
    failed,
    durationMs: Date.now() - startTime,
  });

  return {
    scanned,
    claimed: claimed.length,
    enqueued,
    enqueued_tiktok: enqueuedTiktok,
    enqueued_youtube: enqueuedYoutube,
    skipped,
    failed,
  };
}

