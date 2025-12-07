import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkerContext, Job, StorageAdapter } from '../../apps/worker/src/pipelines/types';
import { run as runCleanupStorage } from '../../apps/worker/src/pipelines/cleanup-storage';

// Create mock storage adapter
const createMockStorageAdapter = (): StorageAdapter => ({
  exists: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  removeBatch: vi.fn(),
});

// Create mock context
const createMockContext = (overrides?: Partial<WorkerContext>): WorkerContext => {
  const mockSupabase = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ /* chainable */ })),
          lt: vi.fn(() => ({ /* chainable */ })),
          in: vi.fn(() => ({ /* chainable */ })),
        })),
        lt: vi.fn(() => ({
          eq: vi.fn(() => ({ /* chainable */ })),
        })),
        in: vi.fn(() => ({ /* chainable */ })),
      })),
    })),
  } as any;

  return {
    supabase: mockSupabase,
    storage: createMockStorageAdapter(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
    },
    queue: {
      enqueue: vi.fn(),
    },
    ...overrides,
  };
};

describe('cleanup-storage pipeline', () => {
  let mockContext: WorkerContext;

  beforeEach(() => {
    mockContext = createMockContext();
    vi.clearAllMocks();
  });

  describe('Basic cleanup operations', () => {
    it('should parse valid cleanup job payload', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        payload: {
          // No workspace or project specified - global cleanup
          retentionDays: 30,
        },
      };

      // Mock DB responses for failed clips (empty result)
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      }));

      mockContext.supabase.from = vi.fn(() => ({ select: mockSelect })) as any;

      // Mock storage list (empty)
      (mockContext.storage.list as any).mockResolvedValue([]);

      await runCleanupStorage(job, mockContext);

      // Should call logger.info with cleanup_start and cleanup_complete
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'storage_cleanup_start',
        expect.objectContaining({
          pipeline: 'CLEANUP_STORAGE',
          retentionDays: 30,
          targetWorkspaceId: 'global', // No workspace specified
        }),
      );

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'storage_cleanup_complete',
        expect.objectContaining({
          pipeline: 'CLEANUP_STORAGE',
          totalFilesDeleted: 0,
        }),
      );
    });

    it('should enforce minimum retention of 7 days', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        payload: {
          retentionDays: 2, // Try to set too short
        },
      };

      // Mock DB responses (empty)
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      }));

      mockContext.supabase.from = vi.fn(() => ({ select: mockSelect })) as any;
      (mockContext.storage.list as any).mockResolvedValue([]);

      await runCleanupStorage(job, mockContext);

      // Should use 7 days (minimum), not 2
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'storage_cleanup_start',
        expect.objectContaining({
          retentionDays: 7,
        }),
      );
    });

    it('should use default retention of 30 days when not specified', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        payload: {},
      };

      // Mock DB responses (empty)
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      }));

      mockContext.supabase.from = vi.fn(() => ({ select: mockSelect })) as any;
      (mockContext.storage.list as any).mockResolvedValue([]);

      await runCleanupStorage(job, mockContext);

      // Should use 30 days (default)
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'storage_cleanup_start',
        expect.objectContaining({
          retentionDays: 30,
        }),
      );
    });
  });

  describe('Failed renders cleanup', () => {
    it('should delete renders and thumbs for failed clips', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'workspace-abc',
        payload: {
          retentionDays: 30,
        },
      };

      // Mock failed clips
      const failedClips = [
        {
          id: 'clip-1',
          project_id: 'project-a',
          workspace_id: 'workspace-abc',
          storage_path: 'renders/workspace-abc/project-a/clip-1.mp4',
          thumb_path: 'thumbs/workspace-abc/project-a/clip-1.jpg',
          updated_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
        },
        {
          id: 'clip-2',
          project_id: 'project-a',
          workspace_id: 'workspace-abc',
          storage_path: 'renders/workspace-abc/project-a/clip-2.mp4',
          thumb_path: null,
          updated_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
        },
      ];

      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            data: failedClips,
            error: null,
          })),
        })),
        in: vi.fn(() => ({
          data: [],
          error: null,
        })),
      }));

      mockContext.supabase.from = vi.fn(() => ({ select: mockSelect })) as any;
      (mockContext.storage.list as any).mockResolvedValue([]);
      (mockContext.storage.removeBatch as any).mockResolvedValue(2); // 2 files deleted

      await runCleanupStorage(job, mockContext);

      // Should delete renders
      expect(mockContext.storage.removeBatch).toHaveBeenCalledWith(
        'renders',
        ['workspace-abc/project-a/clip-1.mp4', 'workspace-abc/project-a/clip-2.mp4'],
      );

      // Should delete thumbs (only for clip-1 that has thumb_path)
      expect(mockContext.storage.removeBatch).toHaveBeenCalledWith('thumbs', ['workspace-abc/project-a/clip-1.jpg']);

      // Should log deleted files
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'cleanup_deleted_failed_renders',
        expect.objectContaining({
          bucket: 'renders',
          count: 2,
        }),
      );
    });
  });

  describe('Orphaned renders cleanup', () => {
    it('should delete renders for clips that no longer exist in DB', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        payload: {
          retentionDays: 30,
        },
      };

      // Mock empty failed clips query
      const mockFailedClipsResponse = {
        data: [],
        error: null,
      };

      // Mock existing clips (only clip-2 exists, these are valid UUIDs)
      const mockExistingClipsResponse = {
        data: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }],
        error: null,
      };

      let fromCallCount = 0;
      mockContext.supabase.from = vi.fn(() => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // First call: query failed clips
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                lt: vi.fn(() => mockFailedClipsResponse),
              })),
            })),
          };
        } else {
          // Second call: query existing clips
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => mockExistingClipsResponse),
            })),
          };
        }
      }) as any;

      // Mock storage list with files (using valid UUID pattern)
      (mockContext.storage.list as any).mockResolvedValue([
        'workspace-abc/project-a/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4', // Orphaned (not in DB)
        'workspace-abc/project-a/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4', // Not orphaned (in DB)
        'workspace-abc/project-a/cccccccc-cccc-cccc-cccc-cccccccccccc.mp4', // Orphaned (not in DB)
      ]);

      (mockContext.storage.removeBatch as any).mockResolvedValue(2); // 2 orphaned files deleted

      await runCleanupStorage(job, mockContext);

      // Should delete only orphaned files (clip-1 and clip-3, not clip-2)
      expect(mockContext.storage.removeBatch).toHaveBeenCalledWith('renders', [
        'workspace-abc/project-a/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4',
        'workspace-abc/project-a/cccccccc-cccc-cccc-cccc-cccccccccccc.mp4',
      ]);

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'cleanup_deleted_orphaned_renders',
        expect.objectContaining({
          bucket: 'renders',
          count: 2,
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('should handle DB errors gracefully', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'workspace-abc',
        payload: {},
      };

      // Mock DB error
      const mockSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({
            data: null,
            error: { message: 'Database error' },
          })),
        })),
      }));

      mockContext.supabase.from = vi.fn(() => ({ select: mockSelect })) as any;
      (mockContext.storage.list as any).mockResolvedValue([]);

      await runCleanupStorage(job, mockContext);

      // Should log warning but continue
      expect(mockContext.logger.warn).toHaveBeenCalledWith(
        'cleanup_failed_clips_query_error',
        expect.objectContaining({
          error: 'Database error',
        }),
      );

      // Should still complete
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'storage_cleanup_complete',
        expect.any(Object),
      );
    });

    it('should capture exceptions and re-throw', async () => {
      const job: Job<unknown> = {
        id: 'job-123',
        type: 'CLEANUP_STORAGE',
        workspaceId: 'workspace-abc',
        payload: {},
      };

      // Mock unexpected error
      mockContext.supabase.from = vi.fn(() => {
        throw new Error('Unexpected error');
      }) as any;

      await expect(runCleanupStorage(job, mockContext)).rejects.toThrow('Unexpected error');

      // Should capture exception in Sentry
      expect(mockContext.sentry.captureException).toHaveBeenCalled();

      // Should log error
      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'storage_cleanup_failed',
        expect.objectContaining({
          pipeline: 'CLEANUP_STORAGE',
          error: 'Unexpected error',
        }),
      );
    });
  });
});

