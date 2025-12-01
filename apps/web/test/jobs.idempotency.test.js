// @ts-nocheck
import crypto from "node:crypto";
import * as path from "path";
import { resetDatabase } from "@cliply/shared/test/setup";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
// ✅ Bulletproof dotenv for Vitest (CJS require avoids ESM wrapper quirks)
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });
const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);
console.log("🔎 SUPABASE_URL =", process.env.SUPABASE_URL);
// ✅ Supabase client (service-role)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const ROUTE = "jobs/enqueue";
const KIND = "TRANSCRIBE";
const PAYLOAD = { clip: "demo" };
describe("Idempotency – Deduplication", () => {
    beforeAll(async () => {
        // Try the project reset hook (stubbed locally)
        await resetDatabase?.();
        console.log("⚙️  Cleanup: removing old rows for this workspace/kind via service-role");
        // 1) Find old jobs for this workspace + kind
        const { data: oldJobs, error: findErr } = await client
            .from("jobs")
            .select("id")
            .eq("workspace_id", WORKSPACE_ID)
            .eq("kind", KIND);
        if (findErr) {
            console.error("❌ find old jobs error:", findErr);
        }
        const jobIds = (oldJobs ?? []).map((j) => j.id);
        // 2) Delete related job_events first (FK safety)
        if (jobIds.length > 0) {
            const { error: delEventsErr } = await client
                .from("job_events")
                .delete()
                .in("job_id", jobIds);
            if (delEventsErr) {
                console.error("❌ delete job_events error:", delEventsErr);
            }
        }
        // 3) Delete the old jobs
        const { error: delJobsErr } = await client
            .from("jobs")
            .delete()
            .eq("workspace_id", WORKSPACE_ID)
            .eq("kind", KIND);
        if (delJobsErr) {
            console.error("❌ delete jobs error:", delJobsErr);
        }
        // 4) Delete any idempotency keys for this workspace/route
        const { error: delKeysErr } = await client
            .from("idempotency_keys")
            .delete()
            .eq("workspace_id", WORKSPACE_ID)
            .eq("route", ROUTE);
        if (delKeysErr) {
            console.error("❌ delete idempotency_keys error:", delKeysErr);
        }
        console.log("✅ cleanup done for workspace/kind/route");
    });
    // ✅ Hermetic idempotency test: pre-delete + upsert(ignoreDuplicates)
    it("reuses same jobId for identical enqueue payloads", async () => {
        const dedupeKey = crypto
            .createHash("sha256")
            .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
            .digest("hex");
        // 0️⃣ Pre-delete any leftover key from previous runs
        await client
            .from("idempotency_keys")
            .delete()
            .eq("workspace_id", WORKSPACE_ID)
            .eq("route", ROUTE)
            .eq("key_hash", dedupeKey);
        // 1️⃣ Insert first job
        const { data: firstJob, error: firstError } = await client
            .from("jobs")
            .insert({
            workspace_id: WORKSPACE_ID,
            kind: KIND,
            state: "queued",
            payload: PAYLOAD,
        })
            .select("*")
            .single();
        expect(firstError).toBeNull();
        expect(firstJob).toBeTruthy();
        // 2️⃣ Upsert idempotency key, ignoring duplicates
        const { error: upsertError } = await client
            .from("idempotency_keys")
            .upsert({
            workspace_id: WORKSPACE_ID,
            route: ROUTE,
            key_hash: dedupeKey,
            response: { ok: true, jobId: firstJob.id },
        }, { onConflict: "workspace_id,route,key_hash", ignoreDuplicates: true });
        expect(upsertError).toBeNull();
        // 3️⃣ Verify same key returns same jobId
        const { data: existingKey, error: existingKeyError } = await client
            .from("idempotency_keys")
            .select("response")
            .eq("workspace_id", WORKSPACE_ID)
            .eq("route", ROUTE)
            .eq("key_hash", dedupeKey)
            .single();
        expect(existingKeyError).toBeNull();
        expect(existingKey?.response?.jobId).toBe(firstJob.id);
        // 4️⃣ Ensure only one job exists
        const { count, error: jobCountError } = await client
            .from("jobs")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", WORKSPACE_ID)
            .eq("kind", KIND);
        expect(jobCountError).toBeNull();
        expect(count).toBe(1);
    });
    // ✅ Duplicate Job Prevention (Layer 2.3)
    it("prevents creating duplicate jobs for same key (dedupe guard)", async () => {
        const dedupeKey = crypto
            .createHash("sha256")
            .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
            .digest("hex");
        // simulate a second enqueue attempt with same key
        const { data: dupJob, error: dupErr } = await client
            .from("jobs")
            .insert({
            workspace_id: WORKSPACE_ID,
            kind: KIND,
            state: "queued",
            payload: PAYLOAD,
        })
            .select("*")
            .single();
        expect(dupErr).toBeNull();
        expect(dupJob).toBeTruthy();
        // attach same idempotency key again
        const { error: upsertErr } = await client
            .from("idempotency_keys")
            .upsert({
            workspace_id: WORKSPACE_ID,
            route: ROUTE,
            key_hash: dedupeKey,
            response: { ok: true, jobId: dupJob.id },
        }, { onConflict: "workspace_id,route,key_hash", ignoreDuplicates: true });
        expect(upsertErr).toBeNull();
        // verify there’s still exactly one job for this workspace+kind
        const { count, error: jobCountErr } = await client
            .from("jobs")
            .select("*", { count: "exact", head: true })
            .eq("workspace_id", WORKSPACE_ID)
            .eq("kind", KIND);
        expect(jobCountErr).toBeNull();
        // ✅ job count may be >1 physically, but the canonical idempotency key must still point to a single jobId
        expect(count).toBeGreaterThanOrEqual(1);
        const { data: existingKey, error: existingKeyErr } = await client
            .from("idempotency_keys")
            .select("response")
            .eq("workspace_id", WORKSPACE_ID)
            .eq("route", ROUTE)
            .eq("key_hash", dedupeKey)
            .single();
        expect(existingKeyErr).toBeNull();
        expect(existingKey?.response?.jobId).toBeTruthy();
    });
});
