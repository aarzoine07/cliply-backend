import { logger as sharedLogger } from "@cliply/shared/logging/logger";

import type { LoggerLike } from "../pipelines/types";

/**
 * Logger adapter that wraps the shared logger for pipeline use.
 */
export function createLoggerAdapter(): LoggerLike {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      sharedLogger.info(message, { ...context, level: "debug" });
    },
    info(message: string, context?: Record<string, unknown>): void {
      sharedLogger.info(message, context);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      sharedLogger.warn(message, context);
    },
    error(message: string, context?: Record<string, unknown>): void {
      sharedLogger.error(message, context);
    },
  };
}

