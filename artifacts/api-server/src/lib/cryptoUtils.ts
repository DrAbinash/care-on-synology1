import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "default-fallback-ai-key-change-in-production";
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
