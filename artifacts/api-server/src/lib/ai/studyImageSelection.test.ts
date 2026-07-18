import { describe, it, expect } from "vitest";
import { selectImageAnchors } from "./studyImageSelection";
import type { InstanceRef } from "./studySnapshot";

function series(seriesUid: string, modality: string, seriesNumber: number, count: number): InstanceRef[] {
  return Array.from({ length: count }, (_, k) => ({
    seriesUid,
    sopUid: `${seriesUid}-I${k + 1}`,
    modality,
    seriesNumber,
    instanceNumber: k + 1,
  }));
}

describe("structured image selection (Gate G6)", () => {
  it("every anchor carries series + SOP + frame provenance", () => {
    const anchors = selectImageAnchors(series("S1", "US", 1, 5));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.seriesUid).toBeTruthy();
      expect(a.sopUid).toBeTruthy();
      expect(a.frameNumber).toBe(1);
    }
  });

  it("representative strategy picks the single middle instance per series", () => {
    const anchors = selectImageAnchors(series("S1", "US", 1, 5), { strategy: "representative" });
    expect(anchors).toHaveLength(1);
    expect(anchors[0].sopUid).toBe("S1-I3"); // middle of 5
  });

  it("modality-aware takes multiple slices from a cross-sectional (CT/MR) series", () => {
    const anchors = selectImageAnchors(series("S1", "CT", 1, 20), { strategy: "modality-aware", modality: "CT" });
    expect(anchors.length).toBe(3); // MAX_SLICES_PER_SERIES
    expect(new Set(anchors.map((a) => a.sopUid)).size).toBe(3); // distinct slices
  });

  it("modality-aware takes one representative for a projection modality (CR/US/MG)", () => {
    const anchors = selectImageAnchors(series("S1", "CR", 1, 10), { strategy: "modality-aware", modality: "CR" });
    expect(anchors).toHaveLength(1);
  });

  it("respects the maxImages cap across many series", () => {
    const many: InstanceRef[] = [];
    for (let s = 1; s <= 30; s++) many.push(...series(`S${s}`, "US", s, 3));
    const anchors = selectImageAnchors(many, { maxImages: 20 });
    expect(anchors.length).toBeLessThanOrEqual(20);
  });

  it("visits series in a stable order (seriesNumber then UID)", () => {
    const mixed = [...series("Sb", "US", 2, 1), ...series("Sa", "US", 1, 1)];
    const anchors = selectImageAnchors(mixed, { strategy: "representative" });
    expect(anchors.map((a) => a.seriesUid)).toEqual(["Sa", "Sb"]);
  });

  it("returns nothing for an empty study", () => {
    expect(selectImageAnchors([])).toEqual([]);
  });

  it("skips instances missing a SOP UID", () => {
    const bad: InstanceRef[] = [{ seriesUid: "S1", sopUid: "", modality: "US", seriesNumber: 1, instanceNumber: 1 }];
    expect(selectImageAnchors(bad)).toEqual([]);
  });
});
