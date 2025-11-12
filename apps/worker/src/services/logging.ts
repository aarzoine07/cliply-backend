import { logger } from "@cliply/shared/logging/logger";

export function logEvent(jobId: string, event: string, meta?: Record<string, unknown>): void {
  logger.info(event, { service: "worker", jobId }, meta);
}

