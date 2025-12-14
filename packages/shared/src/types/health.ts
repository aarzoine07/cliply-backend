/**
 * Shared TypeScript types for health/readiness endpoint responses.
 * These types define the standard contract that all health endpoints should follow.
 */

/**
 * Common base fields shared across health endpoints.
 */
export interface HealthBase {
  ok: boolean;
}

/**
 * Canonical liveness response (healthz endpoint).
 * Fast check with zero external dependencies.
 */
export interface HealthzResponse extends HealthBase {
  service: string;
  ts: string; // ISO 8601 timestamp
}

/**
 * Readiness check structure for individual components.
 */
export interface ReadinessCheck {
  db: {
    ok: boolean;
    message?: string;
  };
  worker: {
    ok: boolean;
    message?: string;
  };
}

/**
 * Queue status in readiness response.
 */
export interface ReadinessQueue {
  length: number;
  oldestJobAge: number | null; // Age in seconds, or null if queue is empty
  warning?: boolean; // true if queue is backed up (>50 jobs or oldest >1 hour)
}

/**
 * FFmpeg status in readiness response.
 */
export interface ReadinessFfmpeg {
  ok: boolean;
  message?: string;
}

/**
 * Canonical public readiness response (readyz endpoint).
 */
export interface ReadyzResponse extends HealthBase {
  checks: ReadinessCheck;
  queue: ReadinessQueue;
  ffmpeg: ReadinessFfmpeg;
}

/**
 * Canonical admin readiness response (admin/readyz endpoint).
 * Extends public readiness with timestamp for SRE/admin tooling.
 */
export interface AdminReadyzResponse extends ReadyzResponse {
  timestamp: string; // ISO 8601 timestamp
}

/**
 * Error response shape for health/readiness endpoints.
 * Used for 405 (method not allowed) and 500 (internal error) responses.
 */
export interface HealthErrorResponse {
  ok: false;
  error: {
    message: string;
  };
}

