import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { explainWhere, insertRow, relationName, selectRows, updateRows } from "./testSupport/inMemoryRelation";

// Scheduling-integrity regression coverage for the automated backup runner.
//
// Why this file exists (measured on production, 2026-10-22): every row in `backup_jobs` carries
// schedule `0 2 * * *` — a DAILY 02:00 job — yet `backup_job_logs` recorded all four jobs firing
// once per HOUR (164 runs in 48 h), ~2.4 GB/hour onto the same RAID1 that holds the live database
// and Orthanc, which is the measured I/O driver of the clinic outage that day. The cause is the
// schedule interpreter in `fireScheduledBackups`: it read ONLY the minute field of a cron
// expression, ignored hour/day-of-month/month/day-of-week entirely, and then derived the minimum
// spacing between runs from `parseInt(minutePart, 10) || 1` — so "0" (the minute of 02:00) became
// a 60-SECOND spacing, i.e. "fire at minute 0 of every hour". A daily backup was an hourly backup
// the moment it was saved.
//
// The tests below drive the real `fireScheduledBackups` over a controlled clock and synthetic job
// rows only. Reads and writes go through an in-memory relation that honours the actual WHERE clause
// (see testSupport/inMemoryRelation), because a mock that answers every read with the whole dataset
// cannot tell an at-most-once claim from a full-table scan. No real patient data, no real database.

const TEST_DIR = path.resolve(__dirname, "../.tmp-backup-scheduling");

type Row = Record<string, unknown>;

let jobsRows: Row[];
let ledgerRows: Row[];
let statements: { kind: "select" | "update"; relation: string; sql: string; params: unknown[]; matched?: number }[];
let insertedLogs: Row[];
let updatedLogs: Row[];
let updatedJobs: Row[];
let lockGrants: boolean[];
let lockCalls: { unlock: boolean; sql: string; key: string }[];
let events: string[];
let exportCalls: string[];
let alertReports: { jobId: unknown; outcome: string }[];
let logIdSeq: number;

function fakeClient() {
  return {
    query: async (sqlText: string, params?: unknown[]) => {
      const grant = lockGrants.length ? (lockGrants.shift() as boolean) : true;
      const isUnlock = /pg_advisory_unlock/i.test(sqlText);
      lockCalls.push({ unlock: isUnlock, sql: sqlText, key: String(params?.[0] ?? "") });
      events.push(isUnlock ? "unlock" : `lock:grant=${grant}`);
      return { rows: [{ locked: grant }] };
    },
    release: () => {
      events.push("release");
    },
  };
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async (clause?: unknown) => {
          const relation = relationName(table);
          const where = explainWhere(clause);
          statements.push({ kind: "select", relation, ...where });
          // The jobs table and the ledger are different relations; a claim check that quietly read
          // the wrong one would never see its own rows.
          return selectRows(table, relation === "backup_job_logs" ? ledgerRows : jobsRows, clause);
        },
      }),
    }),
    insert: () => ({
      values: (values: Row) => ({
        returning: async () => {
          events.push("insert");
          const row = insertRow(ledgerRows, values, logIdSeq++);
          // A snapshot of what the INSERT wrote; `ledgerRows` keeps the live row the run updates.
          insertedLogs.push({ ...row });
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: async (clause?: unknown) => {
          const relation = relationName(table);
          const dataset = relation === "backup_job_logs" ? ledgerRows : jobsRows;
          const where = explainWhere(clause);
          const matched = updateRows(dataset, values, clause);
          statements.push({ kind: "update", relation, matched, ...where });
          // A real database leaves no trace of an UPDATE that matched nothing, and the assertions
          // below depend on that: the orphan sweep runs on every single tick.
          if (matched === 0) return;
          events.push(`update:${relation}:${String(values["status"] ?? "cursor")}`);
          const entry = { ...values, __where: where.sql, __params: where.params, __matched: matched };
          (relation === "backup_job_logs" ? updatedLogs : updatedJobs).push(entry);
        },
      }),
    }),
  },
  pool: { connect: async () => fakeClient() },
}));

vi.mock("./email", () => ({
  sendDailySummaryEmail: vi.fn(),
  sendMonthlyAuditEmail: vi.fn(),
}));

// The alert layer is replaced by a recorder. What this file proves is scheduling integrity, and what
// the runner hands the alert layer is part of that proof: one occurrence produces one report, and a
// failing job reports only itself. Whether that report should actually become an e-mail — first
// failure, 24 h reminder, one recovery — is decided in lib/backupAlerts.test.ts. Left real, this
// module would try to upsert `watchdog_status` through the partial `@workspace/db` mock above.
vi.mock("./lib/backupAlerts", () => ({
  notifyBackupOutcome: async (params: Record<string, unknown>) => {
    alertReports.push({ jobId: params.jobId, outcome: String(params.outcome) });
    return { sent: false, kind: null, reason: "nothing-to-report" };
  },
  alertOnOverdueBackupJobs: async () => ({ checked: 0, sent: 0, suppressed: 0 }),
}));

vi.mock("./routes/books-sanity", () => ({ runBooksSanity: vi.fn() }));

vi.mock("./services/dicom-pull-agent/dimse-agent", () => ({
  startDimsePullAgent: vi.fn(),
  stopDimsePullAgent: vi.fn(),
  isDimsePullAgentRunning: vi.fn(() => false),
}));

vi.mock("./lib/backupCrypto", () => ({
  resolveBackupPassphrase: () => ({ passphrase: "test-passphrase", source: "BACKUP_PASSPHRASE" }),
  encryptBackupFile: async (inPath: string, outPath: string) => {
    writeFileSync(outPath, `encrypted:${readFileSync(inPath, "utf-8")}`, "utf-8");
    return { format: "openssl-aes-256-cbc", keySource: "BACKUP_PASSPHRASE" };
  },
}));

vi.mock("./routes/backupReplication", () => ({
  exportDatabaseSql: async () => {
    exportCalls.push("pg_dump");
    const filePath = path.join(TEST_DIR, `dump-${exportCalls.length}.sql`);
    writeFileSync(filePath, `dump body ${exportCalls.length}`, "utf-8");
    return { filePath, sizeBytes: 1234, rowCount: 42 };
  },
  exportDatabaseSqlFallback: async () => {
    exportCalls.push("fallback");
    const filePath = path.join(TEST_DIR, "dump-fb.sql");
    writeFileSync(filePath, "fallback body", "utf-8");
    return { filePath, sizeBytes: 999, rowCount: 7 };
  },
  computeSha256: (data: string) => createHash("sha256").update(data).digest("hex"),
  CONFIG_BACKUP_TABLES: ["clinic_settings"],
}));

/** A synthetic job exactly in the shape production stores: cron text, enabled, and a real
 *  destination directory so a run that does fire can succeed. */
function jobRow(over: Row = {}): Row {
  return {
    id: 1,
    jobName: "Nightly",
    backupType: "FULL",
    destinationType: "LOCAL",
    destinationPath: path.join(TEST_DIR, "dest"),
    schedule: "0 2 * * *",
    retentionDays: 5,
    isEnabled: true,
    lastRunAt: null,
    ...over,
  };
}

/** A ledger row in the shape the runner writes, for seeding claims and orphans. */
function logRow(over: Row = {}): Row {
  return { id: 500, jobId: 1, status: "success", startedAt: null, completedAt: null, notes: "", ...over };
}

/** Local-time Date, because compose sets the API container to TZ=Asia/Kolkata
 *  (docker-compose.yml:246) and a stored cron time means "02:00 in that zone". Constructing in
 *  local time keeps these tests zone-independent on any runner. */
function local(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, mo, d, h, mi, 0, 0);
}

/** Runs the scheduler at one instant and reports how many log rows that instant produced. */
async function tickAt(fireScheduledBackups: (source?: string) => Promise<void>, at: Date): Promise<number> {
  insertedLogs = [];
  updatedJobs = [];
  vi.setSystemTime(at);
  await fireScheduledBackups("cron");
  return insertedLogs.length;
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  jobsRows = [];
  ledgerRows = [];
  statements = [];
  insertedLogs = [];
  updatedLogs = [];
  updatedJobs = [];
  exportCalls = [];
  alertReports = [];
  lockCalls = [];
  events = [];
  lockGrants = [];
  logIdSeq = 900;
  // The runner keeps process-lifetime state, so each test needs a fresh module graph or one test's
  // dedupe silently suppresses the next.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

async function loadRunner() {
  const mod = await import("./cron");
  vi.useFakeTimers();
  return mod.fireScheduledBackups;
}

describe("a daily cron schedule fires once a day, not once an hour", () => {
  test("24 hourly ticks over one day produce exactly one run, at 02:00", async () => {
    // Yesterday's run happened; today's 02:00 has not.
    jobsRows = [jobRow({ lastRunAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();

    const firedHours: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      if (await tickAt(run, local(2026, 9, 22, hour, 0)) > 0) firedHours.push(hour);
    }
    vi.useRealTimers();

    // Before the correction this array was [0,1,2,…,23]: minute 0 of every hour.
    expect(firedHours).toEqual([2]);
    expect(exportCalls).toEqual(["pg_dump"]);
  });

  test("ticks inside the 02:00 minute do not stack a second run", async () => {
    jobsRows = [jobRow({ lastRunAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();

    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    await run("cron");
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(1);
    expect(exportCalls).toHaveLength(1);
    // Three ticks for one occurrence produced one run — and must produce one report to the alert
    // layer as well, or the same defect that dumped the database hourly would also have mailed
    // hourly.
    expect(alertReports).toEqual([{ jobId: 1, outcome: "success" }]);
  });

  test("a 03:30 schedule does not start a minute early, and runs once for its own minute", async () => {
    jobsRows = [jobRow({ schedule: "30 3 * * *", lastRunAt: local(2026, 9, 21, 3, 30) })];
    const run = await loadRunner();

    // 2026-10-22: month index 9 is October, which is what a stored "30 3" is measured against.
    expect(await tickAt(run, local(2026, 9, 22, 3, 29))).toBe(0);
    expect(await tickAt(run, local(2026, 9, 22, 3, 31))).toBe(1);
    const runRow = insertedLogs[0];
    expect(await tickAt(run, local(2026, 9, 22, 3, 32))).toBe(0);
    vi.useRealTimers();

    expect(String(runRow["notes"])).toMatch(/scheduled 2026-10-22 03:30$/);
  });

  test("a cursor exactly on the occurrence is not re-run even with an empty ledger", async () => {
    // Retention can empty backup_job_logs while backup_jobs.last_run_at survives; the cursor is then
    // the only memory the job has. An off-by-one here re-dumps ~810 MB on the tick after the purge.
    jobsRows = [jobRow({ lastRunAt: local(2026, 9, 22, 2, 0) })];
    ledgerRows = [];
    const run = await loadRunner();

    expect(await tickAt(run, local(2026, 9, 22, 2, 5))).toBe(0);
    vi.useRealTimers();
    expect(exportCalls).toHaveLength(0);
  });
});

describe("hourly, weekly and monthly schedules keep their own period", () => {
  test("'0 * * * *' runs once per hour and never on a non-zero minute", async () => {
    jobsRows = [jobRow({ schedule: "0 * * * *", lastRunAt: null })];
    const run = await loadRunner();

    const fired: string[] = [];
    for (let hour = 0; hour < 6; hour++) {
      for (const minute of [0, 15, 30, 45]) {
        const at = local(2026, 9, 22, hour, minute);
        if (await tickAt(run, at) > 0) fired.push(`${hour}:${String(minute).padStart(2, "0")}`);
      }
    }
    vi.useRealTimers();

    expect(fired).toEqual(["0:00", "1:00", "2:00", "3:00", "4:00", "5:00"]);
  });

  test("'0 2 * * 0' runs on Sunday 02:00 only, once", async () => {
    // 2026-10-25 is a Sunday; 26-31 are Monday to Saturday.
    jobsRows = [jobRow({ schedule: "0 2 * * 0", lastRunAt: null })];
    const run = await loadRunner();

    const fired: string[] = [];
    for (const day of [25, 26, 27, 28, 29, 30, 31]) {
      for (const hour of [1, 2, 3]) {
        if (await tickAt(run, local(2026, 9, day, hour, 0)) > 0) fired.push(`${day}T${hour}`);
      }
    }
    vi.useRealTimers();

    expect(fired).toEqual(["25T2"]);
  });

  test("'0 2 1 * *' runs on the 1st at 02:00 and nowhere else", async () => {
    jobsRows = [jobRow({ schedule: "0 2 1 * *", lastRunAt: null })];
    const run = await loadRunner();

    const fired: string[] = [];
    for (const [month, day] of [[9, 31], [10, 1], [10, 2]] as const) {
      for (const hour of [1, 2, 3]) {
        if (await tickAt(run, local(2026, month, day, hour, 0)) > 0) fired.push(`${month}/${day}T${hour}`);
      }
    }
    vi.useRealTimers();

    expect(fired).toEqual(["10/1T2"]);
  });

  test("a schedule scoped to one month stays silent in the next", async () => {
    // Nov 1 and Dec 1 are both "the 1st at 02:00". A month-blind matcher dumps ~810 MB in December
    // as well, and nothing in the UI shows the job is not supposed to run then.
    jobsRows = [jobRow({ schedule: "0 2 1 11 *", lastRunAt: null })];
    const run = await loadRunner();
    expect(await tickAt(run, local(2026, 10, 1, 2, 0))).toBe(1);
    expect(await tickAt(run, local(2026, 11, 1, 2, 0))).toBe(0);
    vi.useRealTimers();
  });

  test("the WEEKLY keyword agrees with the '0 2 * * 0' expression", async () => {
    jobsRows = [jobRow({ schedule: "WEEKLY", lastRunAt: null })];
    const run = await loadRunner();

    const fired: string[] = [];
    for (const day of [25, 26]) {
      for (const hour of [2, 3]) {
        if (await tickAt(run, local(2026, 9, day, hour, 0)) > 0) fired.push(`${day}T${hour}`);
      }
    }
    vi.useRealTimers();

    expect(fired).toEqual(["25T2"]);
  });
});

describe("a stopped scheduler must not cause a catch-up burst", () => {
  test("ten missed days produce one run, not ten", async () => {
    jobsRows = [jobRow({ lastRunAt: local(2026, 9, 12, 2, 0) })];
    const run = await loadRunner();

    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(1);
    expect(exportCalls).toHaveLength(1);
  });

  test("a slot far outside the catch-up window is not filled by an old occurrence", async () => {
    // Ran yesterday 02:00; it is now 20:00, so today's occurrence is 18 h late — past the window.
    jobsRows = [jobRow({ lastRunAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();

    vi.setSystemTime(local(2026, 9, 22, 20, 0));
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(0);
    expect(exportCalls).toHaveLength(0);
  });
});

describe("no two runs of one job overlap, whoever triggered them", () => {
  test("the job lock is taken BEFORE the ledger is written and released after it closes", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    // Without the lock first this is a check-then-insert race: two triggers can both read "not yet
    // run" and both dump the database. The order IS the guarantee.
    expect(events[0]).toMatch(/^lock:grant/);
    expect(events.indexOf("insert")).toBeGreaterThan(0);
    expect(events.slice(-2)).toEqual(["unlock", "release"]);
  });

  test("a denied lock starts nothing at all — no row, no dump, no cursor", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    lockGrants = [false];
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(0);
    expect(exportCalls).toHaveLength(0);
    expect(updatedJobs).toHaveLength(0);
    // A lock that was never granted has nothing to release, and the session still goes back.
    expect(lockCalls.filter((c) => c.unlock)).toHaveLength(0);
    expect(events).toEqual(["lock:grant=false", "release"]);
  });

  test("each job is guarded by its own lock key, so one busy job cannot block another", async () => {
    // Production has two rows named "DB" on the same schedule; they must not serialise on one key.
    jobsRows = [jobRow({ id: 1, jobName: "DB" }), jobRow({ id: 2, jobName: "DB copy" })];
    const run = await loadRunner();
    lockGrants = [true, true];
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    const keys = lockCalls.filter((c) => !c.unlock).map((c) => c.key);
    expect(new Set(keys).size).toBe(2);
    expect(insertedLogs.map((l) => l["jobId"])).toEqual([1, 2]);
  });

  test("the lock is a session advisory lock, released on the same key it took", async () => {
    jobsRows = [jobRow({ id: 7, lastRunAt: null })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    expect(lockCalls[0]["sql"]).toMatch(/pg_try_advisory_lock/);
    expect(lockCalls[0]["key"]).toContain("7");
    const unlock = lockCalls[lockCalls.length - 1];
    expect(unlock["unlock"]).toBe(true);
    expect(unlock["key"]).toBe(lockCalls[0]["key"]);
  });

  test("one job's history neither blocks nor is swept by another job", async () => {
    // Production runs two rows named "DB" on one schedule. Job 2's unfinished run from yesterday
    // must not be read as job 1's claim, and job 1's sweep must not close job 2's row.
    jobsRows = [jobRow({ id: 1 }), jobRow({ id: 2, jobName: "other" })];
    ledgerRows = [logRow({ id: 700, jobId: 2, status: "running", startedAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();
    lockGrants = [true, true];
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs.map((l) => l["jobId"])).toEqual([1, 2]);
    const swept = ledgerRows.find((r) => r["id"] === 700)!;
    expect(swept["status"]).toBe("failed");
    expect(String(swept["errorMessage"])).toMatch(/interrupted/i);
  });
});

describe("execution history says what actually happened", () => {
  test("the log row names its real trigger instead of always claiming the cron scheduler", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("internal-cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(1);
    const notes = String(insertedLogs[0]["notes"]);
    expect(notes).toContain("internal-cron");
    expect(notes).not.toBe("Triggered by cron scheduler");
  });

  test("the log row records the scheduled occurrence it is running", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    // 02:07: a late start for the 02:00 occurrence, still inside the grace window.
    vi.setSystemTime(local(2026, 9, 22, 2, 7));
    await run("cron");
    vi.useRealTimers();

    expect(String(insertedLogs[0]["notes"])).toMatch(/scheduled 2026-10-22 02:00$/);
  });

  test("the job cursor advances to the occurrence, so a late run does not shift the schedule", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 7));
    await run("cron");
    vi.useRealTimers();

    const cursor = updatedJobs[updatedJobs.length - 1]["lastRunAt"] as Date;
    expect(cursor.getHours()).toBe(2);
    expect(cursor.getMinutes()).toBe(0);
    // And the row it wrote really is the one the update targets, not every row in the table.
    const logUpdate = updatedLogs[updatedLogs.length - 1];
    expect(String(logUpdate["__where"])).toMatch(/"backup_job_logs"\."id" = \$1/);
    expect(logUpdate["__matched"]).toBe(1);
  });

  test("a run left open by a killed process is closed, not left 'running' forever", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    // Yesterday's occurrence, still open because the container was killed mid-dump.
    ledgerRows = [logRow({ id: 500, jobId: 1, status: "running", startedAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    const orphan = ledgerRows.find((r) => r["id"] === 500)!;
    expect(orphan["status"]).toBe("failed");
    expect(String(orphan["errorMessage"])).toMatch(/interrupted/i);
    expect(orphan["completedAt"]).toBeInstanceOf(Date);

    const sweep = updatedLogs.find((u) => u["status"] === "failed" && /interrupted/i.test(String(u["errorMessage"])));
    expect(sweep).toBeDefined();
    // Scoped to this job's still-open rows, not a blanket rewrite of the ledger.
    expect(String(sweep!["__where"])).toMatch(/"backup_job_logs"\."job_id"/);
    expect(String(sweep!["__where"])).toMatch(/"backup_job_logs"\."status"/);
    expect(sweep!["__params"]).toContain("running");
    // The sweep must precede this run's own row, or it would close itself.
    expect(events.indexOf("insert")).toBeGreaterThan(events.indexOf(`update:backup_job_logs:failed`));
  });

  test("the sweep does not close a healthy finished run", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    ledgerRows = [logRow({ id: 501, jobId: 1, status: "success", startedAt: local(2026, 9, 21, 2, 0) })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    expect(ledgerRows.find((r) => r["id"] === 501)!["status"]).toBe("success");
  });

  test("a malformed schedule fails closed and says so", async () => {
    jobsRows = [jobRow({ schedule: "0 25 * * *", lastRunAt: null })];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(0);
    expect(exportCalls).toHaveLength(0);
    expect(lockCalls).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/job #1/);
    warn.mockRestore();
  });

  test("an unusable schedule does not lock or claim, so it cannot strand a real run", async () => {
    // The Backups UI's "Custom cron…" selection stores this literal string.
    jobsRows = [jobRow({ schedule: "CUSTOM", lastRunAt: null })];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();
    expect(insertedLogs).toHaveLength(0);
    warn.mockRestore();
  });

  test("the at-most-once claim is read from the ledger, scoped to this job and this occurrence", async () => {
    jobsRows = [jobRow({ lastRunAt: null })];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    const firstRunRows = ledgerRows.length;
    // Same occurrence, cursor lost (the crash lands between the run and the cursor write): the
    // ledger is the claim of record and must still stop a second dump.
    jobsRows = [jobRow({ lastRunAt: null })];
    insertedLogs = [];
    updatedJobs = [];
    vi.setSystemTime(local(2026, 9, 22, 2, 30));
    await run("cron");
    vi.useRealTimers();

    expect(firstRunRows).toBe(1);
    expect(insertedLogs).toHaveLength(0);
    const claim = statements.find((s) => s.relation === "backup_job_logs" && /started_at/.test(s.sql));
    expect(claim).toBeDefined();
    expect(claim!.sql).toMatch(/"backup_job_logs"\."job_id" = \$1/);
    expect(claim!.sql).toMatch(/"backup_job_logs"\."started_at" >= \$2/);
    expect(claim!.params[0]).toBe(1);
    // The driver binds timestamps as the ISO text pg would receive, so compare the instant.
    expect(new Date(claim!.params[1] as string).getTime()).toBe(local(2026, 9, 22, 2, 0).getTime());
  });

  test("MANUAL and blank schedules stay manual", async () => {
    const run = await loadRunner();
    for (const schedule of ["MANUAL", "", "   "]) {
      jobsRows = [jobRow({ schedule, lastRunAt: null })];
      await tickAt(run, local(2026, 9, 22, 2, 0));
    }
    vi.useRealTimers();

    expect(insertedLogs).toHaveLength(0);
    expect(exportCalls).toHaveLength(0);
  });
});

describe("one job's failure does not stop the jobs after it", () => {
  test("a failing job records a failed row and the next job still runs", async () => {
    jobsRows = [
      // DICOM_METADATA is deliberately not implemented by the runner, so this job throws on every
      // attempt — a real failure, not a stubbed one.
      jobRow({ id: 1, jobName: "first", backupType: "DICOM_METADATA" }),
      jobRow({ id: 2, jobName: "second", backupType: "FULL" }),
    ];
    const run = await loadRunner();
    vi.setSystemTime(local(2026, 9, 22, 2, 0));
    await run("cron");
    vi.useRealTimers();

    expect(insertedLogs.map((l) => l["jobId"])).toEqual([1, 2]);
    expect(exportCalls).toEqual(["pg_dump"]);
    expect(updatedLogs.map((u) => u["status"])).toEqual(["failed", "success"]);
    expect(String(updatedLogs[0]["errorMessage"])).toMatch(/not implemented/i);
    // Both outcomes are recorded against their own run, and both jobs advance their own cursor.
    expect(updatedLogs.map((u) => u["__matched"])).toEqual([1, 1]);
    expect(jobsRows.map((j) => (j["lastRunAt"] as Date).getHours())).toEqual([2, 2]);
    // Each job reports its own outcome. The alert layer must not be told the pair succeeded because
    // the second one did, nor that both failed because the first one did.
    expect(alertReports).toEqual([
      { jobId: 1, outcome: "failure" },
      { jobId: 2, outcome: "success" },
    ]);
  });
});
