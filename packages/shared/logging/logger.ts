import { redactSensitive } from "@cliply/shared/logging/redactSensitive";

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  workspace_id?: string;
  user_id?: string;
  request_id?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context: LogContext = {}, payload?: unknown) {
  const safePayload = payload ? redactSensitive(payload) : undefined;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
    ...(safePayload ? { payload: safePayload } : {}),
  };

  const line = JSON.stringify(entry);
  switch (level) {
    case "info":
      console.log(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

/**
 * Structured logger API — lightweight JSON logger with auto-redaction.
 */
export const logger = {
  info: (message: string, context?: LogContext, payload?: unknown) =>
    formatLog("info", message, context, payload),
  warn: (message: string, context?: LogContext, payload?: unknown) =>
    formatLog("warn", message, context, payload),
  error: (message: string, context?: LogContext, payload?: unknown) =>
    formatLog("error", message, context, payload),
};

/**
 * Example usage:
 * logger.info('Render job started', { workspace_id }, { job_id, clip_count });
 * logger.error('Stripe webhook failed', { request_id }, { error });
 */
