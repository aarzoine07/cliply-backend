import { captureError } from "@cliply/shared/sentry";

import type { SentryAdapter } from "../pipelines/types";

/**
 * Sentry adapter that wraps the shared Sentry client for pipeline use.
 */
export function createSentryAdapter(): SentryAdapter {
  return {
    captureException(
      error: unknown,
      context?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
    ): void {
      const err = error instanceof Error ? error : new Error(String(error));
      captureError(err, {
        service: "worker",
        ...context?.tags,
        ...context?.extra,
      });
    },
  };
}

