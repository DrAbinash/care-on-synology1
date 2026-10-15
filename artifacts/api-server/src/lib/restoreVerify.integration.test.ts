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
import { runRestoreVerification, dbUrlParts } from "./restoreVerification";

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
