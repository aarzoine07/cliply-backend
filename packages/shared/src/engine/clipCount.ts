import type { PlanName } from '../types/auth';
import type { PlanLimits } from '../billing/planMatrix';

/**
 * Input parameters for computing max clips for a video.
 */
export interface ComputeMaxClipsInput {
  /** Video duration in milliseconds (e.g., from transcript metadata) */
  durationMs: number;
  /** Workspace plan name (basic, pro, premium) */
  planName: PlanName;
  /** Plan limits from PLAN_MATRIX */
  planLimits: PlanLimits;
  /** Optional override from job payload (e.g., user-requested max clips) */
  requestedMaxClips?: number | null;
}

/**
 * Pure helper that computes a smart max clip count for a video based on:
 * - Video duration (longer videos → more clips, up to caps)
 * - Plan limits (clips_per_project, derived soft cap from clips_per_month)
 * - Requested override (if provided and valid)
 * - Hard safety bounds (min 1, max 30 per video)
 *
 * Properties:
 * - Monotonic-ish: More duration → never fewer clips (up to caps)
 * - Never exceeds plan caps
 * - Safe lower/upper bounds
 * - Pure function: No DB access, no logging, just math + limits
 *
 * @example
 * const maxClips = computeMaxClipsForVideo({
 *   durationMs: 300_000, // 5 minutes
 *   planName: 'basic',
 *   planLimits: PLAN_MATRIX.basic.limits,
 *   requestedMaxClips: null,
 * });
 * // Returns: 5 (based on 5-minute duration heuristic)
 */
export function computeMaxClipsForVideo(input: ComputeMaxClipsInput): number {
  const { durationMs, planName, planLimits, requestedMaxClips } = input;

  // 1. Guard for invalid duration - default to 60 seconds if missing/invalid
  const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 60_000;
  const durationMinutes = safeDurationMs / 1000 / 60;

  // 2. Plan-based caps
  // Direct per-project limit from plan
  const planClipsPerProject = planLimits.clips_per_project ?? 12;

  // Derive a soft cap from monthly limits to prevent one video from consuming the entire month's quota
  // Example: If clips_per_month is 450, we cap at ~22 clips per video (450 / 20 = 22.5)
  const monthlyLimit = planLimits.clips_per_month ?? planClipsPerProject * 5;
  const perVideoSoftCap = Math.max(3, Math.floor(monthlyLimit / 20));

  // 3. Duration-based base count (tuneable heuristic)
  // Heuristic:
  //  - < 1 min: 2 clips
  //  - 1–5 min: 3–6 clips (scales with duration)
  //  - 5–15 min: 6–10 clips (slower scaling)
  //  - > 15 min: 10–perVideoSoftCap (capped by plan)
  let baseByDuration: number;
  if (durationMinutes <= 1) {
    baseByDuration = 2;
  } else if (durationMinutes <= 5) {
    // 1 min = 3 clips, 2 min = 4, 3 min = 5, 4 min = 6, 5 min = 6
    baseByDuration = Math.min(6, 2 + Math.floor(durationMinutes));
  } else if (durationMinutes <= 15) {
    // 6 min = 6, 10 min = 8, 15 min = 10
    baseByDuration = Math.min(10, 6 + Math.floor((durationMinutes - 5) / 2));
  } else {
    // > 15 min: 10 base + 1 per 5 minutes, capped by perVideoSoftCap
    baseByDuration = Math.min(perVideoSoftCap, 10 + Math.floor((durationMinutes - 15) / 5));
  }

  // 4. Apply requested override (if provided and valid)
  // If user/system explicitly requests a max, use it (subject to plan caps)
  // Treat 0, negative, or invalid numbers as "no override"
  const requested =
    requestedMaxClips != null &&
    Number.isFinite(requestedMaxClips) &&
    requestedMaxClips > 0
      ? Math.floor(requestedMaxClips)
      : null;

  const candidate = requested ?? baseByDuration;

  // 5. Hard bounds and plan caps
  const MIN_CLIPS = 1; // Never return 0 clips
  const MAX_CLIPS_PER_VIDEO = 30; // Absolute safety guard (prevents runaway clip generation)

  // Apply all caps: plan per-project limit, per-video soft cap, absolute max
  const cappedByPlan = Math.min(
    candidate,
    planClipsPerProject,
    perVideoSoftCap,
    MAX_CLIPS_PER_VIDEO,
  );

  // Ensure we never return less than MIN_CLIPS
  const finalValue = Math.max(MIN_CLIPS, cappedByPlan);

  return finalValue;
}

