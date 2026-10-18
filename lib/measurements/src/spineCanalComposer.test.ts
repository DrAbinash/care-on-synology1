/**
 * The AI Composer must be able to read the canal AP diameters a radiologist
 * actually recorded — and must be able to read exactly what the signed report is
 * going to print, because a number the model invents and a number the table
 * prints are two numbers in one patient's report.
 *
 * This is the read-only projection of the canonical record (owner DECISION 4,
 * RIS-013): the same `canalApValue` the print fold answers through, the same
 * canonical level keys, the same head-to-tail order the printed table lays out in.
 * It is deliberately stricter than print about what it hands a language model:
 * print keeps a level nobody can canonicalise (dropping it is how a measured disc
 * disappears from a signed report), while a prose-generating model must not be
 * told a number belongs to an anatomy it cannot name.
 */
import { describe, it, expect } from "vitest";
import {
  canalApComposerReadings,
  canalPrintPlan,
  type CanalApMeasurement,
} from "./spineCanal";

function rec(over: Partial<CanalApMeasurement> & { level: string }): CanalApMeasurement {
  return {
    measurementId: "CANAL_AP",
    unit: "mm",
    region: null,
    viewerValue: null,
    reportValue: null,
    manualOverride: false,
    annotationId: null,
    viewerMeasurementRowId: null,
    studyInstanceUID: "1.2.3",
    seriesInstanceUID: null,
    sopInstanceUID: null,
    frameNumber: null,
    viewerName: null,
    capturedAt: "2026-10-18T00:00:00Z",
    verifiedAt: null,
    staleReason: null,
    aliasConflict: null,
    ...over,
  };
}

/** The persisted shape: an object keyed by level. */
function recordOf(entries: Array<[string, CanalApMeasurement]>): Record<string, CanalApMeasurement> {
  return Object.fromEntries(entries);
}

describe("the four spine examinations the clinic books", () => {
  it("MRI LS Spine: every lumbar level measured, in the printed order", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 6.4 })],
        ["L1-L2", rec({ level: "L1-L2", viewerValue: 12.6 })],
        ["L3-L4", rec({ level: "L3-L4", viewerValue: 11.6 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["L1-L2", "L3-L4", "L4-L5"]);
    expect(out.readings.map((r) => r.valueMm)).toEqual(["12.6", "11.6", "6.4"]);
    expect(out.readings.every((r) => r.segment === "lumbar")).toBe(true);
    expect(out.readings.every((r) => r.unit === "mm")).toBe(true);
  });

  it("MRI Cervical Spine: cervical levels, and C1-C2 is never offered", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["C7-T1", rec({ level: "C7-T1", viewerValue: 8.1 })],
        ["C2-C3", rec({ level: "C2-C3", viewerValue: 11.2 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["C2-C3", "C7-T1"]);
    expect(out.readings.every((r) => r.segment === "cervical")).toBe(true);
    expect(out.readings.map((r) => r.valueMm)).toEqual(["11.2", "8.1"]);
  });

  it("MRI Dorsal Spine: D-form levels in head-to-tail order, junction only when measured", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["D10-D11", rec({ level: "D10-D11", viewerValue: 10.4 })],
        ["D6-D7", rec({ level: "D6-D7", viewerValue: 11.1 })],
        ["D12-L1", rec({ level: "D12-L1", viewerValue: 9.8 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["D6-D7", "D10-D11", "D12-L1"]);
    expect(out.readings.every((r) => r.segment === "dorsal")).toBe(true);
  });

  it("MRI Dorso-Lumbar Spine: one list spanning both segments, dorsal first", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 6.4 })],
        ["D8-D9", rec({ level: "D8-D9", viewerValue: 10.1 })],
        ["L1-L2", rec({ level: "L1-L2", viewerValue: 12 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["D8-D9", "L1-L2", "L4-L5"]);
    expect(out.readings.map((r) => r.segment)).toEqual(["dorsal", "lumbar", "lumbar"]);
    // The number the model is handed is the number the table prints.
    expect(out.readings.map((r) => r.valueMm)).toEqual(["10.1", "12", "6.4"]);
  });
});

describe("transitional vertebrae keep their own numbering", () => {
  it("L5-T, L5-L6 and L6-S1 are named, not folded into the routine list", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L6-S1", rec({ level: "L6-S1", viewerValue: 9.2 })],
        ["L5-T", rec({ level: "L5-T", viewerValue: 10.7 })],
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 11.3 })],
      ]),
    );
    expect(new Set(out.readings.map((r) => r.level))).toEqual(new Set(["L4-L5", "L5-T", "L6-S1"]));
    expect(out.readings.every((r) => r.segment === "lumbar")).toBe(true);
    expect(out.readings[0]?.level).toBe("L4-L5");
  });

  it("the order handed to the model is the order the printed table lays out in", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 6.4 })],
        ["D12-L1", rec({ level: "D12-L1", viewerValue: 9.8 })],
        ["L6-S1", rec({ level: "L6-S1", viewerValue: 9.2 })],
        ["D6-D7", rec({ level: "D6-D7", viewerValue: 11.1 })],
        ["L5-T", rec({ level: "L5-T", viewerValue: 10.7 })],
      ]),
    );
    const plan = canalPrintPlan(out.readings.map((r) => r.level));
    expect(plan).not.toBeNull();
    const printed = plan!.levels.filter((l) => out.readings.some((r) => r.level === l));
    expect(out.readings.map((r) => r.level)).toEqual(printed);
  });
});

describe("manual override is preserved, and says so", () => {
  it("the radiologist's typed number is the one handed over", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 9.4, reportValue: 6.4, manualOverride: true })],
      ]),
    );
    expect(out.readings[0]?.valueMm).toBe("6.4");
    expect(out.readings[0]?.source).toBe("radiologist-entered");
    expect(out.readings[0]?.manualOverride).toBe(true);
  });

  it("a caliper number nobody overwrote is labelled viewer-caliper", () => {
    const out = canalApComposerReadings(
      recordOf([["L4-L5", rec({ level: "L4-L5", viewerValue: 8.1 })]]),
    );
    expect(out.readings[0]?.source).toBe("viewer-caliper");
    expect(out.readings[0]?.manualOverride).toBe(false);
  });

  it("a manual number stays when the caliper later drifted (the table prints it)", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4-L5", rec({
          level: "L4-L5",
          viewerValue: 9.9,
          reportValue: 6.4,
          manualOverride: true,
          staleReason: "measurement_changed",
        })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["L4-L5"]);
    expect(out.readings[0]?.valueMm).toBe("6.4");
    // The drift is visible to a reader instead of silently hidden.
    expect(out.readings[0]?.staleReason).toBe("measurement_changed");
  });
});

describe("what is excluded, and how the exclusion is named", () => {
  it("a level whose two aliases disagree is declined, not chosen for the model", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["D8-D9", rec({
          level: "D8-D9",
          viewerValue: 10.1,
          aliasConflict: { aliasKeys: ["D8-D9", "T8-T9"], values: [10.1, 9.6] },
        })],
        ["D6-D7", rec({ level: "D6-D7", viewerValue: 11.0 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["D6-D7"]);
    expect(out.declinedLevels).toEqual(["D8-D9"]);
  });

  it("a level whose vertebra moved under it is declined", () => {
    const out = canalApComposerReadings(
      recordOf([["L5-S1", rec({ level: "L5-S1", viewerValue: 8.0, staleReason: "level_renumbered" })]]),
    );
    expect(out.readings).toEqual([]);
    expect(out.declinedLevels).toEqual(["L5-S1"]);
  });

  it("an empty cell is an absence, not a declined answer", () => {
    const out = canalApComposerReadings(
      recordOf([["L3-L4", rec({ level: "L3-L4" })]]),
    );
    expect(out.readings).toEqual([]);
    expect(out.declinedLevels).toEqual([]);
  });

  it("a level nobody can canonicalise never reaches the model", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L4", rec({ level: "L4", viewerValue: 7.7 })],
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 6.4 })],
      ]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["L4-L5"]);
    expect(out.ambiguousLevels).toEqual(["L4"]);
  });

  it("an input alias spelling resolves to the canonical key the table prints", () => {
    const out = canalApComposerReadings(
      recordOf([["T8-T9", rec({ level: "T8-T9", viewerValue: 10.5 })]]),
    );
    expect(out.readings.map((r) => r.level)).toEqual(["D8-D9"]);
  });

  it("a study with no canal record at all says so by carrying nothing", () => {
    for (const raw of [null, undefined, {}, "not-an-object", []]) {
      const out = canalApComposerReadings(raw);
      expect(out.readings).toEqual([]);
      expect(out.declinedLevels).toEqual([]);
      expect(out.ambiguousLevels).toEqual([]);
      expect(out.isEmpty).toBe(true);
    }
  });

  it("the value travels as text, with the decimal the record actually holds", () => {
    const out = canalApComposerReadings(
      recordOf([
        ["L1-L2", rec({ level: "L1-L2", viewerValue: 12 })],
        ["L4-L5", rec({ level: "L4-L5", viewerValue: 7.1 })],
        ["L5-S1", rec({ level: "L5-S1", reportValue: 8.05, manualOverride: true })],
      ]),
    );
    expect(out.readings.map((r) => r.valueMm)).toEqual(["12", "7.1", "8.05"]);
    // A string survives the record unchanged too, because the projection never
    // re-parses a clinical number into a float and back.
    const fromText = canalApComposerReadings(
      recordOf([["L4-L5", rec({ level: "L4-L5", viewerValue: "6.40" as unknown as number })]]),
    );
    expect(fromText.readings[0]?.valueMm).toBe("6.4");
  });
});
