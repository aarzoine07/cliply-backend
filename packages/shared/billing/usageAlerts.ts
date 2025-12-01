import type { UsageSummary } from "./usageTracker";
import type { UsageMetric } from "./usageTracker";

/**
 * Alert level for a usage metric.
 */
export type UsageAlertLevel = "normal" | "warning" | "exceeded";

/**
 * Status for a single usage metric.
 */
export interface UsageMetricStatus {
  metric: UsageMetric;
  used: number;
  limit: number | null;
  percent: number; // 0–100+ (can exceed 100 if limit is exceeded)
  level: UsageAlertLevel;
}

/**
 * Summary of usage status across all metrics.
 */
export interface UsageStatusSummary {
  metrics: UsageMetricStatus[];
  hasWarning: boolean; // any metric >= 80% and < 100%
  hasExceeded: boolean; // any metric >= 100%
}

/**
 * Calculate usage percentage for a metric.
 * Returns 0 if limit is null or 0 (unlimited or invalid limit).
 * Can exceed 100 if usage exceeds limit.
 */
function calculatePercent(used: number, limit: number | null): number {
  if (limit === null || limit === 0) {
    return 0; // Unlimited or invalid limit
  }
  return Math.round((used / limit) * 100);
}

/**
 * Determine alert level based on usage percentage.
 * - warning: percent >= 80 && percent < 100
 * - exceeded: percent >= 100
 * - normal: otherwise
 */
function getAlertLevel(percent: number): UsageAlertLevel {
  if (percent >= 100) {
    return "exceeded";
  }
  if (percent >= 80) {
    return "warning";
  }
  return "normal";
}

/**
 * Calculate usage status for a single metric.
 */
function calculateMetricStatus(
  metric: UsageMetric,
  used: number,
  limit: number | null,
): UsageMetricStatus {
  const percent = calculatePercent(used, limit);
  const level = getAlertLevel(percent);

  return {
    metric,
    used,
    limit: limit ?? null,
    percent,
    level,
  };
}

/**
 * Calculate usage alert status from a usage summary.
 * Analyzes all metrics and returns a summary with per-metric status
 * and aggregate flags.
 */
export function calculateUsageAlerts(summary: UsageSummary): UsageStatusSummary {
  const metrics: UsageMetricStatus[] = [];

  // Process each metric in the summary
  for (const [metricKey, metricData] of Object.entries(summary.metrics)) {
    if (!metricData) {
      continue;
    }

    const metric = metricKey as UsageMetric;
    const status = calculateMetricStatus(metric, metricData.used, metricData.limit);
    metrics.push(status);
  }

  // Calculate aggregate flags
  const hasWarning = metrics.some((m) => m.level === "warning");
  const hasExceeded = metrics.some((m) => m.level === "exceeded");

  return {
    metrics,
    hasWarning,
    hasExceeded,
  };
}

/**
 * Get the previous alert level for a metric (for detecting threshold crossings).
 * This is a simple helper that can be used to track state changes.
 * In a production system, you might store previous levels in a cache or database.
 */
export function getPreviousAlertLevel(
  metric: UsageMetric,
  previousSummary: UsageStatusSummary | null,
): UsageAlertLevel | null {
  if (!previousSummary) {
    return null;
  }

  const previousMetric = previousSummary.metrics.find((m) => m.metric === metric);
  return previousMetric?.level ?? null;
}

