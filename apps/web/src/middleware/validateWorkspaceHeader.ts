import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ErrorCode = "AUTH_MISSING_HEADER" | "AUTH_WORKSPACE_MISMATCH";

function jsonError(status: number, code: ErrorCode, message: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message },
    },
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

function loadServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase configuration missing");
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

function parseCookieToken(req: NextRequest): string | null {
  const directCookie =
    req.cookies.get("sb-access-token")?.value ?? req.cookies.get("sb_token")?.value;
  if (directCookie) {
    try {
      return decodeURIComponent(directCookie);
    } catch {
      return directCookie;
    }
  }

  const supabaseCookie = req.cookies.get("supabase-auth-token")?.value;
  if (!supabaseCookie) return null;

  try {
    const decoded = decodeURIComponent(supabaseCookie);
    const payload = JSON.parse(decoded);
    if (Array.isArray(payload) && typeof payload[0] === "string") {
      return payload[0];
    }
  } catch {
    return null;
  }

  return null;
}

function extractAccessToken(req: NextRequest): string | null {
  const bearer = parseBearerToken(req.headers.get("authorization"));
  if (bearer) return bearer;
  return parseCookieToken(req);
}

export async function validateWorkspaceHeader(req: NextRequest) {
  // 1. Read and validate the X-Workspace-ID header format.
  const workspaceId = req.headers.get("x-workspace-id")?.trim();
  if (!workspaceId || !UUID_PATTERN.test(workspaceId)) {
    return jsonError(401, "AUTH_MISSING_HEADER", "X-Workspace-ID header is required.");
  }

  // 2. Extract the Supabase access token from Authorization header or cookies.
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    return jsonError(401, "AUTH_MISSING_HEADER", "Supabase session token is missing.");
  }

  // 3. Resolve the authenticated user id using service-role Supabase client.
  let supabase;
  try {
    supabase = loadServiceClient();
  } catch (error) {
    return jsonError(500, "AUTH_WORKSPACE_MISMATCH", "Authentication service unavailable.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user?.id) {
    return jsonError(401, "AUTH_MISSING_HEADER", "Supabase session token is invalid.");
  }

  const userId = userData.user.id;

  // 4. Confirm the user is a member of the requested workspace via workspace_members table.
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    return jsonError(500, "AUTH_WORKSPACE_MISMATCH", "Unable to verify workspace membership.");
  }

  if (!membership) {
    return jsonError(403, "AUTH_WORKSPACE_MISMATCH", "User is not a member of this workspace.");
  }

  // 5. Propagate the validated workspace id downstream and continue the middleware chain.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-workspace-id", workspaceId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-workspace-id", workspaceId);

  return response;
}
