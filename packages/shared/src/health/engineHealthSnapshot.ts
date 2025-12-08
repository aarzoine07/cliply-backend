/**
 * Engine Health Snapshot Helper (ME-I-09 / ER-04)
 * 
 * Provides a comprehensive health snapshot of the Cliply Machine engine:
 * - Queue depths by state and job kind
 * - Worker activity (active workers, last heartbeat)
 * - FFmpeg/yt-dlp availability
 * - Recent job errors
 * 
 * This is a read-only diagnostic helper that does not modify state.
 * It is designed to be consumed by admin endpoints and CLI tools.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Queue snapshot for a specific job kind or "ALL" aggregate
 */
export type QueueSnapshot = {
  /** Number of jobs ready to run (queued/pending state) */
  pending: number;
  /** Number of jobs currently being processed */
  running: number;
  /** Number of jobs in dead_letter state (exhausted retries) */
  deadLetter: number;
  /** Age in seconds of the oldest non-completed job, or null if none */
  oldestJobAgeSec: number | null;
};

/**
 * Worker activity snapshot based on recent heartbeats
 */
export type WorkerSnapshot = {
  /** Number of distinct workers seen recently (based on locked_by) */
  activeWorkers: number;
  /** ISO timestamp of most recent heartbeat, or null if none */
  lastHeartbeatAt: string | null;
};

/**
 * Recent job error record
 */
export type RecentError = {
  /** Job ID (UUID) */
  jobId: string;
  /** Job kind (TRANSCRIBE, CLIP_RENDER, etc.) */
  kind: string;
  /** Job state when error occurred (failed, dead_letter) */
  state: string;
  /** Error message from job.error or job.last_error */
  message: string | null;
  /** ISO timestamp when error occurred */
  occurredAt: string;
};

/**
 * Complete engine health snapshot
 */
export type EngineHealthSnapshot = {
  /** Overall health status (false if critical checks fail) */
  ok: boolean;
  /** Queue snapshots keyed by job kind, plus "ALL" aggregate */
  queues: {
    ALL: QueueSnapshot;
    [jobKind: string]: QueueSnapshot;
  };
  /** Worker activity metrics */
  workers: WorkerSnapshot;
  /** FFmpeg binary availability */
  ffmpegOk: boolean;
  /** yt-dlp binary availability (optional) */
  ytDlpOk?: boolean;
  /** Recent job errors (up to maxRecentErrors) */
  recentErrors: RecentError[];
};

/**
 * Options for getMachineHealthSnapshot
 */
export interface MachineHealthSnapshotOptions {
  /** Supabase client with service role permissions */
  supabase: SupabaseClient;
  /** Current time (for testing, defaults to Date.now()) */
  now?: Date;
  /** Time window in minutes for "recent" data (default: 60) */
  recentMinutes?: number;
  /** Maximum number of recent errors to return (default: 10) */
  maxRecentErrors?: number;
  /** Optional logger for internal diagnostics */
  logger?: {
    warn?: (event: string, context: Record<string, unknown>) => void;
  };
}

/**
 * Job state aggregation row from database
 */
interface JobStateAggregation {
  kind: string;
  state: string;
  count: number;
  oldest_created_at: string | null;
}

/**
 * Worker activity row from database
 */
interface WorkerActivityRow {
  locked_by: string;
  heartbeat_at: string | null;
}

/**
 * Recent error job row from database
 */
interface RecentErrorJobRow {
  id: string;
  kind: string;
  state: string;
  last_error: string | null;
  error: unknown;
  updated_at: string;
}

/**
 * Gets a comprehensive health snapshot of the Cliply Machine engine.
 * 
 * This function aggregates queue depths, worker activity, binary availability,
 * and recent errors into a single structured object suitable for monitoring
 * dashboards and health check endpoints.
 * 
 * @param options Configuration options
 * @returns Engine health snapshot
 * 
 * @example
 * const snapshot = await getMachineHealthSnapshot({
 *   supabase: serviceRoleClient,
 *   recentMinutes: 60,
 *   maxRecentErrors: 10,
 * });
 * 
 * console.log(`Queue depth: ${snapshot.queues.ALL.pending}`);
 * console.log(`Active workers: ${snapshot.workers.activeWorkers}`);
 * console.log(`FFmpeg available: ${snapshot.ffmpegOk}`);
 */
export async function getMachineHealthSnapshot(
  options: MachineHealthSnapshotOptions,
): Promise<EngineHealthSnapshot> {
  const {
    supabase,
    now = new Date(),
    recentMinutes = 60,
    maxRecentErrors = 10,
    logger,
  } = options;

  // Initialize default snapshot (fallback on errors)
  const defaultSnapshot: EngineHealthSnapshot = {
    ok: false,
    queues: {
      ALL: { pending: 0, running: 0, deadLetter: 0, oldestJobAgeSec: null },
    },
    workers: { activeWorkers: 0, lastHeartbeatAt: null },
    ffmpegOk: false,
    ytDlpOk: undefined,
    recentErrors: [],
  };

  try {
    // 1. Check FFmpeg and yt-dlp availability
    const [ffmpegOk, ytDlpOk] = await Promise.all([
      checkBinaryAvailable("ffmpeg"),
      checkBinaryAvailable("yt-dlp"),
    ]);

    // 2. Aggregate job states by kind
    const queues = await aggregateQueueStats(supabase, now);

    // 3. Estimate worker activity from recent heartbeats
    const workers = await estimateWorkerActivity(supabase, now, recentMinutes);

    // 4. Fetch recent job errors
    const recentErrors = await fetchRecentErrors(
      supabase,
      now,
      recentMinutes,
      maxRecentErrors,
    );

    // 5. Compute overall health status
    // Health is degraded if FFmpeg is not available or if there are many dead_letter jobs
    const ok =
      ffmpegOk &&
      (queues.ALL.deadLetter === 0 || queues.ALL.deadLetter < 100); // Threshold: < 100 DLQ jobs

    return {
      ok,
      queues,
      workers,
      ffmpegOk,
      ytDlpOk,
      recentErrors,
    };
  } catch (error) {
    // On any critical error, return default snapshot with error logged
    if (logger?.warn) {
      logger.warn("engine_health_snapshot_error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return defaultSnapshot;
  }
}

/**
 * Checks if a binary is available on the system PATH.
 * 
 * @param binaryName Name of the binary (e.g., "ffmpeg", "yt-dlp")
 * @returns true if binary is available, false otherwise
 */
async function checkBinaryAvailable(binaryName: string): Promise<boolean> {
  try {
    await execFileAsync(binaryName, ["--version"], {
      timeout: 5000,
      // Suppress stdout/stderr
      encoding: "utf8",
    });
    return true;
  } catch (error) {
    // ENOENT means binary not found
    const isNotFound = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    if (isNotFound) {
      return false;
    }
    // Other errors (timeout, permission, etc.) mean binary exists but command failed
    // Still mark as available since the binary is present
    return true;
  }
}

/**
 * Aggregates job queue statistics by state and kind.
 * 
 * @param supabase Supabase client
 * @param now Current time
 * @returns Queue snapshots keyed by job kind, plus "ALL" aggregate
 */
async function aggregateQueueStats(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ ALL: QueueSnapshot; [kind: string]: QueueSnapshot }> {
  // Query all non-completed jobs, grouped by kind and state
  // We use a single aggregation query for efficiency
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("kind, state, created_at")
    .not("state", "in", "(done,completed,succeeded)")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch job stats: ${error.message}`);
  }

  const jobs = rows || [];

  // Build per-kind snapshots
  const snapshotsByKind: Record<string, QueueSnapshot> = {};

  // Initialize counters
  const kindCounts: Record<
    string,
    { pending: number; running: number; deadLetter: number; oldestCreatedAt: Date | null }
  > = {};

  for (const job of jobs) {
    const kind = job.kind || "UNKNOWN";
    const state = job.state || "queued";

    if (!kindCounts[kind]) {
      kindCounts[kind] = {
        pending: 0,
        running: 0,
        deadLetter: 0,
        oldestCreatedAt: null,
      };
    }

    // Categorize by state
    if (state === "queued" || state === "pending") {
      kindCounts[kind].pending += 1;
    } else if (state === "processing" || state === "running") {
      kindCounts[kind].running += 1;
    } else if (state === "dead_letter") {
      kindCounts[kind].deadLetter += 1;
    }

    // Track oldest job
    const createdAt = job.created_at ? new Date(job.created_at) : null;
    if (createdAt) {
      if (
        !kindCounts[kind].oldestCreatedAt ||
        createdAt < kindCounts[kind].oldestCreatedAt!
      ) {
        kindCounts[kind].oldestCreatedAt = createdAt;
      }
    }
  }

  // Convert to QueueSnapshot format
  for (const [kind, counts] of Object.entries(kindCounts)) {
    const oldestJobAgeSec = counts.oldestCreatedAt
      ? Math.floor((now.getTime() - counts.oldestCreatedAt.getTime()) / 1000)
      : null;

    snapshotsByKind[kind] = {
      pending: counts.pending,
      running: counts.running,
      deadLetter: counts.deadLetter,
      oldestJobAgeSec,
    };
  }

  // Compute "ALL" aggregate
  const allAggregate: QueueSnapshot = {
    pending: 0,
    running: 0,
    deadLetter: 0,
    oldestJobAgeSec: null,
  };

  let oldestOverallCreatedAt: Date | null = null;

  for (const counts of Object.values(kindCounts)) {
    allAggregate.pending += counts.pending;
    allAggregate.running += counts.running;
    allAggregate.deadLetter += counts.deadLetter;

    if (counts.oldestCreatedAt) {
      if (!oldestOverallCreatedAt || counts.oldestCreatedAt < oldestOverallCreatedAt) {
        oldestOverallCreatedAt = counts.oldestCreatedAt;
      }
    }
  }

  if (oldestOverallCreatedAt) {
    allAggregate.oldestJobAgeSec = Math.floor(
      (now.getTime() - oldestOverallCreatedAt.getTime()) / 1000,
    );
  }

  return {
    ALL: allAggregate,
    ...snapshotsByKind,
  };
}

/**
 * Estimates worker activity based on recent job heartbeats.
 * 
 * @param supabase Supabase client
 * @param now Current time
 * @param recentMinutes Time window for "recent" activity
 * @returns Worker activity snapshot
 */
async function estimateWorkerActivity(
  supabase: SupabaseClient,
  now: Date,
  recentMinutes: number,
): Promise<WorkerSnapshot> {
  // Calculate cutoff time for "recent" activity
  const cutoffTime = new Date(now.getTime() - recentMinutes * 60 * 1000);

  // Query jobs with recent heartbeats
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("locked_by, heartbeat_at")
    .not("locked_by", "is", null)
    .not("heartbeat_at", "is", null)
    .gte("heartbeat_at", cutoffTime.toISOString())
    .order("heartbeat_at", { ascending: false });

  if (error) {
    // If heartbeat_at column doesn't exist or query fails, return empty snapshot
    return {
      activeWorkers: 0,
      lastHeartbeatAt: null,
    };
  }

  const jobs = (rows || []) as WorkerActivityRow[];

  if (jobs.length === 0) {
    return {
      activeWorkers: 0,
      lastHeartbeatAt: null,
    };
  }

  // Count distinct workers
  const distinctWorkers = new Set(
    jobs.filter((j) => j.locked_by).map((j) => j.locked_by),
  );

  // Find most recent heartbeat
  const mostRecentHeartbeat = jobs.reduce((latest, job) => {
    if (!job.heartbeat_at) return latest;
    if (!latest) return job.heartbeat_at;
    return job.heartbeat_at > latest ? job.heartbeat_at : latest;
  }, null as string | null);

  return {
    activeWorkers: distinctWorkers.size,
    lastHeartbeatAt: mostRecentHeartbeat,
  };
}

/**
 * Fetches recent job errors from failed and dead_letter jobs.
 * 
 * @param supabase Supabase client
 * @param now Current time
 * @param recentMinutes Time window for "recent" errors
 * @param maxErrors Maximum number of errors to return
 * @returns List of recent errors
 */
async function fetchRecentErrors(
  supabase: SupabaseClient,
  now: Date,
  recentMinutes: number,
  maxErrors: number,
): Promise<RecentError[]> {
  // Calculate cutoff time for "recent" errors
  const cutoffTime = new Date(now.getTime() - recentMinutes * 60 * 1000);

  // Query failed and dead_letter jobs within time window
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("id, kind, state, last_error, error, updated_at")
    .in("state", ["failed", "dead_letter"])
    .gte("updated_at", cutoffTime.toISOString())
    .order("updated_at", { ascending: false })
    .limit(maxErrors);

  if (error) {
    // On query error, return empty list rather than failing
    return [];
  }

  const jobs = (rows || []) as RecentErrorJobRow[];

  return jobs.map((job) => {
    // Extract error message from structured error or legacy last_error field
    let message: string | null = null;

    if (job.error && typeof job.error === "object") {
      // Try to extract message from structured error jsonb
      const errorObj = job.error as Record<string, unknown>;
      if (typeof errorObj.message === "string") {
        message = errorObj.message;
      } else if (typeof errorObj.error === "string") {
        message = errorObj.error;
      }
    }

    // Fallback to last_error if no structured error
    if (!message && job.last_error) {
      message = job.last_error;
    }

    return {
      jobId: job.id,
      kind: job.kind || "UNKNOWN",
      state: job.state || "failed",
      message,
      occurredAt: job.updated_at || now.toISOString(),
    };
  });
}

