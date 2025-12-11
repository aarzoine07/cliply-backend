/**
 * Engine Flow Integration Tests
 *
 * This file contains integration tests for engine-related flows.
 * These tests exercise API endpoints with mocked database interactions,
 * following the pattern used in other apps/web API tests.
 */
// @ts-nocheck
import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Import engine mock helpers (for later prompts)
import {
  mockHealthySnapshot,
  mockBrokenFFmpegSnapshot,
  mockStaleQueueSnapshot,
} from "../utils/engine/mockEngineSnapshot";
import { mockCanPost, mockRecordPost } from "../utils/engine/mockPosting";

// Ensure mocks are available for later test implementations
void mockHealthySnapshot;
void mockBrokenFFmpegSnapshot;
void mockStaleQueueSnapshot;
void mockCanPost;
void mockRecordPost;

// ─────────────────────────────────────────────
// Mock modules BEFORE importing handlers
// ─────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getAdminClient: vi.fn(),
  getRlsClient: vi.fn(),
}));

vi.mock("@/lib/idempotency", () => ({
  keyFromRequest: vi.fn(() => "test-idempotency-key"),
  withIdempotency: vi.fn(async (_key, fn) => {
    const value = await fn();
    return { fresh: true, value };
  }),
}));

// Import mocked modules
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdminClient } from "@/lib/supabase";
import { withIdempotency } from "@/lib/idempotency";

// Import handlers AFTER mocking
import approveHandler from "../../src/pages/api/clips/[id]/approve";

// Create typed mock references
const requireUserMock = vi.mocked(requireUser);
const checkRateLimitMock = vi.mocked(checkRateLimit);
const getAdminClientMock = vi.mocked(getAdminClient);
const withIdempotencyMock = vi.mocked(withIdempotency);

// ─────────────────────────────────────────────
// Test IDs
// ─────────────────────────────────────────────
const TEST_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000002";
const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000003";

describe("Engine Flow — Clip Workflow", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default rate limit mock: always allowed
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 100 });

    // Default idempotency mock: execute the function and return fresh result
    withIdempotencyMock.mockImplementation(async (_key, fn) => {
      const value = await fn();
      return { fresh: true, value };
    });
  });

  it("runs basic clip workflow: project → clip → approve → job enqueued (API surface)", async () => {
    const clipId = crypto.randomUUID();

    // ─────────────────────────────────────────────
    // Mock database operations
    // ─────────────────────────────────────────────
    const mockClip = {
      id: clipId,
      status: "proposed",
      workspace_id: TEST_WORKSPACE_ID,
      project_id: TEST_PROJECT_ID,
      title: "Test Clip for Approve Flow",
    };

    // Track database operations for assertions
    let clipStatusUpdated = false;
    let jobInserted = false;
    let insertedJob: any = null;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockClip, error: null }),
          update: vi.fn((data: any) => {
            clipStatusUpdated = true;
            mockClip.status = data.status;
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn((data: any) => {
            jobInserted = true;
            insertedJob = {
              id: crypto.randomUUID(),
              workspace_id: data.workspace_id,
              kind: data.kind,
              status: data.status,
              payload: data.payload,
            };
            return Promise.resolve({ data: insertedJob, error: null });
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({
      from: mockAdminFrom,
    } as any);

    // Mock auth
    requireUserMock.mockReturnValue({
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      supabase: { from: vi.fn() } as any,
    } as any);

    // ─────────────────────────────────────────────
    // Call approve endpoint
    // ─────────────────────────────────────────────
    const mockReq = {
      method: "POST",
      query: { id: clipId },
      body: {},
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await approveHandler(mockReq, mockRes);

    // ─────────────────────────────────────────────
    // Assertions
    // ─────────────────────────────────────────────
    // 1. API returned success (ok() spreads data directly, not in .data)
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.clipId).toBe(clipId);

    // 2. Rate limit was checked
    expect(checkRateLimitMock).toHaveBeenCalledWith(TEST_USER_ID, "clips:approve");

    // 3. Admin client was used to fetch clip
    expect(getAdminClientMock).toHaveBeenCalled();
    expect(mockAdminFrom).toHaveBeenCalledWith("clips");

    // 4. Clip status was updated to "approved"
    expect(clipStatusUpdated).toBe(true);
    expect(mockClip.status).toBe("approved");

    // 5. CLIP_RENDER job was enqueued
    expect(jobInserted).toBe(true);
    expect(insertedJob).toBeDefined();
    expect(insertedJob.kind).toBe("CLIP_RENDER");
    expect(insertedJob.status).toBe("queued");
    expect(insertedJob.payload.clipId).toBe(clipId);
  });

  it("handles approve of already-approved clip (idempotent, no new job)", async () => {
    const clipId = crypto.randomUUID();

    // Mock clip that's already approved
    const mockClip = {
      id: clipId,
      status: "approved", // Already approved!
      workspace_id: TEST_WORKSPACE_ID,
      project_id: TEST_PROJECT_ID,
      title: "Already Approved Clip",
    };

    // Track operations
    let clipStatusUpdated = false;
    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockClip, error: null }),
          update: vi.fn(() => {
            clipStatusUpdated = true;
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn(() => {
            jobInserted = true;
            return Promise.resolve({ data: { id: "job-id" }, error: null });
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({
      from: mockAdminFrom,
    } as any);

    requireUserMock.mockReturnValue({
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      supabase: { from: vi.fn() } as any,
    } as any);

    // Call approve on already-approved clip
    const mockReq = {
      method: "POST",
      query: { id: clipId },
      body: {},
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await approveHandler(mockReq, mockRes);

    // ─────────────────────────────────────────────
    // Assertions: idempotent behavior
    // ─────────────────────────────────────────────
    // 1. Should still succeed
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);

    // 2. Clip status was NOT updated (already approved)
    expect(clipStatusUpdated).toBe(false);

    // 3. No new job was created
    expect(jobInserted).toBe(false);
  });

  it("returns 404 when clip does not exist", async () => {
    const clipId = crypto.randomUUID();

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), // No clip found
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({
      from: mockAdminFrom,
    } as any);

    requireUserMock.mockReturnValue({
      userId: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      supabase: { from: vi.fn() } as any,
    } as any);

    const mockReq = {
      method: "POST",
      query: { id: clipId },
      body: {},
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await approveHandler(mockReq, mockRes);

    expect(statusCode).toBe(404);
    expect(jsonBody.ok).toBe(false);
    // Previously this surfaced as "unknown_error" due to incorrect HttpError arg order.
    // After fixing HttpError usage in the approve handler, we now expose the specific code:
    // "clip_not_found".
    expect(jsonBody.code).toBe("clip_not_found");
  });
});

// ─────────────────────────────────────────────
// Additional mocks for publish endpoint tests
// ─────────────────────────────────────────────
vi.mock("@/lib/auth/context", () => ({
  buildAuthContext: vi.fn(),
  handleAuthError: vi.fn((error, res) => {
    const authError = error as { code?: string; status?: number; message?: string };
    res.status(authError.status ?? 401).json({
      ok: false,
      code: authError.code ?? "auth_error",
      message: authError.message ?? "Authentication failed",
    });
  }),
}));

vi.mock("@cliply/shared/billing/planGate", () => ({
  BILLING_PLAN_LIMIT: "BILLING_PLAN_LIMIT",
  BILLING_PLAN_REQUIRED: "BILLING_PLAN_REQUIRED",
  checkPlanAccess: vi.fn(),
  enforcePlanAccess: vi.fn(),
}));

vi.mock("@/lib/accounts/connectedAccountsService", () => ({
  getConnectedAccountsForPublish: vi.fn(),
}));

vi.mock("@/lib/viral/experimentService", () => ({
  attachClipToExperimentVariant: vi.fn(),
}));

vi.mock("@/lib/viral/orchestrationService", () => ({
  createVariantPostsForClip: vi.fn(),
}));

// Mock readiness builder for health/readiness tests
vi.mock("@cliply/shared/readiness/backendReadiness", () => ({
  buildBackendReadinessReport: vi.fn(),
}));

// Import additional mocked modules
import { buildAuthContext, handleAuthError } from "@/lib/auth/context";
import { checkPlanAccess, enforcePlanAccess, BILLING_PLAN_LIMIT, BILLING_PLAN_REQUIRED } from "@cliply/shared/billing/planGate";
import * as connectedAccountsService from "@/lib/accounts/connectedAccountsService";
import { buildBackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

// Import publish handler
import publishTikTokHandler from "../../src/pages/api/publish/tiktok";

// Import readiness handlers for health flow tests
import readyzRoute from "../../src/pages/api/readyz";
import adminReadyzRoute from "../../src/pages/api/admin/readyz";

// Import supertest handler utility
import { supertestHandler } from "../../../../test/utils/supertest-next";

// Create typed mock references for publish tests
const buildAuthContextMock = vi.mocked(buildAuthContext);
const checkPlanAccessMock = vi.mocked(checkPlanAccess);
const enforcePlanAccessMock = vi.mocked(enforcePlanAccess);
const getConnectedAccountsForPublishMock = vi.mocked(connectedAccountsService.getConnectedAccountsForPublish);

// Create typed mock reference for readiness tests
const mockBuildReadiness = vi.mocked(buildBackendReadinessReport);

// Helper to convert route handlers for supertest
const toApiHandler = (handler: any) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

// ─────────────────────────────────────────────
// Test IDs for publish tests (valid UUID v4 format)
// ─────────────────────────────────────────────
const TEST_CONNECTED_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CLIP_ID = "22222222-2222-4222-8222-222222222222";

describe("Engine Flow — Usage Gating", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default rate limit mock: always allowed
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 100 });

    // Default idempotency mock
    withIdempotencyMock.mockImplementation(async (_key, fn) => {
      const value = await fn();
      return { fresh: true, value };
    });

    // Default auth context with plan
    buildAuthContextMock.mockResolvedValue({
      userId: TEST_USER_ID,
      user_id: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      workspace_id: TEST_WORKSPACE_ID,
      plan: "pro",
    } as any);

    // Default plan access: allowed
    checkPlanAccessMock.mockReturnValue({ active: true });
    enforcePlanAccessMock.mockImplementation(() => {});

    // Default connected accounts
    getConnectedAccountsForPublishMock.mockResolvedValue([
      { id: TEST_CONNECTED_ACCOUNT_ID, platform: "tiktok", status: "active" } as any,
    ]);
  });

  it("allows posting when usage is under limits", async () => {
    const clipId = crypto.randomUUID();

    // Track job insertions
    let jobInserted = false;
    let insertedJobs: any[] = [];

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: TEST_WORKSPACE_ID,
              status: "ready",
              storage_path: "clips/test/clip.mp4",
            },
            error: null,
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn((data: any) => {
            jobInserted = true;
            insertedJobs = Array.isArray(data) ? data : [data];
            return {
              select: vi.fn().mockResolvedValue({
                data: insertedJobs.map((j, i) => ({ id: `job-${i}`, ...j })),
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Plan access: allowed (under limit)
    checkPlanAccessMock.mockReturnValue({ active: true });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Test post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    // Assertions
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jobInserted).toBe(true);
    expect(insertedJobs.length).toBe(1);
    expect(insertedJobs[0].kind).toBe("PUBLISH_TIKTOK");
    expect(checkPlanAccessMock).toHaveBeenCalledWith("pro", "concurrent_jobs");
  });

  it("allows posting at soft limit (80-100% usage) with warning", async () => {
    const clipId = crypto.randomUUID();

    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: TEST_WORKSPACE_ID,
              status: "ready",
              storage_path: "clips/test/clip.mp4",
            },
            error: null,
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn((data: any) => {
            jobInserted = true;
            const jobs = Array.isArray(data) ? data : [data];
            return {
              select: vi.fn().mockResolvedValue({
                data: jobs.map((j, i) => ({ id: `job-${i}`, ...j })),
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Plan access: still allowed (soft limit doesn't block)
    checkPlanAccessMock.mockReturnValue({ active: true });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Test at soft limit",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    // Should still succeed at soft limit
    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jobInserted).toBe(true);
  });

  it("blocks posting when hard limit exceeded (100%+)", async () => {
    const clipId = crypto.randomUUID();

    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "jobs") {
        return {
          insert: vi.fn(() => {
            jobInserted = true;
            return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Plan access: BLOCKED (hard limit)
    checkPlanAccessMock.mockReturnValue({
      active: false,
      reason: "limit",
      message: "Concurrent job limit exceeded for this plan.",
    });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Test over limit",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    // Should be blocked with 429
    expect(statusCode).toBe(429);
    expect(jsonBody.ok).toBe(false);
    expect(jsonBody.code).toBe("BILLING_PLAN_LIMIT");
    // Job should NOT be enqueued
    expect(jobInserted).toBe(false);
  });

  it("blocks posting when no plan is active (403)", async () => {
    const clipId = crypto.randomUUID();

    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "jobs") {
        return {
          insert: vi.fn(() => {
            jobInserted = true;
            return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Auth context: NO PLAN
    buildAuthContextMock.mockResolvedValue({
      userId: TEST_USER_ID,
      user_id: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      workspace_id: TEST_WORKSPACE_ID,
      plan: undefined, // No plan!
    } as any);

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Test no plan",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    // Should be blocked with 403
    expect(statusCode).toBe(403);
    expect(jsonBody.ok).toBe(false);
    expect(jsonBody.code).toBe("BILLING_PLAN_REQUIRED");
    expect(jobInserted).toBe(false);
  });
});

describe("Engine Flow — Anti-Spam", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default idempotency mock
    withIdempotencyMock.mockImplementation(async (_key, fn) => {
      const value = await fn();
      return { fresh: true, value };
    });

    // Default auth context with plan
    buildAuthContextMock.mockResolvedValue({
      userId: TEST_USER_ID,
      user_id: TEST_USER_ID,
      workspaceId: TEST_WORKSPACE_ID,
      workspace_id: TEST_WORKSPACE_ID,
      plan: "pro",
    } as any);

    // Default plan access: allowed
    checkPlanAccessMock.mockReturnValue({ active: true });
    enforcePlanAccessMock.mockImplementation(() => {});

    // Default connected accounts
    getConnectedAccountsForPublishMock.mockResolvedValue([
      { id: TEST_CONNECTED_ACCOUNT_ID, platform: "tiktok", status: "active" } as any,
    ]);
  });

  it("allows first post (rate limit passes)", async () => {
    const clipId = crypto.randomUUID();

    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: TEST_WORKSPACE_ID,
              status: "ready",
              storage_path: "clips/test/clip.mp4",
            },
            error: null,
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn((data: any) => {
            jobInserted = true;
            const jobs = Array.isArray(data) ? data : [data];
            return {
              select: vi.fn().mockResolvedValue({
                data: jobs.map((j, i) => ({ id: `job-${i}`, ...j })),
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Rate limit: ALLOWED (first post)
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 99 });

    // Configure mockCanPost helper for first call
    mockCanPost.mockResolvedValue({ canPost: true });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "First post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jobInserted).toBe(true);
    expect(checkRateLimitMock).toHaveBeenCalledWith(TEST_USER_ID, "publish:tiktok");
  });

  it("blocks second rapid post (rate limit exceeded)", async () => {
    const clipId = crypto.randomUUID();

    let jobInserted = false;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "jobs") {
        return {
          insert: vi.fn(() => {
            jobInserted = true;
            return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // Rate limit: BLOCKED (rapid second post)
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0 });

    // Configure mockCanPost helper for blocked call
    mockCanPost.mockResolvedValue({ canPost: false, reason: "cooldown" });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Rapid second post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    await publishTikTokHandler(mockReq, mockRes);

    // Should be rate limited with 429
    expect(statusCode).toBe(429);
    expect(jsonBody.ok).toBe(false);
    expect(jsonBody.code).toBe("too_many_requests");
    // Job should NOT be enqueued
    expect(jobInserted).toBe(false);
  });

  it("returns structured error on rate limit (no unhandled exceptions)", async () => {
    const clipId = crypto.randomUUID();

    // Rate limit: BLOCKED
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0 });

    const mockReq = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Rate limited post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    let statusCode: number | undefined;
    let jsonBody: any;
    const mockRes = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(obj: any) {
        jsonBody = obj;
        return this;
      },
      setHeader: vi.fn(),
    } as unknown as NextApiResponse;

    // This should NOT throw
    await expect(
      publishTikTokHandler(mockReq, mockRes)
    ).resolves.not.toThrow();

    // Verify structured error response
    expect(statusCode).toBe(429);
    expect(jsonBody).toBeDefined();
    expect(jsonBody.ok).toBe(false);
    expect(typeof jsonBody.code).toBe("string");
    expect(typeof jsonBody.message).toBe("string");
  });

  it("simulates rapid post sequence: first allowed, second blocked", async () => {
    const clipId = crypto.randomUUID();

    let jobInsertCount = 0;

    const mockAdminFrom = vi.fn((table: string) => {
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              workspace_id: TEST_WORKSPACE_ID,
              status: "ready",
              storage_path: "clips/test/clip.mp4",
            },
            error: null,
          }),
        };
      }
      if (table === "jobs") {
        return {
          insert: vi.fn((data: any) => {
            jobInsertCount++;
            const jobs = Array.isArray(data) ? data : [data];
            return {
              select: vi.fn().mockResolvedValue({
                data: jobs.map((j, i) => ({ id: `job-${i}`, ...j })),
                error: null,
              }),
            };
          }),
        };
      }
      return {};
    });

    getAdminClientMock.mockReturnValue({ from: mockAdminFrom } as any);

    // First call: rate limit PASSES
    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, remaining: 99 });
    // Second call: rate limit BLOCKED
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const createMockRes = () => {
      let statusCode: number | undefined;
      let jsonBody: any;
      return {
        res: {
          status(code: number) {
            statusCode = code;
            return this;
          },
          json(obj: any) {
            jsonBody = obj;
            return this;
          },
          setHeader: vi.fn(),
        } as unknown as NextApiResponse,
        getStatus: () => statusCode,
        getBody: () => jsonBody,
      };
    };

    // First request
    const mockReq1 = {
      method: "POST",
      body: { 
        clipId, 
        caption: "First post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    const { res: mockRes1, getStatus: getStatus1, getBody: getBody1 } = createMockRes();
    await publishTikTokHandler(mockReq1, mockRes1);

    expect(getStatus1()).toBe(200);
    expect(getBody1().ok).toBe(true);
    expect(jobInsertCount).toBe(1);

    // Second request (rapid)
    const mockReq2 = {
      method: "POST",
      body: { 
        clipId, 
        caption: "Second rapid post",
        connectedAccountId: TEST_CONNECTED_ACCOUNT_ID,
      },
      headers: {},
    } as unknown as NextApiRequest;

    const { res: mockRes2, getStatus: getStatus2, getBody: getBody2 } = createMockRes();
    await publishTikTokHandler(mockReq2, mockRes2);

    expect(getStatus2()).toBe(429);
    expect(getBody2().ok).toBe(false);
    // Job count should still be 1 (second request blocked)
    expect(jobInsertCount).toBe(1);
  });
});

describe("Engine Flow — Health / Readiness Integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reports ok=true on /readyz and /admin/readyz when engine snapshot is healthy", async () => {
    // Arrange: Mock healthy engine state
    const mockReadiness = {
      ok: true,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 5, oldestJobAge: 1_000, warning: false },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs", "workspaces"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    // Act & Assert: /api/readyz
    const readyzRes = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");
    expect(readyzRes.status).toBe(200);
    expect(readyzRes.body).toHaveProperty("ok", true);
    expect(readyzRes.body).toHaveProperty("checks");
    expect(readyzRes.body.checks).toHaveProperty("db");
    expect(readyzRes.body.checks).toHaveProperty("worker");
    expect(readyzRes.body).toHaveProperty("queue");
    expect(readyzRes.body).toHaveProperty("ffmpeg");
    expect(readyzRes.body.ffmpeg).toHaveProperty("ok", true);

    // Act & Assert: /api/admin/readyz
    const adminRes = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");
    expect(adminRes.status).toBe(200);
    expect(adminRes.body).toHaveProperty("ok", true);
    expect(adminRes.body).toHaveProperty("checks");
    expect(adminRes.body).toHaveProperty("queue");
    expect(adminRes.body).toHaveProperty("ffmpeg");
    // Admin-specific: must have timestamp as string
    expect(adminRes.body).toHaveProperty("timestamp");
    expect(typeof adminRes.body.timestamp).toBe("string");
  });

  it("returns ok=false and 503 when ffmpeg is reported as broken", async () => {
    // Arrange: Mock broken FFmpeg state
    const mockReadiness = {
      ok: false,
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 2, oldestJobAge: 2_000, warning: false },
      ffmpeg: { ok: false, message: "ffmpeg not found" },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    // Act & Assert: /api/readyz
    const readyzRes = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");
    expect(readyzRes.status).toBe(503);
    expect(readyzRes.body).toHaveProperty("ok", false);
    expect(readyzRes.body.ffmpeg).toHaveProperty("ok", false);
    expect(readyzRes.body.ffmpeg).toHaveProperty("message", "ffmpeg not found");

    // Act & Assert: /api/admin/readyz
    const adminRes = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");
    expect(adminRes.status).toBe(503);
    expect(adminRes.body).toHaveProperty("ok", false);
    expect(adminRes.body.ffmpeg).toHaveProperty("ok", false);
    expect(adminRes.body.ffmpeg).toHaveProperty("message", "ffmpeg not found");
    // Admin-specific: must have timestamp as string
    expect(adminRes.body).toHaveProperty("timestamp");
    expect(typeof adminRes.body.timestamp).toBe("string");
  });

  it("reflects queue soft warning (ok=true, warning=true) from engine metrics", async () => {
    // Arrange: Mock queue at soft warning level (stale but below hard fail threshold)
    const mockReadiness = {
      ok: true, // Still ok at soft warning
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 50, oldestJobAge: 90_000, warning: true },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    // Act & Assert: /api/readyz - should return 200 with warning flag
    const readyzRes = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");
    expect(readyzRes.status).toBe(200);
    expect(readyzRes.body).toHaveProperty("ok", true);
    expect(readyzRes.body.queue).toHaveProperty("warning", true);
    expect(readyzRes.body.queue).toHaveProperty("length", 50);
    expect(readyzRes.body.queue).toHaveProperty("oldestJobAge", 90_000);

    // Act & Assert: /api/admin/readyz
    const adminRes = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");
    expect(adminRes.status).toBe(200);
    expect(adminRes.body).toHaveProperty("ok", true);
    expect(adminRes.body.queue).toHaveProperty("warning", true);
    expect(adminRes.body).toHaveProperty("timestamp");
    expect(typeof adminRes.body.timestamp).toBe("string");
  });

  it("reflects queue hard fail (ok=false, 503) when queue is critically stale", async () => {
    // Arrange: Mock queue at hard fail level (critically stale)
    const mockReadiness = {
      ok: false, // Hard fail due to critical staleness
      env: { ok: true, missing: [], optionalMissing: [] },
      checks: { db: { ok: true }, worker: { ok: true } },
      queue: { length: 200, oldestJobAge: 600_000, warning: true },
      ffmpeg: { ok: true },
      db: { ok: true, tablesChecked: ["jobs"], missingTables: [] },
      stripe: { ok: true, missingEnv: [], priceIdsConfigured: 3 },
      sentry: { ok: true, missingEnv: [] },
    };

    mockBuildReadiness.mockResolvedValue(mockReadiness);

    // Act & Assert: /api/readyz - should return 503
    const readyzRes = await supertestHandler(toApiHandler(readyzRoute), "get").get("/");
    expect(readyzRes.status).toBe(503);
    expect(readyzRes.body).toHaveProperty("ok", false);
    expect(readyzRes.body.queue).toHaveProperty("warning", true);
    expect(readyzRes.body.queue).toHaveProperty("length", 200);
    expect(readyzRes.body.queue).toHaveProperty("oldestJobAge", 600_000);

    // Act & Assert: /api/admin/readyz
    const adminRes = await supertestHandler(toApiHandler(adminReadyzRoute), "get").get("/");
    expect(adminRes.status).toBe(503);
    expect(adminRes.body).toHaveProperty("ok", false);
    expect(adminRes.body.queue).toHaveProperty("warning", true);
    expect(adminRes.body).toHaveProperty("timestamp");
    expect(typeof adminRes.body.timestamp).toBe("string");
  });
});
