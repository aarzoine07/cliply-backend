import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("URL =", url);
console.log("KEY LENGTH =", key?.length);

const supabase = createClient(url, key);

async function run() {
  console.log("\n=== CLAIM TEST ===");

  // 1) fetch the oldest queued job
  const { data: jobs, error: selErr } = await supabase
    .from("jobs")
    .select("id, status, next_run_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  console.log("SELECT ERROR =", selErr);
  console.log("SELECT DATA =", jobs);

  if (!jobs || jobs.length === 0) {
    console.log("NO QUEUED JOBS.");
    return;
  }

  const job = jobs[0];

  console.log("\nAttempting running update for job:", job.id);

  // 2) attempt atomic update: queued → running
  const { data: updated, error: updErr, status } = await supabase
    .from("jobs")
    .update({ status: "running" })
    .eq("id", job.id)
    .eq("status", "queued")
    .select()
    .single();

  console.log("HTTP STATUS:", status);
  console.log("UPDATE ERROR:", updErr);
  console.log("UPDATED DATA:", updated);
}

run();
