/**
 * Section 6 — Recommendation / Advice wiring tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { applyPathologyPatch } from "./pathologyPatch";
import { mergeSentences, provenanceFromText } from "./reportFieldMerge";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";
import {
  collectPathologyRecommendationChips,
  mergeRecommendationChipLists,
} from "./impressionRecommendationWiring";
import { buildReportingStudyContext } from "./reportingStudyContext";

const BRAIN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
const STROKE_REC = DEFAULT_QUICK_SELECT_TILES.find(
  (t) => t.field === "recommendation" && t.label === "Stroke team",
)!;

function resetWorkspace() {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain Plain",
      regions: ["Brain"],
      source: "auto",
    }),
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    impressionNeedsRefresh: false,
  });
}

describe("Section 6 — Recommendation", () => {
  beforeEach(() => resetWorkspace());

  it("9. pathology with Recommendation adds its owned advice", () => {
    const advice = "Further evaluation with contrast-enhanced MRI is advised.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: "",
      },
      incoming: {
        findings: "Indeterminate lesion in the right frontal lobe.",
        impression: "Indeterminate right frontal lobe lesion.",
        recommendation: advice,
      },
      ownership: { conflictGroup: "lesion" },
      source: "quick-findings",
    });
    expect(result.narrative.recommendation).toContain("Further evaluation");
  });

  it("10. removing pathology removes only untouched owned Recommendation", () => {
    const store = useWorkspace.getState();
    const advice = STROKE_REC!.sentence;
    store.setEditorContent({
      clinicalHistory: "",
      technique: "",
      findings: BRAIN.findings,
      impression: BRAIN.impression,
      recommendation: "",
    });
    store.applyPathologyOverlay({
      incoming: {
        findings: "Acute left MCA territory infarct.",
        impression: "Acute left MCA territory infarct.",
        recommendation: advice,
      },
      templates: {
        findings: "Acute left MCA territory infarct.",
        impression: "Acute left MCA territory infarct.",
        recommendation: advice,
      },
      ownership: { conflictGroup: "infarct" },
      source: "quick-select",
      id: "stroke-1",
    });
    expect(useWorkspace.getState().recommendationText).toContain("stroke team");
    store.removeObservation("stroke-1");
    expect(useWorkspace.getState().recommendationText.toLowerCase()).not.toContain("stroke team");
  });

  it("11. manually edited Recommendation survives pathology removal", () => {
    const store = useWorkspace.getState();
    const advice = "Clinical correlation advised.";
    store.applyPathologyOverlay({
      incoming: {
        findings: "Small lesion.",
        recommendation: advice,
      },
      templates: { findings: "Small lesion.", recommendation: advice },
      ownership: { conflictGroup: "lesion" },
      source: "quick-findings",
      id: "les-1",
    });
    const edited = useWorkspace.getState().recommendationText.replace("advised", "advised — radiologist note");
    store.setField("recommendation", edited);
    const outcome = store.removeObservation("les-1");
    expect(outcome).toBe("preserved-manual");
    expect(useWorkspace.getState().recommendationText).toContain("radiologist note");
  });

  it("12. duplicate identical recommendations are deduplicated on merge", () => {
    const chip = "Clinical correlation advised.";
    const merged = mergeSentences(chip, chip);
    expect(merged.match(/Clinical correlation advised/g)?.length ?? 0).toBe(1);
    const twice = mergeSentences(chip, `${chip}\n${chip}`);
    expect(twice.match(/Clinical correlation advised/g)?.length ?? 0).toBe(1);
  });

  it("13. empty Recommendation remains valid", () => {
    const store = useWorkspace.getState();
    store.setField("recommendation", "");
    expect(useWorkspace.getState().recommendationText.trim()).toBe("");
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: "",
      },
      incoming: { findings: "Normal variant." },
      ownership: {},
      source: "quick-findings",
    });
    expect(result.narrative.recommendation).toBe("");
  });

  it("14. whole-report Recommendation safely coexists with pathology advice", () => {
    const institutional = BRAIN.recommendation;
    const pathologyAdvice = "Histopathology correlation is recommended.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: institutional,
      },
      incoming: {
        findings: "Suspicious spiculated mass.",
        recommendation: pathologyAdvice,
      },
      ownership: { conflictGroup: "mass" },
      provenance: { recommendation: provenanceFromText(institutional, "template") },
      source: "quick-findings",
    });
    expect(result.narrative.recommendation).toContain("Clinical correlation");
    expect(result.narrative.recommendation).toContain("Histopathology");
  });

  it("15. pathology undo restores Findings + Impression + Recommendation together", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "",
      technique: "",
      findings: BRAIN.findings,
      impression: BRAIN.impression,
      recommendation: BRAIN.recommendation,
    });
    const before = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
    };
    store.applyPathologyOverlay({
      incoming: {
        findings: "Acute right basal ganglia hemorrhage.",
        impression: "Acute right basal ganglia hemorrhage.",
        recommendation: "Neurosurgical consultation advised.",
      },
      templates: {
        findings: "Acute right basal ganglia hemorrhage.",
        impression: "Acute right basal ganglia hemorrhage.",
        recommendation: "Neurosurgical consultation advised.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      source: "quick-select",
      id: "undo-test",
    });
    expect(useWorkspace.getState().recommendationText).toContain("Neurosurgical");
    expect(store.undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(before.findings);
    expect(useWorkspace.getState().impressionText).toBe(before.impression);
    expect(useWorkspace.getState().recommendationText).toBe(before.recommendation);
  });

  it("collectPathologyRecommendationChips dedupes active patch advice", () => {
    const chips = collectPathologyRecommendationChips([
      { lastRendered: { recommendation: "Clinical correlation advised." } },
      { lastRendered: { recommendation: "Clinical correlation advised." } },
      { lastRendered: { recommendation: "Follow-up in 6 weeks." } },
    ]);
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain("Clinical correlation");
  });

  it("mergeRecommendationChipLists prefers server chips and adds pathology", () => {
    const merged = mergeRecommendationChipLists(
      ["Clinical correlation is recommended."],
      ["Follow-up imaging is advised.", "Clinical correlation is recommended."],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]).toContain("Clinical correlation is recommended");
  });

  it("ledger patches expose recommendation for chip collection", () => {
    const store = useWorkspace.getState();
    store.applyPathologyOverlay({
      incoming: {
        findings: "Mass.",
        recommendation: "Biopsy recommended.",
      },
      templates: { findings: "Mass.", recommendation: "Biopsy recommended." },
      ownership: { conflictGroup: "mass" },
      source: "quick-findings",
      id: "bio-1",
    });
    const chips = collectPathologyRecommendationChips(
      useWorkspace.getState().appliedPathologyPatches,
    );
    expect(chips.some((c) => c.includes("Biopsy"))).toBe(true);
  });
});
