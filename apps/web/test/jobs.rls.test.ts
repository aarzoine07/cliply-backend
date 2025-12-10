// @ts-nocheck
/**
 * Jobs RLS (Row Level Security) Tests
 *
 * Tests to verify that RLS is properly configured for the jobs table:
 * - Service-role client bypasses RLS and can access all jobs
 * - Anon client without valid JWT gets blocked by RLS
 * - Jobs are workspace-scoped for data isolation
 *
 * IMPORTANT: Full cross-workspace isolation testing (User A can't see User B's jobs)
 * would require real Supabase Auth JWTs, which can only be obtained by creating real
 * users via Supabase Auth. This test file focuses on what can be tested without
 * minting arbitrary JWTs.
 *
 * The actual RLS policy (`jobs_all` or `jobs_are_workspace_scoped`) enforces that:
 * - Authenticated users can only access jobs in workspaces they are members of
 * - Service-role can access all jobs (bypasses RLS)
 * - Unauthenticated requests get empty results (RLS blocks access)
 */
import * as crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import "../../../packages/shared/test/loadEnv";
import { getEnv } from "@cliply/shared/env";
import { resetDatabase } from "../../../packages/shared/test/setup";

const env = getEnv();

if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing");
if (!env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY missing");
if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

// Service-role client - bypasses RLS
const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anon client - subject to RLS (no user JWT = blocked)
const anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Use the known test workspace that exists in the database
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

// Track test job IDs for cleanup
const testJobIds: string[] = [];
const testMarker = `rls-test-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

describe("Jobs RLS – Row Level Security", () => {
  beforeAll(async () => {
    await resetDatabase?.();

    // Seed test jobs using service-role (bypasses RLS)
    const jobsToInsert = [
      {
        workspace_id: WORKSPACE_ID,
        kind: "TRANSCRIBE",
        state: "queued",
        payload: { testMarker, index: 0 },
      },
      {
        workspace_id: WORKSPACE_ID,
        kind: "TRANSCRIBE",
        state: "queued",
        payload: { testMarker, index: 1 },
      },
      {
        workspace_id: WORKSPACE_ID,
        kind: "TRANSCRIBE",
        state: "queued",
        payload: { testMarker, index: 2 },
      },
    ];

    const { data, error } = await serviceClient
      .from("jobs")
      .insert(jobsToInsert)
      .select("id");

    if (error) {
      throw new Error(`Failed to seed jobs for RLS test: ${error.message}`);
    }

    if (data) {
      testJobIds.push(...data.map((j) => j.id));
    }
  });

  afterAll(async () => {
    // Clean up test jobs
    if (testJobIds.length > 0) {
      await serviceClient.from("job_events").delete().in("job_id", testJobIds);
      await serviceClient.from("jobs").delete().in("id", testJobIds);
    }
  });

  describe("Service-Role Access (Bypasses RLS)", () => {
    it("service-role can read jobs (bypasses RLS)", async () => {
      // Query all jobs with our test marker
      const { data, error } = await serviceClient
        .from("jobs")
        .select("id, workspace_id, payload")
        .contains("payload", { testMarker });

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      expect(data!.length).toBe(3); // All 3 test jobs

      // Verify all jobs are from our test workspace
      const workspaceJobs = data!.filter((j) => j.workspace_id === WORKSPACE_ID);
      expect(workspaceJobs.length).toBe(3);
    });

    it("service-role can insert jobs (bypasses RLS)", async () => {
      const { data, error } = await serviceClient
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          state: "queued",
          payload: { testMarker, insertTest: true },
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data).toBeTruthy();
      testJobIds.push(data!.id);
    });

    it("service-role can update jobs in any workspace", async () => {
      // Find one of our test jobs
      const { data: jobs } = await serviceClient
        .from("jobs")
        .select("id")
        .contains("payload", { testMarker })
        .limit(1);

      expect(jobs).toBeTruthy();
      expect(jobs!.length).toBeGreaterThan(0);

      const jobId = jobs![0].id;

      // Update it
      const { error } = await serviceClient
        .from("jobs")
        .update({ state: "running" })
        .eq("id", jobId);

      expect(error).toBeNull();
    });
  });

  describe("Anon Client Access (RLS Enforced)", () => {
    it("anon client without JWT gets blocked by RLS", async () => {
      // Without a valid user JWT, the anon client should either:
      // - Get a permission denied error (strict RLS)
      // - Get empty results (lenient RLS)
      // Both are valid ways for RLS to deny access
      const { data, error } = await anonClient
        .from("jobs")
        .select("id")
        .eq("workspace_id", WORKSPACE_ID);

      if (error) {
        // Strict RLS: returns permission denied error
        expect(error.code).toBe("42501"); // PostgreSQL permission denied
        expect(error.message).toContain("permission denied");
      } else {
        // Lenient RLS: returns empty results
        expect(data ?? []).toEqual([]);
      }
    });

    it("anon client cannot insert jobs (RLS blocks)", async () => {
      const { data, error } = await anonClient
        .from("jobs")
        .insert({
          workspace_id: WORKSPACE_ID,
          kind: "TRANSCRIBE",
          state: "queued",
          payload: { testMarker, shouldFail: true },
        })
        .select();

      // RLS should block the insert - either error or empty result
      // Depending on RLS config, this might return an error or just return no rows
      if (error) {
        // Expected: RLS blocked with an error
        expect(error.code).toBeDefined();
      } else {
        // Alternative: RLS silently returned empty (no insert happened)
        expect(data ?? []).toEqual([]);
      }
    });

    it("anon client cannot update jobs (RLS blocks)", async () => {
      // First, verify our test jobs exist via service-role
      const { data: existingJobs } = await serviceClient
        .from("jobs")
        .select("id, state")
        .contains("payload", { testMarker })
        .limit(1);

      expect(existingJobs).toBeTruthy();
      expect(existingJobs!.length).toBeGreaterThan(0);

      const jobId = existingJobs![0].id;
      const originalState = existingJobs![0].state;

      // Try to update via anon client
      const { data: updated } = await anonClient
        .from("jobs")
        .update({ state: "failed" })
        .eq("id", jobId)
        .select();

      // RLS should block - no rows updated (data is null or empty array)
      expect(updated ?? []).toEqual([]);

      // Verify the job wasn't actually changed
      const { data: verifyJob } = await serviceClient
        .from("jobs")
        .select("state")
        .eq("id", jobId)
        .single();

      expect(verifyJob?.state).toBe(originalState);
    });
  });

  describe("Workspace Isolation (Documented Behavior)", () => {
    /**
     * NOTE: Full cross-workspace isolation testing requires real Supabase Auth JWTs.
     *
     * The RLS policy `jobs_all` (or `jobs_are_workspace_scoped`) is designed to:
     * - Allow users to access jobs only in workspaces they are members of
     * - Check auth.uid() against workspace_members table
     *
     * To test this fully, you would need to:
     * 1. Create two real users via Supabase Auth
     * 2. Add them to different workspaces via workspace_members
     * 3. Use their access tokens to verify isolation
     *
     * This is documented as a future enhancement for E2E/integration testing.
     */
    it("verifies RLS is enabled on jobs table", async () => {
      // This is a sanity check that RLS is actually configured
      // The fact that anon client gets empty results proves RLS is working
      const { data: anonResult } = await anonClient
        .from("jobs")
        .select("id")
        .contains("payload", { testMarker });

      const { data: serviceResult } = await serviceClient
        .from("jobs")
        .select("id")
        .contains("payload", { testMarker });

      // Service-role sees jobs, anon doesn't - proves RLS is active
      expect(anonResult ?? []).toEqual([]);
      expect(serviceResult!.length).toBeGreaterThan(0);
    });
  });
});
