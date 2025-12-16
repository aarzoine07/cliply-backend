/**
 * Canonical response types for health/readiness endpoints.
 * These types define the standard contract that all health endpoints should follow.
 */

import type { BackendReadinessReport } from "@cliply/shared/readiness/backendReadiness";

/**
 * Canonical liveness response (healthz endpoint).
 * Fast check with zero external dependencies.
 */
export interface HealthzResponse {
  ok: boolean;
  service: string;
  ts: string; // ISO 8601 timestamp
}

/**
 * Canonical readiness check response structure.
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

export interface ReadinessQueue {
  length: number;
  oldestJobAge: number | null; // Age in seconds, or null if queue is empty
  warning?: boolean; // true if queue is backed up (>50 jobs or oldest >1 hour)
}

export interface ReadinessFfmpeg {
  ok: boolean;
  message?: string;
}

/**
 * Canonical public readiness response (readyz endpoint).
 */
export interface ReadyzResponse {
  ok: boolean;
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
 * Maps a BackendReadinessReport to the canonical ReadyzResponse shape.
 * Provides defensive defaults to ensure all required fields are present.
 *
 * @param report The readiness report from buildBackendReadinessReport()
 * @returns Canonical readiness response shape
 */
export function mapToReadyzResponse(report: BackendReadinessReport): ReadyzResponse {
  // Use provided checks if available (when includeDetailedHealth: true),
  // otherwise build from base report fields
  const checks: ReadinessCheck = report.checks ?? {
    db: {
      ok: report.db.ok,
      ...(report.db.error ? { message: report.db.error } : {}),
    },
    worker: {
      ok: report.worker?.ok ?? false,
      ...(report.worker && !report.worker.ok
        ? { message: `Worker env check failed: ${report.worker.missingEnv.join(", ")}` }
        : {}),
    },
  };

  // Use provided queue if available, otherwise provide defaults
  const queue: ReadinessQueue = report.queue ?? {
    length: 0,
    oldestJobAge: null,
  };

  // Use provided ffmpeg if available, otherwise build from worker status or defaults
  const ffmpeg: ReadinessFfmpeg = report.ffmpeg ?? {
    ok: report.worker?.ffmpegOk ?? false,
    ...(report.worker?.ffmpegOk === false
      ? { message: "FFmpeg binary not found or unavailable" }
      : {}),
  };

  return {
    ok: report.ok,
    checks,
    queue,
    ffmpeg,
  };
}

/**
 * Maps a BackendReadinessReport to the canonical AdminReadyzResponse shape.
 * Adds timestamp for admin/SRE tooling.
 *
 * @param report The readiness report from buildBackendReadinessReport()
 * @returns Canonical admin readiness response shape
 */
export function mapToAdminReadyzResponse(
  report: BackendReadinessReport,
): AdminReadyzResponse {
  const base = mapToReadyzResponse(report);
  return {
    ...base,
    timestamp: new Date().toISOString(),
  };
}

