/**
 * DLQ Requeue CLI - Requeue a dead-letter job back to pending state
 * 
 * Usage:
 *   pnpm dlq:requeue <jobId>
 */

import "dotenv/config";
import { createServiceSupabaseClient } from "../_shared/supabaseClient.js";
import { requeueDeadLetterJob } from "../../apps/worker/src/lib/jobAdmin.js";

function parseArgs(): string | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`
Usage: pnpm dlq:requeue <jobId>

Requeue a job from the dead-letter queue back to pending state.

⚠️  WARNING: Only requeue jobs if you have:
   1. Understood the root cause of the failure
   2. Deployed a fix or confirmed it was a transient issue
   3. Verified the job won't immediately fail again

Arguments:
  jobId           UUID of the job to requeue

Examples:
  pnpm dlq:requeue abc123-def456-789012

Related commands:
  pnpm dlq:list              List all dead-letter jobs
  pnpm dlq:inspect <jobId>   View detailed job info before requeuing
  pnpm jobs:status <jobId>   Check job status after requeuing
    `);
    return null;
  }

  return args[0];
}

async function main() {
  const jobId = parseArgs();

  if (!jobId) {
    process.exit(0);
  }

  const supabase = createServiceSupabaseClient();

  console.log(`\n🔄 Requeuing job: ${jobId}...`);

  try {
    // Attempt to requeue the job
    await requeueDeadLetterJob({
      supabaseClient: supabase,
      jobId,
    });

    console.log(`✅ Successfully requeued job ${jobId}`);
    console.log("");
    console.log("   State:    dead_letter → queued");
    console.log("   Attempts: reset to 0");
    console.log("   Run At:   now (eligible for immediate processing)");
    console.log("");
    console.log("💡 Next steps:");
    console.log(`   pnpm jobs:status ${jobId}   Monitor job status`);
    console.log("   pnpm jobs:stats             Check overall queue health");
    console.log("");

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Failed to requeue job: ${message}`);
    console.error("");
    
    if (message.includes("not found")) {
      console.error("💡 Tip: Verify the job ID is correct:");
      console.error("   pnpm dlq:list");
    } else if (message.includes("current state")) {
      console.error("💡 Tip: This job is not in dead_letter state.");
      console.error("   Use 'pnpm jobs:status <jobId>' to check its current state.");
    }
    
    console.error("");
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Fatal error: ${message}`);
  process.exit(1);
});

