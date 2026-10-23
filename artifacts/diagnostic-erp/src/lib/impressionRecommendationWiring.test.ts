import { describe, expect, it } from "vitest";
import {
  alignRecommendationToObservations,
  collectPathologyRecommendationChips,
  mergeRecommendationChipLists,
} from "./impressionRecommendationWiring";
import { validateReport } from "./reportValidator";

describe("alignRecommendationToObservations — a deleted advice sentence stays deleted", () => {
  const ADVICE = "Conservative management with NSAIDs and physiotherapy.";

  it("re-inserts a still-live patch's advice that is missing from the box", () => {
    const out = alignRecommendationToObservations({
      current: "",
      patches: [{ stale: false, protected: false, lastRendered: { recommendation: ADVICE } }],
    });
    expect(out.changed).toBe(true);
    expect(out.text).toContain(ADVICE);
  });

  it("never resurrects advice the radiologist deleted — the patch is protected by that deletion", () => {
    // Repro of the audited defect: tile applied → its advice deleted from the
    // Recommendation box → any other tile click/deselect re-inserted the
    // deleted sentence. The deletion marks the patch protected
    // (store setField manual write), and the aligner must respect it exactly
    // like the impression side does.
    const out = alignRecommendationToObservations({
      current: "",
      patches: [{ stale: false, protected: true, lastRendered: { recommendation: ADVICE } }],
    });
    expect(out.changed).toBe(false);
    expect(out.text).toBe("");
  });

  it("still refuses stale patches — an observation the prose has moved past does not advise", () => {
    const out = alignRecommendationToObservations({
      current: "",
      patches: [{ stale: true, protected: false, lastRendered: { recommendation: ADVICE } }],
    });
    expect(out.changed).toBe(false);
  });

  it("an unprotected patch beside a protected one still contributes its own advice", () => {
    const out = alignRecommendationToObservations({
      current: "",
      patches: [
        { stale: false, protected: true, lastRendered: { recommendation: ADVICE } },
        { stale: false, protected: false, lastRendered: { recommendation: "Follow-up in 6 weeks." } },
      ],
    });
    expect(out.text).not.toContain(ADVICE);
    expect(out.text).toContain("Follow-up in 6 weeks.");
  });
});

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
