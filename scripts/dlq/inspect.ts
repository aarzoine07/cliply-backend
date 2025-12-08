/**
 * DLQ Inspect CLI - Inspect a specific dead-letter job
 * 
 * Usage:
 *   pnpm dlq:inspect <jobId>
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
Usage: pnpm dlq:inspect <jobId>

Inspect detailed information for a specific job.

Arguments:
  jobId           UUID of the job to inspect

Examples:
  pnpm dlq:inspect abc123-def456-789012
  pnpm dlq:inspect $(pnpm dlq:list | head -1 | awk '{print $1}')

Related commands:
  pnpm dlq:list              List all dead-letter jobs
  pnpm dlq:requeue <jobId>   Requeue a dead-letter job
  pnpm jobs:status <jobId>   Check job status (works for any job state)
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
    console.error(`❌ Job not found: ${jobId}`);
    if (jobError) {
      console.error(`   Error: ${jobError.message}`);
    }
    process.exit(1);
  }

  const typedJob = job as Job;

  // Print job details
  console.log("\n" + "═".repeat(80));
  console.log(`📋 Job: ${typedJob.id}`);
  console.log("═".repeat(80));
  console.log("");

  // Status section
  console.log("🔍 Status:");
  console.log(`   State:          ${typedJob.state}`);
  if (typedJob.state === "dead_letter") {
    console.log("   ⚠️  This job is in the DEAD-LETTER QUEUE");
    console.log("   ℹ️  Use 'pnpm dlq:requeue <jobId>' to retry");
  }
  console.log(`   Kind:           ${typedJob.kind}`);
  console.log(`   Attempts:       ${typedJob.attempts} / ${typedJob.max_attempts}`);
  console.log(`   Workspace ID:   ${typedJob.workspace_id}`);
  console.log("");

  // Timestamps section
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

  // Worker section (if locked)
  if (typedJob.locked_by) {
    console.log("👷 Worker:");
    console.log(`   Locked By:      ${typedJob.locked_by}`);
    console.log("");
  }

  // Error section
  if (typedJob.last_error || typedJob.error) {
    console.log("❌ Error Details:");
    
    if (typedJob.error) {
      console.log("   Structured Error (from 'error' column):");
      console.log(formatJson(typedJob.error, 4).split("\n").map(line => "   " + line).join("\n"));
    }
    
    if (typedJob.last_error) {
      console.log("   Last Error (text):");
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

  // Payload section
  if (typedJob.payload) {
    console.log("📦 Payload:");
    const payloadStr = formatJson(typedJob.payload, 2);
    const payloadLines = payloadStr.split("\n");
    
    if (payloadLines.length > 20) {
      console.log(payloadLines.slice(0, 20).map(line => "   " + line).join("\n"));
      console.log(`   ... (${payloadLines.length - 20} more lines, truncated)`);
    } else {
      console.log(payloadStr.split("\n").map(line => "   " + line).join("\n"));
    }
    
    console.log("");
  }

  // Fetch job events (if table exists)
  try {
    const { data: events, error: eventsError } = await supabase
      .from("job_events")
      .select("id, stage, data, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!eventsError && events && events.length > 0) {
      console.log("📜 Recent Events (last 10):");
      const typedEvents = events as JobEvent[];
      
      for (const event of typedEvents) {
        const timestamp = formatTimestamp(event.created_at);
        console.log(`   ${timestamp} - ${event.stage}`);
        
        if (event.data) {
          const dataStr = formatJson(event.data, 4);
          const dataLines = dataStr.split("\n");
          for (const line of dataLines.slice(0, 3)) {
            console.log(`      ${line}`);
          }
          if (dataLines.length > 3) {
            console.log("      ...");
          }
        }
      }
      
      console.log("");
    }
  } catch {
    // job_events table might not exist, silently skip
  }

  console.log("═".repeat(80));
  console.log("");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

