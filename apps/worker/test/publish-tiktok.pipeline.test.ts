import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKET_RENDERS } from '@cliply/shared/constants';
import type { Job, WorkerContext } from '../src/pipelines/types';
import { run } from '../src/pipelines/publish-tiktok';
import { TikTokClient, TikTokApiError } from '../src/services/tiktok/client';
import * as variantPostsService from '../src/services/viral/variantPosts';
import * as tiktokAuth from '@cliply/shared/services/tiktokAuth';

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CLIP_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

// Mock TikTok client
vi.mock('../src/services/tiktok/client', () => {
  return {
    TikTokClient: vi.fn(),
    TikTokApiError: class TikTokApiError extends Error {
      status: number;
      tiktokErrorCode?: string;
      tiktokErrorMessage?: string;
      retryable: boolean;

      constructor(
        message: string,
        status: number,
        options?: {
          tiktokErrorCode?: string;
          tiktokErrorMessage?: string;
          retryable?: boolean;
        },
      ) {
        super(message);
        this.name = 'TikTokApiError';
        this.status = status;
        this.tiktokErrorCode = options?.tiktokErrorCode;
        this.tiktokErrorMessage = options?.tiktokErrorMessage;
        this.retryable = options?.retryable ?? (status >= 500 || status === 429);
      }
    },
  };
});

// Mock TikTok auth
vi.mock('@cliply/shared/services/tiktokAuth', () => ({
  getFreshTikTokAccessToken: vi.fn(),
}));

// Mock variant posts service
vi.mock('../src/services/viral/variantPosts', () => ({
  updateVariantPostAfterPublish: vi.fn(),
}));

describe('PUBLISH_TIKTOK pipeline', () => {
  let storage: ReturnType<typeof createStorageMock>;
  let supabase: ReturnType<typeof createSupabaseMock>;
  let logger: ReturnType<typeof createLoggerMock>;
  let queue: ReturnType<typeof createQueueMock>;
  let sentry: ReturnType<typeof createSentryMock>;
  let ctx: WorkerContext;
  let tempVideoPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempVideoPath = join(process.cwd(), 'test-video-tiktok.mp4');

    storage = createStorageMock({
      [`${BUCKET_RENDERS}/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`]: 'video-content',
    });
    supabase = createSupabaseMock();
    logger = createLoggerMock();
    queue = createQueueMock();
    sentry = createSentryMock();
    ctx = {
      storage,
      supabase,
      logger,
      queue,
      sentry,
    };

    // Setup default mocks
    vi.mocked(tiktokAuth.getFreshTikTokAccessToken).mockResolvedValue('test-access-token');
    vi.mocked(variantPostsService.updateVariantPostAfterPublish).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempVideoPath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('happy path', () => {
    it('should successfully publish video to TikTok', async () => {
      // Setup clip and account
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: null,
          caption_suggestion: 'Test caption',
        },
      ];

      supabase.state.connected_accounts = [
        {
          id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
          platform: 'tiktok',
          status: 'active',
        },
      ];

      // Mock TikTok client
      const mockUploadVideo = vi.fn().mockResolvedValue({
        videoId: 'tiktok-video-123',
        rawResponse: { data: { video_id: 'tiktok-video-123' } },
      });
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      // Create temp video file
      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
        caption?: string;
        privacyLevel?: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
          caption: 'Custom caption',
          privacyLevel: 'PUBLIC_TO_EVERYONE',
        },
      };

      await run(job, ctx);

      // Verify TikTok client was called correctly
      expect(mockUploadVideo).toHaveBeenCalledWith({
        filePath: expect.any(String),
        caption: 'Custom caption',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      });

      // Verify clip was updated
      expect(supabase.state.clips[0].status).toBe('published');
      expect(supabase.state.clips[0].external_id).toBe('tiktok-video-123');
      expect(supabase.state.clips[0].published_at).toBeDefined();

      // Verify variant_posts was updated
      expect(variantPostsService.updateVariantPostAfterPublish).toHaveBeenCalledWith(
        {
          clipId: CLIP_ID,
          workspaceId: WORKSPACE_ID,
          platformPostId: 'tiktok-video-123',
          platform: 'tiktok',
          connectedAccountId: ACCOUNT_ID,
        },
        { supabase },
      );

      // Verify logging
      expect(logger.info).toHaveBeenCalledWith(
        'publish_tiktok_start',
        expect.objectContaining({
          jobId: 'test-job',
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        }),
      );

      expect(logger.info).toHaveBeenCalledWith(
        'publish_tiktok_completed',
        expect.objectContaining({
          jobId: 'test-job',
          videoId: 'tiktok-video-123',
          durationMs: expect.any(Number),
        }),
      );
    });
  });

  describe('idempotency', () => {
    it('should skip if variant_post already exists with status=posted', async () => {
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: null,
          caption_suggestion: null,
        },
      ];

      supabase.state.connected_accounts = [
        {
          id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
          platform: 'tiktok',
          status: 'active',
        },
      ];

      supabase.state.variant_posts = [
        {
          id: 'variant-post-1',
          clip_id: CLIP_ID,
          connected_account_id: ACCOUNT_ID,
          platform: 'tiktok',
          status: 'posted',
          platform_post_id: 'tiktok-video-existing',
        },
      ];

      const mockUploadVideo = vi.fn();
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await run(job, ctx);

      // Should not call TikTok API
      expect(mockUploadVideo).not.toHaveBeenCalled();

      // Should log idempotent skip
      expect(logger.info).toHaveBeenCalledWith(
        'publish_tiktok_already_posted',
        expect.objectContaining({
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
          platformPostId: 'tiktok-video-existing',
        }),
      );
    });

    it('should skip if clip.external_id exists (legacy behavior)', async () => {
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: 'tiktok-legacy-id',
          caption_suggestion: null,
        },
      ];

      supabase.state.connected_accounts = [
        {
          id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
          platform: 'tiktok',
          status: 'active',
        },
      ];

      const mockUploadVideo = vi.fn();
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await run(job, ctx);

      // Should not call TikTok API
      expect(mockUploadVideo).not.toHaveBeenCalled();

      // Should log legacy skip
      expect(logger.info).toHaveBeenCalledWith(
        'publish_tiktok_already_posted_legacy',
        expect.objectContaining({
          clipId: CLIP_ID,
          externalId: 'tiktok-legacy-id',
        }),
      );
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: null,
          caption_suggestion: null,
        },
      ];

      supabase.state.connected_accounts = [
        {
          id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
          platform: 'tiktok',
          status: 'active',
        },
      ];

      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));
    });

    it('should handle TikTok 401 auth error', async () => {
      const mockUploadVideo = vi.fn().mockRejectedValue(
        new TikTokApiError('Authentication failed', 401, {
          tiktokErrorCode: 'invalid_token',
          tiktokErrorMessage: 'Invalid access token',
          retryable: false,
        }),
      );
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/TikTok authentication failed/);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_api_error',
        expect.objectContaining({
          tiktokStatus: 401,
          tiktokErrorCode: 'invalid_token',
          retryable: false,
        }),
      );

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_failed',
        expect.objectContaining({
          jobId: 'test-job',
          error: expect.stringContaining('TikTok authentication failed'),
        }),
      );
    });

    it('should handle TikTok 403 forbidden error', async () => {
      const mockUploadVideo = vi.fn().mockRejectedValue(
        new TikTokApiError('Forbidden', 403, {
          tiktokErrorCode: 'insufficient_permission',
          retryable: false,
        }),
      );
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/TikTok authentication failed/);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_api_error',
        expect.objectContaining({
          tiktokStatus: 403,
          retryable: false,
        }),
      );
    });

    it('should handle TikTok 429 rate limit error (retryable)', async () => {
      const mockUploadVideo = vi.fn().mockRejectedValue(
        new TikTokApiError('Rate limited', 429, {
          retryable: true,
        }),
      );
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(TikTokApiError);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_api_error',
        expect.objectContaining({
          tiktokStatus: 429,
          retryable: true,
        }),
      );
    });

    it('should handle TikTok 500 server error (retryable)', async () => {
      const mockUploadVideo = vi.fn().mockRejectedValue(
        new TikTokApiError('Server error', 500, {
          retryable: true,
        }),
      );
      vi.mocked(TikTokClient).mockImplementation(() => ({
        uploadVideo: mockUploadVideo,
      } as unknown as TikTokClient));

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(TikTokApiError);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_api_error',
        expect.objectContaining({
          tiktokStatus: 500,
          retryable: true,
        }),
      );
    });

    it('should handle missing clip', async () => {
      supabase.state.clips = [];

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/clip not found/);
    });

    it('should handle clip not ready', async () => {
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'uploaded',
          storage_path: null,
          external_id: null,
          caption_suggestion: null,
        },
      ];

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/clip not ready for publish/);
    });

    it('should handle missing connected account', async () => {
      supabase.state.connected_accounts = [];

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/TikTok connected account not found/);
    });

    it('should handle inactive connected account', async () => {
      supabase.state.connected_accounts = [
        {
          id: ACCOUNT_ID,
          workspace_id: WORKSPACE_ID,
          platform: 'tiktok',
          status: 'inactive',
        },
      ];

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/TikTok connected account is not active/);
    });

    it('should handle token fetch failure', async () => {
      vi.mocked(tiktokAuth.getFreshTikTokAccessToken).mockRejectedValue(
        new Error('Token refresh failed'),
      );

      const job: Job<{
        clipId: string;
        connectedAccountId: string;
      }> = {
        id: 'test-job',
        type: 'PUBLISH_TIKTOK',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/Failed to get TikTok access token/);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_tiktok_token_fetch_failed',
        expect.objectContaining({
          error: 'Token refresh failed',
        }),
      );
    });
  });
});

function createStorageMock(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));

  return {
    files,
    exists: vi.fn(async (bucket: string, path: string) => files.has(`${bucket}/${path}`)),
    list: vi.fn(async (bucket: string, prefix: string) =>
      Array.from(files.keys())
        .filter((key) => key.startsWith(`${bucket}/`))
        .map((key) => key.slice(`${bucket}/`.length))
        .filter((key) => key.startsWith(prefix)),
    ),
    download: vi.fn(async (bucket: string, path: string, destination: string) => {
      const key = `${bucket}/${path}`;
      const data = files.get(key);
      if (data === undefined) {
        throw new Error(`missing file: ${key}`);
      }
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.writeFile(destination, data, 'utf8');
      return destination;
    }),
    upload: vi.fn(async (bucket: string, path: string, localFile: string) => {
      const data = await fs.readFile(localFile, 'utf8');
      const key = `${bucket}/${path}`;
      files.set(key, data);
    }),
  };
}

function createSupabaseMock() {
  const state = {
    clips: [] as Array<{
      id: string;
      project_id: string;
      workspace_id: string;
      status: string;
      storage_path: string | null;
      external_id: string | null;
      caption_suggestion: string | null;
      published_at?: string;
    }>,
    connected_accounts: [] as Array<{
      id: string;
      workspace_id: string;
      platform: string;
      status: string | null;
    }>,
    variant_posts: [] as Array<{
      id: string;
      clip_id: string;
      connected_account_id: string;
      platform: string;
      status: string;
      platform_post_id: string | null;
    }>,
  };

  return {
    state,
    from(table: 'clips' | 'connected_accounts' | 'variant_posts') {
      if (table === 'clips') {
        return {
          select: (fields: string) => ({
            eq: (field: string, value: string) => {
              const filtered = state.clips.filter((row) => row[field as keyof typeof row] === value);
              return Promise.resolve({ data: filtered, error: null });
            },
          }),
          update: (values: Partial<(typeof state.clips)[number]>) => ({
            eq: (field: string, value: string) => {
              state.clips.forEach((clip) => {
                if (clip[field as keyof typeof clip] === value) {
                  Object.assign(clip, values);
                }
              });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }

      if (table === 'connected_accounts') {
        return {
          select: (fields: string) => ({
            eq: (field: string, value: string) => ({
              eq: (field2: string, value2: string) => ({
                maybeSingle: () => {
                  const found = state.connected_accounts.find(
                    (acc) => acc[field as keyof typeof acc] === value && acc[field2 as keyof typeof acc] === value2,
                  );
                  return Promise.resolve({ data: found ?? null, error: null });
                },
              }),
            }),
          }),
        };
      }

      if (table === 'variant_posts') {
        return {
          select: (fields: string) => ({
            eq: (field: string, value: string) => ({
              eq: (field2: string, value2: string) => ({
                eq: (field3: string, value3: string) => ({
                  maybeSingle: () => {
                    const found = state.variant_posts.find(
                      (post) =>
                        post[field as keyof typeof post] === value &&
                        post[field2 as keyof typeof post] === value2 &&
                        post[field3 as keyof typeof post] === value3,
                    );
                    return Promise.resolve({ data: found ?? null, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
  } as const;
}

function createLoggerMock() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createQueueMock() {
  return {
    enqueue: vi.fn(async () => {}),
  };
}

function createSentryMock() {
  return {
    captureException: vi.fn(),
  };
}

