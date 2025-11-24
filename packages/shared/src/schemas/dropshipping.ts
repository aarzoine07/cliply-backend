import { z } from "zod";

/**
 * Product status
 */
export const ProductStatus = z.enum(["active", "paused", "archived"]);
export type ProductStatus = z.infer<typeof ProductStatus>;

/**
 * Product type
 */
export const ProductType = z.enum(["dropshipping"]);
export type ProductType = z.infer<typeof ProductType>;

/**
 * Product DTO (for API responses)
 */
export const ProductDto = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  product_type: ProductType,
  status: ProductStatus,
  tags: z.array(z.string()),
  landing_url: z.string().url().nullable(),
  price_cents: z.number().int().positive().nullable(),
  currency: z.string().nullable(),
  primary_benefit: z.string().nullable(),
  features: z.array(z.string()).nullable(),
  target_audience: z.string().nullable(),
  objections: z.string().nullable(),
  brand_voice: z.string().nullable(),
  creative_notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).strict();
export type ProductDto = z.infer<typeof ProductDto>;

/**
 * Create product input
 */
export const CreateProductInput = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  product_type: ProductType.optional().default("dropshipping"),
  status: ProductStatus.optional().default("active"),
  tags: z.array(z.string()).optional(),
  landingUrl: z.string().url().optional(),
  priceCents: z.number().int().positive().optional(),
  currency: z.string().optional(),
  primaryBenefit: z.string().optional(),
  features: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  objections: z.string().optional(),
  brandVoice: z.string().optional(),
  creativeNotes: z.string().optional(),
}).strict();
export type CreateProductInput = z.infer<typeof CreateProductInput>;

/**
 * Update product input
 */
export const UpdateProductInput = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: ProductStatus.optional(),
  tags: z.array(z.string()).optional(),
  landingUrl: z.string().url().optional().nullable(),
  priceCents: z.number().int().positive().optional().nullable(),
  currency: z.string().optional().nullable(),
  primaryBenefit: z.string().optional().nullable(),
  features: z.array(z.string()).optional().nullable(),
  targetAudience: z.string().optional().nullable(),
  objections: z.string().optional().nullable(),
  brandVoice: z.string().optional().nullable(),
  creativeNotes: z.string().optional().nullable(),
}).strict();
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

/**
 * Product performance analytics schemas
 */

/**
 * Platform for analytics
 */
export const AnalyticsPlatform = z.enum(["tiktok", "youtube_shorts"]);
export type AnalyticsPlatform = z.infer<typeof AnalyticsPlatform>;

/**
 * Product performance summary DTO
 */
export const ProductPerformanceSummaryDto = z.object({
  productId: z.string().uuid(),
  window: z.string(), // e.g. "7d", "30d", or "all"
  totals: z.object({
    views: z.number().nonnegative(),
    likes: z.number().nonnegative(),
    comments: z.number().nonnegative(),
    shares: z.number().nonnegative(),
    watchTimeSeconds: z.number().nonnegative(),
  }),
  derived: z.object({
    avgViewDurationSec: z.number().nonnegative().optional(),
    avgCtr: z.number().min(0).max(1).optional(), // 0–1
  }),
  byPlatform: z.array(z.object({
    platform: AnalyticsPlatform,
    views: z.number().nonnegative(),
    likes: z.number().nonnegative(),
    comments: z.number().nonnegative(),
    shares: z.number().nonnegative(),
    watchTimeSeconds: z.number().nonnegative(),
  })),
  topVariants: z.array(z.object({
    experimentId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    label: z.string().optional(),
    platform: AnalyticsPlatform,
    views: z.number().nonnegative(),
    likes: z.number().nonnegative(),
    watchTimeSeconds: z.number().nonnegative(),
    avgViewDurationSec: z.number().nonnegative().optional(),
  })).max(20),
}).strict();
export type ProductPerformanceSummaryDto = z.infer<typeof ProductPerformanceSummaryDto>;

/**
 * Underperforming post DTO
 */
export const UnderperformingPostDto = z.object({
  variantPostId: z.string().uuid(),
  clipId: z.string().uuid(),
  productId: z.string().uuid(),
  platform: AnalyticsPlatform,
  views: z.number().nonnegative(),
  likes: z.number().nonnegative(),
  watchTimeSeconds: z.number().nonnegative(),
  ctr: z.number().min(0).max(1).optional(),
  reason: z.array(z.enum([
    "low_views",
    "low_ctr",
    "low_watch_time",
    "below_product_median",
  ])),
}).strict();
export type UnderperformingPostDto = z.infer<typeof UnderperformingPostDto>;

/**
 * Product performance query input
 */
export const ProductPerformanceQuery = z.object({
  window: z.enum(["7d", "30d", "all"]).default("30d"),
}).strict();
export type ProductPerformanceQuery = z.infer<typeof ProductPerformanceQuery>;

/**
 * Underperformers query input
 */
export const UnderperformersQuery = z.object({
  window: z.enum(["7d", "30d"]).default("7d"),
  minViews: z.number().int().nonnegative().default(500),
  maxCtr: z.number().min(0).max(1).default(0.05), // 5%
}).strict();
export type UnderperformersQuery = z.infer<typeof UnderperformersQuery>;

/**
 * Dropshipping viral automation schemas
 */

/**
 * Action type
 */
export const DropshippingActionType = z.enum(["repost"]);
export type DropshippingActionType = z.infer<typeof DropshippingActionType>;

/**
 * Action status
 */
export const DropshippingActionStatus = z.enum(["planned", "executed", "skipped"]);
export type DropshippingActionStatus = z.infer<typeof DropshippingActionStatus>;

/**
 * Underperformer reason (matches UnderperformingPostDto.reason)
 */
export const UnderperformerReason = z.enum([
  "low_views",
  "low_ctr",
  "low_watch_time",
  "below_product_median",
]);
export type UnderperformerReason = z.infer<typeof UnderperformerReason>;

/**
 * Planned creative structure (matches DropshippingCreativeOutput)
 */
export const PlannedCreative = z.object({
  caption: z.string(),
  script: z.string(),
  hashtags: z.array(z.string()),
  hook: z.string().optional(),
  soundIdea: z.string().optional(),
  rawModelOutput: z.unknown().optional(),
}).strict();
export type PlannedCreative = z.infer<typeof PlannedCreative>;

/**
 * Dropshipping action DTO
 */
export const DropshippingActionDto = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  productId: z.string().uuid(),
  clipId: z.string().uuid().nullable(),
  variantPostId: z.string().uuid().nullable(),
  actionType: DropshippingActionType,
  status: DropshippingActionStatus,
  reasons: z.array(UnderperformerReason),
  plannedCreative: PlannedCreative,
  createdAt: z.string(),
  executedAt: z.string().nullable(),
  skippedAt: z.string().nullable(),
}).strict();
export type DropshippingActionDto = z.infer<typeof DropshippingActionDto>;

/**
 * Viral plan query (extends UnderperformersQuery)
 */
export const ViralPlanQuery = UnderperformersQuery.extend({
  maxActions: z.number().int().positive().max(50).default(10),
}).strict();
export type ViralPlanQuery = z.infer<typeof ViralPlanQuery>;

/**
 * Execute dropshipping action input
 */
export const ExecuteDropshippingActionInput = z.object({
  dryRun: z.boolean().optional().default(false),
}).strict();
export type ExecuteDropshippingActionInput = z.infer<typeof ExecuteDropshippingActionInput>;

