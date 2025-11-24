import { z } from "zod";

/**
 * Platform for creative generation
 */
export const CreativePlatform = z.enum(["tiktok", "youtube_shorts"]);
export type CreativePlatform = z.infer<typeof CreativePlatform>;

/**
 * Creative tone
 */
export const CreativeTone = z.enum(["high_energy", "calm_explainer", "storytime", "authority"]);
export type CreativeTone = z.infer<typeof CreativeTone>;

/**
 * Dropshipping creative input
 */
export const DropshippingCreativeInput = z.object({
  productId: z.string().uuid(),
  clipId: z.string().uuid().optional(),
  platform: CreativePlatform.optional().default("tiktok"),
  tone: CreativeTone.optional(),
  language: z.string().optional().default("en"),
  angleOverride: z.string().optional(),
}).strict();
export type DropshippingCreativeInput = z.infer<typeof DropshippingCreativeInput>;

/**
 * Dropshipping creative output (matches spec)
 */
export const DropshippingCreativeOutput = z.object({
  caption: z.string().min(1),
  script: z.string().min(1),
  hashtags: z.array(z.string()),
  hook: z.string().min(1),
  soundIdea: z.string().optional(),
  rawModelOutput: z.unknown().optional(),
}).strict();
export type DropshippingCreativeOutput = z.infer<typeof DropshippingCreativeOutput>;

/**
 * Product creative spec DTO
 */
export const ProductCreativeSpecDto = z.object({
  productId: z.string().uuid(),
  primaryAngle: z.string().nullable(),
  audience: z.string().nullable(),
  benefits: z.array(z.string()).nullable(),
  objections: z.array(z.string()).nullable(),
  tone: CreativeTone.nullable(),
  platforms: z.array(CreativePlatform).nullable(),
  language: z.string().nullable(),
  notes: z.string().nullable(),
}).strict();
export type ProductCreativeSpecDto = z.infer<typeof ProductCreativeSpecDto>;

/**
 * Upsert product creative spec input
 */
export const UpsertProductCreativeSpecInput = z.object({
  primaryAngle: z.string().optional().nullable(),
  audience: z.string().optional().nullable(),
  benefits: z.array(z.string()).optional().nullable(),
  objections: z.array(z.string()).optional().nullable(),
  tone: CreativeTone.optional().nullable(),
  platforms: z.array(CreativePlatform).optional().nullable(),
  language: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
}).strict();
export type UpsertProductCreativeSpecInput = z.infer<typeof UpsertProductCreativeSpecInput>;

