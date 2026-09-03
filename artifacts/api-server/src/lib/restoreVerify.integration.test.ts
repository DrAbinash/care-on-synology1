/**
 * Optional live restore-verification probe (skipped without DATABASE_URL).
 * Not a substitute for unit tests — proves throwaway restore against this VM's DB.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRestoreVerification } from "./restoreVerification";

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
