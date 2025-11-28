// apps/web/test/jobs.enqueue.test.ts

import { test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env, resetDatabase } from "@cliply/shared/test/setup";

const SERVICE_CLIENT = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

test("⚙️ Enqueue API Functionality > creates a new queued job with correct defaults", async () => {
  // Reset DB is already handled globally, but keeping in test is safe.

  const { data, error } = await SERVICE_CLIENT
    .from("jobs")
    .insert({
      name: "test_job",
      input: { a: 1 },
      workspace_id: "123e4567-e89b-12d3-a456-426614174000",
    })
    .select()
    .single();

  console.log("insert error:", error);
  console.log("insert data:", data);

  expect(error).toBeNull();
  expect(data.state).toBe("queued");
  expect(data.priority).toBe(5);
  expect(data.name).toBe("test_job");
});