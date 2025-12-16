import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@cliply/shared/env";
import { buildAuthContext } from "@cliply/shared/auth/context";

import { ok, err } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildYouTubeAuthUrl } from "@/lib/accounts/youtubeOauthService";

export const dynamic = "force-dynamic";

// Canonical YouTube OAuth start route for Cliply.
// Route: GET /api/auth/youtube/start
export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();

  try {
    const auth = await buildAuthContext(request);
    const userId = (auth as any).userId ?? (auth as any).user_id;
    const workspaceId = (auth as any).workspaceId ?? (auth as any).workspace_id;

    if (!workspaceId) {
      return NextResponse.json(err("invalid_request", "workspace required"), { status: 400 });
    }

    if (!userId) {
      logger.warn("oauth_youtube_start_missing_user", {
        workspaceId,
        durationMs: Date.now() - started,
      });

      return NextResponse.json(err("missing_user", "user required"), { status: 401 });
    }

    await checkRateLimit(String(userId), "oauth:youtube:start");

    const env = getEnv();
    const configuredRedirect = env.YOUTUBE_OAUTH_REDIRECT_URL;

    if (!configuredRedirect) {
      logger.error("oauth_youtube_start_missing_config", {
        workspaceId,
        userId,
        durationMs: Date.now() - started,
      });

      return NextResponse.json(err("internal_error", "YouTube OAuth not configured"), { status: 500 });
    }

    // Optional: allow a requested redirect_uri but only if it matches config exactly.
    const requestedRedirect = request.nextUrl.searchParams.get("redirect_uri") ?? undefined;
    if (requestedRedirect && requestedRedirect !== configuredRedirect) {
      logger.warn("oauth_youtube_start_redirect_uri_mismatch", {
        workspaceId,
        userId,
        requestedRedirect,
        configuredRedirect,
        durationMs: Date.now() - started,
      });

      return NextResponse.json(err("invalid_request", "redirect_uri mismatch"), { status: 400 });
    }

    const authUrl = buildYouTubeAuthUrl({
      workspaceId: String(workspaceId),
      userId: String(userId),
      redirectUri: configuredRedirect,
    });

    logger.info("oauth_youtube_start", {
      workspaceId,
      userId,
      durationMs: Date.now() - started,
    });

    return NextResponse.json(ok({ url: authUrl }), { status: 200 });
  } catch (error) {
    logger.error("oauth_youtube_start_failed", {
      message: (error as Error)?.message ?? "unknown",
      durationMs: Date.now() - started,
    });

    return NextResponse.json(err("internal_error", "Failed to start OAuth flow"), { status: 500 });
  }
}
