import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TikTokClient, TikTokApiError } from '../src/services/tiktok/client';

// Mock fetch globally
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

// Mock getEnv to avoid needing real env vars
const mockGetEnv = vi.fn();
vi.mock('@cliply/shared/env', () => ({
  getEnv: () => mockGetEnv(),
}));

describe('TikTokClient', () => {
  let tempVideoPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a temporary video file for testing
    tempVideoPath = join(process.cwd(), 'test-video.mp4');
    // Default env mock (stub mode)
    mockGetEnv.mockReturnValue({
      TIKTOK_CLIENT_ID: 'test-client-id',
      TIKTOK_CLIENT_SECRET: 'test-client-secret',
      TIKTOK_UPLOAD_MODE: 'stub',
    });
  });

  afterEach(async () => {
    // Clean up temp file
    try {
      await fs.unlink(tempVideoPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('constructor', () => {
    it('should throw error if access token is missing', () => {
      expect(() => {
        new TikTokClient({ accessToken: '' });
      }).toThrow('TikTok access token is required');
    });

    it('should create client with valid access token', () => {
      const client = new TikTokClient({ accessToken: 'test-token' });
      expect(client).toBeInstanceOf(TikTokClient);
    });
  });

  describe('uploadVideo - happy path', () => {
    it('should successfully upload video through init → upload → publish flow', async () => {
      // Set real mode for this test
      mockGetEnv.mockReturnValue({
        TIKTOK_CLIENT_ID: 'test-client-id',
        TIKTOK_CLIENT_SECRET: 'test-client-secret',
        TIKTOK_UPLOAD_MODE: 'real',
      });

      // Create a minimal video file
      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));

      // Mock init upload response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            upload_url: 'https://upload.example.com/video',
            publish_id: 'publish-123',
          },
        }),
      });

      // Mock file upload response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      // Mock publish response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            video_id: 'video-456',
          },
        }),
      });

      const client = new TikTokClient({ accessToken: 'test-token' });
      const result = await client.uploadVideo({
        filePath: tempVideoPath,
        caption: 'Test caption',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      });

      expect(result.videoId).toBe('video-456');
      expect(result.rawResponse).toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify init upload call
      const initCall = fetchMock.mock.calls[0];
      expect(initCall[0]).toBe('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
      expect(initCall[1]?.method).toBe('POST');
      expect(initCall[1]?.headers?.['Authorization']).toBe('Bearer test-token');

      // Verify file upload call
      const uploadCall = fetchMock.mock.calls[1];
      expect(uploadCall[0]).toBe('https://upload.example.com/video');
      expect(uploadCall[1]?.method).toBe('PUT');

      // Verify publish call
      const publishCall = fetchMock.mock.calls[2];
      expect(publishCall[0]).toBe('https://open.tiktokapis.com/v2/post/publish/');
      expect(publishCall[1]?.method).toBe('POST');
    });
  });

  describe('uploadVideo - error handling', () => {
    beforeEach(async () => {
      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));
      // Set real mode for error handling tests
      mockGetEnv.mockReturnValue({
        TIKTOK_CLIENT_ID: 'test-client-id',
        TIKTOK_CLIENT_SECRET: 'test-client-secret',
        TIKTOK_UPLOAD_MODE: 'real',
      });
    });

    it('should throw TikTokApiError on 401 authentication error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: {
              code: 'invalid_token',
              message: 'Invalid access token',
            },
          }),
      });

      const client = new TikTokClient({ accessToken: 'invalid-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.status).toBe(401);
          expect(error.retryable).toBe(false);
          expect(error.tiktokErrorCode).toBe('invalid_token');
        }
      }
    });

    it('should throw TikTokApiError on 403 forbidden error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              code: 'insufficient_permission',
              message: 'Insufficient permissions',
            },
          }),
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.status).toBe(403);
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('should throw TikTokApiError on 429 rate limit error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.status).toBe(429);
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('should throw TikTokApiError on 500 server error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.status).toBe(500);
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('should throw TikTokApiError when init upload returns error in response body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          error: {
            code: 'invalid_request',
            message: 'Invalid request parameters',
          },
        }),
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.tiktokErrorCode).toBe('invalid_request');
          expect(error.retryable).toBe(false);
        }
      }
    });

    it('should throw TikTokApiError when init upload missing upload_url', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            publish_id: 'publish-123',
            // Missing upload_url
          },
        }),
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.message).toContain('missing upload_url');
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('should throw TikTokApiError when file upload fails', async () => {
      // Mock successful init
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            upload_url: 'https://upload.example.com/video',
            publish_id: 'publish-123',
          },
        }),
      });

      // Mock failed file upload
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Upload failed',
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.status).toBe(500);
          expect(error.retryable).toBe(true);
        }
      }
    });

    it('should throw TikTokApiError when publish fails', async () => {
      // Mock successful init
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            upload_url: 'https://upload.example.com/video',
            publish_id: 'publish-123',
          },
        }),
      });

      // Mock successful file upload
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'OK',
      });

      // Mock failed publish
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          error: {
            code: 'publish_failed',
            message: 'Publish failed',
          },
        }),
      });

      const client = new TikTokClient({ accessToken: 'test-token' });

      try {
        await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test',
        });
        expect.fail('Should have thrown TikTokApiError');
      } catch (error) {
        expect(error).toBeInstanceOf(TikTokApiError);
        if (error instanceof TikTokApiError) {
          expect(error.tiktokErrorCode).toBe('publish_failed');
          expect(error.retryable).toBe(false);
        }
      }
    });
  });

  describe('TIKTOK_UPLOAD_MODE gating', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      fetchMock.mockClear();
      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));
    });

    describe('stub mode', () => {
      it('should return dryrun_* postId and not call real upload helper when TIKTOK_UPLOAD_MODE=stub', async () => {
        // Force stub mode
        mockGetEnv.mockReturnValue({
          TIKTOK_CLIENT_ID: 'test-client-id',
          TIKTOK_CLIENT_SECRET: 'test-client-secret',
          TIKTOK_UPLOAD_MODE: 'stub',
        });

        const client = new TikTokClient({ accessToken: 'test-token' });
        const result = await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test caption',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
        });

        // Verify stub behavior
        expect(result.videoId).toMatch(/^dryrun_/);
        // Verify no network calls were made
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('should default to stub mode when TIKTOK_UPLOAD_MODE is undefined', async () => {
        // Mock env without TIKTOK_UPLOAD_MODE (should default to stub)
        mockGetEnv.mockReturnValue({
          TIKTOK_CLIENT_ID: 'test-client-id',
          TIKTOK_CLIENT_SECRET: 'test-client-secret',
          // TIKTOK_UPLOAD_MODE is undefined
        });

        const client = new TikTokClient({ accessToken: 'test-token' });
        const result = await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test caption',
        });

        // Verify stub behavior (default)
        expect(result.videoId).toMatch(/^dryrun_/);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe('real mode - success', () => {
      it('should call real upload helper and return real postId when TIKTOK_UPLOAD_MODE=real', async () => {
        // Force real mode
        mockGetEnv.mockReturnValue({
          TIKTOK_CLIENT_ID: 'test-client-id',
          TIKTOK_CLIENT_SECRET: 'test-client-secret',
          TIKTOK_UPLOAD_MODE: 'real',
        });

        // Clear any previous mocks
        fetchMock.mockClear();

        // Mock init upload response
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              upload_url: 'https://upload.example.com/video',
              publish_id: 'publish-123',
            },
          }),
        });

        // Mock file upload response
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => 'OK',
        });

        // Mock publish response
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              video_id: 'tiktok_123',
            },
          }),
        });

        const client = new TikTokClient({ accessToken: 'test-token' });
        const result = await client.uploadVideo({
          filePath: tempVideoPath,
          caption: 'Test caption',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
        });

        // Verify real upload path was used (fetch was called 3 times: init, upload, publish)
        expect(fetchMock).toHaveBeenCalledTimes(3);

        // Verify real videoId was returned
        expect(result.videoId).toBe('tiktok_123');
        expect(result.rawResponse).toEqual({
          video_id: 'tiktok_123',
          publishedAt: null,
        });
      });
    });

    describe('real mode - error handling', () => {
      it('should throw TikTokApiError when real upload helper returns error', async () => {
        // Force real mode
        mockGetEnv.mockReturnValue({
          TIKTOK_CLIENT_ID: 'test-client-id',
          TIKTOK_CLIENT_SECRET: 'test-client-secret',
          TIKTOK_UPLOAD_MODE: 'real',
        });

        // Clear any previous mocks
        fetchMock.mockClear();

        // Mock init upload error response
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            error: {
              code: 'invalid_request',
              message: 'Invalid request parameters',
            },
          }),
        });

        const client = new TikTokClient({ accessToken: 'test-token' });

        // Verify error is thrown with correct details
        try {
          await client.uploadVideo({
            filePath: tempVideoPath,
            caption: 'Test caption',
          });
          expect.fail('Should have thrown TikTokApiError');
        } catch (error) {
          expect(error).toBeInstanceOf(TikTokApiError);
          if (error instanceof TikTokApiError) {
            expect(error.tiktokErrorCode).toBe('invalid_request');
            expect(error.retryable).toBe(false);
          }
        }

        // Verify real upload path was attempted (fetch was called)
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it('should throw TikTokApiError with correct status when upload fails with HTTP error', async () => {
        // Force real mode
        mockGetEnv.mockReturnValue({
          TIKTOK_CLIENT_ID: 'test-client-id',
          TIKTOK_CLIENT_SECRET: 'test-client-secret',
          TIKTOK_UPLOAD_MODE: 'real',
        });

        // Clear any previous mocks
        fetchMock.mockClear();

        // Mock 401 authentication error
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () =>
            JSON.stringify({
              error: {
                code: 'invalid_token',
                message: 'Invalid access token',
              },
            }),
        });

        const client = new TikTokClient({ accessToken: 'invalid-token' });

        // Verify error is thrown with correct details
        try {
          await client.uploadVideo({
            filePath: tempVideoPath,
            caption: 'Test caption',
          });
          expect.fail('Should have thrown TikTokApiError');
        } catch (error) {
          expect(error).toBeInstanceOf(TikTokApiError);
          if (error instanceof TikTokApiError) {
            expect(error.status).toBe(401);
            expect(error.tiktokErrorCode).toBe('invalid_token');
            expect(error.retryable).toBe(false);
          }
        }

        // Verify real upload path was attempted (fetch was called)
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});

