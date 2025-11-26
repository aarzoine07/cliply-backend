import { BillingErrorCode } from "../types/billing";
import type { PlanName } from "../types/auth";
/**
 * Usage metrics tracked per workspace per period.
 */
export type UsageMetric = "source_minutes" | "clips" | "projects";
/**
 * Parameters for recording usage.
 */
export interface UsageIncrement {
    workspaceId: string;
    metric: UsageMetric;
    amount: number;
    at?: Date;
}
/**
 * Usage summary for a workspace in the current period.
 */
export interface UsageSummary {
    workspaceId: string;
    planName: PlanName;
    periodStart: Date;
    metrics: {
        [K in UsageMetric]?: {
            used: number;
            limit: number | null;
        };
    };
}
/**
 * Result of checking if usage is within limits.
 */
export interface UsageCheckResult {
    ok: boolean;
    reason?: "limit_exceeded";
    metric?: UsageMetric;
    used?: number;
    limit?: number;
}
/**
 * Error thrown when usage limit is exceeded.
 */
export declare class UsageLimitExceededError extends Error {
    code: BillingErrorCode;
    status: number;
    metric: UsageMetric;
    used: number;
    limit: number;
    constructor(metric: UsageMetric, used: number, limit: number);
}
/**
 * Record usage increment for a workspace.
 * This upserts the usage row, incrementing the specified metric atomically.
 */
export declare function recordUsage(incr: UsageIncrement): Promise<void>;
/**
 * Get current usage summary for a workspace.
 */
export declare function getUsageSummary(workspaceId: string, at?: Date): Promise<UsageSummary>;
/**
 * Check if adding the specified amount would exceed the limit.
 * Returns a result object (does not throw).
 */
export declare function checkUsage(workspaceId: string, metric: UsageMetric, amount: number, at?: Date): Promise<UsageCheckResult>;
/**
 * Assert that adding the specified amount would not exceed the limit.
 * Throws UsageLimitExceededError if limit would be exceeded.
 */
export declare function assertWithinUsage(workspaceId: string, metric: UsageMetric, amount: number, at?: Date): Promise<void>;
//# sourceMappingURL=usageTracker.d.ts.map