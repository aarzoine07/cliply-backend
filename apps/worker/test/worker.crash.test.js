// @ts-nocheck
import { beforeAll, test, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});
let workspaceId;
let jobId;
beforeAll(async () => {
    console.log("⚙️  Seeding a dummy workspace...");
    const { data: ws, error: wsError } = await client
        .from("workspaces")
        .insert({
        name: "Crash Recovery Workspace",
        owner_id: "00000000-0000-0000-0000-000000000000",
    })
        .select("id")
        .single();
    if (wsError)
        throw wsError;
    workspaceId = ws.id;
    console.log("🏢 Created workspace:", workspaceId);
    console.log("⚙️  Seeding a running job (simulating crashed worker)...");
    const { data, error } = await client
        .from("jobs")
        .insert({
        workspace_id: workspaceId,
        kind: "TRANSCRIBE",
        status: "running",
        worker_id: "00000000-0000-0000-0000-00000000DEAD",
        last_heartbeat: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 min ago
        attempts: 1,
        max_attempts: 5,
    })
        .select("id")
        .single();
    if (error)
        throw error;
    jobId = data.id;
    console.log("💀 Seeded stale job:", jobId);
});
test("Worker reclaims stale job after timeout", async () => {
    console.log("🚀 Simulating crash recovery...");
    const { data, error } = await client
        .from("jobs")
        .update({
        status: "queued",
        worker_id: null,
        last_heartbeat: null,
    })
        .eq("id", jobId)
        .eq("status", "running")
        .lt("last_heartbeat", new Date(Date.now() - 10 * 60 * 1000).toISOString()) // older than 10 min
        .select("status, worker_id")
        .single();
    expect(error).toBeNull();
    expect(data.status).toBe("queued");
    expect(data.worker_id).toBeNull();
    console.log("✅ Reclaimed stale job back to queue");
});
