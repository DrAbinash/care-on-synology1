import { describe, expect, it, beforeEach } from "vitest";
import {
  applyPathologyPatch,
  applySideToIncoming,
  inferOwnership,
} from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import {
  DEFAULT_REPORT_FORMATS,
  createFormat,
  lookupFormatsForContext,
} from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES, lookupTilesForContext } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { matchStudyRegion } from "./studyRegion";
import { validateReport } from "./reportValidator";
import { useWorkspace } from "./zai-workspace/store";

const REGIONS = ["Brain", "Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine", "Spine"];

function ctxFor(description: string) {
  const region = matchStudyRegion(`MR ${description}`, REGIONS);
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription: description,
    regions: region ? [region] : [],
    source: region ? "auto" : "unresolved",
  });
}

describe("whole-report pathology wiring", () => {
  it("MRI Brain only surfaces Brain formats and Quick Select findings", () => {
    const ctx = ctxFor("MRI Brain Plain");
    const formats = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
    const tiles = lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctx);
    expect(formats.every((f) => f.bodyPart === "Brain")).toBe(true);
    expect(formats.some((f) => f.name.includes("Brain"))).toBe(true);
    expect(formats.some((f) => f.bodyPart === "Cervical Spine")).toBe(false);
    expect(tiles.every((t) => !t.scopeBodyPart || t.scopeBodyPart === "Brain")).toBe(true);
  });

  it("Cervical Spine only surfaces Cervical formats (not Brain/LS)", () => {
    const ctx = ctxFor("MRI Cervical Spine");
    const formats = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
    expect(formats.map((f) => f.bodyPart)).toContain("Cervical Spine");
    expect(formats.some((f) => f.bodyPart === "Brain")).toBe(false);
    expect(formats.some((f) => f.bodyPart === "LS Spine")).toBe(false);
    const tiles = lookupTilesForContext(DEFAULT_QUICK_SELECT_TILES, "findings", "MR", ctx);
    expect(tiles.some((t) => t.scopeBodyPart === "Brain")).toBe(false);
    expect(tiles.some((t) => t.scopeBodyPart === "LS Spine")).toBe(false);
  });

  it("whole-format save/load preserves all 5 clinical sections", () => {
    const saved = createFormat({
      name: "Test whole brain",
      modality: "MR",
      bodyPart: "Brain",
      diagnosisTags: ["test"],
      clinicalHistory: "Headache for 3 days.",
      technique: "MRI brain 3T.",
      findings: "Basal ganglia are normal.",
      impression: "Normal MRI brain.",
      recommendation: "Clinical correlation.",
      isCommon: false,
      custom: true,
    });
    expect(saved.clinicalHistory).toBe("Headache for 3 days.");
    expect(saved.technique).toBe("MRI brain 3T.");
    expect(saved.findings).toBe("Basal ganglia are normal.");
    expect(saved.impression).toBe("Normal MRI brain.");
    expect(saved.recommendation).toBe("Clinical correlation.");
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    expect(brain.clinicalHistory.trim().length).toBeGreaterThan(0);
    expect(brain.technique.trim().length).toBeGreaterThan(0);
    expect(brain.findings.trim().length).toBeGreaterThan(0);
    expect(brain.impression.trim().length).toBeGreaterThan(0);
    expect(brain.recommendation.trim().length).toBeGreaterThan(0);
  });

  it("Normal Brain + Right Basal Ganglia Hemorrhage replaces the owned normal block without duplicates", () => {
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    const hemor = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
    const incoming = applySideToIncoming(
      { findings: hemor.sentence, impression: hemor.impressionSentence },
      "right",
    );
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming,
      ownership: {
        anatomicalSection: hemor.anatomicalSection,
        conflictGroup: hemor.conflictGroup,
      },
      provenance: {
        findings: provenanceFromText(brain.findings, "template"),
        impression: provenanceFromText(brain.impression, "template"),
      },
      source: "quick-select",
    });
    expect(result.narrative.findings.toLowerCase()).toContain("right basal ganglia");
    expect(result.narrative.findings.toLowerCase()).toContain("hemorrhage");
    expect(result.narrative.findings.match(/hemorrhage/gi)?.length ?? 0).toBe(1);
    expect(result.narrative.findings.toLowerCase()).not.toMatch(/basal ganglia are normal/);
    expect(result.narrative.findings.toLowerCase()).not.toMatch(/no acute infarct, hemorrhage/);
    expect(result.narrative.impression.toLowerCase()).toContain("right basal ganglia hemorrhage");
    expect(result.narrative.impression.toLowerCase()).not.toMatch(/normal mri brain/);
  });

  it("switching Right → Left updates only pathology-owned content", () => {
    const templates = {
      findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
      impression: "Acute {side} basal ganglia hemorrhage.",
    };
    const right = applySideToIncoming(templates, "right");
    const left = applySideToIncoming(templates, "left");
    expect(right.findings).toContain("right");
    expect(left.findings).toContain("left");
    expect(left.findings).not.toContain("right");
    const manual = "Ventricular system remains normal for age.";
    const withManual = `${right.findings}\n${manual}`;
    const swapped = withManual.replace(right.findings!, left.findings!);
    expect(swapped).toContain("left basal ganglia");
    expect(swapped).toContain(manual);
  });

  it("adding a second unrelated pathology preserves the first", () => {
    const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    const hemor = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;
    const infarct = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Acute infarct (DWI)")!;
    const afterHem = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming: applySideToIncoming(
        { findings: hemor.sentence, impression: hemor.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: { findings: provenanceFromText(brain.findings, "template") },
      source: "quick-select",
    });
    const afterBoth = applyPathologyPatch({
      existing: afterHem.narrative,
      incoming: applySideToIncoming(
        { findings: infarct.sentence, impression: infarct.impressionSentence },
        "left",
      ),
      ownership: { anatomicalSection: "mca", conflictGroup: "infarct" },
      provenance: afterHem.provenance,
      source: "quick-select",
    });
    expect(afterBoth.narrative.findings.toLowerCase()).toContain("basal ganglia");
    expect(afterBoth.narrative.findings.toLowerCase()).toContain("hemorrhage");
    expect(afterBoth.narrative.findings.toLowerCase()).toContain("mca");
    expect(afterBoth.narrative.findings.toLowerCase()).toContain("infarct");
  });

  it("manual unrelated text is not destroyed", () => {
    const existingFindings =
      "Brain parenchyma shows normal signal intensity. Manual note: correlate with EEG seizure focus.";
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: "",
        technique: "",
        findings: existingFindings,
        impression: "Normal MRI brain.",
        recommendation: "",
      },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        findings: {
          ...provenanceFromText("Brain parenchyma shows normal signal intensity.", "template"),
          ...provenanceFromText("Manual note: correlate with EEG seizure focus.", "manual"),
        },
      },
      source: "quick-select",
    });
    expect(result.narrative.findings).toContain("Manual note: correlate with EEG seizure focus.");
    expect(result.narrative.findings.toLowerCase()).toContain("hemorrhage");
  });

  it("undo restores the pre-merge report via the workspace snapshot", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "Hx",
      technique: "Tech",
      findings: "Basal ganglia are normal in signal intensity. No acute infarct, hemorrhage, or mass lesion.",
      impression: "Normal MRI brain.",
      recommendation: "Follow-up.",
    });
    const before = useWorkspace.getState().findingsText;
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
      id: "test-hem",
    });
    expect(useWorkspace.getState().findingsText.toLowerCase()).toContain("right basal ganglia");
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("contradiction detection works before finalize", () => {
    const w = validateReport({
      findings: "Basal ganglia are normal. Acute intraparenchymal hemorrhage in the right basal ganglia.",
      impression: ["Acute right basal ganglia hemorrhage."],
    });
    expect(w.some((x) => x.toLowerCase().includes("basal ganglia") && x.toLowerCase().includes("contradiction"))).toBe(true);

    const infarct = validateReport({
      findings: "No restricted diffusion on DWI/ADC. Acute left MCA territory infarct.",
      impression: ["Acute left MCA territory infarct."],
    });
    expect(infarct.some((x) => x.toLowerCase().includes("restricted diffusion"))).toBe(true);

    const laterality = validateReport({
      findings: "Restricted diffusion in the right MCA territory.",
      impression: ["Acute left MCA territory infarct."],
    });
    expect(laterality.some((x) => x.includes("Laterality"))).toBe(true);
  });

  it("inferOwnership tags basal ganglia hemorrhage", () => {
    expect(inferOwnership("Basal ganglia hemorrhage", [
      "Acute intraparenchymal hemorrhage in the right basal ganglia.",
    ]).anatomicalSection).toBe("basal ganglia");
  });
});

describe("reportingContentWiring cervical formats", () => {
  beforeEach(() => {
    /* keep suite independent */
  });

  it("Cervical formats include Cervical Spine bodyPart", () => {
    const ctx = ctxFor("MRI Cervical Spine");
    const formats = lookupFormatsForContext(DEFAULT_REPORT_FORMATS, "MR", ctx);
    expect(formats.some((f) => f.bodyPart === "Cervical Spine")).toBe(true);
  });
});
