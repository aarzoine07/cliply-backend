// @ts-nocheck
/**
 * Clips Edge Cases Tests
 *
 * Tests edge cases for clip approval workflows:
 * - Approving an already published clip → clip_already_published error (400)
 * - Successfully approving a pending clip → success (200)
 * - Accessing a non-existent clip → 404
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock modules BEFORE importing the handler
vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// Import the handler and mocked modules
import clipApproveRoute from '../../src/pages/api/clips/[id]/approve';
import * as supabase from '../../src/lib/supabase';
import { requireUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { ERROR_CODES } from '@cliply/shared/errorCodes';

const requireUserMock = vi.mocked(requireUser);
const checkRateLimitMock = vi.mocked(checkRateLimit);

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';

function createAdminClient(clipData: any) {
  const updateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  });
  const jobInsertSpy = vi.fn().mockResolvedValue({ error: null });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'clips') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: updateSpy,
          maybeSingle: vi.fn().mockResolvedValue({
            data: clipData,
            error: null,
          }),
        };
      }
      if (table === 'jobs') {
        return {
          insert: jobInsertSpy,
        };
      }
      // For idempotency table
      if (table === 'idempotency') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
    updateSpy,
    jobInsertSpy,
  };
}

describe('🧩 Clips Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset mocks with default behavior
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 100 });
  });

  describe('POST /api/clips/[id]/approve', () => {
    it('returns clip_already_published when approving a published clip', async () => {
      const admin = createAdminClient({
        id: mockClipId,
        workspace_id: mockWorkspaceId,
        status: 'published',
      });
      vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);

      // requireUser is synchronous
      requireUserMock.mockReturnValue({
        userId: '00000000-0000-0000-0000-000000000001',
        workspaceId: mockWorkspaceId,
        supabase: admin as any,
      });

      const mockReq = {
        method: 'POST',
        query: { id: mockClipId },
        body: {},
        headers: {
          'x-debug-user': '00000000-0000-0000-0000-000000000001',
          'x-debug-workspace': mockWorkspaceId,
        },
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

      await clipApproveRoute(mockReq, mockRes);

      expect(statusCode).toBe(400);
      expect(jsonBody.ok).toBe(false);
      expect(jsonBody.error.code).toBe(ERROR_CODES.clip_already_published);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });

    it('succeeds when approving a pending clip', async () => {
      const admin = createAdminClient({
        id: mockClipId,
        workspace_id: mockWorkspaceId,
        status: 'pending',
      });
      vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);

      requireUserMock.mockReturnValue({
        userId: '00000000-0000-0000-0000-000000000001',
        workspaceId: mockWorkspaceId,
        supabase: admin as any,
      });

      const mockReq = {
        method: 'POST',
        query: { id: mockClipId },
        body: {},
        headers: {
          'x-debug-user': '00000000-0000-0000-0000-000000000001',
          'x-debug-workspace': mockWorkspaceId,
        },
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

      await clipApproveRoute(mockReq, mockRes);

      expect(statusCode).toBe(200);
      expect(jsonBody.ok).toBe(true);
    });

    it('returns 404 when clip not found', async () => {
      const admin = createAdminClient(null); // null = no clip found
      vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);

      requireUserMock.mockReturnValue({
        userId: '00000000-0000-0000-0000-000000000001',
        workspaceId: mockWorkspaceId,
        supabase: admin as any,
      });

      const mockReq = {
        method: 'POST',
        query: { id: mockClipId },
        body: {},
        headers: {
          'x-debug-user': '00000000-0000-0000-0000-000000000001',
          'x-debug-workspace': mockWorkspaceId,
        },
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

      await clipApproveRoute(mockReq, mockRes);

      expect(statusCode).toBe(404);
      expect(jsonBody.ok).toBe(false);
      expect(jsonBody.error.code).toBe('clip_not_found');
    });
  });
});
