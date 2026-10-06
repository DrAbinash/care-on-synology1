// spineCanal.test.ts — the guarantees the four competing canal vocabularies
// used to make impossible.
//
// These are the user-facing invariants they were asked to prove, at the layer
// where they can be proven without a DOM: one level is one record, an alias can
// never become a second record, a conflict is never resolved by software, and a
// radiologist's number survives both a viewer refresh and a re-open.

import { describe, it, expect } from "vitest";
import {
  CERVICAL_CANAL_LEVELS,
  DORSAL_CANAL_LEVELS,
  DORSAL_JUNCTION_LEVEL,
  LUMBAR_CANAL_LEVELS,
  applyCanalManualValue,
  applyCanalViewerValue,
  canalApValue,
  canalLevelsForSegment,
  canalSegmentForLevel,
  canonicalizeCanalLevel,
  canonicalizeCanalMap,
  displayCanalLevel,
  flagRenumberedCanalLevels,
  isCanalLevelInSegment,
  parseCanalApMeasurement,
} from "./index";

describe("routine canal level sets", () => {
  it("cervical is C2-C3 through C7-T1, and C1-C2 cannot be a routine row", () => {
    expect(CERVICAL_CANAL_LEVELS).toEqual([
      "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
    expect(CERVICAL_CANAL_LEVELS).not.toContain("C1-C2");
    expect(isCanalLevelInSegment("cervical", "C1-C2")).toBe(false);
    expect(isCanalLevelInSegment("cervical", "C7-T1")).toBe(true);
  });

  it("lumbar is the five disc levels", () => {
    expect(LUMBAR_CANAL_LEVELS).toEqual([
      "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1",
    ]);
  });

  it("dorsal routine stops at D11-D12; the junction needs thoracolumbar coverage", () => {
    expect(DORSAL_CANAL_LEVELS).toHaveLength(11);
    expect(DORSAL_CANAL_LEVELS[DORSAL_CANAL_LEVELS.length - 1]).toBe("D11-D12");
    expect(canalLevelsForSegment("dorsal")).not.toContain(DORSAL_JUNCTION_LEVEL);
    expect(canalLevelsForSegment("dorsal", { thoracolumbar: true }))
      .toContain(DORSAL_JUNCTION_LEVEL);
    expect(isCanalLevelInSegment("dorsal", "D12-L1")).toBe(false);
    expect(isCanalLevelInSegment("dorsal", "D12-L1", { thoracolumbar: true })).toBe(true);
  });
});

describe("canonicalizeCanalLevel — aliases in, canonical keys out", () => {
  it.each([
    ["T8-T9", "D8-D9"],
    ["D8/9", "D8-D9"],
    ["d8-d9", "D8-D9"],
    ["T8–T9", "D8-D9"],
    ["L4-5", "L4-L5"],
    ["L4/5", "L4-L5"],
    ["L5_S1", "L5-S1"],
    ["T12-L1", "D12-L1"],
    ["L5-T", "L5-T"],
    ["C2-C3", "C2-C3"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(canonicalizeCanalLevel(input)).toBe(expected);
  });

  it("resolves the cervicothoracic junction before the thoracic rewrite can mangle it", () => {
    // A blanket T→D substitution turns C7-T1 into C7-D1, which is in no level
    // list at all — the level would silently vanish from every table.
    expect(canonicalizeCanalLevel("C7-T1")).toBe("C7-T1");
    expect(canonicalizeCanalLevel("C7-D1")).toBe("C7-T1");
    expect(canonicalizeCanalLevel("C7-T")).toBe("C7-T1");
    expect(canalSegmentForLevel("C7-T1")).toBe("cervical");
  });

  it("rejects nonsense and a level that descends below where it started", () => {
    expect(canonicalizeCanalLevel("")).toBeNull();
    expect(canonicalizeCanalLevel(null)).toBeNull();
    expect(canonicalizeCanalLevel("sagittal T2")).toBeNull();
    expect(canonicalizeCanalLevel("L5-C3")).toBeNull();
  });

  it("T8-T9 and D8-D9 are the same level, and D is what a CARE table shows", () => {
    expect(canonicalizeCanalLevel("T8-T9")).toBe(canonicalizeCanalLevel("D8-D9"));
    // T* is an input alias only: it never becomes a label or a stored key.
    expect(displayCanalLevel("D8-D9")).toBe("D8-D9");
    expect(displayCanalLevel("T8-T9")).toBe("D8-D9");
    expect(displayCanalLevel("L4-L5")).toBe("L4-L5");
    expect(displayCanalLevel("C7-T1")).toBe("C7-T1");
  });
});

describe("the canonical record", () => {
  it("parses the pre-record shape without inventing a viewer value it never had", () => {
    const legacyManual = parseCanalApMeasurement(
      { value: "8.2", manualOverride: true, region: "lumbar" }, "L4-L5",
    );
    expect(legacyManual?.reportValue).toBe(8.2);
    expect(legacyManual?.viewerValue).toBeNull();
    expect(canalApValue(legacyManual)).toBe(8.2);

    const legacyViewer = parseCanalApMeasurement({ value: "9.4" }, "D8-D9");
    expect(legacyViewer?.viewerValue).toBe(9.4);
    expect(legacyViewer?.reportValue).toBeNull();
    expect(legacyViewer?.region).toBe("dorsal");
  });

  it("treats a fabricated frame number as unknown", () => {
    // viewer_measurements.frame_number defaults to 1 and the ingest route writes
    // `?? 1`, so a stored 1 is indistinguishable from "nobody knew".
    expect(parseCanalApMeasurement({ value: "9", frameNumber: 1 }, "L4-L5")?.frameNumber).toBeNull();
    expect(parseCanalApMeasurement({ value: "9", frameNumber: 24 }, "L4-L5")?.frameNumber).toBe(24);
    expect(parseCanalApMeasurement({ value: "9" }, "L4-L5")?.frameNumber).toBeNull();
  });

  it("a viewer refresh never overwrites the radiologist's number", () => {
    const first = applyCanalViewerValue(null, { level: "T8-T9", viewerValue: 9.4 });
    const edited = applyCanalManualValue(first, "D8-D9", 8.6);
    expect(edited.level).toBe("D8-D9");
    expect(edited.reportValue).toBe(8.6);
    expect(edited.viewerValue).toBe(9.4);

    const refreshed = applyCanalViewerValue(edited, { level: "T8-T9", viewerValue: 7.9 });
    expect(refreshed.reportValue).toBe(8.6);
    expect(refreshed.viewerValue).toBe(7.9);
    // The drift is visible instead of blocking the next measurement.
    expect(refreshed.staleReason).toBe("measurement_changed");
    expect(canalApValue(refreshed)).toBe(8.6);
  });

  it("manual entry keeps the image link", () => {
    const bound = applyCanalViewerValue(null, {
      level: "L4-L5", viewerValue: 8.2, annotationId: "annot-1", sopInstanceUID: "1.2.3",
    });
    const edited = applyCanalManualValue(bound, "L4-L5", 9.0);
    expect(edited.annotationId).toBe("annot-1");
    expect(edited.sopInstanceUID).toBe("1.2.3");
    expect(edited.manualOverride).toBe(true);
  });

  it("clearing a manual number returns to the caliper rather than reporting nothing", () => {
    const edited = applyCanalManualValue(
      applyCanalViewerValue(null, { level: "L4-L5", viewerValue: 8.2 }), "L4-L5", 9.0,
    );
    const cleared = applyCanalManualValue(edited, "L4-L5", null);
    expect(cleared.manualOverride).toBe(false);
    expect(cleared.reportValue).toBeNull();
    expect(canalApValue(cleared)).toBe(8.2);
  });

  it("an unedited measurement is not reported as stale", () => {
    const bound = applyCanalViewerValue(null, { level: "L4-L5", viewerValue: 8.2 });
    expect(bound.staleReason).toBeNull();
    const same = applyCanalViewerValue(bound, { level: "L4-L5", viewerValue: 8.2 });
    expect(same.staleReason).toBeNull();
  });
});

describe("legacy drafts that spelled one level two ways", () => {
  it("fold T8-T9 and D8-D9 into one record, keeping the stronger image link", () => {
    const out = canonicalizeCanalMap({
      "T8-T9": { level: "T8-T9", value: "9.4" },
      "D8-D9": { level: "D8-D9", value: "9.4", annotationId: "annot-7" },
    });
    expect(Object.keys(out.records)).toEqual(["D8-D9"]);
    expect(out.conflictedLevels).toEqual([]);
    expect(out.records["D8-D9"].annotationId).toBe("annot-7");
    expect(out.deduplicatedAliases.map((a) => a.from)).toContain("T8-T9");
  });

  it("a single alias-only entry is canonicalized, not duplicated", () => {
    const out = canonicalizeCanalMap({ "T8-T9": { level: "T8-T9", value: "9.4" } });
    expect(Object.keys(out.records)).toEqual(["D8-D9"]);
    expect(canalApValue(out.records["D8-D9"])).toBe(9.4);
  });

  it("refuses to choose between two different numbers for the same level", () => {
    const out = canonicalizeCanalMap({
      "T8-T9": { level: "T8-T9", value: "9.4" },
      "D8-D9": { level: "D8-D9", value: "7.1" },
    });
    expect(out.conflictedLevels).toEqual(["D8-D9"]);
    const rec = out.records["D8-D9"];
    expect(rec.aliasConflict?.aliasKeys).toEqual(["D8-D9", "T8-T9"]);
    expect(rec.aliasConflict?.values).toEqual([7.1, 9.4]);
    // Nothing reaches the report from a level software had to guess about.
    expect(canalApValue(rec)).toBeNull();
  });

  it("a conflict survives save and reopen instead of quietly resolving itself", () => {
    const first = canonicalizeCanalMap({
      "T8-T9": { level: "T8-T9", value: "9.4" },
      "D8-D9": { level: "D8-D9", value: "7.1" },
    });
    const reopened = canonicalizeCanalMap(first.records as unknown as Record<string, unknown>);
    expect(reopened.conflictedLevels).toEqual(["D8-D9"]);
    expect(canalApValue(reopened.records["D8-D9"])).toBeNull();
  });

  it("canonicalization is idempotent, so a reopen cannot restore the alias", () => {
    const once = canonicalizeCanalMap({
      "T8-T9": { level: "T8-T9", value: "9.4" },
      "D8-D9": { level: "D8-D9", value: "9.4" },
      "L4-5": { level: "L4-5", value: "8.2" },
    });
    const twice = canonicalizeCanalMap(once.records as unknown as Record<string, unknown>);
    expect(Object.keys(twice.records).sort()).toEqual(["D8-D9", "L4-L5"]);
    expect(twice.deduplicatedAliases).toEqual([]);
    expect(twice.conflictedLevels).toEqual([]);
  });

  it("yields exactly one reportable value per level", () => {
    const out = canonicalizeCanalMap({
      "T8-T9": { level: "T8-T9", value: "9.4" },
      "D8-D9": { level: "D8-D9", value: "9.4" },
      "L4-L5": { level: "L4-L5", value: "8.2", manualOverride: true },
    });
    const values = Object.values(out.records).map(canalApValue).filter((v) => v !== null);
    expect(values).toHaveLength(2);
    expect(values).toContain(9.4);
    expect(values).toContain(8.2);
  });
});

describe("vertebral numbering changes", () => {
  it("flags a level the new numbering no longer offers, and never renames it", () => {
    const rec = applyCanalViewerValue(null, { level: "L5-S1", viewerValue: 8.2 });
    const out = flagRenumberedCanalLevels({ "L5-S1": rec }, (l) => l !== "L5-S1");
    expect(out.flaggedLevels).toEqual(["L5-S1"]);
    // Kept, not deleted — the measurement happened, the anatomy claim is what moved.
    expect(out.records["L5-S1"].viewerValue).toBe(8.2);
    // But it stops reporting a number against a label that no longer exists.
    expect(canalApValue(out.records["L5-S1"])).toBeNull();
  });

  it("leaves a level that survives the renumbering completely alone", () => {
    const rec = applyCanalViewerValue(null, { level: "L4-L5", viewerValue: 9 });
    const out = flagRenumberedCanalLevels({ "L4-L5": rec }, () => true);
    expect(out.flaggedLevels).toEqual([]);
    expect(out.records["L4-L5"]).toBe(rec);
    expect(canalApValue(out.records["L4-L5"])).toBe(9);
  });
});
