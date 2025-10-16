import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { buildAuthContext } from "@cliply/shared/auth/context";

const TIKTOK_AUTH_BASE =
  process.env.TIKTOK_AUTH_BASE ?? "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_CLIENT_ID = process.env.TIKTOK_CLIENT_ID;
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

const SCOPES = ["video.upload", "video.publish", "video.list", "user.info.basic"];

function base64url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!TIKTOK_CLIENT_ID || !TIKTOK_REDIRECT_URI) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_MISSING_CONFIG",
            message: "TikTok OAuth is not configured.",
          },
        },
        { status: 500 },
      );
    }

    const auth = await buildAuthContext(request);
    const { workspace_id } = auth;
    if (!workspace_id) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "OAUTH_INVALID_WORKSPACE",
            message: "Missing or invalid workspace.",
          },
        },
        { status: 403 },
      );
    }

    const state = base64url(randomBytes(32));
    const statePayload = JSON.stringify({
      state,
      workspace_id,
      created_at: Date.now(),
    });

    const params = new URLSearchParams({
      client_key: TIKTOK_CLIENT_ID,
      response_type: "code",
      redirect_uri: TIKTOK_REDIRECT_URI,
      scope: SCOPES.join(" "),
      state,
    });

    const authorizeUrl = `${TIKTOK_AUTH_BASE}?${params.toString()}`;

    const response = NextResponse.redirect(authorizeUrl, { status: 302 });
    response.headers.append(
      "Set-Cookie",
      [
        `tt_state=${encodeURIComponent(statePayload)}`,
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=600",
      ].join("; "),
    );

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to start TikTok OAuth.";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OAUTH_CONNECT_ERROR",
          message,
        },
      },
      { status: 500 },
    );
  }
}
