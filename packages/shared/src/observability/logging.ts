/**
 * Shared observability helpers for structured logging and Sentry breadcrumbs.
 * 
 * These helpers provide consistent logging across jobs, pipelines, billing, and OAuth flows,
 * with automatic Sentry breadcrumb recording when Sentry is available.
 * 
 * Safety: Never logs secrets (tokens, keys, etc.) - only safe identifiers.
 */

import { logger } from "@cliply/shared/logging/logger";

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

// Dynamic Sentry import for better testability  
// Using a getter function so tests can mock it more easily
function getSentryModule(): typeof import("@sentry/node") | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@sentry/node");
  } catch {
    return undefined;
  }
}

/**
 * Adds a Sentry breadcrumb if Sentry is available.
 * Silently fails if Sentry is not configured.
 * 
 * Internal helper - calls through to Sentry's addBreadcrumb.
 */
function addBreadcrumb(
  category: string,
  message: string,
  level: "info" | "warning" | "error",
  data?: Record<string, unknown>,
): void {
  const sentry = getSentryModule();
  if (sentry && typeof sentry.addBreadcrumb === "function") {
    sentry.addBreadcrumb({
      category,
      message,
      level,
      data: data || {},
      timestamp: Date.now() / 1000,
    });
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
  
  // Call logger methods explicitly so Vitest mocks work correctly
  if (status === "failed") {
    logger.error(event, payload);
    addBreadcrumb("job", event, "error", payload);
  } else if (status === "retry") {
    logger.warn(event, payload);
    addBreadcrumb("job", event, "warning", payload);
  } else {
    logger.info(event, payload);
    addBreadcrumb("job", event, "info", payload);
  }
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
  
  // Call logger methods explicitly so Vitest mocks work correctly
  if (phase === "error") {
    logger.error(event, payload);
    addBreadcrumb("pipeline", event, "error", payload);
  } else {
    logger.info(event, payload);
    addBreadcrumb("pipeline", event, "info", payload);
  }
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
  
  // Call logger methods explicitly so Vitest mocks work correctly
  if (ctx.error) {
    logger.error(event, payload);
    addBreadcrumb("stripe", event, "error", payload);
  } else {
    logger.info(event, payload);
    addBreadcrumb("stripe", event, "info", payload);
  }
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
  
  // Call logger methods explicitly so Vitest mocks work correctly
  if (phase === "error") {
    logger.error(event, payload);
    addBreadcrumb("oauth", event, "error", payload);
  } else {
    logger.info(event, payload);
    addBreadcrumb("oauth", event, "info", payload);
  }
}

