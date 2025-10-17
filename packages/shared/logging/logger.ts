import util from "util";

import { getEnv } from "@cliply/shared/env";

const SECRET_PATTERNS = [/key/i, /token/i, /secret/i, /password/i, /authorization/i, /bearer/i];

type LogLevel = "info" | "warn" | "error";

type Primitive = string | number | boolean | null | undefined;
type Redactable = Primitive | Redactable[] | { [key: string]: Redactable };

type NormalisedEntry = {
  ts: string;
  service: string;
  event: string;
  workspaceId?: string;
  jobId?: string;
  message?: string;
  error?: string;
  meta: Record<string, unknown>;
  level: LogLevel;
  force: boolean;
};

type LogObserverPayload = {
  level: LogLevel;
  entry: Omit<NormalisedEntry, "level" | "force">;
};

type LogObserver = (payload: LogObserverPayload) => void;

const observers = new Set<LogObserver>();

const SAMPLE_RATE = (() => {
  const env = getEnv();
  const rate = Number(env.LOG_SAMPLE_RATE ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(Math.max(rate, 0), 1);
})();

function redact(value: Redactable, keyHint?: string): Redactable {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as Redactable[];
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
    const out: Record<string, Redactable> = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(child, key);
      }
    }
    return out;
  }

  return value;
}

export interface LogEntry {
  service?: "api" | "worker" | "shared" | string;
  event: string;
  ts?: string;
  workspaceId?: string;
  jobId?: string;
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
  level?: "info" | "warn" | "error";
  force?: boolean;
}

function normaliseEntry(entry: LogEntry): NormalisedEntry {
  const ts = entry.ts ?? new Date().toISOString();
  const service = entry.service ?? "shared";
  const event = entry.event;
  const workspaceId = entry.workspaceId;
  const jobId = entry.jobId;
  const message = entry.message;
  const error = entry.error;
  const level = entry.level ?? (event.toLowerCase().includes("error") || event.toLowerCase().includes("fail") ? "error" : "info");
  const meta = entry.meta ?? {};
  const force = Boolean(entry.force);

  return { ts, service, event, workspaceId, jobId, message, error, meta, level, force };
}

function shouldSample(event: string, level: LogLevel, force: boolean): boolean {
  if (force) return true;
  if (level !== "info") return true;
  if (/reclaim/i.test(event)) return true;
  if (SAMPLE_RATE >= 1) return true;
  if (SAMPLE_RATE <= 0) return false;
  return Math.random() < SAMPLE_RATE;
}

export function log(entry: LogEntry): void {
  const normalised = normaliseEntry(entry);
  const { level, force, ...rest } = normalised;

  if (!shouldSample(rest.event, level, force)) {
    return;
  }

  const safe = redact(rest) as Omit<NormalisedEntry, "level" | "force">;

  const output: Record<string, unknown> = {
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
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  for (const observer of observers) {
    try {
      observer({ level, entry: safe });
    } catch {
      // observers must never disrupt logging; swallow errors silently.
    }
  }
}

type LegacyLevel = "info" | "warn" | "error";

function extractKnownFields(context: Record<string, unknown> | undefined) {
  if (!context) return { service: undefined, workspaceId: undefined, jobId: undefined, message: undefined, error: undefined, meta: {} as Record<string, unknown> };

  const service = (context.service as string | undefined) ?? undefined;
  const workspaceId =
    (context.workspaceId as string | undefined) ??
    (context.workspace_id as string | undefined);
  const jobId =
    (context.jobId as string | undefined) ?? (context.job_id as string | undefined);
  const message = context.message as string | undefined;
  const error = context.error as string | undefined;

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (
      key === "service" ||
      key === "workspaceId" ||
      key === "workspace_id" ||
      key === "jobId" ||
      key === "job_id" ||
      key === "message" ||
      key === "error"
    ) {
      continue;
    }
    meta[key] = value;
  }

  return { service, workspaceId, jobId, message, error, meta };
}

function legacyLog(level: LegacyLevel, event: string, context?: Record<string, unknown>, meta?: unknown) {
  const extracted = extractKnownFields(context);
  const mergedMeta: Record<string, unknown> = {
    ...extracted.meta,
  };

  if (meta && typeof meta === "object") {
    Object.assign(mergedMeta, meta as Record<string, unknown>);
  } else if (meta !== undefined) {
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

export const logger = {
  info: (event: string, context?: Record<string, unknown>, meta?: unknown) =>
    legacyLog("info", event, context, meta),
  warn: (event: string, context?: Record<string, unknown>, meta?: unknown) =>
    legacyLog("warn", event, context, meta),
  error: (event: string, context?: Record<string, unknown>, meta?: unknown) =>
    legacyLog("error", event, context, meta),
};

export function pretty(value: unknown): string {
  return util.inspect(value, { depth: 6, colors: true });
}

export function onLog(observer: LogObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

export type { LogObserverPayload };
