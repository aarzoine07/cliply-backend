import { PROJECT_STATUSES, CLIP_STATUSES } from "@cliply/shared/status";
import type { ClipStatus, ProjectStatus } from "@cliply/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import handler from "../../src/pages/api/projects/[id].ts";
import type { NextApiRequest, NextApiResponse } from "next";

const requireUserMock = vi.mocked(requireUser);
const checkRateLimitMock = vi.mocked(checkRateLimit);

describe("GET /api/projects/[id] - Lifecycle Status Verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 100 });
  });

  it("returns project and clips with valid lifecycle statuses", async () => {
    const projectId = "00000000-0000-0000-0000-000000000001";
    const workspaceId = "00000000-0000-0000-0000-000000000002";

    // Mock project with 'processing' status
    const mockProject = {
      id: projectId,
      workspace_id: workspaceId,
      title: "Test Project",
      source_type: "file",
      source_path: "videos/test/source.mp4",
      status: "processing" as ProjectStatus,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Mock clips with various lifecycle statuses
    const mockClips = [
      {
        id: "00000000-0000-0000-0000-000000000010",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Proposed Clip",
        status: "proposed" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000011",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Rendering Clip",
        status: "rendering" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000012",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Ready Clip",
        status: "ready" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000013",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Published Clip",
        status: "published" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const fromSpy = vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
        };
      }
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockClips, error: null }),
        };
      }
      return {};
    });

    // requireUser is synchronous, so use mockReturnValue (not mockResolvedValue)
    requireUserMock.mockReturnValue({
      userId: "user-123",
      workspaceId,
      supabase: { from: fromSpy } as any,
    });

    const mockReq = {
      method: "GET",
      query: { id: projectId },
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

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);
    expect(jsonBody.data.project).toBeDefined();
    expect(jsonBody.data.clips).toBeDefined();
    expect(Array.isArray(jsonBody.data.clips)).toBe(true);

    // Verify project status is a valid ProjectStatus
    const projectStatus = jsonBody.data.project.status;
    expect(PROJECT_STATUSES).toContain(projectStatus);
    expect(projectStatus).toBe("processing");

    // Verify all clip statuses are valid ClipStatus values
    const clipStatuses = jsonBody.data.clips.map((clip: any) => clip.status);
    expect(clipStatuses.length).toBe(4);
    clipStatuses.forEach((status: string) => {
      expect(CLIP_STATUSES).toContain(status);
    });

    // Verify specific statuses match lifecycle expectations
    expect(clipStatuses).toContain("proposed");
    expect(clipStatuses).toContain("rendering");
    expect(clipStatuses).toContain("ready");
    expect(clipStatuses).toContain("published");
  });

  it("handles project with 'ready' status and clips in various states", async () => {
    const projectId = "00000000-0000-0000-0000-000000000001";
    const workspaceId = "00000000-0000-0000-0000-000000000002";

    const mockProject = {
      id: projectId,
      workspace_id: workspaceId,
      title: "Ready Project",
      source_type: "file",
      source_path: "videos/test/source.mp4",
      status: "ready" as ProjectStatus,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockClips = [
      {
        id: "00000000-0000-0000-0000-000000000020",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Approved Clip",
        status: "approved" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000021",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Rejected Clip",
        status: "rejected" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "00000000-0000-0000-0000-000000000022",
        project_id: projectId,
        workspace_id: workspaceId,
        title: "Failed Clip",
        status: "failed" as ClipStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const fromSpy = vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockProject, error: null }),
        };
      }
      if (table === "clips") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockClips, error: null }),
        };
      }
      return {};
    });

    // requireUser is synchronous, so use mockReturnValue (not mockResolvedValue)
    requireUserMock.mockReturnValue({
      userId: "user-123",
      workspaceId,
      supabase: { from: fromSpy } as any,
    });

    const mockReq = {
      method: "GET",
      query: { id: projectId },
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

    await handler(mockReq, mockRes);

    expect(statusCode).toBe(200);
    expect(jsonBody.ok).toBe(true);

    // Verify project status is valid
    const projectStatus = jsonBody.data.project.status;
    expect(PROJECT_STATUSES).toContain(projectStatus);
    expect(projectStatus).toBe("ready");

    // Verify clip statuses are valid
    const clipStatuses = jsonBody.data.clips.map((clip: any) => clip.status);
    clipStatuses.forEach((status: string) => {
      expect(CLIP_STATUSES).toContain(status);
    });

    expect(clipStatuses).toContain("approved");
    expect(clipStatuses).toContain("rejected");
    expect(clipStatuses).toContain("failed");
  });
});

