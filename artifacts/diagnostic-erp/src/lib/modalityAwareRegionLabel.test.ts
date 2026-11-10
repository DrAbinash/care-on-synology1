// @vitest-environment node
/**
 * P3-1 — the composer's Region: label must name the modality the study
 * actually is. These pins hold the pure derivation the workspace memo and any
 * other surface share, including the backward-compatibility rule that keeps
 * every MRI label byte-identical to what the inline memo printed before.
 */
import { describe, expect, it } from "vitest";
import { modalityAwareRegionLabel, modalityLabelPrefix } from "./modalityAwareRegionLabel";

describe("modalityLabelPrefix", () => {
  it("maps the DICOM vocabulary this clinic scans", () => {
    expect(modalityLabelPrefix("MR")).toBe("MRI");
    expect(modalityLabelPrefix("MRI")).toBe("MRI");
    expect(modalityLabelPrefix("CT")).toBe("CT");
    expect(modalityLabelPrefix("US")).toBe("USG");
    expect(modalityLabelPrefix("XR")).toBe("X-Ray");
    expect(modalityLabelPrefix("DX")).toBe("X-Ray");
  });

  it("keeps the historical MRI default for an absent modality and invents nothing for an unknown one", () => {
    expect(modalityLabelPrefix(null)).toBe("MRI");
    expect(modalityLabelPrefix("")).toBe("MRI");
    expect(modalityLabelPrefix("  ")).toBe("MRI");
    expect(modalityLabelPrefix("PT")).toBeNull();
    expect(modalityLabelPrefix("unknown-modality")).toBeNull();
  });
});

describe("modalityAwareRegionLabel — P3-1, brain and spine are modality-aware", () => {
  it("MRI studies keep the exact labels the inline memo printed before", () => {
    expect(modalityAwareRegionLabel({ modality: "MR", family: "brain" })).toBe("MRI Brain");
    expect(modalityAwareRegionLabel({ modality: "MR", family: "spine", spineSegment: "cervical" })).toBe("MRI Cervical Spine");
    expect(modalityAwareRegionLabel({ modality: "MR", family: "spine", spineSegment: "dorsal" })).toBe("MRI Dorsal Spine");
    expect(modalityAwareRegionLabel({ modality: "MR", family: "spine", spineSegment: "lumbar" })).toBe("MRI Lumbosacral Spine");
    expect(modalityAwareRegionLabel({ modality: "MR", family: "spine", spineSegment: "dorsolumbar" })).toBe("MRI Dorso-Lumbar Spine");
    expect(modalityAwareRegionLabel({ modality: "MR", family: "spine" })).toBe("MRI Spine");
    // absent modality keeps the MRI default (byte-identical legacy behaviour)
    expect(modalityAwareRegionLabel({ family: "brain" })).toBe("MRI Brain");
  });

  it("a CT spine study no longer calls itself an MRI", () => {
    expect(modalityAwareRegionLabel({ modality: "CT", family: "spine", spineSegment: "dorsal" })).toBe("CT Dorsal Spine");
    expect(modalityAwareRegionLabel({ modality: "US", family: "brain" })).toBe("USG Brain");
    expect(modalityAwareRegionLabel({ modality: "XR", family: "spine", spineSegment: "cervical" })).toBe("X-Ray Cervical Spine");
  });

  it("an unknown modality prints the bare region instead of inventing a prefix", () => {
    expect(modalityAwareRegionLabel({ modality: "PT", family: "brain" })).toBe("Brain");
    expect(modalityAwareRegionLabel({ modality: "PT", family: "spine" })).toBe("Spine");
  });

  it("non-family studies fall back through the same chain the memo used", () => {
    expect(modalityAwareRegionLabel({ modality: "CT", region: "CHEST" })).toBe("CHEST");
    expect(modalityAwareRegionLabel({ modality: "CT", matchedStudyRegion: "CHEST" })).toBe("CHEST");
    expect(modalityAwareRegionLabel({ modality: "CT", studyRegions: ["", "KNE"] })).toBe("KNE");
    expect(modalityAwareRegionLabel({ modality: "CT" })).toBe("Unknown region");
  });
});
