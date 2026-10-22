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
import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
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
 * The one definition of "these bytes look like the start of a SQL dump".
 *
 * Extracted because TWO places have to answer it — the file-based check below, and the streaming
 * round-trip verifier, which never has the whole plaintext on disk — and a divergence between them
 * would mean the write path and the read path disagree about what a usable backup is.
 *
 * Wrong AES-CBC passphrases often still exit 0 and emit binary garbage; this is what stops that
 * garbage being handed to psql or reported as a successful decrypt.
 */
export function headLooksLikeSqlDump(buf: Buffer): boolean {
  const n = buf.length;
  if (n === 0) return false;
  // Reject high-bit / NUL-heavy binary (typical wrong-key CBC output).
  let weird = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i]!;
    if (c === 0 || c > 0x7f) weird++;
  }
  if (weird > n / 8) return false;
  const head = buf.toString("utf8");
  // `\\+restrict`, not `\\\\restrict`: pg_dump 16 writes a single leading backslash
  // (`\restrict "public.patients";`). Requiring two silently excluded the newest dumps' own
  // preamble from what this function calls a usable backup.
  return /^\s*(--|\/\*|SET |BEGIN|CREATE|DROP|INSERT|COPY|ALTER|SELECT|\\+restrict)/i.test(head)
    || /CREATE\s+TABLE/i.test(head);
}

/**
 * True when a decrypted openssl artifact looks like usable SQL (pg_dump-ish).
 */
async function looksLikeSqlDump(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, 512, 0);
    return headLooksLikeSqlDump(buf.subarray(0, bytesRead));
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

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip proof: does the artifact actually open, and does it open to THE
// BYTES that were archived?
//
// WHY THIS EXISTS
//   `encryptBackupFile()` already refuses to return when openssl exits non-zero or writes an empty
//   file, so an encryption that failed LOUDLY could never be recorded as a backup. What nothing in
//   the product checked was the other half — that the ciphertext it just wrote can be decrypted
//   back to the bytes the dump produced. That is the only property a restore depends on, and it is
//   exactly the property both shell writers (`scripts/synology-nas-backup.sh:198-220`,
//   `scripts/synology-uploads-archive.sh:234-251`) have proved before publishing since #1023. The
//   scheduler — the writer that produced the clinic's daily artifact — was the one that did not,
//   which is why a `status="success", encrypted=true` row was evidence of a process finishing
//   rather than of a backup existing.
//
//   Two traps make "openssl exited 0" worthless on its own:
//     • AES-CBC has no integrity tag, so a WRONG PASSPHRASE still exits 0 and emits binary garbage
//       roughly 1 time in 256 (measured 1/300 with `openssl enc -d` on this format).
//     • A truncated or edited ciphertext can exit 0 too, whenever the final block's padding happens
//       to look valid.
//   Both are caught here, by comparing the SHA-256 of the decrypted stream with the hash the caller
//   computed over the plaintext dump BEFORE it was encrypted, and by comparing the byte count.
//
// WHY STREAMING
//   The shell writers decrypt to a temp file and hash that file. Here that would mean a second
//   plaintext copy of the clinic's whole database on disk beside the first one, for the length of
//   the check — and reading a ~810 MB dump into memory is how a backup job becomes an outage on a
//   16 GB box with 2 disks. So openssl's stdout is hashed as it flows: no temp plaintext, no heap
//   copy, and the only thing kept is a digest and a count. It also means the proof never puts
//   patient data anywhere the backup did not already put it.
// ─────────────────────────────────────────────────────────────────────────────

export type BackupRoundTripReason =
  | "verified"
  /** The artifact is not there (deleted, never written, wrong path). */
  | "artifact_missing"
  /** Present but zero bytes, or the decrypt produced nothing. */
  | "artifact_empty"
  /** openssl refused: wrong passphrase with a padding error, or a corrupted/too-short ciphertext. */
  | "decrypt_failed"
  /** It opened, and the bytes are not the bytes that were archived. */
  | "hash_mismatch"
  /** It opened to a different number of bytes than the dump wrote — a truncated artifact. */
  | "byte_count_mismatch"
  /** It opened with no error and the output is not SQL — the wrong-key-exits-0 case with no
   *  expected hash to compare against. */
  | "not_sql";

export interface BackupRoundTripResult {
  ok: boolean;
  reason: BackupRoundTripReason;
  /** An operator-readable sentence. Contains hashes and counts, never file contents. */
  detail: string;
  keySource: BackupKeySource;
  /** What the ciphertext actually is, so a later at-rest check has something to compare with. */
  ciphertextBytes: number | null;
  /** What the decrypted stream measured. */
  decryptedBytes: number;
  decryptedSha256: string | null;
  expectedPlaintextSha256: string;
  plaintextBytes: number | null;
}

/** SHA-256 of a file, streamed, with the byte count that produced it. Never loads the file into memory. */
export async function sha256File(inPath: string): Promise<{ hex: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  // `for await` over a read stream: one chunk at a time, so a multi-hundred-MB dump never exists in
  // memory. A stream error propagates — a file that cannot be read has no digest to report.
  const rs = createReadStream(inPath);
  for await (const chunk of rs) {
    const buf = chunk as Buffer;
    hash.update(buf);
    bytes += buf.length;
  }
  return { hex: hash.digest("hex"), bytes };
}

/**
 * Decrypt `cipherPath` with `key` and prove it is the archive of the bytes described by
 * `expectedPlaintextSha256` (and, when known, `plaintextBytes`).
 *
 * Returns a verdict rather than throwing, because the caller has to decide between "fail the run"
 * (the scheduler) and "report the state" (the page, the verifier scripts) — and both need the same
 * reason string. `detail` is safe to log, mail and put in a ticket: hashes and byte counts only.
 */
export async function verifyBackupRoundTrip(opts: {
  cipherPath: string;
  expectedPlaintextSha256: string;
  plaintextBytes?: number | null;
  key: BackupPassphrase;
  /**
   * When true (default) the first bytes of the decrypted stream must look like SQL. Pass false for
   * non-SQL artifacts — the hash comparison still decides, and it is the stronger of the two.
   */
  expectSql?: boolean;
  /** Injectable for tests; the real call is `spawn` with no shell in the path. */
  deps?: { spawn?: typeof spawn; stat?: (p: string) => Promise<{ size: number }> };
}): Promise<BackupRoundTripResult> {
  const spawnImpl = opts.deps?.spawn ?? spawn;
  const stat = opts.deps?.stat ?? ((p: string) => fs.stat(p).then((s) => ({ size: s.size })));
  const expectSql = opts.expectSql !== false;
  const short = (hex: string | null) => (hex ? hex.slice(0, 12) : "—");

  const base = {
    keySource: opts.key.source,
    decryptedBytes: 0,
    decryptedSha256: null as string | null,
    expectedPlaintextSha256: opts.expectedPlaintextSha256,
    plaintextBytes: opts.plaintextBytes ?? null,
    ciphertextBytes: null as number | null,
  };
  const verdict = (ok: boolean, reason: BackupRoundTripReason, detail: string, extra: Partial<BackupRoundTripResult> = {}): BackupRoundTripResult =>
    ({ ok, reason, detail, ...base, ...extra });

  if (!/^[0-9a-f]{64}$/.test(opts.expectedPlaintextSha256)) {
    return verdict(false, "decrypt_failed",
      `the expected plaintext digest is not a SHA-256 ("${opts.expectedPlaintextSha256.slice(0, 16)}") — refusing to call anything verified without something to compare against`);
  }

  let cipherStat;
  try {
    cipherStat = await stat(opts.cipherPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "stat failed";
    return verdict(false, "artifact_missing",
      `${code} on the encrypted artifact — there is nothing to decrypt, so this cannot be called a backup`,
      { ciphertextBytes: null });
  }
  if (cipherStat.size === 0) {
    return verdict(false, "artifact_empty", "the encrypted artifact is 0 bytes — an empty file is not a backup");
  }

  const run = await new Promise<{ code: number; stderr: string; hex: string | null; bytes: number; head: Buffer }>((resolve) => {
    // No `-out`: openssl writes the plaintext to stdout, which is hashed and then discarded. The
    // passphrase travels by environment, never in argv (`ps -ef` and a support screenshot must not
    // be enough to decrypt the clinic's database).
    const child = spawnImpl("openssl",
      ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "env:CARE_BACKUP_PASS", "-in", opts.cipherPath],
      { env: { ...process.env, CARE_BACKUP_PASS: opts.key.passphrase }, stdio: ["ignore", "pipe", "pipe"] });

    const hash = createHash("sha256");
    let bytes = 0;
    let head = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const done = (r: { code: number; stderr: string; hex: string | null; bytes: number; head: Buffer }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
      if (head.length < 512) head = Buffer.concat([head, chunk]).subarray(0, 512);
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += String(chunk); if (stderr.length > 4000) stderr = stderr.slice(0, 4000); });
    child.on("error", (err) => done({ code: -1, stderr: `openssl failed to start: ${err.message}`, hex: null, bytes, head }));
    child.on("close", (code) => {
      // A killed/unsuccessful run still gets its digest computed: the byte count is the evidence
      // (a truncated ciphertext yields fewer bytes), and discarding it would hide that.
      done({ code: code ?? -1, stderr, hex: bytes > 0 ? hash.digest("hex") : null, bytes, head });
    });
  });

  const extra = { ciphertextBytes: cipherStat.size };

  if (run.code !== 0) {
    return verdict(false, "decrypt_failed",
      `the encrypted artifact would not decrypt (${run.stderr.trim().split("\n").pop() || `exit ${run.code}`}) — wrong passphrase, or the ciphertext is corrupt or truncated`,
      { ...extra, decryptedBytes: run.bytes, decryptedSha256: run.hex });
  }
  if (run.bytes === 0) {
    return verdict(false, "artifact_empty",
      "openssl reported no error and decrypted 0 bytes — an artifact with nothing in it is not a backup", extra);
  }
  // The exit-0-with-garbage trap, when the caller has no expected digest to compare with. A hash
  // match is strictly stronger than this test, so the hash is checked first when a count mismatch
  // is not in play.
  if (expectSql && !headLooksLikeSqlDump(run.head)) {
    return verdict(false, "not_sql",
      `openssl exited 0 but the first bytes are not SQL — the wrong passphrase, or a corrupted ciphertext (CBC has no integrity tag, so this succeeds silently). ${run.bytes} bytes, sha256 ${short(run.hex)}`,
      { ...extra, decryptedBytes: run.bytes, decryptedSha256: run.hex });
  }
  if (base.plaintextBytes != null && run.bytes !== base.plaintextBytes) {
    return verdict(false, "byte_count_mismatch",
      `the artifact decrypts to ${run.bytes} bytes but the dump wrote ${base.plaintextBytes} — the artifact is truncated, or the wrong file was encrypted`,
      { ...extra, decryptedBytes: run.bytes, decryptedSha256: run.hex });
  }
  if (run.hex !== opts.expectedPlaintextSha256) {
    return verdict(false, "hash_mismatch",
      `the artifact decrypts, but to sha256 ${short(run.hex)} where the dump was ${short(opts.expectedPlaintextSha256)} — the bytes this run recorded are not the bytes it wrote, so this backup would restore the wrong data (or fail)`,
      { ...extra, decryptedBytes: run.bytes, decryptedSha256: run.hex });
  }
  return verdict(true, "verified",
    `decrypt-verified: ${run.bytes} bytes re-read from the artifact hash to ${short(run.hex)}, the digest the dump produced before encryption (key=${opts.key.source})`,
    { ...extra, decryptedBytes: run.bytes, decryptedSha256: run.hex });
}
