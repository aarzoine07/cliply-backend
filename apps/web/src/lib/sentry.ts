import { getEnv } from './env';

type Capture = (error: unknown, context?: Record<string, unknown>) => void;

let initialised = false;

export function initSentry(): void {
  if (initialised) return;
  const { SENTRY_DSN } = getEnv();
  if (SENTRY_DSN) {
    // Integrate @sentry/nextjs or other SDK here when ready.
    initialised = true;
  }
}

export const captureException: Capture = (_error, _context) => {
  // no-op until Sentry SDK is wired
};
