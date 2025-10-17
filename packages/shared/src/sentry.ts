import * as Sentry from "@sentry/node";

import { getEnv } from "@cliply/shared/env";
import { log } from "@cliply/shared/logger";
import { onLog, type LogObserverPayload } from "@cliply/shared/logging/logger";

let initialised = false;
let enabled = false;
let unsubscribeLog: (() => void) | null = null;
let suppressLogObserver = 0;

const ERROR_EVENT_PATTERN = /(error|fail)/i;

function registerLogObserver(): void {
  if (unsubscribeLog) return;

  unsubscribeLog = onLog((payload: LogObserverPayload) => {
    if (suppressLogObserver > 0) return;
    if (!enabled) return;

    const eventName = payload.entry.event.toLowerCase();
    if (payload.entry.event === "error_captured") return;
    if (!ERROR_EVENT_PATTERN.test(eventName)) return;

    try {
      const message = payload.entry.message ?? payload.entry.event;
      Sentry.captureException(new Error(message), {
        tags: {
          service: payload.entry.service,
          level: payload.level,
        },
        extra: {
          ...payload.entry.meta,
          workspaceId: payload.entry.workspaceId,
          jobId: payload.entry.jobId,
          event: payload.entry.event,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log({
        service: "shared",
        event: "sentry_capture_failed",
        message: err.message,
        meta: { stage: "log_observer" },
      });
    }
  });
}

export function initSentry(): void {
  if (initialised) return;
  initialised = true;

  const { SENTRY_DSN } = getEnv();

  registerLogObserver();

  if (!SENTRY_DSN) {
    log({
      service: "shared",
      event: "sentry_disabled",
      message: "No SENTRY_DSN provided",
    });
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 1.0,
      environment: process.env.NODE_ENV || "development",
    });
    enabled = true;
    log({ service: "shared", event: "sentry_initialized" });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    enabled = false;
    log({
      service: "shared",
      event: "sentry_init_failed",
      message: err.message,
    });
  }
}

export function captureError(error: Error | string, context?: Record<string, unknown>): void {
  const errObj = typeof error === "string" ? new Error(error) : error;

  if (enabled) {
    try {
      Sentry.captureException(errObj, {
        tags: {
          service: (context?.service as string | undefined) ?? "shared",
        },
        extra: context,
      });
    } catch (captureErr) {
      const captureErrorObj = captureErr instanceof Error ? captureErr : new Error(String(captureErr));
      log({
        service: "shared",
        event: "sentry_capture_failed",
        message: captureErrorObj.message,
        meta: { stage: "captureError" },
      });
    }
  }

  suppressLogObserver += 1;
  log({
    service: (context?.service as string | undefined) ?? "shared",
    event: "error_captured",
    message: errObj.message,
    meta: context,
    level: "error",
  });
  suppressLogObserver = Math.max(0, suppressLogObserver - 1);
}
