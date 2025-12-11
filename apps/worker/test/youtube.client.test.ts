import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UploadShortParams } from '../src/services/youtube/client';

// Mock uploadVideoWithAccessToken before importing the module
const mockUploadVideoWithAccessToken = vi.fn();
vi.mock('../src/services/youtube/client', async () => {
  const actual = await vi.importActual<typeof import('../src/services/youtube/client')>('../src/services/youtube/client');
  // Mock both the export and the internal helper
  const mockFn = (...args: unknown[]) => mockUploadVideoWithAccessToken(...args);
  return {
    ...actual,
    uploadVideoWithAccessToken: mockFn,
    getUploadVideoFunction: () => mockFn,
  };
});

// Mock getEnv to control YOUTUBE_UPLOAD_MODE
const mockGetEnv = vi.fn();
vi.mock('@cliply/shared/env', () => ({
  getEnv: () => mockGetEnv(),
}));

// Mock getFreshYouTubeAccessToken
const mockGetFreshYouTubeAccessToken = vi.fn();
vi.mock('@cliply/shared/services/youtubeAuth', () => ({
  getFreshYouTubeAccessToken: (...args: unknown[]) => mockGetFreshYouTubeAccessToken(...args),
}));

// Mock logger
const mockLoggerError = vi.fn();
vi.mock('@cliply/shared/logging/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

// Import after mocks are set up
import { YouTubeClient } from '../src/services/youtube/client';

describe('YouTubeClient - mode gating tests', () => {
  let mockSupabase: SupabaseClient;
  let testParams: UploadShortParams;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a minimal mock Supabase client
    mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      })),
    } as unknown as SupabaseClient;

    // Default test params
    testParams = {
      workspaceId: 'workspace-123',
      connectedAccountId: 'account-456',
      filePath: '/tmp/test-video.mp4',
      title: 'Test Video',
      description: 'Test Description',
      tags: ['test', 'video'],
      visibility: 'unlisted',
    };

    // Default env mock (stub mode)
    mockGetEnv.mockReturnValue({
      YOUTUBE_UPLOAD_MODE: 'stub',
    });
  });

  describe('stub mode', () => {
    it('stub mode returns dryrun videoId', async () => {
      // Force stub mode
      mockGetEnv.mockReturnValue({
        YOUTUBE_UPLOAD_MODE: 'stub',
      });

      const client = new YouTubeClient({
        accessToken: 'fake-token',
        supabase: mockSupabase,
      });

      const result = await client.uploadShort(testParams);

      // Verify stub behavior
      expect(result.videoId).toMatch(/^dryrun_/);
      expect(mockGetFreshYouTubeAccessToken).not.toHaveBeenCalled();
      expect(mockUploadVideoWithAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('real mode - success', () => {
    it('real mode returns real videoId on success', async () => {
      // Force real mode
      mockGetEnv.mockReturnValue({
        YOUTUBE_UPLOAD_MODE: 'real',
      });

      // Mock successful token fetch
      mockGetFreshYouTubeAccessToken.mockResolvedValue('fake-access-token');

      // Mock successful upload
      mockUploadVideoWithAccessToken.mockResolvedValue({
        ok: true,
        videoId: 'yt_real_123',
        publishedAt: null,
      });

      const client = new YouTubeClient({
        accessToken: 'fake-token',
        supabase: mockSupabase,
      });

      const result = await client.uploadShort(testParams);

      // Verify real upload path was used
      expect(mockGetFreshYouTubeAccessToken).toHaveBeenCalledTimes(1);
      expect(mockGetFreshYouTubeAccessToken).toHaveBeenCalledWith(
        testParams.connectedAccountId,
        { supabase: mockSupabase }
      );

      expect(mockUploadVideoWithAccessToken).toHaveBeenCalledTimes(1);
      const uploadCall = mockUploadVideoWithAccessToken.mock.calls[0];
      expect(uploadCall[0]).toMatchObject({
        workspaceId: testParams.workspaceId,
        connectedAccountId: testParams.connectedAccountId,
        videoPath: testParams.filePath,
        title: testParams.title,
        description: testParams.description,
        tags: testParams.tags,
        privacyStatus: testParams.visibility,
      });
      expect(uploadCall[1]).toBe('fake-access-token');

      // Verify real videoId was returned
      expect(result.videoId).toBe('yt_real_123');
    });
  });

  describe('real mode - error fallback', () => {
    it('real mode falls back to stub on helper error', async () => {
      // Force real mode
      mockGetEnv.mockReturnValue({
        YOUTUBE_UPLOAD_MODE: 'real',
      });

      // Mock successful token fetch
      mockGetFreshYouTubeAccessToken.mockResolvedValue('fake-access-token');

      // Mock upload error
      mockUploadVideoWithAccessToken.mockResolvedValue({
        ok: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'quota',
          httpStatus: 403,
          ytErrorReason: 'quotaExceeded',
          isRetryable: false,
        },
      });

      const client = new YouTubeClient({
        accessToken: 'fake-token',
        supabase: mockSupabase,
      });

      const result = await client.uploadShort(testParams);

      // Verify real upload path was attempted
      expect(mockGetFreshYouTubeAccessToken).toHaveBeenCalledTimes(1);
      expect(mockGetFreshYouTubeAccessToken).toHaveBeenCalledWith(
        testParams.connectedAccountId,
        { supabase: mockSupabase }
      );

      expect(mockUploadVideoWithAccessToken).toHaveBeenCalledTimes(1);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).toHaveBeenCalledWith('youtube_upload_failed', {
        workspaceId: testParams.workspaceId,
        connectedAccountId: testParams.connectedAccountId,
        errorCode: 'QUOTA_EXCEEDED',
        errorMessage: 'quota',
        httpStatus: 403,
        ytErrorReason: 'quotaExceeded',
        isRetryable: false,
      });

      // Verify fallback to stub
      expect(result.videoId).toMatch(/^dryrun_/);
    });
  });
});

