// @ts-nocheck
/**
 * Publish Edge Cases Tests
 *
 * These tests verify the edge case error responses for publish endpoints.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import publishTikTokRoute from '../../src/pages/api/publish/tiktok';
import publishYouTubeRoute from '../../src/pages/api/publish/youtube';
import { supertestHandler } from '../../../../test/utils/supertest-next';
import * as connectedAccountsService from '../../src/lib/accounts/connectedAccountsService';
import * as supabase from '../../src/lib/supabase';
import { ERROR_CODES } from '@cliply/shared/errorCodes';

const toApiHandler = (handler: any) =>
  handler as unknown as (req: unknown, res: unknown) => Promise<void>;

const commonHeaders = {
  'x-debug-user': '00000000-0000-0000-0000-000000000001',
  'x-debug-workspace': '11111111-1111-1111-1111-111111111111',
  'x-workspace-id': '11111111-1111-1111-1111-111111111111',  // IMPORTANT FIX
};

const mockClipId = '123e4567-e89b-12d3-a456-426614174000';
const mockAccountId = '223e4567-e89b-12d3-a456-426614174001';
const mockWorkspaceId = '11111111-1111-1111-1111-111111111111';

function createAdminClient(clipStatus = 'ready') {
  const jobInsertSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({
      data: [{ id: 'job-123' }],
      error: null,
    }),
  });

  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'clips') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: mockClipId,
              workspace_id: mockWorkspaceId,
              status: clipStatus,
              storage_path: 'renders/test.mp4',
            },
            error: null,
          }),
        };
      }
      if (table === 'jobs') {
        return {
          insert: jobInsertSpy,
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
      };
    }),
    jobInsertSpy,
  };
}

function mockAdminClient(admin: ReturnType<typeof createAdminClient>) {
  vi.spyOn(supabase, 'getAdminClient').mockReturnValue(admin as any);
}

describe('🧩 Publish Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/publish/tiktok', () => {
    it('returns missing_connected_account when no TikTok accounts found', async () => {
      const admin = createAdminClient('ready');
      mockAdminClient(admin);

      // Return empty array - no accounts found
      vi.spyOn(
        connectedAccountsService,
        'getConnectedAccountsForPublish',
      ).mockResolvedValue([]);

      const res = await supertestHandler(toApiHandler(publishTikTokRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountId: mockAccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.missing_connected_account);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });

    it('returns clip_already_published when clip is already published', async () => {
      const admin = createAdminClient('published');
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishTikTokRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountId: mockAccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.clip_already_published);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });

    it('returns invalid_clip_state when clip is not ready', async () => {
      const admin = createAdminClient('processing');
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishTikTokRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountId: mockAccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.invalid_clip_state);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/publish/youtube', () => {
    it('returns missing_connected_account when no YouTube accounts found', async () => {
      const admin = createAdminClient('ready');
      mockAdminClient(admin);

      // Return empty array - no accounts found
      vi.spyOn(
        connectedAccountsService,
        'getConnectedAccountsForPublish',
      ).mockResolvedValue([]);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountIds: [mockAccountId],
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.missing_connected_account);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });

    it('returns clip_already_published when clip is already published', async () => {
      const admin = createAdminClient('published');
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountIds: [mockAccountId],
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.clip_already_published);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });

    it('returns invalid_clip_state when clip is not ready', async () => {
      const admin = createAdminClient('pending');
      mockAdminClient(admin);

      const res = await supertestHandler(toApiHandler(publishYouTubeRoute))
        .post('/')
        .set(commonHeaders)
        .send({
          clipId: mockClipId,
          connectedAccountIds: [mockAccountId],
        });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe(ERROR_CODES.invalid_clip_state);
      expect(admin.jobInsertSpy).not.toHaveBeenCalled();
    });
  });
});