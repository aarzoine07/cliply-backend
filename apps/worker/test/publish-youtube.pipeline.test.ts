import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKET_RENDERS } from '@cliply/shared/constants';
import type { Job, WorkerContext } from '../src/pipelines/types';
import { run } from '../src/pipelines/publish-youtube';
import { YouTubeClient, YouTubeApiError } from '../src/services/youtube/client';
import * as variantPostsService from '../src/services/viral/variantPosts';
import * as youtubeAuth from '@cliply/shared/services/youtubeAuth';

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CLIP_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

// Mock YouTube client
vi.mock('../src/services/youtube/client', () => {
  return {
    YouTubeClient: vi.fn(),
    YouTubeApiError: class YouTubeApiError extends Error {
      status: number;
      youtubeErrorCode?: string;
      youtubeErrorMessage?: string;
      retryable: boolean;

      constructor(
        message: string,
        status: number,
        options?: {
          youtubeErrorCode?: string;
          youtubeErrorMessage?: string;
          retryable?: boolean;
        },
      ) {
        super(message);
        this.name = 'YouTubeApiError';
        this.status = status;
        this.youtubeErrorCode = options?.youtubeErrorCode;
        this.youtubeErrorMessage = options?.youtubeErrorMessage;
        this.retryable = options?.retryable ?? (status >= 500 || status === 429);
      }
    },
  };
});

// Mock YouTube auth
vi.mock('@cliply/shared/services/youtubeAuth', () => ({
  getFreshYouTubeAccessToken: vi.fn(),
}));

// Mock variant posts service
vi.mock('../src/services/viral/variantPosts', () => ({
  updateVariantPostAfterPublish: vi.fn(),
}));

describe('PUBLISH_YOUTUBE pipeline', () => {
  let storage: ReturnType<typeof createStorageMock>;
  let supabase: ReturnType<typeof createSupabaseMock>;
  let logger: ReturnType<typeof createLoggerMock>;
  let queue: ReturnType<typeof createQueueMock>;
  let sentry: ReturnType<typeof createSentryMock>;
  let ctx: WorkerContext;
  let tempVideoPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempVideoPath = join(process.cwd(), 'test-video-youtube.mp4');

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
    vi.mocked(youtubeAuth.getFreshYouTubeAccessToken).mockResolvedValue('test-access-token');
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
    it('should successfully publish video to YouTube', async () => {
      // Setup clip
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: null,
        },
      ];

      // Mock YouTube client
      const mockUploadShort = vi.fn().mockResolvedValue({
        videoId: 'youtube-video-123',
      });
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      // Create temp video file
      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
          title: 'Custom title',
          description: 'Custom description',
          tags: ['tag1', 'tag2'],
          visibility: 'public',
        },
      };

      await run(job, ctx);

      // Verify token was fetched from connected_accounts
      expect(youtubeAuth.getFreshYouTubeAccessToken).toHaveBeenCalledWith(
        ACCOUNT_ID,
        { supabase },
      );

      // Verify YouTube client was called correctly
      expect(mockUploadShort).toHaveBeenCalledWith({
        filePath: expect.any(String),
        title: 'Custom title',
        description: 'Custom description',
        tags: ['tag1', 'tag2'],
        visibility: 'public',
      });

      // Verify YouTube client was instantiated with access token
      expect(YouTubeClient).toHaveBeenCalledWith({
        accessToken: 'test-access-token',
      });

      // Verify clip was updated
      expect(supabase.state.clips[0].status).toBe('published');
      expect(supabase.state.clips[0].external_id).toBe('youtube-video-123');
      expect(supabase.state.clips[0].published_at).toBeDefined();

      // Verify variant_posts was updated
      expect(variantPostsService.updateVariantPostAfterPublish).toHaveBeenCalledWith(
        {
          clipId: CLIP_ID,
          workspaceId: WORKSPACE_ID,
          platformPostId: 'youtube-video-123',
          platform: 'youtube_shorts',
          connectedAccountId: ACCOUNT_ID,
        },
        { supabase },
      );

      // Verify logging
      expect(logger.info).toHaveBeenCalledWith(
        'pipeline_completed',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          clipId: CLIP_ID,
          videoId: 'youtube-video-123',
          workspaceId: WORKSPACE_ID,
          connectedAccountId: ACCOUNT_ID,
        }),
      );
    });

    it('should use default title when title not provided', async () => {
      supabase.state.clips = [
        {
          id: CLIP_ID,
          project_id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          status: 'ready',
          storage_path: `renders/${WORKSPACE_ID}/${PROJECT_ID}/${CLIP_ID}.mp4`,
          external_id: null,
        },
      ];

      const mockUploadShort = vi.fn().mockResolvedValue({
        videoId: 'youtube-video-123',
      });
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await run(job, ctx);

      // Verify default title was used
      expect(mockUploadShort).toHaveBeenCalledWith({
        filePath: expect.any(String),
        title: 'Cliply Short',
        description: undefined,
        tags: undefined,
        visibility: undefined,
      });
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
        },
      ];

      const VARIANT_ID = '55555555-5555-4555-8555-555555555555';
      const EXPERIMENT_ID = '66666666-6666-4666-8666-666666666666';

      supabase.state.variant_posts = [
        {
          id: 'variant-post-1',
          clip_id: CLIP_ID,
          connected_account_id: ACCOUNT_ID,
          variant_id: VARIANT_ID,
          platform: 'youtube_shorts',
          status: 'posted',
          platform_post_id: 'youtube-video-existing',
        },
      ];

      const mockUploadShort = vi.fn();
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
          experimentId: EXPERIMENT_ID,
          variantId: VARIANT_ID,
        },
      };

      await run(job, ctx);

      // Should not call YouTube API
      expect(mockUploadShort).not.toHaveBeenCalled();

      // Should log idempotent skip
      expect(logger.info).toHaveBeenCalledWith(
        'publish_skip_existing_variant_post',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
          variantPostId: 'variant-post-1',
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
          external_id: 'youtube-legacy-id',
        },
      ];

      const mockUploadShort = vi.fn();
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await run(job, ctx);

      // Should not call YouTube API
      expect(mockUploadShort).not.toHaveBeenCalled();

      // Should log legacy skip
      expect(logger.info).toHaveBeenCalledWith(
        'publish_skip_existing',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          clipId: CLIP_ID,
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
        },
      ];

      await fs.mkdir(dirname(tempVideoPath), { recursive: true });
      await fs.writeFile(tempVideoPath, Buffer.from([0, 1, 2, 3]));
    });

    it('should handle YouTube 401 auth error', async () => {
      const mockUploadShort = vi.fn().mockRejectedValue(
        new YouTubeApiError('Authentication failed', 401, {
          youtubeErrorCode: 'invalid_token',
          youtubeErrorMessage: 'Invalid access token',
          retryable: false,
        }),
      );
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(YouTubeApiError);

      expect(logger.error).toHaveBeenCalledWith(
        'pipeline_failed',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          jobId: 'test-job',
          workspaceId: WORKSPACE_ID,
          error: expect.stringContaining('Authentication failed'),
        }),
      );

      expect(sentry.captureException).toHaveBeenCalled();
    });

    it('should handle YouTube 403 forbidden error', async () => {
      const mockUploadShort = vi.fn().mockRejectedValue(
        new YouTubeApiError('Forbidden', 403, {
          youtubeErrorCode: 'insufficient_permission',
          retryable: false,
        }),
      );
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(YouTubeApiError);

      expect(logger.error).toHaveBeenCalledWith(
        'pipeline_failed',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          error: expect.stringContaining('Forbidden'),
        }),
      );
    });

    it('should handle YouTube 429 rate limit error (retryable)', async () => {
      const mockUploadShort = vi.fn().mockRejectedValue(
        new YouTubeApiError('Rate limited', 429, {
          retryable: true,
        }),
      );
      vi.mocked(YouTubeClient).mockImplementation(() => ({
        uploadShort: mockUploadShort,
      } as unknown as YouTubeClient));

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(YouTubeApiError);

      expect(logger.error).toHaveBeenCalledWith(
        'pipeline_failed',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          error: expect.stringContaining('Rate limited'),
        }),
      );
    });

    it('should handle missing clip', async () => {
      supabase.state.clips = [];

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
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
        },
      ];

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/clip not ready for publish/);
    });

    it('should handle token fetch failure', async () => {
      vi.mocked(youtubeAuth.getFreshYouTubeAccessToken).mockRejectedValue(
        new Error('Token refresh failed'),
      );

      const job: Job<unknown> = {
        id: 'test-job',
        type: 'PUBLISH_YOUTUBE',
        workspaceId: WORKSPACE_ID,
        payload: {
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
        },
      };

      await expect(run(job, ctx)).rejects.toThrow(/Failed to get YouTube access token/);

      expect(logger.error).toHaveBeenCalledWith(
        'publish_youtube_token_fetch_failed',
        expect.objectContaining({
          pipeline: 'PUBLISH_YOUTUBE',
          clipId: CLIP_ID,
          connectedAccountId: ACCOUNT_ID,
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
      published_at?: string;
    }>,
    variant_posts: [] as Array<{
      id: string;
      clip_id: string;
      connected_account_id: string;
      variant_id: string;
      platform: string;
      status: string;
      platform_post_id: string | null;
    }>,
    schedules: [] as Array<{
      id: string;
      clip_id: string;
      provider: string;
      status: string;
      sent_at: string | null;
    }>,
  };

  return {
    state,
    from(table: 'clips' | 'variant_posts' | 'schedules') {
      if (table === 'clips') {
        return {
          select: (fields: string) => ({
            eq: (field: string, value: string) => {
              const filtered = state.clips.filter((row) => row[field as keyof typeof row] === value);
              // Pipeline expects array but takes first element
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

      if (table === 'variant_posts') {
        // Pipeline uses: .eq('clip_id').eq('connected_account_id').eq('variant_id').eq('platform').maybeSingle()
        const createChain = () => {
          let clipId: string | null = null;
          let connectedAccountId: string | null = null;
          let variantId: string | null = null;
          let platform: string | null = null;

          const chain: any = {
            eq: (field: string, value: string) => {
              if (field === 'clip_id') clipId = value;
              else if (field === 'connected_account_id') connectedAccountId = value;
              else if (field === 'variant_id') variantId = value;
              else if (field === 'platform') platform = value;
              return chain;
            },
            maybeSingle: () => {
              const found = state.variant_posts.find(
                (post) =>
                  (clipId === null || post.clip_id === clipId) &&
                  (connectedAccountId === null || post.connected_account_id === connectedAccountId) &&
                  (variantId === null || post.variant_id === variantId) &&
                  (platform === null || post.platform === platform),
              );
              return Promise.resolve({ data: found ?? null, error: null });
            },
          };
          return chain;
        };

        return {
          select: (fields: string) => createChain(),
        };
      }

      if (table === 'schedules') {
        // Pipeline uses: .select().eq('clip_id').eq('provider')
        return {
          select: (fields: string) => ({
            eq: (field: string, value: string) => ({
              eq: (field2: string, value2: string) => {
                // Returns array, then pipeline uses .find()
                const filtered = state.schedules.filter(
                  (row) =>
                    row[field as keyof typeof row] === value &&
                    row[field2 as keyof typeof row] === value2,
                );
                return Promise.resolve({
                  data: filtered,
                  error: null,
                  find: (predicate: (row: (typeof state.schedules)[number]) => boolean) => {
                    return filtered.find(predicate);
                  },
                });
              },
            }),
          }),
          update: (values: Partial<(typeof state.schedules)[number]>) => ({
            eq: (field: string, value: string) => {
              state.schedules.forEach((schedule) => {
                if (schedule[field as keyof typeof schedule] === value) {
                  Object.assign(schedule, values);
                }
              });
              return Promise.resolve({ data: null, error: null });
            },
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

