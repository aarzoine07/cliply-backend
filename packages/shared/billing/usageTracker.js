import { createClient } from "@supabase/supabase-js";
import { PLAN_MATRIX } from "./planMatrix";
import { BillingErrorCode } from "../types/billing";
import { logger } from "../logging/logger";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
/**
 * Error thrown when usage limit is exceeded.
 */
export class UsageLimitExceededError extends Error {
    constructor(metric, used, limit) {
        const message = `Usage limit exceeded for ${metric}: ${used}/${limit}`;
        super(message);
        this.code = BillingErrorCode.PLAN_LIMIT;
        this.status = 429;
        this.name = "UsageLimitExceededError";
        this.metric = metric;
        this.used = used;
        this.limit = limit;
    }
}
/**
 * Get the start of the current calendar month (UTC).
 */
function getPeriodStart(at = new Date()) {
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth();
    return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}
/**
 * Format period start as YYYY-MM-DD for database storage.
 */
function formatPeriodStart(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
}
/**
 * Get workspace plan name from workspaces table.
 * D1: Updated to use workspace.plan field directly instead of subscriptions table.
 */
async function getWorkspacePlan(workspaceId) {
    const { data: workspace, error } = await supabase
        .from("workspaces")
        .select("plan")
        .eq("id", workspaceId)
        .maybeSingle();
    if (error && error.code !== "PGRST116") {
        logger.error("usage_tracker_get_plan_failed", {
            workspaceId,
            error: error.message,
        });
    }
    const planName = workspace?.plan;
    if (planName === "basic" || planName === "pro" || planName === "premium") {
        return planName;
    }
    return "basic"; // Default to basic if workspace not found or invalid plan
}
/**
 * Get the limit for a metric from the plan matrix.
 */
function getMetricLimit(planName, metric) {
    const plan = PLAN_MATRIX[planName];
    if (!plan) {
        return null;
    }
    // Map usage metrics to plan limits
    switch (metric) {
        case "source_minutes":
            return plan.limits.source_minutes_per_month ?? null;
        case "clips":
            return plan.limits.clips_per_month ?? null;
        case "projects":
            return plan.limits.projects_per_month ?? null;
        default:
            return null;
    }
}
/**
 * Record usage increment for a workspace.
 * This upserts the usage row, incrementing the specified metric atomically.
 */
export async function recordUsage(incr) {
    const periodStart = getPeriodStart(incr.at);
    const periodStartStr = formatPeriodStart(periodStart);
    const metricColumn = incr.metric === "clips" ? "clips_count" : incr.metric === "projects" ? "projects_count" : "source_minutes";
    // Use PostgreSQL's ON CONFLICT to atomically increment
    const { error } = await supabase.rpc("increment_workspace_usage", {
        p_workspace_id: incr.workspaceId,
        p_period_start: periodStartStr,
        p_metric: metricColumn,
        p_amount: incr.amount,
    });
    if (error) {
        // Fallback to manual upsert if RPC doesn't exist yet
        const { data: existing } = await supabase
            .from("workspace_usage")
            .select("*")
            .eq("workspace_id", incr.workspaceId)
            .eq("period_start", periodStartStr)
            .maybeSingle();
        if (existing) {
            const currentValue = existing[metricColumn];
            const { error: updateError } = await supabase
                .from("workspace_usage")
                .update({
                [metricColumn]: currentValue + incr.amount,
                updated_at: new Date().toISOString(),
            })
                .eq("workspace_id", incr.workspaceId)
                .eq("period_start", periodStartStr);
            if (updateError) {
                logger.error("usage_tracker_record_failed", {
                    workspaceId: incr.workspaceId,
                    metric: incr.metric,
                    error: updateError.message,
                });
                throw new Error(`Failed to record usage: ${updateError.message}`);
            }
        }
        else {
            const initialValues = {
                source_minutes: 0,
                clips_count: 0,
                projects_count: 0,
            };
            initialValues[metricColumn] = incr.amount;
            const { error: insertError } = await supabase.from("workspace_usage").insert({
                workspace_id: incr.workspaceId,
                period_start: periodStartStr,
                ...initialValues,
            });
            if (insertError) {
                logger.error("usage_tracker_record_failed", {
                    workspaceId: incr.workspaceId,
                    metric: incr.metric,
                    error: insertError.message,
                });
                throw new Error(`Failed to record usage: ${insertError.message}`);
            }
        }
    }
    logger.info("usage_tracker_recorded", {
        workspaceId: incr.workspaceId,
        metric: incr.metric,
        amount: incr.amount,
        periodStart: periodStartStr,
    });
}
/**
 * Get current usage summary for a workspace.
 */
export async function getUsageSummary(workspaceId, at) {
    const periodStart = getPeriodStart(at);
    const periodStartStr = formatPeriodStart(periodStart);
    const planName = await getWorkspacePlan(workspaceId);
    const { data: usage, error } = await supabase
        .from("workspace_usage")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("period_start", periodStartStr)
        .maybeSingle();
    if (error && error.code !== "PGRST116") {
        logger.error("usage_tracker_get_summary_failed", {
            workspaceId,
            error: error.message,
        });
    }
    const metrics = {};
    // Build metrics from usage row or defaults
    const sourceMinutes = usage?.source_minutes ?? 0;
    const clipsCount = usage?.clips_count ?? 0;
    const projectsCount = usage?.projects_count ?? 0;
    metrics.source_minutes = {
        used: Number(sourceMinutes),
        limit: getMetricLimit(planName, "source_minutes"),
    };
    metrics.clips = {
        used: clipsCount,
        limit: getMetricLimit(planName, "clips"),
    };
    metrics.projects = {
        used: projectsCount,
        limit: getMetricLimit(planName, "projects"),
    };
    return {
        workspaceId,
        planName,
        periodStart,
        metrics,
    };
}
/**
 * Check if adding the specified amount would exceed the limit.
 * Returns a result object (does not throw).
 */
export async function checkUsage(workspaceId, metric, amount, at) {
    const summary = await getUsageSummary(workspaceId, at);
    const metricData = summary.metrics[metric];
    if (!metricData) {
        return { ok: true }; // Unknown metric, allow
    }
    const { used, limit } = metricData;
    if (limit === null) {
        return { ok: true }; // Unlimited
    }
    if (used + amount > limit) {
        return {
            ok: false,
            reason: "limit_exceeded",
            metric,
            used,
            limit,
        };
    }
    return { ok: true };
}
/**
 * Assert that adding the specified amount would not exceed the limit.
 * Throws UsageLimitExceededError if limit would be exceeded.
 */
export async function assertWithinUsage(workspaceId, metric, amount, at) {
    const result = await checkUsage(workspaceId, metric, amount, at);
    if (!result.ok && result.reason === "limit_exceeded") {
        throw new UsageLimitExceededError(result.metric, result.used, result.limit);
    }
}
