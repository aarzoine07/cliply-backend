import { z } from "zod";

/**
 * Goal metrics for viral experiments
 */
export const ViralGoalMetric = z.enum(["views", "watch_time", "likes", "ctr", "shares"]);
export type ViralGoalMetric = z.infer<typeof ViralGoalMetric>;

/**
 * Experiment status
 */
export const ExperimentStatus = z.enum(["draft", "running", "completed", "cancelled"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

/**
 * Platform types for posting
 */
export const ViralPlatform = z.enum(["tiktok", "youtube_shorts", "instagram_reels"]);
export type ViralPlatform = z.infer<typeof ViralPlatform>;

/**
 * Variant post status
 */
export const VariantPostStatus = z.enum(["pending", "posted", "deleted", "failed"]);
export type VariantPostStatus = z.infer<typeof VariantPostStatus>;

/**
 * Variant configuration (flexible JSONB structure)
 */
export const ViralVariantConfig = z.object({
  caption: z.string().max(5000).optional(), // Reasonable caption length
  hashtags: z.array(z.string().max(100)).max(30).optional(), // Limit hashtag count and length
  sound: z.string().max(255).optional(),
  thumbnail_style: z.string().max(100).optional(),
  thumbnail_template: z.string().max(255).optional(),
  posting_schedule_hint: z.string().max(255).optional(),
}).passthrough(); // Allow additional fields
export type ViralVariantConfig = z.infer<typeof ViralVariantConfig>;

/**
 * Experiment variant schema
 */
export const ViralExperimentVariant = z.object({
  id: z.string().uuid(),
  experiment_id: z.string().uuid(),
  label: z.string(),
  config: ViralVariantConfig,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type ViralExperimentVariant = z.infer<typeof ViralExperimentVariant>;

/**
 * Viral experiment schema
 */
export const ViralExperiment = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  name: z.string(),
  status: ExperimentStatus,
  goal_metric: ViralGoalMetric,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type ViralExperiment = z.infer<typeof ViralExperiment>;

/**
 * Experiment with variants (for API responses)
 */
export const ViralExperimentWithVariants = ViralExperiment.extend({
  variants: z.array(ViralExperimentVariant),
}).strict();
export type ViralExperimentWithVariants = z.infer<typeof ViralExperimentWithVariants>;

/**
 * Variant post schema
 */
export const ViralVariantPost = z.object({
  id: z.string().uuid(),
  variant_id: z.string().uuid(),
  clip_id: z.string().uuid(),
  connected_account_id: z.string().uuid(),
  platform: ViralPlatform,
  platform_post_id: z.string().nullable(),
  status: VariantPostStatus,
  posted_at: z.string().datetime().nullable(),
  deleted_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type ViralVariantPost = z.infer<typeof ViralVariantPost>;

/**
 * Variant metrics schema
 */
export const ViralVariantMetrics = z.object({
  id: z.string().uuid(),
  variant_post_id: z.string().uuid(),
  views: z.number().int().min(0),
  likes: z.number().int().min(0),
  comments: z.number().int().min(0),
  shares: z.number().int().min(0),
  watch_time_seconds: z.number().int().min(0),
  ctr: z.number().min(0).max(1).nullable(),
  snapshot_at: z.string().datetime(),
  created_at: z.string().datetime(),
}).strict();
export type ViralVariantMetrics = z.infer<typeof ViralVariantMetrics>;

/**
 * Create experiment input schema
 */
export const CreateExperimentInput = z.object({
  name: z.string().min(1).max(255), // Reasonable name length limit
  goal_metric: ViralGoalMetric.default("views"),
  project_id: z.string().uuid().optional(),
  variants: z.array(
    z.object({
      label: z.string().min(1).max(100), // Reasonable label length limit
      config: ViralVariantConfig,
    }).strict()
  ).min(1).max(50), // Reasonable variant count limit
}).strict();
export type CreateExperimentInput = z.infer<typeof CreateExperimentInput>;

/**
 * Record metrics input schema
 */
export const RecordMetricsInput = z.object({
  variant_post_id: z.string().uuid(),
  views: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  comments: z.number().int().min(0).optional(),
  shares: z.number().int().min(0).optional(),
  watch_time_seconds: z.number().int().min(0).optional(),
  ctr: z.number().min(0).max(1).optional(),
}).strict();
export type RecordMetricsInput = z.infer<typeof RecordMetricsInput>;

