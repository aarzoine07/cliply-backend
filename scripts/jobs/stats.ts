/**
 * Jobs Stats CLI - Display overall queue and engine health statistics
 * 
 * Usage:
 *   pnpm jobs:stats
 */

import "dotenv/config";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.js";
import engineHealthModule from "../../packages/shared/dist/src/health/engineHealthSnapshot.js";

const { getMachineHealthSnapshot } = engineHealthModule;

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "N/A";
  
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else if (mins > 0) {
    return `${mins}m`;
  } else {
    return `${seconds}s`;
  }
}

function formatTimestamp(isoString: string | null): string {
  if (!isoString) return "N/A";
  try {
    const date = new Date(isoString);
    return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return isoString;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: pnpm jobs:stats [options]

Display overall queue and engine health statistics.

This command provides a high-level overview of:
  - Queue depths (pending, running, dead-letter) by job kind
  - Active worker count and last heartbeat
  - Binary availability (FFmpeg, yt-dlp)
  - Recent job errors
  - Overall health status

Options:
  --help, -h      Show this help message

Examples:
  pnpm jobs:stats

Related commands:
  pnpm jobs:status <jobId>   Check status of a specific job
  pnpm workers:status        View worker activity details
  pnpm dlq:list              List dead-letter queue jobs
    `);
    process.exit(0);
  }

  const supabase = createServiceSupabaseClient();

  console.log("\n📊 Fetching engine health snapshot...\n");

  try {
    const snapshot = await getMachineHealthSnapshot({
      supabase,
      recentMinutes: 60,
      maxRecentErrors: 5,
    });

    // Overall health status
    console.log("═".repeat(80));
    console.log(`🏥 Overall Health: ${snapshot.ok ? "✅ OK" : "⚠️  DEGRADED"}`);
    console.log("═".repeat(80));
    console.log("");

    // Queue statistics (ALL aggregate)
    console.log("📋 Queue Overview (ALL jobs):");
    console.log(`   Pending:        ${snapshot.queues.ALL.pending.toString().padStart(6)} jobs ready to run`);
    console.log(`   Running:        ${snapshot.queues.ALL.running.toString().padStart(6)} jobs currently processing`);
    console.log(`   Dead-Letter:    ${snapshot.queues.ALL.deadLetter.toString().padStart(6)} jobs exhausted retries`);
    console.log(`   Oldest Job:     ${formatDuration(snapshot.queues.ALL.oldestJobAgeSec)}`);
    console.log("");

    // Per-kind breakdown (show non-empty queues)
    const importantKinds = [
      "TRANSCRIBE",
      "HIGHLIGHT_DETECT",
      "CLIP_RENDER",
      "THUMBNAIL_GEN",
      "PUBLISH_YOUTUBE",
      "PUBLISH_TIKTOK",
      "YOUTUBE_DOWNLOAD",
      "CLEANUP_STORAGE",
    ];

    const kindsToShow = importantKinds.filter(kind => {
      const q = snapshot.queues[kind];
      return q && (q.pending > 0 || q.running > 0 || q.deadLetter > 0);
    });

    if (kindsToShow.length > 0) {
      console.log("📊 Queue Breakdown by Kind:");
      console.log("");
      console.log(
        "Kind                  ".padEnd(23) +
        "Pending ".padEnd(9) +
        "Running ".padEnd(9) +
        "DLQ ".padEnd(5) +
        "Oldest"
      );
      console.log("─".repeat(60));

      for (const kind of kindsToShow) {
        const q = snapshot.queues[kind];
        if (!q) continue;

        console.log(
          kind.padEnd(23) +
          q.pending.toString().padStart(7).padEnd(9) +
          q.running.toString().padStart(7).padEnd(9) +
          q.deadLetter.toString().padStart(3).padEnd(5) +
          formatDuration(q.oldestJobAgeSec)
        );
      }

      console.log("");
    }

    // Worker status
    console.log("👷 Worker Status:");
    console.log(`   Active Workers:      ${snapshot.workers.activeWorkers}`);
    console.log(`   Last Heartbeat:      ${formatTimestamp(snapshot.workers.lastHeartbeatAt)}`);
    console.log("");

    // Binary availability
    console.log("🔧 Binary Availability:");
    console.log(`   FFmpeg:              ${snapshot.ffmpegOk ? "✅ Available" : "❌ Not found"}`);
    if (snapshot.ytDlpOk !== undefined) {
      console.log(`   yt-dlp:              ${snapshot.ytDlpOk ? "✅ Available" : "❌ Not found"}`);
    }
    console.log("");

    // Recent errors
    if (snapshot.recentErrors.length > 0) {
      console.log(`⚠️  Recent Errors (last ${snapshot.recentErrors.length}):`);
      console.log("");
      console.log(
        "Job ID     ".padEnd(12) +
        "Kind                 ".padEnd(22) +
        "State       ".padEnd(13) +
        "Message"
      );
      console.log("─".repeat(80));

      for (const err of snapshot.recentErrors) {
        const jobIdShort = err.jobId.slice(0, 10);
        const kindFormatted = err.kind.slice(0, 20).padEnd(20);
        const stateFormatted = err.state.padEnd(11);
        const messageSnippet = (err.message || "").replace(/\n/g, " ").slice(0, 35);

        console.log(
          jobIdShort.padEnd(12) +
          kindFormatted.padEnd(22) +
          stateFormatted.padEnd(13) +
          messageSnippet
        );
      }

      console.log("");
      console.log("💡 Use 'pnpm jobs:status <jobId>' or 'pnpm dlq:inspect <jobId>' for details");
      console.log("");
    } else {
      console.log("✅ No recent errors (last 60 minutes)");
      console.log("");
    }

    // Recommendations
    if (!snapshot.ok) {
      console.log("⚠️  Recommendations:");
      
      if (!snapshot.ffmpegOk) {
        console.log("   • FFmpeg is not available - worker jobs will fail");
        console.log("     → Install FFmpeg or check PATH");
      }
      
      if (snapshot.queues.ALL.deadLetter >= 100) {
        console.log("   • High dead-letter queue count (>= 100)");
        console.log("     → Review errors with 'pnpm dlq:list'");
        console.log("     → See REPORTS/runbooks/DLQ-recovery.md");
      }
      
      if (snapshot.workers.activeWorkers === 0 && snapshot.queues.ALL.pending > 0) {
        console.log("   • No active workers but jobs are pending");
        console.log("     → Check worker deployment status");
        console.log("     → See REPORTS/runbooks/worker-debugging.md");
      }
      
      console.log("");
    }

    console.log("═".repeat(80));
    console.log("");

    process.exit(snapshot.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to fetch engine health: ${message}`);
    console.error("");
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

