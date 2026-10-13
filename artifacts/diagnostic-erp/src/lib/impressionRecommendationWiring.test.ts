import { describe, expect, it } from "vitest";
import {
  collectPathologyRecommendationChips,
  mergeRecommendationChipLists,
} from "./impressionRecommendationWiring";
import { validateReport } from "./reportValidator";

describe("impressionRecommendationWiring", () => {
  it("mergeRecommendationChipLists dedupes case-insensitively", () => {
    const merged = mergeRecommendationChipLists(
      ["Clinical correlation advised."],
      ["clinical correlation advised.", "Follow-up scan."],
    );
    expect(merged).toHaveLength(2);
  });

  it("collectPathologyRecommendationChips splits sentences", () => {
    const chips = collectPathologyRecommendationChips([
      { lastRendered: { recommendation: "Line one. Line two." } },
    ]);
    expect(chips).toEqual(["Line one.", "Line two."]);
  });
});

describe("reportValidator — Section 5 contradictions", () => {
  it("flags spinal level mismatch", () => {
    const w = validateReport({
      findings: "Disc bulge at L3-L4 without nerve root compression.",
      impression: ["Disc herniation at L4-L5 causing thecal sac indentation."],
    });
    expect(w.some((x) => x.toLowerCase().includes("level mismatch"))).toBe(true);
  });

  it("flags normal impression with pathology findings", () => {
    const w = validateReport({
      findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
      impression: ["Normal MRI brain."],
    });
    // Q114 in the canonical text tier is the single owner of this defect; the
    // validator's older substring copy of it is gone (it flagged normal head CTs).
    expect(
      w.some((x) => x.includes("Findings/Impression contradiction") && x.toLowerCase().includes("normal")),
    ).toBe(true);
    expect(w.filter((x) => x.toLowerCase().includes("impression reads normal"))).toHaveLength(0);
  });
});
