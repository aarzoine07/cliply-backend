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
}
/** Aggregate plan configuration combining feature flags and limits. */
export interface PlanDefinition {
    limits: PlanLimits;
    /** Human-readable description for marketing and onboarding copy. */
    description: string;
}
export type PlanMatrix = Readonly<Record<PlanName, Readonly<PlanDefinition>>>;
/** Plan capability matrix consumed by backend services and UI gating. */
export declare const PLAN_MATRIX: PlanMatrix;
//# sourceMappingURL=planMatrix.d.ts.map