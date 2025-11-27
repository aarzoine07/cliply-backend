// @ts-nocheck
import path from "path";
import * as crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, beforeAll } from "vitest";

// ✅ dotenv loader
const dotenv = require("dotenv");
dotenv.config({ path: "../../.env.test", override: true });
const envPath = path.resolve(process.cwd(), "../../.env.test");
console.log(`✅ dotenv loaded from: ${envPath}`);

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";
const CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";
const VERCEL_AUTOMATION_BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "test-bypass-secret";

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Import handler and core function
import handler from "../../src/pages/api/cron/scan-schedules.ts";
import { scanSchedules } from "../../src/lib/cron/scanSchedules.ts";

describe("POST /api/cron/scan-schedules", () => {
  const TEST_WORKSPACE_ID = crypto.randomUUID();
  const TEST_CLIP_ID_1 = crypto.randomUUID();
  const TEST_CLIP_ID_2 = crypto.randomUUID();
  const TEST_CLIP_ID_3 = crypto.randomUUID();
  const TEST_ACCOUNT_ID_TIKTOK = crypto.randomUUID();
  const TEST_ACCOUNT_ID_YOUTUBE = crypto.randomUUID();

  beforeAll(async () => {
    // Create test workspace
    await adminClient
      .from("workspaces")
      .upsert({
        id: TEST_WORKSPACE_ID,
        name: "Test Workspace",
        owner_id: crypto.randomUUID(), // Dummy owner
      });

    // Create test clips
    await adminClient.from("clips").upsert([
      {
        id: TEST_CLIP_ID_1,
        workspace_id: TEST_WORKSPACE_ID,
        project_id: crypto.randomUUID(),
        title: "Test Clip 1",
        status: "ready",
      },
      {
        id: TEST_CLIP_ID_2,
        workspace_id: TEST_WORKSPACE_ID,
        project_id: crypto.randomUUID(),
        title: "Test Clip 2",
        status: "ready",
      },
      {
        id: TEST_CLIP_ID_3,
        workspace_id: TEST_WORKSPACE_ID,
        project_id: crypto.randomUUID(),
        title: "Test Clip 3",
        status: "ready",
      },
    ]);

    // Create test connected accounts
    await adminClient.from("connected_accounts").upsert([
      {
        id: TEST_ACCOUNT_ID_TIKTOK,
        workspace_id: TEST_WORKSPACE_ID,
        platform: "tiktok",
        provider: "tiktok",
        external_id: "tiktok-test-123",
        status: "active",
      },
      {
        id: TEST_ACCOUNT_ID_YOUTUBE,
        workspace_id: TEST_WORKSPACE_ID,
        platform: "youtube",
        provider: "youtube",
        external_id: "youtube-test-123",
        status: "active",
      },
    ]);

    // Create publish config with default accounts
    await adminClient.from("publish_config").upsert([
      {
        workspace_id: TEST_WORKSPACE_ID,
        platform: "tiktok",
        default_connected_account_ids: [TEST_ACCOUNT_ID_TIKTOK],
        enabled: true,
      },
      {
        workspace_id: TEST_WORKSPACE_ID,
        platform: "youtube",
        default_connected_account_ids: [TEST_ACCOUNT_ID_YOUTUBE],
        enabled: true,
      },
    ]);
  });

  describe("Auth & Protection", () => {
    it("returns 405 for non-POST methods", async () => {
      const mockReq = { method: "GET", headers: {} };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(405);
    });

    it("returns 403 without auth", async () => {
      const mockReq = { method: "POST", headers: {} };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(403);
    });

    it("returns 200 with CRON_SECRET auth", async () => {
      const mockReq = {
        method: "POST",
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(200);
    });

    it("returns 200 with VERCEL_AUTOMATION_BYPASS_SECRET in header", async () => {
      const mockReq = {
        method: "POST",
        headers: { "x-cron-secret": VERCEL_AUTOMATION_BYPASS_SECRET },
        url: "http://localhost/api/cron/scan-schedules",
      };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(200);
    });

    it("returns 200 with VERCEL_AUTOMATION_BYPASS_SECRET in query param", async () => {
      const mockReq = {
        method: "POST",
        headers: {},
        url: `http://localhost/api/cron/scan-schedules?secret=${VERCEL_AUTOMATION_BYPASS_SECRET}`,
      };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(200);
    });

    it("returns 403 with invalid secret", async () => {
      const mockReq = {
        method: "POST",
        headers: { "x-cron-secret": "invalid-secret" },
        url: "http://localhost/api/cron/scan-schedules",
      };
      let statusCode: number | undefined;
      const mockRes = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      };

      await handler(mockReq, mockRes);
      expect(statusCode).toBe(403);
    });
  });

  describe("Happy Path", () => {
    it("claims schedules and enqueues jobs", async () => {
      // Clean up any existing schedules and jobs
      await adminClient.from("jobs").delete().eq("workspace_id", TEST_WORKSPACE_ID);
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      // Create due schedules (run_at in the past)
      const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      const { data: schedules } = await adminClient
        .from("schedules")
        .insert([
          {
            workspace_id: TEST_WORKSPACE_ID,
            clip_id: TEST_CLIP_ID_1,
            run_at: pastTime,
            status: "scheduled",
            platform: "tiktok",
          },
          {
            workspace_id: TEST_WORKSPACE_ID,
            clip_id: TEST_CLIP_ID_2,
            run_at: pastTime,
            status: "scheduled",
            platform: "youtube",
          },
        ])
        .select();

      expect(schedules).toBeTruthy();
      expect(schedules?.length).toBe(2);

      // Call scan function
      const result = await scanSchedules(adminClient);

      expect(result.claimed).toBe(2);
      expect(result.enqueued).toBeGreaterThanOrEqual(2);
      expect(result.enqueued_tiktok).toBe(1);
      expect(result.enqueued_youtube).toBe(1);

      // Verify schedules are now executed
      const { data: updatedSchedules } = await adminClient
        .from("schedules")
        .select("status")
        .in("id", schedules!.map((s) => s.id));

      expect(updatedSchedules).toBeTruthy();
      updatedSchedules?.forEach((s) => {
        expect(s.status).toBe("executed");
      });

      // Verify jobs were created
      const { data: jobs } = await adminClient
        .from("jobs")
        .select("kind, payload")
        .eq("workspace_id", TEST_WORKSPACE_ID)
        .in("kind", ["PUBLISH_TIKTOK", "PUBLISH_YOUTUBE"]);

      expect(jobs).toBeTruthy();
      expect(jobs?.length).toBeGreaterThanOrEqual(2);

      const tiktokJobs = jobs?.filter((j) => j.kind === "PUBLISH_TIKTOK");
      const youtubeJobs = jobs?.filter((j) => j.kind === "PUBLISH_YOUTUBE");

      expect(tiktokJobs?.length).toBe(1);
      expect(youtubeJobs?.length).toBe(1);
    });
  });

  describe("Idempotency", () => {
    it("does not create duplicate jobs on second call", async () => {
      // Clean up
      await adminClient.from("jobs").delete().eq("workspace_id", TEST_WORKSPACE_ID);
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      // Create one due schedule
      const pastTime = new Date(Date.now() - 60000).toISOString();
      const { data: schedule } = await adminClient
        .from("schedules")
        .insert({
          workspace_id: TEST_WORKSPACE_ID,
          clip_id: TEST_CLIP_ID_3,
          run_at: pastTime,
          status: "scheduled",
          platform: "youtube",
        })
        .select()
        .single();

      expect(schedule).toBeTruthy();

      // First call
      const result1 = await scanSchedules(adminClient);
      expect(result1.claimed).toBe(1);
      expect(result1.enqueued).toBe(1);

      // Get job count after first call
      const { data: jobs1 } = await adminClient
        .from("jobs")
        .select("id")
        .eq("workspace_id", TEST_WORKSPACE_ID)
        .eq("kind", "PUBLISH_YOUTUBE");
      const jobCount1 = jobs1?.length || 0;

      // Second call - should find nothing to claim
      const result2 = await scanSchedules(adminClient);
      expect(result2.claimed).toBe(0);
      expect(result2.enqueued).toBe(0);

      // Job count should be unchanged
      const { data: jobs2 } = await adminClient
        .from("jobs")
        .select("id")
        .eq("workspace_id", TEST_WORKSPACE_ID)
        .eq("kind", "PUBLISH_YOUTUBE");
      const jobCount2 = jobs2?.length || 0;

      expect(jobCount2).toBe(jobCount1);
    });
  });

  describe("Platform Routing", () => {
    it("routes TikTok schedules to PUBLISH_TIKTOK jobs", async () => {
      // Clean up
      await adminClient.from("jobs").delete().eq("workspace_id", TEST_WORKSPACE_ID);
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      const pastTime = new Date(Date.now() - 60000).toISOString();
      await adminClient.from("schedules").insert({
        workspace_id: TEST_WORKSPACE_ID,
        clip_id: TEST_CLIP_ID_1,
        run_at: pastTime,
        status: "scheduled",
        platform: "tiktok",
      });

      const result = await scanSchedules(adminClient);
      expect(result.enqueued_tiktok).toBe(1);
      expect(result.enqueued_youtube).toBe(0);

      const { data: jobs } = await adminClient
        .from("jobs")
        .select("kind")
        .eq("workspace_id", TEST_WORKSPACE_ID);

      const tiktokJobs = jobs?.filter((j) => j.kind === "PUBLISH_TIKTOK");
      expect(tiktokJobs?.length).toBe(1);
    });

    it("routes YouTube schedules to PUBLISH_YOUTUBE jobs", async () => {
      // Clean up
      await adminClient.from("jobs").delete().eq("workspace_id", TEST_WORKSPACE_ID);
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      const pastTime = new Date(Date.now() - 60000).toISOString();
      await adminClient.from("schedules").insert({
        workspace_id: TEST_WORKSPACE_ID,
        clip_id: TEST_CLIP_ID_2,
        run_at: pastTime,
        status: "scheduled",
        platform: "youtube",
      });

      const result = await scanSchedules(adminClient);
      expect(result.enqueued_tiktok).toBe(0);
      expect(result.enqueued_youtube).toBe(1);

      const { data: jobs } = await adminClient
        .from("jobs")
        .select("kind")
        .eq("workspace_id", TEST_WORKSPACE_ID);

      const youtubeJobs = jobs?.filter((j) => j.kind === "PUBLISH_YOUTUBE");
      expect(youtubeJobs?.length).toBe(1);
    });
  });

  describe("Error Resilience", () => {
    it("handles schedules without platform gracefully", async () => {
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      const pastTime = new Date(Date.now() - 60000).toISOString();
      await adminClient.from("schedules").insert({
        workspace_id: TEST_WORKSPACE_ID,
        clip_id: TEST_CLIP_ID_1,
        run_at: pastTime,
        status: "scheduled",
        platform: null, // No platform
      });

      const result = await scanSchedules(adminClient);
      expect(result.claimed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.enqueued).toBe(0);
    });

    it("handles schedules without accounts gracefully", async () => {
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);
      // Delete accounts temporarily
      await adminClient
        .from("connected_accounts")
        .delete()
        .eq("workspace_id", TEST_WORKSPACE_ID);

      const pastTime = new Date(Date.now() - 60000).toISOString();
      await adminClient.from("schedules").insert({
        workspace_id: TEST_WORKSPACE_ID,
        clip_id: TEST_CLIP_ID_1,
        run_at: pastTime,
        status: "scheduled",
        platform: "tiktok",
      });

      const result = await scanSchedules(adminClient);
      expect(result.claimed).toBe(1);
      expect(result.skipped).toBeGreaterThanOrEqual(1);

      // Restore accounts
      await adminClient.from("connected_accounts").upsert([
        {
          id: TEST_ACCOUNT_ID_TIKTOK,
          workspace_id: TEST_WORKSPACE_ID,
          platform: "tiktok",
          provider: "tiktok",
          external_id: "tiktok-test-123",
          status: "active",
        },
        {
          id: TEST_ACCOUNT_ID_YOUTUBE,
          workspace_id: TEST_WORKSPACE_ID,
          platform: "youtube",
          provider: "youtube",
          external_id: "youtube-test-123",
          status: "active",
        },
      ]);
    });
  });

  describe("Future Schedules", () => {
    it("skips schedules with future run_at", async () => {
      await adminClient.from("schedules").delete().eq("workspace_id", TEST_WORKSPACE_ID);

      const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour in future
      await adminClient.from("schedules").insert({
        workspace_id: TEST_WORKSPACE_ID,
        clip_id: TEST_CLIP_ID_1,
        run_at: futureTime,
        status: "scheduled",
        platform: "youtube",
      });

      const result = await scanSchedules(adminClient);
      expect(result.claimed).toBe(0);
      expect(result.enqueued).toBe(0);
    });
  });
});
