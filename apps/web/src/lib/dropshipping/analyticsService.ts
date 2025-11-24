import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ProductPerformanceSummaryDto,
  type UnderperformingPostDto,
  type ProductPerformanceQuery,
  type UnderperformersQuery,
  ProductPerformanceQuery as ProductPerformanceQuerySchema,
  UnderperformersQuery as UnderperformersQuerySchema,
} from "@cliply/shared/schemas/dropshipping";

import { logger } from "../logger";
import * as productService from "./productService";

/**
 * Get time window filter for SQL
 */
function getTimeWindowFilter(window: "7d" | "30d" | "all"): string {
  if (window === "all") {
    return "";
  }
  const days = window === "7d" ? 7 : 30;
  return `AND vm.snapshot_at >= NOW() - INTERVAL '${days} days'`;
}

/**
 * Get product performance summary
 */
export async function getProductPerformanceSummary(
  workspaceId: string,
  productId: string,
  query: ProductPerformanceQuery,
  ctx: { supabase: SupabaseClient },
): Promise<ProductPerformanceSummaryDto> {
  const parsed = ProductPerformanceQuerySchema.parse(query);

  // Verify product belongs to workspace
  const product = await productService.getProductById(workspaceId, productId, ctx);
  if (!product) {
    throw new Error("Product not found or does not belong to workspace");
  }

  const timeFilter = getTimeWindowFilter(parsed.window);

  // Query to aggregate metrics for all clips linked to this product
  // We need to:
  // 1. Get clips via clip_products
  // 2. Get variant_posts for those clips
  // 3. Get latest variant_metrics for each variant_post
  // 4. Aggregate totals and by platform

  // First, get all clips for this product
  const { data: clipProducts, error: clipProductsError } = await ctx.supabase
    .from("clip_products")
    .select("clip_id")
    .eq("product_id", productId);

  if (clipProductsError) {
    logger.error("analytics_clip_products_failed", {
      workspaceId,
      productId,
      error: clipProductsError.message,
    });
    throw new Error(`Failed to get clips for product: ${clipProductsError.message}`);
  }

  if (!clipProducts || clipProducts.length === 0) {
    // Return empty summary
    return {
      productId,
      window: parsed.window,
      totals: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchTimeSeconds: 0,
      },
      derived: {},
      byPlatform: [],
      topVariants: [],
    };
  }

  const clipIds = clipProducts.map((cp) => cp.clip_id);

  // Get variant_posts for these clips
  const { data: variantPosts, error: variantPostsError } = await ctx.supabase
    .from("variant_posts")
    .select(`
      id,
      clip_id,
      platform,
      variant_id,
      experiment_variants!inner(
        id,
        label,
        experiment_id,
        experiments!inner(
          id,
          workspace_id
        )
      )
    `)
    .in("clip_id", clipIds)
    .eq("experiment_variants.experiments.workspace_id", workspaceId)
    .eq("status", "posted");

  if (variantPostsError) {
    logger.error("analytics_variant_posts_failed", {
      workspaceId,
      productId,
      error: variantPostsError.message,
    });
    throw new Error(`Failed to get variant posts: ${variantPostsError.message}`);
  }

  if (!variantPosts || variantPosts.length === 0) {
    return {
      productId,
      window: parsed.window,
      totals: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchTimeSeconds: 0,
      },
      derived: {},
      byPlatform: [],
      topVariants: [],
    };
  }

  const variantPostIds = variantPosts.map((vp: any) => vp.id);

  // Get all metrics and aggregate in memory
  // In production, you'd want to use a more efficient SQL query with window functions
  const { data: allMetrics, error: metricsError } = await ctx.supabase
    .from("variant_metrics")
    .select("*")
    .in("variant_post_id", variantPostIds)
    .order("snapshot_at", { ascending: false });

  if (metricsError) {
    logger.error("analytics_metrics_failed", {
      workspaceId,
      productId,
      error: metricsError.message,
    });
    throw new Error(`Failed to get metrics: ${metricsError.message}`);
  }

  // Filter by time window if needed
  let filteredMetrics = allMetrics || [];
  if (parsed.window !== "all") {
    const days = parsed.window === "7d" ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    filteredMetrics = filteredMetrics.filter(
      (m: any) => new Date(m.snapshot_at) >= cutoff
    );
  }

  // Get latest metric per variant_post
  const latestMetricsByPost = new Map<string, any>();
  for (const metric of filteredMetrics) {
    const postId = metric.variant_post_id;
    if (!latestMetricsByPost.has(postId)) {
      latestMetricsByPost.set(postId, metric);
    } else {
      const existing = latestMetricsByPost.get(postId);
      if (new Date(metric.snapshot_at) > new Date(existing.snapshot_at)) {
        latestMetricsByPost.set(postId, metric);
      }
    }
  }

  // Build variant post lookup
  const variantPostMap = new Map<string, any>();
  for (const vp of variantPosts) {
    variantPostMap.set(vp.id, vp);
  }

  // Aggregate totals
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let totalShares = 0;
  let totalWatchTime = 0;
  let totalCtr = 0;
  let ctrCount = 0;

  // Aggregate by platform
  const platformStats = new Map<string, {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    watchTimeSeconds: number;
  }>();

  // Track top variants
  const variantStats = new Map<string, {
    experimentId?: string;
    variantId?: string;
    label?: string;
    platform: string;
    views: number;
    likes: number;
    watchTimeSeconds: number;
  }>();

  for (const [postId, metric] of latestMetricsByPost.entries()) {
    const vp = variantPostMap.get(postId);
    if (!vp) continue;

    const platform = vp.platform;
    const views = metric.views || 0;
    const likes = metric.likes || 0;
    const comments = metric.comments || 0;
    const shares = metric.shares || 0;
    const watchTime = Number(metric.watch_time_seconds) || 0;
    const ctr = metric.ctr ? Number(metric.ctr) : null;

    // Totals
    totalViews += views;
    totalLikes += likes;
    totalComments += comments;
    totalShares += shares;
    totalWatchTime += watchTime;
    if (ctr !== null) {
      totalCtr += ctr;
      ctrCount++;
    }

    // By platform
    if (!platformStats.has(platform)) {
      platformStats.set(platform, {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchTimeSeconds: 0,
      });
    }
    const platformStat = platformStats.get(platform)!;
    platformStat.views += views;
    platformStat.likes += likes;
    platformStat.comments += comments;
    platformStat.shares += shares;
    platformStat.watchTimeSeconds += watchTime;

    // Top variants
    const variant = vp.experiment_variants as any;
    const variantKey = `${vp.platform}-${variant?.id || "unknown"}`;
    if (!variantStats.has(variantKey)) {
      variantStats.set(variantKey, {
        experimentId: variant?.experiments?.id,
        variantId: variant?.id,
        label: variant?.label,
        platform: vp.platform,
        views: 0,
        likes: 0,
        watchTimeSeconds: 0,
      });
    }
    const variantStat = variantStats.get(variantKey)!;
    variantStat.views += views;
    variantStat.likes += likes;
    variantStat.watchTimeSeconds += watchTime;
  }

  // Build byPlatform array
  const byPlatform = Array.from(platformStats.entries())
    .map(([platform, stats]) => ({
      platform: platform as "tiktok" | "youtube_shorts",
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
      shares: stats.shares,
      watchTimeSeconds: stats.watchTimeSeconds,
    }))
    .filter((p) => p.platform === "tiktok" || p.platform === "youtube_shorts");

  // Build topVariants array (sorted by views, limit 20)
  const topVariants = Array.from(variantStats.values())
    .map((v) => ({
      ...v,
      avgViewDurationSec: v.views > 0 ? v.watchTimeSeconds / v.views : 0,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20)
    .map((v) => ({
      experimentId: v.experimentId,
      variantId: v.variantId,
      label: v.label,
      platform: v.platform as "tiktok" | "youtube_shorts",
      views: v.views,
      likes: v.likes,
      watchTimeSeconds: v.watchTimeSeconds,
      avgViewDurationSec: v.avgViewDurationSec,
    }));

  // Derived metrics
  const avgViewDurationSec = totalViews > 0 ? totalWatchTime / totalViews : undefined;
  const avgCtr = ctrCount > 0 ? totalCtr / ctrCount : undefined;

  return {
    productId,
    window: parsed.window,
    totals: {
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      watchTimeSeconds: totalWatchTime,
    },
    derived: {
      avgViewDurationSec,
      avgCtr,
    },
    byPlatform,
    topVariants,
  };
}

/**
 * Get underperforming posts for a product
 */
export async function getUnderperformingPostsForProduct(
  workspaceId: string,
  productId: string,
  query: UnderperformersQuery,
  ctx: { supabase: SupabaseClient },
): Promise<UnderperformingPostDto[]> {
  const parsed = UnderperformersQuerySchema.parse(query);

  // Verify product belongs to workspace
  const product = await productService.getProductById(workspaceId, productId, ctx);
  if (!product) {
    throw new Error("Product not found or does not belong to workspace");
  }

  // Get clips for product
  const { data: clipProducts, error: clipProductsError } = await ctx.supabase
    .from("clip_products")
    .select("clip_id")
    .eq("product_id", productId);

  if (clipProductsError) {
    logger.error("underperformers_clip_products_failed", {
      workspaceId,
      productId,
      error: clipProductsError.message,
    });
    throw new Error(`Failed to get clips for product: ${clipProductsError.message}`);
  }

  if (!clipProducts || clipProducts.length === 0) {
    return [];
  }

  const clipIds = clipProducts.map((cp) => cp.clip_id);

  // Get variant_posts
  const { data: variantPosts, error: variantPostsError } = await ctx.supabase
    .from("variant_posts")
    .select(`
      id,
      clip_id,
      platform,
      variant_id,
      experiment_variants!inner(
        experiments!inner(
          workspace_id
        )
      )
    `)
    .in("clip_id", clipIds)
    .eq("experiment_variants.experiments.workspace_id", workspaceId)
    .eq("status", "posted");

  if (variantPostsError) {
    logger.error("underperformers_variant_posts_failed", {
      workspaceId,
      productId,
      error: variantPostsError.message,
    });
    throw new Error(`Failed to get variant posts: ${variantPostsError.message}`);
  }

  if (!variantPosts || variantPosts.length === 0) {
    return [];
  }

  const variantPostIds = variantPosts.map((vp: any) => vp.id);

  // Get all metrics and filter by time window
  const days = parsed.window === "7d" ? 7 : 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data: allMetrics, error: metricsError } = await ctx.supabase
    .from("variant_metrics")
    .select("*")
    .in("variant_post_id", variantPostIds)
    .gte("snapshot_at", cutoff.toISOString())
    .order("snapshot_at", { ascending: false });

  if (metricsError) {
    logger.error("underperformers_metrics_failed", {
      workspaceId,
      productId,
      error: metricsError.message,
    });
    throw new Error(`Failed to get metrics: ${metricsError.message}`);
  }

  // Get latest metric per variant_post
  const latestMetricsByPost = new Map<string, any>();
  for (const metric of allMetrics || []) {
    const postId = metric.variant_post_id;
    if (!latestMetricsByPost.has(postId)) {
      latestMetricsByPost.set(postId, metric);
    } else {
      const existing = latestMetricsByPost.get(postId);
      if (new Date(metric.snapshot_at) > new Date(existing.snapshot_at)) {
        latestMetricsByPost.set(postId, metric);
      }
    }
  }

  // Build variant post lookup
  const variantPostMap = new Map<string, any>();
  for (const vp of variantPosts) {
    variantPostMap.set(vp.id, vp);
  }

  // Calculate per-post metrics and collect candidates
  const postMetrics: Array<{
    variantPostId: string;
    clipId: string;
    platform: string;
    views: number;
    likes: number;
    watchTimeSeconds: number;
    ctr: number | null;
    avgViewDurationSec: number;
  }> = [];

  for (const [postId, metric] of latestMetricsByPost.entries()) {
    const vp = variantPostMap.get(postId);
    if (!vp) continue;

    const views = metric.views || 0;
    if (views < parsed.minViews) {
      continue; // Skip posts below minViews threshold
    }

    const likes = metric.likes || 0;
    const watchTime = Number(metric.watch_time_seconds) || 0;
    const ctr = metric.ctr ? Number(metric.ctr) : null;
    const avgViewDurationSec = views > 0 ? watchTime / views : 0;

    postMetrics.push({
      variantPostId: postId,
      clipId: vp.clip_id,
      platform: vp.platform,
      views,
      likes,
      watchTimeSeconds: watchTime,
      ctr,
      avgViewDurationSec,
    });
  }

  // Calculate product medians for comparison
  const allViews = postMetrics.map((p) => p.views);
  const allCtrs = postMetrics.map((p) => p.ctr).filter((c): c is number => c !== null);
  const allWatchTimes = postMetrics.map((p) => p.avgViewDurationSec);

  const medianViews = allViews.length > 0
    ? [...allViews].sort((a, b) => a - b)[Math.floor(allViews.length / 2)]
    : 0;
  const medianCtr = allCtrs.length > 0
    ? [...allCtrs].sort((a, b) => a - b)[Math.floor(allCtrs.length / 2)]
    : null;
  const medianWatchTime = allWatchTimes.length > 0
    ? [...allWatchTimes].sort((a, b) => a - b)[Math.floor(allWatchTimes.length / 2)]
    : 0;

  // Identify underperformers
  const underperformers: UnderperformingPostDto[] = [];

  for (const post of postMetrics) {
    const reasons: Array<"low_views" | "low_ctr" | "low_watch_time" | "below_product_median"> = [];

    // Note: We already filtered by minViews, so we won't mark "low_views" here
    // But we could if we want to include them anyway

    if (post.ctr !== null && post.ctr <= parsed.maxCtr) {
      reasons.push("low_ctr");
    }

    if (post.avgViewDurationSec < 3) {
      reasons.push("low_watch_time");
    }

    if (post.views < medianViews) {
      reasons.push("below_product_median");
    }

    if (post.ctr !== null && medianCtr !== null && post.ctr < medianCtr) {
      reasons.push("below_product_median");
    }

    if (post.avgViewDurationSec < medianWatchTime) {
      reasons.push("below_product_median");
    }

    // Only include if there's at least one reason
    if (reasons.length > 0) {
      underperformers.push({
        variantPostId: post.variantPostId,
        clipId: post.clipId,
        productId,
        platform: post.platform as "tiktok" | "youtube_shorts",
        views: post.views,
        likes: post.likes,
        watchTimeSeconds: post.watchTimeSeconds,
        ctr: post.ctr ?? undefined,
        reason: reasons,
      });
    }
  }

  return underperformers;
}

