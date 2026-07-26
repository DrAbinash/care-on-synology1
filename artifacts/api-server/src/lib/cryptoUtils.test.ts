// Credentials encryption tests (WhatsApp access token / app secret storage).
// Pure crypto, no DB — only needs SESSION_SECRET, which the key derivation
// requires and refuses to fall back on.
import { describe, it, expect, beforeAll } from "vitest";

process.env.SESSION_SECRET ||= "test-session-secret-for-cryptoUtils-spec";

let encryptSecret: typeof import("./cryptoUtils").encryptSecret;
let decryptSecret: typeof import("./cryptoUtils").decryptSecret;
let decryptSecretTolerant: typeof import("./cryptoUtils").decryptSecretTolerant;
beforeAll(async () => {
  const mod = await import("./cryptoUtils");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  decryptSecretTolerant = mod.decryptSecretTolerant;
});

describe("encryptSecret / decryptSecret (WhatsApp accessToken / appSecret storage)", () => {
  it("round-trips a plaintext value exactly", () => {
    const plaintext = "EAAJk1234567890examplemetatoken";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("never returns the complete secret in the ciphertext itself", () => {
    const plaintext = "super-secret-app-secret-value";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("produces a different ciphertext each time (random IV — not a fixed/replayable digest)", () => {
    const plaintext = "same-token-twice";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("uses the iv_hex:ciphertext_hex format", () => {
    const ciphertext = encryptSecret("anything");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV as hex
  });

  it("decryptSecret throws on a malformed ciphertext (no silent corruption)", () => {
    expect(() => decryptSecret("not-a-valid-ciphertext")).toThrow();
  });
});

describe("decryptSecretTolerant (legacy pre-encryption rows)", () => {
  it("decrypts real ciphertext produced by encryptSecret", () => {
    const plaintext = "a-real-access-token";
    expect(decryptSecretTolerant(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("passes through a legacy plaintext value unchanged instead of throwing", () => {
    // A pre-encryption-era row: a raw token with no ':' separator.
    const legacyPlaintext = "EAAJklegacyplaintexttoken";
    expect(decryptSecretTolerant(legacyPlaintext)).toBe(legacyPlaintext);
  });

  it("never throws on empty/null/undefined input", () => {
    expect(decryptSecretTolerant("")).toBe("");
    expect(decryptSecretTolerant(null)).toBe("");
    expect(decryptSecretTolerant(undefined)).toBe("");
  });

  it("never throws on a garbage value that merely happens to contain a colon", () => {
    expect(() => decryptSecretTolerant("not:hex:either")).not.toThrow();
  });
});
