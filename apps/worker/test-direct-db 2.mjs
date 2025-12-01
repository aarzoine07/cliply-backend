import { createClient } from "@supabase/supabase-js";

console.log("TEST: direct DB read");
console.log("URL =", process.env.SUPABASE_URL);
console.log("KEY LENGTH =", process.env.SUPABASE_SERVICE_ROLE_KEY?.length);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Try a direct read from jobs
const { data, error } = await supabase
  .from("jobs")
  .select("id, status, kind, next_run_at")
  .limit(5);

console.log("ERROR =", error);
console.log("DATA =", data);

process.exit(0);
