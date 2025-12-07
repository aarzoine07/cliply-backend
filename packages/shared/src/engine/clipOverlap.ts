/**
 * Clip overlap and consolidation utilities for the highlight-detect pipeline.
 * 
 * Ensures that:
 * - No two clips overlap in time
 * - Near-duplicates are removed (clips too similar in timing)
 * - Existing DB clips take precedence (no duplicates created)
 * - Only the top N clips by score are kept (respects maxClips)
 */

/**
 * Minimal clip candidate representation for overlap detection.
 * Compatible with both new candidates and existing DB clips.
 */
export interface ClipCandidate {
  /** Optional ID (for existing clips from DB) */
  id?: string | null;
  /** Start time in seconds */
  start_s: number;
  /** End time in seconds */
  end_s: number;
  /** Confidence/quality score (higher is better) */
  score: number;
}

/**
 * Input parameters for clip consolidation.
 */
export interface ConsolidateInput {
  /** New candidate clips to consolidate */
  candidates: ClipCandidate[];
  /** Existing clips from DB (to avoid duplicates) */
  existingClips?: ClipCandidate[];
  /** Maximum number of new clips to keep */
  maxClips: number;
  /**
   * Time threshold (seconds) for detecting near-duplicates.
   * Two clips are "near duplicates" if their start or end times
   * are within this threshold, even if they don't overlap.
   * @default 1.5
   */
  nearDuplicateThresholdSec?: number;
}

/**
 * Consolidates clip candidates by removing overlaps, near-duplicates,
 * and respecting the maxClips limit.
 * 
 * Algorithm:
 * 1. Normalizes and filters out invalid candidates (end <= start, NaN values)
 * 2. Sorts by score (descending), with shorter duration as tie-breaker
 * 3. Greedily selects clips:
 *    - Skip if near-duplicate of an existing DB clip
 *    - Skip if overlapping/near-duplicate with already-kept candidate
 *    - Keep up to maxClips
 * 
 * Properties:
 * - Deterministic: same inputs → same output
 * - Non-overlapping: no two returned clips overlap in time
 * - Score-prioritized: higher-scored clips are preferred
 * - Existing-first: DB clips always win over new candidates
 * 
 * @example
 * const result = consolidateClipCandidates({
 *   candidates: [
 *     { start_s: 0, end_s: 10, score: 0.9 },   // Best score
 *     { start_s: 5, end_s: 15, score: 0.8 },   // Overlaps with first, lower score → dropped
 *     { start_s: 20, end_s: 30, score: 0.7 },  // No overlap → kept
 *   ],
 *   existingClips: [],
 *   maxClips: 5,
 * });
 * // Returns: [{ start_s: 0, end_s: 10, score: 0.9 }, { start_s: 20, end_s: 30, score: 0.7 }]
 */
export function consolidateClipCandidates(input: ConsolidateInput): ClipCandidate[] {
  const {
    candidates,
    existingClips = [],
    maxClips,
    nearDuplicateThresholdSec = 1.5,
  } = input;

  // 1. Normalize & filter invalid candidates
  const normalized = candidates
    .map((c) => normalizeCandidate(c))
    .filter((c): c is ClipCandidate => c !== null);

  // 2. Sort by score (desc), then by shorter duration (asc) as tie-breaker
  // Shorter clips are preferred when scores are equal (more precise highlights)
  normalized.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const lenA = a.end_s - a.start_s;
    const lenB = b.end_s - b.start_s;
    return lenA - lenB;
  });

  const kept: ClipCandidate[] = [];

  /**
   * Checks if two clips overlap in time or are "near duplicates".
   * Near duplicates are clips that don't overlap but are very close in timing.
   */
  function overlapsOrNearDuplicate(a: ClipCandidate, b: ClipCandidate): boolean {
    // Check for actual time overlap
    const startOverlap = Math.max(a.start_s, b.start_s);
    const endOverlap = Math.min(a.end_s, b.end_s);
    const overlapDuration = endOverlap - startOverlap;

    if (overlapDuration > 0) {
      // Clips overlap in time
      return true;
    }

    // Check for near-duplicate (start or end times very close)
    const startDelta = Math.abs(a.start_s - b.start_s);
    const endDelta = Math.abs(a.end_s - b.end_s);

    // If both start and end are very close, it's a near-duplicate
    // OR if start times are very close (same clip, slightly different endpoint)
    return (
      startDelta <= nearDuplicateThresholdSec &&
      endDelta <= nearDuplicateThresholdSec
    ) || startDelta <= nearDuplicateThresholdSec;
  }

  /**
   * Checks if a candidate is near-duplicate to any existing DB clip.
   */
  function isNearExisting(c: ClipCandidate): boolean {
    return existingClips.some((existing) => overlapsOrNearDuplicate(existing, c));
  }

  // 3. Greedy selection: keep highest-scoring, non-overlapping clips
  for (const candidate of normalized) {
    // Stop when we've reached maxClips
    if (kept.length >= maxClips) break;

    // Skip if near-duplicate of an existing persisted clip
    // (DB clips are canonical, we never override them)
    if (isNearExisting(candidate)) continue;

    // Skip if overlapping/near-duplicate with any already-kept candidate
    const conflict = kept.some((k) => overlapsOrNearDuplicate(k, candidate));
    if (conflict) continue;

    // No conflicts → keep this candidate
    kept.push(candidate);
  }

  return kept;
}

/**
 * Normalizes a candidate clip, ensuring valid time range and numeric values.
 * Returns null for invalid/degenerate clips.
 */
function normalizeCandidate(c: ClipCandidate): ClipCandidate | null {
  const start = Number.isFinite(c.start_s) ? c.start_s : 0;
  const end = Number.isFinite(c.end_s) ? c.end_s : 0;
  const score = Number.isFinite(c.score) ? c.score : 0;

  // Reject degenerate ranges (end must be strictly greater than start)
  if (end <= start) return null;

  return {
    id: c.id ?? undefined,
    start_s: start,
    end_s: end,
    score,
  };
}

