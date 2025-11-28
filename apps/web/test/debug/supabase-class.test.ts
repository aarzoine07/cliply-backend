import { test } from "vitest";
import { createClient } from "@supabase/supabase-js";

test("SUPABASE_CLASS", () => {
  const supabase = createClient("http://localhost:54321", "fake");

  console.log("---- SUPABASE CLASS DEBUG ----");
  console.log("typeof supabase:", typeof supabase);
  console.log(
    "prototype keys:",
    Object.getOwnPropertyNames(Object.getPrototypeOf(supabase))
  );
  console.log(
    "from('x') keys:",
    Object.keys(supabase.from("x"))
  );
});
