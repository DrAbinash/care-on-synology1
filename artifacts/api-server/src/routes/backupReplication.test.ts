import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readdirSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// Emergency Ticket E0.1 (CRIT-1) regression coverage.
//
// exportDatabaseSql's promise previously resolved as soon as the write
// stream fired "finish" (pg_dump's stdout closing), without waiting for
// pg_dump's own "close" event to confirm a zero exit code. A pg_dump that
// crashed partway through still closes its stdout (having written whatever
// partial data it produced before dying), which could resolve the promise
// as "success" before the process's "close" event — carrying the real
// (non-zero) exit code — even arrived. These tests reproduce that exact
// event ordering (stdout ends and flushes data, THEN a failing close
// arrives) and assert the fixed function rejects regardless of order.

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough };

let fakeChild: FakeChild | null;
let spawnCalls: { command: string; args: string[] }[];
let originalDatabaseUrl: string | undefined;
let originalBackupDir: string | undefined;

const TEST_BACKUP_DIR = path.resolve(__dirname, "../../.tmp-e0-1-backup-test");

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const child: FakeChild = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    fakeChild = child;
    return child;
  },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn() },
  backupJobsTable: {},
  backupJobLogsTable: {},
}));

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  originalDatabaseUrl = process.env["DATABASE_URL"];
  originalBackupDir = process.env["BACKUP_TEMP_DIR"];
  process.env["DATABASE_URL"] = "postgres://user:pass@localhost:5432/testdb";
  process.env["BACKUP_TEMP_DIR"] = TEST_BACKUP_DIR;
  spawnCalls = [];
  fakeChild = null;
  if (existsSync(TEST_BACKUP_DIR)) rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(TEST_BACKUP_DIR, { recursive: true });
});

afterEach(() => {
  process.env["DATABASE_URL"] = originalDatabaseUrl;
  process.env["BACKUP_TEMP_DIR"] = originalBackupDir;
  if (existsSync(TEST_BACKUP_DIR)) rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
});

describe("exportDatabaseSql — false-success race fix (Ticket E0.1 / CRIT-1)", () => {
  test("resolves when pg_dump writes data and exits 0", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.stdout.end("-- pg_dump output\nCREATE TABLE foo (id int);\n");
    await wait(50); // real write-stream flush time
    fakeChild!.emit("close", 0);

    const result = await promise;
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  test("rejects when pg_dump exits non-zero, even though stdout already finished writing (the exact race this fix closes)", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    // stdout ends first, exactly like a crashed pg_dump that still flushed
    // partial output before dying.
    fakeChild!.stdout.end("-- partial dump before crash\n");
    // Give the real write stream ample time to fire "finish" — pre-fix,
    // this alone would already have resolved the promise as success.
    await wait(50);
    // The failure arrives only after stdout already looked "done".
    fakeChild!.emit("close", 1);

    await expect(promise).rejects.toThrow(/pg_dump exited with code 1/);
  });

  test("rejects when pg_dump exits 0 but produced an empty file", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.stdout.end(); // no data written at all
    await wait(50);
    fakeChild!.emit("close", 0);

    await expect(promise).rejects.toThrow(/empty file/);
  });

  test("rejects when pg_dump fails to spawn", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.emit("error", new Error("spawn pg_dump ENOENT"));

    await expect(promise).rejects.toThrow(/pg_dump failed to start/);
  });

  test("adds --table filtering args for a scoped export (e.g. CONFIG)", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql(["clinic_settings", "email_settings"]);
    await wait(10);
    fakeChild!.stdout.end("-- scoped dump\n");
    await wait(50);
    fakeChild!.emit("close", 0);
    await promise;

    expect(spawnCalls[0]!.args).toEqual(
      expect.arrayContaining(["--table", "clinic_settings", "--table", "email_settings"]),
    );
  });

  test("no --table args for a full (untargeted) export", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.stdout.end("-- full dump\n");
    await wait(50);
    fakeChild!.emit("close", 0);
    await promise;

    expect(spawnCalls[0]!.args).not.toContain("--table");
  });
});

// Ticket E0.1d coverage — integrity verification for scheduled backups.
// computeSha256/verifyBackupChecksum operate on real files under
// TEST_BACKUP_DIR (same convention as the tests above), not mocked fs, so
// "corrupted file" can be reproduced by literally overwriting bytes on disk.

describe("computeSha256 / verifyBackupChecksum (Ticket E0.1d)", () => {
  test("checksum generated: matches a hex SHA-256 computed independently over the same bytes", async () => {
    const { computeSha256 } = await import("./backupReplication");
    const content = "-- encrypted backup content --\nSELECT 1;\n";

    const expected = createHash("sha256").update(content).digest("hex");
    expect(computeSha256(content)).toBe(expected);
    expect(computeSha256(content)).toHaveLength(64); // hex-encoded SHA-256
  });

  test("checksum verified: an unmodified file on disk verifies against its recorded checksum", async () => {
    const { computeSha256, verifyBackupChecksum } = await import("./backupReplication");
    const filePath = path.join(TEST_BACKUP_DIR, "good-backup.sql.enc");
    const content = "encrypted-envelope-bytes-abc123";
    writeFileSync(filePath, content);

    const checksum = computeSha256(content);
    await expect(verifyBackupChecksum(filePath, checksum)).resolves.toBe(true);
  });

  test("corrupted encrypted backup fails verification: a file altered after the checksum was recorded no longer matches", async () => {
    const { computeSha256, verifyBackupChecksum } = await import("./backupReplication");
    const filePath = path.join(TEST_BACKUP_DIR, "corrupted-backup.sql.enc");
    const originalContent = "encrypted-envelope-bytes-abc123";
    writeFileSync(filePath, originalContent);
    const checksum = computeSha256(originalContent);

    // Simulate corruption: the file on disk changes after the checksum was recorded.
    writeFileSync(filePath, "encrypted-envelope-bytes-ABC123-CORRUPTED");

    await expect(verifyBackupChecksum(filePath, checksum)).resolves.toBe(false);
  });

  test("normal backups still pass: several distinct, untouched backups each verify independently and correctly", async () => {
    const { computeSha256, verifyBackupChecksum } = await import("./backupReplication");
    const backups = ["backup-a.sql.enc", "backup-b.sql.enc", "backup-c.sql.enc"].map((name, i) => {
      const filePath = path.join(TEST_BACKUP_DIR, name);
      const content = `encrypted content for backup ${i}`;
      writeFileSync(filePath, content);
      return { filePath, checksum: computeSha256(content) };
    });

    for (const { filePath, checksum } of backups) {
      await expect(verifyBackupChecksum(filePath, checksum)).resolves.toBe(true);
    }
    // Cross-checking one backup's content against a different backup's
    // checksum must fail — proves this isn't a vacuously-true check.
    await expect(verifyBackupChecksum(backups[0]!.filePath, backups[1]!.checksum)).resolves.toBe(false);
  });

  test("verifyBackupChecksum returns false (not a throw) for a missing file", async () => {
    const { verifyBackupChecksum } = await import("./backupReplication");
    const missingPath = path.join(TEST_BACKUP_DIR, "does-not-exist.sql.enc");
    await expect(verifyBackupChecksum(missingPath, "any-checksum")).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveRestoreTarget — the uploads-restore regression.
//
// The import path used to do `path.basename(entryName)` and write everything
// into one hardcoded, CWD-relative "artifacts/api-server/data/uploads". That
// flattened the tree, merged four distinct roots into one (so same-named files
// silently overwrote each other while BOTH were counted as restored), and
// ignored CARE_DATA_DIR so files landed outside the mounted volume in Docker.
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveRestoreTarget — file restore preserves structure and root", () => {
  const ENV = { CARE_DATA_DIR: "/data" } as NodeJS.ProcessEnv;
  const CWD = "/app";

  test("preserves nested directory structure instead of flattening it", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    const r = resolveRestoreTarget("uploads/2026/07/scan.pdf", ENV, CWD);
    expect(r?.targetPath).toBe(path.resolve("/data/uploads/2026/07/scan.pdf"));
    expect(r?.relativePath).toBe("2026/07/scan.pdf");
  });

  test("routes each label back to its OWN root, not all into uploads", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    expect(resolveRestoreTarget("reports/y.pdf", ENV, CWD)?.targetPath).toBe(path.resolve("/data/reports/y.pdf"));
    expect(resolveRestoreTarget("object-storage/o.bin", ENV, CWD)?.targetPath).toBe(path.resolve("/data/object-storage/o.bin"));
    // attached_assets is a legacy CWD-relative root, not under CARE_DATA_DIR.
    expect(resolveRestoreTarget("attached_assets/z.png", ENV, CWD)?.targetPath).toBe(path.resolve("/app/attached_assets/z.png"));
  });

  test("two identically-named files in different folders no longer collide (the data-loss bug)", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    const a = resolveRestoreTarget("uploads/report.pdf", ENV, CWD)!;
    const b = resolveRestoreTarget("reports/report.pdf", ENV, CWD)!;
    expect(a.targetPath).not.toBe(b.targetPath);
  });

  test("honours CARE_DATA_DIR, and falls back to <cwd>/data when it is unset", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    expect(resolveRestoreTarget("uploads/a.pdf", ENV, CWD)?.targetPath).toBe(path.resolve("/data/uploads/a.pdf"));
    expect(resolveRestoreTarget("uploads/a.pdf", {} as NodeJS.ProcessEnv, CWD)?.targetPath).toBe(path.resolve("/app/data/uploads/a.pdf"));
  });

  test("rejects path traversal (zip-slip) — which basename() used to prevent incidentally", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    expect(resolveRestoreTarget("uploads/../../etc/passwd", ENV, CWD)).toBeNull();
    expect(resolveRestoreTarget("../etc/passwd", ENV, CWD)).toBeNull();
    expect(resolveRestoreTarget("/etc/passwd", ENV, CWD)?.targetPath).toBe(path.resolve("/data/uploads/etc/passwd"));
    expect(resolveRestoreTarget("uploads/./x/../../../y", ENV, CWD)).toBeNull();
  });

  test("an unlabelled entry keeps its structure under uploads rather than being flattened", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    const r = resolveRestoreTarget("legacy/nested/loose.pdf", ENV, CWD);
    expect(r?.label).toBe("uploads");
    expect(r?.targetPath).toBe(path.resolve("/data/uploads/legacy/nested/loose.pdf"));
  });

  test("directory entries and empty names are skipped", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    expect(resolveRestoreTarget("uploads/", ENV, CWD)).toBeNull();
    expect(resolveRestoreTarget("", ENV, CWD)).toBeNull();
    expect(resolveRestoreTarget("uploads", ENV, CWD)).toBeNull();
  });

  test("normalizes windows-style separators", async () => {
    const { resolveRestoreTarget } = await import("./backupReplication");
    expect(resolveRestoreTarget("uploads\\2026\\x.pdf", ENV, CWD)?.targetPath).toBe(path.resolve("/data/uploads/2026/x.pdf"));
  });
});

describe("the cleartext dump directory — who can read it and who can download it", () => {
  // Owner merge gate 2 for P10. A pg_dump is every patient and every report in cleartext, and the
  // Backup & Replication page both LISTs and DOWNLOADs out of this directory. Two properties have to
  // hold: the file is readable only by the server's own user, and a dump the scheduler could not
  // prove is parked somewhere the download endpoint cannot name.
  const express = () => import("express");
  const supertest = () => import("supertest");

  async function routerWithAdmin(): Promise<any> {
    const { default: expressApp } = await express();
    const { backupReplicationRouter } = await import("./backupReplication");
    const app = expressApp();
    app.use((req, _res, next) => {
      (req as unknown as { log: unknown }).log = { info() {}, error() {}, warn() {}, debug() {} };
      (req as unknown as { staffSession: { role: string; staffId: number } }).staffSession = { role: "admin", staffId: 1 };
      next();
    });
    app.use("/api/admin/backup-replication", backupReplicationRouter);
    return app;
  }

  test("pg_dump's output is created owner-only, never at the default 0644", async () => {
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.stdout.end("-- pg_dump output\nCREATE TABLE patients (id int);\n");
    await wait(50);
    fakeChild!.emit("close", 0);
    const result = await promise;

    const mode = statSync(result.filePath).mode & 0o777;
    if (process.platform === "win32") {
      // Windows has no POSIX permission bits, so the mode assertion below is meaningless here.
      // It runs for real on the CI runner and on the NAS, both of which are Linux.
      expect(true).toBe(true);
      return;
    }
    expect(mode & 0o077, `the dump is group/other-readable (mode ${mode.toString(8)})`).toBe(0);
    expect(mode & 0o100, `the dump is executable (mode ${mode.toString(8)})`).toBe(0);
  });

  test("a dump left behind by a crashed pg_dump is private too", async () => {
    // The file exists before trySettle ever runs, so `mode` has to be on the stream creation and
    // not only on the success path — a partial dump is still patient data.
    const { exportDatabaseSql } = await import("./backupReplication");
    const promise = exportDatabaseSql();
    await wait(10);
    fakeChild!.stdout.end("-- partial dump before crash\n");
    await wait(50);
    fakeChild!.emit("close", 1);
    await expect(promise).rejects.toThrow(/exited with code 1/);

    if (process.platform === "win32") return;
    const strays = readdirSync(TEST_BACKUP_DIR).filter((n) => n.endsWith(".sql"));
    expect(strays.length, "the crashed dump was not left behind, so this test proved nothing").toBeGreaterThan(0);
    for (const name of strays) {
      expect(statSync(path.join(TEST_BACKUP_DIR, name)).mode & 0o077).toBe(0);
    }
  });

  test("the parking directory is a child of the served directory, so no download name can reach it", async () => {
    const { unprovenDumpDir, ensureBackupDir } = await import("./backupReplication");
    const parked = unprovenDumpDir();
    expect(parked.startsWith(ensureBackupDir() + path.sep)).toBe(true);
    const { default: request } = await supertest();
    const app = await routerWithAdmin();
    writeFileSync(path.join(parked, "clinic-in-cleartext.sql"), "-- patient data\n");
    // GET /download rejects any name containing a separator before it touches the disk, which is
    // what keeps a subdirectory of the temp dir unreachable through the ERP.
    const res = await request(app).get("/api/admin/backup-replication/download").query({ file: "unproven/clinic-in-cleartext.sql" });
    expect(res.status).toBe(400);
    const bare = await request(app).get("/api/admin/backup-replication/download").query({ file: "clinic-in-cleartext.sql" });
    expect(bare.status, "the parked file must not be reachable by its bare name either").toBe(404);
  });

  test("GET /files lists dump-shaped files, and not the parking directory", async () => {
    const { unprovenDumpDir } = await import("./backupReplication");
    mkdirSync(unprovenDumpDir(), { recursive: true });
    writeFileSync(path.join(unprovenDumpDir(), "parked.sql"), "-- parked\n");
    writeFileSync(path.join(TEST_BACKUP_DIR, "served.sql"), "-- served\n");
    const { default: request } = await supertest();
    const app = await routerWithAdmin();
    const res = await request(app).get("/api/admin/backup-replication/files");
    expect(res.status).toBe(200);
    const names = (res.body.files as { fileName: string }[]).map((f) => f.fileName);
    expect(names).toContain("served.sql");
    expect(names).not.toContain("parked.sql");
    expect(names).not.toContain("unproven");
  });

  test("the parking directory prunes what the retry window no longer needs", async () => {
    const { unprovenDumpDir } = await import("./backupReplication");
    const dir = unprovenDumpDir();
    const stale = path.join(dir, "stale.sql");
    const fresh = path.join(dir, "fresh.sql");
    writeFileSync(stale, "-- yesterday's dump\n");
    writeFileSync(fresh, "-- tonight's dump\n");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    unprovenDumpDir();
    expect(existsSync(stale), "a month-old cleartext dump is still sitting on the server").toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});
