import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { insertRow, orderRows, projectRows, relationName, selectRows, updateRows } from "./testSupport/inMemoryRelation";
import {
  encryptFileStub,
  resetRoundTripStub,
  roundTripStub,
  sha256FileStub,
  type StubRoundTripOptions,
  type StubRoundTripResult,
} from "./testSupport/backupCryptoStub";
import { parseBackupRunProof } from "./lib/backupJobEvidence";

// Emergency Ticket E0.1 (CRIT-1) — job-level regression coverage.
//
// Proves fireScheduledBackups only records a backup job as "success" when
// the underlying export actually completed. Complements
// backupReplication.test.ts's lower-level exportDatabaseSql race tests:
// this file checks the outcome that actually lands in backup_job_logs /
// backup_jobs, which is what an admin looking at the Backups UI would see.
//
// Reads and writes go through the in-memory relation, so an UPDATE that matches no row records no
// outcome. The runner sweeps the ledger for orphaned runs on every pass; a mock that reported that
// sweep as an outcome would mis-label this file's failures as real ones.

const TEST_DIR = path.resolve(__dirname, "../.tmp-e0-1-cron-test");

let jobsSelectResult: Record<string, unknown>[];
let logRows: Record<string, unknown>[];
let logIdSeq: number;
// Stands in for a parking directory the scheduler cannot prepare (read-only volume, EACCES).
let unprovenDirThrows = false;

let logUpdateCalls: Record<string, unknown>[];
let jobUpdateCalls: Record<string, unknown>[];
let exportDatabaseSqlImpl: () => Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }>;
let exportDatabaseSqlFallbackImpl: () => Promise<{ filePath: string; sizeBytes: number; rowCount: number | null }>;

function datasetFor(table: unknown): Record<string, unknown>[] {
  return relationName(table) === "backup_job_logs" ? logRows : jobsSelectResult;
}

/**
 * A read the caller can either await directly (`.where(...)`) or keep chaining
 * (`.orderBy(desc(x)).limit(1)`), honouring the same WHERE clause either way. The backup runner uses
 * the first form; `runBackupDeadManCheck()` uses the second, and a mock that only implemented one of
 * them would make the dead-man untestable — which is how the per-job overdue pass ended up with no
 * coverage of the tick production actually triggers.
 */
function readable(table: unknown, clause: unknown, columns?: Record<string, unknown>) {
  const matched = () => selectRows(table, datasetFor(table), clause);
  const project = (rows: Record<string, unknown>[]) => (columns ? projectRows(rows, columns, table) : rows);
  return {
    then: (onFulfil?: (v: unknown) => unknown, onReject?: (e: unknown) => unknown) =>
      Promise.resolve(project(matched())).then(onFulfil, onReject),
    orderBy: (ordering: unknown) => {
      const sorted = orderRows(table, matched(), ordering);
      return { limit: async (n: number) => project(sorted.slice(0, n)) };
    },
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    select: (columns?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (clause?: unknown) => readable(table, clause, columns),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => [insertRow(logRows, values, logIdSeq++)],
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (clause?: unknown) => {
          if (updateRows(datasetFor(table), values, clause) === 0) return;
          (relationName(table) === "backup_job_logs" ? logUpdateCalls : jobUpdateCalls).push(values);
        },
      }),
    }),
  },
  // Each job takes a session advisory lock before it claims an occurrence. Always grant it
  // here; who-wins-the-lock is covered in cronBackupScheduling.test.ts.
  pool: {
    connect: async () => ({
      query: async () => ({ rows: [{ locked: true }] }),
      release: () => undefined,
    }),
  },
}));

const sendAlertEmailMock = vi.hoisted(() =>
  vi.fn(async (_params: { subject: string; html: string }) => ({ ok: true, to: ["admin@clinic.test"], error: null as string | null })),
);
vi.mock("./email", () => ({
  sendDailySummaryEmail: vi.fn(),
  sendMonthlyAuditEmail: vi.fn(),
  sendAlertEmail: sendAlertEmailMock,
}));

// The alert path is stubbed here so these tests can assert WHAT the runner reports about a run —
// the decision itself (first failure vs 24 h reminder vs recovery) is covered in
// lib/backupAlerts.test.ts against the real state machine. Left unstubbed, the real module would try
// to read and upsert `watchdog_status` through the partial `@workspace/db` mock above, which has no
// `onConflictDoUpdate`, and every run in this file would log a state error.
//
// The parameter is typed rather than inferred, so `mock.calls[0][0]` below is the real payload and a
// renamed or dropped field is a compile error instead of an `undefined` that passes a loose assert.
type NotifyBackupOutcomeParams = {
  jobId: number;
  jobName: string;
  outcome: "success" | "failure" | "overdue";
  detail: string | null;
  destination: string | null;
  scheduleLabel: string;
  occurrence?: Date | null;
  now?: Date;
};
const notifyBackupOutcomeMock = vi.hoisted(() =>
  vi.fn(async (_params: NotifyBackupOutcomeParams) => ({
    sent: false,
    kind: null as string | null,
    reason: "nothing-to-report" as const,
  })),
);
// Also hoisted because the dead-man tick is asserted below: production does not set ENABLE_SCHEDULERS,
// so `POST /api/internal/cron/backup-dead-man` is the only thing that ever asks a job whether it was
// missed. That pass had no coverage at all until this spy existed.
const alertOnOverdueBackupJobsMock = vi.hoisted(() =>
  vi.fn(async (_jobs: Record<string, unknown>[], _now: Date) => ({ checked: 1, sent: 1, suppressed: 0 })),
);
vi.mock("./lib/backupAlerts", () => ({
  notifyBackupOutcome: notifyBackupOutcomeMock,
  alertOnOverdueBackupJobs: alertOnOverdueBackupJobsMock,
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
//
// sha256File and verifyBackupRoundTrip are mocked too, but NOT as empty stubs: the default in
// testSupport/backupCryptoStub does the same arithmetic the real one does (strip the envelope, hash
// what is left, compare), so `cron.ts` is wired against a verifier that can answer NO.
// A test that only ever sees YES would pass whether or not cron checks the answer —
// which is the entire defect this PR fixes. `roundTripStub.impl` is reassigned by
// the verification-failure tests to force the failure path, and restored in afterEach.
vi.mock("./lib/backupCrypto", () => ({
  resolveBackupPassphrase: () => ({ passphrase: "test-passphrase", source: "BACKUP_PASSPHRASE" }),
  encryptBackupFile: async (inPath: string, outPath: string) =>
    encryptFileStub(inPath, outPath, (p, data) => writeFileSync(p, data, "utf-8")),
  sha256File: async (p: string) => sha256FileStub(p),
  verifyBackupRoundTrip: (opts: StubRoundTripOptions) => roundTripStub.impl(opts),
  candidatePassphrases: () => [{ passphrase: "test-passphrase", source: "BACKUP_PASSPHRASE" }],
}));

vi.mock("./routes/backupReplication", () => ({
  exportDatabaseSql: async (..._args: unknown[]) => exportDatabaseSqlImpl(),
  exportDatabaseSqlFallback: async (..._args: unknown[]) => exportDatabaseSqlFallbackImpl(),
  // Real implementation (not a stub) so tests can assert the exact expected
  // hash rather than just "some value was stored" — Ticket E0.1d.
  computeSha256: (data: string) => createHash("sha256").update(data).digest("hex"),
  CONFIG_BACKUP_TABLES: ["clinic_settings", "email_settings", "printer_settings", "pacs_settings"],
  // Where the scheduler parks a cleartext dump it could not prove. The real one sits under
  // BACKUP_TEMP_DIR; the tests use a sibling of the dump directory so the rename is a real move
  // within one volume and the assertions can name the path.
  unprovenDumpDir: () => {
    if (unprovenDirThrows) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const dir = path.join(TEST_DIR, "unproven");
    mkdirSync(dir, { recursive: true });
    return dir;
  },
  PRIVATE_FILE_MODE: 0o600,
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

// ── The decrypt-verification seam ─────────────────────────────────────────────────────────────
// `roundTripStub.impl` is the stand-in verifier cron calls (testSupport/backupCryptoStub). The
// default re-does the real arithmetic and returns YES only when the artifact really re-hashes to the
// dump's digest. These two helpers let a test watch the question being asked, or force the answer.
// Everything is reset in beforeEach/afterEach so a forced NO cannot leak into the next test and make
// an unrelated success assertion fail for the wrong reason.
let roundTripCalls: StubRoundTripOptions[];

function recordRoundTripCalls(): void {
  const inner = roundTripStub.impl;
  roundTripStub.impl = (opts) => {
    roundTripCalls.push(opts);
    return inner(opts);
  };
}

function failRoundTrip(reason: StubRoundTripResult["reason"], detail: string) {
  roundTripStub.impl = (opts) => ({
    ok: false,
    reason,
    detail,
    keySource: opts.key.source,
    ciphertextBytes: 128,
    decryptedBytes: 0,
    decryptedSha256: null,
    expectedPlaintextSha256: opts.expectedPlaintextSha256,
    plaintextBytes: opts.plaintextBytes ?? null,
  });
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
  logRows = [];
  logIdSeq = 1;
  logUpdateCalls = [];
  jobUpdateCalls = [];
  roundTripCalls = [];
  unprovenDirThrows = false;
  resetRoundTripStub();
  notifyBackupOutcomeMock.mockClear();
  alertOnOverdueBackupJobsMock.mockClear();
  sendAlertEmailMock.mockClear();
});

afterEach(() => {
  resetRoundTripStub();
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

describe("fireScheduledBackups — an encrypted backup is a backup only after it decrypts to the bytes that were archived", () => {
  // Owner requirement 1–4 of the P10 brief, at the job level. The lower-level `backupCrypto` suite
  // proves openssl behaves as described; what THIS file has to prove is that the scheduler asks, and
  // that a NO stops the record. Without these, a runner that called `verifyBackupRoundTrip` and
  // threw the answer away would still be green — which is exactly the shape of the defect: AES-CBC
  // carries no integrity tag, so "openssl exited 0" was never evidence of anything (#1138 measured a
  // wrong passphrase exiting 0 with garbage roughly 1 time in 300).

  test("a verified run calls the verifier on the artifact it wrote, with the dump's own digest", async () => {
    const sqlContent = "-- pg_dump output\nCREATE TABLE patients (id int);\nINSERT INTO patients VALUES (1);\n";
    let dumpPath = "";
    exportDatabaseSqlImpl = async () => {
      dumpPath = makeRealDumpFile("verified-dump.sql", sqlContent);
      return { filePath: dumpPath, sizeBytes: Buffer.byteLength(sqlContent), rowCount: null };
    };
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(401, "DB")];
    recordRoundTripCalls();

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const successLog = logUpdateCalls.find((c) => c["status"] === "success");
    expect(successLog).toBeDefined();
    expect(roundTripCalls).toHaveLength(1);
    // The question the verifier must be asked, exactly: this artifact, against this digest, with
    // this byte count, under this key. A call with the dump path, or with the ciphertext digest,
    // would "verify" nothing.
    expect(roundTripCalls[0]!.cipherPath).toBe(String(successLog!["filePath"]));
    expect(roundTripCalls[0]!.expectedPlaintextSha256).toBe(
      createHash("sha256").update(sqlContent).digest("hex"),
    );
    expect(roundTripCalls[0]!.plaintextBytes).toBe(Buffer.byteLength(sqlContent));
    expect(roundTripCalls[0]!.key.source).toBe("BACKUP_PASSPHRASE");
  });

  test("a verified run writes a proof marker whose digests are the real ones, not a placeholder", async () => {
    const sqlContent = "-- pg_dump output\nCREATE TABLE encounters (id int);\n";
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("proof-dump.sql", sqlContent),
      sizeBytes: Buffer.byteLength(sqlContent),
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(402, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const successLog = logUpdateCalls.find((c) => c["status"] === "success");
    const notes = String(successLog!["notes"]);
    const proof = parseBackupRunProof(notes);
    expect(proof).not.toBeNull();
    expect(proof!.plaintextSha256).toBe(createHash("sha256").update(sqlContent).digest("hex"));
    // The stub envelope is `encrypted:` + plaintext; the artifact digest must be over the
    // ciphertext as it sits on disk, which is a different value from the plaintext digest.
    expect(proof!.artifactSha256).toBe(createHash("sha256").update(`encrypted:${sqlContent}`).digest("hex"));
    expect(proof!.plaintextBytes).toBe(Buffer.byteLength(sqlContent));
    expect(proof!.decryptedBytes).toBe(Buffer.byteLength(sqlContent));
    expect(proof!.keySource).toBe("BACKUP_PASSPHRASE");
    expect(proof!.outcome).toBe("verified");
    expect(successLog!["checksum"]).toBe(proof!.artifactSha256);
  });

  test("verification answers hash_mismatch — the run is a failure and no success is recorded anywhere", async () => {
    const sqlContent = "-- pg_dump output\nCREATE TABLE patients (id int);\n";
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("mismatch-dump.sql", sqlContent),
      sizeBytes: Buffer.byteLength(sqlContent),
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(403, "DB")];
    failRoundTrip("hash_mismatch", "the artifact decrypts to 3f9a1c0d3b22 where the dump was a71e0b1c9d44");

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(false);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "success")).toBe(false);
    const failed = logUpdateCalls.find((c) => c["status"] === "failed");
    expect(failed).toBeDefined();
    const message = String(failed!["errorMessage"]);
    expect(message).toMatch(/verification FAILED/i);
    expect(message).toMatch(/reason=hash_mismatch/);
    expect(message).toMatch(/NOT been proven restorable/);
    // The ledger must not point at the unproven artifact as a backup it can offer to restore.
    expect(failed!["filePath"]).toBeUndefined();
    expect(failed!["checksum"]).toBeUndefined();
  });

  test("a verification failure reaches the same alert mail as any other failure, naming the reason", async () => {
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("alert-dump.sql", "-- pg_dump output\n"),
      sizeBytes: 18,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    // The destination must be one the runner can actually create. A NAS path (`/volume1/...`) is
    // writable on the developer's Windows box — where mkdir silently creates C:\volume1 — and
    // EACCES on the Linux CI runner, so the run died in mkdir before the verification ever happened
    // and this test failed for a reason that had nothing to do with what it asserts.
    const dest = path.join(TEST_DIR, "dest");
    jobsSelectResult = [testJob(404, "DB", dest)];
    failRoundTrip("decrypt_failed", "openssl exited 1 (bad decrypt)");

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).toHaveBeenCalledTimes(1);
    const arg = notifyBackupOutcomeMock.mock.calls[0]![0];
    expect(arg.jobId).toBe(404);
    expect(arg.outcome).toBe("failure");
    expect(String(arg.detail)).toMatch(/verification FAILED/i);
    expect(String(arg.detail)).toMatch(/reason=decrypt_failed/);
    expect(arg.destination).toBe(dest);
  });

  test("the success alert says the artifact was decrypt-verified; nothing here claims that without a proof", async () => {
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("success-detail.sql", "-- pg_dump output\n"),
      sizeBytes: 18,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(405, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).toHaveBeenCalledTimes(1);
    const detail = String(notifyBackupOutcomeMock.mock.calls[0]![0].detail);
    expect(detail).toMatch(/encrypted/);
    expect(detail).toMatch(/decrypt-verified yes/);
    expect(detail).not.toMatch(/decrypt-verified NO/);
  });

  test("a failed proof keeps the plaintext dump, but parks it where the ERP cannot reach it", async () => {
    // The dump is the last copy of the data this run read, so it is not deleted. It must also not
    // sit in the directory GET /api/admin/backup-replication/download serves out of, because that
    // file is the whole clinic in cleartext.
    const dumpPath = makeRealDumpFile("kept-dump.sql", "-- pg_dump output\n");
    exportDatabaseSqlImpl = async () => ({ filePath: dumpPath, sizeBytes: 18, rowCount: null });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(406, "DB")];
    failRoundTrip("artifact_missing", "the encrypted artifact does not exist");

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const parked = path.join(TEST_DIR, "unproven", "kept-dump.sql");
    expect(existsSync(dumpPath), "the cleartext dump stayed in the download-served directory").toBe(false);
    expect(existsSync(parked), "the dump was deleted instead of parked").toBe(true);
    expect(readFileSync(parked, "utf-8")).toMatch(/pg_dump/);
    const message = String(logUpdateCalls.find((c) => c["status"] === "failed")!["errorMessage"]);
    expect(message).toContain(parked);
    expect(message).toMatch(/cannot list or download/);
    // The failure still says what it encrypted, because the artifact was written before it failed.
    expect(logUpdateCalls.find((c) => c["status"] === "failed")!["encrypted"]).toBe(true);
  });

  test("a dump that cannot be parked is still kept rather than deleted", async () => {
    // The parking directory is the optimisation, not the guarantee. If preparing it fails, the run
    // must still leave the data on disk instead of falling through to the delete in `finally`.
    const dumpPath = makeRealDumpFile("unparkable-dump.sql", "-- pg_dump output\n");
    exportDatabaseSqlImpl = async () => ({ filePath: dumpPath, sizeBytes: 18, rowCount: null });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(409, "DB")];
    failRoundTrip("decrypt_failed", "openssl exited 1 (bad decrypt)");
    unprovenDirThrows = true;

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(existsSync(dumpPath)).toBe(true);
    expect(readFileSync(dumpPath, "utf-8")).toMatch(/pg_dump/);
    expect(String(logUpdateCalls.find((c) => c["status"] === "failed")!["errorMessage"])).toContain(dumpPath);
  });

  test("a verified run deletes the unencrypted intermediate dump", async () => {
    const dumpPath = makeRealDumpFile("gone-dump.sql", "-- pg_dump output\n");
    exportDatabaseSqlImpl = async () => ({ filePath: dumpPath, sizeBytes: 18, rowCount: null });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(407, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(existsSync(dumpPath)).toBe(false);
    expect(logUpdateCalls.some((c) => c["status"] === "success")).toBe(true);
  });

  test("no verification call means no proof marker, and the run still cannot claim one", async () => {
    // Fail-closed reading of the marker: cron only writes `outcome=verified` when the verifier
    // actually said so. Force the verifier to report a mismatch and confirm the notes it would have
    // written never reach the ledger, so the Backup & Replication page has nothing to misread.
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("noproof-dump.sql", "-- pg_dump output\n"),
      sizeBytes: 18,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(408, "DB")];
    failRoundTrip("byte_count_mismatch", "the artifact decrypts to 12 bytes but the dump wrote 18");

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    const rows = logUpdateCalls.map((c) => String(c["notes"] ?? "") + String(c["errorMessage"] ?? ""));
    expect(rows.join("\n")).not.toMatch(/outcome=verified/);
    expect(rows.join("\n")).toMatch(/reason=byte_count_mismatch/);
  });
});

describe("fireScheduledBackups — the alert path reports the run, and cannot change what the ledger says", () => {
  // Owner requirement behind these four: an e-mail is a report about a backup, never a part of one.
  // Both directions are covered — the runner must tell the alert layer what really happened
  // (including what the artifact was proven to be), and a broken alert layer must not be able to
  // rewrite a completed backup as a failure or abort a run.

  test("a failed run raises one failure alert naming the job, the error and the destination", async () => {
    exportDatabaseSqlImpl = rejectingExport("pg_dump exited with code 1: connection reset");
    exportDatabaseSqlFallbackImpl = rejectingExport("fallback export failed: permission denied");
    jobsSelectResult = [testJob(301, "DB", "/volume1/backup/care-erp/db")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).toHaveBeenCalledTimes(1);
    expect(notifyBackupOutcomeMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        jobId: 301,
        jobName: "test-job-301",
        outcome: "failure",
        detail: "fallback export failed: permission denied",
        destination: "/volume1/backup/care-erp/db",
        // "* * * * *" fires every minute: describeSchedule declines to paraphrase it, and the
        // runner passes the stored text through rather than inventing a friendlier label.
        scheduleLabel: "* * * * *",
      }),
    );
  });

  test("a completed run reports success, and says what the artifact was proven to be", async () => {
    const sqlContent = "-- pg_dump output\nCREATE TABLE patients (id int);\n";
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-alert-success.sql", sqlContent),
      sizeBytes: sqlContent.length,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(302, "DB")];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).toHaveBeenCalledTimes(1);
    const arg = notifyBackupOutcomeMock.mock.calls[0]![0];
    expect(arg.outcome).toBe("success");
    expect(arg.jobId).toBe(302);
    // Not merely "the code got to the end": encryption and checksum are reported as the facts the
    // run established, because an unencrypted or unhashed artifact is not a usable backup.
    expect(arg.detail).toContain("written encrypted");
    expect(arg.detail).toContain("checksum recorded");
    expect(arg.occurrence).toBeInstanceOf(Date);
  });

  test("an unencrypted, unhashed artifact is reported as such instead of as a clean success", async () => {
    // A DB job whose write never reached the encryption block cannot happen through this route, so
    // the case is driven the way it does happen: destinationPath missing means nothing was
    // persisted, and that must arrive as a failure rather than a green success + a recovery mail.
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-no-dest.sql", "-- dump\n"),
      sizeBytes: 8,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(303, "DB", null)];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).toHaveBeenCalledTimes(1);
    const arg = notifyBackupOutcomeMock.mock.calls[0]![0];
    expect(arg.outcome).toBe("failure");
    expect(arg.detail).toMatch(/No destinationPath configured/);
    expect(logUpdateCalls.find((c) => c["status"] === "success")).toBeUndefined();
    // Nothing was encrypted on this path, so the ledger must not claim it was. The failure row used
    // to carry a literal `encrypted: true` for every failure, which asserted a property of a file
    // the run never wrote.
    expect(logUpdateCalls.find((c) => c["status"] === "failed")!["encrypted"]).toBe(false);
  });

  test("an alert that throws does not rewrite a completed backup as a failed one", async () => {
    const sqlContent = "-- pg_dump output\n";
    exportDatabaseSqlImpl = async () => ({
      filePath: makeRealDumpFile("dump-alert-throws.sql", sqlContent),
      sizeBytes: sqlContent.length,
      rowCount: null,
    });
    exportDatabaseSqlFallbackImpl = rejectingExport("should not be called");
    jobsSelectResult = [testJob(304, "DB")];
    notifyBackupOutcomeMock.mockRejectedValueOnce(new Error("SMTP connection refused"));

    const { fireScheduledBackups } = await import("./cron");
    await expect(fireScheduledBackups()).resolves.toBeUndefined();

    // The backup is complete and stays recorded as complete. Only the notification was lost.
    expect(logUpdateCalls.filter((c) => c["status"] === "success")).toHaveLength(1);
    expect(logUpdateCalls.some((c) => c["status"] === "failed")).toBe(false);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "failed")).toBe(false);
    expect(jobUpdateCalls.some((c) => c["lastStatus"] === "success")).toBe(true);
  });

  test("a job that was never due reports nothing at all", async () => {
    exportDatabaseSqlImpl = rejectingExport("must not run");
    exportDatabaseSqlFallbackImpl = rejectingExport("must not run");
    jobsSelectResult = [{ ...testJob(305, "DB"), schedule: "MANUAL" }];

    const { fireScheduledBackups } = await import("./cron");
    await fireScheduledBackups();

    expect(notifyBackupOutcomeMock).not.toHaveBeenCalled();
  });
});

describe("the dead-man tick also asks each job whether its own occurrence was missed", () => {
  // Why this belongs with the runner's tests rather than the alert layer's: production does not set
  // ENABLE_SCHEDULERS, so `POST /api/internal/cron/backup-dead-man` is the only thing that ever asks
  // the question. A per-job overdue check that is correct in isolation and unwired here would alert
  // exactly never.
  function nightlyBehindSchedule(id: number): Record<string, unknown> {
    return {
      ...testJob(id, "DB", "/volume1/backup/care-erp/db"),
      schedule: "0 20 * * *",
      // Three days of cursor: the job has not run for its newest occurrence.
      lastRunAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    };
  }

  test("the per-job pass runs with the enabled jobs it read, projected to what it needs", async () => {
    jobsSelectResult = [nightlyBehindSchedule(401)];
    logRows = []; // nothing has ever completed, which is what the aggregate alert also sees

    const { runBackupDeadManCheck } = await import("./cron");
    const res = await runBackupDeadManCheck();

    expect(res.status).toBe("never");
    expect(res.alerted).toBe(true);
    expect(res.overdue).toEqual({ checked: 1, sent: 1, suppressed: 0 });

    expect(alertOnOverdueBackupJobsMock).toHaveBeenCalledTimes(1);
    const [jobsArg, nowArg] = alertOnOverdueBackupJobsMock.mock.calls[0]!;
    expect(jobsArg).toEqual([
      expect.objectContaining({
        id: 401,
        jobName: "test-job-401",
        schedule: "0 20 * * *",
        destinationPath: "/volume1/backup/care-erp/db",
      }),
    ]);
    expect(nowArg).toBeInstanceOf(Date);
  });

  test("a disabled job is not handed to the pass", async () => {
    jobsSelectResult = [{ ...nightlyBehindSchedule(402), isEnabled: false }];
    logRows = [];

    const { runBackupDeadManCheck } = await import("./cron");
    await runBackupDeadManCheck();

    expect(alertOnOverdueBackupJobsMock).toHaveBeenCalledWith([], expect.any(Date));
  });

  test("the aggregate alert still goes out when the per-job pass cannot run", async () => {
    // An overdue check that breaks must not take the dead-man down with it: the dead-man is the last
    // line of defence for "there are no backups at all".
    jobsSelectResult = [nightlyBehindSchedule(403)];
    logRows = [];
    alertOnOverdueBackupJobsMock.mockRejectedValueOnce(new Error("watchdog_status is unreadable"));

    const { runBackupDeadManCheck } = await import("./cron");
    const res = await runBackupDeadManCheck();

    expect(res.alerted).toBe(true);
    expect(res.overdue).toBeNull();
    expect(sendAlertEmailMock).toHaveBeenCalledTimes(1);
  });
});
