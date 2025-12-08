import { setTimeout as sleep } from "node:timers/promises";
import { createClient, type PostgrestSingleResponse, type SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";
import { captureError, initSentry } from "@cliply/shared/sentry";
import { logJobStatus } from "@cliply/shared/observability/logging";

import { run as runTranscribe } from "./pipelines/transcribe";
import { run as runHighlightDetect } from "./pipelines/highlight-detect";
import { run as runClipRender } from "./pipelines/clip-render";
import { run as runThumbnail } from "./pipelines/thumbnail";
import { run as runPublishYouTube } from "./pipelines/publish-youtube";
import { run as runPublishTikTok } from "./pipelines/publish-tiktok";
import { run as runYouTubeDownload } from "./pipelines/youtube-download";
import { run as runCleanupStorage } from "./pipelines/cleanup-storage";
import type { Job, WorkerContext } from "./pipelines/types";
import { createStorageAdapter } from "./services/storage";
import { createQueueAdapter } from "./services/queue";
import { createLoggerAdapter } from "./services/logger";
import { createSentryAdapter } from "./services/sentry";
import { verifyWorkerEnvironment } from "./lib/envCheck";

const env = getEnv();

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

function parseInterval(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.trunc(parsed);
  }
  return fallback;
}

const POLL_INTERVAL_MS = parseInterval(env.WORKER_POLL_MS, 1000);
const HEARTBEAT_INTERVAL_MS = parseInterval(env.WORKER_HEARTBEAT_MS, 5000);
const RECLAIM_INTERVAL_MS = parseInterval(env.WORKER_RECLAIM_MS, 30_000);
const STALE_SECONDS = parseInterval(env.WORKER_STALE_SECONDS, 120);

const WORKER_ID = `${process.env.HOSTNAME ?? "local"}:${process.pid}:${Date.now()}`;

let shuttingDown = false;
let reclaimTimer: ReturnType<typeof setInterval> | null = null;

initSentry("worker");

async function heartbeatLoop(): Promise<void> {
  while (!shuttingDown) {
    logger.info("worker_heartbeat", { service: "worker", worker_id: WORKER_ID });
    await sleep(HEARTBEAT_INTERVAL_MS);
  }
}

async function pollingLoop(supabase: SupabaseClient): Promise<void> {
  while (!shuttingDown) {
    const started = Date.now();

    try {
      await pollOnce(supabase);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown polling error";
      logger.error(
        "tick_error",
        { service: "worker", worker_id: WORKER_ID },
        { error: message },
      );
    }

    const elapsed = Date.now() - started;
    const sleepMs = Math.max(POLL_INTERVAL_MS - elapsed, 100);
    await sleep(sleepMs);
  }
}

type WorkerJobClaim = {
  id: string;
  workspace_id: string;
  kind: string;
  priority: number;
  state: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

type HandlerLogFn = (entry: Record<string, unknown>, payload?: unknown) => void;

type HandlerContext = {
  job: WorkerJobClaim;
  supabase: SupabaseClient;
  workerId: string;
  log: HandlerLogFn;
};

type HandlerResult = {
  result?: Record<string, unknown>;
};

type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

function createHandlerLogger(workerId: string): HandlerLogFn {
  return (entry, payload) => {
    const levelValue = typeof entry.level === "string" ? entry.level : "info";
    const eventValue = typeof entry.event === "string" ? entry.event : "handler_event";
    const { level, event, ...context } = entry;
    const merged = { service: "worker", worker_id: workerId, ...context };

    if (levelValue === "warn") {
      logger.warn(eventValue, merged, payload);
    } else if (levelValue === "error") {
      logger.error(eventValue, merged, payload);
    } else {
      logger.info(eventValue, merged, payload);
    }
  };
}

/**
 * Creates a WorkerContext for pipeline execution.
 */
function createWorkerContext(supabase: SupabaseClient): WorkerContext {
  return {
    supabase,
    storage: createStorageAdapter(supabase),
    logger: createLoggerAdapter(),
    sentry: createSentryAdapter(),
    queue: createQueueAdapter(supabase),
  };
}

/**
 * Converts a WorkerJobClaim to a Job<unknown> for pipeline consumption.
 */
function jobClaimToJob(claim: WorkerJobClaim): Job<unknown> {
  return {
    id: claim.id,
    type: claim.kind,
    workspaceId: claim.workspace_id,
    payload: claim.payload,
    attempts: claim.attempts,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Real pipeline handlers that execute actual pipeline code.
 */
const handlers: Record<string, Handler> = {
  YOUTUBE_DOWNLOAD: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "YOUTUBE_DOWNLOAD", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runYouTubeDownload(pipelineJob, ctx);
    const result = { ok: true, message: "youtube video downloaded" };
    log({ event: "handler_done", kind: "YOUTUBE_DOWNLOAD", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  TRANSCRIBE: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "TRANSCRIBE", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runTranscribe(pipelineJob, ctx);
    const result = { ok: true, message: "transcribed" };
    log({ event: "handler_done", kind: "TRANSCRIBE", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  HIGHLIGHT_DETECT: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "HIGHLIGHT_DETECT", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runHighlightDetect(pipelineJob, ctx);
    const result = { ok: true, message: "highlights detected" };
    log({ event: "handler_done", kind: "HIGHLIGHT_DETECT", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  CLIP_RENDER: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "CLIP_RENDER", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runClipRender(pipelineJob, ctx);
    const result = { ok: true, message: "clip rendered" };
    log({ event: "handler_done", kind: "CLIP_RENDER", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  THUMBNAIL_GEN: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "THUMBNAIL_GEN", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runThumbnail(pipelineJob, ctx);
    const result = { ok: true, message: "thumbnail generated" };
    log({ event: "handler_done", kind: "THUMBNAIL_GEN", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  PUBLISH_YOUTUBE: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "PUBLISH_YOUTUBE", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runPublishYouTube(pipelineJob, ctx);
    const result = { ok: true, message: "youtube published" };
    log({ event: "handler_done", kind: "PUBLISH_YOUTUBE", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  PUBLISH_TIKTOK: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "PUBLISH_TIKTOK", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runPublishTikTok(pipelineJob, ctx);
    const result = { ok: true, message: "tiktok published" };
    log({ event: "handler_done", kind: "PUBLISH_TIKTOK", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
  CLEANUP_STORAGE: async ({ job, supabase, log }) => {
    log({ event: "handler_start", kind: "CLEANUP_STORAGE", job_id: job.id, workspace_id: job.workspace_id });
    const ctx = createWorkerContext(supabase);
    const pipelineJob = jobClaimToJob(job);
    await runCleanupStorage(pipelineJob, ctx);
    const result = { ok: true, message: "storage cleaned up" };
    log({ event: "handler_done", kind: "CLEANUP_STORAGE", job_id: job.id, workspace_id: job.workspace_id }, result);
    return { result };
  },
};

async function reclaimStale(supabase: SupabaseClient, reason: "boot" | "timer"): Promise<void> {
  try {
    const { data, error }: PostgrestSingleResponse<number | null> = await supabase.rpc("worker_reclaim_stale", {
      p_stale_seconds: STALE_SECONDS,
    });

    if (error) {
      throw error;
    }

    const reclaimed = typeof data === "number" ? data : 0;

    logger.info(
      "reclaim_done",
      {
        service: "worker",
        worker_id: WORKER_ID,
        reason,
        stale_seconds: STALE_SECONDS,
      },
      { reclaimed },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      "reclaim_error",
      {
        service: "worker",
        worker_id: WORKER_ID,
        reason,
        stale_seconds: STALE_SECONDS,
      },
      { error: message },
    );
  }
}

async function processJob(supabase: SupabaseClient, job: WorkerJobClaim): Promise<void> {
  const jobStart = Date.now();
  const jobId = job.id;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const kind = job.kind;
  const handlerLog = createHandlerLogger(WORKER_ID);

  const sendHeartbeat = async () => {
    try {
      const { data, error } = await supabase.rpc("worker_heartbeat", {
        p_job_id: jobId,
        p_worker_id: WORKER_ID,
      });

      if (error) {
        logger.warn("job_heartbeat_failed", {
          service: "worker",
          worker_id: WORKER_ID,
          job_id: jobId,
          workspace_id: job.workspace_id,
          kind,
          error: error.message,
        });
      } else if (data) {
        logger.info("job_heartbeat_sent", {
          service: "worker",
          worker_id: WORKER_ID,
          job_id: jobId,
          workspace_id: job.workspace_id,
          kind,
        });
      }
      // If data is null, job may have completed/failed - that's fine, no need to log
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("job_heartbeat_exception", {
        service: "worker",
        worker_id: WORKER_ID,
        job_id: jobId,
        workspace_id: job.workspace_id,
        kind,
        error: message,
      });
    }
  };

  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  void sendHeartbeat();

  try {
    // Log job start
    logJobStatus(
      { jobId, workspaceId: job.workspace_id, kind },
      "started",
      { workerId: WORKER_ID },
    );

    const handler = handlers[kind];
    if (!handler) {
      logger.warn(
        "unknown_job_kind",
        {
          service: "worker",
          worker_id: WORKER_ID,
          job_id: jobId,
          workspace_id: job.workspace_id,
          kind,
        },
        { message: `No handler registered for job kind: ${kind}` },
      );
      // Mark job as failed with a clear error message
      await supabase.rpc("worker_fail", {
        p_job_id: jobId,
        p_worker_id: WORKER_ID,
        p_error: `Unknown job kind: ${kind}`,
        p_backoff_seconds: 0,
      });
      logJobStatus(
        { jobId, workspaceId: job.workspace_id, kind },
        "failed",
        { error: `Unknown job kind: ${kind}` },
      );
      return;
    }

    const { result } = await handler({
      job,
      supabase,
      workerId: WORKER_ID,
      log: handlerLog,
    });

    const { error: finishError } = await supabase.rpc("worker_finish", {
      p_job_id: jobId,
      p_worker_id: WORKER_ID,
      p_result: result ?? {},
    });

    if (finishError) {
      throw finishError;
    }

    // Log job completion
    logJobStatus(
      { jobId, workspaceId: job.workspace_id, kind },
      "completed",
      { elapsedMs: Date.now() - jobStart },
    );

    logger.info(
      "job_done",
      { service: "worker", worker_id: WORKER_ID, job_id: jobId, workspace_id: job.workspace_id },
      { kind, elapsed_ms: Date.now() - jobStart },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = Number.isFinite(job.attempts) && job.attempts > 0 ? job.attempts : 1;
    const backoffSeconds = Math.min(2 ** (attempts - 1) * 10, 1800);

    // Log job failure/retry
    const status = attempts > 1 ? "retry" : "failed";
    logJobStatus(
      { jobId, workspaceId: job.workspace_id, kind },
      status,
      { attempts, backoffSeconds, error: message },
    );

    handlerLog(
      {
        event: "handler_failed",
        level: "error",
        kind,
        job_id: jobId,
        workspace_id: job.workspace_id,
        attempts,
        backoff_seconds: backoffSeconds,
      },
      { error: message },
    );

    try {
      const { data: failedJob, error: failError } = await supabase.rpc("worker_fail", {
        p_job_id: jobId,
        p_worker_id: WORKER_ID,
        p_error: message,
        p_backoff_seconds: backoffSeconds,
      });

      if (failError) {
        throw failError;
      }

      // Check if job was moved to dead_letter
      if (failedJob && failedJob.state === "dead_letter") {
        logger.error(
          "job_marked_dead",
          {
            service: "worker",
            worker_id: WORKER_ID,
            job_id: jobId,
            workspace_id: job.workspace_id,
            kind,
            attempts: failedJob.attempts,
            max_attempts: failedJob.max_attempts,
          },
          { error: message },
        );

        logJobStatus(
          { jobId, workspaceId: job.workspace_id, kind },
          "failed",
          { 
            attempts: failedJob.attempts, 
            max_attempts: failedJob.max_attempts, 
            error: message,
            dead_letter: true,  // Indicate this is a dead-letter failure
          },
        );
      }
    } catch (rpcErr) {
      const rpcMessage = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      logger.error(
        "worker_fail_rpc_error",
        { service: "worker", worker_id: WORKER_ID, job_id: jobId },
        { error: rpcMessage },
      );
    }

    logger.error(
      "job_failed",
      { service: "worker", worker_id: WORKER_ID, job_id: jobId, workspace_id: job.workspace_id },
      { error: message, backoff_seconds: backoffSeconds, kind },
    );
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

async function pollOnce(supabase: SupabaseClient): Promise<void> {
  logger.info("tick", { service: "worker", worker_id: WORKER_ID });

  try {
    const { data: job, error }: PostgrestSingleResponse<WorkerJobClaim | null> =
      await supabase.rpc("worker_claim_next_job", {
        p_worker_id: WORKER_ID,
      });

    if (error) {
      throw error;
    }

    if (job) {
      logger.info(
        "job_claimed",
        {
          service: "worker",
          worker_id: WORKER_ID,
          job_id: job.id,
          workspace_id: job.workspace_id,
        },
        {
          kind: job.kind,
          priority: job.priority,
          state: job.state,
        },
      );
      await processJob(supabase, job);
    } else {
      logger.info("tick_idle", { service: "worker", worker_id: WORKER_ID });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown claim error";
    logger.error(
      "claim_error",
      { service: "worker", worker_id: WORKER_ID },
      { error: message },
    );
  }
}

function registerSignalHandlers(): void {
  const stop = (signal: string, error?: unknown) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reclaimTimer) {
      clearInterval(reclaimTimer);
      reclaimTimer = null;
    }

    const message = error instanceof Error ? error.message : undefined;

    logger.warn("worker_stop", { service: "worker", worker_id: WORKER_ID, signal }, { error: message });

    setTimeout(() => {
      process.exit(message ? 1 : 0);
    }, 1000).unref();
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("uncaughtException", (err) => {
    captureError(err instanceof Error ? err : new Error(String(err)), {
      service: "worker",
      event: "uncaught_exception",
    });
    stop("uncaughtException", err instanceof Error ? err : undefined);
  });
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    captureError(error, {
      service: "worker",
      event: "unhandled_rejection",
    });
    stop("unhandledRejection", error);
  });
}

async function main(): Promise<void> {
  // Verify worker environment before proceeding
  const envStatus = await verifyWorkerEnvironment();

  // Fail fast if critical environment variables are missing
  if (!envStatus.ok) {
    const missing = envStatus.missingEnv.join(", ");
    throw new Error(
      `Worker environment check failed: missing required environment variables: ${missing}`,
    );
  }

  // Log warnings for missing binaries (but don't fail - let jobs fail if they need them)
  if (!envStatus.ffmpegOk) {
    logger.warn("worker_env_ffmpeg_missing", {
      service: "worker",
      message: "ffmpeg binary not found - rendering jobs will fail",
    });
  }

  if (!envStatus.ytDlpOk) {
    logger.warn("worker_env_ytdlp_missing", {
      service: "worker",
      message: "yt-dlp binary not found - YouTube download jobs will fail",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logger.info(
    "worker_boot",
    { service: "worker", worker_id: WORKER_ID },
    {
      poll_ms: POLL_INTERVAL_MS,
      heartbeat_ms: HEARTBEAT_INTERVAL_MS,
      reclaim_ms: RECLAIM_INTERVAL_MS,
      stale_seconds: STALE_SECONDS,
      ffmpegOk: envStatus.ffmpegOk,
      ytDlpOk: envStatus.ytDlpOk,
    },
  );

  registerSignalHandlers();

  await reclaimStale(supabase, "boot");

  reclaimTimer = setInterval(() => {
    void reclaimStale(supabase, "timer");
  }, RECLAIM_INTERVAL_MS);
  reclaimTimer.unref?.();

  await Promise.all([pollingLoop(supabase), heartbeatLoop()]);

  if (reclaimTimer) {
    clearInterval(reclaimTimer);
    reclaimTimer = null;
  }

  logger.info("worker_exit", { service: "worker", worker_id: WORKER_ID });
}

main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  captureError(err, { service: "worker", event: "worker_fatal" });
  logger.error("worker_fatal", { service: "worker", worker_id: WORKER_ID }, { error: err.message });
  process.exit(1);
});
