import { captureError, initSentry as initSharedSentry } from "@cliply/shared/sentry";

let initialised = false;

function ensureInitialised(): void {
  if (!initialised) {
    initSharedSentry();
    initialised = true;
  }
}

export function initSentry(): void {
  ensureInitialised();
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  ensureInitialised();
  const err = error instanceof Error ? error : new Error(String(error));
  captureError(err, { service: "api", ...context });
}

ensureInitialised();
