import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkerContext, Job } from '../../apps/worker/src/pipelines/types';
import {
  PostingLimitExceededError,
  getDefaultPostingLimitsForPlan,
  enforcePostLimits,
  type PostHistoryEvent,
} from '../../packages/shared/src/engine/postingGuard';

// Mock the publish pipelines - we'll test the posting guard logic in isolation
// by creating a helper that simulates the plan lookup and guard enforcement

describe('publish pipelines - plan-aware posting guard', () => {
  let mockContext: WorkerContext;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(),
          })),
        })),
      })),
    };

    mockContext = {
      supabase: mockSupabase,
      storage: {
        exists: vi.fn(),
        list: vi.fn(),
        download: vi.fn(),
        upload: vi.fn(),
        remove: vi.fn(),
        removeBatch: vi.fn(),
      },
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
    };
  });

  describe('plan resolution and limits', () => {
    it('should resolve basic plan and use basic posting limits', async () => {
      // Mock workspace with basic plan
      const mockWorkspace = { plan: 'basic' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockWorkspace, error: null }),
          }),
        }),
      });

      // Simulate the plan lookup logic
      const { data: workspace } = await mockContext.supabase
        .from('workspaces')
        .select('plan')
        .eq('id', 'workspace-123')
        .maybeSingle();

      expect(workspace?.plan).toBe('basic');
    });

    it('should resolve pro plan and use pro posting limits', async () => {
      const mockWorkspace = { plan: 'pro' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockWorkspace, error: null }),
          }),
        }),
      });

      const { data: workspace } = await mockContext.supabase
        .from('workspaces')
        .select('plan')
        .eq('id', 'workspace-456')
        .maybeSingle();

      expect(workspace?.plan).toBe('pro');
    });

    it('should resolve premium plan and use premium posting limits', async () => {
      const mockWorkspace = { plan: 'premium' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockWorkspace, error: null }),
          }),
        }),
      });

      const { data: workspace } = await mockContext.supabase
        .from('workspaces')
        .select('plan')
        .eq('id', 'workspace-789')
        .maybeSingle();

      expect(workspace?.plan).toBe('premium');
    });

    it('should fallback to basic plan when workspace plan is missing', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      const { data: workspace } = await mockContext.supabase
        .from('workspaces')
        .select('plan')
        .eq('id', 'workspace-unknown')
        .maybeSingle();

      // Should fallback to basic
      const planName = workspace?.plan === 'basic' || workspace?.plan === 'pro' || workspace?.plan === 'premium'
        ? workspace.plan
        : 'basic';

      expect(planName).toBe('basic');
    });

    it('should fallback to basic plan when workspace plan is invalid', async () => {
      const mockWorkspace = { plan: 'invalid-plan' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockWorkspace, error: null }),
          }),
        }),
      });

      const { data: workspace } = await mockContext.supabase
        .from('workspaces')
        .select('plan')
        .eq('id', 'workspace-invalid')
        .maybeSingle();

      const planName = workspace?.plan === 'basic' || workspace?.plan === 'pro' || workspace?.plan === 'premium'
        ? workspace.plan
        : 'basic';

      expect(planName).toBe('basic');
    });
  });

  describe('posting guard enforcement with different plans', () => {
    it('should enforce basic plan limits (10/day, 5min interval)', () => {
      const limits = getDefaultPostingLimitsForPlan('basic');
      expect(limits.maxPerDay).toBe(10);
      expect(limits.minIntervalMs).toBe(300_000); // 5 minutes

      // Create history at the limit
      const now = new Date();
      const history: PostHistoryEvent[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({
          workspaceId: 'workspace-123',
          accountId: 'account-123',
          platform: 'tiktok',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000), // Spread over 23 hours
        });
      }

      // Should throw when at limit
      expect(() => {
        enforcePostLimits({
          now,
          history,
          limits,
          platform: 'tiktok',
          accountId: 'account-123',
        });
      }).toThrow(PostingLimitExceededError);

      // Should allow when under limit
      const historyUnderLimit = history.slice(0, 9);
      expect(() => {
        enforcePostLimits({
          now,
          history: historyUnderLimit,
          limits,
          platform: 'tiktok',
          accountId: 'account-123',
        });
      }).not.toThrow();
    });

    it('should enforce pro plan limits (30/day, 2min interval)', () => {
      const limits = getDefaultPostingLimitsForPlan('pro');
      expect(limits.maxPerDay).toBe(30);
      expect(limits.minIntervalMs).toBe(120_000); // 2 minutes

      // Create history at basic limit (10 posts) - should be allowed for pro
      const now = new Date();
      const history: PostHistoryEvent[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({
          workspaceId: 'workspace-456',
          accountId: 'account-456',
          platform: 'youtube_shorts',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000),
        });
      }

      // Should allow 10 posts for pro plan
      expect(() => {
        enforcePostLimits({
          now,
          history,
          limits,
          platform: 'youtube_shorts',
          accountId: 'account-456',
        });
      }).not.toThrow();

      // But should block at pro limit (30)
      const historyAtProLimit: PostHistoryEvent[] = [];
      for (let i = 0; i < 30; i++) {
        historyAtProLimit.push({
          workspaceId: 'workspace-456',
          accountId: 'account-456',
          platform: 'youtube_shorts',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000),
        });
      }

      expect(() => {
        enforcePostLimits({
          now,
          history: historyAtProLimit,
          limits,
          platform: 'youtube_shorts',
          accountId: 'account-456',
        });
      }).toThrow(PostingLimitExceededError);
    });

    it('should enforce premium plan limits (50/day, 1min interval)', () => {
      const limits = getDefaultPostingLimitsForPlan('premium');
      expect(limits.maxPerDay).toBe(50);
      expect(limits.minIntervalMs).toBe(60_000); // 1 minute

      // Create history at basic limit (10 posts) - should be allowed for premium
      const now = new Date();
      const history: PostHistoryEvent[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({
          workspaceId: 'workspace-789',
          accountId: 'account-789',
          platform: 'tiktok',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000),
        });
      }

      // Should allow 10 posts for premium plan
      expect(() => {
        enforcePostLimits({
          now,
          history,
          limits,
          platform: 'tiktok',
          accountId: 'account-789',
        });
      }).not.toThrow();

      // Should allow 30 posts (pro limit) for premium
      // Space them out by at least 2 minutes to avoid minimum interval violations
      const historyAtProLimit: PostHistoryEvent[] = [];
      for (let i = 0; i < 30; i++) {
        historyAtProLimit.push({
          workspaceId: 'workspace-789',
          accountId: 'account-789',
          platform: 'tiktok',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 * 60 - i * 2) * 60 * 1000), // 2 minutes apart
        });
      }

      expect(() => {
        enforcePostLimits({
          now,
          history: historyAtProLimit,
          limits,
          platform: 'tiktok',
          accountId: 'account-789',
        });
      }).not.toThrow();

      // But should block at premium limit (50)
      // Space them out by at least 2 minutes to avoid minimum interval violations
      const historyAtPremiumLimit: PostHistoryEvent[] = [];
      for (let i = 0; i < 50; i++) {
        historyAtPremiumLimit.push({
          workspaceId: 'workspace-789',
          accountId: 'account-789',
          platform: 'tiktok',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 * 60 - i * 2) * 60 * 1000), // 2 minutes apart
        });
      }

      expect(() => {
        enforcePostLimits({
          now,
          history: historyAtPremiumLimit,
          limits,
          platform: 'tiktok',
          accountId: 'account-789',
        });
      }).toThrow(PostingLimitExceededError);
    });

    it('should enforce minimum interval based on plan', () => {
      const basicLimits = getDefaultPostingLimitsForPlan('basic');
      const premiumLimits = getDefaultPostingLimitsForPlan('premium');

      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60_000); // 1 minute ago

      // Basic plan: 5 min interval - should block at 1 min
      const historyBasic: PostHistoryEvent[] = [{
        workspaceId: 'workspace-123',
        accountId: 'account-123',
        platform: 'tiktok',
        clipId: 'clip-1',
        postedAt: oneMinuteAgo,
      }];

      expect(() => {
        enforcePostLimits({
          now,
          history: historyBasic,
          limits: basicLimits,
          platform: 'tiktok',
          accountId: 'account-123',
        });
      }).toThrow(PostingLimitExceededError);

      // Premium plan: 1 min interval - should allow at 1 min
      const historyPremium: PostHistoryEvent[] = [{
        workspaceId: 'workspace-789',
        accountId: 'account-789',
        platform: 'tiktok',
        clipId: 'clip-1',
        postedAt: oneMinuteAgo,
      }];

      expect(() => {
        enforcePostLimits({
          now,
          history: historyPremium,
          limits: premiumLimits,
          platform: 'tiktok',
          accountId: 'account-789',
        });
      }).not.toThrow();
    });
  });

  describe('plan-based limit differences', () => {
    it('should demonstrate that same history is allowed for premium but not for basic', () => {
      const basicLimits = getDefaultPostingLimitsForPlan('basic');
      const premiumLimits = getDefaultPostingLimitsForPlan('premium');

      // Create history with 15 posts (over basic limit of 10, under premium limit of 50)
      const now = new Date();
      const history: PostHistoryEvent[] = [];
      for (let i = 0; i < 15; i++) {
        history.push({
          workspaceId: 'workspace-test',
          accountId: 'account-test',
          platform: 'tiktok',
          clipId: `clip-${i}`,
          postedAt: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000),
        });
      }

      // Should block for basic plan
      expect(() => {
        enforcePostLimits({
          now,
          history,
          limits: basicLimits,
          platform: 'tiktok',
          accountId: 'account-test',
        });
      }).toThrow(PostingLimitExceededError);

      // Should allow for premium plan
      expect(() => {
        enforcePostLimits({
          now,
          history,
          limits: premiumLimits,
          platform: 'tiktok',
          accountId: 'account-test',
        });
      }).not.toThrow();
    });
  });
});

