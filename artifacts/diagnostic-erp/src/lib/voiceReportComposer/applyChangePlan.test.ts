import { describe, expect, it, beforeEach } from "vitest";
import { applyChangePlan } from "./applyChangePlan";
import { provenanceFromText } from "../reportFieldMerge";
import { DEFAULT_REPORT_FORMATS } from "../zai-workspace/report-formats-library";
import { useWorkspace } from "../zai-workspace/store";

const normalLs = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;

describe("voiceReportComposer applyChangePlan", () => {
  beforeEach(() => {
    useWorkspace.setState({
      clinicalHistoryText: "",
      techniqueText: normalLs.technique,
      findingsText: normalLs.findings,
      impressionText: normalLs.impression,
      recommendationText: normalLs.recommendation,
      fieldProvenance: {},
      voiceComposerObservations: [],
      voiceComposerTranscriptHistory: [],
      lastPatchSnapshot: null,
      isDirty: false,
    });
  });

  it("dictated abnormality replaces conflicting normal baseline", () => {
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan: {
        operation: "report_change_plan",
        observations: [{
          concept: "disc_bulge",
          level: "L4-L5",
          findingsText: "Diffuse disc bulge at L4-L5 indenting the anterior thecal sac.",
          anatomicalSection: "disc",
          conflictGroup: "disc",
          baselineReplaces: "Disc spaces are maintained",
        }],
        uncertainties: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/bulge/i);
    expect(result.narrative!.findings).not.toMatch(/Disc spaces are maintained/);
    expect(result.narrative!.findings).toMatch(/marrow signal/i);
  });

  it("unrelated normal anatomy survives", () => {
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan: {
        operation: "report_change_plan",
        observations: [{
          concept: "lordosis",
          findingsText: "Loss of lumbar lordosis.",
          anatomicalSection: "alignment",
          conflictGroup: "lumbar_alignment",
          baselineReplaces: "normal alignment",
        }],
        uncertainties: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/lordosis/i);
    expect(result.narrative!.findings).toMatch(/Conus medullaris/i);
  });

  it("two sequential dictations accumulate via activeObservations", () => {
    const first = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan: {
        operation: "report_change_plan",
        observations: [{
          id: "obs1",
          concept: "desiccation",
          level: "L3-L4",
          findingsText: "Disc desiccation at L3-L4.",
          anatomicalSection: "disc",
          conflictGroup: "disc_L3-L4",
        }],
        uncertainties: [],
      },
    });
    const second = applyChangePlan({
      narrative: first.narrative!,
      provenance: first.provenance!,
      plan: {
        operation: "report_change_plan",
        observations: [{
          id: "obs2",
          concept: "desiccation",
          level: "L4-L5",
          findingsText: "Disc desiccation at L4-L5.",
          anatomicalSection: "disc",
          conflictGroup: "disc_L4-L5",
        }],
        uncertainties: [],
      },
      activeObservations: first.activeObservations,
    });
    expect(second.narrative!.findings).toMatch(/L3-L4/);
    expect(second.narrative!.findings).toMatch(/L4-L5/);
  });

  it("undo restores exact previous report via store", () => {
    const before = useWorkspace.getState().findingsText;
    const status = useWorkspace.getState().applyVoiceComposerPlan({
      operation: "report_change_plan",
      observations: [{
        concept: "lordosis",
        findingsText: "Loss of lumbar lordosis.",
        anatomicalSection: "alignment",
        conflictGroup: "lumbar_alignment",
      }],
      uncertainties: [],
    }, "Loss of lumbar lordosis.");
    expect(status).toBe("applied");
    expect(useWorkspace.getState().findingsText).not.toBe(before);
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("malformed plan blocked at clarification", () => {
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan: {
        operation: "report_change_plan",
        observations: [],
        uncertainties: [],
        clarificationRequired: "Which level?",
      },
    });
    expect(result.ok).toBe(false);
  });

  it("explicit manual finding cannot be overwritten", () => {
    const manualSentence = "L4-L5 disc is normal — manually verified.";
    const prov = { findings: provenanceFromText(manualSentence, "manual") };
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: `${normalLs.findings}\n${manualSentence}`,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: prov,
      plan: {
        operation: "report_change_plan",
        observations: [{
          concept: "disc_bulge",
          findingsText: "Diffuse disc bulge at L4-L5.",
          baselineReplaces: "L4-L5 disc is normal",
          anatomicalSection: "disc",
          conflictGroup: "disc",
        }],
        uncertainties: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toContain(manualSentence);
  });
});
