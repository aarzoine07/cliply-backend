import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(environment?: string): void {
  if (initialized) return;
  
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("Sentry DSN not configured, skipping initialization");
    return;
  }
  
  Sentry.init({
    dsn,
    environment: environment || process.env.NODE_ENV || "development",
    tracesSampleRate: 1.0,
    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error && typeof error === "object" && "statusCode" in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        if (statusCode >= 400 && statusCode < 500) {
          return null;
        }
      }
      return event;
    },
  });
  
  console.log(`Sentry initialized (env: ${environment || process.env.NODE_ENV || "development"})`);
  initialized = true;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) {
    initSentry();
  }
  
  const err = error instanceof Error ? error : new Error(String(error));
  
  if (context) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, { value });
      });
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

export const log = (...args: unknown[]): void => console.log(...args);
