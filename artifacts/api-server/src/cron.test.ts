import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
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
  sendCommissionMonthEndEmail: vi.fn(),
  sendMonthlyAuditEmail: vi.fn(),
  sendBackupFailureEmail: vi.fn(async () => undefined),
}));

vi.mock("./routes/books-sanity", () => ({ runBooksSanity: vi.fn() }));

vi.mock("./services/dicom-pull-agent/dimse-agent", () => ({
  startDimsePullAgent: vi.fn(),
  stopDimsePullAgent: vi.fn(),
  isDimsePullAgentRunning: vi.fn(() => false),
}));

vi.mock("@workspace/crypto", () => ({
  encryptBackup: (s: string) => `encrypted:${s}`,
}));

vi.mock("./routes/backupReplication", () => ({
  exportDatabaseSql: async (..._args: unknown[]) => exportDatabaseSqlImpl(),
  exportDatabaseSqlFallback: async (..._args: unknown[]) => exportDatabaseSqlFallbackImpl(),
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
function testJob(id: number, backupType: string, destinationPath: string | null = null) {
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
