// @ts-nocheck
import { beforeAll, test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});
let jobId;
beforeAll(async () => {
    console.log("⚙️  Seeding a dummy workspace...");
    const { data: ws, error: wsError } = await client
        .from("workspaces")
        .insert({
        id: crypto.randomUUID(),
        name: "Test Workspace",
        owner_id: "00000000-0000-0000-0000-000000000000", // dummy owner for FK
    })
        .select("id")
        .single();
    if (wsError)
        throw wsError;
    console.log("🏢 Created workspace:", ws.id);
    console.log("⚙️  Seeding a new job for lifecycle test...");
    const { data: job, error: jobError } = await client
        .from("jobs")
        .insert({
        workspace_id: ws.id,
        kind: "TRANSCRIBE",
        status: "queued",
    })
        .select("id")
        .single();
    if (jobError)
        throw jobError;
    jobId = job.id;
    console.log("🧩 Seeded job:", jobId);
});
test("Worker claims, runs, and marks job done", async () => {
    console.log("🚀 Simulating worker claim-run-done lifecycle...");
    // Worker claims job
    const { data: claimData, error: claimError } = await client
        .from("jobs")
        .update({ status: "running" })
        .eq("id", jobId)
        .select("status")
        .single();
    expect(claimError).toBeNull();
    expect(claimData.status).toBe("running");
    console.log("✅ Worker claimed job");
    // Worker completes job successfully
    const { data: doneData, error: doneError } = await client
        .from("jobs")
        .update({ status: "succeeded" })
        .eq("id", jobId)
        .select("status")
        .single();
    expect(doneError).toBeNull();
    expect(doneData.status).toBe("succeeded");
    console.log("✅ Worker marked job succeeded");
});
