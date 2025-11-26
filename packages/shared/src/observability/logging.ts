/**
 * Shared observability helpers for structured logging and Sentry breadcrumbs.
 * 
 * These helpers provide consistent logging across jobs, pipelines, billing, and OAuth flows,
 * with automatic Sentry breadcrumb recording when Sentry is available.
 * 
 * Safety: Never logs secrets (tokens, keys, etc.) - only safe identifiers.
 */

import { logger } from "../../logging/logger.js";

// Try to import Sentry, but handle gracefully if not available
let Sentry: typeof import("@sentry/node") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require("@sentry/node");
} catch {
  // Sentry not available - that's okay, we'll just skip breadcrumbs
}

/**
 * Safely extracts error message without leaking secrets or full stack traces.
 */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Only return the message, not the stack (which might contain secrets)
    return error.message;
  }
  return String(error);
}

/**
 * Adds a Sentry breadcrumb if Sentry is available.
 * Silently fails if Sentry is not configured.
 */
function addBreadcrumb(
  category: string,
  message: string,
  level: "info" | "warning" | "error",
  data?: Record<string, unknown>,
): void {
  if (!Sentry) return;

  try {
    if (typeof Sentry.addBreadcrumb === "function") {
      Sentry.addBreadcrumb({
        category,
        message,
        level,
        data: data || {},
        timestamp: Date.now() / 1000,
      });
    }
  } catch {
    // Silently fail - breadcrumbs are optional
  }
}

// ============================================================================
// Job Observability
// ============================================================================

export type JobContext = {
  jobId: string;
  workspaceId?: string;
  type?: string;
  kind?: string;
};

export type JobStatus = "enqueued" | "started" | "retry" | "failed" | "completed";

/**
 * Logs job status with structured fields and Sentry breadcrumb.
 */
export function logJobStatus(
  ctx: JobContext,
  status: JobStatus,
  extra?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {
    service: "worker",
    jobId: ctx.jobId,
    ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
    ...(ctx.type && { type: ctx.type }),
    ...(ctx.kind && { kind: ctx.kind }),
    status,
    ...extra,
  };

  const event = `job_${status}`;
  const level = status === "failed" ? "error" : status === "retry" ? "warn" : "info";

  logger[level === "error" ? "error" : level === "warn" ? "warn" : "info"](event, payload);

  addBreadcrumb("job", event, level === "error" ? "error" : level === "warn" ? "warning" : "info", payload);
}

// ============================================================================
// Pipeline Observability
// ============================================================================

export type PipelineContext = {
  jobId: string;
  workspaceId?: string;
  clipId?: string;
  scheduleId?: string;
};

export type PipelinePhase = "start" | "success" | "error";

/**
 * Logs pipeline step execution with structured fields and Sentry breadcrumb.
 */
export function logPipelineStep(
  ctx: PipelineContext,
  step: string,
  phase: PipelinePhase,
  extra?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {
    service: "worker",
    jobId: ctx.jobId,
    ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
    ...(ctx.clipId && { clipId: ctx.clipId }),
    ...(ctx.scheduleId && { scheduleId: ctx.scheduleId }),
    step,
    phase,
    ...extra,
  };

  const event = `pipeline_${step}_${phase}`;
  const level = phase === "error" ? "error" : "info";

  logger[level === "error" ? "error" : "info"](event, payload);

  addBreadcrumb("pipeline", event, level === "error" ? "error" : "info", payload);
}

// ============================================================================
// Stripe Observability
// ============================================================================

export type StripeEventContext = {
  workspaceId?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeEventId?: string;
  error?: unknown;
};

/**
 * Logs Stripe webhook event handling with structured fields and Sentry breadcrumb.
 */
export function logStripeEvent(eventType: string, ctx: StripeEventContext): void {
  const payload: Record<string, unknown> = {
    service: "api",
    eventType,
    ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
    ...(ctx.stripeCustomerId && { stripeCustomerId: ctx.stripeCustomerId }),
    ...(ctx.stripeSubscriptionId && { stripeSubscriptionId: ctx.stripeSubscriptionId }),
    ...(ctx.stripeEventId && { stripeEventId: ctx.stripeEventId }),
    ...(ctx.error ? { error: safeErrorMessage(ctx.error) } : {}),
  };

  const event = `stripe_${eventType}`;
  const level = ctx.error ? "error" : "info";

  logger[level === "error" ? "error" : "info"](event, payload);

  addBreadcrumb("stripe", event, level === "error" ? "error" : "info", payload);
}

// ============================================================================
// OAuth Observability
// ============================================================================

export type OAuthProvider = "tiktok" | "youtube" | "google";

export type OAuthPhase = "start" | "success" | "error";

export type OAuthContext = {
  workspaceId?: string;
  userId?: string;
  connectedAccountId?: string;
  externalId?: string;
  error?: unknown;
};

/**
 * Logs OAuth flow events with structured fields and Sentry breadcrumb.
 */
export function logOAuthEvent(provider: OAuthProvider, phase: OAuthPhase, ctx: OAuthContext): void {
  const payload: Record<string, unknown> = {
    service: "api",
    provider,
    phase,
    ...(ctx.workspaceId && { workspaceId: ctx.workspaceId }),
    ...(ctx.userId && { userId: ctx.userId }),
    ...(ctx.connectedAccountId && { connectedAccountId: ctx.connectedAccountId }),
    ...(ctx.externalId && { externalId: ctx.externalId }),
    ...(ctx.error ? { error: safeErrorMessage(ctx.error) } : {}),
  };

  const event = `oauth_${provider}_${phase}`;
  const level = phase === "error" ? "error" : "info";

  logger[level === "error" ? "error" : "info"](event, payload);

  addBreadcrumb("oauth", event, level === "error" ? "error" : "info", payload);
}

