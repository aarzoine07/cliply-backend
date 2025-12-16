import type { PlanName } from "../types/auth";

/**
 * Core Cliply plan capabilities used for gating features and enforcing quotas.
 * Values here must mirror Stripe product configuration and Supabase plan checks.
 */

/** Feature toggles supported by each plan. */
export interface PlanFeature {
  /** Whether scheduled publishing is available. */
  schedule: boolean;
  /** Enables AI-generated video titles. */
  ai_titles: boolean;
  /** Enables AI-generated captions/subtitles. */
  ai_captions: boolean;
  /** Allows exporting rendered clips without watermark. */
  watermark_free_exports: boolean;
}

/** Usage limits enforced per plan across workspaces (includes boolean feature flags). */
export interface PlanLimits extends PlanFeature {
  /** Maximum number of uploads permitted per day across the workspace. */
  uploads_per_day: number;
  /** Maximum clips that can be generated per project. */
  clips_per_project: number;
  /** Maximum number of workspace members allowed. */
  max_team_members: number;
  /** Storage allocation in gigabytes. */
  storage_gb: number;
  /** Concurrent jobs allowed in the queue for this workspace. */
  concurrent_jobs: number;
  /** Maximum source video minutes processed per month. */
  source_minutes_per_month?: number;
  /** Maximum clips generated per month. */
  clips_per_month?: number;
  /** Maximum projects created per month. */
  projects_per_month?: number;
  /**
   * Maximum posts (published clips) per month across all platforms.
   * NOTE (ME-I-04): posts_per_month limits are initial engine defaults and can be tuned later
   * without affecting the rest of the billing system. They should be kept comfortably above
   * the daily limits enforced by postingGuard (which are per-account, not per-workspace).
   */
  posts_per_month?: number;
  /**
   * Maximum posts per day per account (enforced by posting guard).
   * Per-account, not per-workspace. Should be comfortably below posts_per_month.
   */
  posting_max_per_day?: number;
  /**
   * Minimum milliseconds between consecutive posts per account.
   */
  posting_min_interval_ms?: number;
}

/** Aggregate plan configuration combining feature flags and limits. */
export interface PlanDefinition {
  limits: PlanLimits;
  /** Human-readable description for marketing and onboarding copy. */
  description: string;
}

export type PlanMatrix = Readonly<Record<PlanName, Readonly<PlanDefinition>>>;

/** Plan capability matrix consumed by backend services and UI gating. */
export const PLAN_MATRIX: PlanMatrix = {
  /** Basic — individual creators getting started with automated clipping. */
  basic: {
    description: "Individual creators experimenting with AI-powered clipping.",
    limits: {
      schedule: false,
      ai_titles: false,
      ai_captions: false,
      watermark_free_exports: false,
      uploads_per_day: 5,
      clips_per_project: 3,
      max_team_members: 1,
      storage_gb: 15,
      concurrent_jobs: 2,
      source_minutes_per_month: 150, // 5 uploads/day * 30 days * ~1 min avg
      clips_per_month: 450, // 5 uploads/day * 30 days * 3 clips/project
      projects_per_month: 150, // 5 uploads/day * 30 days
      posts_per_month: 300, // ~10 posts/day * 30 days (comfortably above postingGuard daily limit of 10)
      posting_max_per_day: 10,
      posting_min_interval_ms: 300_000, // 5 minutes
    },
  },
  /** Pro — small teams scaling their content workflows. */
  pro: {
    description: "Growing teams needing faster throughput and AI assistance.",
    limits: {
      schedule: true,
      ai_titles: true,
      ai_captions: true,
      watermark_free_exports: true,
      uploads_per_day: 30,
      clips_per_project: 12,
      max_team_members: 5,
      storage_gb: 80,
      concurrent_jobs: 6,
      source_minutes_per_month: 900, // 30 uploads/day * 30 days * ~1 min avg
      clips_per_month: 10800, // 30 uploads/day * 30 days * 12 clips/project
      projects_per_month: 900, // 30 uploads/day * 30 days
      posts_per_month: 900, // ~30 posts/day * 30 days (comfortably above postingGuard daily limit of 30)
      posting_max_per_day: 30,
      posting_min_interval_ms: 120_000, // 2 minutes
    },
  },
  /** Premium — agencies managing multiple clients with high volume demands. */
  premium: {
    description: "Agencies coordinating multiple brands with high volume needs.",
    limits: {
      schedule: true,
      ai_titles: true,
      ai_captions: true,
      watermark_free_exports: true,
      uploads_per_day: 150,
      clips_per_project: 40,
      max_team_members: 15,
      storage_gb: 250,
      concurrent_jobs: 15,
      source_minutes_per_month: 4500, // 150 uploads/day * 30 days * ~1 min avg
      clips_per_month: 180000, // 150 uploads/day * 30 days * 40 clips/project
      projects_per_month: 4500, // 150 uploads/day * 30 days
      posts_per_month: 1500, // ~50 posts/day * 30 days (comfortably above postingGuard daily limit of 50)
      posting_max_per_day: 50,
      posting_min_interval_ms: 60_000, // 1 minute
    },
  },
} as const;

/**
 * Posting rate limits for an account.
 * Matches the interface used by postingGuard.ts.
 */
export interface PostingLimits {
  /** Maximum posts per 24-hour rolling window */
  maxPerDay: number;
  /** Minimum milliseconds between consecutive posts */
  minIntervalMs: number;
}

/**
 * Default posting limits by plan tier.
 * Used as fallback when planMatrix fields are missing.
 */
const DEFAULT_LIMITS_BY_PLAN: Record<PlanName, PostingLimits> = {
  basic: { maxPerDay: 10, minIntervalMs: 300_000 },
  pro: { maxPerDay: 30, minIntervalMs: 120_000 },
  premium: { maxPerDay: 50, minIntervalMs: 60_000 },
};

/**
 * Returns posting limits for a given plan from the plan matrix.
 * 
 * @param planName - Plan tier: 'basic', 'pro', 'premium', or undefined
 * @returns Posting limits for the plan, or default limits if plan not found
 * 
 * @example
 * const limits = getPostingLimitsForPlan('pro');
 * // { maxPerDay: 30, minIntervalMs: 120_000 }
 */
export function getPostingLimitsForPlan(planName?: PlanName): PostingLimits {
  // Normalize planName: undefined/null/empty/unknown → 'basic'
  const normalizedPlan: PlanName = 
    planName && (planName === 'basic' || planName === 'pro' || planName === 'premium')
      ? planName
      : 'basic';

  // Get default limits for the resolved plan
  const defaultLimits = DEFAULT_LIMITS_BY_PLAN[normalizedPlan];

  // Look up plan in PLAN_MATRIX
  const plan = PLAN_MATRIX[normalizedPlan];
  
  if (!plan) {
    // Plan not found in matrix, return defaults
    return defaultLimits;
  }

  // Extract posting limits from plan, with fallback to defaults
  return {
    maxPerDay: plan.limits.posting_max_per_day ?? defaultLimits.maxPerDay,
    minIntervalMs: plan.limits.posting_min_interval_ms ?? defaultLimits.minIntervalMs,
  };
}
