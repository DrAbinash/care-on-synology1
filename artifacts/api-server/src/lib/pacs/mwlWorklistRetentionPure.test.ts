import { describe, expect, test } from "vitest";
import {
  MWL_PRUNE_CONFIRM_PHRASE,
  MWL_RESTORE_COLUMNS,
  buildMwlRestoreSql,
  mwlRetentionCutoffYmd,
  resolveMwlPruneMaxPerRun,
  resolveMwlRetentionDays,
} from "./mwlWorklistRetentionPure";

describe("resolveMwlRetentionDays", () => {
  test("default 7, 0 disables, garbage falls back", () => {
    expect(resolveMwlRetentionDays({})).toBe(7);
    expect(resolveMwlRetentionDays({ MWL_WORKLIST_RETENTION_DAYS: "0" })).toBe(0);
    expect(resolveMwlRetentionDays({ MWL_WORKLIST_RETENTION_DAYS: "30" })).toBe(30);
    expect(resolveMwlRetentionDays({ MWL_WORKLIST_RETENTION_DAYS: "-5" })).toBe(7);
    expect(resolveMwlRetentionDays({ MWL_WORKLIST_RETENTION_DAYS: "abc" })).toBe(7);
  });

  test("per-run cap is honoured and guarded the same way", () => {
    expect(resolveMwlPruneMaxPerRun({})).toBe(5000);
    expect(resolveMwlPruneMaxPerRun({ MWL_PRUNE_MAX_PER_RUN: "250" })).toBe(250);
    expect(resolveMwlPruneMaxPerRun({ MWL_PRUNE_MAX_PER_RUN: "0" })).toBe(5000);
  });
});

describe("mwlRetentionCutoffYmd", () => {
  test("walks back across the month boundary", () => {
    expect(mwlRetentionCutoffYmd(new Date(2026, 10, 4), 7)).toBe("20261028");
    expect(mwlRetentionCutoffYmd(new Date(2026, 10, 4), 0)).toBe("20261104");
    expect(mwlRetentionCutoffYmd(new Date(2026, 0, 3), 10)).toBe("20251224");
  });
});

describe("buildMwlRestoreSql", () => {
  const row = {
    accessionNumber: "ACC-20260801-US-001",
    patientName: "O'Brien TESTGIVEN",
    patientId: "P-0000001",
    modality: "US",
    scheduledDate: "20260801",
    status: "SENT_TO_MWL",
    stationAeTitle: "Voluson",
    referringDoctor: null,
    createdAt: new Date("2026-08-01T04:00:00.000Z"),
  };

  test("one statement per row, values escaped by doubling", () => {
    const sql = buildMwlRestoreSql([row, { ...row, accessionNumber: "ACC-2" }], new Date("2026-11-04T12:00:00Z"));
    expect(sql.match(/^INSERT INTO/gm)).toHaveLength(2);
    expect(sql).toContain("'O''Brien TESTGIVEN'");
    expect(sql).toContain("NULL");
    expect(sql).toContain("'2026-08-01T04:00:00.000Z'");
  });

  test("column list and value list stay the same length, even with commas inside values", () => {
    const sql = buildMwlRestoreSql(
      [{ ...row, referringDoctor: "Dr. Sanjay Kumar, MD", patientName: "O'Brien, TESTGIVEN" }],
      new Date("2026-11-04T12:00:00Z"),
    );
    const line = sql.trim().split("\n").pop()!;
    const m = /^INSERT INTO radiology_scheduled_procedures \(([^)]*)\) VALUES \((.*)\);$/.exec(line);
    expect(m).not.toBeNull();
    // Quote-aware split: a comma inside '...' is not a separator.
    const values: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < m![2]!.length; i++) {
      const ch = m![2]![i]!;
      if (ch === "'") {
        if (inQuote && m![2]![i + 1] === "'") { cur += "''"; i++; continue; }
        inQuote = !inQuote;
      }
      if (ch === "," && !inQuote) { values.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) values.push(cur);
    expect(values.map((v) => v.trim())).toHaveLength(MWL_RESTORE_COLUMNS.length);
    expect(m![1]!.split(", ")).toHaveLength(MWL_RESTORE_COLUMNS.length);
  });

  test("no primary key is emitted, so a restore cannot collide on id", () => {
    expect(MWL_RESTORE_COLUMNS).not.toContain("id");
  });

  test("the confirm phrase is a fixed string, not user text", () => {
    expect(MWL_PRUNE_CONFIRM_PHRASE).toBe("PRUNE WORKLIST");
  });
});
