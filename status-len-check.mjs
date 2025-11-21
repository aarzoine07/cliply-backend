import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("=== STATUS LENGTH CHECK ===");

const { data, error } = await supabase
  .from("jobs")
  .select("status")
  .limit(20);

console.log("ERROR =", error);
console.log(
  data?.map((j) => ({
    status: j.status,
    len: j.status?.length,
    last_char_code: j.status?.charCodeAt(j.status.length - 1),
  }))
);
