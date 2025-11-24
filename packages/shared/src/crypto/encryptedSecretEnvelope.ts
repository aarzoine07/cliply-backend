import * as crypto from "crypto";
import { getEnv } from "../env";

/**
 * Versioned encrypted secret envelope format.
 * Envelope v1 uses AES-256-GCM encryption.
 */
export interface EncryptedSecretEnvelopeV1 {
  v: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  cipher: string; // base64
  tag: string; // base64
}

type EncryptedSecretEnvelope = EncryptedSecretEnvelopeV1;

interface EncryptionContext {
  purpose: "tiktok_token" | string;
}

/**
 * Derive encryption key from environment variable.
 * Validates that key is present and correct length (32 bytes after base64 decode).
 */
function getEncryptionKey(): Buffer {
  const env = getEnv();
  const keyString = env.TIKTOK_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error(
      "TIKTOK_ENCRYPTION_KEY is not configured. This is required for encrypting TikTok tokens.",
    );
  }

  try {
    const key = Buffer.from(keyString, "base64");
    if (key.length !== 32) {
      throw new Error(
        `TIKTOK_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length} bytes). ` +
          `Generate a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    return key;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must decode")) {
      throw error;
    }
    throw new Error(
      `TIKTOK_ENCRYPTION_KEY must be a valid base64 string: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check if a stored value is a legacy format (not an encrypted envelope).
 * Legacy formats include:
 * - Plain tokens (no special prefix)
 * - Base64-encoded tokens (with "sbx:" prefix)
 */
function isLegacyFormat(stored: string): boolean {
  // Check if it looks like JSON
  const trimmed = stored.trim();
  if (!trimmed.startsWith("{")) {
    return true; // Not JSON, must be legacy
  }

  try {
    const parsed = JSON.parse(trimmed);
    // If it's valid JSON but doesn't have our envelope structure, it's legacy
    if (typeof parsed !== "object" || parsed === null) {
      return true;
    }
    if (typeof parsed.v !== "number" || parsed.v !== 1) {
      return true; // Not our envelope version
    }
    return false; // Looks like our envelope
  } catch {
    return true; // JSON parse failed, must be legacy
  }
}

/**
 * Decrypt a legacy "sealed box" reference (base64url with "sbx:" prefix).
 * This is the old format used before real encryption.
 */
function decryptLegacySealedBox(ref: string): string {
  if (!ref.startsWith("sbx:")) {
    return ref; // Not a sealed box, return as-is (plain token)
  }
  try {
    return Buffer.from(ref.slice(4), "base64url").toString("utf8");
  } catch {
    // If base64url decode fails, return as-is
    return ref;
  }
}

/**
 * Encrypt a secret using AES-256-GCM and wrap it in a versioned envelope.
 *
 * @param plaintext - The plaintext secret to encrypt
 * @param context - Context information (currently only purpose is used)
 * @returns JSON string representation of the encrypted envelope
 */
export function encryptSecret(
  plaintext: string,
  context: EncryptionContext,
): string {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("encryptSecret: plaintext must be a non-empty string");
  }

  // Get encryption key
  const key = getEncryptionKey();

  // Generate random IV (12 bytes recommended for GCM)
  const iv = crypto.randomBytes(12);

  // Create cipher
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  // Encrypt plaintext
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // Get authentication tag
  const tag = cipher.getAuthTag();

  // Create envelope
  const envelope: EncryptedSecretEnvelopeV1 = {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    cipher: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt a secret from a versioned envelope or legacy format.
 *
 * Supports:
 * - New encrypted envelopes (v1, AES-256-GCM)
 * - Legacy sealed box format ("sbx:" prefix with base64url)
 * - Plain tokens (returned as-is for backward compatibility)
 *
 * @param stored - The stored value (encrypted envelope JSON string or legacy format)
 * @param context - Context information (currently only purpose is used)
 * @returns The decrypted plaintext secret
 */
export function decryptSecret(
  stored: string,
  context: EncryptionContext,
): string {
  if (!stored || typeof stored !== "string") {
    throw new Error("decryptSecret: stored must be a non-empty string");
  }

  // Check if it's a legacy format
  if (isLegacyFormat(stored)) {
    // Handle legacy format - decrypt sealed box or return as-is
    return decryptLegacySealedBox(stored);
  }

  // Parse envelope
  let envelope: EncryptedSecretEnvelope;
  try {
    const parsed = JSON.parse(stored);
    envelope = parsed as EncryptedSecretEnvelope;
  } catch (error) {
    // If JSON parse fails, treat as legacy
    return decryptLegacySealedBox(stored);
  }

  // Validate envelope structure
  if (typeof envelope.v !== "number") {
    // Unknown version or malformed - treat as legacy
    return decryptLegacySealedBox(stored);
  }

  // Handle v1 envelope
  if (envelope.v === 1) {
    if (envelope.alg !== "aes-256-gcm") {
      throw new Error(
        `Unsupported encryption algorithm in envelope: ${envelope.alg}`,
      );
    }

    // Get encryption key
    const key = getEncryptionKey();

    // Decode IV, ciphertext, and tag
    let iv: Buffer;
    let ciphertext: Buffer;
    let tag: Buffer;

    try {
      iv = Buffer.from(envelope.iv, "base64");
      ciphertext = Buffer.from(envelope.cipher, "base64");
      tag = Buffer.from(envelope.tag, "base64");
    } catch (error) {
      throw new Error(
        `Failed to decode envelope components: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Create decipher
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    // Decrypt
    try {
      let decrypted = decipher.update(ciphertext, undefined, "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      // Decryption failed - could be wrong key or tampered data
      throw new Error(
        `Decryption failed: ${error instanceof Error ? error.message : String(error)}. ` +
          `This may indicate a wrong encryption key or tampered data.`,
      );
    }
  }

  // Unknown version
  throw new Error(`Unsupported envelope version: ${envelope.v}`);
}

