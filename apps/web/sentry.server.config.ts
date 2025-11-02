// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
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
  
  console.log(`[Web] Sentry initialized (env: ${process.env.NODE_ENV || "development"})`);
}
