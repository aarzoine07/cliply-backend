import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ProductDto,
  type CreateProductInput,
  type UpdateProductInput,
  CreateProductInput as CreateProductInputSchema,
  UpdateProductInput as UpdateProductInputSchema,
} from "@cliply/shared/schemas/dropshipping";

import { HttpError } from "../errors";
import { logger } from "../logger";

/**
 * Normalize slug: lowercase, trim, replace spaces with hyphens
 */
function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * List products for a workspace
 */
export async function listProductsForWorkspace(
  workspaceId: string,
  ctx: { supabase: SupabaseClient },
): Promise<ProductDto[]> {
  const { data: products, error } = await ctx.supabase
    .from("products")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("products_list_failed", {
      workspaceId,
      error: error.message,
    });
    throw new Error(`Failed to list products: ${error.message}`);
  }

  return (products || []).map((p) => mapProductToDto(p));
}

/**
 * Create a product for a workspace
 */
export async function createProductForWorkspace(
  workspaceId: string,
  input: CreateProductInput,
  ctx: { supabase: SupabaseClient },
): Promise<ProductDto> {
  const parsed = CreateProductInputSchema.parse(input);

  // Normalize slug
  const normalizedSlug = normalizeSlug(parsed.slug);

  const productData: Record<string, unknown> = {
    workspace_id: workspaceId,
    name: parsed.name,
    slug: normalizedSlug,
    description: parsed.description ?? null,
    product_type: parsed.product_type ?? "dropshipping",
    status: parsed.status ?? "active",
    tags: parsed.tags ?? [],
    landing_url: parsed.landingUrl ?? null,
    // Ensure NOT NULL url column is always populated
    url: parsed.landingUrl ?? normalizedSlug,
    price_cents: parsed.priceCents ?? null,
    currency: parsed.currency ?? null,
    primary_benefit: parsed.primaryBenefit ?? null,
    features: parsed.features ?? null,
    target_audience: parsed.targetAudience ?? null,
    objections: parsed.objections ?? null,
    brand_voice: parsed.brandVoice ?? null,
    creative_notes: parsed.creativeNotes ?? null,
  };

  const { data: product, error } = await ctx.supabase
    .from("products")
    .insert(productData)
    .select()
    .single();

  if (error) {
    // Check for unique constraint violation
    if (error.code === "23505" || error.message.includes("unique") || error.message.includes("duplicate")) {
      logger.warn("products_create_duplicate_slug", {
        workspaceId,
        slug: normalizedSlug,
      });
      throw new HttpError(409, "Product with this slug already exists in this workspace", undefined, "duplicate_slug");
    }

    logger.error("products_create_failed", {
      workspaceId,
      error: error.message,
    });
    throw new Error(`Failed to create product: ${error.message}`);
  }

  if (!product) {
    throw new Error("Failed to create product: no data returned");
  }

  logger.info("product_created", {
    workspaceId,
    productId: product.id,
    slug: normalizedSlug,
  });

  return mapProductToDto(product);
}

/**
 * Get a product by ID, validating it belongs to workspace
 */
export async function getProductById(
  workspaceId: string,
  productId: string,
  ctx: { supabase: SupabaseClient },
): Promise<ProductDto | null> {
  const { data: product, error } = await ctx.supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    logger.error("products_get_failed", {
      workspaceId,
      productId,
      error: error.message,
    });
    throw new Error(`Failed to get product: ${error.message}`);
  }

  if (!product) {
    return null;
  }

  return mapProductToDto(product);
}

/**
 * Update a product for a workspace
 */
export async function updateProductForWorkspace(
  workspaceId: string,
  productId: string,
  input: UpdateProductInput,
  ctx: { supabase: SupabaseClient },
): Promise<ProductDto> {
  const parsed = UpdateProductInputSchema.parse(input);

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {};
  if (parsed.name !== undefined) {
    updateData.name = parsed.name;
  }
  if (parsed.slug !== undefined) {
    updateData.slug = normalizeSlug(parsed.slug);
  }
  if (parsed.description !== undefined) {
    updateData.description = parsed.description;
  }
  if (parsed.status !== undefined) {
    updateData.status = parsed.status;
  }
  if (parsed.tags !== undefined) {
    updateData.tags = parsed.tags;
  }
  if (parsed.landingUrl !== undefined) {
    updateData.landing_url = parsed.landingUrl;
    // Keep url in sync when landingUrl is provided, without breaking NOT NULL
    if (parsed.landingUrl !== null) {
      updateData.url = parsed.landingUrl;
    }
  }
  if (parsed.priceCents !== undefined) {
    updateData.price_cents = parsed.priceCents;
  }
  if (parsed.currency !== undefined) {
    updateData.currency = parsed.currency;
  }
  if (parsed.primaryBenefit !== undefined) {
    updateData.primary_benefit = parsed.primaryBenefit;
  }
  if (parsed.features !== undefined) {
    updateData.features = parsed.features;
  }
  if (parsed.targetAudience !== undefined) {
    updateData.target_audience = parsed.targetAudience;
  }
  if (parsed.objections !== undefined) {
    updateData.objections = parsed.objections;
  }
  if (parsed.brandVoice !== undefined) {
    updateData.brand_voice = parsed.brandVoice;
  }
  if (parsed.creativeNotes !== undefined) {
    updateData.creative_notes = parsed.creativeNotes;
  }

  // Verify product exists and belongs to workspace
  const { data: existing, error: lookupError } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (lookupError) {
    logger.error("products_update_lookup_failed", {
      workspaceId,
      productId,
      error: lookupError.message,
    });
    throw new Error(`Failed to lookup product: ${lookupError.message}`);
  }

  if (!existing) {
    logger.warn("products_update_not_found", {
      workspaceId,
      productId,
    });
    throw new HttpError(404, "Product not found", undefined, "not_found");
  }

  const { data: product, error } = await ctx.supabase
    .from("products")
    .update(updateData)
    .eq("id", productId)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) {
    // Check for unique constraint violation
    if (error.code === "23505" || error.message.includes("unique") || error.message.includes("duplicate")) {
      logger.warn("products_update_duplicate_slug", {
        workspaceId,
        productId,
        slug: parsed.slug,
      });
      throw new HttpError(409, "Product with this slug already exists in this workspace", undefined, "duplicate_slug");
    }

    logger.error("products_update_failed", {
      workspaceId,
      productId,
      error: error.message,
    });
    throw new Error(`Failed to update product: ${error.message}`);
  }

  if (!product) {
    throw new Error("Failed to update product: no data returned");
  }

  logger.info("product_updated", {
    workspaceId,
    productId,
  });

  return mapProductToDto(product);
}

/**
 * Map database product row to ProductDto
 */
function mapProductToDto(p: any): ProductDto {
  return {
    id: p.id,
    workspace_id: p.workspace_id,
    name: p.name,
    slug: p.slug,
    description: p.description ?? null,
    product_type: p.product_type ?? "dropshipping",
    status: p.status ?? "active",
    tags: p.tags ?? [],
    landing_url: p.landing_url ?? null,
    price_cents: p.price_cents ?? null,
    currency: p.currency ?? null,
    primary_benefit: p.primary_benefit ?? null,
    features: p.features ?? null,
    target_audience: p.target_audience ?? null,
    objections: p.objections ?? null,
    brand_voice: p.brand_voice ?? null,
    creative_notes: p.creative_notes ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

/**
 * Link a clip to a product (idempotent)
 */
export async function linkClipToProduct(
  clipId: string,
  productId: string,
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Verify clip and product exist and belong to same workspace
  const { data: clip, error: clipError } = await ctx.supabase
    .from("clips")
    .select("id, workspace_id")
    .eq("id", clipId)
    .single();

  if (clipError || !clip) {
    logger.warn("link_clip_product_clip_not_found", {
      clipId,
      error: clipError?.message,
    });
    throw new Error("Clip not found");
  }

  const { data: product, error: productError } = await ctx.supabase
    .from("products")
    .select("id, workspace_id")
    .eq("id", productId)
    .single();

  if (productError || !product) {
    logger.warn("link_clip_product_product_not_found", {
      productId,
      error: productError?.message,
    });
    throw new Error("Product not found");
  }

  if (clip.workspace_id !== product.workspace_id) {
    logger.warn("link_clip_product_workspace_mismatch", {
      clipId,
      productId,
      clipWorkspaceId: clip.workspace_id,
      productWorkspaceId: product.workspace_id,
    });
    throw new Error("Clip and product must belong to the same workspace");
  }

  // Insert link (idempotent - ignore if already exists)
  const { error: insertError } = await ctx.supabase
    .from("clip_products")
    .insert({
      clip_id: clipId,
      product_id: productId,
    })
    .select()
    .maybeSingle();

  if (insertError) {
    // Ignore unique constraint violation (already linked)
    if (insertError.code === "23505" || insertError.message.includes("unique") || insertError.message.includes("duplicate")) {
      logger.info("link_clip_product_already_linked", {
        clipId,
        productId,
      });
      return;
    }

    logger.error("link_clip_product_failed", {
      clipId,
      productId,
      error: insertError.message,
    });
    throw new Error(`Failed to link clip to product: ${insertError.message}`);
  }

  logger.info("clip_linked_to_product", {
    clipId,
    productId,
  });
}

/**
 * Get products for a clip
 */
export async function getProductsForClip(
  clipId: string,
  ctx: { supabase: SupabaseClient },
): Promise<ProductDto[]> {
  const { data: products, error } = await ctx.supabase
    .from("clip_products")
    .select(`
      product_id,
      products:products(*)
    `)
    .eq("clip_id", clipId);

  if (error) {
    logger.error("get_products_for_clip_failed", {
      clipId,
      error: error.message,
    });
    throw new Error(`Failed to get products for clip: ${error.message}`);
  }

  // Extract products from join result
  const productList = (products || [])
    .map((row: any) => row.products)
    .filter((p: any) => p != null);

  return productList.map((p: any) => mapProductToDto(p));
}

/**
 * Get clips for a product (minimal summary)
 */
export async function getClipsForProduct(
  productId: string,
  ctx: { supabase: SupabaseClient },
): Promise<Array<{ id: string; status: string; created_at: string }>> {
  const { data: clips, error } = await ctx.supabase
    .from("clip_products")
    .select(`
      clip_id,
      clips:clips(id, status, created_at)
    `)
    .eq("product_id", productId);

  if (error) {
    logger.error("get_clips_for_product_failed", {
      productId,
      error: error.message,
    });
    throw new Error(`Failed to get clips for product: ${error.message}`);
  }

  // Extract clips from join result
  const clipList = (clips || [])
    .map((row: any) => row.clips)
    .filter((c: any) => c != null);

  return clipList.map((c: any) => ({
    id: c.id,
    status: c.status,
    created_at: c.created_at,
  }));
}


