#!/usr/bin/env tsx

/**
 * TikTok OAuth Verification Script
 *
 * Verifies end-to-end token decryption and refresh:
 * 1. Reads TikTok connected account from database
 * 2. Unseals refresh token using libsodium
 * 3. Calls TikTok refresh endpoint
 * 4. Re-seals new tokens and updates database
 */

import { createClient } from "@supabase/supabase-js";
import sodiumMod from "libsodium-wrappers";
import dotenv from "dotenv";

// Load .env.local if it exists
dotenv.config({ path: ".env.local" });
dotenv.config();

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function openSeal(sealedB64: string) {
  await sodiumMod.ready;
  const sodium = sodiumMod as typeof sodiumMod;
  const pub = Buffer.from(env("SODIUM_PUBLIC_KEY_B64"), "base64");
  const sec = Buffer.from(env("SODIUM_SECRET_KEY_B64"), "base64");
  const cipher = Buffer.from(sealedB64, "base64");
  const plain = sodium.crypto_box_seal_open(cipher, pub, sec);
  return Buffer.from(plain).toString("utf8");
}

async function seal(plaintext: string) {
  await sodiumMod.ready;
  const sodium = sodiumMod as typeof sodiumMod;
  const pub = Buffer.from(env("SODIUM_PUBLIC_KEY_B64"), "base64");
  const sealed = sodium.crypto_box_seal(Buffer.from(plaintext), pub);
  return Buffer.from(sealed).toString("base64");
}

// Handle old format (sbx: prefix) for backward compatibility
function sealedBoxDecryptRef(ref: string): string {
  if (!ref.startsWith("sbx:")) throw new Error("Invalid sealed-box reference");
  return Buffer.from(ref.slice(4), "base64url").toString("utf8");
}

async function main() {
  console.log("\n🔍 TikTok OAuth Verification\n");

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: acct, error } = await supabase
    .from("connected_accounts")
    .select("id, platform, refresh_token_encrypted_ref, access_token_encrypted_ref")
    .eq("platform", "tiktok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("❌ Database query error:", error.message);
    throw new Error(`DB_QUERY_FAILED: ${error.message}`);
  }

  if (!acct) {
    console.error("❌ No TikTok connected account found");
    console.error("   Please complete OAuth flow: /api/auth/tiktok/connect");
    throw new Error("NO_TIKTOK_ACCOUNT");
  }

  if (!acct.refresh_token_encrypted_ref) {
    console.error("❌ Account has no refresh_token_encrypted_ref");
    throw new Error("NO_REFRESH_TOKEN");
  }

  console.log(`✓ Found TikTok account: ${acct.id.substring(0, 8)}...`);
  console.log(`✓ Refresh token encrypted ref length: ${acct.refresh_token_encrypted_ref.length}`);

  // Try to decrypt - handle both old format (sbx:) and new format (Base64 sealed-box)
  let refresh_token: string;
  try {
    if (acct.refresh_token_encrypted_ref.startsWith("sbx:")) {
      console.log("  (using legacy sbx: format)");
      refresh_token = sealedBoxDecryptRef(acct.refresh_token_encrypted_ref);
    } else {
      console.log("  (using libsodium sealed-box format)");
      refresh_token = await openSeal(acct.refresh_token_encrypted_ref);
    }
  } catch (decryptError) {
    console.error("❌ Failed to unseal refresh token");
    throw new Error(`TOKEN_DECRYPT_FAILED: ${decryptError instanceof Error ? decryptError.message : String(decryptError)}`);
  }

  if (!refresh_token || refresh_token.length < 20) {
    console.error("❌ Unsealed refresh_token looks invalid (too short)");
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  console.log(`✓ Refresh token unsealed (length: ${refresh_token.length}, masked: ${refresh_token.substring(0, 8)}...)`);

  // Call TikTok refresh endpoint
  const body = new URLSearchParams({
    client_key: env("TIKTOK_CLIENT_KEY"),
    client_secret: env("TIKTOK_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token,
  });

  console.log("✓ Calling TikTok refresh endpoint...");
  const resp = await fetch("https://open-api.tiktok.com/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await resp.json();
  if (!resp.ok || !json?.access_token) {
    console.error("❌ TikTok refresh error:", json);
    throw new Error(`REFRESH_FAILED: ${JSON.stringify(json)}`);
  }

  console.log(`✓ TikTok refresh succeeded (access_token length: ${json.access_token.length})`);

  // Re-seal tokens
  const accessEnc = await seal(String(json.access_token));
  const refreshEnc = json.refresh_token ? await seal(String(json.refresh_token)) : null;
  const expiresAt = json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString() : null;

  console.log(`✓ Tokens re-sealed (access: ${accessEnc.length} chars, refresh: ${refreshEnc ? refreshEnc.length : "null"} chars)`);

  // Update database
  const { error: updErr } = await supabase
    .from("connected_accounts")
    .update({
      access_token_encrypted_ref: accessEnc,
      refresh_token_encrypted_ref: refreshEnc ?? undefined,
      expires_at: expiresAt ?? undefined,
    })
    .eq("id", acct.id);

  if (updErr) {
    console.error("❌ Database update error:", updErr.message);
    throw new Error(`DB_UPDATE_FAILED: ${updErr.message}`);
  }

  console.log("✓ Database updated successfully");
  console.log("\n" + "=".repeat(70));
  console.log("\n✅ TikTok verify: sealed refresh succeeded; DB rotated tokens.");
  console.log("   (no plaintext tokens printed)");
  console.log("\n📋 Manual verification steps:");
  console.log("  1. State mismatch test:");
  console.log('     curl "http://localhost:3000/api/auth/tiktok/callback?code=dummy&state=WRONG_STATE"');
  console.log("     Expected: 400 with { ok: false, error: \"STATE_MISMATCH\" }");
  console.log("  2. Refresh endpoint test:");
  console.log(`     curl -X POST http://localhost:3000/api/tiktok/token \\`);
  console.log(`       -H "Content-Type: application/json" \\`);
  console.log(`       -d '{"account_id": "${acct.id}"}'`);
  console.log("     Expected: { ok: true }");
  console.log("");
}

main().catch((e) => {
  console.error("\n💥 Verification failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

