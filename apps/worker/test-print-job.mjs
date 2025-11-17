import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, key);

console.log("=== PRINT JOB SHAPE ===");

const { data, error } = await supabase
  .from("jobs")
  .select("*")
  .order("created_at", { ascending: true })
  .limit(1);

console.log("ERROR =", error);
console.log("JOB =", data && data.length > 0 ? data[0] : null);
