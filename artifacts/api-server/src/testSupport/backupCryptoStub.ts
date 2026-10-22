/**
 * A truthful stand-in for lib/backupCrypto's encryption half, shared by the cron suites.
 *
 * WHY THIS EXISTS
 *   `cron.test.ts` and `cronBackupScheduling.test.ts` both mock `./lib/backupCrypto` because the
 *   unit under test is `fireScheduledBackups`, not openssl. When the backup job grew a round-trip
 *   verification step, a mock that returned nothing for it would have let cron "verify" whatever it
 *   liked — a stub that always says YES cannot detect a runner that ignores the answer, which is
 *   precisely the defect this code fixes. So the stub here re-does the real arithmetic: it opens the
 *   envelope the stub encryptor wrote, hashes what is left, and compares it to the digest the run
 *   claims, returning the same `reason` vocabulary as the real verifier.
 *
 * `roundTripStub.impl` is the seam a test uses to force a failure. Every test that reassigns it must
 * restore it, which is what `resetRoundTripStub()` is for.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface StubRoundTripResult {
  ok: boolean;
  reason: "verified" | "artifact_missing" | "artifact_empty" | "decrypt_failed" | "hash_mismatch" | "byte_count_mismatch" | "not_sql";
  detail: string;
  keySource: string;
  ciphertextBytes: number | null;
  decryptedBytes: number;
  decryptedSha256: string | null;
  expectedPlaintextSha256: string;
  plaintextBytes: number | null;
}

export interface StubRoundTripOptions {
  cipherPath: string;
  expectedPlaintextSha256: string;
  plaintextBytes?: number | null;
  key: { source: string };
  expectSql?: boolean;
}

/** The envelope `encryptFileStub` writes: `encrypted:` + the plaintext. */
export const ENVELOPE = "encrypted:";

export function encryptFileStub(inPath: string, outPath: string, write: (p: string, data: string) => void): { format: string; keySource: string } {
  write(outPath, `${ENVELOPE}${readFileSync(inPath, "utf-8")}`);
  return { format: "openssl-aes-256-cbc", keySource: "BACKUP_PASSPHRASE" };
}

export function sha256FileStub(p: string): { hex: string; bytes: number } {
  const buf = readFileSync(p);
  return { hex: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

/** The default: honest, and able to say no. */
export function defaultRoundTripStub(opts: StubRoundTripOptions): StubRoundTripResult {
  const expected = opts.expectedPlaintextSha256;
  const keySource = opts.key.source;
  const plaintextBytes = opts.plaintextBytes ?? null;
  const result = (ok: boolean, reason: StubRoundTripResult["reason"], detail: string, decryptedBytes = 0, decryptedSha256: string | null = null, ciphertextBytes: number | null = null): StubRoundTripResult =>
    ({ ok, reason, detail, keySource, ciphertextBytes, decryptedBytes, decryptedSha256, expectedPlaintextSha256: expected, plaintextBytes });

  let cipher: string;
  try {
    cipher = readFileSync(opts.cipherPath, "utf-8");
  } catch (err) {
    return result(false, "artifact_missing", `stat/read failed: ${(err as NodeJS.ErrnoException)?.code ?? "unreadable"}`);
  }
  const ciphertextBytes = Buffer.byteLength(cipher);
  if (ciphertextBytes === 0) return result(false, "artifact_empty", "the encrypted artifact is 0 bytes", 0, null, ciphertextBytes);
  if (!cipher.startsWith(ENVELOPE)) return result(false, "not_sql", "the artifact is not in the envelope this writer produces", 0, null, ciphertextBytes);

  const plain = cipher.slice(ENVELOPE.length);
  const decryptedBytes = Buffer.byteLength(plain);
  const hex = createHash("sha256").update(plain).digest("hex");
  if (plaintextBytes != null && decryptedBytes !== plaintextBytes) {
    return result(false, "byte_count_mismatch", `the artifact decrypts to ${decryptedBytes} bytes but the dump wrote ${plaintextBytes}`, decryptedBytes, hex, ciphertextBytes);
  }
  if (hex !== expected) {
    return result(false, "hash_mismatch", `the artifact decrypts to ${hex.slice(0, 12)} where the dump was ${expected.slice(0, 12)}`, decryptedBytes, hex, ciphertextBytes);
  }
  return result(true, "verified", `decrypt-verified: ${decryptedBytes} bytes re-read and hashed to the digest the dump produced`, decryptedBytes, hex, ciphertextBytes);
}

export const roundTripStub: { impl: (opts: StubRoundTripOptions) => StubRoundTripResult | Promise<StubRoundTripResult> } = {
  impl: defaultRoundTripStub,
};

export function resetRoundTripStub(): void {
  roundTripStub.impl = defaultRoundTripStub;
}
