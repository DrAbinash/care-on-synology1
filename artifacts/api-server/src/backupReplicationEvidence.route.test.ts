import { describe, expect, test, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { orderRows, projectRows, relationName, selectRows } from "./testSupport/inMemoryRelation";

// Route-level coverage for the evidence the Backup & Replication page shows.
//
// Why this file exists: the page's "Last Successful" card read `backup_jobs.last_status`, a column
// the scheduler writes about its own process. Production on 2026-10-22 had four jobs whose daily
// 02:00 schedule had been firing hourly (PR #1133) while that card stayed green, and a job type with
// no destination that recorded success having persisted nothing. A source-text assertion cannot see
// either of those; only running the handlers over ledger rows and real files can.
//
// The database is mocked, but not loosely: reads honour the WHERE and ORDER BY they are handed (see
// testSupport/inMemoryRelation), and the artifacts are real files on disk, because "is it there and
// is it the size the ledger claims" is exactly what this code decides.

type Row = Record<string, unknown>;

const TMP = path.resolve(__dirname, "../.tmp-backup-evidence");
const ARTIFACT = path.join(TMP, "backup_DB_2026-10-22T14-30-46-127Z.sql.enc");
const GONE = path.join(TMP, "backup_Nightly_2026-10-21T14-30-33-655Z.sql.enc");

let jobsRows: Row[] = [];
let ledgerRows: Row[] = [];
let checkRows: Row[] = [];

// Partial mock: the route imports the table objects from "@workspace/db" as well as `db`, so the
// real module must stay in place and only `db` be replaced.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const db = {
    select: (columns?: Record<string, unknown>) => {
      const builderFor = (rows: Row[], table: unknown): any => ({
        where: (clause: unknown) => builderFor(selectRows(table, rows, clause), table),
        orderBy: (clause: unknown) => builderFor(orderRows(table, rows, clause), table),
        limit: (n: number) => builderFor(rows.slice(0, n), table),
        then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(columns ? projectRows(rows, columns, table) : rows).then(resolve, reject),
      });
      return {
        from: (table: unknown) => {
          const relation = relationName(table);
          const rows = relation === "backup_jobs" ? jobsRows : relation === "backup_job_logs" ? ledgerRows : checkRows;
          return builderFor(rows, table);
        },
      };
    },
  };
  return { ...actual, db };
});

function appWithSession(role: string | null): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, error() {}, warn() {}, debug() {} };
    if (role) (req as unknown as { staffSession: { role: string; staffId: number } }).staffSession = { role, staffId: 1 };
    next();
  });
  return app;
}

async function mount(): Promise<express.Express> {
  const { backupReplicationRouter } = await import("./routes/backupReplication");
  const app = appWithSession("admin");
  app.use("/api/admin/backup-replication", backupReplicationRouter);
  return app;
}

const jobRow = (over: Partial<Row> = {}): Row => ({
  id: 1,
  jobName: "DB",
  backupType: "DB",
  destinationType: "SYNOLOGY_NAS",
  destinationPath: TMP,
  schedule: "0 20 * * *",
  lastRunAt: new Date(Date.now() - 2 * 3600_000),
  lastStatus: "success",
  lastError: null,
  retentionDays: 14,
  isEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const logRow = (over: Partial<Row> = {}): Row => ({
  id: 100,
  jobId: 1,
  status: "success",
  startedAt: new Date(Date.now() - 2 * 3600_000),
  completedAt: new Date(Date.now() - 2 * 3600_000 + 48_000),
  sizeBytes: null as number | null,
  rowCount: 10,
  filePath: ARTIFACT,
  errorMessage: null,
  // A run that decrypt-verified its own artifact. Without this marker the page may only say the
  // file exists — see the encryption rules in lib/backupJobEvidence.ts and the rotation test below.
  notes: PROVEN_NOTES,
  encrypted: true,
  checksum: "a".repeat(64),
  createdAt: new Date(),
  ...over,
});

const PROVEN_NOTES = "Backup saved to " + ARTIFACT + ". backupProof=v1 plaintext=" + "b".repeat(64) +
  " artifact=" + "a".repeat(64) + " bytes=4096 decryptedBytes=4096 key=BACKUP_PASSPHRASE outcome=verified";

let savedBackupPassphrase: string | undefined;

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(ARTIFACT, Buffer.alloc(4096, 7));
  // CARE resolves its own data dir from CARE_DATA_DIR; pointing it at the same tree makes the
  // "destination is on the same filesystem as the live data" measurement something the test can
  // actually observe rather than assume.
  process.env.CARE_DATA_DIR = TMP;
  // The route reads which passphrases this process can use to decide whether a decrypt-proof is
  // still live. Set it explicitly: a proof of key=BACKUP_PASSPHRASE with nothing configured in the
  // environment is the rotated-key case, and belongs in its own test rather than in every fixture.
  savedBackupPassphrase = process.env.BACKUP_PASSPHRASE;
  process.env.BACKUP_PASSPHRASE = "route-test-passphrase";
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
  delete process.env.CARE_DATA_DIR;
  if (savedBackupPassphrase === undefined) delete process.env.BACKUP_PASSPHRASE;
  else process.env.BACKUP_PASSPHRASE = savedBackupPassphrase;
});

beforeEach(() => {
  jobsRows = [];
  ledgerRows = [];
  checkRows = [];
});

describe("GET /jobs reports the artifact, not the scheduler's own claim", () => {
  test("a success whose file exists is verified; a success whose file is gone is CRITICAL", async () => {
    const size = statSync(ARTIFACT).size;
    jobsRows = [jobRow({ id: 1 }), jobRow({ id: 2, jobName: "Nightly", schedule: "0 2 * * *" })];
    ledgerRows = [
      logRow({ id: 100, jobId: 1, sizeBytes: size }),
      logRow({ id: 101, jobId: 2, filePath: GONE, sizeBytes: 853_024_976, startedAt: new Date(Date.now() - 60_000) }),
    ];

    const res = await request(await mount()).get("/api/admin/backup-replication/jobs");
    expect(res.status).toBe(200);
    const body = res.body as Row[];
    const first = body.find((j) => j.id === 1)!;
    const second = body.find((j) => j.id === 2)!;
    expect((first.evidence as Row).state).toBe("HEALTHY");
    expect((first.evidence as Row).verified).toBe(true);
    expect((second.evidence as Row).state).toBe("CRITICAL");
    expect(((second.evidence as Row).reasons as string[]).join(" ")).toMatch(/is not on disk/);
    // The old page had nothing but lastStatus to show; the ledger echo is still there, labelled.
    expect(second.lastStatus).toBe("success");
  });

  test("the newest ledger row is the one read for each job, by job_id and id", async () => {
    const size = statSync(ARTIFACT).size;
    jobsRows = [jobRow({ id: 7 })];
    ledgerRows = [
      logRow({ id: 1, jobId: 7, status: "failed", filePath: null, sizeBytes: null, startedAt: new Date(Date.now() - 86_400_000) }),
      logRow({ id: 2, jobId: 7, sizeBytes: size, startedAt: new Date(Date.now() - 3600_000) }),
      // Another job's newest row must not be mistaken for this job's.
      logRow({ id: 99, jobId: 8, filePath: GONE, sizeBytes: 1, startedAt: new Date() }),
    ];
    const body = await request(await mount()).get("/api/admin/backup-replication/jobs");
    expect(body.body[0].evidence.state).toBe("HEALTHY");
  });

  test("the route is still admin-only", async () => {
    const { backupReplicationRouter } = await import("./routes/backupReplication");
    const app = appWithSession(null);
    app.use("/api/admin/backup-replication", backupReplicationRouter);
    expect((await request(app).get("/api/admin/backup-replication/jobs")).status).toBe(403);
    expect((await request(app).get("/api/admin/backup-replication/status")).status).toBe(403);
  });
});

describe("GET /status is the four questions the page asks", () => {
  test("last verified names the job with a file, not the job that ran most recently", async () => {
    const size = statSync(ARTIFACT).size;
    jobsRows = [jobRow({ id: 1, jobName: "DB" }), jobRow({ id: 2, jobName: "Nightly", schedule: "0 2 * * *" })];
    ledgerRows = [
      // Nightly verified three days ago; DB ran an hour ago and wrote nothing that can be found.
      logRow({ id: 100, jobId: 1, startedAt: new Date(Date.now() - 3 * 86_400_000), completedAt: new Date(Date.now() - 3 * 86_400_000), sizeBytes: size }),
      logRow({ id: 101, jobId: 2, status: "failed", errorMessage: "pg_dump exited 1", filePath: null, sizeBytes: null, startedAt: new Date(), completedAt: new Date() }),
    ];

    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(res.status).toBe(200);
    const overview = res.body.overview as Row;
    expect(overview.lastVerifiedJob).toBe("DB");
    expect(overview.lastVerifiedSizeBytes).toBe(size);
    expect(overview.needsAttention as Row[]).toHaveLength(1);
    expect((overview.needsAttention as Row[])[0].jobName).toBe("Nightly");
    expect(res.body.serverTimezone).toBeTruthy();
  });

  test("a daily 20:00 schedule answers with minute 20:00, never with the next hour", async () => {
    jobsRows = [jobRow({ id: 1, schedule: "0 20 * * *" })];
    ledgerRows = [logRow({ id: 1, jobId: 1, sizeBytes: statSync(ARTIFACT).size })];
    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    const next = new Date(res.body.overview.nextScheduledAt as string);
    // The rig runs with TZ=Asia/Kolkata, the same zone compose pins the container to.
    expect([next.getHours(), next.getMinutes()]).toEqual([20, 0]);
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  test("nothing verified at all reports null rather than a date borrowed from a green row", async () => {
    jobsRows = [jobRow({ id: 3 })];
    ledgerRows = [logRow({ id: 300, jobId: 3, filePath: GONE, sizeBytes: 999_999 })];
    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(res.body.overview.lastVerifiedAt).toBeNull();
    expect(res.body.counts ?? (res.body.overview as Row).counts).toBeTruthy();
    expect(((res.body.overview as Row).counts as Row).CRITICAL).toBe(1);
  });

  test("restore verification is UNKNOWN until a proof has actually run, then it is the stored proof", async () => {
    jobsRows = [jobRow({ id: 1 })];
    ledgerRows = [logRow({ id: 1, jobId: 1, sizeBytes: statSync(ARTIFACT).size })];

    const none = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(none.body.restoreVerification.status).toBe("UNKNOWN");
    expect(none.body.restoreVerification.message).toMatch(/has ever run/);

    checkRows = [{
      id: 5,
      checkName: "restore_verification",
      status: "fail",
      ranAt: new Date(),
      detail: { steps: [{ name: "decrypt", ok: true }, { name: "restore into isolated database", ok: false }] },
    }];
    const failed = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(failed.body.restoreVerification.status).toBe("FAIL");
    expect(failed.body.restoreVerification.failedSteps).toEqual(["restore into isolated database"]);
    expect(failed.body.restoreVerification.stepCount).toBe(2);

    checkRows = [{ id: 6, checkName: "restore_verification", status: "pass", ranAt: new Date(), detail: { steps: [{ name: "all", ok: true }] } }];
    const passed = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(passed.body.restoreVerification.status).toBe("PASS");
  });

  test("a destination on the same device as the live data is called out, not counted as a copy", async () => {
    jobsRows = [jobRow({ id: 1, destinationPath: TMP })];
    ledgerRows = [logRow({ id: 1, jobId: 1, sizeBytes: statSync(ARTIFACT).size })];
    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(res.body.offNas.sameVolumeAsAppData).toBe(true);
    expect(res.body.offNas.state).toBe("WARNING");
    expect(res.body.offNas.message).toMatch(/same filesystem/);
  });

  test("with no jobs the page says Unknown, not Healthy", async () => {
    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    expect(res.status).toBe(200);
    expect(res.body.overview.lastVerifiedAt).toBeNull();
    expect(res.body.overview.nextScheduledAt).toBeNull();
    expect(res.body.offNas.state).toBe("UNKNOWN");
  });
});

describe("the page shows what was PROVEN about encryption, not what was claimed", () => {
  // P10 requirement 5, at the route. The evidence module can answer five encryption states; this is
  // the only place they reach the operator, so what matters here is the wiring: the route must hand
  // the evaluator the passphrases this process actually has (candidatePassphrases), because without
  // them a proof made with a retired key would still read as recoverable.

  const UNPROVEN_NOTES = "Backup saved to " + ARTIFACT + ". (openssl-aes-256-cbc, key=BACKUP_PASSPHRASE)";
  const RETIRED_KEY_PROOF = "Backup saved to " + ARTIFACT + ". backupProof=v1 plaintext=" + "b".repeat(64) +
    " artifact=" + "a".repeat(64) + " bytes=4096 decryptedBytes=4096 key=SESSION_SECRET outcome=verified";

  let savedSessionSecret: string | undefined;

  beforeEach(() => {
    savedSessionSecret = process.env.SESSION_SECRET;
    // The rotation case needs a process that has BACKUP_PASSPHRASE and NOT SESSION_SECRET. Whatever
    // the shell this suite runs under happens to export is not the fixture's business.
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    if (savedSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSessionSecret;
  });

  test("/jobs labels a proven artifact and an unproven one differently, and the unproven one warns", async () => {
    const size = statSync(ARTIFACT).size;
    jobsRows = [jobRow({ id: 1, jobName: "Proven" }), jobRow({ id: 2, jobName: "Older row", schedule: "0 20 * * *" })];
    ledgerRows = [
      logRow({ id: 100, jobId: 1, sizeBytes: size, notes: PROVEN_NOTES }),
      logRow({ id: 101, jobId: 2, sizeBytes: size, notes: UNPROVEN_NOTES }),
    ];

    const res = await request(await mount()).get("/api/admin/backup-replication/jobs");
    expect(res.status).toBe(200);
    const body = res.body as Row[];
    const proven = body.find((j) => j.id === 1)!;
    const unproven = body.find((j) => j.id === 2)!;

    expect((proven.evidence as Row).state).toBe("HEALTHY");
    expect(((proven.evidence as Row).encryption as Row).state).toBe("proven");
    expect(((proven.evidence as Row).encryption as Row).decryptProven).toBe(true);
    expect(((proven.evidence as Row).encryption as Row).keySource).toBe("BACKUP_PASSPHRASE");

    // The file IS there at the size the ledger claims — `verified` stays true. What changed is that
    // the page can no longer dress that up as "restorable".
    expect((unproven.evidence as Row).verified).toBe(true);
    expect((unproven.evidence as Row).state).toBe("WARNING");
    expect(((unproven.evidence as Row).encryption as Row).state).toBe("unproven");
    expect(((unproven.evidence as Row).reasons as string[]).join(" ")).toMatch(/nothing ever decrypted this artifact/);
  });

  test("a proof made with a key this process no longer has is CRITICAL on the job list", async () => {
    const size = statSync(ARTIFACT).size;
    jobsRows = [jobRow({ id: 1, jobName: "After rotation" })];
    ledgerRows = [logRow({ id: 100, jobId: 1, sizeBytes: size, notes: RETIRED_KEY_PROOF })];

    const res = await request(await mount()).get("/api/admin/backup-replication/jobs");
    const evidence = (res.body as Row[])[0]!.evidence as Row;
    expect(evidence.state).toBe("CRITICAL");
    expect((evidence.encryption as Row).state).toBe("proven_with_retired_key");
    // The proof itself is real and says so; it is the KEY that is gone.
    expect((evidence.encryption as Row).decryptProven).toBe(true);
    expect((evidence.reasons as string[]).join(" ")).toMatch(/SESSION_SECRET/);
    expect((evidence.reasons as string[]).join(" ")).toMatch(/do not count it as recoverable/);
  });

  test("the overview counts each job by what was proven and keeps a retired-key file out of last verified", async () => {
    const size = statSync(ARTIFACT).size;
    // Both jobs have run inside the last hour, so neither is overdue and the ONLY thing separating
    // them is which passphrase proved their artifact. `lastVerified` reads job.lastRunAt, so the
    // retired-key job is genuinely the newest backup on the volume.
    jobsRows = [
      jobRow({ id: 1, jobName: "Nightly DB", lastRunAt: new Date(Date.now() - 3600_000) }),
      jobRow({ id: 2, jobName: "Nightly DB (rotated)", lastRunAt: new Date(Date.now() - 60_000) }),
    ];
    ledgerRows = [
      logRow({ id: 100, jobId: 1, sizeBytes: size, notes: PROVEN_NOTES }),
      logRow({ id: 101, jobId: 2, sizeBytes: size, notes: RETIRED_KEY_PROOF }),
    ];

    const res = await request(await mount()).get("/api/admin/backup-replication/status");
    const overview = res.body.overview as Row;
    expect(overview.encryption).toEqual({ jobs: 2, proven: 1, unproven: 0, retiredKey: 1, notEncrypted: 0, unknown: 0 });
    // The newest file on the volume is the one nobody here can open any more.
    expect(overview.lastVerifiedJob).toBe("Nightly DB");
    expect((overview.counts as Record<string, number>).CRITICAL).toBe(1);
  });

  test("with no passphrase configured, a proven row cannot read as recoverable", async () => {
    const savedPassphrase = process.env.BACKUP_PASSPHRASE;
    delete process.env.BACKUP_PASSPHRASE;
    try {
      const size = statSync(ARTIFACT).size;
      jobsRows = [jobRow({ id: 1, jobName: "Unopenable" })];
      ledgerRows = [logRow({ id: 100, jobId: 1, sizeBytes: size, notes: PROVEN_NOTES })];

      const res = await request(await mount()).get("/api/admin/backup-replication/jobs");
      const evidence = (res.body as Row[])[0]!.evidence as Row;
      expect((evidence.encryption as Row).state).toBe("proven_with_retired_key");
      expect(evidence.state).toBe("CRITICAL");
    } finally {
      process.env.BACKUP_PASSPHRASE = savedPassphrase;
    }
  });
});
