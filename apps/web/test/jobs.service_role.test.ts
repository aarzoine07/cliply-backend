import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import "dotenv/config";
import { describe, expect, it } from "vitest";

describe("🧱 service-role function verification", () => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const client = createClient(url, key);

  it("worker_claim_next_job runs successfully with service-role", async () => {
    // 1️⃣ seed a queued job
    const jobId = randomUUID();
    const workspaceId = randomUUID();

    const { error: insertErr } = await client.from("jobs").insert({
      id: jobId,
      workspace_id: workspaceId,
      kind: "test",
      state: "queued",
      run_at: new Date().toISOString(),
    });

    expect(insertErr).toBeNull();

    // 2️⃣ call RPC
    const workerId = "test-worker";
    const { data, error } = await client.rpc("worker_claim_next_job", {
      p_worker_id: workerId,
    });

    // 3️⃣ assert RPC succeeds
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data.state).toBe("running");
    expect(data.locked_by).toBe(workerId);
  });
});
