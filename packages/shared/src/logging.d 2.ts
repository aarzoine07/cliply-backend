type ContextLike = Record<string, unknown>;
type PrimaryInput = string | {
    msg?: string;
    context?: ContextLike;
    jobId?: string | number;
    job_id?: string | number;
    status?: string;
    job?: {
        id?: string | number;
        status?: string;
    } | null;
    [key: string]: unknown;
};
type MetaInput = ContextLike | undefined;
export declare function createLogger(component: string): {
    info(input: PrimaryInput, meta?: MetaInput): void;
    error(input: PrimaryInput, meta?: MetaInput): void;
};
export {};
