// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",

    // Force-enable and show debug logs for diagnostics
    debug: true,
    enabled: true,
    shutdownTimeout: 5000,

    // Define how likely traces are sampled.
    tracesSampleRate: 1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Disable sending user PII
    sendDefaultPii: false,

    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error && typeof error === "object" && "statusCode" in error) {
        const statusCode = (error as { statusCode: number }).statusCode;
        // Filter out client errors (4xx)
        if (statusCode >= 400 && statusCode < 500) {
          return null;
        }
      }
      return event;
    },
  });

  console.log(
    `[Web] Sentry initialized (env: ${process.env.NODE_ENV || "development"})`
  );
}
console.log("[DEBUG] sentry.server.config.ts loaded");
