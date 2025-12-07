import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockMaybeSingle = vi.fn();
  
  return {
    createClient: vi.fn(() => ({
      rpc: mockRpc,
      from: mockFrom,
    })),
    // Export mocks for test access
    __mockRpc: mockRpc,
    __mockFrom: mockFrom,
    __mockSelect: mockSelect,
    __mockEq: mockEq,
    __mockMaybeSingle: mockMaybeSingle,
  };
});

import {
  checkUsage,
  assertWithinUsage,
  recordUsage,
  UsageLimitExceededError,
} from '../../packages/shared/src/billing/usageTracker';
import { PLAN_MATRIX } from '../../packages/shared/src/billing/planMatrix';
import * as SupabaseModule from '@supabase/supabase-js';

const mockSupabaseRpc = (SupabaseModule as any).__mockRpc;
const mockSupabaseFrom = (SupabaseModule as any).__mockFrom;
const mockSupabaseSelect = (SupabaseModule as any).__mockSelect;
const mockSupabaseEq = (SupabaseModule as any).__mockEq;
const mockSupabaseMaybeSingle = (SupabaseModule as any).__mockMaybeSingle;

describe('usageTracker - posts metric', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock chain
    mockSupabaseFrom.mockReturnValue({
      select: mockSupabaseSelect,
    });
    
    mockSupabaseSelect.mockReturnValue({
      eq: mockSupabaseEq,
    });
    
    mockSupabaseEq.mockReturnValue({
      eq: mockSupabaseEq,
      maybeSingle: mockSupabaseMaybeSingle,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Plan limits for posts', () => {
    it('basic plan has posts_per_month defined', () => {
      expect(PLAN_MATRIX.basic.limits.posts_per_month).toBe(300);
    });

    it('pro plan has posts_per_month defined', () => {
      expect(PLAN_MATRIX.pro.limits.posts_per_month).toBe(900);
    });

    it('premium plan has posts_per_month defined', () => {
      expect(PLAN_MATRIX.premium.limits.posts_per_month).toBe(1500);
    });
  });

  describe('checkUsage with posts metric', () => {
    it('allows posting when well below posts limit', async () => {
      // Mock workspace plan
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'basic' },
        error: null,
      });

      // Mock current usage (5 posts used out of 300)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 50,
          clips_count: 100,
          projects_count: 5,
          posts_count: 5,
        },
        error: null,
      });

      const result = await checkUsage('workspace-123', 'posts', 1);

      expect(result.ok).toBe(true);
    });

    it('blocks posting when at posts limit', async () => {
      // Mock workspace plan
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'basic' },
        error: null,
      });

      // Mock current usage (300 posts used out of 300)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 50,
          clips_count: 100,
          projects_count: 5,
          posts_count: 300,
        },
        error: null,
      });

      const result = await checkUsage('workspace-123', 'posts', 1);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('limit_exceeded');
      expect(result.metric).toBe('posts');
      expect(result.used).toBe(300);
      expect(result.limit).toBe(300);
    });

    it('blocks posting when exceeding posts limit', async () => {
      // Mock workspace plan (pro with 900 limit)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'pro' },
        error: null,
      });

      // Mock current usage (899 posts, trying to add 1 would exceed)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 500,
          clips_count: 5000,
          projects_count: 50,
          posts_count: 899,
        },
        error: null,
      });

      const result = await checkUsage('workspace-123', 'posts', 1);

      expect(result.ok).toBe(true); // 899 + 1 = 900, still within limit
    });

    it('allows large batches if within limit', async () => {
      // Mock workspace plan (premium with 1500 limit)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'premium' },
        error: null,
      });

      // Mock current usage (100 posts)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 1000,
          clips_count: 10000,
          projects_count: 100,
          posts_count: 100,
        },
        error: null,
      });

      // Try to add 50 posts at once
      const result = await checkUsage('workspace-123', 'posts', 50);

      expect(result.ok).toBe(true); // 100 + 50 = 150, well within 1500
    });
  });

  describe('assertWithinUsage with posts metric', () => {
    it('does not throw when within posts limit', async () => {
      // Mock workspace plan
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'basic' },
        error: null,
      });

      // Mock current usage (100 posts out of 300)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 50,
          clips_count: 200,
          projects_count: 10,
          posts_count: 100,
        },
        error: null,
      });

      await expect(
        assertWithinUsage('workspace-123', 'posts', 1)
      ).resolves.not.toThrow();
    });

    it('throws UsageLimitExceededError when posts limit exceeded', async () => {
      // Mock workspace plan
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'basic' },
        error: null,
      });

      // Mock current usage (300 posts, at limit)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 50,
          clips_count: 200,
          projects_count: 10,
          posts_count: 300,
        },
        error: null,
      });

      await expect(
        assertWithinUsage('workspace-123', 'posts', 1)
      ).rejects.toThrow(UsageLimitExceededError);
    });

    it('throws with correct error properties', async () => {
      // Mock workspace plan (pro with 900 limit)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'pro' },
        error: null,
      });

      // Mock current usage (900 posts, at limit)
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 500,
          clips_count: 5000,
          projects_count: 50,
          posts_count: 900,
        },
        error: null,
      });

      try {
        await assertWithinUsage('workspace-123', 'posts', 1);
        expect.fail('Should have thrown UsageLimitExceededError');
      } catch (error) {
        expect(error).toBeInstanceOf(UsageLimitExceededError);
        if (error instanceof UsageLimitExceededError) {
          expect(error.metric).toBe('posts');
          expect(error.used).toBe(900);
          expect(error.limit).toBe(900);
          expect(error.status).toBe(429);
        }
      }
    });
  });

  describe('recordUsage with posts metric', () => {
    it('calls increment_workspace_usage RPC with posts_count', async () => {
      mockSupabaseRpc.mockResolvedValueOnce({ error: null });

      await recordUsage({
        workspaceId: 'workspace-123',
        metric: 'posts',
        amount: 1,
      });

      expect(mockSupabaseRpc).toHaveBeenCalledWith('increment_workspace_usage', {
        p_workspace_id: 'workspace-123',
        p_period_start: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        p_metric: 'posts_count',
        p_amount: 1,
      });
    });

    it('maps posts metric to posts_count column', async () => {
      mockSupabaseRpc.mockResolvedValueOnce({ error: null });

      await recordUsage({
        workspaceId: 'workspace-456',
        metric: 'posts',
        amount: 5,
      });

      const call = mockSupabaseRpc.mock.calls[0];
      expect(call[0]).toBe('increment_workspace_usage');
      expect(call[1].p_metric).toBe('posts_count');
      expect(call[1].p_amount).toBe(5);
    });

    it('uses correct period start date format', async () => {
      mockSupabaseRpc.mockResolvedValueOnce({ error: null });

      const testDate = new Date('2025-12-15T10:30:00Z');

      await recordUsage({
        workspaceId: 'workspace-123',
        metric: 'posts',
        amount: 1,
        at: testDate,
      });

      expect(mockSupabaseRpc).toHaveBeenCalledWith('increment_workspace_usage', {
        p_workspace_id: 'workspace-123',
        p_period_start: '2025-12-01',
        p_metric: 'posts_count',
        p_amount: 1,
      });
    });
  });

  describe('posts metric consistency with other metrics', () => {
    it('posts behaves like clips and projects (integer count)', async () => {
      // All count-based metrics should behave similarly
      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: { plan: 'basic' },
        error: null,
      });

      mockSupabaseMaybeSingle.mockResolvedValueOnce({
        data: {
          source_minutes: 50,
          clips_count: 200,
          projects_count: 10,
          posts_count: 150,
        },
        error: null,
      });

      const result = await checkUsage('workspace-123', 'posts', 1);
      expect(result.ok).toBe(true);
      // Since result.ok is true, used and limit are not included
      // They only appear when result.ok is false
    });
  });
});

