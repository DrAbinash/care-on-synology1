import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getEncryptionKey(): Buffer {
  // No fallback — docker-compose.yml's SESSION_SECRET:? guard already
  // refuses to start the API container if this is unset, so a fallback
  // here only adds risk (a hardcoded key visible in source) with no
  // benefit. Fail loudly instead of silently using a known key.
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Refusing to derive an encryption key.");
  }
  return createHash("sha256").update(secret).digest();
}

/** AES-256-CBC encrypt a plaintext string. Returns "iv_hex:ciphertext_hex". */
export function encryptSecret(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/** AES-256-CBC decrypt a ciphertext produced by encryptSecret. */
export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 2) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(parts[0], "hex");
  const enc = Buffer.from(parts[1], "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Decrypt a value that MAY be ciphertext from encryptSecret, or MAY be a
 * legacy plaintext value saved before encryption was applied to this field
 * (see SECURITY_FINDINGS_REAUDIT.md Finding 3 — WhatsApp access tokens were
 * stored unencrypted for an unknown period; this lets existing rows keep
 * working immediately after the encryption fix ships, rather than breaking
 * every already-configured WhatsApp number until someone re-saves it).
 *
 * Real secrets (API tokens, access tokens) reliably never contain a literal
 * ":" character, while encryptSecret's output always does (iv_hex:cipher_hex)
 * — so a failed decrypt (wrong format, or a value that doesn't look like our
 * ciphertext shape) is treated as "this was never encrypted," and the
 * original value is returned as-is rather than throwing.
 *
 * This is intentionally permissive — it must never throw, since it sits in
 * read paths that resolve credentials used to actually send messages; a
 * thrown error here would silently break WhatsApp sending for any
 * not-yet-re-saved row, which is worse than briefly tolerating a legacy
 * plaintext value.
 */
export function decryptSecretTolerant(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decryptSecret(value);
  } catch {
    return value;
  }
}
