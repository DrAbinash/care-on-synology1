import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { promises as fs, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { encryptBackup } from "@workspace/crypto";
import {
  encryptBackupFile, decryptBackupToSql, isOpensslEncrypted,
  resolveBackupPassphrase, candidatePassphrases,
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

    const out = await decryptBackupToSql(enc, TEST_DIR, { BACKUP_PASSPHRASE: "brand-new", SESSION_SECRET: "old-session" });
    expect(out.keySource).toBe("SESSION_SECRET");
    expect(await fs.readFile(out.sqlPath, "utf-8")).toBe(SQL);
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
