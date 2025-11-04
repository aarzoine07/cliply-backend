import { getEnv } from "@cliply/shared/env";
import { createClient } from "@supabase/supabase-js";
let clients = {};
const baseAuthConfig = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
};
export function getRlsClient(accessToken) {
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)
        return undefined;
    if (!accessToken) {
        if (!clients.rls) {
            clients.rls = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
                auth: baseAuthConfig,
            });
        }
        return clients.rls;
    }
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: baseAuthConfig,
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        },
    });
}
export function getAdminClient() {
    const env = getEnv();
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
        return undefined;
    if (!clients.admin) {
        clients.admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
            auth: baseAuthConfig,
        });
    }
    return clients.admin;
}
