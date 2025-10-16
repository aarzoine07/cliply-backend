import type { RateLimitDefinition, RateLimitFeature } from "../types/rateLimit";

export type RateLimitConfig = Record<RateLimitFeature, RateLimitDefinition>;

/** Default plan-based rate limit configuration for Cliply workspaces. */
export const RATE_LIMIT_CONFIG: Record<"basic" | "growth" | "agency", RateLimitConfig> = {
  basic: {
    upload: { capacity: 20, refill_rate: 5 },
    render: { capacity: 10, refill_rate: 3 },
    publish: { capacity: 5, refill_rate: 2 },
    ai_caption: { capacity: 15, refill_rate: 5 },
  },
  growth: {
    upload: { capacity: 100, refill_rate: 20 },
    render: { capacity: 50, refill_rate: 10 },
    publish: { capacity: 25, refill_rate: 5 },
    ai_caption: { capacity: 60, refill_rate: 15 },
  },
  agency: {
    upload: { capacity: 300, refill_rate: 50 },
    render: { capacity: 200, refill_rate: 40 },
    publish: { capacity: 100, refill_rate: 20 },
    ai_caption: { capacity: 150, refill_rate: 30 },
  },
} as const;
