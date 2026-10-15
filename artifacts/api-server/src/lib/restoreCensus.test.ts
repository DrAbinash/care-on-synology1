/**
 * Backup-time census — the evidence that a dump held what the database held.
 *
 * `evaluateRowCountSanity` bounds the source at the restored table's own high-water
 * id, which is the right fix for the false failures a busy clinic produced. It is
 * still a statement about the LIVE database, queried at verification time: it cannot
 * see history deleted after the dump, it is satisfied by a table whose ids were
 * regenerated, and it compares cardinality, not identity. The census written into the
 * artifact's `.meta` by `scripts/synology-nas-backup.sh` brackets the dump with two
 * measurements taken when it happened, so completeness is checked against a fact
 * instead of against whatever the clinic looks like today.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RESTORE_CORE_TABLES,
  RESTORE_ROW_COUNT_MARKERS,
  censusAttested,
  censusSql,
  evaluateBackupCensus,
  parseBackupCensus,
  type BackupCensus,
  type CensusSample,
} from "./restoreVerification";

const REPO = join(__dirname, "..", "..", "..", "..");
const TABLES = RESTORE_CORE_TABLES as readonly string[];

const S = (rows: number, minId: number, maxId: number, idSum: number): CensusSample => ({ rows, minId, maxId, idSum });

/** The exact bytes `synology-nas-backup.sh` writes, so a parser change cannot drift
 *  away from the producer without a test noticing. */
function metaWith(pairs: Array<[string, CensusSample, CensusSample | null]>): string {
  const line = (which: string, t: string, s: CensusSample) =>
    `census_${which}.${t}=${s.rows}|${s.minId}|${s.maxId}|${s.idSum}`;
  const body = pairs.flatMap(([t, before, after]) => [
    line("before", t, before),
    ...(after ? [line("after", t, after)] : []),
  ]);
  return ["artifact=caredeoghar_20261015_030000.sql.gz", "exporter=pg_dump", ...body].join("\n") + "\n";
}

const allCensus = (make: (t: string) => [CensusSample, CensusSample | null]): BackupCensus =>
  parseBackupCensus(metaWith(TABLES.map((t) => [t, ...make(t)] as [string, CensusSample, CensusSample | null])));

const readersFrom = (map: Record<string, CensusSample>) => ({
  restored: async (table: string) => {
    const s = map[table];
    if (!s) throw new Error(`test reader asked for ${table}, which the fixture did not give it`);
    return s;
  },
});

describe("censusSql — one definition of the census", () => {
  it("is one aggregate per table, bracketed by no row-level data", () => {
    const sql = censusSql(["patient_reports"]);
    expect(sql).toBe(
      `SELECT 'patient_reports' AS census_table, count(*)::bigint AS row_count, coalesce(min("id"), 0)::bigint AS id_min, coalesce(max("id"), 0)::bigint AS id_max, coalesce(sum("id"), 0)::numeric AS id_sum FROM "patient_reports"`,
    );
    // No column other than the marker may appear: a census that selected a patient
    // field would turn a sidecar that gets pasted into tickets into PHI.
    expect(sql).not.toMatch(/select .*\b(name|patient|email|mobile)\b/i);
  });

  it("joins with UNION ALL so the job asks once, not once per table", () => {
    expect(censusSql(["a", "b"]).split(" UNION ALL ")).toHaveLength(2);
    expect(censusSql([])).toBe("");
  });

  it("refuses a table name that is not a plain lower-case identifier", () => {
    expect(() => censusSql(["Bills; DROP TABLE"])).toThrow(/refusing to build a count query/);
  });
});

describe("the backup job and the verifier mean the same thing by census", () => {
  const sh = readFileSync(join(REPO, "scripts", "synology-nas-backup.sh"), "utf8");

  it("censuses exactly the tables the restore proof judges", () => {
    const declared = /CENSUS_TABLES_DEFAULT="([^"]+)"/.exec(sh)?.[1] ?? "";
    expect(declared.trim().split(/\s+/).sort()).toEqual([...TABLES].sort());
  });

  it("builds its SELECT from a template that equals censusSql() byte for byte", () => {
    const raw = /CENSUS_ROW_TEMPLATE=\$'(.*)'/.exec(sh)?.[1] ?? "";
    expect(raw).toBeTruthy();
    const template = raw.replace(/\\'/g, "'");
    for (const table of TABLES) {
      expect(template.split("@T@").join(table)).toBe(censusSql([table]));
    }
    // The shell joins with the same separator the TS uses, or the two queries
    // differ in a way neither test would see.
    const joined = TABLES.map((t) => template.split("@T@").join(t)).join(" UNION ALL ");
    expect(joined).toBe(censusSql(TABLES));
  });

  it("uses the id column the verifier's own marker map names", () => {
    // censusSql() defaults to "id" because every core table's marker is `id`; if a
    // marker ever changes, the default has to change with it or the census bounds a
    // column the restore proof is not using.
    expect([...new Set(Object.values(RESTORE_ROW_COUNT_MARKERS))]).toEqual(["id"]);
  });
});

describe("parseBackupCensus", () => {
  it("reads both edges of the bracket", () => {
    const c = parseBackupCensus(metaWith([["patient_reports", S(10, 1, 40, 205), S(12, 1, 42, 247)]]));
    expect(c.present).toBe(true);
    expect(c.tables.patient_reports).toEqual({ before: S(10, 1, 40, 205), after: S(12, 1, 42, 247) });
  });

  it("keeps a half bracket half, rather than inventing the missing edge", () => {
    const c = parseBackupCensus(metaWith([["patient_reports", S(10, 1, 40, 205), null]]));
    expect(c.tables.patient_reports.after).toBeNull();
  });

  it("returns nothing at all for a sidecar without a census, and for no sidecar", () => {
    expect(parseBackupCensus("artifact=x\nexporter=pg_dump\n").present).toBe(false);
    expect(parseBackupCensus(null).present).toBe(false);
    expect(parseBackupCensus("").error).toBeNull();
  });

  it("carries the job's own reason when it could not measure", () => {
    const c = parseBackupCensus("census_error=no pre-dump census could be taken\n");
    expect(c.present).toBe(false);
    expect(c.error).toBe("no pre-dump census could be taken");
  });

  it("drops a malformed line instead of trusting a prefix of it", () => {
    // A value with letters, a missing field, or an extra one is not a census sample.
    // Number("12x") is NaN and NaN comparisons are silently false everywhere, which
    // is how a corrupt sidecar would make every table look unverified-or-verified by
    // accident rather than by decision.
    for (const bad of [
      "census_before.patient_reports=12|3|40|abc",
      "census_before.patient_reports=12|3|40",
      "census_before.patient_reports=12|3|40|99|extra",
      "census_before.Patient_Reports=12|3|40|99",
    ]) {
      expect(parseBackupCensus(`${bad}\n`).present, bad).toBe(false);
    }
  });

  it("survives CRLF, because the sidecar is written on Linux and read anywhere", () => {
    const c = parseBackupCensus(metaWith([["patient_reports", S(1, 1, 1, 1), S(1, 1, 1, 1)]]).replace(/\n/g, "\r\n"));
    expect(c.tables.patient_reports.before.rows).toBe(1);
  });
});

describe("evaluateBackupCensus — the verdict the bracket can support", () => {
  const good = allCensus(() => [S(100, 1, 500, 25000), S(104, 1, 504, 26000)]);
  const restoredAll = (s: CensusSample) =>
    readersFrom(Object.fromEntries(TABLES.map((t) => [t, s])));

  it("verifies when every table sits inside its bracket", async () => {
    const step = await evaluateBackupCensus(TABLES, good, restoredAll(S(102, 1, 502, 25500)));
    expect(step.ok).toBe(true);
    expect(step.evidence).toBe("verified");
    expect(step.detail).toContain(`${TABLES.length}/${TABLES.length} table(s)`);
  });

  it("fails a truncated artifact that the cardinality bound alone would also catch, and names the number", async () => {
    const step = await evaluateBackupCensus(TABLES, good, restoredAll(S(60, 1, 500, 15000)));
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("holds 60 of the 100 rows");
  });

  it("fails an artifact that holds MORE than the database had when the dump finished", async () => {
    // Impossible for a genuine dump of that instant, so it means the file is from
    // somewhere else — a wrong-database artifact, which is exactly what this box
    // produced when a second stack shared the compose file.
    const step = await evaluateBackupCensus(TABLES, good, restoredAll(S(999, 1, 500, 25000)));
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("more than the 104 present when the dump finished");
  });

  it("catches a replaced row the count, the min and the max all miss", async () => {
    // Same number of rows, same endpoints, a different set: id 250 is gone and id
    // 251 arrived. `count(*)` and a high-water bound both say "complete". The sum
    // does not. This is the class of loss the instruction asked to stop relying on.
    const bracketed = allCensus(() => [S(3, 1, 3, 6), S(3, 1, 3, 6)]);
    const step = await evaluateBackupCensus(TABLES, bracketed, restoredAll(S(3, 1, 3, 7)));
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("id sum 7 outside the bracket 6..6");
  });

  it("catches history deleted from the oldest end, which a top-id bound cannot see", async () => {
    const bracketed = allCensus(() => [S(3, 1, 3, 6), S(3, 1, 3, 6)]);
    const step = await evaluateBackupCensus(TABLES, bracketed, restoredAll(S(2, 2, 3, 5)));
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/oldest id 2 where the census recorded 1/);
  });

  it("catches a newest id that fell short of the bracket while every other number stayed inside", async () => {
    // Restored ids {1,3,5} against a census of {1,2,6}: same row count, same oldest
    // id, same id sum — and a copy that lost the row the database had most recently.
    // The cardinality bound sees 3 rows and a plausible sum; only the max-id edge
    // names it. Without this case the `< before.maxId` term is unprovable, and a
    // mutant that deletes it survives.
    const bracketed = allCensus(() => [S(3, 1, 6, 9), S(3, 1, 6, 9)]);
    const step = await evaluateBackupCensus(TABLES, bracketed, restoredAll(S(3, 1, 5, 9)));
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("newest id 5 outside the bracket 6..6");
  });


  it("reports unverified — never verified — when the sidecar carries no census", async () => {
    const step = await evaluateBackupCensus(TABLES, parseBackupCensus("artifact=x\n"), readersFrom({}));
    expect(step.ok).toBe(true);
    expect(step.evidence).toBe("unverified");
    expect(step.detail).toContain("no backup-time census");
    expect(step.detail).toContain("high-water bound alone");
  });

  it("quotes the job's own reason for the missing census", async () => {
    const step = await evaluateBackupCensus(TABLES, parseBackupCensus("census_error=no pre-dump census could be taken\n"), readersFrom({}));
    expect(step.evidence).toBe("unverified");
    expect(step.detail).toContain("the job reported: no pre-dump census could be taken");
  });

  it("will not call the step verified while any judged table is missing from the bracket", async () => {
    const partial = parseBackupCensus(metaWith([["patient_reports", S(1, 1, 1, 1), S(1, 1, 1, 1)]]));
    const step = await evaluateBackupCensus(
      TABLES,
      partial,
      readersFrom({ patient_reports: S(1, 1, 1, 1), ...Object.fromEntries(TABLES.slice(1).map((t) => [t, S(1, 1, 1, 1)])) }),
    );
    expect(step.ok).toBe(true);
    expect(step.evidence).toBe("unverified");
    expect(step.detail).toContain("NOT CENSUSED");
  });

  it("treats a half bracket as exact, because widening it would be guessing", async () => {
    const half = allCensus(() => [S(100, 1, 500, 25000), null]);
    const exact = await evaluateBackupCensus(TABLES, half, restoredAll(S(100, 1, 500, 25000)));
    expect(exact.evidence).toBe("verified");
    const grew = await evaluateBackupCensus(TABLES, half, restoredAll(S(104, 1, 504, 26000)));
    expect(grew.ok).toBe(false);
  });

  it("is empty-table safe: a fresh install has no rows and no id at all", async () => {
    const empty = allCensus(() => [S(0, 0, 0, 0), S(0, 0, 0, 0)]);
    const step = await evaluateBackupCensus(TABLES, empty, restoredAll(S(0, 0, 0, 0)));
    expect(step.ok).toBe(true);
    expect(step.evidence).toBe("verified");
  });

  it("does not claim to have verified nothing", async () => {
    // `matched.length > 0` is what keeps a run with zero judged tables from
    // reporting a clean bill of health it did not perform.
    const step = await evaluateBackupCensus([], good, readersFrom({}));
    expect(step.evidence).toBe("unverified");
  });
});

describe("censusAttested", () => {
  it("is true only when every judged table is present", () => {
    expect(censusAttested(allCensus(() => [S(1, 1, 1, 1), S(1, 1, 1, 1)]), TABLES)).toBe(true);
    expect(censusAttested(parseBackupCensus(metaWith([["patient_reports", S(1, 1, 1, 1), S(1, 1, 1, 1)]])), TABLES)).toBe(false);
    expect(censusAttested(parseBackupCensus(""), TABLES)).toBe(false);
  });

  it("counts a before-only entry as attested, because the job guarantees the pair", () => {
    // The producer writes both or neither; accepting a lone `before` keeps a
    // half-written sidecar from silently downgrading a real measurement to none.
    const halves = parseBackupCensus(metaWith(TABLES.map((t) => [t, S(1, 1, 1, 1), null] as const)));
    expect(censusAttested(halves, TABLES)).toBe(true);
  });
});

describe("the restore document holds itself to what this code can prove", () => {
  const doc = readFileSync(join(REPO, "docs", "CARE_ERP_BACKUP_RESTORE.md"), "utf8")
    .split("\r\n")
    .join("\n");

  it("names the census's table count as a digit that equals the producer's list", () => {
    // Written as a digit rather than the word so this assertion means anything:
    // adding an eighth table to CENSUS_TABLES_DEFAULT must edit the prose or go red.
    const claimed = [...doc.matchAll(/\b(\d+) tables?\b/g)].map((m) => Number(m[1]));
    expect(claimed.length).toBeGreaterThanOrEqual(3);
    for (const n of claimed) {
      expect(n, `the document says "${n} tables"; the job censuses ${TABLES.length}`).toBe(TABLES.length);
    }
    expect(doc).toContain(`far more than ${TABLES.length}`);
  });

  it("keeps all five rungs of the claim ladder, and leaves rung 5 unanswered", () => {
    const rows = [...doc.matchAll(/^\| (\d) \| (.*)$/gm)];
    expect(rows.map((r) => r[1])).toEqual(["1", "2", "3", "4", "5"]);
    const rung = (n: string) => rows.find((r) => r[1] === n)?.[0] ?? "";
    expect(rung("3")).toContain("consistent with the source at dump time");
    expect(rung("3")).toContain("backup_census_match");
    expect(rung("4")).toContain("Schema and referential integrity");
    expect(rung("5")).toContain("Full data integrity");
    // The rung that would be the lie: no check may be named as answering it.
    expect(rung("5")).toContain("nothing in this repository proves it");
  });

  it("refuses the cryptographic claim for the census and reserves it for the hash", () => {
    expect(doc).toContain("not a signature");
    expect(doc).toContain("provenance, not mathematics");
    const lines = doc.split("\n").filter((l) => /cryptographic/i.test(l));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("sha256_artifact");
  });
});
