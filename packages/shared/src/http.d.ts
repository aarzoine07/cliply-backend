export type Ok<T> = {
    ok: true;
} & T;
export type Err = {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
export declare function ok<T extends Record<string, unknown>>(body: T): Ok<T>;
export declare function err(code: string, message: string, details?: unknown): Err;
export declare function isErr(x: unknown): x is Err;
