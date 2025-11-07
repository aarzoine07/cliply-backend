import crypto from "crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ✅ TEMP: bypass Supabase auth for local TikTok OAuth testing
const TEST_BYPASS_AUTH = true;

// ✅ Scopes that match TikTok Sandbox configuration
const SCOPES = ["user.info.basic", "video.upload"];

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Extract workspace_id from query params
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspace_id");
    if (!workspaceId) {
      return NextResponse.json(
        { ok: false, error: { code: "OAUTH_INVALID_WORKSPACE", message: "Missing workspace_id" } },
        { status: 400 },
      );
    }

    const TIKTOK_AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
    const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!;
    const TIKTOK_REDIRECT_URI = process.env.NEXT_PUBLIC_TIKTOK_REDIRECT_URL!;

    if (!TIKTOK_CLIENT_KEY || !TIKTOK_REDIRECT_URI) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_MISSING_CONFIG",
            message: "TikTok OAuth environment variables are not configured.",
          },
        },
        { status: 500 },
      );
    }

    // --- BYPASS MODE ---
    if (TEST_BYPASS_AUTH) {
      const userId = "a0d97448-74e0-4b24-845e-b4de43749a3c";

      // PKCE generation
      const codeVerifier = crypto.randomBytes(64).toString("base64url");
      const sha256 = crypto.createHash("sha256").update(codeVerifier).digest();
      const codeChallenge = Buffer.from(sha256).toString("base64url");

      // Pack state (workspace_id, user_id, code_verifier)
      const statePayload = {
        workspace_id: workspaceId,
        user_id: userId,
        code_verifier: codeVerifier,
      };
      const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

      // Build TikTok authorization URL
      const scope = SCOPES.join(",");
      const authUrl = `${TIKTOK_AUTH_BASE}?client_key=${TIKTOK_CLIENT_KEY}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(
        TIKTOK_REDIRECT_URI,
      )}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

      // Redirect straight to TikTok consent screen
      return NextResponse.redirect(authUrl, { status: 302 });
    }
    // --- END BYPASS ---

    // (Normal Supabase auth flow would go here, but is disabled for Sandbox)
    return NextResponse.json(
      { ok: false, error: { code: "OAUTH_DISABLED", message: "Bypass not active." } },
      { status: 403 },
    );
  } catch (err) {
    console.error("TikTok OAuth connect error:", err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { ok: false, error: { code: "OAUTH_CONNECT_ERROR", message } },
      { status: 500 },
    );
  }
}
