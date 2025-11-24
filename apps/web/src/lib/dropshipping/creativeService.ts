import type { SupabaseClient } from "@supabase/supabase-js";

import { type ProductDto } from "@cliply/shared/schemas/dropshipping";
import {
  type DropshippingCreativeInput,
  type DropshippingCreativeOutput,
  type ProductCreativeSpecDto,
  type UpsertProductCreativeSpecInput,
  ProductCreativeSpecDto as ProductCreativeSpecDtoSchema,
  UpsertProductCreativeSpecInput as UpsertProductCreativeSpecInputSchema,
  DropshippingCreativeOutput as DropshippingCreativeOutputSchema,
} from "@cliply/shared/schemas/dropshippingCreative";

import { logger } from "../logger";
import { callOpenAI } from "../ai/openaiClient";
import * as productService from "./productService";

/**
 * Get creative spec for a product
 */
export async function getCreativeSpecForProduct(
  workspaceId: string,
  productId: string,
  ctx: { supabase: SupabaseClient },
): Promise<ProductCreativeSpecDto | null> {
  // Verify product exists and belongs to workspace
  const product = await productService.getProductById(workspaceId, productId, ctx);
  if (!product) {
    return null;
  }

  // Get product with creative_spec
  const { data: productRow, error } = await ctx.supabase
    .from("products")
    .select("creative_spec")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("creative_spec_get_failed", {
      workspaceId,
      productId,
      error: error.message,
    });
    throw new Error(`Failed to get creative spec: ${error.message}`);
  }

  if (!productRow) {
    return null;
  }

  const spec = productRow.creative_spec as Record<string, unknown> | null;
  if (!spec || typeof spec !== "object" || Object.keys(spec).length === 0) {
    return {
      productId,
      primaryAngle: null,
      audience: null,
      benefits: null,
      objections: null,
      tone: null,
      platforms: null,
      language: null,
      notes: null,
    };
  }

  // Parse and validate the spec
  const parsed = ProductCreativeSpecDtoSchema.safeParse({
    productId,
    primaryAngle: spec.primaryAngle ?? null,
    audience: spec.audience ?? null,
    benefits: spec.benefits ?? null,
    objections: spec.objections ?? null,
    tone: spec.tone ?? null,
    platforms: spec.platforms ?? null,
    language: spec.language ?? null,
    notes: spec.notes ?? null,
  });

  if (!parsed.success) {
    logger.warn("creative_spec_invalid_format", {
      workspaceId,
      productId,
      error: parsed.error.flatten(),
    });
    // Return default if invalid
    return {
      productId,
      primaryAngle: null,
      audience: null,
      benefits: null,
      objections: null,
      tone: null,
      platforms: null,
      language: null,
      notes: null,
    };
  }

  return parsed.data;
}

/**
 * Upsert creative spec for a product
 */
export async function upsertCreativeSpecForProduct(
  workspaceId: string,
  productId: string,
  input: UpsertProductCreativeSpecInput,
  ctx: { supabase: SupabaseClient },
): Promise<ProductCreativeSpecDto> {
  const parsed = UpsertProductCreativeSpecInputSchema.parse(input);

  // Verify product exists and belongs to workspace
  const product = await productService.getProductById(workspaceId, productId, ctx);
  if (!product) {
    throw new Error("Product not found or does not belong to workspace");
  }

  // Get existing spec
  const existing = await getCreativeSpecForProduct(workspaceId, productId, ctx);

  // Merge with new values
  const updatedSpec: ProductCreativeSpecDto = {
    productId,
    primaryAngle: parsed.primaryAngle !== undefined ? parsed.primaryAngle : existing?.primaryAngle ?? null,
    audience: parsed.audience !== undefined ? parsed.audience : existing?.audience ?? null,
    benefits: parsed.benefits !== undefined ? parsed.benefits : existing?.benefits ?? null,
    objections: parsed.objections !== undefined ? parsed.objections : existing?.objections ?? null,
    tone: parsed.tone !== undefined ? parsed.tone : existing?.tone ?? null,
    platforms: parsed.platforms !== undefined ? parsed.platforms : existing?.platforms ?? null,
    language: parsed.language !== undefined ? parsed.language : existing?.language ?? null,
    notes: parsed.notes !== undefined ? parsed.notes : existing?.notes ?? null,
  };

  // Update the creative_spec column
  const { error } = await ctx.supabase
    .from("products")
    .update({
      creative_spec: {
        primaryAngle: updatedSpec.primaryAngle,
        audience: updatedSpec.audience,
        benefits: updatedSpec.benefits,
        objections: updatedSpec.objections,
        tone: updatedSpec.tone,
        platforms: updatedSpec.platforms,
        language: updatedSpec.language,
        notes: updatedSpec.notes,
      },
    })
    .eq("id", productId)
    .eq("workspace_id", workspaceId);

  if (error) {
    logger.error("creative_spec_upsert_failed", {
      workspaceId,
      productId,
      error: error.message,
    });
    throw new Error(`Failed to upsert creative spec: ${error.message}`);
  }

  logger.info("creative_spec_upserted", {
    workspaceId,
    productId,
  });

  return updatedSpec;
}

/**
 * Build a prompt for creative generation based on product metadata and creative spec
 */
function buildCreativePrompt(
  product: ProductDto,
  creativeSpec: ProductCreativeSpecDto | null,
  input: DropshippingCreativeInput,
  clipDurationMs?: number | null,
): { systemPrompt: string; userPrompt: string } {
  const platform = input.platform ?? "tiktok";
  const tone = input.tone ?? creativeSpec?.tone ?? null;
  const language = input.language ?? creativeSpec?.language ?? "en";
  const angle = input.angleOverride ?? creativeSpec?.primaryAngle ?? null;
  const toneDescription = tone
    ? tone === "high_energy"
      ? "high-energy, fast-paced, exciting"
      : tone === "calm_explainer"
      ? "calm, educational, informative"
      : tone === "storytime"
      ? "conversational, storytelling, personal"
      : "authoritative, expert, trustworthy"
    : "engaging and authentic";

  const systemPrompt = `You are an expert social media creative strategist specializing in dropshipping product marketing for ${platform === "tiktok" ? "TikTok" : "YouTube Shorts"}.

Your task is to generate compelling, scroll-stopping creative content that converts viewers into buyers. You must respond with valid JSON only, matching this exact structure:
{
  "hook": "short attention-grabbing first line (5-10 words max)",
  "caption": "full caption text optimized for the platform (include emojis, line breaks, call-to-action)",
  "hashtags": ["hashtag1", "hashtag2", ...],
  "script": "what the voice should say over the video (natural, conversational, short simple sentences)",
  "soundIdea": "suggestion for sound/song type (e.g., 'trending high-energy', 'calm storytime', 'upbeat motivational')"
}

Guidelines:
- Hook must be scroll-stopping and create curiosity
- Caption should be platform-optimized (TikTok: shorter, punchy; YouTube: slightly more detailed)
- Hashtags: 5-15 relevant tags, NO '#' prefix in the array (we'll format later)
- Script: short, simple sentences for voiceover, natural and conversational
- Sound idea: concise tag for audio selection
- Tone: ${toneDescription}
- Language: ${language}
- All content must be authentic and avoid spammy language`;

  const parts: string[] = [];
  parts.push(`Product: ${product.name}`);
  if (product.description) {
    parts.push(`Description: ${product.description}`);
  }

  // Use creative spec angle if available, otherwise product primary benefit
  if (angle) {
    parts.push(`Primary Angle: ${angle}`);
  } else if (product.primary_benefit) {
    parts.push(`Primary Benefit: ${product.primary_benefit}`);
  }

  // Use creative spec benefits if available, otherwise product features
  if (creativeSpec?.benefits && creativeSpec.benefits.length > 0) {
    parts.push(`Key Benefits:\n${creativeSpec.benefits.map((b) => `- ${b}`).join("\n")}`);
  } else if (product.features && product.features.length > 0) {
    parts.push(`Key Features:\n${product.features.map((f) => `- ${f}`).join("\n")}`);
  }

  // Use creative spec audience if available, otherwise product target_audience
  if (creativeSpec?.audience) {
    parts.push(`Target Audience: ${creativeSpec.audience}`);
  } else if (product.target_audience) {
    parts.push(`Target Audience: ${product.target_audience}`);
  }

  // Use creative spec objections if available, otherwise product objections
  if (creativeSpec?.objections && creativeSpec.objections.length > 0) {
    parts.push(`Common Objections:\n${creativeSpec.objections.map((o) => `- ${o}`).join("\n")}`);
  } else if (product.objections) {
    parts.push(`Common Objections/Pain Points: ${product.objections}`);
  }

  if (product.brand_voice) {
    parts.push(`Brand Voice/Tone: ${product.brand_voice}`);
  }
  if (creativeSpec?.notes) {
    parts.push(`Creative Notes: ${creativeSpec.notes}`);
  } else if (product.creative_notes) {
    parts.push(`Creative Notes: ${product.creative_notes}`);
  }
  if (product.price_cents && product.currency) {
    const price = (product.price_cents / 100).toFixed(2);
    parts.push(`Price: ${product.currency} ${price}`);
  }
  if (clipDurationMs) {
    const durationSec = Math.round(clipDurationMs / 1000);
    parts.push(`Video Duration: ${durationSec} seconds`);
  }

  const userPrompt = `Generate creative content for this dropshipping product on ${platform === "tiktok" ? "TikTok" : "YouTube Shorts"}:

${parts.join("\n\n")}

Platform: ${platform === "tiktok" ? "TikTok" : "YouTube Shorts"}
${platform === "tiktok" ? "Keep caption concise and punchy (under 2200 chars)." : "Caption can be slightly longer but still engaging."}
Tone: ${toneDescription}
Language: ${language}

Respond with JSON only, no additional text.`;

  return { systemPrompt, userPrompt };
}

/**
 * Generate creative content for a product
 */
export async function generateCreativeForProduct(
  input: DropshippingCreativeInput,
  ctx: { workspaceId: string; supabase: SupabaseClient },
): Promise<DropshippingCreativeOutput> {
  // Load product
  const product = await productService.getProductById(ctx.workspaceId, input.productId, ctx);
  if (!product) {
    throw new Error("Product not found or does not belong to workspace");
  }

  // Load creative spec if available
  const creativeSpec = await getCreativeSpecForProduct(ctx.workspaceId, input.productId, ctx);

  // Load clip if provided
  let clipDurationMs: number | null = null;
  if (input.clipId) {
    const { data: clip, error: clipError } = await ctx.supabase
      .from("clips")
      .select("id, workspace_id, duration_ms")
      .eq("id", input.clipId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();

    if (clipError) {
      logger.error("creative_clip_load_failed", {
        workspaceId: ctx.workspaceId,
        clipId: input.clipId,
        error: clipError.message,
      });
      throw new Error(`Failed to load clip: ${clipError.message}`);
    }

    if (!clip) {
      throw new Error("Clip not found or does not belong to workspace");
    }

    clipDurationMs = clip.duration_ms ?? null;
  }

  // Build prompt
  const { systemPrompt, userPrompt } = buildCreativePrompt(
    product,
    creativeSpec,
    input,
    clipDurationMs,
  );

  // Call AI
  try {
    const rawResult = await callOpenAI<{
      hook: string;
      caption: string;
      hashtags: string[];
      script: string;
      soundIdea?: string;
    }>({
      systemPrompt,
      userPrompt,
      maxTokens: 2000,
      temperature: 0.8,
    });

    // Validate and transform to match our schema
    const result: DropshippingCreativeOutput = {
      hook: rawResult.hook || "",
      caption: rawResult.caption || "",
      hashtags: Array.isArray(rawResult.hashtags) ? rawResult.hashtags : [],
      script: rawResult.script || "",
      soundIdea: rawResult.soundIdea,
    };

    // Validate with Zod schema
    const validated = DropshippingCreativeOutputSchema.parse(result);

    logger.info("creative_generated", {
      workspaceId: ctx.workspaceId,
      productId: input.productId,
      clipId: input.clipId,
      platform: input.platform ?? "tiktok",
    });

    return validated;
  } catch (error) {
    logger.error("creative_generation_failed", {
      workspaceId: ctx.workspaceId,
      productId: input.productId,
      error: (error as Error).message,
    });
    throw error;
  }
}

