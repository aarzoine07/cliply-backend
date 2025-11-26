type LogLevel = "info" | "warn" | "error";
type NormalisedEntry = {
    ts: string;
    service: string;
    event: string;
    workspaceId?: string;
    jobId?: string;
    message?: string;
    error?: string;
    meta: Record<string, unknown>;
    level: LogLevel;
    force: boolean;
};
type LogObserverPayload = {
    level: LogLevel;
    entry: Omit<NormalisedEntry, "level" | "force">;
};
type LogObserver = (payload: LogObserverPayload) => void;
export interface LogEntry {
    service?: "api" | "worker" | "shared" | string;
    event: string;
    ts?: string;
    workspaceId?: string;
    jobId?: string;
    message?: string;
    error?: string;
    meta?: Record<string, unknown>;
    level?: "info" | "warn" | "error";
    force?: boolean;
}
export declare function log(entry: LogEntry): void;
export declare const logger: {
    info: (event: string, context?: Record<string, unknown>, meta?: unknown) => void;
    warn: (event: string, context?: Record<string, unknown>, meta?: unknown) => void;
    error: (event: string, context?: Record<string, unknown>, meta?: unknown) => void;
};
export declare function pretty(value: unknown): string;
export declare function onLog(observer: LogObserver): () => void;
export type { LogObserverPayload };
//# sourceMappingURL=logger.d.ts.map