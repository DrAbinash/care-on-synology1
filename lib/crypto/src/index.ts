import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const IV_LEN = 16;
const SALT_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ITERATIONS = 100_000;

/**
 * Derive a 32-byte AES key from a secret string using PBKDF2-SHA256.
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LEN, "sha256");
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM using a key derived from the given secret.
 * Returns a base64-encoded envelope containing salt + iv + authTag + ciphertext.
 */
export function encryptWithSecret(plaintext: string, secret: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = Buffer.concat([salt, iv, tag, ciphertext]);
  return envelope.toString("base64");
}

/**
 * Decrypt an envelope produced by encryptWithSecret.
 * Throws if the secret is wrong or the ciphertext was tampered with.
 */
export function decryptWithSecret(envelopeB64: string, secret: string): string {
  const envelope = Buffer.from(envelopeB64, "base64");
  if (envelope.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted envelope: too short");
  }

  const salt = envelope.subarray(0, SALT_LEN);
  const iv = envelope.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = envelope.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const key = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Convenience: reads SESSION_SECRET from process.env. Throws if missing.
 */
function getBackupSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET not set — cannot encrypt/decrypt backups");
  return s;
}

/** Encrypt backup JSON using the runtime SESSION_SECRET. */
export function encryptBackup(plaintext: string): string {
  return encryptWithSecret(plaintext, getBackupSecret());
}

/** Decrypt backup envelope using the runtime SESSION_SECRET. */
export function decryptBackup(envelopeB64: string): string {
  return decryptWithSecret(envelopeB64, getBackupSecret());
}

// ─── AES-256-CBC (legacy) ─────────────────────────────────────────
// Used by the API server for AI provider API keys. Format: iv_hex:ciphertext_hex

function getCbcKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "default-fallback-ai-key-change-in-production";
  return crypto.createHash("sha256").update(secret).digest();
}

/** AES-256-CBC decrypt. Input: "iv_hex:ciphertext_hex" (produced by encryptSecret). */
export function decryptSecret(ciphertext: string): string {
  const key = getCbcKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 2) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(parts[0], "hex");
  const enc = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
