import { describe, it, expect } from 'vitest';
import {
  canPostClip,
  enforcePostLimits,
  getDefaultPostingLimitsForPlan,
  PostingLimitExceededError,
  type PostHistoryEvent,
  type PostingLimits,
} from '../../packages/shared/src/engine/postingGuard';

describe('postingGuard', () => {
  describe('getDefaultPostingLimitsForPlan', () => {
    it('returns conservative limits for basic plan', () => {
      const limits = getDefaultPostingLimitsForPlan('basic');
      expect(limits.maxPerDay).toBe(10);
      expect(limits.minIntervalMs).toBe(300_000); // 5 minutes
    });

    it('returns moderate limits for pro plan', () => {
      const limits = getDefaultPostingLimitsForPlan('pro');
      expect(limits.maxPerDay).toBe(30);
      expect(limits.minIntervalMs).toBe(120_000); // 2 minutes
    });

    it('returns generous limits for premium plan', () => {
      const limits = getDefaultPostingLimitsForPlan('premium');
      expect(limits.maxPerDay).toBe(50);
      expect(limits.minIntervalMs).toBe(60_000); // 1 minute
    });

    it('defaults to basic plan limits when plan is undefined', () => {
      const limits = getDefaultPostingLimitsForPlan(undefined);
      expect(limits.maxPerDay).toBe(10);
      expect(limits.minIntervalMs).toBe(300_000);
    });

    it('defaults to basic plan limits for unknown plan names', () => {
      const limits = getDefaultPostingLimitsForPlan('unknown-plan');
      expect(limits.maxPerDay).toBe(10);
      expect(limits.minIntervalMs).toBe(300_000);
    });
  });

  describe('canPostClip - Under limits', () => {
    it('allows posting with empty history', () => {
      const result = canPostClip({
        now: new Date(),
        history: [],
        limits: { maxPerDay: 10, minIntervalMs: 300_000 },
      });

      expect(result.allowed).toBe(true);
    });

    it('allows posting when well under daily limit', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T10:00:00Z'), // 2 hours ago
        },
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-2',
          postedAt: new Date('2025-01-01T08:00:00Z'), // 4 hours ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 300_000 }, // 5 min interval
      });

      expect(result.allowed).toBe(true);
    });

    it('allows posting when minimum interval has elapsed', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:54:59Z'), // 5min 1sec ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 300_000 }, // 5 min = 300s
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('canPostClip - Daily limit exceeded', () => {
    it('blocks posting when daily limit is reached', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      
      // Create 10 posts within last 24 hours
      const history: PostHistoryEvent[] = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-1',
        platform: 'tiktok',
        clipId: `clip-${i}`,
        postedAt: new Date(`2025-01-01T${String(i).padStart(2, '0')}:00:00Z`),
      }));

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 60_000 },
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DAILY_LIMIT');
    });

    it('only counts posts within last 24 hours toward daily limit', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      
      const history: PostHistoryEvent[] = [
        // Old posts (> 24h ago) - should not count
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'old-1',
          postedAt: new Date('2025-01-01T11:59:00Z'), // 24h 1min ago
        },
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'old-2',
          postedAt: new Date('2025-01-01T10:00:00Z'), // 26h ago
        },
        // Recent posts (< 24h ago) - should count
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'recent-1',
          postedAt: new Date('2025-01-02T11:00:00Z'), // 1h ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 2, minIntervalMs: 60_000 },
      });

      // Should be allowed: only 1 post in last 24h (< limit of 2)
      expect(result.allowed).toBe(true);
    });

    it('blocks when exactly at daily limit', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      
      const history: PostHistoryEvent[] = Array.from({ length: 5 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-1',
        platform: 'tiktok',
        clipId: `clip-${i}`,
        postedAt: new Date(`2025-01-01T${String(i + 7).padStart(2, '0')}:00:00Z`),
      }));

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 5, minIntervalMs: 60_000 },
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DAILY_LIMIT');
    });
  });

  describe('canPostClip - Minimum interval violated', () => {
    it('blocks posting when minimum interval has not elapsed', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:58:00Z'), // 2 min ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 300_000 }, // 5 min
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('MIN_INTERVAL');
      // Should have ~3 minutes (180s) remaining
      expect(result.remainingMs).toBeGreaterThan(179_000);
      expect(result.remainingMs).toBeLessThan(181_000);
    });

    it('checks interval against most recent post only', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T10:00:00Z'), // 2h ago
        },
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-2',
          postedAt: new Date('2025-01-01T11:58:00Z'), // 2 min ago (most recent)
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 180_000 }, // 3 min
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('MIN_INTERVAL');
      expect(result.remainingMs).toBeGreaterThan(59_000);
      expect(result.remainingMs).toBeLessThan(61_000);
    });

    it('provides accurate remainingMs calculation', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:59:30Z'), // 30 seconds ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 60_000 }, // 60 seconds
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('MIN_INTERVAL');
      expect(result.remainingMs).toBeGreaterThanOrEqual(29_000);
      expect(result.remainingMs).toBeLessThanOrEqual(31_000);
    });
  });

  describe('canPostClip - Boundary cases', () => {
    it('allows posting when exactly at minimum interval', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:55:00Z'), // Exactly 5 min ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 300_000 }, // 5 min
      });

      expect(result.allowed).toBe(true);
    });

    it('allows posting when exactly 24h has passed (oldest post)', () => {
      const now = new Date('2025-01-02T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T12:00:00Z'), // Exactly 24h ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 1, minIntervalMs: 60_000 },
      });

      // Post exactly 24h ago should still count (>=)
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('DAILY_LIMIT');
    });

    it('handles posts at millisecond boundaries correctly', () => {
      const now = new Date('2025-01-01T12:00:00.000Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:59:59.999Z'), // 1ms ago
        },
      ];

      const result = canPostClip({
        now,
        history,
        limits: { maxPerDay: 10, minIntervalMs: 1 }, // 1ms
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('enforcePostLimits', () => {
    it('throws PostingLimitExceededError when daily limit exceeded', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-1',
        platform: 'tiktok',
        clipId: `clip-${i}`,
        postedAt: new Date(`2025-01-01T${String(i).padStart(2, '0')}:00:00Z`),
      }));

      expect(() =>
        enforcePostLimits({
          now,
          history,
          limits: { maxPerDay: 10, minIntervalMs: 60_000 },
          platform: 'tiktok',
          accountId: 'acc-1',
        })
      ).toThrow(PostingLimitExceededError);
    });

    it('throws PostingLimitExceededError when minimum interval violated', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T11:58:00Z'), // 2 min ago
        },
      ];

      expect(() =>
        enforcePostLimits({
          now,
          history,
          limits: { maxPerDay: 10, minIntervalMs: 300_000 }, // 5 min
          platform: 'tiktok',
          accountId: 'acc-1',
        })
      ).toThrow(PostingLimitExceededError);
    });

    it('does not throw when posting is allowed', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      const history: PostHistoryEvent[] = [
        {
          workspaceId: 'ws-1',
          accountId: 'acc-1',
          platform: 'tiktok',
          clipId: 'clip-1',
          postedAt: new Date('2025-01-01T10:00:00Z'), // 2h ago
        },
      ];

      expect(() =>
        enforcePostLimits({
          now,
          history,
          limits: { maxPerDay: 10, minIntervalMs: 60_000 },
          platform: 'tiktok',
          accountId: 'acc-1',
        })
      ).not.toThrow();
    });
  });

  describe('PostingLimitExceededError', () => {
    it('has correct error code', () => {
      const error = new PostingLimitExceededError({
        reason: 'DAILY_LIMIT',
        platform: 'tiktok',
        accountId: 'acc-1',
      });

      expect(error.code).toBe('POSTING_LIMIT_EXCEEDED');
    });

    it('includes reason in error properties', () => {
      const error = new PostingLimitExceededError({
        reason: 'MIN_INTERVAL',
        platform: 'youtube',
        accountId: 'acc-2',
      });

      expect(error.reason).toBe('MIN_INTERVAL');
    });

    it('includes platform and accountId', () => {
      const error = new PostingLimitExceededError({
        reason: 'DAILY_LIMIT',
        platform: 'tiktok',
        accountId: 'acc-123',
      });

      expect(error.platform).toBe('tiktok');
      expect(error.accountId).toBe('acc-123');
    });

    it('includes remainingMs when provided', () => {
      const error = new PostingLimitExceededError({
        reason: 'MIN_INTERVAL',
        platform: 'tiktok',
        accountId: 'acc-1',
        remainingMs: 120_000,
      });

      expect(error.remainingMs).toBe(120_000);
    });

    it('has default message for DAILY_LIMIT', () => {
      const error = new PostingLimitExceededError({
        reason: 'DAILY_LIMIT',
        platform: 'tiktok',
        accountId: 'acc-1',
      });

      expect(error.message).toContain('Daily posting limit');
      expect(error.message).toContain('tiktok');
    });

    it('has default message for MIN_INTERVAL', () => {
      const error = new PostingLimitExceededError({
        reason: 'MIN_INTERVAL',
        platform: 'youtube',
        accountId: 'acc-1',
      });

      expect(error.message).toContain('Minimum interval');
      expect(error.message).toContain('youtube');
    });

    it('allows custom error message', () => {
      const error = new PostingLimitExceededError({
        reason: 'DAILY_LIMIT',
        platform: 'tiktok',
        accountId: 'acc-1',
        message: 'Custom error message',
      });

      expect(error.message).toBe('Custom error message');
    });

    it('is instanceof Error', () => {
      const error = new PostingLimitExceededError({
        reason: 'DAILY_LIMIT',
        platform: 'tiktok',
        accountId: 'acc-1',
      });

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Integration scenarios', () => {
    it('handles multiple platforms independently', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      
      // TikTok history: 5 posts (under limit)
      const tiktokHistory: PostHistoryEvent[] = Array.from({ length: 5 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-tiktok',
        platform: 'tiktok',
        clipId: `clip-tk-${i}`,
        postedAt: new Date(`2025-01-01T${String(i + 5).padStart(2, '0')}:00:00Z`),
      }));

      // YouTube history: 10 posts (at limit)
      const youtubeHistory: PostHistoryEvent[] = Array.from({ length: 10 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-youtube',
        platform: 'youtube',
        clipId: `clip-yt-${i}`,
        postedAt: new Date(`2025-01-01T${String(i).padStart(2, '0')}:00:00Z`),
      }));

      const limits = { maxPerDay: 10, minIntervalMs: 60_000 };

      // TikTok should be allowed
      const tiktokResult = canPostClip({ now, history: tiktokHistory, limits });
      expect(tiktokResult.allowed).toBe(true);

      // YouTube should be blocked
      const youtubeResult = canPostClip({ now, history: youtubeHistory, limits });
      expect(youtubeResult.allowed).toBe(false);
      expect(youtubeResult.reason).toBe('DAILY_LIMIT');
    });

    it('enforces both daily limit and interval correctly', () => {
      const now = new Date('2025-01-01T12:00:00Z');
      
      // 9 posts, all old (> 10 min ago)
      const history: PostHistoryEvent[] = Array.from({ length: 9 }, (_, i) => ({
        workspaceId: 'ws-1',
        accountId: 'acc-1',
        platform: 'tiktok',
        clipId: `clip-${i}`,
        postedAt: new Date(`2025-01-01T${String(i).padStart(2, '0')}:00:00Z`),
      }));

      const limits = { maxPerDay: 10, minIntervalMs: 300_000 }; // 5 min interval

      // Should be allowed: 9 < 10 daily, last post is 2h ago > 5min
      const result = canPostClip({ now, history, limits });
      expect(result.allowed).toBe(true);
    });
  });
});

