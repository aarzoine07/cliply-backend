/** Narrowing helpers usable without Zod at call sites */
export declare function isString(v: unknown): v is string;
export declare function isUUID(v: unknown): v is string;
export declare function isISODate(v: unknown): v is string;
export declare function assertNever(x: never): never;
