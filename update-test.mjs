import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("=== DIRECT UPDATE TEST ===");

const { data: rows } = await supabase
  .from("jobs")
  .select("id, status")
  .eq("status", "queued")
  .limit(1);

if (!rows || rows.length === 0) {
  console.log("No queued rows found");
  process.exit(0);
}

const job = rows[0];
console.log("Attempting to update job ID:", job.id);

const { data, error, status } = await supabase
  .from("jobs")
  .update({ status: "processing" })
  .eq("id", job.id)
  .eq("status", "queued")
  .select();

console.log("HTTP status:", status);
console.log("ERROR:", error);
console.log("DATA:", data);
