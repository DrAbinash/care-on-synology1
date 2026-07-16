import { describe, it, expect } from "vitest";
import { matchStudyRegion } from "./studyRegion";

// Region names in display (sortOrder) order — generic modality-neutral regions
// sort before the modality-prefixed CT tabs, exactly as radiology_study_tabs is
// seeded (generic Brain/Spine/Abdomen at low sort_order, "CT …" tabs at 900+).
const REGIONS = [
  "Brain",
  "Cervical Spine",
  "Spine",
  "Abdomen",
  "Chest",
  "CT Brain Plain",
  "CT Cervical Spine",
  "CT Chest Plain",
  "CT Whole Abdomen",
];

describe("matchStudyRegion — most-specific (longest) wins", () => {
  it("routes a CT study to its CT tab, not the shorter generic region", () => {
    // The workspace passes `${modality} ${studyDescription}` as the hint.
    expect(matchStudyRegion("CT CT Brain Plain", REGIONS)).toBe("CT Brain Plain");
    expect(matchStudyRegion("CT CT Cervical Spine", REGIONS)).toBe("CT Cervical Spine");
    expect(matchStudyRegion("CT CT Chest Plain", REGIONS)).toBe("CT Chest Plain");
    expect(matchStudyRegion("CT CT Whole Abdomen", REGIONS)).toBe("CT Whole Abdomen");
  });

  it("does NOT regress the single-match generic regions (MRI/other modalities)", () => {
    expect(matchStudyRegion("MRI Brain", REGIONS)).toBe("Brain");
    expect(matchStudyRegion("MRI Cervical Spine", REGIONS)).toBe("Cervical Spine");
    expect(matchStudyRegion("USG Abdomen", REGIONS)).toBe("Abdomen");
  });

  it("is case-insensitive and tolerates null/empty hints", () => {
    expect(matchStudyRegion("ct brain plain study", REGIONS)).toBe("CT Brain Plain");
    expect(matchStudyRegion(null, REGIONS)).toBeNull();
    expect(matchStudyRegion("", REGIONS)).toBeNull();
    expect(matchStudyRegion("Nuclear medicine bone scan", REGIONS)).toBeNull();
  });

  it("breaks ties by display order (first / lowest sortOrder among equal length)", () => {
    // Two equally-long region names both substring-match → the earlier one wins.
    expect(matchStudyRegion("scan AA BB extra", ["AA", "BB"])).toBe("AA");
  });
});
