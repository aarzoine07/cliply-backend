/**
 * Workers Status CLI - Display worker activity and health
 * 
 * Usage:
 *   pnpm workers:status
 */

import "dotenv/config";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.js";
import engineHealthModule from "../../packages/shared/dist/src/health/engineHealthSnapshot.js";

const { getMachineHealthSnapshot } = engineHealthModule;

function formatTimestamp(isoString: string | null): string {
  if (!isoString) return "N/A";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor(diffMs / 1000);

    const formattedTime = date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
    
    if (diffMins > 60) {
      const diffHours = Math.floor(diffMins / 60);
      return `${formattedTime} (${diffHours}h ago)`;
    } else if (diffMins > 0) {
      return `${formattedTime} (${diffMins}m ago)`;
    } else {
      return `${formattedTime} (${diffSecs}s ago)`;
    }
  } catch {
    return isoString;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: pnpm workers:status

Display worker activity and health information.

This command shows:
  - Number of active workers
  - Last heartbeat timestamp
  - Binary availability (FFmpeg, yt-dlp)
  - Recent job errors that may indicate worker issues

Options:
  --help, -h      Show this help message

Examples:
  pnpm workers:status

Related commands:
  pnpm jobs:stats            View overall queue statistics
  pnpm backend:readyz        Full backend readiness check
    `);
    process.exit(0);
  }

  const supabase = createServiceSupabaseClient();

  console.log("\n👷 Fetching worker status...\n");

  try {
    const snapshot = await getMachineHealthSnapshot({
      supabase,
      recentMinutes: 10, // Focus on very recent activity for workers
      maxRecentErrors: 3,
    });

    console.log("═".repeat(80));
    console.log("👷 Worker Status");
    console.log("═".repeat(80));
    console.log("");

    // Worker activity
    console.log("📊 Activity:");
    console.log(`   Active Workers:      ${snapshot.workers.activeWorkers}`);
    console.log(`   Last Heartbeat:      ${formatTimestamp(snapshot.workers.lastHeartbeatAt)}`);
    console.log("");

    // Health indicators
    const allHealthy =
      snapshot.ffmpegOk &&
      (snapshot.ytDlpOk === undefined || snapshot.ytDlpOk) &&
      snapshot.workers.activeWorkers > 0;

    console.log(`🏥 Health:               ${allHealthy ? "✅ Healthy" : "⚠️  Issues Detected"}`);
    console.log("");

    // Binary availability
    console.log("🔧 Binary Availability:");
    console.log(`   FFmpeg:              ${snapshot.ffmpegOk ? "✅ Available" : "❌ Not found"}`);
    if (snapshot.ytDlpOk !== undefined) {
      console.log(`   yt-dlp:              ${snapshot.ytDlpOk ? "✅ Available" : "❌ Not found"}`);
    }
    console.log("");

    // Queue depth (summary)
    console.log("📋 Queue Summary:");
    console.log(`   Pending Jobs:        ${snapshot.queues.ALL.pending}`);
    console.log(`   Running Jobs:        ${snapshot.queues.ALL.running}`);
    console.log(`   Dead-Letter Jobs:    ${snapshot.queues.ALL.deadLetter}`);
    console.log("");

    // Recent errors (if any)
    if (snapshot.recentErrors.length > 0) {
      console.log(`⚠️  Recent Errors (last ${snapshot.recentErrors.length}, within 10 minutes):`);
      for (const err of snapshot.recentErrors) {
        const jobIdShort = err.jobId.slice(0, 10);
        const messageSnippet = (err.message || "").replace(/\n/g, " ").slice(0, 50);
        console.log(`   • ${jobIdShort} (${err.kind}): ${messageSnippet}`);
      }
      console.log("");
    }

    // Diagnostics and recommendations
    if (!allHealthy) {
      console.log("🔍 Diagnostics:");

      if (snapshot.workers.activeWorkers === 0) {
        console.log("   ❌ No active workers detected");
        console.log("");
        console.log("   Possible causes:");
        console.log("   • Worker container/process not running");
        console.log("   • Worker failed to start (check logs)");
        console.log("   • Database connection issues");
        console.log("   • Jobs stuck in claim loop");
        console.log("");
        console.log("   Remediation:");
        console.log("   1. Check worker deployment status (Docker, Kubernetes, etc.)");
        console.log("   2. Review worker logs for startup errors");
        console.log("   3. Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set");
        console.log("   4. Run: pnpm backend:readyz");
        console.log("");
        console.log("   📖 See: REPORTS/runbooks/worker-debugging.md");
      } else if (snapshot.workers.lastHeartbeatAt) {
        const lastHeartbeat = new Date(snapshot.workers.lastHeartbeatAt);
        const now = new Date();
        const staleMinutes = (now.getTime() - lastHeartbeat.getTime()) / 60000;

        if (staleMinutes > 5) {
          console.log(`   ⚠️  Last heartbeat was ${Math.floor(staleMinutes)} minutes ago`);
          console.log("   → Workers may be stuck or not processing jobs");
          console.log("");
        }
      }

      if (!snapshot.ffmpegOk) {
        console.log("   ❌ FFmpeg is not available");
        console.log("   → Video processing jobs will fail");
        console.log("   → Install FFmpeg or check PATH in worker environment");
        console.log("");
      }

      if (snapshot.ytDlpOk === false) {
        console.log("   ⚠️  yt-dlp is not available");
        console.log("   → YouTube download jobs will fail");
        console.log("   → Install yt-dlp or check PATH in worker environment");
        console.log("");
      }
    } else {
      console.log("✅ All systems operational");
      console.log("");
    }

    console.log("═".repeat(80));
    console.log("");

    process.exit(allHealthy ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to fetch worker status: ${message}`);
    console.error("");
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

