import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as crypto from "crypto";
import { encryptSecret, decryptSecret } from "@cliply/shared/crypto/encryptedSecretEnvelope";
import { clearEnvCache } from "@cliply/shared/env";

describe("encryptedSecretEnvelope", () => {
  // Generate a valid 32-byte key for testing
  const validKey = crypto.randomBytes(32).toString("base64");

  beforeAll(() => {
    // Clear env cache to allow setting test env vars
    clearEnvCache();
    process.env.TIKTOK_ENCRYPTION_KEY = validKey;
  });

  afterAll(() => {
    delete process.env.TIKTOK_ENCRYPTION_KEY;
    clearEnvCache();
  });

  describe("encryptSecret", () => {
    it("encrypts plaintext and returns JSON envelope", () => {
      const plaintext = "test-tiktok-token-12345";
      const encrypted = encryptSecret(plaintext, { purpose: "tiktok_token" });

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");

      // Should be valid JSON
      const envelope = JSON.parse(encrypted);
      expect(envelope).toHaveProperty("v", 1);
      expect(envelope).toHaveProperty("alg", "aes-256-gcm");
      expect(envelope).toHaveProperty("iv");
      expect(envelope).toHaveProperty("cipher");
      expect(envelope).toHaveProperty("tag");

      // IV, cipher, and tag should be base64 strings
      expect(typeof envelope.iv).toBe("string");
      expect(typeof envelope.cipher).toBe("string");
      expect(typeof envelope.tag).toBe("string");
    });

    it("produces different ciphertext for same plaintext (due to random IV)", () => {
      const plaintext = "same-token";
      const encrypted1 = encryptSecret(plaintext, { purpose: "tiktok_token" });
      const encrypted2 = encryptSecret(plaintext, { purpose: "tiktok_token" });

      // Should be different due to random IV
      expect(encrypted1).not.toBe(encrypted2);

      const envelope1 = JSON.parse(encrypted1);
      const envelope2 = JSON.parse(encrypted2);

      // IVs should be different
      expect(envelope1.iv).not.toBe(envelope2.iv);
      // Ciphertexts should be different
      expect(envelope1.cipher).not.toBe(envelope2.cipher);
    });

    it("throws error for empty plaintext", () => {
      expect(() => {
        encryptSecret("", { purpose: "tiktok_token" });
      }).toThrow("plaintext must be a non-empty string");
    });

    it("throws error when TIKTOK_ENCRYPTION_KEY is missing", () => {
      delete process.env.TIKTOK_ENCRYPTION_KEY;
      clearEnvCache();

      expect(() => {
        encryptSecret("test-token", { purpose: "tiktok_token" });
      }).toThrow("TIKTOK_ENCRYPTION_KEY is not configured");

      // Restore key for other tests
      process.env.TIKTOK_ENCRYPTION_KEY = validKey;
      clearEnvCache();
    });

    it("throws error when TIKTOK_ENCRYPTION_KEY is wrong length", () => {
      process.env.TIKTOK_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
      clearEnvCache();

      expect(() => {
        encryptSecret("test-token", { purpose: "tiktok_token" });
      }).toThrow("must decode to exactly 32 bytes");

      // Restore key for other tests
      process.env.TIKTOK_ENCRYPTION_KEY = validKey;
      clearEnvCache();
    });
  });

  describe("decryptSecret", () => {
    it("decrypts encrypted envelope back to original plaintext", () => {
      const plaintext = "test-tiktok-token-12345";
      const encrypted = encryptSecret(plaintext, { purpose: "tiktok_token" });
      const decrypted = decryptSecret(encrypted, { purpose: "tiktok_token" });

      expect(decrypted).toBe(plaintext);
    });

    it("handles roundtrip for various token formats", () => {
      const tokens = [
        "simple-token",
        "token-with-special-chars-!@#$%^&*()",
        "very-long-token-" + "a".repeat(1000),
        "token-with-newlines\nand\t tabs",
      ];

      for (const token of tokens) {
        const encrypted = encryptSecret(token, { purpose: "tiktok_token" });
        const decrypted = decryptSecret(encrypted, { purpose: "tiktok_token" });
        expect(decrypted).toBe(token);
      }
    });

    it("supports legacy sealed box format (sbx: prefix)", () => {
      const legacyToken = "legacy-base64-or-raw-token";
      const legacySealedBox = `sbx:${Buffer.from(legacyToken).toString("base64url")}`;

      const decrypted = decryptSecret(legacySealedBox, { purpose: "tiktok_token" });
      expect(decrypted).toBe(legacyToken);
    });

    it("supports legacy plain token (no prefix)", () => {
      const plainToken = "legacy-plain-token";
      const decrypted = decryptSecret(plainToken, { purpose: "tiktok_token" });
      expect(decrypted).toBe(plainToken);
    });

    it("throws error when decryption fails (wrong key)", () => {
      // Encrypt with one key
      const plaintext = "test-token";
      const encrypted = encryptSecret(plaintext, { purpose: "tiktok_token" });

      // Try to decrypt with different key
      const wrongKey = crypto.randomBytes(32).toString("base64");
      process.env.TIKTOK_ENCRYPTION_KEY = wrongKey;
      clearEnvCache();

      expect(() => {
        decryptSecret(encrypted, { purpose: "tiktok_token" });
      }).toThrow("Decryption failed");

      // Restore original key
      process.env.TIKTOK_ENCRYPTION_KEY = validKey;
      clearEnvCache();
    });

    it("throws error for tampered envelope (modified ciphertext)", () => {
      const plaintext = "test-token";
      const encrypted = encryptSecret(plaintext, { purpose: "tiktok_token" });
      const envelope = JSON.parse(encrypted);

      // Tamper with ciphertext (flip a bit)
      const cipherBytes = Buffer.from(envelope.cipher, "base64");
      cipherBytes[0] = cipherBytes[0] ^ 1; // Flip first bit
      envelope.cipher = cipherBytes.toString("base64");

      const tampered = JSON.stringify(envelope);

      expect(() => {
        decryptSecret(tampered, { purpose: "tiktok_token" });
      }).toThrow("Decryption failed");
    });

    it("throws error for tampered envelope (modified tag)", () => {
      const plaintext = "test-token";
      const encrypted = encryptSecret(plaintext, { purpose: "tiktok_token" });
      const envelope = JSON.parse(encrypted);

      // Tamper with tag (flip a bit)
      const tagBytes = Buffer.from(envelope.tag, "base64");
      tagBytes[0] = tagBytes[0] ^ 1; // Flip first bit
      envelope.tag = tagBytes.toString("base64");

      const tampered = JSON.stringify(envelope);

      expect(() => {
        decryptSecret(tampered, { purpose: "tiktok_token" });
      }).toThrow("Decryption failed");
    });

    it("handles unknown envelope version gracefully", () => {
      const envelope = {
        v: 999, // Unknown version
        alg: "aes-256-gcm",
        iv: "dGVzdA==",
        cipher: "dGVzdA==",
        tag: "dGVzdA==",
      };

      expect(() => {
        decryptSecret(JSON.stringify(envelope), { purpose: "tiktok_token" });
      }).toThrow("Unsupported envelope version: 999");
    });

    it("handles invalid envelope structure gracefully", () => {
      const invalidEnvelope = { not_an_envelope: true };

      // Should treat as legacy format
      const result = decryptSecret(JSON.stringify(invalidEnvelope), {
        purpose: "tiktok_token",
      });
      expect(typeof result).toBe("string");
    });

    it("handles malformed JSON as legacy format", () => {
      const malformed = "not-json-at-all";
      const result = decryptSecret(malformed, { purpose: "tiktok_token" });
      expect(result).toBe(malformed);
    });
  });

  describe("backward compatibility", () => {
    it("migrates legacy tokens to encrypted format on refresh", () => {
      // Simulate reading a legacy token
      const legacyToken = "legacy-sealed-box-token";
      const legacyFormat = `sbx:${Buffer.from(legacyToken).toString("base64url")}`;

      // Can still decrypt it
      const decrypted = decryptSecret(legacyFormat, { purpose: "tiktok_token" });
      expect(decrypted).toBe(legacyToken);

      // After refresh, it should be stored in new encrypted format
      const newEncrypted = encryptSecret(legacyToken, { purpose: "tiktok_token" });
      const envelope = JSON.parse(newEncrypted);
      expect(envelope.v).toBe(1);
      expect(envelope.alg).toBe("aes-256-gcm");

      // And can be decrypted back
      const reDecrypted = decryptSecret(newEncrypted, { purpose: "tiktok_token" });
      expect(reDecrypted).toBe(legacyToken);
    });
  });
});

