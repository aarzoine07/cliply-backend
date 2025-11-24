/**
 * LEGACY / DEV-ONLY ROUTE:
 * This endpoint is retained only for local/manual testing and is disabled in production.
 * 
 * Canonical TikTok OAuth connect route:
 * - App Router: /api/auth/tiktok/connect (apps/web/src/app/api/auth/tiktok/connect/route.ts)
 * 
 * All new integrations should use the canonical App Router flow.
 */
import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

import { serverEnv, publicEnv } from "@/lib/env";

function extractAccessToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const cookieToken = req.cookies["sb-access-token"] ?? req.cookies["sb_token"];
  if (cookieToken) return cookieToken;

  const supabaseAuthToken = req.cookies["supabase-auth-token"];
  if (supabaseAuthToken) {
    try {
      const decoded = decodeURIComponent(supabaseAuthToken);
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed) && typeof parsed[0] === "string") {
        return parsed[0];
      }
    } catch {
      // ignore malformed cookies
    }
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Fence: Disable in production
  if (process.env.NODE_ENV === "production") {
    return res.status(410).json({ error: "legacy_route_removed", message: "This legacy route is no longer available in production. Use /api/auth/tiktok/connect instead." });
  }

  try {
    // TEMP: bypass auth for local OAuth testing
    const TEST_BYPASS_AUTH = true;

    // Extract workspace_id from query param
    const workspaceId = req.query.workspace_id as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ ok: false, error: "Missing workspace_id parameter" });
    }

    // --- TEMP BYPASS START ---
    // Skip all token checks and use our fixed test user
    if (TEST_BYPASS_AUTH) {
      const userId = "a0d97448-74e0-4b24-845e-b4de43749a3c";

      const clientKey = serverEnv.TIKTOK_CLIENT_ID;
      const redirectUri = publicEnv.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

      if (!clientKey || !redirectUri) {
        return res.status(500).json({ ok: false, error: "TikTok OAuth not configured" });
      }

      // PKCE: generate code_verifier and code_challenge (S256)
      const codeVerifier = crypto.randomBytes(64).toString("base64url");
      const sha256 = crypto.createHash("sha256").update(codeVerifier).digest();
      const codeChallenge = Buffer.from(sha256).toString("base64url");

      // Include code_verifier in state so callback can use it for token exchange (dev-only)
      const statePayload = {
        workspace_id: workspaceId,
        user_id: userId,
        code_verifier: codeVerifier,
      };
      const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

      // ✅ FIXED: removed invalid "video.publish" scope
      const SCOPES = ["user.info.basic", "video.upload"];
      const scope = SCOPES.join(",");

      const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

      return res.redirect(authUrl);
    }
    // --- TEMP BYPASS END ---

    // Normal flow (disabled during bypass)
    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    const supabase = createClient(
      serverEnv.SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid authentication token" });
    }

    const userId = userData.user.id;

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError || !membership) {
      return res.status(403).json({ ok: false, error: "Access denied to workspace" });
    }

    const clientKey = serverEnv.TIKTOK_CLIENT_ID;
    const redirectUri = publicEnv.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

    if (!clientKey || !redirectUri) {
      return res.status(500).json({ ok: false, error: "TikTok OAuth not configured" });
    }

    const state = Buffer.from(
      JSON.stringify({ workspace_id: workspaceId, user_id: userId })
    ).toString("base64url");

    const SCOPES = ["user.info.basic", "video.upload"];
    const scope = SCOPES.join(",");

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}`;

    res.redirect(authUrl);
  } catch (error) {
    console.error("TikTok OAuth initiation error:", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

