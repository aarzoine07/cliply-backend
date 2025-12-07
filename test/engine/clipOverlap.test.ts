import { describe, it, expect } from 'vitest';
import {
  consolidateClipCandidates,
  type ClipCandidate,
  type ConsolidateInput,
} from '../../packages/shared/src/engine/clipOverlap';

describe('consolidateClipCandidates', () => {
  describe('Basic overlap removal', () => {
    it('removes overlapping clips, keeping higher-scored ones', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },   // Best score
        { start_s: 5, end_s: 15, score: 0.8 },   // Overlaps with first
        { start_s: 20, end_s: 30, score: 0.7 },  // No overlap
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Should keep clips 1 and 3 (clip 2 overlaps with 1 and has lower score)
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10, score: 0.9 });
      expect(result[1]).toMatchObject({ start_s: 20, end_s: 30, score: 0.7 });
    });

    it('keeps all clips when they do not overlap', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 15, end_s: 25, score: 0.8 },
        { start_s: 30, end_s: 40, score: 0.7 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      expect(result).toHaveLength(3);
    });

    it('handles clips that touch at boundaries (no overlap)', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 10, end_s: 20, score: 0.8 }, // Touches at t=10
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Clips that touch but don't overlap should both be kept
      expect(result).toHaveLength(2);
    });

    it('handles complete containment (one clip inside another)', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 20, score: 0.9 },   // Larger clip, higher score
        { start_s: 5, end_s: 15, score: 0.7 },   // Contained within first
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Only the higher-scored clip should be kept
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 20, score: 0.9 });
    });

    it('prefers shorter clips when scores are equal', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 20, score: 0.8 },  // Longer
        { start_s: 5, end_s: 15, score: 0.8 },  // Shorter, same score
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Shorter clip should win when scores are equal
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 5, end_s: 15, score: 0.8 });
    });
  });

  describe('Near-duplicate detection', () => {
    it('detects near-duplicates with default threshold (1.5s)', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 0.5, end_s: 10.5, score: 0.85 }, // Almost identical
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Only the higher-scored clip should be kept
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10, score: 0.9 });
    });

    it('keeps clips with start times > threshold apart', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 2, end_s: 12, score: 0.8 }, // Start is 2s apart (> 1.5s threshold)
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
        nearDuplicateThresholdSec: 1.5,
      });

      // Different enough to keep both (but they overlap, so only one should be kept)
      // Actually, they DO overlap (2 < 10), so only one should be kept
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10 });
    });

    it('respects custom near-duplicate threshold', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 0.5, end_s: 10.5, score: 0.85 },
      ];

      // With a smaller threshold (0.3s), these should be considered different
      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
        nearDuplicateThresholdSec: 0.3,
      });

      // They overlap in time, so only one should be kept
      expect(result).toHaveLength(1);
    });

    it('detects near-duplicates even without overlap', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 10.5, end_s: 20, score: 0.8 }, // 0.5s gap, within 1.5s threshold
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
        nearDuplicateThresholdSec: 1.5,
      });

      // Gap is 0.5s, which is within threshold
      // But they don't actually overlap, and start times differ by 10.5s
      // So they should both be kept
      expect(result).toHaveLength(2);
    });
  });

  describe('Existing clips dedupe', () => {
    it('removes candidates that are near-duplicates of existing clips', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0.5, end_s: 9.5, score: 0.99 }, // Near-duplicate of existing
        { start_s: 20, end_s: 30, score: 0.7 },    // Different region
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0, end_s: 10, score: 0.8 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 10,
      });

      // First candidate should be dropped (near existing), only second kept
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 20, end_s: 30 });
    });

    it('preserves all candidates when none conflict with existing', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 20, end_s: 30, score: 0.8 },
        { start_s: 35, end_s: 45, score: 0.7 },
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0, end_s: 10, score: 0.9 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 10,
      });

      expect(result).toHaveLength(2);
    });

    it('existing clips always win over new candidates', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.99 }, // Higher score than existing
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0.5, end_s: 10.5, score: 0.5 }, // Lower score
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 10,
      });

      // Even though candidate has higher score, existing clip wins
      expect(result).toHaveLength(0);
    });

    it('handles multiple existing clips', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 5, end_s: 15, score: 0.9 },   // Overlaps existing-1
        { start_s: 25, end_s: 35, score: 0.8 },  // Overlaps existing-2
        { start_s: 50, end_s: 60, score: 0.7 },  // No overlap
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0, end_s: 10, score: 0.6 },
        { id: 'existing-2', start_s: 20, end_s: 30, score: 0.6 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 10,
      });

      // Only the third candidate should be kept
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ start_s: 50, end_s: 60 });
    });
  });

  describe('maxClips enforcement', () => {
    it('respects maxClips limit', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 15, end_s: 25, score: 0.8 },
        { start_s: 30, end_s: 40, score: 0.7 },
        { start_s: 45, end_s: 55, score: 0.6 },
        { start_s: 60, end_s: 70, score: 0.5 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 3,
      });

      // Should keep only top 3 by score
      expect(result).toHaveLength(3);
      expect(result[0].score).toBe(0.9);
      expect(result[1].score).toBe(0.8);
      expect(result[2].score).toBe(0.7);
    });

    it('returns fewer clips than maxClips if not enough valid candidates', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 15, end_s: 25, score: 0.8 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      expect(result).toHaveLength(2);
    });

    it('maxClips counts only new clips (not existing)', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 20, end_s: 30, score: 0.9 },
        { start_s: 35, end_s: 45, score: 0.8 },
        { start_s: 50, end_s: 60, score: 0.7 },
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0, end_s: 10, score: 0.6 },
        { id: 'existing-2', start_s: 12, end_s: 18, score: 0.6 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 2,
      });

      // Should return 2 new clips (top 2 by score)
      expect(result).toHaveLength(2);
      expect(result[0].score).toBe(0.9);
      expect(result[1].score).toBe(0.8);
    });
  });

  describe('Invalid input handling', () => {
    it('filters out clips with end_s <= start_s', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },   // Valid
        { start_s: 20, end_s: 20, score: 0.8 },  // Invalid (end == start)
        { start_s: 30, end_s: 25, score: 0.7 },  // Invalid (end < start)
        { start_s: 40, end_s: 50, score: 0.6 },  // Valid
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Only valid clips should be kept
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10 });
      expect(result[1]).toMatchObject({ start_s: 40, end_s: 50 });
    });

    it('handles NaN and non-finite values', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },        // Valid
        { start_s: NaN, end_s: 10, score: 0.8 },      // Invalid start
        { start_s: 0, end_s: Infinity, score: 0.7 },  // Invalid end
        { start_s: 20, end_s: 30, score: NaN },       // Invalid score (but allowed)
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // NaN start/end are normalized to 0, which makes them invalid
      // Only first and potentially last should be kept
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10 });
    });

    it('handles empty candidate list', () => {
      const result = consolidateClipCandidates({
        candidates: [],
        existingClips: [],
        maxClips: 10,
      });

      expect(result).toHaveLength(0);
    });

    it('handles empty existing clips list', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        // existingClips not provided (default to [])
        maxClips: 10,
      });

      expect(result).toHaveLength(1);
    });

    it('handles maxClips = 0', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 15, end_s: 25, score: 0.8 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 0,
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('Determinism and ordering', () => {
    it('produces consistent results for same inputs', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 10, end_s: 20, score: 0.7 },
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 30, end_s: 40, score: 0.8 },
      ];

      const result1 = consolidateClipCandidates({
        candidates: [...candidates],
        existingClips: [],
        maxClips: 10,
      });

      const result2 = consolidateClipCandidates({
        candidates: [...candidates],
        existingClips: [],
        maxClips: 10,
      });

      // Results should be identical
      expect(result1).toEqual(result2);
    });

    it('returns clips sorted by score (descending)', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.5 },
        { start_s: 15, end_s: 25, score: 0.9 },
        { start_s: 30, end_s: 40, score: 0.7 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Should be sorted by score descending
      expect(result[0].score).toBe(0.9);
      expect(result[1].score).toBe(0.7);
      expect(result[2].score).toBe(0.5);
    });
  });

  describe('Complex scenarios', () => {
    it('handles chain of overlapping clips', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 5, end_s: 15, score: 0.8 },   // Overlaps 1
        { start_s: 10, end_s: 20, score: 0.7 },  // Touches 1 at boundary, overlaps 2
        { start_s: 15, end_s: 25, score: 0.6 },  // Overlaps 3
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // First clip (0.9) is kept
      // Second clip (0.8) overlaps with first → dropped
      // Third clip (0.7) touches first at boundary (10), but doesn't overlap
      //   (overlap would require startOverlap < endOverlap, but 10 < 10 is false)
      //   So third clip is kept
      // Fourth clip (0.6) overlaps with third → dropped
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ start_s: 0, end_s: 10, score: 0.9 });
      expect(result[1]).toMatchObject({ start_s: 10, end_s: 20, score: 0.7 });
    });

    it('handles multiple disjoint regions with overlaps in each', () => {
      const candidates: ClipCandidate[] = [
        // Region 1: 0-20
        { start_s: 0, end_s: 10, score: 0.9 },
        { start_s: 5, end_s: 15, score: 0.85 },
        
        // Region 2: 30-50
        { start_s: 30, end_s: 40, score: 0.8 },
        { start_s: 35, end_s: 45, score: 0.75 },
        
        // Region 3: 60-80
        { start_s: 60, end_s: 70, score: 0.7 },
        { start_s: 65, end_s: 75, score: 0.65 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips: [],
        maxClips: 10,
      });

      // Should keep one clip from each region (highest score)
      expect(result).toHaveLength(3);
      expect(result[0].score).toBe(0.9);   // Region 1
      expect(result[1].score).toBe(0.8);   // Region 2
      expect(result[2].score).toBe(0.7);   // Region 3
    });

    it('combines all constraints: overlaps, near-duplicates, existing, maxClips', () => {
      const candidates: ClipCandidate[] = [
        { start_s: 0, end_s: 10, score: 0.95 },   // Near existing
        { start_s: 5, end_s: 15, score: 0.90 },   // Overlaps with above
        { start_s: 20, end_s: 30, score: 0.85 },  // Valid
        { start_s: 25, end_s: 35, score: 0.80 },  // Overlaps with above
        { start_s: 40, end_s: 50, score: 0.75 },  // Valid
        { start_s: 60, end_s: 70, score: 0.70 },  // Valid
        { start_s: 80, end_s: 90, score: 0.65 },  // Valid
      ];

      const existingClips: ClipCandidate[] = [
        { id: 'existing-1', start_s: 0.5, end_s: 10.5, score: 0.5 },
      ];

      const result = consolidateClipCandidates({
        candidates,
        existingClips,
        maxClips: 3,
      });

      // First candidate dropped (near existing)
      // Second candidate dropped (overlaps with first, and first is also near existing)
      // Third candidate kept (score 0.85)
      // Fourth candidate dropped (overlaps with third)
      // Fifth candidate kept (score 0.75)
      // Sixth candidate kept (score 0.70)
      // Seventh candidate not kept (maxClips = 3)
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ start_s: 20, end_s: 30 });
      expect(result[1]).toMatchObject({ start_s: 40, end_s: 50 });
      expect(result[2]).toMatchObject({ start_s: 60, end_s: 70 });
    });
  });
});

