// apps/web/test/jobs.enqueue.test.ts

import { test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
// Use relative path instead of alias to avoid TS "Cannot find module" error
import { env } from "../../../packages/shared/test/setup";

const SERVICE_CLIENT = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

test("⚙️ Enqueue API Functionality > creates a new queued job with correct defaults", async () => {
  const workspaceId = "00000000-0000-0000-0000-000000000001";

  const { data, error } = await SERVICE_CLIENT
    .from("jobs")
    .insert({
      workspace_id: workspaceId,
      kind: "TRANSCRIBE",
      payload: { clip: "demo" },
      // optional, but matches how other tests think about input/payload
      input: { a: 1 },
    })
    .select()
    .single();

  console.log("insert error:", error);
  console.log("insert data:", data);

  expect(error).toBeNull();
  expect(data).toBeTruthy();
  expect(data.workspace_id).toBe(workspaceId);
  expect(data.kind).toBe("TRANSCRIBE");
  expect(data.state).toBe("queued"); // default from schema
  // if your schema also has status defaulting to "queued", you can add:
  // expect(data.status).toBe("queued");
});

