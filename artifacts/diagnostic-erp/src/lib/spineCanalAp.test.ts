import { describe, expect, it } from "vitest";
import {
  canalApTableHtml,
  canalApToPdfRows,
  canalSegmentFromSpine,
  discLevelFromLabel,
  formatCanalApTableText,
  levelsForCanalSegment,
  normalizeDiscLevel,
  parseCanalApNumber,
  resolveCanalSegment,
} from "./spineCanalAp";

describe("spineCanalAp", () => {
  it("resolves LS vs cervical from region text", () => {
    expect(resolveCanalSegment("LS Spine • DL SPINE SCREENING")).toBe("lumbar");
    expect(resolveCanalSegment("MRI Cervical Spine")).toBe("cervical");
    expect(resolveCanalSegment("Brain")).toBeNull();
    expect(canalSegmentFromSpine("lumbar")).toBe("lumbar");
    expect(canalSegmentFromSpine("cervical")).toBe("cervical");
    expect(canalSegmentFromSpine("dorsal")).toBeNull();
  });

  it("normalizes OHIF-style disc labels", () => {
    expect(normalizeDiscLevel("L4-5")).toBe("L4-L5");
    expect(normalizeDiscLevel("L4-L5")).toBe("L4-L5");
    expect(normalizeDiscLevel("l5-s1")).toBe("L5-S1");
    expect(normalizeDiscLevel("C5/C6")).toBe("C5-C6");
    expect(discLevelFromLabel("Linear L3-4")).toBe("L3-L4");
    expect(discLevelFromLabel("Canal AP L1-L2")).toBe("L1-L2");
  });

  it("builds 5 lumbar and 5 cervical levels", () => {
    expect(levelsForCanalSegment("lumbar")).toEqual(["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"]);
    expect(levelsForCanalSegment("cervical")).toEqual([
      "C1-C2", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
    ]);
  });

  it("formats findings table and PDF rows", () => {
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
  });

  it("parses numeric AP values", () => {
    expect(parseCanalApNumber("14.0 mm")).toBe("14.0");
    expect(parseCanalApNumber("12,3")).toBe("12.3");
  });
});
