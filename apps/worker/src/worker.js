import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@cliply/shared/env";
import { logger } from "@cliply/shared/logging/logger";
import { captureError, initSentry } from "@cliply/shared/sentry";
const env = getEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}
function parseInterval(raw, fallback) {
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
let reclaimTimer = null;
initSentry("worker");
async function heartbeatLoop() {
    while (!shuttingDown) {
        logger.info("worker_heartbeat", { service: "worker", worker_id: WORKER_ID });
        await sleep(HEARTBEAT_INTERVAL_MS);
    }
}
async function pollingLoop(supabase) {
    while (!shuttingDown) {
        const started = Date.now();
        try {
            await pollOnce(supabase);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown polling error";
            logger.error("tick_error", { service: "worker", worker_id: WORKER_ID }, { error: message });
        }
        const elapsed = Date.now() - started;
        const sleepMs = Math.max(POLL_INTERVAL_MS - elapsed, 100);
        await sleep(sleepMs);
    }
}
function createHandlerLogger(workerId) {
    return (entry, payload) => {
        const levelValue = typeof entry.level === "string" ? entry.level : "info";
        const eventValue = typeof entry.event === "string" ? entry.event : "handler_event";
        const { level, event, ...context } = entry;
        const merged = { service: "worker", worker_id: workerId, ...context };
        if (levelValue === "warn") {
            logger.warn(eventValue, merged, payload);
        }
        else if (levelValue === "error") {
            logger.error(eventValue, merged, payload);
        }
        else {
            logger.info(eventValue, merged, payload);
        }
    };
}
const handlers = {
    TRANSCRIBE: async ({ job, log }) => {
        log({ event: "handler_start", kind: "TRANSCRIBE", job_id: job.id, workspace_id: job.workspace_id });
        await sleep(1000);
        const result = { ok: true, message: "transcribed" };
        log({ event: "handler_done", kind: "TRANSCRIBE", job_id: job.id, workspace_id: job.workspace_id }, result);
        return { result };
    },
    HIGHLIGHT_DETECT: async ({ job, log }) => {
        log({ event: "handler_start", kind: "HIGHLIGHT_DETECT", job_id: job.id, workspace_id: job.workspace_id });
        await sleep(1000);
        const result = { ok: true, message: "highlights detected" };
        log({ event: "handler_done", kind: "HIGHLIGHT_DETECT", job_id: job.id, workspace_id: job.workspace_id }, result);
        return { result };
    },
    CLIP_RENDER: async ({ job, log }) => {
        log({ event: "handler_start", kind: "CLIP_RENDER", job_id: job.id, workspace_id: job.workspace_id });
        await sleep(1000);
        const result = { ok: true, message: "clip rendered" };
        log({ event: "handler_done", kind: "CLIP_RENDER", job_id: job.id, workspace_id: job.workspace_id }, result);
        return { result };
    },
    PUBLISH_TIKTOK: async ({ job, log }) => {
        log({ event: "handler_start", kind: "PUBLISH_TIKTOK", job_id: job.id, workspace_id: job.workspace_id });
        await sleep(1000);
        const result = { ok: true, message: "tiktok published" };
        log({ event: "handler_done", kind: "PUBLISH_TIKTOK", job_id: job.id, workspace_id: job.workspace_id }, result);
        return { result };
    },
    ANALYTICS_INGEST: async ({ job, log }) => {
        log({ event: "handler_start", kind: "ANALYTICS_INGEST", job_id: job.id, workspace_id: job.workspace_id });
        await sleep(1000);
        const result = { ok: true, message: "analytics ingested" };
        log({ event: "handler_done", kind: "ANALYTICS_INGEST", job_id: job.id, workspace_id: job.workspace_id }, result);
        return { result };
    },
};
async function reclaimStale(supabase, reason) {
    try {
        const { data, error } = await supabase.rpc("worker_reclaim_stale", {
            p_stale_seconds: STALE_SECONDS,
        });
        if (error) {
            throw error;
        }
        const reclaimed = typeof data === "number" ? data : 0;
        logger.info("reclaim_done", {
            service: "worker",
            worker_id: WORKER_ID,
            reason,
            stale_seconds: STALE_SECONDS,
        }, { reclaimed });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("reclaim_error", {
            service: "worker",
            worker_id: WORKER_ID,
            reason,
            stale_seconds: STALE_SECONDS,
        }, { error: message });
    }
}
async function processJob(supabase, job) {
    const jobStart = Date.now();
    const jobId = job.id;
    let heartbeatTimer = null;
    const kind = job.kind;
    const handlerLog = createHandlerLogger(WORKER_ID);
    const sendHeartbeat = async () => {
        try {
            await supabase.rpc("worker_heartbeat", {
                p_job_id: jobId,
                p_worker_id: WORKER_ID,
            });
            logger.info("heartbeat_sent", {
                service: "worker",
                worker_id: WORKER_ID,
                job_id: jobId,
                workspace_id: job.workspace_id,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn("heartbeat_error", { service: "worker", worker_id: WORKER_ID, job_id: jobId, workspace_id: job.workspace_id }, { error: message });
        }
    };
    heartbeatTimer = setInterval(() => {
        void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    void sendHeartbeat();
    try {
        const handler = handlers[kind];
        if (!handler) {
            throw new Error(`No handler registered for kind ${kind}`);
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
        logger.info("job_done", { service: "worker", worker_id: WORKER_ID, job_id: jobId, workspace_id: job.workspace_id }, { kind, elapsed_ms: Date.now() - jobStart });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = Number.isFinite(job.attempts) && job.attempts > 0 ? job.attempts : 1;
        const backoffSeconds = Math.min(2 ** (attempts - 1) * 10, 1800);
        handlerLog({
            event: "handler_failed",
            level: "error",
            kind,
            job_id: jobId,
            workspace_id: job.workspace_id,
            attempts,
            backoff_seconds: backoffSeconds,
        }, { error: message });
        try {
            await supabase.rpc("worker_fail", {
                p_job_id: jobId,
                p_worker_id: WORKER_ID,
                p_error: message,
                p_backoff_seconds: backoffSeconds,
            });
        }
        catch (rpcErr) {
            const rpcMessage = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
            logger.error("worker_fail_rpc_error", { service: "worker", worker_id: WORKER_ID, job_id: jobId }, { error: rpcMessage });
        }
        logger.error("job_failed", { service: "worker", worker_id: WORKER_ID, job_id: jobId, workspace_id: job.workspace_id }, { error: message, backoff_seconds: backoffSeconds, kind });
    }
    finally {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
        }
    }
}
async function pollOnce(supabase) {
    logger.info("tick", { service: "worker", worker_id: WORKER_ID });
    try {
        const { data: job, error } = await supabase.rpc("worker_claim_next_job", {
            p_worker_id: WORKER_ID,
        });
        if (error) {
            throw error;
        }
        if (job) {
            logger.info("job_claimed", {
                service: "worker",
                worker_id: WORKER_ID,
                job_id: job.id,
                workspace_id: job.workspace_id,
            }, {
                kind: job.kind,
                priority: job.priority,
                state: job.state,
            });
            await processJob(supabase, job);
        }
        else {
            logger.info("tick_idle", { service: "worker", worker_id: WORKER_ID });
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown claim error";
        logger.error("claim_error", { service: "worker", worker_id: WORKER_ID }, { error: message });
    }
}
function registerSignalHandlers() {
    const stop = (signal, error) => {
        if (shuttingDown)
            return;
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
async function main() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    logger.info("worker_boot", { service: "worker", worker_id: WORKER_ID }, {
        poll_ms: POLL_INTERVAL_MS,
        heartbeat_ms: HEARTBEAT_INTERVAL_MS,
        reclaim_ms: RECLAIM_INTERVAL_MS,
        stale_seconds: STALE_SECONDS,
    });
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
