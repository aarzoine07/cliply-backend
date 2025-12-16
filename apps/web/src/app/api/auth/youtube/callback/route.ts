// Canonical YouTube OAuth callback route for Cliply.
// Route: GET /api/auth/youtube/callback?code=<code>&state=<state>

import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";

import { getEnv } from "@cliply/shared/env";
import { logAuditEvent } from "@cliply/shared/logging/audit";

import { logger } from "@/lib/logger";
import { getAdminClient } from "@/lib/supabase";
import { completeYouTubeOAuthFlow } from "@/lib/accounts/youtubeOauthService";

export const dynamic = "force-dynamic";

function decodeState(state: string): { workspaceId: string; userId: string } {
  const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
  const workspaceId = decoded.workspaceId || decoded.workspace_id;
  const userId = decoded.userId || decoded.user_id;

  if (!workspaceId || !userId) {
    throw new Error("Invalid state payload");
  }

  return { workspaceId, userId };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      logger.error("oauth_youtube_callback_error", {
        error: oauthError,
        errorDescription: url.searchParams.get("error_description") ?? undefined,
        durationMs: Date.now() - started,
      });
      return NextResponse.redirect("/integrations?error=youtube_auth_failed");
    }

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "Missing authorization code" },
        { status: 400 },
      );
    }

    if (!state) {
      return NextResponse.json(
        { ok: false, error: "Missing state parameter" },
        { status: 400 },
      );
    }

    const { workspaceId, userId } = decodeState(state);

    const env = getEnv();
    const redirectUri = env.YOUTUBE_OAUTH_REDIRECT_URL;
    if (!redirectUri) {
      logger.error("oauth_youtube_callback_missing_config", {
        durationMs: Date.now() - started,
      });
      return NextResponse.json(
        { ok: false, error: "YouTube OAuth not configured" },
        { status: 500 },
      );
    }

    const supabase = getAdminClient();
    const result = await completeYouTubeOAuthFlow(
      {
        workspaceId,
        userId,
        code,
        redirectUri,
        state,
      },
      { supabase },
    );

    logger.info("oauth_youtube_callback_success", {
      userId,
      workspaceId,
      accountId: result.accountId,
      channelId: result.channelInfo.channelId,
      durationMs: Date.now() - started,
    });

    // Audit log (non-blocking)
    try {
      await logAuditEvent({
        workspaceId,
        actorId: userId,
        eventType: "oauth",
        action: "connected_account.linked",
        targetId: result.accountId,
        meta: {
          provider: "youtube",
          channelId: result.channelInfo.channelId,
          channelTitle: (result.channelInfo as any).channelTitle,
        },
      });
    } catch (auditError) {
      logger.warn("oauth_youtube_callback_audit_failed", {
        workspaceId,
        accountId: result.accountId,
        error: (auditError as Error)?.message ?? "unknown",
      });
    }

    return NextResponse.redirect("/integrations?connected=youtube");
  } catch (error) {
    logger.error("oauth_youtube_callback_failed", {
      message: (error as Error)?.message ?? "unknown",
      durationMs: Date.now() - started,
    });

    return NextResponse.redirect("/integrations?error=youtube_unexpected");
  }
}
