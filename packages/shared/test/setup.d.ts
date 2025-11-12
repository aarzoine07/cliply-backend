export declare const env: {
    NODE_ENV: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    DATABASE_URL: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    SENTRY_DSN: string;
};
export declare const supabaseTest: import("@supabase/supabase-js").SupabaseClient<any, "public", "public", any, any>;
export declare function createTestJwt(userId: string, workspaceId: string): any;
export declare function resetDatabase(): Promise<void>;
