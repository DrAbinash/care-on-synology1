/**
 * Optional live restore-verification probe (skipped without DATABASE_URL).
 * Not a substitute for unit tests — proves throwaway restore against this VM's DB.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Pool } from "pg";
import { runRestoreVerification, dbUrlParts, censusSql, RESTORE_CORE_TABLES, type CensusSample } from "./restoreVerification";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("live restore verification (diagnose)", () => {
  it("rejects DATA-ONLY artifact with schema_complete_artifact FAIL", async () => {
    const p = join(tmpdir(), `dataonly_${Date.now()}.sql`);
    writeFileSync(
      p,
      "-- WARNING: DATA ONLY\nTRUNCATE TABLE \"patients\" CASCADE;\nINSERT INTO \"patients\" VALUES (1);\n",
    );
    const r = await runRestoreVerification({ backupPath: p, ranBy: "diagnose-data-only" });
    unlinkSync(p);
    expect(r.ok).toBe(false);
    const step = r.steps.find((s) => s.name === "schema_complete_artifact");
    expect(step?.ok).toBe(false);
    expect(r.steps.findIndex((s) => s.name === "core_tables_exist")).toBe(-1);
  }, 60_000);

  it("fresh pg_dump restore passes core_tables_exist on throwaway DB", async () => {
    const r = await runRestoreVerification({ ranBy: "diagnose-fresh-dump" });
    // eslint-disable-next-line no-console
    console.log(
      "RESTORE_RESULT",
      JSON.stringify(
        { ok: r.ok, durationMs: r.durationMs, steps: r.steps },
        null,
        2,
      ),
    );
    expect(r.steps.find((s) => s.name === "schema_complete_artifact")?.ok).toBe(true);
    expect(r.steps.find((s) => s.name === "psql_restore")?.ok).toBe(true);
    const core = r.steps.find((s) => s.name === "core_tables_exist");
    expect(core?.ok).toBe(true);
    expect(core?.detail).toMatch(/7 tables present/);
  }, 300_000);
});

/**
 * The two cases that judge `row_count_sanity` itself, against a real PostgreSQL on
 * both sides (a real pg_dump, a real psql restore into a throwaway database).
 *
 * They exist because the check used to compare the restored counts with the LIVE
 * counts taken at verification time, which fails a perfect restore on any box that
 * keeps writing. Only a real database can show both halves: that later rows no
 * longer cause a failure, and that a row genuinely missing from the artifact still
 * does. A unit test with faked readers cannot tell `id <= highWater` from `id <
 * highWater`; these can.
 */
const dumpTools = (() => {
  const probe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  const psql = spawnSync("psql", ["--version"], { encoding: "utf8" });
  return probe.error === undefined && psql.error === undefined;
})();

const MARKER = "restore-count-probe";

async function probePool() {
  const parts = dbUrlParts();
  return new Pool({
    host: parts.host,
    port: Number(parts.port),
    user: parts.user,
    password: parts.password,
    database: parts.database,
    max: 1,
  });
}

async function seedRows(pool: Pool, count: number, withIds?: number[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = withIds
      ? await pool.query("INSERT INTO audit_logs (id, action, module) VALUES ($1, $2, $3) RETURNING id", [withIds[i], `${MARKER}-reinsert`, MARKER])
      : await pool.query("INSERT INTO audit_logs (action, module) VALUES ($1, $2) RETURNING id", [`${MARKER}-${i}`, MARKER]);
    ids.push(Number(r.rows[0].id));
  }
  return ids;
}

async function auditState(pool: Pool) {
  const c = await pool.query("SELECT count(*)::int AS rows, COALESCE(max(id), 0)::int AS max_id FROM audit_logs");
  return { rows: Number(c.rows[0].rows), maxId: Number(c.rows[0].max_id) };
}

function takeDump(file: string) {
  const parts = dbUrlParts();
  // Credentials come from dbUrlParts(), the same parse the verifier under test uses.
  // The first version of this helper re-derived them from DATABASE_URL by hand and
  // omitted PGPASSWORD, so `pg_dump` blocked on a terminal prompt and every CI run
  // died with `pg_dump failed: Password:` — invisible locally, where the test
  // database accepts trust authentication.
  // --no-password turns that class of mis-wiring into an immediate, named failure
  // instead of a prompt that eats the test timeout.
  const r = spawnSync("pg_dump", [
    "--host", parts.host, "--port", parts.port, "--username", parts.user,
    "--dbname", parts.database, "--no-owner", "--no-privileges",
    "--clean", "--if-exists", "--no-password", "--file", file,
  ], { encoding: "utf8", env: { ...process.env, PGPASSWORD: parts.password } });
  if (r.status !== 0 || !existsSync(file)) throw new Error(`pg_dump failed: ${r.stderr}`);
  return file;
}

describe.skipIf(!hasDb || !dumpTools)("row_count_sanity against a real PostgreSQL", () => {
  it("passes an artifact that is complete for its own moment while the live table keeps growing", async () => {
    const pool = await probePool();
    const dumpFile = join(tmpdir(), `rowcount_busy_${Date.now()}.sql`);
    try {
      await seedRows(pool, 3);
      const atDump = await auditState(pool);
      takeDump(dumpFile);
      // The clinic does not stop writing while a backup ages. These rows are the
      // reason the old live-total comparison failed a perfect restore.
      await seedRows(pool, 2);
      const later = await auditState(pool);
      expect(later.rows).toBeGreaterThan(atDump.rows);

      const r = await runRestoreVerification({ backupPath: dumpFile, ranBy: MARKER });
      const step = r.steps.find((s) => s.name === "row_count_sanity");
      expect(step, "row_count_sanity must run").toBeTruthy();
      expect(step!.ok, `row_count_sanity: ${step!.detail}`).toBe(true);
      expect(step!.detail).toContain(`audit_logs ${atDump.rows}/${atDump.maxId}`);
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE module = $1", [MARKER]);
      await pool.query("SELECT setval('audit_logs_id_seq', (SELECT COALESCE(max(id), 1) FROM audit_logs))");
      rmSync(dumpFile, { force: true });
      await pool.end();
    }
  }, 300_000);

  it("fails when the artifact is missing a row the source still holds inside its own horizon", async () => {
    const pool = await probePool();
    const dumpFile = join(tmpdir(), `rowcount_gap_${Date.now()}.sql`);
    let gapId = 0;
    try {
      const ids = await seedRows(pool, 4);
      // A row that exists in the live table but not in the artifact, and whose id is
      // BELOW the artifact's own highest id. Comparing against the live total could
      // never tell this apart from ordinary later writes; the bound can, and must.
      gapId = ids[1];
      await pool.query("DELETE FROM audit_logs WHERE id = $1", [gapId]);
      takeDump(dumpFile);
      await pool.query("INSERT INTO audit_logs (id, action, module) VALUES ($1, $2, $3)", [gapId, `${MARKER}-restored-row`, MARKER]);
      await pool.query("SELECT setval('audit_logs_id_seq', (SELECT COALESCE(max(id), 1) FROM audit_logs))");

      const r = await runRestoreVerification({ backupPath: dumpFile, ranBy: MARKER });
      const step = r.steps.find((s) => s.name === "row_count_sanity");
      expect(step, "row_count_sanity must run").toBeTruthy();
      expect(step!.ok, `a truncated artifact must not pass: ${step!.detail}`).toBe(false);
      expect(step!.detail).toMatch(/audit_logs: restored \d+ rows but the source holds \d+ with id <= \d+/);
      expect(step!.detail).toMatch(/1 row\(s\) the artifact already had are missing/);
      expect(r.ok).toBe(false);
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE module = $1 OR id = $2", [MARKER, gapId]);
      await pool.query("SELECT setval('audit_logs_id_seq', (SELECT COALESCE(max(id), 1) FROM audit_logs))");
      rmSync(dumpFile, { force: true });
      await pool.end();
    }
  }, 300_000);
});

/**
 * The same two artifacts, judged against what the database said it held when the
 * dump was taken rather than against what it happens to hold now. `censusSql()` is
 * executed here rather than mocked, so the query the backup job actually runs is
 * the query these numbers came from.
 */
describe.skipIf(!hasDb || !dumpTools)("backup_census_match against a real PostgreSQL", () => {
  async function censusNow(pool: Pool) {
    const r = await pool.query(censusSql(RESTORE_CORE_TABLES as unknown as string[]));
    return r.rows.map((row: any) => ({
      table: String(row.census_table),
      sample: {
        rows: Number(row.row_count),
        minId: Number(row.id_min),
        maxId: Number(row.id_max),
        idSum: Number(row.id_sum),
      },
    }));
  }

  function writeSidecar(dumpFile: string, samples: Array<{ table: string; sample: CensusSample }>, alter?: (t: string, s: CensusSample) => CensusSample) {
    const lines = samples.flatMap(({ table, sample }) => {
      const s = alter ? alter(table, sample) : sample;
      return [`census_before.${table}=${s.rows}|${s.minId}|${s.maxId}|${s.idSum}`, `census_after.${table}=${s.rows}|${s.minId}|${s.maxId}|${s.idSum}`];
    });
    writeFileSync(`${dumpFile}.meta`, ["artifact=test.sql", "exporter=pg_dump", ...lines].join("\n") + "\n");
  }

  it("verifies completeness against the numbers taken at dump time", async () => {
    const pool = await probePool();
    const dumpFile = join(tmpdir(), `census_ok_${Date.now()}.sql`);
    try {
      await seedRows(pool, 3);
      const samples = await censusNow(pool);
      takeDump(dumpFile);
      writeSidecar(dumpFile, samples);

      const r = await runRestoreVerification({ backupPath: dumpFile, ranBy: MARKER });
      const step = r.steps.find((s) => s.name === "backup_census_match");
      expect(step, "backup_census_match must run").toBeTruthy();
      expect(step!.ok, step!.detail).toBe(true);
      expect(step!.evidence).toBe("verified");
      expect(r.censusAttested).toBe(true);
      expect(r.unverified).not.toContain("backup_census_match");
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE module = $1", [MARKER]);
      rmSync(dumpFile, { force: true });
      rmSync(`${dumpFile}.meta`, { force: true });
      await pool.end();
    }
  }, 300_000);

  it("catches a different row set that has the same count, the same min and the same max", async () => {
    // This is the case the high-water bound cannot see and the reason the census
    // exists: `row_count_sanity` compares a count against a count-below-a-bound, so
    // an artifact holding the right NUMBER of rows with the wrong ids satisfies it.
    // The bracket on the id sum does not, and says so in the numbers.
    const pool = await probePool();
    const dumpFile = join(tmpdir(), `census_swap_${Date.now()}.sql`);
    try {
      await seedRows(pool, 3);
      const samples = await censusNow(pool);
      takeDump(dumpFile);
      writeSidecar(dumpFile, samples, (table, s) =>
        table === "audit_logs" ? { ...s, idSum: s.idSum + 7 } : s,
      );

      const r = await runRestoreVerification({ backupPath: dumpFile, ranBy: MARKER });
      const bound = r.steps.find((s) => s.name === "row_count_sanity");
      const census = r.steps.find((s) => s.name === "backup_census_match");
      expect(bound!.ok, `the cardinality bound alone must still be satisfied: ${bound!.detail}`).toBe(true);
      expect(census!.ok, "a doctored row set must not pass").toBe(false);
      expect(census!.detail).toMatch(/audit_logs: .*id sum \d+ outside the bracket/);
      expect(r.ok).toBe(false);
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE module = $1", [MARKER]);
      rmSync(dumpFile, { force: true });
      rmSync(`${dumpFile}.meta`, { force: true });
      await pool.end();
    }
  }, 300_000);

  it("reports unverified, and is never refused for lacking a census, for an artifact written before the census existed", async () => {
    // Every backup the clinic holds today. Failing them would be a lie about the
    // restore, and passing them as evidence would be a lie about completeness, so
    // the answer is a third state the gate can show.
    const pool = await probePool();
    const dumpFile = join(tmpdir(), `census_absent_${Date.now()}.sql`);
    try {
      await seedRows(pool, 2);
      takeDump(dumpFile);
      const r = await runRestoreVerification({ backupPath: dumpFile, ranBy: MARKER });
      const step = r.steps.find((s) => s.name === "backup_census_match");
      expect(step, "backup_census_match must run").toBeTruthy();
      expect(step!.ok).toBe(true);
      expect(step!.evidence).toBe("unverified");
      expect(step!.detail).toContain("no backup-time census");
      // The claim under test is that a pre-census artifact is not REFUSED — so every
      // step but one must be green, and the one that may go red is named rather than
      // swallowed. This suite inserts its probe rows without hash columns, which
      // forks the audit chain of any database whose audit rows carry one (CI's
      // Postgres does; a scratch DB built by apply-all-migrations has no chain at
      // all). That is a property of the fixture, not of the artifact — and if the
      // tolerance is ever widened, the assertion below is the line that shows it.
      const failing = r.steps.filter((s) => !s.ok);
      expect(failing.filter((s) => s.name !== "audit_chain_verifies").map((s) => `${s.name}: ${s.detail}`)).toEqual([]);
      expect(failing.map((s) => s.name)).not.toContain("backup_census_match");
      for (const s of failing) {
        expect(s.name, "only the audit chain may fail here").toBe("audit_chain_verifies");
        expect(s.detail).toMatch(/chain fork or gap/);
      }
      expect(r.ok || failing.every((s) => s.name === "audit_chain_verifies")).toBe(true);
      expect(r.censusAttested).toBe(false);
      expect(r.unverified).toContain("backup_census_match");
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE module = $1", [MARKER]);
      rmSync(dumpFile, { force: true });
      await pool.end();
    }
  }, 300_000);
});
