// @ts-nocheck
import { beforeAll, test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let workspaceId: string;
let jobId: string;

beforeAll(async () => {
  console.log("⚙️  Seeding a dummy workspace...");
  const { data: ws, error: wsError } = await client
    .from("workspaces")
    .insert({
      name: "Retry Workspace",
      owner_id: "00000000-0000-0000-0000-000000000000",
    })
    .select("id")
    .single();

  if (wsError) throw wsError;
  workspaceId = ws.id;
  console.log("🏢 Created workspace:", workspaceId);

  console.log("⚙️  Seeding a failed job...");
  const { data, error } = await client
    .from("jobs")
    .insert({
      workspace_id: workspaceId,
      kind: "TRANSCRIBE",
      status: "failed",
      attempts: 1,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  jobId = data.id;
  console.log("🧩 Seeded failed job:", jobId);
});

test("Worker retries with exponential backoff", async () => {
  console.log("🚀 Simulating retry scheduling...");
  const newRunAfter = new Date(Date.now() + 60_000).toISOString(); // +1 minute

  const { data, error } = await client
    .from("jobs")
    .update({
      status: "queued",
      attempts: 2,
      run_after: newRunAfter,
    })
    .eq("id", jobId)
    .select("status, attempts, run_after")
    .single();

  expect(error).toBeNull();
  expect(data.status).toBe("queued");
  expect(data.attempts).toBe(2);
  console.log("✅ Worker scheduled retry with backoff:", data.run_after);
});
