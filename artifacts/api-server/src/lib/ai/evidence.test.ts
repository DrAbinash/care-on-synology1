import { describe, it, expect } from "vitest";
import { validateEvidenceAnchor, type EvidenceAnchor } from "./evidence";

const snapshot = [
  { seriesUid: "S1", sopUid: "I1" },
  { seriesUid: "S1", sopUid: "I2" },
  { seriesUid: "S2", sopUid: "I3" },
];

describe("evidence store — anchor validation (grounding gate)", () => {
  it("accepts an image anchor whose series/SOP exist in the snapshot", () => {
    const a: EvidenceAnchor = { findingKey: "f1", evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I2", frameNumber: 1, confidence: 80 };
    expect(validateEvidenceAnchor(a, snapshot).ok).toBe(true);
  });

  it("rejects an image anchor whose SOP is NOT in the snapshot (ungrounded/hallucinated)", () => {
    const a: EvidenceAnchor = { findingKey: "f1", evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I999" };
    const r = validateEvidenceAnchor(a, snapshot);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not present in study snapshot/);
  });

  it("rejects an image anchor missing series or SOP", () => {
    expect(validateEvidenceAnchor({ findingKey: "f1", evidenceType: "image", sopInstanceUid: "I1" }, snapshot).ok).toBe(false);
  });

  it("accepts measurement evidence with a measurementRef", () => {
    expect(validateEvidenceAnchor({ findingKey: "f1", evidenceType: "measurement", measurementRef: "STONE_SIZE" }, snapshot).ok).toBe(true);
  });

  it("rejects measurement evidence without a measurementRef", () => {
    expect(validateEvidenceAnchor({ findingKey: "f1", evidenceType: "measurement" }, snapshot).ok).toBe(false);
  });

  it("reserves heatmap evidence (always rejected in P1)", () => {
    const r = validateEvidenceAnchor({ findingKey: "f1", evidenceType: "heatmap", seriesInstanceUid: "S1", sopInstanceUid: "I1" }, snapshot);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reserved/);
  });

  it("rejects a confidence outside 0-100", () => {
    expect(validateEvidenceAnchor({ findingKey: "f1", evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I1", confidence: 140 }, snapshot).ok).toBe(false);
  });

  it("rejects an anchor with no findingKey", () => {
    expect(validateEvidenceAnchor({ findingKey: "", evidenceType: "image", seriesInstanceUid: "S1", sopInstanceUid: "I1" }, snapshot).ok).toBe(false);
  });
});
