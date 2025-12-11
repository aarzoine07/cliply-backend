/**
 * Mock Engine Snapshot Helpers
 *
 * These helpers provide mock EngineMetricsSnapshot objects for testing.
 * They mirror the shape consumed by buildBackendReadinessReport(engineMetrics)
 * from packages/shared/src/readiness/backendReadiness.ts
 *
 * NOTE: These are pure mock objects and do NOT import from engine internals.
 */

/**
 * Shape of EngineMetricsSnapshot (mirrored from backendReadiness.ts)
 * This avoids importing from worker/engine internals.
 */
export type MockEngineMetricsSnapshot = {
  ffmpeg_ok: boolean;
  queue_length: number;
  oldest_job_age_ms: number | null;
  worker_ok: boolean;
};

/**
 * Returns a healthy engine metrics snapshot.
 * All systems operational, no queue backlog.
 */
export function mockHealthySnapshot(): MockEngineMetricsSnapshot {
  return {
    ffmpeg_ok: true,
    queue_length: 0,
    oldest_job_age_ms: null,
    worker_ok: true,
  };
}

/**
 * Returns an engine snapshot with FFmpeg in broken state.
 * Simulates FFmpeg binary unavailable or misconfigured.
 */
export function mockBrokenFFmpegSnapshot(): MockEngineMetricsSnapshot {
  return {
    ffmpeg_ok: false,
    queue_length: 0,
    oldest_job_age_ms: null,
    worker_ok: false,
  };
}

/**
 * Returns an engine snapshot with a stale queue.
 * Simulates jobs stuck in queue for over 5 minutes (300000ms).
 */
export function mockStaleQueueSnapshot(): MockEngineMetricsSnapshot {
  return {
    ffmpeg_ok: true,
    queue_length: 5,
    oldest_job_age_ms: 400_000, // 6+ minutes - beyond QUEUE_AGE_HARD_FAIL_MS
    worker_ok: true,
  };
}
