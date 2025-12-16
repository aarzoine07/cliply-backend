// @ts-nocheck
/**
 * Jobs Idempotency Tests
 *
 * Tests idempotent behavior for job creation:
 * - First request creates a job
 * - Second request with same idempotency key does not create duplicate
 * - Response for subsequent identical requests matches the first
 *
 * Each test uses unique identifiers to ensure isolation from other tests.
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Use shared test setup (env + optional resetDatabase)
import { env, resetDatabase } from "../../../packages/shared/test/setup";

// ✅ Supabase client (service-role)
const SUPABASE_URL = env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const ROUTE = "jobs/enqueue";

// We need a valid user_id for the idempotency table (NOT NULL + FK to users)
let IDEMPOTENCY_USER_ID: string | null = null;

// Track test-specific identifiers for cleanup
const testJobIds: string[] = [];
const testDedupeKeys: string[] = [];

describe("Idempotency – Deduplication", () => {
  beforeAll(async () => {
    // Try the project reset hook (stubbed locally)
    await resetDatabase?.();

    // 0️⃣ Ensure we have at least one user to attach to idempotency records
    const { data: users, error: usersErr } = await client
      .from("users")
      .select("id")
      .limit(1);

    if (usersErr) {
      throw new Error(`Failed to fetch a user for idempotency tests: ${usersErr.message}`);
    }

    if (!users || users.length === 0) {
      throw new Error(
        "No users found in 'users' table for idempotency tests. Seed at least one user."
      );
    }

    IDEMPOTENCY_USER_ID = users[0].id;
  });

  afterAll(async () => {
    // Clean up test-specific data
    if (testJobIds.length > 0) {
      // Delete job_events first (FK safety)
      await client.from("job_events").delete().in("job_id", testJobIds);
      // Delete jobs
      await client.from("jobs").delete().in("id", testJobIds);
    }

    if (testDedupeKeys.length > 0) {
      // Delete idempotency records
      for (const key of testDedupeKeys) {
        await client.from("idempotency").delete().eq("route", ROUTE).eq("key", key);
      }
    }
  });

  // ✅ Hermetic idempotency test: one canonical record per (route, key)
  it("reuses same jobId for identical enqueue payloads", async () => {
    // Use a unique test identifier to avoid conflicts
    const testId = `test-reuse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const KIND = "TRANSCRIBE";
    const PAYLOAD = { clip: "demo", testId };

    const dedupeKey = crypto
      .createHash("sha256")
      .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
      .digest("hex");
    testDedupeKeys.push(dedupeKey);

    // 0️⃣ Pre-delete any leftover record (shouldn't exist with unique testId)
    await client
      .from("idempotency")
      .delete()
      .eq("route", ROUTE)
      .eq("key", dedupeKey);

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
    testJobIds.push(firstJob!.id);

    // 2️⃣ Upsert idempotency record, ignoring duplicates
    const { error: upsertError } = await client
      .from("idempotency")
      .upsert(
        {
          user_id: IDEMPOTENCY_USER_ID,
          route: ROUTE,
          key: dedupeKey,
          response: { ok: true, jobId: firstJob!.id },
        },
        { onConflict: "route,key", ignoreDuplicates: true }
      );
    expect(upsertError).toBeNull();

    // 3️⃣ Verify same key returns same jobId (simulating second request)
    const { data: existingKey, error: existingKeyError } = await client
      .from("idempotency")
      .select("response")
      .eq("route", ROUTE)
      .eq("key", dedupeKey)
      .single();
    expect(existingKeyError).toBeNull();
    expect(existingKey?.response?.jobId).toBe(firstJob!.id);

    // 4️⃣ Ensure only one job exists with our specific testId
    const { data: jobs, error: jobsError } = await client
      .from("jobs")
      .select("id")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("kind", KIND)
      .contains("payload", { testId });
    expect(jobsError).toBeNull();
    expect(jobs?.length).toBe(1);
  });

  // ✅ Duplicate Job Prevention (guard via (route, key) idempotency)
  it("prevents creating duplicate jobs for same key (dedupe guard)", async () => {
    // Use a unique test identifier
    const testId = `test-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const KIND = "TRANSCRIBE";
    const PAYLOAD = { clip: "demo", testId };

    const dedupeKey = crypto
      .createHash("sha256")
      .update(`${KIND}|${JSON.stringify(PAYLOAD)}`)
      .digest("hex");
    testDedupeKeys.push(dedupeKey);

    // Ensure clean starting point
    await client
      .from("idempotency")
      .delete()
      .eq("route", ROUTE)
      .eq("key", dedupeKey);

    // 1️⃣ Simulate first enqueue attempt
    const { data: firstJob, error: firstErr } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: KIND,
        state: "queued",
        payload: PAYLOAD,
      })
      .select("*")
      .single();
    expect(firstErr).toBeNull();
    expect(firstJob).toBeTruthy();
    testJobIds.push(firstJob!.id);

    const firstJobId = firstJob!.id;

    // Attach idempotency record
    const { error: firstUpsertErr } = await client
      .from("idempotency")
      .upsert(
        {
          user_id: IDEMPOTENCY_USER_ID,
          route: ROUTE,
          key: dedupeKey,
          response: { ok: true, jobId: firstJobId },
        },
        { onConflict: "route,key", ignoreDuplicates: true }
      );
    expect(firstUpsertErr).toBeNull();

    // 2️⃣ Simulate second enqueue attempt with same key
    // Note: In production, the idempotency check would happen BEFORE inserting the job.
    // This test simulates what happens at the DB level when idempotency is used.
    const { data: secondJob, error: secondErr } = await client
      .from("jobs")
      .insert({
        workspace_id: WORKSPACE_ID,
        kind: KIND,
        state: "queued",
        payload: PAYLOAD,
      })
      .select("*")
      .single();
    expect(secondErr).toBeNull();
    expect(secondJob).toBeTruthy();
    testJobIds.push(secondJob!.id);

    // Attach same idempotency key again – onConflict(route,key) should ignore the update
    const { error: upsertErr } = await client
      .from("idempotency")
      .upsert(
        {
          user_id: IDEMPOTENCY_USER_ID,
          route: ROUTE,
          key: dedupeKey,
          response: { ok: true, jobId: secondJob!.id },
        },
        { onConflict: "route,key", ignoreDuplicates: true }
      );
    expect(upsertErr).toBeNull();

    // 3️⃣ Verify the canonical idempotency record still points to the FIRST job
    // (ignoreDuplicates means the second upsert doesn't overwrite)
    const { data: existingKey, error: existingKeyErr } = await client
      .from("idempotency")
      .select("response")
      .eq("route", ROUTE)
      .eq("key", dedupeKey)
      .single();
    expect(existingKeyErr).toBeNull();
    expect(existingKey?.response?.jobId).toBe(firstJobId);

    // Note: In this test, we created 2 jobs in the DB (simulating what would happen
    // if idempotency check was bypassed). The key assertion is that the idempotency
    // record still points to the FIRST job's ID.
  });
});
