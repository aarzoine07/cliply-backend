import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function extractAccessToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const cookieToken = req.cookies["sb-access-token"] ?? req.cookies["sb_token"];
  if (cookieToken) {
    return cookieToken;
  }

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
  try {
    // Extract workspace_id from query param
    const workspaceId = req.query.workspace_id as string | undefined;
    if (!workspaceId) {
      return res.status(400).json({ ok: false, error: "Missing workspace_id parameter" });
    }

    // Verify user is authenticated
    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    // Verify user has access to workspace
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user?.id) {
      return res.status(401).json({ ok: false, error: "Invalid authentication token" });
    }

    const userId = userData.user.id;

    // Verify workspace membership
    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError || !membership) {
      return res.status(403).json({ ok: false, error: "Access denied to workspace" });
    }

    // Build OAuth URL
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

    if (!clientKey || !redirectUri) {
      return res.status(500).json({ ok: false, error: "TikTok OAuth not configured" });
    }

    // Encode state with workspace_id and user_id for callback
    const state = Buffer.from(
      JSON.stringify({ workspace_id: workspaceId, user_id: userId })
    ).toString("base64url");

    const scope = "user.info.basic,video.upload,video.publish";
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    res.redirect(authUrl);
  } catch (error) {
    console.error("TikTok OAuth initiation error:", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

