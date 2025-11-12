// packages/shared/sentry.ts
import * as Sentry from "@sentry/node";

export function initSentry(dsn?: string) {
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
  });
}

export function captureError(error: unknown, context?: Record<string, any>) {
  if (context) Sentry.setContext("context", context);
  Sentry.captureException(error);
}

export { Sentry };
