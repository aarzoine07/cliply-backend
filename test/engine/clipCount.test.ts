import { describe, it, expect } from 'vitest';
import { computeMaxClipsForVideo, type ComputeMaxClipsInput } from '../../packages/shared/src/engine/clipCount';
import type { PlanName } from '../../packages/shared/src/types/auth';
import type { PlanLimits } from '../../packages/shared/src/billing/planMatrix';
import { PLAN_MATRIX } from '../../packages/shared/src/billing/planMatrix';

/**
 * Helper to create a minimal PlanLimits object for testing.
 * Uses sensible defaults that can be overridden.
 */
function createTestPlanLimits(overrides: Partial<PlanLimits> = {}): PlanLimits {
  return {
    schedule: false,
    ai_titles: false,
    ai_captions: false,
    watermark_free_exports: false,
    uploads_per_day: 5,
    clips_per_project: 12,
    max_team_members: 1,
    storage_gb: 15,
    concurrent_jobs: 2,
    source_minutes_per_month: 150,
    clips_per_month: 450,
    projects_per_month: 150,
    ...overrides,
  };
}

describe('computeMaxClipsForVideo', () => {
  describe('Duration-based scaling', () => {
    it('returns 2 clips for very short videos (<= 1 minute)', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 30_000, // 30 seconds
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBe(2);
    });

    it('scales clips for medium videos (1-5 minutes)', () => {
      const planLimits = createTestPlanLimits();
      
      // 2 minutes = 4 clips
      const result2min = computeMaxClipsForVideo({
        durationMs: 2 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result2min).toBe(4);

      // 3 minutes = 5 clips
      const result3min = computeMaxClipsForVideo({
        durationMs: 3 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result3min).toBe(5);

      // 5 minutes = 6 clips (capped at 6 for this bracket)
      const result5min = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result5min).toBe(6);
    });

    it('scales clips for longer videos (5-15 minutes)', () => {
      const planLimits = createTestPlanLimits();
      
      // 7 minutes = 7 clips (6 base + 1 from (7-5)/2)
      const result7min = computeMaxClipsForVideo({
        durationMs: 7 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result7min).toBe(7);

      // 10 minutes = 8 clips (6 base + 2 from (10-5)/2)
      const result10min = computeMaxClipsForVideo({
        durationMs: 10 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result10min).toBe(8);

      // 15 minutes = 10 clips (6 base + 5 from (15-5)/2, capped at 10)
      const result15min = computeMaxClipsForVideo({
        durationMs: 15 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result15min).toBe(10);
    });

    it('scales clips for very long videos (> 15 minutes)', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 30,
        clips_per_month: 900, // perVideoSoftCap = 900/20 = 45
      });
      
      // 20 minutes = 11 clips (10 base + 1 from (20-15)/5)
      const result20min = computeMaxClipsForVideo({
        durationMs: 20 * 60_000,
        planName: 'pro',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result20min).toBe(11);

      // 30 minutes = 13 clips (10 base + 3 from (30-15)/5)
      const result30min = computeMaxClipsForVideo({
        durationMs: 30 * 60_000,
        planName: 'pro',
        planLimits,
        requestedMaxClips: null,
      });
      expect(result30min).toBe(13);
    });

    it('is monotonic - longer videos never get fewer clips (within same plan)', () => {
      const planLimits = createTestPlanLimits({ clips_per_project: 20 });
      const durations = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000];
      
      const results = durations.map(durationMs =>
        computeMaxClipsForVideo({
          durationMs,
          planName: 'basic',
          planLimits,
          requestedMaxClips: null,
        })
      );

      // Verify monotonic increasing (or staying same)
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBeGreaterThanOrEqual(results[i - 1]);
      }
    });
  });

  describe('Plan-based caps', () => {
    it('respects clips_per_project limit', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 5,
        clips_per_month: 450,
      });
      
      // Even for a long video, should not exceed clips_per_project
      const result = computeMaxClipsForVideo({
        durationMs: 30 * 60_000, // 30 minutes
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBeLessThanOrEqual(5);
      expect(result).toBe(5); // Should hit the cap
    });

    it('respects per-video soft cap derived from monthly limit', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 50, // High per-project
        clips_per_month: 100, // But low monthly (perVideoSoftCap = 100/20 = 5)
      });
      
      // Long video should be capped by monthly soft cap
      const result = computeMaxClipsForVideo({
        durationMs: 30 * 60_000, // 30 minutes
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      // perVideoSoftCap = max(3, floor(100/20)) = 5
      expect(result).toBeLessThanOrEqual(5);
    });

    it('handles unlimited monthly limit (null)', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 20,
        clips_per_month: undefined, // Treat as unlimited
      });
      
      const result = computeMaxClipsForVideo({
        durationMs: 20 * 60_000, // 20 minutes
        planName: 'premium',
        planLimits,
        requestedMaxClips: null,
      });

      // Should use clips_per_project * 5 = 100 as monthly fallback
      // perVideoSoftCap = max(3, floor(100/20)) = 5
      // Duration-based = 11, but capped by perVideoSoftCap = 5
      // Wait, no - if monthly is undefined, it uses planClipsPerProject * 5 = 100
      // perVideoSoftCap = max(3, floor(100/20)) = 5
      // But we also have clips_per_project = 20
      // Result should be min(duration-based, clips_per_project, perVideoSoftCap, 30)
      // Duration-based for 20 min = 11
      // min(11, 20, 5, 30) = 5
      expect(result).toBe(5);
    });

    it('uses actual plan limits from PLAN_MATRIX for basic plan', () => {
      const basicLimits = PLAN_MATRIX.basic.limits;
      
      const result = computeMaxClipsForVideo({
        durationMs: 10 * 60_000, // 10 minutes
        planName: 'basic',
        planLimits: basicLimits,
        requestedMaxClips: null,
      });

      // Basic plan: clips_per_project = 3, clips_per_month = 450
      // perVideoSoftCap = max(3, floor(450/20)) = 22
      // Duration-based for 10 min = 8
      // min(8, 3, 22, 30) = 3 (capped by clips_per_project)
      expect(result).toBe(3);
      expect(result).toBeLessThanOrEqual(basicLimits.clips_per_project ?? 12);
    });

    it('uses actual plan limits from PLAN_MATRIX for pro plan', () => {
      const proLimits = PLAN_MATRIX.pro.limits;
      
      const result = computeMaxClipsForVideo({
        durationMs: 10 * 60_000, // 10 minutes
        planName: 'pro',
        planLimits: proLimits,
        requestedMaxClips: null,
      });

      // Pro plan: clips_per_project = 12, clips_per_month = 10800
      // perVideoSoftCap = max(3, floor(10800/20)) = 540
      // Duration-based for 10 min = 8
      // min(8, 12, 540, 30) = 8
      expect(result).toBe(8);
      expect(result).toBeLessThanOrEqual(proLimits.clips_per_project ?? 12);
    });

    it('uses actual plan limits from PLAN_MATRIX for premium plan', () => {
      const premiumLimits = PLAN_MATRIX.premium.limits;
      
      const result = computeMaxClipsForVideo({
        durationMs: 20 * 60_000, // 20 minutes
        planName: 'premium',
        planLimits: premiumLimits,
        requestedMaxClips: null,
      });

      // Premium plan: clips_per_project = 40, clips_per_month = 180000
      // perVideoSoftCap = max(3, floor(180000/20)) = 9000
      // Duration-based for 20 min = 11
      // min(11, 40, 9000, 30) = 11
      expect(result).toBe(11);
      expect(result).toBeLessThanOrEqual(premiumLimits.clips_per_project ?? 40);
    });
  });

  describe('Requested max override', () => {
    it('uses requestedMaxClips when lower than computed value', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 10 * 60_000, // Would normally give 8 clips
        planName: 'basic',
        planLimits,
        requestedMaxClips: 5, // User wants fewer
      });

      expect(result).toBe(5);
    });

    it('caps requestedMaxClips by plan limits', () => {
      const planLimits = createTestPlanLimits({ clips_per_project: 5 });
      
      const result = computeMaxClipsForVideo({
        durationMs: 10 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: 20, // User wants more than plan allows
      });

      expect(result).toBeLessThanOrEqual(5);
      expect(result).toBe(5);
    });

    it('ignores requestedMaxClips when null', () => {
      const planLimits = createTestPlanLimits();
      
      const resultNull = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      const resultUndefined = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: undefined,
      });

      // Both should use duration-based heuristic (5 min = 6 clips)
      expect(resultNull).toBe(6);
      expect(resultUndefined).toBe(6);
    });

    it('floors fractional requestedMaxClips', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: 7.9, // Should floor to 7
      });

      expect(result).toBe(7);
    });

    it('ignores invalid requestedMaxClips (0 or negative) and uses duration-based', () => {
      const planLimits = createTestPlanLimits();
      
      const resultZero = computeMaxClipsForVideo({
        durationMs: 5 * 60_000, // 5 min = 6 clips
        planName: 'basic',
        planLimits,
        requestedMaxClips: 0,
      });

      const resultNegative = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: -5,
      });

      // 0 and negative are treated as invalid, so fall back to duration-based
      // 5 minutes = 6 clips
      expect(resultZero).toBe(6);
      expect(resultNegative).toBe(6);
    });
  });

  describe('Invalid inputs', () => {
    it('handles invalid duration (NaN) by using default 60s', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: NaN,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      // 60s = 1 min = 2 clips
      expect(result).toBe(2);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('handles negative duration by using default 60s', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: -1000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBe(2);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('handles zero duration by using default 60s', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 0,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBe(2);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('handles Infinity duration by using default 60s', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: Infinity,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBe(2);
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('handles invalid requestedMaxClips (NaN) by ignoring it', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: NaN,
      });

      // Should use duration-based heuristic (5 min = 6 clips)
      expect(result).toBe(6);
    });

    it('handles invalid requestedMaxClips (Infinity) by ignoring it', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: Infinity,
      });

      // Should use duration-based heuristic
      expect(result).toBe(6);
    });
  });

  describe('Hard bounds', () => {
    it('never returns less than 1 clip', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 0, // Invalid but defensive
        clips_per_month: 0,
      });
      
      const result = computeMaxClipsForVideo({
        durationMs: 30_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('never returns more than 30 clips per video (absolute cap)', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 1000, // Unrealistically high
        clips_per_month: 100000,
      });
      
      const result = computeMaxClipsForVideo({
        durationMs: 120 * 60_000, // 2 hours
        planName: 'premium',
        planLimits,
        requestedMaxClips: 500, // User requests absurdly high
      });

      expect(result).toBeLessThanOrEqual(30);
      expect(result).toBe(30);
    });

    it('returns an integer', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 7.5 * 60_000, // 7.5 minutes
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      expect(Number.isInteger(result)).toBe(true);
    });

    it('always returns a positive integer', () => {
      const planLimits = createTestPlanLimits();
      const testCases = [
        { durationMs: 10_000, requestedMaxClips: null },
        { durationMs: 60_000, requestedMaxClips: 5 },
        { durationMs: 600_000, requestedMaxClips: null },
        { durationMs: NaN, requestedMaxClips: null },
        { durationMs: 0, requestedMaxClips: 0 },
      ];

      testCases.forEach(testCase => {
        const result = computeMaxClipsForVideo({
          ...testCase,
          planName: 'basic',
          planLimits,
        });

        expect(result).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(result)).toBe(true);
      });
    });
  });

  describe('Edge cases and boundaries', () => {
    it('handles exactly 1 minute duration', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      // Exactly 1 min = 2 clips (at boundary of first bracket)
      expect(result).toBe(2);
    });

    it('handles exactly 5 minute duration', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 5 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      // Exactly 5 min = 6 clips (at boundary of second bracket)
      expect(result).toBe(6);
    });

    it('handles exactly 15 minute duration', () => {
      const planLimits = createTestPlanLimits();
      
      const result = computeMaxClipsForVideo({
        durationMs: 15 * 60_000,
        planName: 'basic',
        planLimits,
        requestedMaxClips: null,
      });

      // Exactly 15 min = 10 clips (at boundary of third bracket)
      expect(result).toBe(10);
    });

    it('handles very long videos (2 hours)', () => {
      const planLimits = createTestPlanLimits({ 
        clips_per_project: 30,
        clips_per_month: 900,
      });
      
      const result = computeMaxClipsForVideo({
        durationMs: 120 * 60_000,
        planName: 'pro',
        planLimits,
        requestedMaxClips: null,
      });

      // 120 min: 10 + floor((120-15)/5) = 10 + 21 = 31
      // But capped by perVideoSoftCap = max(3, floor(900/20)) = 45
      // And capped by clips_per_project = 30
      // And capped by MAX_CLIPS_PER_VIDEO = 30
      // Result = min(31, 30, 45, 30) = 30
      expect(result).toBe(30);
      expect(result).toBeLessThanOrEqual(30);
    });
  });
});

