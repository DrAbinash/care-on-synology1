import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
