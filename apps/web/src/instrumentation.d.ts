import * as Sentry from '@sentry/nextjs';
export declare function register(): Promise<void>;
export declare const onRequestError: typeof Sentry.captureRequestError;
