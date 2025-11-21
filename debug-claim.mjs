import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

// Load the same env the worker uses
dotenv.config({ path: "apps/worker/.env.local" });

console.log("CLAIM DEBUG URL =", process.env.SUPABASE_URL);
console.log(
  "CLAIM DEBUG SERVICE ROLE KEY LENGTH =",
  process.env.SUPABASE_SERVICE_ROLE_KEY?.length
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Show the timestamp we're using in the filter
const nowIso = new Date().toISOString();
console.log("CLAIM DEBUG NOW ISO =", nowIso);

const { data, error } = await supabase
  .from("jobs")
  .select("*")
  .eq("status", "queued")
  .lte("next_run_at", nowIso)
  .order("created_at", { ascending: true })
  .limit(5);

console.log("CLAIM DEBUG ERROR =", error);
console.log("CLAIM DEBUG ROWS =", data);