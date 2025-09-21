import { HttpError } from "@/lib/errors";
import { getRlsClient } from "@/lib/supabase";
export async function requireAuth(req) {
    const accessToken = extractBearerToken(req);
    if (!accessToken) {
        throw new HttpError(401, "missing or invalid authorization header");
    }
    const supabase = getRlsClient(accessToken);
    if (!supabase) {
        throw new HttpError(500, "supabase client is not configured", { expose: false });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
        throw new HttpError(401, "unauthorized");
    }
    const workspaceId = await getWorkspaceIdForUser(supabase, userData.user.id);
    return {
        supabase,
        userId: userData.user.id,
        workspaceId,
        accessToken,
    };
}
export async function getWorkspaceIdForUser(supabase, userId) {
    const { data, error } = await supabase
        .from("workspaces")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
    if (error) {
        throw new HttpError(500, "failed to resolve workspace", { cause: error, expose: false });
    }
    if (!data?.id) {
        throw new HttpError(403, "workspace not found for user");
    }
    return data.id;
}
function extractBearerToken(req) {
    const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!header)
        return null;
    const [scheme, token] = header.split(" ");
    if (!scheme || !token)
        return null;
    if (scheme.toLowerCase() !== "bearer")
        return null;
    return token.trim() || null;
}
