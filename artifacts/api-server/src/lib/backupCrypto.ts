/**
 * backupCrypto.ts — ONE encryption/decryption contract for every backup.
 *
 * WHY THIS EXISTS
 *   The product used to have two mutually-incompatible backup crypto schemes:
 *
 *     1. scripts/synology-backup.sh + synology-restore.sh + restoreVerification.ts
 *        → openssl `enc -aes-256-cbc -salt -pbkdf2`, passphrase BACKUP_PASSPHRASE.
 *          This one round-trips: the restore script can open what the backup
 *          script wrote.
 *
 *     2. cron.ts's scheduled backups → encryptBackup() from @workspace/crypto
 *        → AES-256-GCM, key derived from SESSION_SECRET, custom base64 envelope
 *          [salt|iv|tag|ciphertext].
 *
 *   Scheme 2 was WRITE-ONLY. decryptBackup() had zero callers, restoreVerification
 *   tried to open those files with openssl/CBC/BACKUP_PASSPHRASE (wrong cipher,
 *   wrong key, wrong container, wrong encoding), synology-restore.sh failed for
 *   the same reasons, and the in-app restore piped the ciphertext straight into
 *   `psql --file`. Every scheduled backup was therefore unrestorable.
 *
 * WHAT THIS MODULE DOES
 *   - Standardizes NEW backups on the openssl-compatible format (scheme 1), so a
 *     single restore path — in-app, restore-verification, or the Synology shell
 *     script on a bare machine with nothing but openssl — can open them.
 *   - Still decrypts LEGACY scheme-2 files, so backups already sitting on a NAS
 *     from before this fix are recoverable instead of being permanently opaque.
 *   - Shells out to the openssl binary rather than re-implementing its
 *     `Salted__` + PBKDF2 key derivation in Node, which guarantees byte-level
 *     compatibility with the shell scripts instead of merely intending it.
 *
 * PASSPHRASE
 *   BACKUP_PASSPHRASE when set (what the Synology scripts use), otherwise
 *   SESSION_SECRET. Backups are never written unencrypted just because the
 *   dedicated passphrase is missing, and the log records WHICH key was used so
 *   an operator restoring months later knows what to supply. Decryption tries
 *   both, so rotating from SESSION_SECRET to a real BACKUP_PASSPHRASE does not
 *   strand older files.
 */

import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { decryptWithSecret } from "@workspace/crypto";

/** openssl `enc -salt` writes this 8-byte magic, then an 8-byte salt. */
const OPENSSL_MAGIC = Buffer.from("Salted__", "utf8");

export type BackupKeySource = "BACKUP_PASSPHRASE" | "SESSION_SECRET";
export type BackupCipherFormat = "openssl-aes-256-cbc" | "legacy-gcm-envelope" | "plaintext";

export interface BackupPassphrase {
  passphrase: string;
  source: BackupKeySource;
}

/**
 * The passphrase new backups are encrypted with. Returns null only when the
 * process has neither BACKUP_PASSPHRASE nor SESSION_SECRET, in which case the
 * caller must fail the backup rather than silently write plaintext.
 */
export function resolveBackupPassphrase(env: NodeJS.ProcessEnv = process.env): BackupPassphrase | null {
  const dedicated = env["BACKUP_PASSPHRASE"];
  if (dedicated && dedicated.trim()) return { passphrase: dedicated, source: "BACKUP_PASSPHRASE" };
  const session = env["SESSION_SECRET"];
  if (session && session.trim()) return { passphrase: session, source: "SESSION_SECRET" };
  return null;
}

/** Every passphrase worth trying on decrypt, best guess first, de-duplicated. */
export function candidatePassphrases(env: NodeJS.ProcessEnv = process.env): BackupPassphrase[] {
  const out: BackupPassphrase[] = [];
  const dedicated = env["BACKUP_PASSPHRASE"];
  const session = env["SESSION_SECRET"];
  if (dedicated && dedicated.trim()) out.push({ passphrase: dedicated, source: "BACKUP_PASSPHRASE" });
  if (session && session.trim() && session !== dedicated) out.push({ passphrase: session, source: "SESSION_SECRET" });
  return out;
}

function runOpenssl(args: string[], passphrase: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    // env: (not pass:) so the passphrase never appears in the process argv,
    // which is world-readable via /proc on a shared host.
    const child = spawn("openssl", args, {
      env: { ...process.env, CARE_BACKUP_PASS: passphrase },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += String(c); });
    child.on("error", (err) => resolve({ code: -1, stderr: `openssl failed to start: ${err.message}` }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/**
 * Encrypt `inPath` to `outPath` in the openssl-compatible format the Synology
 * restore script and restoreVerification both already understand.
 *
 * File→file (not string→string): a full clinic dump must never be pulled into a
 * JS string first — the old cron path did readFileSync(dump, "utf-8") and would
 * blow up on a database larger than the heap.
 */
export async function encryptBackupFile(
  inPath: string,
  outPath: string,
  key: BackupPassphrase,
): Promise<{ format: BackupCipherFormat; keySource: BackupKeySource }> {
  const res = await runOpenssl(
    ["enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "env:CARE_BACKUP_PASS", "-in", inPath, "-out", outPath],
    key.passphrase,
  );
  if (res.code !== 0) {
    throw new Error(`Backup encryption failed (openssl exit ${res.code}): ${res.stderr.trim()}`);
  }
  const stat = await fs.stat(outPath).catch(() => null);
  if (!stat || stat.size === 0) {
    throw new Error("Backup encryption produced an empty file — refusing to record it as a completed backup");
  }
  return { format: "openssl-aes-256-cbc", keySource: key.source };
}

/** True when the file begins with openssl's `Salted__` header. */
export async function isOpensslEncrypted(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buf = Buffer.alloc(OPENSSL_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, OPENSSL_MAGIC.length, 0);
    return bytesRead === OPENSSL_MAGIC.length && buf.equals(OPENSSL_MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Heuristic for the legacy scheme-2 envelope: base64 text, no SQL keywords.
 * A plain pg_dump always contains SQL early on, so this cannot misfire on one.
 */
async function looksLikeLegacyEnvelope(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, 512, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    if (/^\s*(--|\/\*|SET |BEGIN|CREATE|DROP|INSERT|COPY|ALTER)/i.test(head)) return false;
    return /^[A-Za-z0-9+/=\r\n]+$/.test(head) && bytesRead > 0;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * True when a decrypted openssl artifact looks like usable SQL (pg_dump-ish).
 * Wrong AES-CBC passphrases often still exit 0 and emit binary garbage — without
 * this check we would hand that garbage to psql / report the wrong keySource.
 */
async function looksLikeSqlDump(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, 512, 0);
    if (bytesRead === 0) return false;
    // Reject high-bit / NUL-heavy binary (typical wrong-key CBC output).
    let weird = 0;
    for (let i = 0; i < bytesRead; i++) {
      const c = buf[i]!;
      if (c === 0 || c > 0x7f) weird++;
    }
    if (weird > bytesRead / 8) return false;
    const head = buf.subarray(0, bytesRead).toString("utf8");
    return /^\s*(--|\/\*|SET |BEGIN|CREATE|DROP|INSERT|COPY|ALTER|SELECT|\\\\restrict)/i.test(head)
      || /CREATE\s+TABLE/i.test(head);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export interface DecryptOutcome {
  /** Path to usable plaintext SQL — equals the input when it was never encrypted. */
  sqlPath: string;
  format: BackupCipherFormat;
  keySource: BackupKeySource | null;
  /** True when a new temp file was written and the caller must clean it up. */
  producedTempFile: boolean;
}

/**
 * Turn any backup artifact this product has ever written into plaintext SQL.
 *
 * Handles, in order: openssl AES-256-CBC (current format, either passphrase),
 * the legacy SESSION_SECRET GCM envelope, and already-plaintext dumps (returned
 * untouched). Throws with an actionable message when nothing can open it —
 * never returns ciphertext that would later be fed to psql as if it were SQL.
 */
export async function decryptBackupToSql(
  filePath: string,
  tempDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DecryptOutcome> {
  if (await isOpensslEncrypted(filePath)) {
    const candidates = candidatePassphrases(env);
    if (candidates.length === 0) {
      throw new Error("Backup is encrypted but neither BACKUP_PASSPHRASE nor SESSION_SECRET is set — cannot decrypt.");
    }
    const base = path.basename(filePath).replace(/\.enc$/i, "");
    const out = path.join(tempDir, `decrypted-${Date.now()}-${base}`);
    const errors: string[] = [];
    for (const key of candidates) {
      const res = await runOpenssl(
        ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "env:CARE_BACKUP_PASS", "-in", filePath, "-out", out],
        key.passphrase,
      );
      if (res.code === 0 && await looksLikeSqlDump(out)) {
        return { sqlPath: out, format: "openssl-aes-256-cbc", keySource: key.source, producedTempFile: true };
      }
      if (res.code === 0) {
        errors.push(`${key.source}: openssl exited 0 but output is not SQL (wrong passphrase?)`);
      } else {
        errors.push(`${key.source}: ${res.stderr.trim() || `exit ${res.code}`}`);
      }
      await fs.unlink(out).catch(() => {});
    }
    throw new Error(
      `Could not decrypt backup with any configured passphrase. Tried ${errors.join(" | ")}. ` +
      "If this file came from another deployment, restore it with scripts/synology-restore.sh and that deployment's BACKUP_PASSPHRASE.",
    );
  }

  if (await looksLikeLegacyEnvelope(filePath)) {
    // Legacy scheme-2 file written by the old cron path (AES-256-GCM keyed on
    // SESSION_SECRET). Nothing used to decrypt these — that is what made them
    // unrestorable.
    //
    // decryptWithSecret (not decryptBackup) so the secret comes from the `env`
    // this function was given: decryptBackup() reads process.env.SESSION_SECRET
    // internally, which would silently ignore the caller's env and make this
    // branch untestable and inconsistent with the openssl branch above.
    // Every candidate is tried, so a deployment that has since moved its secret
    // into BACKUP_PASSPHRASE can still open an old envelope.
    const raw = (await fs.readFile(filePath, "utf8")).trim();
    const secrets = candidatePassphrases(env);
    if (secrets.length === 0) {
      throw new Error("Backup looks like a legacy encrypted envelope but no SESSION_SECRET/BACKUP_PASSPHRASE is set to open it.");
    }
    let plaintext: string | null = null;
    const failures: string[] = [];
    for (const key of secrets) {
      try {
        plaintext = decryptWithSecret(raw, key.passphrase);
        break;
      } catch (err) {
        failures.push(`${key.source}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (plaintext === null) {
      throw new Error(
        "Backup looks like a legacy encrypted envelope but could not be decrypted with any configured secret " +
        `(${failures.join(" | ")}). It was encrypted with the SESSION_SECRET that was active when the backup ran; ` +
        "restore that value to recover this file.",
      );
    }
    const out = path.join(tempDir, `decrypted-legacy-${Date.now()}.sql`);
    await fs.writeFile(out, plaintext, "utf8");
    return { sqlPath: out, format: "legacy-gcm-envelope", keySource: "SESSION_SECRET", producedTempFile: true };
  }

  return { sqlPath: filePath, format: "plaintext", keySource: null, producedTempFile: false };
}
