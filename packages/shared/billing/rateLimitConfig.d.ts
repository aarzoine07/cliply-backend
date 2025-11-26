import type { RateLimitDefinition, RateLimitFeature } from "../types/rateLimit";
export type RateLimitConfig = Record<RateLimitFeature, RateLimitDefinition>;
/** Default plan-based rate limit configuration for Cliply workspaces. */
export declare const RATE_LIMIT_CONFIG: Record<"basic" | "pro" | "premium", RateLimitConfig>;
//# sourceMappingURL=rateLimitConfig.d.ts.map