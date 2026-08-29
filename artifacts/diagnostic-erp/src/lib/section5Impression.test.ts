/**
 * Section 5 — Impression wiring tests (Finding → Impression linkage).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyPathologyPatch,
  applySideToIncoming,
} from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";
import { validateReport } from "./reportValidator";
import {
  refreshImpressionFromObservations,
} from "./observationLedger";
import { buildReportingStudyContext } from "./reportingStudyContext";

const BRAIN = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
const HEMOR = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
const FAZEKAS2 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 2")!;
const SINUS = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Maxillary sinusitis")!;

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

describe("Section 5 — Impression", () => {
  beforeEach(() => resetWorkspace());

  it("1. normal whole report + owned pathology updates Findings + Impression", () => {
    const incoming = applySideToIncoming(
      { findings: HEMOR!.sentence, impression: HEMOR!.impressionSentence },
      "right",
    );
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: BRAIN.clinicalHistory,
        technique: BRAIN.technique,
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: BRAIN.recommendation,
      },
      incoming,
      ownership: {
        anatomicalSection: HEMOR!.anatomicalSection,
        conflictGroup: HEMOR!.conflictGroup,
        baselineReplaces: HEMOR!.baselineReplaces,
      },
      provenance: {
        findings: provenanceFromText(BRAIN.findings, "template"),
        impression: provenanceFromText(BRAIN.impression, "template"),
      },
      source: "quick-findings",
    });
    expect(result.narrative.findings.toLowerCase()).toContain("right basal ganglia");
    expect(result.narrative.impression.toLowerCase()).toContain("right basal ganglia hemorrhage");
  });

  it("2. contradictory normal Impression is removed", () => {
    const incoming = applySideToIncoming(
      { findings: HEMOR!.sentence, impression: HEMOR!.impressionSentence },
      "right",
    );
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: "",
      },
      incoming,
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: { impression: provenanceFromText(BRAIN.impression, "template") },
      source: "quick-select",
    });
    expect(result.narrative.impression.toLowerCase()).not.toMatch(/normal mri brain/);
    expect(result.narrative.impression.toLowerCase()).toContain("hemorrhage");
  });

  it("3. unrelated Impression survives", () => {
    const manual = "Incidental maxillary sinus mucosal thickening.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: `${BRAIN.impression}\n${manual}`,
        recommendation: "",
      },
      incoming: applySideToIncoming(
        { findings: HEMOR!.sentence, impression: HEMOR!.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        impression: {
          ...provenanceFromText(BRAIN.impression, "template"),
          ...provenanceFromText(manual, "manual"),
        },
      },
      source: "quick-select",
    });
    expect(result.narrative.impression).toContain(manual);
  });

  it("4. multiple unrelated Impression items coexist", () => {
    const afterHem = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: BRAIN.impression,
        recommendation: "",
      },
      incoming: applySideToIncoming(
        { findings: HEMOR!.sentence, impression: HEMOR!.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: { findings: provenanceFromText(BRAIN.findings, "template") },
      source: "quick-select",
    });
    const afterBoth = applyPathologyPatch({
      existing: afterHem.narrative,
      incoming: applySideToIncoming(
        { findings: FAZEKAS2!.sentence, impression: FAZEKAS2!.impressionSentence },
        "",
      ),
      ownership: { conflictGroup: "fazekas" },
      provenance: afterHem.provenance,
      source: "quick-select",
    });
    expect(afterBoth.narrative.impression.toLowerCase()).toContain("hemorrhage");
    expect(afterBoth.narrative.impression.toLowerCase()).toContain("fazekas");
    if (SINUS) {
      const afterThree = applyPathologyPatch({
        existing: afterBoth.narrative,
        incoming: applySideToIncoming(
          {
            findings: SINUS.sentence,
            impression: "Right maxillary sinusitis.",
          },
          "right",
        ),
        ownership: { conflictGroup: "sinus" },
        provenance: afterBoth.provenance,
        source: "quick-select",
      });
      expect(afterThree.narrative.impression.toLowerCase()).toContain("hemorrhage");
      expect(afterThree.narrative.impression.toLowerCase()).toContain("fazekas");
      expect(afterThree.narrative.impression.toLowerCase()).toMatch(/sinus|maxillary/);
    }
  });

  it("5. Right → Left updates untouched linked Impression via relateralize", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "",
      technique: "",
      findings: "Basal ganglia are normal.",
      impression: "Normal MRI brain.",
      recommendation: "",
    });
    store.applyPathologyOverlay({
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
        impression: "Acute {side} basal ganglia hemorrhage.",
      },
      templates: {
        findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
        impression: "Acute {side} basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      source: "quick-select",
      side: "right",
      id: "hem-1",
    });
    expect(useWorkspace.getState().impressionText.toLowerCase()).toContain("right");
    store.relateralizePatches("left");
    expect(useWorkspace.getState().impressionText.toLowerCase()).toContain("left");
    expect(useWorkspace.getState().impressionText.toLowerCase()).not.toContain("right");
  });

  it("6. manually edited linked Impression is preserved and marked stale", () => {
    const store = useWorkspace.getState();
    store.applyPathologyOverlay({
      incoming: {
        findings: FAZEKAS2!.sentence,
        impression: FAZEKAS2!.impressionSentence,
      },
      templates: {
        findings: FAZEKAS2!.sentence,
        impression: FAZEKAS2!.impressionSentence,
      },
      ownership: { conflictGroup: "fazekas" },
      source: "quick-select",
      id: "fz-1",
    });
    const edited = useWorkspace.getState().impressionText.replace("grade 2", "grade 2 — radiologist edit");
    store.setField("impression", edited);
    store.setField("findings", `${useWorkspace.getState().findingsText}\nExtra note.`);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(useWorkspace.getState().impressionText).toContain("radiologist edit");
  });

  it("7. severity mismatch triggers QA", () => {
    const w = validateReport({
      findings: "Moderate canal stenosis at L4-L5 with thecal sac indentation.",
      impression: ["Severe canal stenosis at L4-L5."],
    });
    expect(w.some((x) => x.toLowerCase().includes("severity"))).toBe(true);
  });

  it("8. generic manual Impression is never destroyed", () => {
    const manual = "Correlate with prior outside MRI from 2020.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: BRAIN.findings,
        impression: manual,
        recommendation: "",
      },
      incoming: applySideToIncoming(
        { findings: HEMOR!.sentence, impression: HEMOR!.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: { impression: provenanceFromText(manual, "manual") },
      source: "quick-select",
    });
    expect(result.narrative.impression).toContain(manual);
    expect(result.narrative.impression.toLowerCase()).toContain("hemorrhage");
  });

  it("refreshImpressionFromObservations rebuilds from ledger without wiping manual lines", () => {
    const manual = "Clinical correlation advised.";
    const refreshed = refreshImpressionFromObservations({
      currentImpression: `${FAZEKAS2!.impressionSentence}\n${manual}`,
      patches: [{
        id: "fz",
        observation: { id: "fz", concept: "fazekas", slotKey: "brain|fazekas||", role: "finding" } as never,
        templates: { findings: FAZEKAS2!.sentence, impression: FAZEKAS2!.impressionSentence },
        lastRendered: { findings: FAZEKAS2!.sentence, impression: FAZEKAS2!.impressionSentence },
        replacedBaseline: { findings: [], impression: [] },
        source: "quick-select",
        protected: false,
      }],
      remainingAbnormalLines: [],
      provenance: {
        ...provenanceFromText(FAZEKAS2!.impressionSentence!, "quick-findings"),
        ...provenanceFromText(manual, "manual"),
      },
    });
    expect(refreshed).toContain("Fazekas");
    expect(refreshed).toContain(manual);
  });
});
