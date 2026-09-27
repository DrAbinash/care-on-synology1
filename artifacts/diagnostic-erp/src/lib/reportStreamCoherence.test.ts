/**
 * One report stream: the billed exam's normal format owns technique,
 * findings, impression, and recommendation together. A finding that carries
 * its own recommendation writes that sentence into the same box.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { reportBodyAllowsNormalBootstrap } from "./zai-workspace/fullReportFormat";
import {
  billedStudyContextForNormal,
  quickNormalOutcomeMessage,
  resolveNormalBootstrapFormat,
} from "./zai-workspace/normalBootstrap";
import { alignRecommendationToObservations } from "./impressionRecommendationWiring";
import { provenanceFromText } from "./reportFieldMerge";
import { buildReportingStudyContext } from "./reportingStudyContext";

const BRAIN = buildReportingStudyContext({
  modality: "MR",
  studyDescription: "MRI BRAIN PLAIN",
  regions: ["Brain"],
  source: "auto",
});

describe("report stream — one normal document", () => {
  it("folds the billed test name into the format decision", () => {
    const next = billedStudyContextForNormal(BRAIN, "MRI Brain with contrast");
    expect(next.studyDescription?.toLowerCase()).toContain("contrast");
    expect(next.region).toBe(BRAIN.region);
    expect(billedStudyContextForNormal(next, "contrast").studyDescription).toBe(next.studyDescription);
  });

  it("tells the radiologist when Quick Normal cannot pick one report", () => {
    expect(quickNormalOutcomeMessage(null).title).toMatch(/not identified/i);
    expect(quickNormalOutcomeMessage({ status: "no-match", reason: "x" }).title).toMatch(/No normal report/i);
    expect(quickNormalOutcomeMessage({ status: "ambiguous", reason: "x" }).title).toMatch(/More than one/i);
    const decision = resolveNormalBootstrapFormat({ ctx: BRAIN, formats: DEFAULT_REPORT_FORMATS });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(quickNormalOutcomeMessage(decision).description).toMatch(/Technique, findings, impression, and recommendation/i);
    }
  });

  it("lets protocol and template autofill be replaced, and keeps typed text", () => {
    expect(reportBodyAllowsNormalBootstrap({
      technique: "",
      findings: "",
      impression: "",
      recommendation: "",
    })).toBe(true);
    expect(reportBodyAllowsNormalBootstrap({
      technique: "Protocol technique.",
      findings: "",
      impression: "",
      recommendation: "Please correlate with clinical findings.",
      fieldProvenance: {
        technique: provenanceFromText("Protocol technique.", "protocol"),
        recommendation: provenanceFromText("Please correlate with clinical findings.", "template"),
      },
    })).toBe(true);
    expect(reportBodyAllowsNormalBootstrap({
      technique: "",
      findings: "I dictated this.",
      impression: "",
      recommendation: "",
      fieldProvenance: { findings: provenanceFromText("I dictated this.", "manual") },
    })).toBe(false);
    expect(reportBodyAllowsNormalBootstrap({
      technique: "AI technique.",
      findings: "",
      impression: "",
      recommendation: "",
      fieldProvenance: { technique: provenanceFromText("AI technique.", "ai-draft") },
    })).toBe(false);
    expect(reportBodyAllowsNormalBootstrap({
      technique: "Untracked technique.",
      findings: "",
      impression: "",
      recommendation: "",
      fieldProvenance: {},
    })).toBe(false);
  });
});

describe("report stream — recommendation follows the finding", () => {
  it("adds an observation recommendation that never reached the box", () => {
    const aligned = alignRecommendationToObservations({
      current: "Clinical correlation. Follow-up as clinically indicated.",
      provenance: provenanceFromText("Clinical correlation. Follow-up as clinically indicated.", "template"),
      patches: [{
        source: "quick-findings",
        lastRendered: { recommendation: "Urgent neurosurgical consultation for neurological deficit." },
      }],
    });
    expect(aligned.changed).toBe(true);
    expect(aligned.text).toContain("Clinical correlation.");
    expect(aligned.text).toContain("Follow-up as clinically indicated.");
    expect(aligned.text).toContain("Urgent neurosurgical consultation for neurological deficit.");
  });

  it("leaves a normal-format recommendation alone when no finding owns one", () => {
    const current = "Clinical correlation. Follow-up as clinically indicated.";
    const aligned = alignRecommendationToObservations({
      current,
      provenance: provenanceFromText(current, "template"),
      patches: [{ source: "quick-findings", lastRendered: { recommendation: "" } }],
    });
    expect(aligned.changed).toBe(false);
    expect(aligned.text).toBe(current);
  });

  it("keeps a sentence the radiologist typed", () => {
    const typed = "Call the ward if new deficit appears.";
    const aligned = alignRecommendationToObservations({
      current: typed,
      provenance: provenanceFromText(typed, "manual"),
      patches: [{
        source: "abnormal-pattern",
        lastRendered: { recommendation: "Urgent neurosurgical consultation for neurological deficit." },
      }],
    });
    expect(aligned.text).toContain(typed);
    expect(aligned.text).toContain("Urgent neurosurgical consultation for neurological deficit.");
  });
});

describe("report stream — store", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      lastPatchSnapshot: null,
      patchUndoStack: [],
      confirmOverwriteOpen: false,
      pendingFormatIds: [],
      pendingPathologyPatch: null,
      selectedFormatIds: [],
      reportFormats: DEFAULT_REPORT_FORMATS,
      reportingContext: BRAIN,
      isFinalized: false,
      appliedFormatName: null,
      appliedFormatReportTitle: null,
      startingCanvasBaseline: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces protocol autofill with the exam normal, then keeps finding advice in recommendation", () => {
    const store = useWorkspace.getState();
    store.setField("technique", "Short protocol technique.", "protocol");
    store.setField("recommendation", "Please correlate with clinical findings.", "template");
    const before = useWorkspace.getState();
    expect(reportBodyAllowsNormalBootstrap({
      technique: before.techniqueText,
      findings: before.findingsText,
      impression: before.impressionText,
      recommendation: before.recommendationText,
      fieldProvenance: before.fieldProvenance,
    })).toBe(true);

    const decision = resolveNormalBootstrapFormat({ ctx: BRAIN, formats: DEFAULT_REPORT_FORMATS });
    expect(decision?.status).toBe("apply");
    if (decision?.status !== "apply") return;
    useWorkspace.getState().applyFormatById(decision.format.id);
    const formatted = useWorkspace.getState();
    expect(formatted.confirmOverwriteOpen).toBe(false);
    expect(formatted.techniqueText).toBe(decision.format.technique);
    expect(formatted.findingsText).toBe(decision.format.findings);
    expect(formatted.impressionText).toBe(decision.format.impression);
    expect(formatted.recommendationText).toBe(decision.format.recommendation);
    expect(formatted.techniqueText).not.toContain("Short protocol technique.");

    const advice = "Urgent neurosurgical consultation for neurological deficit.";
    const status = useWorkspace.getState().applyPathologyOverlay({
      id: "stream-hemorrhage",
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
        recommendation: advice,
      },
      templates: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
        recommendation: advice,
      },
      ownership: {
        anatomicalSection: "basal ganglia",
        conflictGroup: "hemorrhage",
        concept: "hemorrhage",
      },
      source: "quick-findings",
      region: "Brain",
      concept: "hemorrhage",
      label: "Hemorrhage",
      findingsText: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
    });
    expect(status).toBe("applied");
    const withFinding = useWorkspace.getState();
    expect(withFinding.findingsText.toLowerCase()).toContain("hemorrhage");
    expect(withFinding.impressionText.toLowerCase()).toContain("hemorrhage");
    expect(withFinding.recommendationText).toContain(advice);
    if (decision.format.recommendation.trim()) {
      expect(withFinding.recommendationText).toContain(decision.format.recommendation.trim());
    }

    useWorkspace.getState().removeObservation("stream-hemorrhage");
    const cleared = useWorkspace.getState();
    expect(cleared.recommendationText).not.toContain(advice);
    if (decision.format.recommendation.trim()) {
      expect(cleared.recommendationText).toContain(decision.format.recommendation.trim());
    }
  });
});
