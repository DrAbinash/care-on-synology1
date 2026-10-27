import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { promises as fs, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { encryptBackup } from "@workspace/crypto";
import {
  encryptBackupFile, decryptBackupToSql, headLooksLikeSqlDump, isOpensslEncrypted, sha256File,
  resolveBackupPassphrase, candidatePassphrases, verifyBackupRoundTrip,
  type BackupPassphrase,
} from "./backupCrypto";

// The restore half of backup/restore had ZERO test coverage, which is exactly
// how the product shipped a scheduler that wrote backups nothing could decrypt.
// These tests exercise the actual round trip end to end (real openssl, real
// files) rather than asserting on mocks.

const TEST_DIR = path.resolve(__dirname, "../../.tmp-backup-crypto-test");
const SQL = "-- pg_dump output\nCREATE TABLE patients (id int);\nINSERT INTO patients VALUES (1);\n";

function tmp(name: string): string {
  return path.join(TEST_DIR, name);
}

/** Decrypt using the EXACT flags scripts/synology-restore.sh uses. */
function opensslDecryptLikeShellScript(inPath: string, outPath: string, passphrase: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("openssl", [
      "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", `pass:${passphrase}`, "-in", inPath, "-out", outPath,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  savedEnv = {
    BACKUP_PASSPHRASE: process.env["BACKUP_PASSPHRASE"],
    SESSION_SECRET: process.env["SESSION_SECRET"],
  };
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveBackupPassphrase / candidatePassphrases", () => {
  test("prefers BACKUP_PASSPHRASE, falls back to SESSION_SECRET", () => {
    expect(resolveBackupPassphrase({ BACKUP_PASSPHRASE: "a", SESSION_SECRET: "b" })).toEqual({ passphrase: "a", source: "BACKUP_PASSPHRASE" });
    expect(resolveBackupPassphrase({ SESSION_SECRET: "b" })).toEqual({ passphrase: "b", source: "SESSION_SECRET" });
  });

  test("returns null when neither is set — caller must fail rather than write plaintext", () => {
    expect(resolveBackupPassphrase({})).toBeNull();
    expect(resolveBackupPassphrase({ BACKUP_PASSPHRASE: "   " })).toBeNull();
  });

  test("offers both passphrases on decrypt so rotating the key does not strand old backups", () => {
    expect(candidatePassphrases({ BACKUP_PASSPHRASE: "new", SESSION_SECRET: "old" })).toEqual([
      { passphrase: "new", source: "BACKUP_PASSPHRASE" },
      { passphrase: "old", source: "SESSION_SECRET" },
    ]);
  });

  test("does not offer the same secret twice when both vars hold one value", () => {
    expect(candidatePassphrases({ BACKUP_PASSPHRASE: "same", SESSION_SECRET: "same" })).toHaveLength(1);
  });
});

describe("encrypt → decrypt round trip (the proof a backup is restorable)", () => {
  test("an encrypted backup decrypts back to byte-identical SQL", async () => {
    const src = tmp("dump.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("dump.sql.enc");

    const result = await encryptBackupFile(src, enc, { passphrase: "s3cret", source: "BACKUP_PASSPHRASE" });
    expect(result.format).toBe("openssl-aes-256-cbc");

    // Ciphertext must not be the plaintext.
    expect(readFileSync(enc).toString("utf-8")).not.toContain("CREATE TABLE");
    expect(await isOpensslEncrypted(enc)).toBe(true);

    process.env["BACKUP_PASSPHRASE"] = "s3cret";
    const out = await decryptBackupToSql(enc, TEST_DIR, process.env);
    expect(out.format).toBe("openssl-aes-256-cbc");
    expect(out.producedTempFile).toBe(true);
    expect(await fs.readFile(out.sqlPath, "utf-8")).toBe(SQL);
  });

  test("the encrypted file is readable by the EXACT openssl flags synology-restore.sh uses", async () => {
    // This is the compatibility contract: a backup must be recoverable on a bare
    // machine with nothing but openssl and psql, without this application.
    const src = tmp("compat.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("compat.sql.enc");
    await encryptBackupFile(src, enc, { passphrase: "nas-pass", source: "BACKUP_PASSPHRASE" });

    const out = tmp("compat.out.sql");
    const code = await opensslDecryptLikeShellScript(enc, out, "nas-pass");
    expect(code).toBe(0);
    expect(readFileSync(out, "utf-8")).toBe(SQL);
  });

  test("decrypt succeeds when the backup was made with SESSION_SECRET but BACKUP_PASSPHRASE is now set", async () => {
    const src = tmp("rotated.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("rotated.sql.enc");
    await encryptBackupFile(src, enc, { passphrase: "old-session", source: "SESSION_SECRET" });

    // Prefer BACKUP_PASSPHRASE first in candidates — openssl AES-CBC can exit 0
    // on a wrong passphrase (padding luck). decryptBackupToSql must reject
    // non-SQL output and fall through to SESSION_SECRET.
    const out = await decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "brand-new", SESSION_SECRET: "old-session" });
    expect(await fs.readFile(out.sqlPath, "utf-8")).toBe(SQL);
    expect(out.keySource).toBe("SESSION_SECRET");
  });

  test("a retained historical key still opens the older artifact", async () => {
    const src = tmp("history.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("history.sql.enc");
    await encryptBackupFile(src, enc, { passphrase: "night-before-rotation", source: "BACKUP_PASSPHRASE" });

    // The clinic rotates BACKUP_PASSPHRASE and archives the old value rather than losing it. The
    // recovery half of the product (the restore route and the weekly restore-verification job) tries
    // every candidate and checks the output, so an archived key in any slot still opens yesterday's
    // file — this is the only path that decides whether an old backup is actually recoverable.
    const out = await decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "the-new-key", SESSION_SECRET: "night-before-rotation" });
    expect(await fs.readFile(out.sqlPath, "utf-8")).toBe(SQL);
    expect(out.keySource).toBe("SESSION_SECRET");

    // The honest counterpart: a rotation that DISCARDS the old key must not pretend the old backup
    // is still recoverable.
    await expect(
      decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "the-new-key" }),
    ).rejects.toThrow(/Could not decrypt/i);
  });

  test("the decrypted plaintext lands owner-only, not at openssl's default", async () => {
    const src = tmp("private.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("private.sql.enc");
    await encryptBackupFile(src, enc, { passphrase: "keep-me", source: "BACKUP_PASSPHRASE" });
    const out = await decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "keep-me" });

    if (process.platform === "win32") return; // no POSIX bits here; CI and the NAS are Linux
    expect(statSync(out.sqlPath).mode & 0o077).toBe(0);
  });

  test("a wrong passphrase fails loudly instead of yielding garbage that would be fed to psql", async () => {
    const src = tmp("wrong.sql");
    writeFileSync(src, SQL, "utf-8");
    const enc = tmp("wrong.sql.enc");
    await encryptBackupFile(src, enc, { passphrase: "right", source: "BACKUP_PASSPHRASE" });

    await expect(decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "wrong" })).rejects.toThrow(/Could not decrypt/i);
  });

  test("encryption refuses to report success when openssl produces nothing", async () => {
    await expect(
      encryptBackupFile(tmp("does-not-exist.sql"), tmp("out.enc"), { passphrase: "p", source: "SESSION_SECRET" }),
    ).rejects.toThrow();
  });
});

describe("legacy scheme-2 backups (the ones that used to be unrestorable)", () => {
  test("a SESSION_SECRET GCM envelope written by the old cron path is now decryptable", async () => {
    process.env["SESSION_SECRET"] = "legacy-session-secret";
    // Exactly what the old cron.ts wrote: encryptBackup(sql) → base64 envelope.
    const envelope = encryptBackup(SQL);
    const legacy = tmp("legacy-backup.sql.enc");
    writeFileSync(legacy, envelope, "utf-8");

    // It is NOT openssl format — the old restore path assumed it was, which is
    // why verification and restore both failed on these files.
    expect(await isOpensslEncrypted(legacy)).toBe(false);

    const out = await decryptBackupToSql(legacy, TEST_DIR, { SESSION_SECRET: "legacy-session-secret" });
    expect(out.format).toBe("legacy-gcm-envelope");
    expect(await fs.readFile(out.sqlPath, "utf-8")).toBe(SQL);
  });

  test("a legacy envelope under the WRONG SESSION_SECRET reports why, rather than corrupting a restore", async () => {
    process.env["SESSION_SECRET"] = "the-original-secret";
    const legacy = tmp("legacy-wrong.sql.enc");
    writeFileSync(legacy, encryptBackup(SQL), "utf-8");

    await expect(decryptBackupToSql(legacy, TEST_DIR, { SESSION_SECRET: "a-different-secret" }))
      .rejects.toThrow(/SESSION_SECRET that was\s+active|legacy encrypted envelope/i);
  });
});

describe("plaintext dumps pass through untouched", () => {
  test("a plain pg_dump is returned as-is and never treated as ciphertext", async () => {
    const plain = tmp("plain.sql");
    writeFileSync(plain, SQL, "utf-8");
    const out = await decryptBackupToSql(plain, TEST_DIR, {});
    expect(out.format).toBe("plaintext");
    expect(out.producedTempFile).toBe(false);
    expect(out.sqlPath).toBe(plain);
  });

  test("a dump beginning with a SET/COPY statement is not mistaken for a base64 envelope", async () => {
    const plain = tmp("setstyle.sql");
    writeFileSync(plain, "SET statement_timeout = 0;\nCOPY patients FROM stdin;\n", "utf-8");
    const out = await decryptBackupToSql(plain, TEST_DIR, { SESSION_SECRET: "x" });
    expect(out.format).toBe("plaintext");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// verifyBackupRoundTrip — the P10 requirement: an encrypted backup is only a backup once it has
// been opened again and found to contain the bytes that were archived.
//
// These run the REAL openssl against REAL files. The point of using the actual binary is that the
// defect is a property of the format, not of our code: AES-CBC has no integrity tag, so openssl
// reports success on output that is not the plaintext. Two of the cases below (an edited middle
// block, and the injected exit-0-with-garbage pair) exist to pin that property, because a verifier
// built only on exit codes passes both.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Big enough to span many AES blocks, so a middle-block edit is neither the header nor the padding
// block and a truncation can be measured in whole blocks.
const LONG_SQL =
  "-- pg_dump output\nSET statement_timeout = 0;\n" +
  Array.from({ length: 40 }, (_, i) => `INSERT INTO patients (id, label) VALUES (${i}, 'synthetic-row-${i}');`).join("\n") +
  "\n";

const RT_KEY = { passphrase: "rt-pass-phrase", source: "BACKUP_PASSPHRASE" } as const;

async function makeBackup(name: string, key: BackupPassphrase = RT_KEY): Promise<{ src: string; enc: string; plain: { hex: string; bytes: number } }> {
  const src = tmp(`${name}.sql`);
  writeFileSync(src, LONG_SQL, "utf-8");
  const enc = tmp(`${name}.sql.enc`);
  await encryptBackupFile(src, enc, key);
  return { src, enc, plain: await sha256File(src) };
}

function verify(enc: string, plain: { hex: string; bytes: number }, over: { key?: BackupPassphrase; expectSql?: boolean; plaintextBytes?: number | null } = {}) {
  return verifyBackupRoundTrip({
    cipherPath: enc,
    expectedPlaintextSha256: plain.hex,
    plaintextBytes: over.plaintextBytes === undefined ? plain.bytes : over.plaintextBytes,
    key: over.key ?? RT_KEY,
    expectSql: over.expectSql,
  });
}

describe("verifyBackupRoundTrip — successful encryption", () => {
  test("a healthy artifact verifies, and the proof names the digest it re-read and the key that opened it", async () => {
    const { enc, plain } = await makeBackup("healthy");
    const r = await verify(enc, plain);

    expect(r.ok).toBe(true);
    expect(r.reason).toBe("verified");
    expect(r.decryptedSha256).toBe(plain.hex);
    expect(r.decryptedBytes).toBe(plain.bytes);
    expect(r.expectedPlaintextSha256).toBe(plain.hex);
    expect(r.keySource).toBe("BACKUP_PASSPHRASE");
    // The ciphertext is a different artifact from the plaintext (salt header + padding); the result
    // carries its size so an at-rest check has something to compare against later.
    expect(r.ciphertextBytes).not.toBeNull();
    expect(r.ciphertextBytes! % 16).toBe(0);
    expect(r.ciphertextBytes!).toBeGreaterThan(plain.bytes);
    expect(r.detail).toContain("decrypt-verified");
  });

  test("verification writes no second copy of the decrypted database next to the artifact", async () => {
    // Streaming claim, measured: the whole reason this verifier hashes openssl's stdout instead of
    // decrypting to a temp file the way the shell scripts do. On the NAS that would put a plaintext
    // copy of the clinic's database beside its ciphertext, in a directory the retention job and any
    // off-NAS copy walk.
    const { src, enc, plain } = await makeBackup("streaming");
    await verify(enc, plain);
    expect(readdirSync(TEST_DIR).sort()).toEqual(["streaming.sql", "streaming.sql.enc"]);
    expect(existsSync(src)).toBe(true);
    expect(existsSync(enc)).toBe(true);
  });

  test("nothing the verifier reports contains the passphrase", async () => {
    const secret = { passphrase: "super-secret-passphrase", source: "BACKUP_PASSPHRASE" } as const;
    const { enc, plain } = await makeBackup("leak", secret);
    const r = await verify(enc, plain, { key: secret });
    expect(r.ok).toBe(true);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(secret.passphrase);
    expect(r.detail).not.toContain(secret.passphrase);
    expect(r.keySource).toBe("BACKUP_PASSPHRASE");
  });
});

describe("verifyBackupRoundTrip — incorrect passphrase", () => {
  test("no wrong passphrase ever produces a verified verdict", async () => {
    const { enc, plain } = await makeBackup("wrong-keys");
    const wrongs = Array.from({ length: 24 }, (_, i) => `wrong-passphrase-${i}`);
    const reasons = new Set<string>();
    let caughtByDigestOrHead = 0;
    for (const passphrase of wrongs) {
      const r = await verify(enc, plain, { key: { passphrase, source: "BACKUP_PASSPHRASE" } });
      expect(r.ok).toBe(false);
      reasons.add(r.reason);
      // decrypt_failed = openssl refused. Anything else means openssl EXITED 0 and the digest or the
      // SQL check is what saved the run — the case the old code recorded as a successful backup.
      if (r.reason !== "decrypt_failed") caughtByDigestOrHead++;
    }
    for (const reason of reasons) {
      expect(["decrypt_failed", "not_sql", "hash_mismatch", "byte_count_mismatch"]).toContain(reason);
    }
    // Measurement, not assumption (#1138): print how many wrong keys slipped past padding on this
    // machine. Zero here would be luck, not safety — which is why the assertion above never depends
    // on it.
    console.log(`[round-trip] wrong passphrases tried=${wrongs.length} openssl-exited-0-with-bad-output=${caughtByDigestOrHead} reasons=${[...reasons].join(",")}`);
  });

  test("a wrong passphrase with the SQL check disabled still cannot verify — the digest is the backstop", async () => {
    const { enc, plain } = await makeBackup("wrong-nosql");
    let verified = 0;
    for (const passphrase of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const r = await verify(enc, plain, { key: { passphrase, source: "BACKUP_PASSPHRASE" }, expectSql: false });
      if (r.ok) verified++;
    }
    expect(verified).toBe(0);
  });
});

describe("verifyBackupRoundTrip — corrupted and truncated ciphertext", () => {
  test("an artifact edited in the middle decrypts cleanly, at full length, and is still refused", async () => {
    // The deterministic proof that "openssl returned 0" is not evidence. Flipping bytes in a middle
    // block leaves the `Salted__` header, the first 512 plaintext bytes and the FINAL block's padding
    // untouched, so openssl exits 0 and hands back the same number of bytes. The head check passes,
    // the length check passes, and only the digest comparison says no.
    const { enc, plain } = await makeBackup("corrupt");
    const buf = readFileSync(enc);
    const mid = Math.floor(buf.length / 2);
    for (let i = 0; i < 8; i++) buf[mid + i] = buf[mid + i]! ^ 0xff;
    writeFileSync(enc, buf);

    const r = await verify(enc, plain);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("hash_mismatch");
    expect(r.decryptedBytes).toBe(plain.bytes);
    expect(r.decryptedSha256).not.toBe(plain.hex);
    expect(r.detail).toMatch(/would restore the wrong data|not the bytes it wrote/);
  });

  test("an artifact missing its last block is refused and its real size is reported", async () => {
    const { enc, plain } = await makeBackup("truncated");
    const buf = readFileSync(enc);
    const cut = buf.length - 16;
    writeFileSync(enc, buf.subarray(0, cut));

    const r = await verify(enc, plain);
    expect(r.ok).toBe(false);
    // Which of the two depends on whether the new final block happens to look like valid padding.
    // Both are detections; the point is that neither is a success.
    expect(["byte_count_mismatch", "decrypt_failed", "hash_mismatch", "not_sql"]).toContain(r.reason);
    if (r.reason === "byte_count_mismatch") expect(r.decryptedBytes).toBeLessThan(plain.bytes);
    expect(r.ciphertextBytes).toBe(cut);
  });

  test("a missing artifact is named as missing, not as a failed decryption", async () => {
    const r = await verifyBackupRoundTrip({
      cipherPath: tmp("never-written.sql.enc"),
      expectedPlaintextSha256: "a".repeat(64),
      plaintextBytes: 100,
      key: RT_KEY,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("artifact_missing");
    expect(r.ciphertextBytes).toBeNull();
    expect(r.detail).toMatch(/nothing to decrypt/i);
  });

  test("a zero-byte artifact is refused before openssl is even asked", async () => {
    const enc = tmp("empty.sql.enc");
    writeFileSync(enc, Buffer.alloc(0));
    const r = await verifyBackupRoundTrip({
      cipherPath: enc,
      expectedPlaintextSha256: createHash("sha256").update(LONG_SQL).digest("hex"),
      plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("artifact_empty");
  });

  test("an expected digest that was never measured cannot be satisfied", async () => {
    // Fail-closed on the caller, not the file: a backup run that hashed nothing must not be able to
    // ask this function "is it verified?" and get a yes out of a well-formed artifact.
    const { enc, plain } = await makeBackup("bad-digest");
    for (const bogus of ["", "nothashesatall", "abc123", "A".repeat(64), plain.hex.slice(0, 63)]) {
      const r = await verifyBackupRoundTrip({ cipherPath: enc, expectedPlaintextSha256: bogus, plaintextBytes: plain.bytes, key: RT_KEY });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("decrypt_failed");
      expect(r.detail).toMatch(/not a SHA-256/i);
    }
  });
});

describe("verifyBackupRoundTrip across a key rotation", () => {
  test("the retired key still proves an old artifact and records which key proved it", async () => {
    const retired = { passphrase: "old-session-secret", source: "SESSION_SECRET" } as const;
    const { enc, plain } = await makeBackup("rotated", retired);

    const withOldKey = await verify(enc, plain, { key: retired });
    expect(withOldKey.ok).toBe(true);
    expect(withOldKey.keySource).toBe("SESSION_SECRET");

    // The same artifact under the new key: still unreadable, and crucially still NOT verified. A
    // rotation must never make an old backup look recoverable, and never make it look lost either —
    // the caller keeps the keySource and decides, which is what `proven_with_retired_key` is for.
    const withNewKey = await verify(enc, plain, { key: { passphrase: "brand-new-passphrase", source: "BACKUP_PASSPHRASE" } });
    expect(withNewKey.ok).toBe(false);
    expect(withNewKey.keySource).toBe("BACKUP_PASSPHRASE");
  });

  test("verifying with a key the artifact was not made for leaves no partial proof behind", async () => {
    const { enc, plain } = await makeBackup("rotation-partial", { passphrase: "key-at-write-time", source: "BACKUP_PASSPHRASE" });
    const r = await verify(enc, plain, { key: { passphrase: "key-after-rotation", source: "BACKUP_PASSPHRASE" } });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toBe("verified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The injectable half. Real openssl cannot be asked to "exit 0 and hand back garbage" on demand
// (it happens on roughly 1 run in 256, when the last decrypted block's bytes happen to form valid
// padding), and it cannot be asked to report a specific byte count. So the branches whose whole job
// is to survive that case are pinned here, with the process boundary itself faked. The fakes cover
// the two claims that must never regress: the passphrase never reaches argv, and no plaintext is
// ever written to disk.
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface FakeChild { spawn: typeof spawn; calls: { cmd: string; args: string[]; env: Record<string, string> }[] }

function fakeOpenssl(result: { plaintext?: string | Buffer; code?: number; stderr?: string }): FakeChild {
  const calls: FakeChild["calls"] = [];
  const spawnImpl = ((cmd: string, args: readonly string[] | undefined, options: { env?: NodeJS.ProcessEnv } = {}) => {
    calls.push({ cmd, args: (args ?? []).map(String), env: (options.env ?? {}) as Record<string, string> });
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
    const payload =
      result.plaintext === undefined ? Buffer.alloc(0)
      : Buffer.isBuffer(result.plaintext) ? result.plaintext
      : Buffer.from(result.plaintext, "utf8");
    child.stdout = Readable.from(payload.length > 0 ? [payload] : []);
    child.stderr = Readable.from(result.stderr ? [Buffer.from(result.stderr, "utf8")] : []);
    let ended = 0;
    const maybeClose = () => {
      if (++ended === 2) setTimeout(() => child.emit("close", result.code ?? 0), 0);
    };
    child.stdout.on("end", maybeClose);
    child.stderr.on("end", maybeClose);
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  return { spawn: spawnImpl, calls };
}

describe("verifyBackupRoundTrip against an openssl that lies (exit 0, wrong output)", () => {
  const digestOf = (s: string) => createHash("sha256").update(s).digest("hex");

  async function withArtifact(name: string): Promise<string> {
    const enc = tmp(`${name}.sql.enc`);
    writeFileSync(enc, Buffer.alloc(64, 3));
    return enc;
  }

  test("exit 0 with binary output is reported as not_sql, never verified", async () => {
    const enc = await withArtifact("fake-garbage");
    const child = fakeOpenssl({ plaintext: Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 37 + 128) % 256)), code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_sql");
    expect(r.detail).toMatch(/exited 0 but the first bytes are not SQL/);
  });

  test("exit 0 with the right SQL but fewer bytes is a truncation, not a success", async () => {
    const enc = await withArtifact("fake-short");
    const child = fakeOpenssl({ plaintext: LONG_SQL.slice(0, LONG_SQL.length - 40), code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("byte_count_mismatch");
    expect(r.decryptedBytes).toBe(Buffer.byteLength(LONG_SQL.slice(0, LONG_SQL.length - 40)));
  });

  test("exit 0 with the full byte count but different content is a hash mismatch", async () => {
    const enc = await withArtifact("fake-same-length");
    const tampered = LONG_SQL.replace("patients", "patienTS");
    expect(Buffer.byteLength(tampered)).toBe(Buffer.byteLength(LONG_SQL));
    const child = fakeOpenssl({ plaintext: tampered, code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("hash_mismatch");
  });

  test("exit 0 with nothing at all is an empty artifact, not a verified run", async () => {
    const enc = await withArtifact("fake-empty-output");
    const child = fakeOpenssl({ plaintext: "", code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("artifact_empty");
  });

  test("a nonzero exit is decrypt_failed and carries openssl's own sentence", async () => {
    const enc = await withArtifact("fake-fail");
    const child = fakeOpenssl({ plaintext: "partial", code: 1, stderr: "bad decrypt\n140379252485952:error:1C800064:Provider routines:ossl_cipher_unpadblock:bad decrypt" });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("decrypt_failed");
    expect(r.detail).toMatch(/bad decrypt/);
  });

  test("openssl failing to start at all is a failure, not a pass", async () => {
    const enc = await withArtifact("fake-noexec");
    const boom = ((() => {
      const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
      child.stdout = Readable.from([]);
      child.stderr = Readable.from([]);
      setTimeout(() => child.emit("error", new Error("spawn openssl ENOENT")), 0);
      return child as unknown as ChildProcess;
    }) as unknown) as typeof spawn;
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY, deps: { spawn: boom },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("decrypt_failed");
    expect(r.detail).toMatch(/failed to start/);
  });

  test("the passphrase travels in the child environment only — never in argv", async () => {
    const enc = await withArtifact("fake-argv");
    const child = fakeOpenssl({ plaintext: LONG_SQL, code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: enc, expectedPlaintextSha256: digestOf(LONG_SQL), plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: { passphrase: "must-not-appear-in-ps", source: "BACKUP_PASSPHRASE" }, deps: { spawn: child.spawn },
    });
    expect(r.ok).toBe(true);

    expect(child.calls).toHaveLength(1);
    const { cmd, args, env } = child.calls[0]!;
    expect(cmd).toBe("openssl");
    expect(args.join(" ")).not.toContain("must-not-appear-in-ps");
    expect(args).toContain("-pass");
    expect(args).toContain("env:CARE_BACKUP_PASS");
    expect(env.CARE_BACKUP_PASS).toBe("must-not-appear-in-ps");
    // No shell, and no `-out`: this is the pair of flags that makes the check leave no plaintext
    // file and no `sh -c` string interpolating a path.
    expect(args).not.toContain("-out");
    expect(args).toContain("-in");
    expect(args).toContain("-pbkdf2");
    expect(args).not.toContain("-nopad");
  });

  test("a stat that cannot read the artifact size is refused without spawning openssl", async () => {
    const child = fakeOpenssl({ plaintext: LONG_SQL, code: 0 });
    const r = await verifyBackupRoundTrip({
      cipherPath: "/volume1/backup/care-erp/db/gone.sql.enc",
      expectedPlaintextSha256: digestOf(LONG_SQL),
      plaintextBytes: Buffer.byteLength(LONG_SQL),
      key: RT_KEY,
      deps: { spawn: child.spawn, stat: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); } },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("artifact_missing");
    expect(r.detail).toMatch(/EACCES/);
    expect(child.calls).toHaveLength(0);
  });
});

describe("headLooksLikeSqlDump — the one definition shared by the file check and the stream check", () => {
  const cases: [string, string, boolean][] = [
    ["pg_dump comment header", "-- pg_dump output\nCREATE TABLE public.patients (\n", true],
    ["SET statement_timeout", "SET statement_timeout = 0;\nCOPY patients FROM stdin;\n", true],
    ["BEGIN / INSERT batch", "BEGIN;\nINSERT INTO bills VALUES (1);\n", true],
    ["leading whitespace then CREATE", "\n\n   CREATE TABLE t (id int);\n", true],
    ["COPY first (pg_dump --data-only)", "COPY patients (id) FROM stdin;\n1\n\\.\n", true],
    ["pg_dump 16 restrict line", "\\restrict public.patients;\nCREATE TABLE public.patients (\n", true],
    ["empty buffer", "", false],
    ["legacy base64 GCM envelope", "eyJpdiI6ImNkMG5Xa1p5", false],
    ["openssl ciphertext read as text", "Salted__ random high bytes", false],
    ["binary garbage from a wrong CBC key", "\u0000\u0080\u00ff\u0001\u00fe\u0081\u0080\u00ff\u0000\u00fe\u0081\u00ff", false],
    ["plain prose with no SQL", "Patient report impression: no acute findings.\n", false],
  ];
  for (const [name, input, expected] of cases) {
    test(`${name} → ${expected}`, () => {
      expect(headLooksLikeSqlDump(Buffer.from(input, "utf8"))).toBe(expected);
    });
  }

  test("a buffer of NUL bytes — the shape a wrong key produces — is rejected", () => {
    expect(headLooksLikeSqlDump(Buffer.alloc(512, 0))).toBe(false);
  });

  test("the check reads the head, not the tail: SQL keywords deep in a binary blob do not save it", () => {
    const buf = Buffer.concat([Buffer.alloc(300, 0x80), Buffer.from("CREATE TABLE patients", "utf8")]);
    expect(headLooksLikeSqlDump(buf)).toBe(false);
  });
});

describe("sha256File", () => {
  test("hashes a file to the same digest crypto gives over its bytes, and reports the count", async () => {
    const p = tmp("digest.sql");
    writeFileSync(p, LONG_SQL, "utf-8");
    const r = await sha256File(p);
    expect(r.hex).toBe(createHash("sha256").update(LONG_SQL).digest("hex"));
    expect(r.bytes).toBe(Buffer.byteLength(LONG_SQL));
  });

  test("a missing file rejects — there is no digest to invent", async () => {
    await expect(sha256File(tmp("not-here.sql"))).rejects.toThrow(/ENOENT/);
  });

  test("an empty file has a real digest and a byte count of zero, and they are distinguishable", async () => {
    const p = tmp("zero.sql");
    writeFileSync(p, "", "utf-8");
    const r = await sha256File(p);
    expect(r.bytes).toBe(0);
    expect(r.hex).toBe(createHash("sha256").update("").digest("hex"));
  });
});

