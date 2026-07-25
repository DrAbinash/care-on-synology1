import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { backupJobsTable, backupJobLogsTable } from "@workspace/db/schema";

// Emergency Ticket E0.1 (CRIT-1) — job-level regression coverage.
//
// Proves fireScheduledBackups only records a backup job as "success" when
// the underlying export actually completed. Complements
// backupReplication.test.ts's lower-level exportDatabaseSql race tests:
// this file checks the outcome that actually lands in backup_job_logs /
// backup_jobs, which is what an admin looking at the Backups UI would see.

const TEST_DIR = path.resolve(__dirname, "../.tmp-e0-1-cron-test");

let jobsSelectResult: Record<string, unknown>[];
let logUpdateCalls: Record<string, unknown>[];
let jobUpdateCalls: Record<string, unknown>[];
let exportDatabaseSqlImpl: () => Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }>;
let exportDatabaseSqlFallbackImpl: () => Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }>;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => jobsSelectResult,
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ id: 1, ...v }],
      }),
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, unknown>) => {
        if (table === backupJobLogsTable) logUpdateCalls.push(v);
        else jobUpdateCalls.push(v);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("./email", () => ({
  sendDailySummaryEmail: vi.fn(),
  sendMonthlyAuditEmail: vi.fn(),
  sendBackupFailureEmail: vi.fn(async () => undefined),
}));

vi.mock("./routes/books-sanity", () => ({ runBooksSanity: vi.fn() }));

vi.mock("./services/dicom-pull-agent/dimse-agent", () => ({
  startDimsePullAgent: vi.fn(),
  stopDimsePullAgent: vi.fn(),
  isDimsePullAgentRunning: vi.fn(() => false),
}));

// Backups are now encrypted file→file in the openssl-compatible format via
// lib/backupCrypto (see that file's header for why the old SESSION_SECRET/GCM
// scheme was replaced — it produced backups nothing could decrypt). The mock
// keeps the deterministic "encrypted:<plaintext>" shape the checksum assertions
// below rely on, while exercising the same call contract cron uses.
vi.mock("./lib/backupCrypto", () => ({
  resolveBackupPassphrase: () => ({ passphrase: "test-passphrase", source: "BACKUP_PASSPHRASE" }),
  encryptBackupFile: async (inPath: string, outPath: string) => {
    writeFileSync(outPath, `encrypted:${readFileSync(inPath, "utf-8")}`, "utf-8");
    return { format: "openssl-aes-256-cbc", keySource: "BACKUP_PASSPHRASE" };
  },
}));

vi.mock("./routes/backupReplication", () => ({
  exportDatabaseSql: async (..._args: unknown[]) => exportDatabaseSqlImpl(),
  exportDatabaseSqlFallback: async (..._args: unknown[]) => exportDatabaseSqlFallbackImpl(),
  // Real implementation (not a stub) so tests can assert the exact expected
  // hash rather than just "some value was stored" — Ticket E0.1d.
  computeSha256: (data: string) => createHash("sha256").update(data).digest("hex"),
  CONFIG_BACKUP_TABLES: ["clinic_settings", "email_settings", "printer_settings", "pacs_settings"],
}));

function makeRealDumpFile(name: string, content: string): string {
  const filePath = path.join(TEST_DIR, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function rejectingExport(message: string) {
  return async () => {
    throw new Error(message);
  };
}

// job.schedule "* * * * *" with lastRunAt=null always fires regardless of
// wall-clock time (per fireScheduledBackups' own "useful for testing" case) —
// avoids the DAILY/HOURLY/WEEKLY schedules' fixed-time-of-day gating, which
// would make this test flaky depending on when it happens to run.
// destinationPath defaults to a real directory: a scheduled backup with nowhere
// to persist is now a FAILURE (it used to "succeed" having written nothing), so
// the success-path tests must give the job somewhere to write.
function testJob(id: number, backupType: string, destinationPath: string | null = path.join(TEST_DIR, "dest")) {
  return {
    id,
    jobName: `test-job-${id}`,
    backupType,
    destinationType: "LOCAL",
    destinationPath,
    schedule: "* * * * *",
    retentionDays: 0,
    isEnabled: true,
    lastRunAt: null,
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  jobsSelectResult = [];
  logUpdateCalls = [];
  jobUpdateCalls = [];
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("fireScheduledBackups — success is only recorded when the export actually completed (Ticket E0.1 / CRIT-1)", () => {
  test("export fails (pg_dump AND fallback both fail) — job is marked failed, never success", async () => {
    exportDatabaseSqlImpl = rejectingExport("pg_dump exited with code 1: connection reset");
    exportDatabaseSqlFallbackImpl = rejectingExport("fallback also failed: pool exhausted");
    jobsSelectResult = [testJob(101, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(false);
    expect(logUpdateCalls.some((c) => c["status"] === "failed")).toBe(true);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "success")).toBe(false);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "failed")).toBe(true);
  });

  test("pg_dump fails but the paginated fallback succeeds — job is marked success", async () => {
    exportDatabaseSqlImpl = rejectingExport("pg_dump binary not found");
    exportDatabaseSqlFallbackImpl = async () => ({
      filePath: makeRealDumpFile("fallback-dump.sql", "-- fallback export\nINSERT INTO patients ...;\n"),
      sizeBytes: 42,
      rowCount: 12345,
    });
    jobsSelectResult = [testJob(102, "FULL")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(true);
    expect(logUpdateCalls.some((c) => c["status"] === "failed")).toBe(false);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "success")).toBe(true);
  });

  test("pg_dump succeeds outright — job is marked success with the real exported size", async () => {
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("full-dump.sql", "-- full pg_dump\nCREATE TABLE patients (...);\n".repeat(50)),
      sizeBytes: 2048,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(103, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const successLog = logUpdateCalls.find((c) => c["status"] === "success");
    expect(successLog).toBeDefined();
    expect(successLog!["sizeBytes"]).toBe(2048);
  });

  test("a job with NO destinationPath is marked failed — never a phantom 'in-memory' success", async () => {
    // Regression: this used to encrypt the dump into a local variable, discard
    // it, and record status "success" with filePath null and notes reading
    // "In-memory backup" — a permanently green job that never persisted a byte.
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("orphan-dump.sql", "-- dump\n"),
      sizeBytes: 8,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(105, "DB", null)];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(false);
    const failed = logUpdateCalls.find((c) => c["status"] === "failed");
    expect(failed).toBeDefined();
    expect(String(failed!["errorMessage"])).toMatch(/destinationPath/i);
  });

  test("an unimplemented backup type is marked failed, not 'completed (placeholder)'", async () => {
    exportDatabaseSqlImpl = rejectingExport("should not be called");
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(106, "DICOM_METADATA")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(false);
    const failed = logUpdateCalls.find((c) => c["status"] === "failed");
    expect(failed).toBeDefined();
    expect(String(failed!["errorMessage"])).toMatch(/not implemented/i);
  });

  test("a completed backup records encrypted=true and a real filePath", async () => {
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("enc-dump.sql", "-- dump\n"),
      sizeBytes: 8,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(107, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const successLog = logUpdateCalls.find((c) => c["status"] === "success");
    expect(successLog).toBeDefined();
    expect(successLog!["encrypted"]).toBe(true);
    expect(String(successLog!["filePath"])).toMatch(/\.sql\.enc$/);
  });

  test("a disabled or MANUAL-only job is never touched by the cron sweep", async () => {
    exportDatabaseSqlImpl = rejectingExport("should never be called for a MANUAL job");
    exportDatabaseSqlFallbackImpl = rejectingExport("should never be called for a MANUAL job");
    jobsSelectResult = [{ ...testJob(104, "DB"), schedule: "MANUAL" }];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls).toHaveLength(0);
    expect(jobUpdateCalls).toHaveLength(0);
  });
});

describe("fireScheduledBackups — SHA-256 checksum recorded on every completed backup (Ticket E0.1d)", () => {
  test("a successful backup's backup_job_logs update includes the exact SHA-256 of the encrypted content", async () => {
    const sqlContent = "-- pg_dump output\nCREATE TABLE patients (id int);\n";
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-with-checksum.sql", sqlContent),
      sizeBytes: sqlContent.length,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(201, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    // Mocked encryptBackup is `(s) => \`encrypted:${s}\`` (see the
    // @workspace/crypto mock above) — the checksum must be over that
    // encrypted string, not the raw SQL.
    const expectedChecksum = createHash("sha256").update(`encrypted:${sqlContent}`).digest("hex");
    const successLog = logUpdateCalls.find((c) => c["status"] === "success");
    expect(successLog).toBeDefined();
    expect(successLog!["checksum"]).toBe(expectedChecksum);
  });

  test("a failed backup's backup_job_logs update never carries a checksum for data that was never produced", async () => {
    exportDatabaseSqlImpl = rejectingExport("pg_dump exited with code 1");
    exportDatabaseSqlFallbackImpl = rejectingExport("fallback also failed");
    jobsSelectResult = [testJob(202, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const failedLog = logUpdateCalls.find((c) => c["status"] === "failed");
    expect(failedLog).toBeDefined();
    expect(failedLog!["checksum"]).toBeUndefined();
  });

  test("two different backups (different content) get two different checksums — not a constant/placeholder value", async () => {
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-1.sql", "-- dump one\n"),
      sizeBytes: 10,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(203, "DB")];
    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();
    const firstChecksum = logUpdateCalls.find((c) => c["status"] === "success")!["checksum"];

    logUpdateCalls = [];
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-2.sql", "-- dump two, different content\n"),
      sizeBytes: 30,
      rowCount: null,
    });
    jobsSelectResult = [testJob(204, "DB")];
    await fireScheduledBackups();
    const secondChecksum = logUpdateCalls.find((c) => c["status"] === "success")!["checksum"];

    expect(firstChecksum).not.toBe(secondChecksum);
  });
});
