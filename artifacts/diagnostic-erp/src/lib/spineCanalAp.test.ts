import { describe, expect, it } from "vitest";
import {
  applyCanalManualValue,
  applyCanalViewerValue,
  canalApTableHtml,
  canalApToPdfRows,
  canalApValue,
  canalSegmentFromSpine,
  canalTableTitle,
  discLevelFromLabel,
  DORSAL_CANAL_LEVELS,
  formatCanalApTableText,
  isLevelInSegment,
  levelsForCanalSegment,
  normalizeDiscLevel,
  parseCanalApNumber,
  pickPrintCanalSegment,
  resolveActiveCanalSegment,
  resolveCanalSegment,
} from "./spineCanalAp";

describe("spineCanalAp — common engine", () => {
  it("resolves LS / cervical / dorsal from region text", () => {
    expect(resolveCanalSegment("LS Spine • DL SPINE SCREENING")).toBe("lumbar");
    expect(resolveCanalSegment("MRI Cervical Spine")).toBe("cervical");
    expect(resolveCanalSegment("MRI Dorsal Spine")).toBe("dorsal");
    expect(resolveCanalSegment("Thoracic spine MRI")).toBe("dorsal");
    expect(resolveCanalSegment("Brain")).toBeNull();
    expect(canalSegmentFromSpine("lumbar")).toBe("lumbar");
    expect(canalSegmentFromSpine("cervical")).toBe("cervical");
    expect(canalSegmentFromSpine("dorsal")).toBe("dorsal");
  });

  it("preserves lumbar and cervical level tables", () => {
    expect(levelsForCanalSegment("lumbar")).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    // C1-C2 is not a disc level — there is no intervertebral disc there — so it
    // is not offered as a row of a disc-level canal table.
    expect(levelsForCanalSegment("cervical")).toEqual([
      "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
    expect(levelsForCanalSegment("cervical")).not.toContain("C1-C2");
  });

  it("provides dorsal D1–D12 disc levels (CARE terminology)", () => {
    expect(levelsForCanalSegment("dorsal")).toEqual([...DORSAL_CANAL_LEVELS]);
    expect(DORSAL_CANAL_LEVELS).toHaveLength(11);
    expect(DORSAL_CANAL_LEVELS[0]).toBe("D1-D2");
    expect(DORSAL_CANAL_LEVELS[10]).toBe("D11-D12");
    expect(canalTableTitle("dorsal")).toMatch(/DORSAL CANAL/);
  });

  it("normalizes OHIF labels including T→D", () => {
    expect(normalizeDiscLevel("L4-5")).toBe("L4-L5");
    expect(normalizeDiscLevel("L4-L5")).toBe("L4-L5");
    expect(normalizeDiscLevel("l5-s1")).toBe("L5-S1");
    expect(normalizeDiscLevel("C5/C6")).toBe("C5-C6");
    expect(normalizeDiscLevel("T4-T5")).toBe("D4-D5");
    expect(normalizeDiscLevel("D6-D7")).toBe("D6-D7");
    expect(discLevelFromLabel("Linear L3-4")).toBe("L3-L4");
    expect(discLevelFromLabel("Canal AP L1-L2")).toBe("L1-L2");
    expect(discLevelFromLabel("Canal AP T8-T9")).toBe("D8-D9");
  });

  it("L4-L5 and L3-L4 are distinct levels", () => {
    expect(isLevelInSegment("lumbar", "L4-L5")).toBe(true);
    expect(isLevelInSegment("lumbar", "L3-L4")).toBe(true);
    expect(isLevelInSegment("cervical", "L4-L5")).toBe(false);
    expect(isLevelInSegment("dorsal", "D6-D7")).toBe(true);
  });

  it("formats findings table and PDF rows; blank levels stay blank", () => {
    const values = { "L1-L2": "17.1", "L4-L5": "10.2", "L5-S1": "14.0" };
    const text = formatCanalApTableText("lumbar", values);
    expect(text).toContain("LUMBAR CANAL AP DIAMETER");
    expect(text).toContain("L1-L2");
    expect(text).toContain("17.1");
    expect(canalApToPdfRows("lumbar", values)).toEqual([
      { label: "Canal AP L1-L2", value: "17.1 mm" },
      { label: "Canal AP L4-L5", value: "10.2 mm" },
      { label: "Canal AP L5-S1", value: "14.0 mm" },
    ]);
    expect(canalApTableHtml("lumbar", values, (s) => s)).toContain("<table");
    expect(canalApTableHtml("lumbar", {}, (s) => s)).toBe("");
    // Dorsal: unmeasured levels do not invent values
    const dorsalHtml = canalApTableHtml("dorsal", { "D6-D7": "12.0" }, (s) => s);
    expect(dorsalHtml).toContain("D6-D7");
    expect(dorsalHtml).toContain("12.0");
    expect(dorsalHtml).not.toMatch(/>0</);
    expect(dorsalHtml).not.toMatch(/normal/i);
  });

  it("pickPrintCanalSegment prefers filled segment", () => {
    const by = new Map<string, string>([
      ["L4-L5", "6.7"],
      ["C5-C6", "11"],
      ["C6-C7", "12"],
    ]);
    expect(pickPrintCanalSegment(by)).toBe("cervical");
    expect(pickPrintCanalSegment(new Map([["D4-D5", "10"]]))).toBe("dorsal");
    expect(pickPrintCanalSegment(new Map())).toBeNull();
  });

  it("parses numeric AP values", () => {
    expect(parseCanalApNumber("14.0 mm")).toBe("14.0");
    expect(parseCanalApNumber("12,3")).toBe("12.3");
  });

  it("a manual override keeps its number AND still accepts viewer updates", () => {
    const bound = applyCanalViewerValue(null, { level: "L4-L5", viewerValue: 6.8 });
    const manual = applyCanalManualValue(bound, "L4-L5", 6.5);
    expect(manual.manualOverride).toBe(true);
    expect(canalApValue(manual)).toBe(6.5);

    // This test used to pin the defect as expected behaviour: a typed number
    // refused every later measurement for that level, and reported the refusal
    // in a different panel. The radiologist still wins — by keeping their
    // number, not by switching the viewer off.
    const refreshed = applyCanalViewerValue(manual, { level: "L4-L5", viewerValue: 6.2 });
    expect(refreshed.viewerValue).toBe(6.2);
    expect(refreshed.reportValue).toBe(6.5);
    expect(canalApValue(refreshed)).toBe(6.5);
    expect(refreshed.staleReason).toBe("measurement_changed");
  });

  it("forceDorsal overrides lumbar/cervical inference", () => {
    expect(
      resolveActiveCanalSegment({
        spineSegment: "lumbar",
        regionHint: "MRI LS Spine",
        forceDorsal: true,
      }),
    ).toBe("dorsal");
    expect(
      resolveActiveCanalSegment({
        spineSegment: "lumbar",
        regionHint: "MRI LS Spine",
        forceDorsal: false,
      }),
    ).toBe("lumbar");
    expect(
      resolveActiveCanalSegment({
        regionHint: "Brain",
        forceDorsal: false,
      }),
    ).toBeNull();
  });

  it("writing L4-L5 leaves the L3-L4 record alone", () => {
    const values: Record<string, number | null> = { "L3-L4": 12.0 };
    const rec = applyCanalViewerValue(null, { level: "L4-L5", viewerValue: 6.8 });
    values[rec.level] = canalApValue(rec);
    expect(values["L3-L4"]).toBe(12.0);
    expect(values["L4-L5"]).toBe(6.8);
  });
});
