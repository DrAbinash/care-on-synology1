import { describe, expect, test, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import path from "node:path";
import { insertRow, selectRows, updateRows } from "./testSupport/inMemoryRelation";

// Request-level coverage for the rule that two ENABLED backup jobs may not write the same file
// series into the same folder.
//
// Why at this level: the harm is a deletion. cron.ts purges
// `readdirSync(job.destinationPath).filter(f => f.startsWith("backup_" + job.jobName))` by mtime, so
// when production carried rows #2 and #3 — both "DB", both 0 2 * * *, both /volume1/docker/backups/db,
// created 1.7 s apart — each night's sweep ran over both jobs' files and each night wrote ~930 MB twice.
// A unit test of the predicate cannot show that the SAVE path refuses it, that a save which DISABLES
// the twin is still allowed (that is the repair the owner performs by hand), or that an already
// duplicated row is not locked out of every other edit.
//
// The relation is the repo's own in-memory one, so `WHERE id = :id` is honoured rather than assumed,
// and a save that matches no row changes nothing — which is how the 404 case gets proven.

type Row = Record<string, unknown>;
let jobsRows: Row[] = [];
const audits: Record<string, unknown>[] = [];
let nextId = 100;

process.env.BACKUP_TEMP_DIR = path.resolve(__dirname, "../.tmp-backup-dup-guard");
// @workspace/db throws at import time without this; nothing here opens a connection.
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:5432/unused";

vi.mock("./lib/audit", () => ({
  auditFromRequest: async (_req: unknown, entry: Record<string, unknown>) => { audits.push(entry); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const db = {
    select: () => ({
      from: () => ({
        then: (r: (v: Row[]) => unknown) => Promise.resolve(jobsRows.map((x) => ({ ...x }))).then(r),
      }),
    }),
    insert: () => ({
      values: (v: Row) => ({
        returning: async () => [{ ...insertRow(jobsRows, v, nextId++) }],
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Row) => ({
        where: (clause: unknown) => ({
          returning: async () => {
            const matched = selectRows(table, jobsRows, clause).map((r) => r["id"]);
            updateRows(jobsRows, values, clause);
            return jobsRows.filter((r) => matched.includes(r["id"])).map((r) => ({ ...r }));
          },
        }),
      }),
    }),
  };
  return { ...actual, db };
});

function appWith(role: string | null): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { info() {}, error() {}, warn() {}, debug() {} };
    if (role) (req as unknown as { staffSession: Record<string, unknown> }).staffSession =
      { role, subjectId: "1", subjectName: "route-test-admin" };
    next();
  });
  return app;
}

async function mount(): Promise<express.Express> {
  const { backupReplicationRouter } = await import("./routes/backupReplication");
  const app = appWith("admin");
  app.use("/api/admin/backup-replication", backupReplicationRouter);
  return app;
}

const DB_DIR = "/volume1/docker/backups/db";
const CONFIG_DIR = "/volume1/docker/backups/config";
const jobRow = (over: Record<string, unknown> = {}): Row => ({
  id: 2, jobName: "DB", backupType: "DB", destinationType: "SYNOLOGY_NAS", destinationPath: DB_DIR,
  schedule: "0 2 * * *", retentionDays: 30, isEnabled: true, ...over,
});
const row = (id: number) => jobsRows.find((r) => r["id"] === id);

beforeEach(() => {
  audits.length = 0;
  nextId = 100;
  // Exactly the production shape: the same job twice, plus a distinct one.
  jobsRows = [
    jobRow({ id: 2 }),
    jobRow({ id: 3 }),
    jobRow({ id: 4, jobName: "config", backupType: "CONFIG", destinationPath: CONFIG_DIR }),
  ];
});

describe("POST /jobs — a new job may not overlap an enabled one", () => {
  test("the second DB job is refused, and nothing is written or audited", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "DB", backupType: "DB", destinationType: "SYNOLOGY_NAS", destinationPath: DB_DIR,
    });
    expect(res.status).toBe(409);
    expect(res.body.collidesWithJobId).toBe(2);
    expect(res.body.error).toContain("DB");
    expect(res.body.error).toContain("#2");
    expect(res.body.error).toContain(DB_DIR);
    expect(res.body.error).toContain("Edit job #2");
    expect(jobsRows).toHaveLength(3);
    expect(audits).toHaveLength(0);
  });

  test("a name that extends the existing series is refused, and so is a trailing slash on the folder", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "DBnightly", backupType: "DB", destinationType: "SYNOLOGY_NAS", destinationPath: `${DB_DIR}/`,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("file prefix");
    expect(res.body.error).toContain("backup_DB");
    expect(res.body.error).toContain("backup_DBnightly");
    expect(jobsRows).toHaveLength(3);
  });

  test("the same name in another folder is a different file series and is saved", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "DB", backupType: "DB", destinationType: "SYNOLOGY_NAS", destinationPath: "/volume1/backup/offsite/db",
    });
    expect(res.status).toBe(201);
    expect(jobsRows).toHaveLength(4);
    expect(audits.filter((a) => a["action"] === "backup_job_create")).toHaveLength(1);
  });

  test("an unrelated name sharing a folder is saved — one sweep cannot match the other's files", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "Nightly", backupType: "FULL", destinationType: "SYNOLOGY_NAS", destinationPath: DB_DIR,
    });
    expect(res.status).toBe(201);
    expect(jobsRows).toHaveLength(4);
  });

  test("a twin saved switched-off is allowed, because only an enabled job deletes anything", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "DB", backupType: "DB", destinationType: "SYNOLOGY_NAS", destinationPath: DB_DIR, isEnabled: false,
    });
    expect(res.status).toBe(201);
    expect(jobsRows).toHaveLength(4);
  });

  test("a job with no destination folder is not a sweep, so it is saved", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({
      jobName: "DB", backupType: "DB", destinationType: "LOCAL", destinationPath: null,
    });
    expect(res.status).toBe(201);
  });

  test("the missing-field refusal still comes first", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/jobs").send({ backupType: "DB" });
    expect(res.status).toBe(400);
    expect(jobsRows).toHaveLength(3);
  });
});

describe("PATCH /jobs/:id — the repair must stay possible", () => {
  test("switching the duplicate off is accepted — this is the fix the owner performs by hand", async () => {
    const app = await mount();
    const res = await request(app).patch("/api/admin/backup-replication/jobs/3").send({ isEnabled: false });
    expect(res.status).toBe(200);
    expect(row(3)?.["isEnabled"]).toBe(false);
    expect(audits.filter((a) => a["action"] === "backup_job_update")).toHaveLength(1);
  });

  test("editing retention on an already-duplicated row is not blocked by its own twin", async () => {
    const app = await mount();
    const res = await request(app).patch("/api/admin/backup-replication/jobs/2").send({ retentionDays: 21 });
    expect(res.status).toBe(200);
    expect(row(2)?.["retentionDays"]).toBe(21);
  });

  test("moving the duplicate to a folder of its own is accepted, and that is what de-duplicates it", async () => {
    const app = await mount();
    const res = await request(app).patch("/api/admin/backup-replication/jobs/3").send({ destinationPath: "/volume1/backup/care-erp/db-2" });
    expect(res.status).toBe(200);
    expect(row(3)?.["destinationPath"]).toBe("/volume1/backup/care-erp/db-2");
  });

  test("renaming onto a different enabled job's series is refused and changes nothing", async () => {
    const app = await mount();
    const res = await request(app).patch("/api/admin/backup-replication/jobs/3").send({
      jobName: "configx", destinationPath: CONFIG_DIR,
    });
    expect(res.status).toBe(409);
    expect(res.body.collidesWithJobId).toBe(4);
    expect(row(3)?.["jobName"]).toBe("DB");
    expect(audits).toHaveLength(0);
  });

  test("re-enabling a twin that still overlaps is refused", async () => {
    const app = await mount();
    row(3)![
      "isEnabled"] = false;
    const res = await request(app).patch("/api/admin/backup-replication/jobs/3").send({ isEnabled: true });
    expect(res.status).toBe(409);
    expect(row(3)?.["isEnabled"]).toBe(false);
  });

  test("an unknown job id still answers 404, and no row is touched", async () => {
    const app = await mount();
    const res = await request(app).patch("/api/admin/backup-replication/jobs/999").send({ retentionDays: 7 });
    expect(res.status).toBe(404);
    expect(row(2)?.["retentionDays"]).toBe(30);
  });
});
