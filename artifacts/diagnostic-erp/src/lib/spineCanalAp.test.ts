import { describe, expect, it } from "vitest";
import {
  applyCanalApValue,
  canalApTableHtml,
  canalApToPdfRows,
  canalSegmentFromSpine,
  canalTableTitle,
  discLevelFromLabel,
  DORSAL_CANAL_LEVELS,
  formatCanalApTableText,
  isLevelInSegment,
  levelsForCanalSegment,
  markCanalApManualOverride,
  normalizeDiscLevel,
  parseCanalApNumber,
  pickPrintCanalSegment,
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
    expect(levelsForCanalSegment("cervical")).toEqual([
      "C1-C2", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
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

  it("manual override blocks later viewer update unless forceRefresh", () => {
    const manual = markCanalApManualOverride(null, "L4-L5", "6.5", "lumbar");
    expect(manual.manualOverride).toBe(true);
    expect(manual.value).toBe("6.5");
    const blocked = applyCanalApValue({
      level: "L4-L5",
      nextValue: "6.8",
      provenance: manual,
    });
    expect(blocked).toEqual({ blocked: true });
    const refreshed = applyCanalApValue({
      level: "L4-L5",
      nextValue: "6.8",
      provenance: manual,
      forceRefresh: true,
    });
    expect("value" in refreshed && refreshed.value).toBe("6.8");
    expect("provenance" in refreshed && refreshed.provenance.manualOverride).toBe(false);
  });

  it("viewer apply without override writes value", () => {
    const r = applyCanalApValue({ level: "L4-L5", nextValue: "6.8 mm" });
    expect("value" in r && r.value).toBe("6.8");
  });
});
