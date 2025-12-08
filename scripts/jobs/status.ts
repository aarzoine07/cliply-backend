/**
 * Jobs Status CLI - Check status of a specific job
 * 
 * Usage:
 *   pnpm jobs:status <jobId>
 */

import "dotenv/config";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.js";

interface Job {
  id: string;
  kind: string;
  state: string;
  workspace_id: string;
  attempts: number;
  max_attempts: number;
  run_at?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  heartbeat_at?: string | null;
  last_error?: string | null;
  error?: unknown;
  payload?: unknown;
  created_at: string;
  updated_at: string;
}

interface JobEvent {
  id: string;
  job_id: string;
  stage: string;
  data?: unknown;
  created_at: string;
}

function parseArgs(): string | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: pnpm jobs:status <jobId>

Check the status of a specific job (any state).

Arguments:
  jobId           UUID of the job to check

Examples:
  pnpm jobs:status abc123-def456-789012

Related commands:
  pnpm jobs:stats            View overall queue statistics
  pnpm dlq:inspect <jobId>   Detailed DLQ inspection (for dead-letter jobs)
  pnpm dlq:list              List all dead-letter jobs
    `);
    return null;
  }

  return args[0];
}

function formatJson(obj: unknown, indent = 2): string {
  try {
    return JSON.stringify(obj, null, indent);
  } catch {
    return String(obj);
  }
}

function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return "N/A";
  try {
    const date = new Date(isoString);
    return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return isoString;
  }
}

function interpretJobStatus(job: Job): string[] {
  const insights: string[] = [];
  const now = new Date();

  // Check if job is stuck
  if (job.state === "running" || job.state === "processing") {
    if (job.heartbeat_at) {
      const heartbeatTime = new Date(job.heartbeat_at);
      const staleMinutes = (now.getTime() - heartbeatTime.getTime()) / 60000;
      
      if (staleMinutes > 10) {
        insights.push(`⚠️  Heartbeat is stale (${Math.floor(staleMinutes)} minutes old)`);
        insights.push("   → Worker may have crashed or lost connection");
        insights.push("   → Job may be recovered by 'worker_recover_stuck_jobs' RPC");
      }
    } else {
      insights.push("⚠️  No heartbeat recorded for running job");
    }
  }

  // Check if job is in DLQ
  if (job.state === "dead_letter") {
    insights.push("⚠️  Job is in DEAD-LETTER QUEUE (max attempts exceeded)");
    insights.push("   → Review errors below");
    insights.push(`   → Use 'pnpm dlq:requeue ${job.id}' to retry after fixing root cause`);
  }

  // Check if job is queued for too long
  if (job.state === "queued" || job.state === "pending") {
    const createdTime = new Date(job.created_at);
    const queuedMinutes = (now.getTime() - createdTime.getTime()) / 60000;
    
    if (queuedMinutes > 60) {
      insights.push(`⚠️  Job has been queued for ${Math.floor(queuedMinutes)} minutes`);
      insights.push("   → Check if workers are active: pnpm workers:status");
      insights.push("   → Check overall queue depth: pnpm jobs:stats");
    }
  }

  // Check if job has high attempt count
  if (job.attempts >= job.max_attempts - 1 && job.state !== "dead_letter") {
    insights.push(`⚠️  Job is on its last attempt (${job.attempts}/${job.max_attempts})`);
    insights.push("   → Next failure will move it to dead-letter queue");
  }

  // Check if job succeeded
  if (job.state === "done" || job.state === "completed" || job.state === "succeeded") {
    insights.push("✅ Job completed successfully");
  }

  return insights;
}

async function main() {
  const jobId = parseArgs();

  if (!jobId) {
    process.exit(0);
  }

  const supabase = createServiceSupabaseClient();

  // Fetch job details
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    console.error(`\n❌ Job not found: ${jobId}`);
    if (jobError) {
      console.error(`   Error: ${jobError.message}`);
    }
    console.error("");
    process.exit(1);
  }

  const typedJob = job as Job;

  // Print job status
  console.log("\n" + "═".repeat(80));
  console.log(`📋 Job Status: ${typedJob.id}`);
  console.log("═".repeat(80));
  console.log("");

  // Basic info
  console.log("🔍 Basic Info:");
  console.log(`   State:          ${typedJob.state}`);
  console.log(`   Kind:           ${typedJob.kind}`);
  console.log(`   Workspace ID:   ${typedJob.workspace_id}`);
  console.log(`   Attempts:       ${typedJob.attempts} / ${typedJob.max_attempts}`);
  console.log("");

  // Timestamps
  console.log("📅 Timestamps:");
  console.log(`   Created:        ${formatTimestamp(typedJob.created_at)}`);
  console.log(`   Updated:        ${formatTimestamp(typedJob.updated_at)}`);
  console.log(`   Run At:         ${formatTimestamp(typedJob.run_at)}`);
  if (typedJob.locked_at) {
    console.log(`   Locked At:      ${formatTimestamp(typedJob.locked_at)}`);
  }
  if (typedJob.heartbeat_at) {
    console.log(`   Heartbeat At:   ${formatTimestamp(typedJob.heartbeat_at)}`);
  }
  console.log("");

  // Worker info
  if (typedJob.locked_by) {
    console.log("👷 Worker:");
    console.log(`   Locked By:      ${typedJob.locked_by}`);
    console.log("");
  }

  // Interpretation
  const insights = interpretJobStatus(typedJob);
  if (insights.length > 0) {
    console.log("💡 Analysis:");
    for (const insight of insights) {
      console.log(`   ${insight}`);
    }
    console.log("");
  }

  // Error details
  if (typedJob.last_error || typedJob.error) {
    console.log("❌ Error Details:");
    
    if (typedJob.error) {
      console.log("   Structured Error:");
      console.log(formatJson(typedJob.error, 4).split("\n").map(line => "   " + line).join("\n"));
    }
    
    if (typedJob.last_error) {
      console.log("   Last Error:");
      const errorLines = typedJob.last_error.split("\n");
      for (const line of errorLines.slice(0, 10)) {
        console.log(`   ${line}`);
      }
      if (errorLines.length > 10) {
        console.log(`   ... (${errorLines.length - 10} more lines)`);
      }
    }
    
    console.log("");
  }

  // Payload (truncated)
  if (typedJob.payload) {
    console.log("📦 Payload (preview):");
    const payloadStr = formatJson(typedJob.payload, 2);
    const payloadLines = payloadStr.split("\n");
    
    if (payloadLines.length > 10) {
      console.log(payloadLines.slice(0, 10).map(line => "   " + line).join("\n"));
      console.log(`   ... (${payloadLines.length - 10} more lines, truncated)`);
    } else {
      console.log(payloadStr.split("\n").map(line => "   " + line).join("\n"));
    }
    
    console.log("");
  }

  // Fetch recent job events
  try {
    const { data: events, error: eventsError } = await supabase
      .from("job_events")
      .select("id, stage, data, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!eventsError && events && events.length > 0) {
      console.log("📜 Recent Events (last 5):");
      const typedEvents = events as JobEvent[];
      
      for (const event of typedEvents) {
        const timestamp = formatTimestamp(event.created_at);
        console.log(`   ${timestamp} - ${event.stage}`);
      }
      
      console.log("");
    }
  } catch {
    // job_events table might not exist
  }

  console.log("═".repeat(80));
  console.log("");

  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

