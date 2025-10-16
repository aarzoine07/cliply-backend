import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL is not configured");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const TOKEN_URL =
  process.env.TIKTOK_TOKEN_URL ?? "https://open.tiktokapis.com/v2/oauth/token/";
const CLIENT_ID = process.env.TIKTOK_CLIENT_ID;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error("TikTok client credentials are not configured");
}

async function sealedBoxDecryptRef(ref: string): Promise<string> {
  if (!ref.startsWith("sbx:")) throw new Error("Invalid sealed-box reference");
  return Buffer.from(ref.slice(4), "base64url").toString("utf8");
}

async function sealedBoxEncryptRef(plaintext: string): Promise<string> {
  return `sbx:${Buffer.from(plaintext).toString("base64url")}`;
}

type ConnectedAccountRow = {
  workspace_id: string;
  access_token_encrypted_ref: string;
  refresh_token_encrypted_ref: string;
  expires_at: string | null;
};

export async function refreshTikTokTokensJob(): Promise<void> {
  console.log("🔁 Starting TikTok token refresh job...");

  const now = new Date();
  const threshold = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: accounts, error } = await supabase
    .from<ConnectedAccountRow>("connected_accounts")
    .select("workspace_id, access_token_encrypted_ref, refresh_token_encrypted_ref, expires_at")
    .eq("platform", "tiktok")
    .lte("expires_at", threshold);

  if (error) {
    console.error("❌ Failed to fetch expiring TikTok accounts:", error.message);
    return;
  }

  if (!accounts || accounts.length === 0) {
    console.log("ℹ️ No TikTok accounts require refresh at this time.");
    return;
  }

  for (const account of accounts) {
    try {
      const refreshToken = await sealedBoxDecryptRef(account.refresh_token_encrypted_ref);

      const form = new URLSearchParams({
        client_key: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });

      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });

      if (!response.ok) {
        const txt = await response.text();
        console.error(`⚠️ Failed to refresh TikTok token for ${account.workspace_id}: ${txt}`);
        continue;
      }

      const payload: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      } = await response.json();

      if (!payload.access_token || !payload.refresh_token || !payload.expires_in) {
        console.error(`⚠️ Missing fields in refresh response for ${account.workspace_id}`);
        continue;
      }

      const accessRef = await sealedBoxEncryptRef(payload.access_token);
      const refreshRef = await sealedBoxEncryptRef(payload.refresh_token);
      const expiresAtIso = new Date(Date.now() + payload.expires_in * 1000).toISOString();

      const { error: updateError } = await supabase
        .from("connected_accounts")
        .update({
          access_token_encrypted_ref: accessRef,
          refresh_token_encrypted_ref: refreshRef,
          expires_at: expiresAtIso,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", account.workspace_id)
        .eq("platform", "tiktok");

      if (updateError) {
        console.error(
          `❌ Failed to update refreshed tokens for ${account.workspace_id}:`,
          updateError.message,
        );
        continue;
      }

      await supabase.from("events_audit").insert({
        workspace_id: account.workspace_id,
        event_type: "oauth_tiktok_refreshed",
        target_id: null,
        payload: { expires_at: expiresAtIso },
      });

      console.log(`✅ Refreshed TikTok tokens for workspace ${account.workspace_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`💥 Refresh failed for workspace ${account.workspace_id}:`, message);
    }
  }

  console.log("🎉 TikTok token refresh job complete.");
}

if (require.main === module) {
  refreshTikTokTokensJob().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("💥 TikTok token refresh job terminated with error:", message);
    process.exitCode = 1;
  });
}
