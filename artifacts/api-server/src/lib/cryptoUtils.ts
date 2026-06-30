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
