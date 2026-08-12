import { describe, it, expect } from "vitest";
import {
  combineStudyRegionTitle,
  mergeTechniqueForRegions,
  modalityTitlePrefix,
} from "./combineStudyRegions";
import type { QuickSelectData } from "@/components/radiology/QuickFindingsPanel";

describe("modalityTitlePrefix", () => {
  it("normalises MR/MRI to MRI", () => {
    expect(modalityTitlePrefix("MR")).toBe("MRI");
    expect(modalityTitlePrefix("MRI")).toBe("MRI");
  });
});

describe("combineStudyRegionTitle", () => {
  it("prefixes a single generic region with modality", () => {
    expect(combineStudyRegionTitle("MR", ["Brain"])).toBe("MRI BRAIN");
  });

  it("joins two regions with WITH and drops repeated modality", () => {
    expect(combineStudyRegionTitle("MRI", ["Brain", "Cervical Spine"])).toBe(
      "MRI BRAIN WITH CERVICAL SPINE",
    );
  });

  it("keeps modality-prefixed region names as-is for single selection", () => {
    expect(combineStudyRegionTitle("CT", ["CT Brain Plain"])).toBe("CT BRAIN PLAIN");
  });

  it("returns null for empty regions", () => {
    expect(combineStudyRegionTitle("MR", [])).toBeNull();
  });
});

describe("mergeTechniqueForRegions", () => {
  const data: QuickSelectData = {
    tabs: [
      { id: 1, name: "Brain", sortOrder: 0, isActive: true, techniqueText: "Brain tab technique.", normalText: "" },
      { id: 2, name: "Cervical Spine", sortOrder: 1, isActive: true, techniqueText: "Cervical tab technique.", normalText: "" },
    ],
    findings: [],
    measurements: [],
    clinicalHistory: [],
    protocols: [
      {
        id: 10,
        name: "MRI Brain Default",
        studyType: "Brain",
        modality: "MR",
        checklistJson: "[]",
        techniqueText: "Brain protocol technique.",
        normalText: "",
        recommendationText: "",
        requiredMeasurements: "",
        isGoldStandard: false,
        isDefault: true,
        sortOrder: 0,
        isActive: true,
      },
      {
        id: 11,
        name: "MRI Cervical Default",
        studyType: "Cervical Spine",
        modality: "MR",
        checklistJson: "[]",
        techniqueText: "Cervical protocol technique.",
        normalText: "",
        recommendationText: "",
        requiredMeasurements: "",
        isGoldStandard: false,
        isDefault: true,
        sortOrder: 0,
        isActive: true,
      },
    ],
  };

  it("merges protocol and tab technique for each region", () => {
    const merged = mergeTechniqueForRegions(data, ["Brain", "Cervical Spine"]);
    expect(merged).toContain("Brain protocol technique.");
    expect(merged).toContain("Brain tab technique.");
    expect(merged).toContain("Cervical protocol technique.");
    expect(merged).toContain("Cervical tab technique.");
  });
});
