// @ts-nocheck
/**
 * Upload Edge Cases Tests
 *
 * These tests verify the error response format for upload-related errors:
 * - Authentication/authorization errors (401)
 * - Validation errors for invalid payloads (400)
 * - Usage limit exceeded errors (429)
 *
 * NOTE: video_too_long and video_too_short checks happen during pipeline
 * processing (after upload), not at upload/init time. The upload/init
 * endpoint validates file size and format, not video duration.
 * Duration-based guards would be implemented in the transcribe/highlight
 * pipelines or a dedicated duration-check endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supertestHandler } from '../../../../test/utils/supertest-next';
import uploadInitRoute from '../../src/pages/api/upload/init';
import * as storage from '../../src/lib/storage';
import * as supabase from '../../src/lib/supabase';
import { ERROR_CODES } from '@cliply/shared/errorCodes';
import { AuthErrorCode } from '@cliply/shared/types/auth';

// Mock the usage tracker module at the top level so it can be configured per-test
vi.mock('@cliply/shared/billing/usageTracker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cliply/shared/billing/usageTracker')>();
  return {
    ...actual,
    assertWithinUsage: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
});

const toApiHandler = (handler: any) => handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
};

const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';

function createAdminClient() {
  const insertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'project-123', workspace_id: mockWorkspaceId },
        error: null,
      }),
    }),
  });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'projects') {
        return { insert: insertSpy };
      }
      if (table === 'jobs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
    insertSpy,
  };
}

function mockAdminClient(admin: ReturnType<typeof createAdminClient>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
}

describe('🧩 Upload Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/upload/init', () => {
    // This test works as it doesn't require debug headers
    it('returns 401 when no auth headers provided', async () => {
      const res = await supertestHandler(toApiHandler(uploadInitRoute))
        .post('/')
        .send({
          source: 'file',
          filename: 'test.mp4',
          size: 1000,
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    it('returns 400 for invalid payload (missing required fields)', async () => {
      const res = await supertestHandler(toApiHandler(uploadInitRoute))
        .post('/')
        .set(commonHeaders)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns 400 for invalid source type', async () => {
      const res = await supertestHandler(toApiHandler(uploadInitRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          source: 'invalid_source',
          filename: 'test.mp4',
          size: 1000,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('returns 401 when workspace context is missing', async () => {
      // When workspace header is missing, the auth layer returns 401 (auth failure)
      // because workspace is required to build auth context
      const headersWithoutWorkspace = {
        'x-debug-user': '00000000-0000-0000-0000-000000000001',
        // No workspace header - auth layer requires x-debug-workspace or x-workspace-id
      };

      const res = await supertestHandler(toApiHandler(uploadInitRoute))
        .post('/')
        .set(headersWithoutWorkspace)
        .send({
          source: 'file',
          filename: 'test.mp4',
          size: 1000,
        });

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(AuthErrorCode.MISSING_HEADER);
    });

    it('returns usage_limit_exceeded when workspace exceeds limits', async () => {
      // This test verifies the usage limit error code format
      // The actual limit checking is done in assertWithinUsage
      const admin = createAdminClient();
      mockAdminClient(admin);
      vi.spyOn(storage, 'getSignedUploadUrl').mockResolvedValue('https://signed.url');

      // Import the mocked module and configure it to throw
      const usageTracker = await import('@cliply/shared/billing/usageTracker');
      const mockAssertWithinUsage = vi.mocked(usageTracker.assertWithinUsage);
      mockAssertWithinUsage.mockRejectedValue(
        new usageTracker.UsageLimitExceededError('projects', 10, 10)
      );

      const res = await supertestHandler(toApiHandler(uploadInitRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          source: 'file',
          filename: 'test.mp4',
          size: 1000,
          mime: 'video/mp4', // Required by schema
        });

      expect(res.status).toBe(429);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.usage_limit_exceeded);
    });
  });

  /**
   * NOTE: video_too_long_for_plan and video_too_short tests
   *
   * Per Task 7B spec, these guards should reject videos based on duration.
   * However, duration is not known at upload/init time - it's determined
   * after the file is uploaded and processed.
   *
   * These guards would typically be implemented in:
   * - POST /api/upload/complete (after file is uploaded and probed)
   * - The transcribe pipeline
   * - A dedicated validation endpoint
   *
   * Uncomment and implement once the appropriate guards are added.
   */
  // describe('Duration Validation (requires implementation)', () => {
  //   it('returns video_too_long_for_plan when duration exceeds plan limit', async () => {
  //     // Would need to mock duration check
  //     expect(res.body.error.code).toBe(ERROR_CODES.video_too_long_for_plan);
  //   });
  //
  //   it('returns video_too_short when duration is below minimum', async () => {
  //     // Would need to mock duration check
  //     expect(res.body.error.code).toBe(ERROR_CODES.video_too_short);
  //   });
  // });
});
