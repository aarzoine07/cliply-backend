// FILE: apps/web/pages/api/auth/tiktok_legacy/callback.ts
// FINAL VERSION – legacy/dev-only TikTok OAuth callback using JSON envelopes

/**
 * LEGACY / DEV-ONLY ROUTE:
 * This endpoint is retained only for local/manual testing and is disabled in production.
 *
 * Canonical TikTok OAuth callback route:
 * - App Router: /api/auth/tiktok/connect/callback (apps/web/src/app/api/auth/tiktok/connect/callback/route.ts)
 *
 * All new integrations should use the canonical App Router flow.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

import { serverEnv, publicEnv } from "@/lib/env";

type SecretEnvelope = {
  v: number;
  purpose: string;
  secret: string;
};

function encryptSecret(secret: string, meta: { purpose: string }): string {
  const envelope: SecretEnvelope = {
    v: 1,
    purpose: meta.purpose,
    secret,
  };
  return JSON.stringify(envelope);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Fence: Disable in production
  if (process.env.NODE_ENV === "production") {
    return res.status(410).json({
      error: "legacy_route_removed",
      message:
        "This legacy route is no longer available in production. Use /api/auth/tiktok/connect/callback instead.",
    });
  }

  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error("TikTok OAuth error:", error);
      return res.redirect("/integrations?error=tiktok_auth_failed");
    }

    if (!code || typeof code !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "Missing authorization code" });
    }

    if (!state || typeof state !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "Missing state parameter" });
    }

    // Decode state to get workspace_id, user_id, and optional code_verifier
    let workspace_id: string;
    let user_id: string;
    let code_verifier: string | undefined;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      workspace_id = decoded.workspace_id;
      user_id = decoded.user_id;
      code_verifier = decoded.code_verifier;
    } catch {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid state parameter" });
    }

    const clientKey = serverEnv.TIKTOK_CLIENT_ID;
    const clientSecret = serverEnv.TIKTOK_CLIENT_SECRET;
    const redirectUri = publicEnv.NEXT_PUBLIC_TIKTOK_REDIRECT_URL;

    if (!clientKey || !clientSecret || !redirectUri) {
      return res.status(500).json({
        ok: false,
        error: "TikTok OAuth not configured",
      });
    }

    // --- TOKEN EXCHANGE (TikTok OAuth2 PKCE-compliant) ---
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    if (code_verifier) {
      params.append("code_verifier", code_verifier);
    }

    const tokenRes = await fetch("https://open-api.tiktok.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("TikTok token exchange failed:", tokenData);
      return res.redirect("/integrations?error=tiktok_token_failed");
    }

    // --- USER INFO FETCH ---
    const userInfoRes = await fetch("https://open.tiktokapis.com/v2/user/info/", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let externalId = "unknown";
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      externalId = userInfo.data?.user?.open_id || "unknown";
    }

    // --- DATABASE INSERT ---
    const supabase = createClient(
      serverEnv.SUPABASE_URL,
      serverEnv.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    const expiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000,
    ).toISOString();

    const { error: dbError } = await supabase.from("connected_accounts").upsert(
      {
        user_id,
        workspace_id,
        platform: "tiktok",
        provider: "tiktok",
        external_id: externalId,
        access_token_encrypted_ref: encryptSecret(tokenData.access_token, {
          purpose: "tiktok_token",
        }),
        refresh_token_encrypted_ref: tokenData.refresh_token
          ? encryptSecret(tokenData.refresh_token, {
              purpose: "tiktok_token",
            })
          : null,
        expires_at: expiresAt,
        scopes: tokenData.scope
          ? tokenData.scope.split(",")
          : ["user.info.basic", "video.upload"],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,platform" },
    );

    if (dbError) {
      console.error("Failed to store TikTok tokens:", dbError);
      return res.redirect("/integrations?error=tiktok_storage_failed");
    }

    // --- AUDIT LOG ---
    await supabase.from("events_audit").insert({
      workspace_id,
      actor_id: user_id,
      event_type: "tiktok.connected",
      payload: {
        platform: "tiktok",
        external_id: externalId,
      },
    });

    console.log("✅ TikTok connection stored successfully:", externalId);
    res.redirect("/integrations?connected=tiktok");
  } catch (error) {
    console.error("TikTok OAuth callback error:", error);
    res.redirect("/integrations?error=tiktok_unexpected");
  }
}
