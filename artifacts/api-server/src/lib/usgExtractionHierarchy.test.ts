import { describe, it, expect } from "vitest";
import { selectByHierarchy, selectAllByHierarchy, HIERARCHY_ORDER, type MeasurementCandidate } from "./usgExtractionHierarchy";

const cand = (over: Partial<MeasurementCandidate>): MeasurementCandidate => ({
  key: "bpd", source: "ocr", value: "74", confidence: 0.6, ...over,
});

describe("P3.2 extraction hierarchy", () => {
  it("priority order is SR-SCOORD > SR-NUM > GE > PDF > OCR > manual", () => {
    expect(HIERARCHY_ORDER).toEqual(["dicom_sr_scoord", "dicom_sr_num", "ge_private_tag", "encapsulated_pdf", "ocr", "manual"]);
  });

  it("chooses the highest-priority source and retains ALL candidates", () => {
    const r = selectByHierarchy([
      cand({ source: "ocr", value: "74" }),
      cand({ source: "dicom_sr_scoord", value: "74.2" }),
      cand({ source: "ge_private_tag", value: "74.1" }),
    ])!;
    expect(r.chosen.source).toBe("dicom_sr_scoord");
    expect(r.candidates).toHaveLength(3);                 // nothing discarded
    expect(r.candidates[0].source).toBe("dicom_sr_scoord");
  });

  it("agreement within 2% is not a conflict", () => {
    const r = selectByHierarchy([
      cand({ source: "dicom_sr_num", value: "74.2" }),
      cand({ source: "ge_private_tag", value: "74.1" }),
    ])!;
    expect(r.conflict).toBe(false);
  });

  it("material disagreement is flagged as a conflict (candidates kept for review)", () => {
    const r = selectByHierarchy([
      cand({ source: "dicom_sr_num", value: "74" }),
      cand({ source: "ocr", value: "88" }),
    ])!;
    expect(r.conflict).toBe(true);
    expect(r.chosen.source).toBe("dicom_sr_num");
    expect(r.candidates.map((c) => c.value)).toContain("88"); // lower-priority conflicting value retained
  });

  it("selectAllByHierarchy groups by key", () => {
    const all = selectAllByHierarchy([
      cand({ key: "bpd", source: "ocr", value: "74" }),
      cand({ key: "bpd", source: "dicom_sr_num", value: "74.2" }),
      cand({ key: "hc", source: "ge_private_tag", value: "280" }),
    ]);
    expect(all.bpd.chosen.source).toBe("dicom_sr_num");
    expect(all.hc.chosen.source).toBe("ge_private_tag");
  });

  it("empty → null", () => {
    expect(selectByHierarchy([])).toBeNull();
  });
});
