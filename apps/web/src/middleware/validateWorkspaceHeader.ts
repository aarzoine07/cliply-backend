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

function loadRlsClient(accessToken: string) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase configuration missing");
  }

  // IMPORTANT: use anon + user JWT so RLS enforces membership.
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
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

  // 3. Resolve the authenticated user (validates token).
  let supabase;
  try {
    supabase = loadRlsClient(accessToken);
  } catch {
    return jsonError(500, "AUTH_WORKSPACE_MISMATCH", "Authentication service unavailable.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    return jsonError(401, "AUTH_MISSING_HEADER", "Supabase session token is invalid.");
  }

  // 4. Confirm membership via RPC (RLS-backed).
  const { data: isMember, error: membershipError } = await supabase.rpc(
    "is_workspace_member",
    { p_workspace_id: workspaceId },
  );

  if (membershipError) {
    return jsonError(500, "AUTH_WORKSPACE_MISMATCH", "Unable to verify workspace membership.");
  }

  if (isMember !== true) {
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
