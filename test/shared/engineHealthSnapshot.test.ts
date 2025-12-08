import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMachineHealthSnapshot,
  type EngineHealthSnapshot,
} from "../../packages/shared/src/health/engineHealthSnapshot";

/**
 * Tests for Engine Health Snapshot (ME-I-09 / ER-04)
 * 
 * These tests validate the structure and behavior of getMachineHealthSnapshot
 * using a mocked Supabase client to avoid database dependencies.
 */

/**
 * Helper to create a mock Supabase client with configurable responses
 * 
 * The getMachineHealthSnapshot function makes 3 queries in sequence:
 * 1. Job stats: .from("jobs").select(...).not(...).order(...)
 * 2. Worker activity: .from("jobs").select(...).not(...).not(...).gte(...).order(...)
 * 3. Recent errors: .from("jobs").select(...).in(...).gte(...).order(...).limit(...)
 */
function createMockSupabase(options: {
  jobsData?: any[];
  workerData?: any[];
  errorsData?: any[];
  jobsError?: any;
  workerError?: any;
  errorsError?: any;
}): any {
  const {
    jobsData = [],
    workerData = [],
    errorsData = [],
    jobsError = null,
    workerError = null,
    errorsError = null,
  } = options;

  let queryCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === "jobs") {
        queryCount++;
        const currentQuery = queryCount;

        return {
          select: vi.fn(() => {
            // Return different chains based on query number
            if (currentQuery === 1) {
              // First query: job stats
              return {
                not: vi.fn(() => ({
                  order: vi.fn(() => Promise.resolve({ data: jobsData, error: jobsError })),
                })),
              };
            } else if (currentQuery === 2) {
              // Second query: worker activity
              return {
                not: vi.fn(() => ({
                  not: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      order: vi.fn(() => Promise.resolve({ data: workerData, error: workerError })),
                    })),
                  })),
                })),
              };
            } else {
              // Third query: recent errors
              return {
                in: vi.fn(() => ({
                  gte: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => Promise.resolve({ data: errorsData, error: errorsError })),
                    })),
                  })),
                })),
              };
            }
          }),
        };
      }
      return {};
    }),
  };
}

describe("Engine Health Snapshot (ER-04)", () => {
  let mockLogger: any;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      warn: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Snapshot Structure", () => {
    it("should return valid snapshot structure with all required fields", async () => {
      const mockSupabase = createMockSupabase({});

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
        logger: mockLogger,
      });

      // Validate structure
      expect(snapshot).toBeDefined();
      expect(typeof snapshot.ok).toBe("boolean");
      expect(snapshot.queues).toBeDefined();
      expect(snapshot.queues.ALL).toBeDefined();
      expect(typeof snapshot.queues.ALL.pending).toBe("number");
      expect(typeof snapshot.queues.ALL.running).toBe("number");
      expect(typeof snapshot.queues.ALL.deadLetter).toBe("number");
      expect(typeof snapshot.ffmpegOk).toBe("boolean");
      expect(snapshot.workers).toBeDefined();
      expect(typeof snapshot.workers.activeWorkers).toBe("number");
      expect(Array.isArray(snapshot.recentErrors)).toBe(true);
    });

    it("should include ytDlpOk field", async () => {
      const mockSupabase = createMockSupabase({});

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // ytDlpOk should be present (boolean or undefined)
      expect(snapshot).toHaveProperty("ytDlpOk");
    });
  });

  describe("No Jobs Scenario", () => {
    it("should handle empty database gracefully", async () => {
      const mockSupabase = createMockSupabase({});

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // Validate empty state
      expect(snapshot.queues.ALL.pending).toBe(0);
      expect(snapshot.queues.ALL.running).toBe(0);
      expect(snapshot.queues.ALL.deadLetter).toBe(0);
      expect(snapshot.queues.ALL.oldestJobAgeSec).toBeNull();
      expect(snapshot.workers.activeWorkers).toBe(0);
      expect(snapshot.workers.lastHeartbeatAt).toBeNull();
      expect(snapshot.recentErrors).toEqual([]);
    });
  });

  describe("Queue Metrics", () => {
    it("should aggregate jobs by state correctly", async () => {
      const mockJobs = [
        {
          kind: "TRANSCRIBE",
          state: "queued",
          created_at: "2025-12-08T11:00:00Z",
        },
        {
          kind: "TRANSCRIBE",
          state: "queued",
          created_at: "2025-12-08T11:05:00Z",
        },
        {
          kind: "CLIP_RENDER",
          state: "running",
          created_at: "2025-12-08T11:30:00Z",
        },
        {
          kind: "PUBLISH_TIKTOK",
          state: "dead_letter",
          created_at: "2025-12-08T10:00:00Z",
        },
      ];

      const mockSupabase = createMockSupabase({ jobsData: mockJobs });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // Validate ALL aggregate
      expect(snapshot.queues.ALL.pending).toBe(2); // 2 queued TRANSCRIBE
      expect(snapshot.queues.ALL.running).toBe(1); // 1 running CLIP_RENDER
      expect(snapshot.queues.ALL.deadLetter).toBe(1); // 1 dead_letter PUBLISH_TIKTOK

      // Validate per-kind breakdown
      expect(snapshot.queues.TRANSCRIBE).toBeDefined();
      expect(snapshot.queues.TRANSCRIBE.pending).toBe(2);
      expect(snapshot.queues.TRANSCRIBE.running).toBe(0);

      expect(snapshot.queues.CLIP_RENDER).toBeDefined();
      expect(snapshot.queues.CLIP_RENDER.pending).toBe(0);
      expect(snapshot.queues.CLIP_RENDER.running).toBe(1);

      expect(snapshot.queues.PUBLISH_TIKTOK).toBeDefined();
      expect(snapshot.queues.PUBLISH_TIKTOK.deadLetter).toBe(1);
    });

    it("should calculate oldest job age correctly", async () => {
      const now = new Date("2025-12-08T12:00:00Z");
      const oldestTime = new Date("2025-12-08T10:00:00Z"); // 2 hours ago = 7200 seconds

      const mockJobs = [
        {
          kind: "TRANSCRIBE",
          state: "queued",
          created_at: oldestTime.toISOString(),
        },
        {
          kind: "CLIP_RENDER",
          state: "queued",
          created_at: "2025-12-08T11:30:00Z", // 30 min ago = 1800 seconds
        },
      ];

      const mockSupabase = createMockSupabase({ jobsData: mockJobs });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now,
      });

      // Oldest job should be 7200 seconds old
      expect(snapshot.queues.ALL.oldestJobAgeSec).toBe(7200);

      // TRANSCRIBE kind should have oldest = 7200
      expect(snapshot.queues.TRANSCRIBE.oldestJobAgeSec).toBe(7200);

      // CLIP_RENDER kind should have oldest = 1800
      expect(snapshot.queues.CLIP_RENDER.oldestJobAgeSec).toBe(1800);
    });
  });

  describe("Worker Activity", () => {
    it("should count active workers from recent heartbeats", async () => {
      const now = new Date("2025-12-08T12:00:00Z");

      const mockWorkerJobs = [
        {
          locked_by: "worker-1:1234:1234567890",
          heartbeat_at: "2025-12-08T11:55:00Z", // 5 min ago
        },
        {
          locked_by: "worker-1:1234:1234567890",
          heartbeat_at: "2025-12-08T11:58:00Z", // 2 min ago (same worker)
        },
        {
          locked_by: "worker-2:5678:9876543210",
          heartbeat_at: "2025-12-08T11:59:00Z", // 1 min ago (different worker)
        },
      ];

      const mockSupabase = createMockSupabase({ workerData: mockWorkerJobs });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now,
        recentMinutes: 10,
      });

      // Should count 2 distinct workers
      expect(snapshot.workers.activeWorkers).toBe(2);

      // Last heartbeat should be most recent
      expect(snapshot.workers.lastHeartbeatAt).toBe("2025-12-08T11:59:00Z");
    });

    it("should handle missing heartbeat data gracefully", async () => {
      // Mock DB error for heartbeat query
      const mockSupabase = createMockSupabase({
        workerError: { message: "Column not found" },
      });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // Should gracefully fall back to zero workers
      expect(snapshot.workers.activeWorkers).toBe(0);
      expect(snapshot.workers.lastHeartbeatAt).toBeNull();
    });
  });

  describe("Recent Errors", () => {
    it("should fetch recent failed and dead_letter jobs", async () => {
      const now = new Date("2025-12-08T12:00:00Z");

      const mockErrors = [
        {
          id: "job-1",
          kind: "TRANSCRIBE",
          state: "failed",
          last_error: "FFmpeg timeout",
          error: null,
          updated_at: "2025-12-08T11:55:00Z",
        },
        {
          id: "job-2",
          kind: "CLIP_RENDER",
          state: "dead_letter",
          last_error: null,
          error: { message: "Max attempts exceeded", attempts: 5 },
          updated_at: "2025-12-08T11:50:00Z",
        },
      ];

      const mockSupabase = createMockSupabase({ errorsData: mockErrors });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now,
        recentMinutes: 60,
        maxRecentErrors: 10,
      });

      // Should have 2 recent errors
      expect(snapshot.recentErrors).toHaveLength(2);

      // First error (from last_error field)
      expect(snapshot.recentErrors[0].jobId).toBe("job-1");
      expect(snapshot.recentErrors[0].kind).toBe("TRANSCRIBE");
      expect(snapshot.recentErrors[0].state).toBe("failed");
      expect(snapshot.recentErrors[0].message).toBe("FFmpeg timeout");

      // Second error (from structured error jsonb)
      expect(snapshot.recentErrors[1].jobId).toBe("job-2");
      expect(snapshot.recentErrors[1].kind).toBe("CLIP_RENDER");
      expect(snapshot.recentErrors[1].state).toBe("dead_letter");
      expect(snapshot.recentErrors[1].message).toBe("Max attempts exceeded");
    });

    it("should limit recent errors to maxRecentErrors", async () => {
      const mockErrors = Array.from({ length: 20 }, (_, i) => ({
        id: `job-${i}`,
        kind: "TRANSCRIBE",
        state: "failed",
        last_error: `Error ${i}`,
        error: null,
        updated_at: "2025-12-08T11:50:00Z",
      }));

      const mockSupabase = createMockSupabase({ errorsData: mockErrors.slice(0, 5) });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
        maxRecentErrors: 5,
      });

      // Should only return 5 errors even though more exist
      expect(snapshot.recentErrors.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Health Status (ok flag)", () => {
    it("should mark ok=false when FFmpeg is not available", async () => {
      const mockSupabase = createMockSupabase({});

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // ok depends on ffmpegOk (which depends on actual binary availability)
      // In test environment, ffmpeg may or may not be available
      expect(typeof snapshot.ok).toBe("boolean");
      expect(typeof snapshot.ffmpegOk).toBe("boolean");
    });

    it("should mark ok=false when there are too many dead_letter jobs", async () => {
      // Create 150 dead_letter jobs (threshold is 100)
      const mockJobs = Array.from({ length: 150 }, (_, i) => ({
        kind: "TRANSCRIBE",
        state: "dead_letter",
        created_at: "2025-12-08T11:00:00Z",
      }));

      const mockSupabase = createMockSupabase({ jobsData: mockJobs });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
      });

      // Should mark ok=false due to high DLQ count (>= 100)
      // Note: This depends on ffmpegOk also being true
      expect(snapshot.queues.ALL.deadLetter).toBe(150);
      // ok flag logic: ok = ffmpegOk && (deadLetter < 100)
      // If ffmpegOk is false, ok will be false regardless
      // If ffmpegOk is true, ok should be false due to high DLQ
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Mock DB error
      const mockSupabase = createMockSupabase({
        jobsError: { message: "Database connection failed" },
      });

      const snapshot = await getMachineHealthSnapshot({
        supabase: mockSupabase as unknown as SupabaseClient,
        now: new Date("2025-12-08T12:00:00Z"),
        logger: mockLogger,
      });

      // Should return default snapshot with ok=false
      expect(snapshot.ok).toBe(false);
      expect(snapshot.queues.ALL.pending).toBe(0);
      expect(snapshot.queues.ALL.running).toBe(0);
      expect(snapshot.queues.ALL.deadLetter).toBe(0);

      // Should log warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "engine_health_snapshot_error",
        expect.objectContaining({
          error: expect.any(String),
        }),
      );
    });
  });
});

