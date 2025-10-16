import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AuthContext, AuthErrorCode, PlanName } from "../types/auth";

export type { AuthContext } from "../types/auth";

interface AuthError extends Error {
  code: AuthErrorCode;
  status: number;
}

function throwAuthError(code: AuthErrorCode, message: string, status: number): never {
  const error = new Error(message) as AuthError;
  error.name = "AuthError";
  error.code = code;
  error.status = status;
  throw error;
}

function loadSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throwAuthError(AuthErrorCode.INTERNAL_ERROR, "Supabase configuration is missing", 500);
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;

  const [scheme, token] = headerValue.split(/\s+/);
  if (!token || scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(";").map((cookiePart) => {
      const [rawKey, ...rawValueParts] = cookiePart.split("=");
      const key = rawKey.trim();
      const value = rawValueParts.join("=").trim();
      return [key, value];
    }),
  );
}

function parseCookieAccessToken(cookieMap: Record<string, string>): string | null {
  const directToken = cookieMap["sb-access-token"] || cookieMap["sb_token"];
  if (directToken) {
    return decodeURIComponent(directToken);
  }

  const supabaseAuthToken = cookieMap["supabase-auth-token"];
  if (supabaseAuthToken) {
    try {
      const decoded = decodeURIComponent(supabaseAuthToken);
      const payload = JSON.parse(decoded);
      if (Array.isArray(payload) && typeof payload[0] === "string") {
        return payload[0];
      }
    } catch {
      return null;
    }
  }

  return null;
}

function extractAccessToken(req: Request): string | null {
  const authorizationHeader = req.headers.get("authorization");
  const bearerToken = parseBearerToken(authorizationHeader);
  if (bearerToken) return bearerToken;

  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  return parseCookieAccessToken(cookies);
}

function ensureWorkspaceId(req: Request): string {
  const workspaceId = req.headers.get("x-workspace-id")?.trim();
  if (!workspaceId) {
    throwAuthError(AuthErrorCode.MISSING_HEADER, "X-Workspace-ID header is required", 401);
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(workspaceId)) {
    throwAuthError(AuthErrorCode.MISSING_HEADER, "X-Workspace-ID must be a valid UUID", 401);
  }

  return workspaceId;
}

function isPlanName(value: unknown): value is PlanName {
  return value === "basic" || value === "growth" || value === "agency";
}

export async function buildAuthContext(req: Request): Promise<AuthContext> {
  // 1. Parse Supabase session token from Authorization header or cookies.
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    throwAuthError(AuthErrorCode.UNAUTHORIZED, "Supabase session is missing or invalid", 401);
  }

  // 2. Create an admin Supabase client using the service role key.
  const supabase = loadSupabaseClient();

  // 3. Fetch the authenticated user associated with the access token.
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) {
    throwAuthError(AuthErrorCode.UNAUTHORIZED, "Supabase session could not be verified", 401);
  }

  const userId = userData.user.id;

  // 4. Validate the X-Workspace-ID header to identify the target workspace.
  const workspaceId = ensureWorkspaceId(req);

  // 5. Confirm the user is a member of the requested workspace (RLS compatibility).
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    throwAuthError(
      AuthErrorCode.INTERNAL_ERROR,
      "Failed to verify workspace membership",
      500,
    );
  }

  if (!membership) {
    throwAuthError(
      AuthErrorCode.WORKSPACE_MISMATCH,
      "User is not a member of the requested workspace",
      403,
    );
  }

  // 6. Retrieve the current plan for the workspace, defaulting to basic when missing.
  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("plan_name")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError && subscriptionError.code !== "PGRST116") {
    throwAuthError(
      AuthErrorCode.INTERNAL_ERROR,
      "Unable to resolve workspace subscription",
      500,
    );
  }

  const plan = isPlanName(subscription?.plan_name) ? subscription.plan_name : "basic";

  // 7. Return the normalized auth context for downstream handlers.
  return {
    user_id: userId,
    workspace_id: workspaceId,
    plan,
  };
}
