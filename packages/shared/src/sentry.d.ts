export declare function initSentry(environment?: string): void;
export declare function captureError(error: unknown, context?: Record<string, unknown>): void;
export declare const log: (...args: unknown[]) => void;
