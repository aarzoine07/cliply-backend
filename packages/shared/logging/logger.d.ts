export type LogLevel = "info" | "warn" | "error";
export interface LogContext {
    workspace_id?: string;
    user_id?: string;
    request_id?: string;
    [key: string]: unknown;
}
/**
 * Structured logger API — lightweight JSON logger with auto-redaction.
 */
export declare const logger: {
    info: (message: string, context?: LogContext, payload?: unknown) => void;
    warn: (message: string, context?: LogContext, payload?: unknown) => void;
    error: (message: string, context?: LogContext, payload?: unknown) => void;
};
/**
 * Example usage:
 * logger.info('Render job started', { workspace_id }, { job_id, clip_count });
 * logger.error('Stripe webhook failed', { request_id }, { error });
 */
