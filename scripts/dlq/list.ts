/**
 * DLQ List CLI - List dead-letter queue jobs
 * 
 * Usage:
 *   pnpm dlq:list
 *   pnpm dlq:list --limit=100
 *   pnpm dlq:list --kind=TRANSCRIBE
 */

import "dotenv/config";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.js";

interface DLQJob {
  id: string;
  kind: string;
  workspace_id: string;
  attempts: number;
  max_attempts: number;
  updated_at: string;
  last_error?: string | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 50;
  let kind: string | null = null;

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const parsed = parseInt(arg.split("=")[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 1000); // Cap at 1000 for safety
      }
    } else if (arg.startsWith("--kind=")) {
      kind = arg.split("=")[1];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: pnpm dlq:list [options]

List jobs currently in the dead-letter queue (DLQ).

Options:
  --limit=N       Limit results to N jobs (default: 50, max: 1000)
  --kind=KIND     Filter by job kind (e.g., TRANSCRIBE, CLIP_RENDER)
  --help, -h      Show this help message

Examples:
  pnpm dlq:list
  pnpm dlq:list --limit=100
  pnpm dlq:list --kind=TRANSCRIBE
  pnpm dlq:list --kind=CLIP_RENDER --limit=20

Next steps:
  pnpm dlq:inspect <jobId>   View detailed info for a specific job
  pnpm dlq:requeue <jobId>   Requeue a dead-letter job
      `);
      process.exit(0);
    }
  }

  return { limit, kind };
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else if (diffMins > 0) {
      return `${diffMins}m ago`;
    } else {
      return "just now";
    }
  } catch {
    return isoString.slice(0, 16);
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

async function main() {
  const { limit, kind } = parseArgs();

  const supabase = createServiceSupabaseClient();

  // Query dead_letter jobs
  let query = supabase
    .from("jobs")
    .select("id, kind, workspace_id, attempts, max_attempts, updated_at, last_error")
    .eq("state", "dead_letter")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (kind) {
    query = query.eq("kind", kind);
  }

  const { data: jobs, error } = await query;

  if (error) {
    console.error(`❌ Failed to fetch DLQ jobs: ${error.message}`);
    process.exit(1);
  }

  const dlqJobs = (jobs || []) as DLQJob[];

  if (dlqJobs.length === 0) {
    console.log("\n✅ No dead-letter jobs found.");
    if (kind) {
      console.log(`   (filtered by kind: ${kind})`);
    }
    console.log("");
    process.exit(0);
  }

  // Print header
  console.log(`\n📋 Dead-Letter Queue (${dlqJobs.length} job${dlqJobs.length === 1 ? "" : "s"})`);
  if (kind) {
    console.log(`   Filtered by kind: ${kind}`);
  }
  console.log("");

  // Print table header
  console.log(
    "ID         ".padEnd(12) +
    "Kind                 ".padEnd(22) +
    "Workspace  ".padEnd(12) +
    "Attempts  ".padEnd(11) +
    "Updated        ".padEnd(16) +
    "Error"
  );
  console.log("─".repeat(100));

  // Print each job
  for (const job of dlqJobs) {
    const jobIdShort = truncate(job.id, 10);
    const kindFormatted = truncate(job.kind || "UNKNOWN", 20);
    const workspaceShort = truncate(job.workspace_id || "?", 10);
    const attemptsStr = `${job.attempts}/${job.max_attempts}`;
    const updatedStr = formatTimestamp(job.updated_at);
    const errorSnippet = job.last_error
      ? truncate(job.last_error.replace(/\n/g, " "), 30)
      : "";

    console.log(
      jobIdShort.padEnd(12) +
      kindFormatted.padEnd(22) +
      workspaceShort.padEnd(12) +
      attemptsStr.padEnd(11) +
      updatedStr.padEnd(16) +
      errorSnippet
    );
  }

  console.log("");
  console.log("💡 Next steps:");
  console.log("   pnpm dlq:inspect <jobId>   View detailed info for a specific job");
  console.log("   pnpm dlq:requeue <jobId>   Requeue a job back to pending state");
  console.log("");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

