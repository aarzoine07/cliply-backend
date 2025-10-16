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
    },
  },
  /** Growth — small teams scaling their content workflows. */
  growth: {
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
    },
  },
  /** Agency — agencies managing multiple clients with high volume demands. */
  agency: {
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
    },
  },
} as const;
