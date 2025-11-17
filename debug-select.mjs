import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: "apps/worker/.env.local" });

console.log("DEBUG URL =", process.env.SUPABASE_URL);
console.log("DEBUG KEY LENGTH =", process.env.SUPABASE_SERVICE_ROLE_KEY?.length);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("Running SELECT...");

const { data, error } = await supabase
  .from("jobs")
  .select("*")
  .eq("status", "queued")
  .limit(5);

console.log("ERROR =", error);
console.log("DATA =", data);