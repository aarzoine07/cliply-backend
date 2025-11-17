// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
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
                const statusCode = error.statusCode;
                // Filter out client errors (4xx)
                if (statusCode >= 400 && statusCode < 500) {
                    return null;
                }
            }
            return event;
        },
    });
    console.log(`[Web/Edge] Sentry initialized (env: ${process.env.NODE_ENV || "development"})`);
}
