/**
 * Startup / restore-verify / version diagnostics — regression suite.
 *
 * Pins the discrepancies the Operational Health dashboard surfaces:
 *   - live `db.critical_tables` ≠ restore `core_tables_exist`
 *   - DATA-ONLY artifacts must fail before opaque core_tables_exist
 *   - psql_restore must use ON_ERROR_STOP
 *   - restore checks throwaway DB name, not live DATABASE_URL db
 *   - historical restore FAIL stays FAIL but is marked historicalStale
 *   - build metadata placeholders do not block startup; real SHA when provided
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESTORE_CORE_TABLES,
  RESTORE_ROW_COUNT_MARKERS,
  evaluateRowCountSanity,
  quoteRestoreIdentifier,
  sqlArtifactHasCreateTable,
  evaluateCoreTablesPresent,
  evaluateBackupFile,
  classifyRestoreVerifyDashboardStatus,
} from "./restoreVerification";
import { resolveVersionInfo } from "./operationsContext";
import { CHECK_DEFS } from "./operationsChecks";

const REPO = join(__dirname, "..", "..", "..", "..");

describe("live critical tables vs restore core tables (discrepancy explained)", () => {
  it("uses two different 7-table lists on purpose", () => {
    const opsSrc = readFileSync(join(__dirname, "operationsChecks.ts"), "utf8");
    expect(opsSrc).toMatch(/const CRITICAL_TABLES = \[[\s\S]*?"users"[\s\S]*?"patients"[\s\S]*?"bills"/);
    expect(RESTORE_CORE_TABLES).toContain("report_finding_instances");
    expect(RESTORE_CORE_TABLES).toContain("radiology_redelivery_obligations");
    expect(RESTORE_CORE_TABLES).not.toContain("users");
    expect(RESTORE_CORE_TABLES).not.toContain("bills");
  });

  it("current production schema table names still match RESTORE_CORE_TABLES", () => {
    // Schema sources that create these tables must still exist — catches renames.
    const migrations = [
      "migrations/add_report_finding_instances.sql",
      "migrations/add_patient_report_amendments.sql",
      "migrations/add_radiology_ops_v1.sql",
    ];
    for (const m of migrations) {
      expect(readFileSync(join(REPO, m), "utf8")).toMatch(/CREATE TABLE/i);
    }
    expect(RESTORE_CORE_TABLES).toHaveLength(7);
  });
});

describe("core_tables_exist evaluation", () => {
  it("passes when all restore-core tables are present", () => {
    const step = evaluateCoreTablesPresent(RESTORE_CORE_TABLES);
    expect(step.ok).toBe(true);
    expect(step.name).toBe("core_tables_exist");
  });

  it("fails when a required core table is missing", () => {
    const step = evaluateCoreTablesPresent(
      RESTORE_CORE_TABLES.filter((t) => t !== "report_finding_instances"),
    );
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("report_finding_instances");
  });
});

describe("DATA-ONLY / schema-complete artifact detection", () => {
  it("detects pg_dump-style CREATE TABLE", () => {
    expect(sqlArtifactHasCreateTable("--\nCREATE TABLE patients (id int);\n")).toBe(true);
  });

  it("rejects DATA-ONLY fallback dumps", () => {
    const dataOnly =
      "-- WARNING: DATA ONLY\nTRUNCATE TABLE \"patients\" CASCADE;\nINSERT INTO \"patients\" VALUES (1);\n";
    expect(sqlArtifactHasCreateTable(dataOnly)).toBe(false);
  });

  it("in-app restoreVerification refuses DATA-ONLY before core_tables_exist", () => {
    const src = readFileSync(join(__dirname, "restoreVerification.ts"), "utf8");
    expect(src).toContain("schema_complete_artifact");
    expect(src).toContain("sqlArtifactHasCreateTable");
    expect(src).toMatch(/ON_ERROR_STOP=1/);
  });
});

describe("restore verifier targets throwaway DB, not live", () => {
  it("creates restore_verify_* and connects Pool to that database name", () => {
    const src = readFileSync(join(__dirname, "restoreVerification.ts"), "utf8");
    expect(src).toMatch(/restore_verify_\$\{Date\.now\(\)\}/);
    expect(src).toMatch(/CREATE DATABASE \$\{throwawayDb\}/);
    expect(src).toMatch(/database:\s*throwawayDb/);
    expect(src).toMatch(/DROP DATABASE IF EXISTS \$\{throwawayDb\}/);
    // Must not restore into parts.database (live).
    expect(src).toMatch(/--dbname", throwawayDb/);
  });

  it("psql_restore failure path returns FAIL (ON_ERROR_STOP wiring)", () => {
    const src = readFileSync(join(__dirname, "restoreVerification.ts"), "utf8");
    expect(src).toMatch(/step\("psql_restore", restore\.code === 0/);
    expect(src).toContain('return finish(false)');
  });
});

describe("historical / stale restore result classification", () => {
  it("keeps FAIL for a failed proof and marks historicalStale when old", () => {
    const now = new Date("2026-09-03T00:00:00Z");
    const ranAt = new Date(now.getTime() - 77 * 3600 * 1000);
    const r = classifyRestoreVerifyDashboardStatus({
      status: "fail",
      ranAt,
      now,
      failedSteps: ["core_tables_exist"],
      stepCount: 5,
    });
    expect(r.status).toBe("FAIL");
    expect(r.metadata.historicalStale).toBe(false); // 77h < 7d
    expect(r.message).toContain("core_tables_exist");
  });

  it("marks historicalStale after 7 days without converting FAIL→PASS", () => {
    const now = new Date("2026-09-03T00:00:00Z");
    const ranAt = new Date(now.getTime() - 8 * 24 * 3600 * 1000);
    const r = classifyRestoreVerifyDashboardStatus({
      status: "fail",
      ranAt,
      now,
      failedSteps: ["core_tables_exist"],
    });
    expect(r.status).toBe("FAIL");
    expect(r.metadata.historicalStale).toBe(true);
    expect(r.message).toMatch(/no newer run/i);
  });

  it("backup.restore_verified check uses the pure classifier (no heavy dynamic import)", () => {
    const def = CHECK_DEFS.find((d) => d.id === "backup.restore_verified");
    expect(def).toBeTruthy();
    const src = readFileSync(join(__dirname, "operationsChecks.ts"), "utf8");
    expect(src).toContain('from "./restoreVerifyStatus"');
    expect(src).toContain("classifyRestoreVerifyDashboardStatus");
    expect(src).not.toMatch(/await import\("\.\/restoreVerification"\)/);
  });
});

describe("build metadata exposure", () => {
  it("exposes real GIT_COMMIT when provided", () => {
    const v = resolveVersionInfo({
      GIT_COMMIT: "abc123def",
      GIT_BRANCH: "main",
      BUILD_DATE: "2026-09-03T00:00:00Z",
      ERP_VERSION: "2.0.0",
      BUILD_NUMBER: "42",
      RELEASE_NAME: "Radiology Stability",
      NODE_ENV: "production",
    });
    expect(v.commit).toBe("abc123def");
    expect(v.build).toBe("42");
    expect(v.releaseName).toBe("Radiology Stability");
  });

  it("absence of optional build metadata does not invent a SHA", () => {
    const v = resolveVersionInfo({
      GIT_COMMIT: "unknown",
      BUILD_NUMBER: "0",
      RELEASE_NAME: "dev",
      ERP_VERSION: "0.0.0",
      NODE_ENV: "production",
    });
    // Placeholders fall through to version.json; commit stays unknown if unset there.
    expect(v.commit === "unknown" || /^[0-9a-f]{7,}$/i.test(v.commit)).toBe(true);
    // Must not crash / block — function returns a struct.
    expect(v.version).toBeTruthy();
  });

  it("app.version check is optional (required:false) so missing SHA does not fail startup smoke overall alone", () => {
    const def = CHECK_DEFS.find((d) => d.id === "app.version");
    expect(def?.required).toBe(false);
  });
});

describe("backup file preconditions", () => {
  it("evaluateBackupFile fails on missing/empty", () => {
    expect(evaluateBackupFile({ exists: false, sizeBytes: 0 }).some((s) => !s.ok)).toBe(true);
    expect(evaluateBackupFile({ exists: true, sizeBytes: 0 }).find((s) => s.name === "backup_file_nonempty")?.ok).toBe(false);
  });
});

describe("schema warnings remain visible (pass_with_warnings)", () => {
  it("ops check maps pass_with_warnings to WARNING, not PASS", () => {
    const src = readFileSync(join(__dirname, "operationsChecks.ts"), "utf8");
    expect(src).toMatch(/pass_with_warnings[\s\S]*?status: "WARNING"/);
    expect(src).toContain("non-blocking schema drift, startup is safe");
  });

  it("classifier in db-schema-verify keeps middle state", () => {
    const src = readFileSync(join(REPO, "scripts/db-schema-verify.cjs"), "utf8");
    expect(src).toContain('return hasNonBlockingIssues ? "pass_with_warnings" : "full_pass"');
    expect(src).not.toMatch(/pass_with_warnings.*=.*"full_pass"/);
  });
});

describe("row_count_sanity compares the artifact with its own horizon", () => {
  // The defect this replaces: the verifier counted the LIVE database at the moment
  // of verification, so on a clinic that is writing reports and audit rows every
  // day, each row created after the dump made a complete restore look truncated.
  // The proof therefore failed for a reason that had nothing to do with the backup,
  // which is how a restore check stops being read.
  type Row = { count: number; highWater: number; sourceThrough: number; sourceTotal?: number };

  const harness = (perTable: Record<string, Row>) => {
    const totalsAsked: string[] = [];
    const boundsSeen: Array<[string, number]> = [];
    return {
      totalsAsked,
      boundsSeen,
      readers: {
        async restored(table: string) {
          return { count: perTable[table].count, highWater: perTable[table].highWater };
        },
        async sourceThrough(table: string, _marker: string, highWater: number) {
          boundsSeen.push([table, highWater]);
          return perTable[table].sourceThrough;
        },
        async sourceTotal(table: string) {
          totalsAsked.push(table);
          return perTable[table].sourceTotal ?? 0;
        },
      },
    };
  };

  it("passes a busy box: rows written after the artifact cannot fail the proof", async () => {
    const h = harness({
      audit_logs: { count: 100, highWater: 9_000, sourceThrough: 100, sourceTotal: 137 },
      patient_reports: { count: 12, highWater: 400, sourceThrough: 12, sourceTotal: 20 },
    });
    const step = await evaluateRowCountSanity(["audit_logs", "patient_reports"], h.readers);
    expect(step.ok).toBe(true);
    // The bound used is the restored table's own high-water id, nothing else.
    expect(h.boundsSeen).toEqual([["audit_logs", 9_000], ["patient_reports", 400]]);
    // A non-empty restore never asks for the live total.
    expect(h.totalsAsked).toEqual([]);
  });

  it("still fails a truncated restore and names how many rows are missing", async () => {
    const h = harness({ radiology_worklist: { count: 90, highWater: 500, sourceThrough: 100 } });
    const step = await evaluateRowCountSanity(["radiology_worklist"], h.readers);
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/restored 90 rows but the source holds 100/);
    expect(step.detail).toMatch(/10 row\(s\) the artifact already had are missing/);
  });

  it("keeps the comparison strict: a one-row gap is a failure, not a tolerance", async () => {
    // The temptation after the false-failure bug is to forgive "a few rows", which is
    // precisely how a restore missing rows starts passing. Nothing is forgiven here.
    const h = harness({ audit_logs: { count: 99, highWater: 500, sourceThrough: 100 } });
    const step = await evaluateRowCountSanity(["audit_logs"], h.readers);
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/1 row\(s\) the artifact already had are missing/);
  });

  it("fails a core table that restored empty while the source holds rows", async () => {
    const h = harness({ patient_reports: { count: 0, highWater: 0, sourceThrough: 0, sourceTotal: 4_212 } });
    const step = await evaluateRowCountSanity(["patient_reports"], h.readers);
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/restored empty while the source holds 4,212 row/);
    expect(h.totalsAsked).toEqual(["patient_reports"]);
  });

  it("passes a genuinely empty database without inventing a failure", async () => {
    const h = harness({ patient_reports: { count: 0, highWater: 0, sourceThrough: 0, sourceTotal: 0 } });
    const step = await evaluateRowCountSanity(["patient_reports"], h.readers);
    expect(step.ok).toBe(true);
  });

  it("fails loudly for a core table with no declared high-water column", async () => {
    // The quiet way this check dies: a table is added to RESTORE_CORE_TABLES, has no
    // marker, and the loop skips it. Skipping must cost the verification, not pass it.
    const h = harness({ brand_new_table: { count: 5, highWater: 5, sourceThrough: 5 } });
    const step = await evaluateRowCountSanity(["brand_new_table"], h.readers);
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/no high-water column is declared/);
    expect(step.detail).toMatch(/failing rather than skipping/);
  });

  it("every restore-core table declares a marker, so none is silently unbount", () => {
    for (const table of RESTORE_CORE_TABLES) {
      expect(RESTORE_ROW_COUNT_MARKERS[table], `${table} must declare its high-water column`).toBeTruthy();
    }
  });

  it("carries a bigint high-water mark through to the source bound", async () => {
    const beyondInt32 = Number(2_147_483_648);
    const h = harness({
      report_finding_instances: { count: 3, highWater: beyondInt32, sourceThrough: 3 },
    });
    const step = await evaluateRowCountSanity(["report_finding_instances"], h.readers);
    expect(step.ok).toBe(true);
    expect(h.boundsSeen).toEqual([["report_finding_instances", beyondInt32]]);
  });
});

describe("the restore count queries cannot be shaped by a name", () => {
  it("accepts the real identifiers", () => {
    expect(quoteRestoreIdentifier("audit_logs")).toBe('"audit_logs"');
    expect(quoteRestoreIdentifier("id")).toBe('"id"');
  });

  it("refuses anything that would close the quoted identifier", () => {
    for (const bad of ['a"b', "a b", "a;DROP", 'x" FROM y--', "", "9lives", "Upper"]) {
      expect(() => quoteRestoreIdentifier(bad), bad).toThrow(/refusing to build a count query/);
    }
  });
});
