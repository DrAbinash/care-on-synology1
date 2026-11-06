import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// Route-level coverage for deleting backup files from the admin screen.
//
// The deciding logic is "which of these files on disk may go, and which must
// survive", so the artifacts here are REAL files in a real directory. A mocked
// filesystem would let a bug that deletes the last restorable dump pass.
//
// The database is mocked only for the job list (which directories are backup
// directories at all) and the audit write is captured rather than executed —
// asserting that the route audits is more than pretending to be Postgres.

const TMP = path.resolve(__dirname, "../.tmp-backup-file-delete");
process.env.BACKUP_TEMP_DIR = TMP;

type Row = Record<string, unknown>;
let jobsRows: Row[] = [];
const audits: Record<string, unknown>[] = [];

// The router imports the real `@workspace/db`, which throws at import time when
// DATABASE_URL is unset — before any mock can take effect. Nothing here ever
// queries it (the select below is replaced wholesale and no connection is
// attempted by constructing a pool), so a syntactically valid dummy is enough
// to let the module load on a machine with no database.
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:5432/unused";

vi.mock("./lib/audit", () => ({
  auditFromRequest: async (_req: unknown, entry: Record<string, unknown>) => { audits.push(entry); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const db = {
    select: () => ({
      from: () => {
        const rows = () => jobsRows;
        return { where: () => rows(), limit: () => rows(), then: (r: (v: Row[]) => unknown) => Promise.resolve(rows()).then(r) };
      },
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

const DAY = (d: string) => `2026-${d}T02-00-00-000Z`;
const dumpName = (d: string) => `backup_DB_${DAY(d)}.sql.enc`;

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true, mode: 0o700 });
  jobsRows = [{ id: 1, jobName: "DB", destinationPath: TMP, retentionDays: 30, isEnabled: true }];
  audits.length = 0;
  for (const d of ["09-01", "09-08", "09-15", "10-28"]) writeFileSync(path.join(TMP, dumpName(d)), `dump ${d}\n`);
  writeFileSync(path.join(TMP, "backup_Nightly_2026-10-27T02-00-00-000Z.sql.enc"), "nightly\n");
  writeFileSync(path.join(TMP, "notes.txt"), "not a backup\n");
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("POST /files/preview-delete", () => {
  test("lists what would go and names what survives, without touching the disk", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/preview-delete")
      .send({ dateFrom: "2026-09-01", dateTo: "2026-10-31" });
    expect(res.status).toBe(200);
    expect(res.body.willDelete.map((x: { fileName: string }) => x.fileName)).toEqual([
      "backup_DB_2026-09-01T02-00-00-000Z.sql.enc",
      "backup_DB_2026-09-08T02-00-00-000Z.sql.enc",
      "backup_DB_2026-09-15T02-00-00-000Z.sql.enc",
    ]);
    expect(res.body.keptAsLastCopy.map((x: { fileName: string }) => x.fileName)).toContain(
      "backup_DB_2026-10-28T02-00-00-000Z.sql.enc");
    expect(res.body.count).toBe(3);
    expect(res.body.totalBytesHuman).toMatch(/B/);
    for (const d of ["09-01", "09-08", "09-15", "10-28"]) expect(existsSync(path.join(TMP, dumpName(d)))).toBe(true);
    expect(audits).toHaveLength(0);
  });

  test("an incomplete range is refused with a sentence, not a stack trace", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/preview-delete").send({ dateFrom: "2026-09-01" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/complete date range/i);
  });

  test("a non-admin cannot even preview", async () => {
    const { backupReplicationRouter } = await import("./routes/backupReplication");
    const app = appWith("receptionist");
    app.use("/api/admin/backup-replication", backupReplicationRouter);
    const res = await request(app).post("/api/admin/backup-replication/files/preview-delete")
      .send({ dateFrom: "2026-09-01", dateTo: "2026-10-31" });
    expect(res.status).toBe(403);
  });
});

describe("POST /files/delete", () => {
  const body = (over: Record<string, unknown> = {}) =>
    ({ dateFrom: "2026-09-01", dateTo: "2026-10-31", ...over });

  test("refuses without the typed phrase and deletes nothing", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/delete").send(body({ confirm: true }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DELETE BACKUPS/);
    expect(existsSync(path.join(TMP, dumpName("09-01")))).toBe(true);
    expect(audits).toHaveLength(0);
  });

  test("deletes exactly the range, keeps the newest of each series, and audits it", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/delete")
      .send(body({ confirm: true, confirmPhrase: "DELETE BACKUPS" }));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(res.body.failed).toEqual([]);
    for (const d of ["09-01", "09-08", "09-15"]) expect(existsSync(path.join(TMP, dumpName(d)))).toBe(false);
    expect(existsSync(path.join(TMP, dumpName("10-28")))).toBe(true);
    expect(existsSync(path.join(TMP, "backup_Nightly_2026-10-27T02-00-00-000Z.sql.enc"))).toBe(true);
    expect(existsSync(path.join(TMP, "notes.txt"))).toBe(true);

    expect(audits).toHaveLength(1);
    const entry = audits[0];
    expect(entry.action).toBe("backup_files_delete");
    expect(entry.module).toBe("backups");
    expect(entry.entityType).toBe("backup_file");
    expect(String(entry.reason)).toMatch(/Deleted 3 backup file/);
    expect(String(entry.reason)).toMatch(/Kept 2 as the newest of their series/);
  });

  test("a range that matches nothing deletes nothing and says so", async () => {
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/delete")
      .send(body({ dateFrom: "2020-01-01", dateTo: "2020-12-31", confirm: true, confirmPhrase: "DELETE BACKUPS" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nothing matches/);
    expect(existsSync(path.join(TMP, dumpName("09-01")))).toBe(true);
  });

  test("only one file in a series can never be deleted, whatever the range", async () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(TMP, dumpName("09-01")), "the only dump\n");
    const app = await mount();
    const res = await request(app).post("/api/admin/backup-replication/files/delete")
      .send(body({ confirm: true, confirmPhrase: "DELETE BACKUPS" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Nothing matches/);
    expect(existsSync(path.join(TMP, dumpName("09-01")))).toBe(true);
  });

  test("a non-admin cannot delete", async () => {
    const { backupReplicationRouter } = await import("./routes/backupReplication");
    const app = appWith("billing");
    app.use("/api/admin/backup-replication", backupReplicationRouter);
    const res = await request(app).post("/api/admin/backup-replication/files/delete")
      .send(body({ confirm: true, confirmPhrase: "DELETE BACKUPS" }));
    expect(res.status).toBe(403);
    expect(existsSync(path.join(TMP, dumpName("09-01")))).toBe(true);
  });
});
