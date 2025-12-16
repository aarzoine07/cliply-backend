import { describe, it, expect } from 'vitest';
import { getPostingLimitsForPlan, type PostingLimits } from '../../packages/shared/src/billing/planMatrix';

describe('getPostingLimitsForPlan', () => {
  it('returns correct limits for basic plan', () => {
    const limits = getPostingLimitsForPlan('basic');
    expect(limits.maxPerDay).toBe(10);
    expect(limits.minIntervalMs).toBe(300_000); // 5 minutes
  });

  it('returns correct limits for pro plan', () => {
    const limits = getPostingLimitsForPlan('pro');
    expect(limits.maxPerDay).toBe(30);
    expect(limits.minIntervalMs).toBe(120_000); // 2 minutes
  });

  it('returns correct limits for premium plan', () => {
    const limits = getPostingLimitsForPlan('premium');
    expect(limits.maxPerDay).toBe(50);
    expect(limits.minIntervalMs).toBe(60_000); // 1 minute
  });

  it('defaults to basic limits when plan is undefined', () => {
    const limits = getPostingLimitsForPlan(undefined);
    expect(limits.maxPerDay).toBe(10);
    expect(limits.minIntervalMs).toBe(300_000);
  });

  it('defaults to basic limits for unknown plan names', () => {
    const limits = getPostingLimitsForPlan('unknown' as any);
    expect(limits.maxPerDay).toBe(10);
    expect(limits.minIntervalMs).toBe(300_000);
  });

  it('returns PostingLimits interface shape', () => {
    const limits = getPostingLimitsForPlan('pro');
    expect(limits).toHaveProperty('maxPerDay');
    expect(limits).toHaveProperty('minIntervalMs');
    expect(typeof limits.maxPerDay).toBe('number');
    expect(typeof limits.minIntervalMs).toBe('number');
  });

  it('always returns valid limits (never throws)', () => {
    // Test various edge cases that should not throw
    expect(() => getPostingLimitsForPlan(undefined)).not.toThrow();
    expect(() => getPostingLimitsForPlan('unknown' as any)).not.toThrow();
    expect(() => getPostingLimitsForPlan(null as any)).not.toThrow();
    expect(() => getPostingLimitsForPlan('' as any)).not.toThrow();
    expect(() => getPostingLimitsForPlan('basic')).not.toThrow();
    expect(() => getPostingLimitsForPlan('pro')).not.toThrow();
    expect(() => getPostingLimitsForPlan('premium')).not.toThrow();
  });
});

