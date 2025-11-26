import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AuthContext, AuthErrorCode, PlanName } from "../../types/auth.js";
import { getEnv } from "../env";

export type { AuthContext } from "../../types/auth";

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
  const env = getEnv();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

function validateUuid(value: string, headerName: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throwAuthError(AuthErrorCode.MISSING_HEADER, `${headerName} must be a valid UUID`, 401);
  }
  return value;
}

function ensureWorkspaceId(req: Request): string {
  const workspaceId = req.headers.get("x-workspace-id")?.trim();
  if (!workspaceId) {
    throwAuthError(AuthErrorCode.MISSING_HEADER, "X-Workspace-ID header is required", 401);
  }
  return validateUuid(workspaceId, "X-Workspace-ID");
}

function isPlanName(value: unknown): value is PlanName {
  return value === "basic" || value === "pro" || value === "premium";
}

export async function buildAuthContext(req: Request): Promise<AuthContext> {
  const env = getEnv();
  const isProduction = env.NODE_ENV === "production";

  const debugUserId = req.headers.get("x-debug-user")?.trim() || null;
  const debugWorkspaceId = req.headers.get("x-debug-workspace")?.trim() || null;

  if (isProduction && (debugUserId || debugWorkspaceId)) {
    throwAuthError(
      AuthErrorCode.UNAUTHORIZED,
      "Debug headers are not allowed in production",
      401,
    );
  }

  let userId: string;
  let workspaceId: string;

  if (!isProduction && debugUserId) {
    userId = validateUuid(debugUserId, "x-debug-user");

    if (debugWorkspaceId) {
      workspaceId = validateUuid(debugWorkspaceId, "x-debug-workspace");
    } else {
      workspaceId = ensureWorkspaceId(req);
    }
  } else {
    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      throwAuthError(AuthErrorCode.UNAUTHORIZED, "Supabase session is missing or invalid", 401);
    }

    const supabase = loadSupabaseClient();

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      throwAuthError(AuthErrorCode.UNAUTHORIZED, "Supabase session could not be verified", 401);
    }

    userId = userData.user.id;

    workspaceId = ensureWorkspaceId(req);

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
  }

  const supabase = loadSupabaseClient();

  // IMPORTANT FIX: correct dynamic path resolution
  const { resolveWorkspacePlan } = await import("../../billing/planResolution.js");

  const resolvedPlan = await resolveWorkspacePlan(workspaceId, { supabase });
  const plan = resolvedPlan.planId;

  return {
    user_id: userId,
    workspace_id: workspaceId,
    plan,
    isAuthenticated: true,
    userId,
    workspaceId,
  };
}

