/** HTTP error helper types for API routes and worker surfaces */
export declare class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details?: unknown;
    constructor(status: number, message: string, code?: string, details?: unknown);
}
/** Factory helpers */
export declare const errBadRequest: (msg?: string, details?: unknown) => HttpError;
export declare const errUnauthorized: (msg?: string, details?: unknown) => HttpError;
export declare const errForbidden: (msg?: string, details?: unknown) => HttpError;
export declare const errNotFound: (msg?: string, details?: unknown) => HttpError;
export declare const errConflict: (msg?: string, details?: unknown) => HttpError;
export declare const errTooManyRequests: (msg?: string, details?: unknown) => HttpError;
export declare const errInternal: (msg?: string, details?: unknown) => HttpError;
export declare function isHttpError(error: unknown): error is HttpError;
export declare class StubError extends Error {
    constructor(message?: string);
}
