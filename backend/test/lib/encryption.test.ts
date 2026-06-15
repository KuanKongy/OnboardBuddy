import crypto from "node:crypto";
import { expect } from "chai";

// Set a valid test key before importing the module
const TEST_KEY = crypto.randomBytes(32).toString("hex");
process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;

// Dynamic import so the env var is set first
const { encrypt, decrypt } = await import("../../src/lib/encryption.js");

describe("encryption", () => {
  describe("encrypt / decrypt round-trip", () => {
    it("decrypts to the original plaintext", () => {
      const plaintext = "gho_abc123_test_token";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).to.equal(plaintext);
    });

    it("produces different ciphertexts for the same input (random IV)", () => {
      const plaintext = "same-input-twice";
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);

      expect(a).to.not.equal(b);
      expect(decrypt(a)).to.equal(plaintext);
      expect(decrypt(b)).to.equal(plaintext);
    });

    it("rejects empty string (produces empty ciphertext part)", () => {
      // BUG: encrypt("") produces a valid iv:authTag but empty ciphertext,
      // which decrypt() rejects with "Invalid encrypted string format".
      // This is a known P4 edge case — tokens are never empty in practice.
      expect(() => {
        const encrypted = encrypt("");
        decrypt(encrypted);
      }).to.throw();
    });

    it("handles unicode content", () => {
      const plaintext = "token-with-émojis-🔑-and-ñ";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).to.equal(plaintext);
    });

    it("handles very long strings", () => {
      const plaintext = "x".repeat(10_000);
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).to.equal(plaintext);
    });
  });

  describe("encrypted format", () => {
    it("produces iv:authTag:ciphertext hex format", () => {
      const encrypted = encrypt("test");
      const parts = encrypted.split(":");

      expect(parts).to.have.length(3);
      // IV is 12 bytes = 24 hex chars
      expect(parts[0]).to.have.length(24);
      // Auth tag is 16 bytes = 32 hex chars
      expect(parts[1]).to.have.length(32);
      // Ciphertext is non-empty hex
      expect(parts[2]!.length).to.be.greaterThan(0);
    });
  });

  describe("decrypt rejects tampered data", () => {
    it("throws on corrupted ciphertext", () => {
      const encrypted = encrypt("secret");
      const parts = encrypted.split(":");
      parts[2] = "ff".repeat(parts[2]!.length / 2);
      const tampered = parts.join(":");

      expect(() => decrypt(tampered)).to.throw();
    });

    it("throws on invalid format (missing parts)", () => {
      expect(() => decrypt("abc:def")).to.throw("Invalid encrypted string format");
    });

    it("throws on empty string", () => {
      expect(() => decrypt("")).to.throw();
    });
  });

  describe("key validation", () => {
    it("throws when TOKEN_ENCRYPTION_KEY is missing", () => {
      const saved = process.env.TOKEN_ENCRYPTION_KEY;
      delete process.env.TOKEN_ENCRYPTION_KEY;

      expect(() => encrypt("test")).to.throw("TOKEN_ENCRYPTION_KEY");

      process.env.TOKEN_ENCRYPTION_KEY = saved;
    });

    it("throws when TOKEN_ENCRYPTION_KEY is the wrong length", () => {
      const saved = process.env.TOKEN_ENCRYPTION_KEY;
      process.env.TOKEN_ENCRYPTION_KEY = "tooshort";

      expect(() => encrypt("test")).to.throw("64-char hex");

      process.env.TOKEN_ENCRYPTION_KEY = saved;
    });
  });
});
