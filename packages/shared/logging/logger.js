"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.log = log;
exports.pretty = pretty;
exports.onLog = onLog;
const util_1 = __importDefault(require("util"));
const env_1 = require("../env");
const SECRET_PATTERNS = [/key/i, /token/i, /secret/i, /password/i, /authorization/i, /bearer/i];
const observers = new Set();
const SAMPLE_RATE = (() => {
    const env = (0, env_1.getEnv)();
    const rate = Number(env.LOG_SAMPLE_RATE ?? 1);
    if (!Number.isFinite(rate) || rate <= 0)
        return 0;
    return Math.min(Math.max(rate, 0), 1);
})();
function redact(value, keyHint) {
    if (Array.isArray(value)) {
        return value.map((item) => redact(item));
    }
    if (typeof value === "string") {
        if (keyHint === "event" || keyHint === "service") {
            return value;
        }
        if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
            return "[REDACTED]";
        }
        return value;
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, child] of Object.entries(value)) {
            if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
                out[key] = "[REDACTED]";
            }
            else {
                out[key] = redact(child, key);
            }
        }
        return out;
    }
    return value;
}
function normaliseEntry(entry) {
    const ts = entry.ts ?? new Date().toISOString();
    const service = entry.service ?? "shared";
    const event = entry.event;
    const workspaceId = entry.workspaceId;
    const jobId = entry.jobId;
    const message = entry.message;
    const error = entry.error;
    const level = entry.level ??
        (event.toLowerCase().includes("error") || event.toLowerCase().includes("fail")
            ? "error"
            : "info");
    const meta = entry.meta ?? {};
    const force = Boolean(entry.force);
    return { ts, service, event, workspaceId, jobId, message, error, meta, level, force };
}
function shouldSample(event, level, force) {
    if (force)
        return true;
    if (level !== "info")
        return true;
    if (/reclaim/i.test(event))
        return true;
    if (SAMPLE_RATE >= 1)
        return true;
    if (SAMPLE_RATE <= 0)
        return false;
    return Math.random() < SAMPLE_RATE;
}
function log(entry) {
    const normalised = normaliseEntry(entry);
    const { level, force, ...rest } = normalised;
    if (!shouldSample(rest.event, level, force)) {
        return;
    }
    const safe = redact(rest);
    const output = {
        ts: safe.ts,
        service: safe.service,
        event: safe.event,
        workspaceId: safe.workspaceId ?? undefined,
        jobId: safe.jobId ?? undefined,
        message: safe.message ?? undefined,
        error: safe.error ?? undefined,
        meta: Object.keys(safe.meta ?? {}).length > 0 ? safe.meta : undefined,
    };
    const line = JSON.stringify(output);
    if (level === "error") {
        console.error(line);
    }
    else if (level === "warn") {
        console.warn(line);
    }
    else {
        console.log(line);
    }
    for (const observer of observers) {
        try {
            observer({ level, entry: safe });
        }
        catch {
            // observers must never disrupt logging; swallow errors silently.
        }
    }
}
function extractKnownFields(context) {
    if (!context)
        return {
            service: undefined,
            workspaceId: undefined,
            jobId: undefined,
            message: undefined,
            error: undefined,
            meta: {},
        };
    const service = context.service ?? undefined;
    const workspaceId = context.workspaceId ?? context.workspace_id;
    const jobId = context.jobId ?? context.job_id;
    const message = context.message;
    const error = context.error;
    const meta = {};
    for (const [key, value] of Object.entries(context)) {
        if (key === "service" ||
            key === "workspaceId" ||
            key === "workspace_id" ||
            key === "jobId" ||
            key === "job_id" ||
            key === "message" ||
            key === "error") {
            continue;
        }
        meta[key] = value;
    }
    return { service, workspaceId, jobId, message, error, meta };
}
function legacyLog(level, event, context, meta) {
    const extracted = extractKnownFields(context);
    const mergedMeta = {
        ...extracted.meta,
    };
    if (meta && typeof meta === "object") {
        Object.assign(mergedMeta, meta);
    }
    else if (meta !== undefined) {
        mergedMeta.payload = meta;
    }
    log({
        service: extracted.service ?? "shared",
        event,
        workspaceId: extracted.workspaceId,
        jobId: extracted.jobId,
        message: extracted.message,
        error: extracted.error,
        meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
        level,
        force: level !== "info",
    });
}
exports.logger = {
    info: (event, context, meta) => legacyLog("info", event, context, meta),
    warn: (event, context, meta) => legacyLog("warn", event, context, meta),
    error: (event, context, meta) => legacyLog("error", event, context, meta),
};
function pretty(value) {
    return util_1.default.inspect(value, { depth: 6, colors: true });
}
function onLog(observer) {
    observers.add(observer);
    return () => {
        observers.delete(observer);
    };
}
//# sourceMappingURL=logger.js.map