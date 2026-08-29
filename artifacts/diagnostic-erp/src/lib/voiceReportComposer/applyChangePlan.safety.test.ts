import { describe, expect, it, beforeEach } from "vitest";
import {
  applyChangePlan,
  buildChangePreview,
  detectProtectedConflicts,
} from "./applyChangePlan";
import { provenanceFromText } from "../reportFieldMerge";
import { deterministicCompose } from "../../../../api-server/src/lib/voiceReportComposer/composer";
import { DEFAULT_REPORT_FORMATS } from "../zai-workspace/report-formats-library";
import { useWorkspace } from "../zai-workspace/store";

const normalLs = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI LS Spine — Normal")!;
const normalBrain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;

describe("voiceReportComposer applyChangePlan — safety hardening", () => {
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

  it("manual Quick Select edit blocks apply and surfaces conflict in preview", () => {
    const qsSentence = "L4-L5 disc is normal per Quick Select.";
    const prov = { findings: provenanceFromText(qsSentence, "quick-findings") };
    const plan = {
      operation: "report_change_plan" as const,
      observations: [{
        concept: "disc_bulge",
        findingsText: "Diffuse disc bulge at L4-L5.",
        baselineReplaces: "L4-L5 disc is normal",
        anatomicalSection: "disc",
        conflictGroup: "disc",
      }],
      uncertainties: [],
    };
    const narrative = {
      clinicalHistory: "",
      technique: normalLs.technique,
      findings: `${normalLs.findings}\n${qsSentence}`,
      impression: normalLs.impression,
      recommendation: normalLs.recommendation,
    };
    const conflicts = detectProtectedConflicts(plan, narrative.findings, prov.findings);
    expect(conflicts.length).toBeGreaterThan(0);

    const result = applyChangePlan({ narrative, provenance: prov, plan });
    expect(result.ok).toBe(false);
    expect(result.conflicts?.length).toBeGreaterThan(0);

    const preview = buildChangePreview({ narrative, provenance: prov, plan });
    expect(preview.hasConflicts).toBe(true);
    expect(preview.conflicts.length).toBeGreaterThan(0);
  });

  it("multi-level desiccation does not cross-replace levels", () => {
    const plan = deterministicCompose({
      transcript: "Disc desiccation at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/L3-L4/);
    expect(result.narrative!.findings).toMatch(/L4-L5/);
  });

  it("correction update replaces observation not duplicates", () => {
    const prior = [{
      id: "obs1",
      concept: "disc_bulge",
      level: "L4-L5",
      findingsText: "Diffuse disc bulge at L4-L5.",
      operation: "add" as const,
    }];
    const plan = deterministicCompose({
      transcript: "correction L3-4",
      region: "LS Spine",
      findingsText: "Diffuse disc bulge at L4-L5.",
      priorObservations: prior,
    })!;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: "Diffuse disc bulge at L4-5.",
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
      activeObservations: prior,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/L3-4/i);
    expect(result.narrative!.findings.match(/L4-5/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("one Apply with multiple observations = one atomic undo (findings + impression + provenance + voice state)", () => {
    const beforeFindings = useWorkspace.getState().findingsText;
    const beforeImpression = useWorkspace.getState().impressionText;
    const beforeProv = { ...useWorkspace.getState().fieldProvenance };

    const plan = deterministicCompose({
      transcript: "Loss of lumbar lordosis. Disc desiccation at L3-4 and L4-5.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    plan.impressionUpdate = "Loss of lumbar lordosis with disc desiccation.";

    const status = useWorkspace.getState().applyVoiceComposerPlan(plan, "test transcript");
    expect(status).toBe("applied");
    expect(useWorkspace.getState().findingsText).not.toBe(beforeFindings);
    expect(useWorkspace.getState().voiceComposerObservations.length).toBeGreaterThan(0);

    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(beforeFindings);
    expect(useWorkspace.getState().impressionText).toBe(beforeImpression);
    expect(useWorkspace.getState().fieldProvenance).toEqual(beforeProv);
    expect(useWorkspace.getState().voiceComposerObservations).toEqual([]);
    expect(useWorkspace.getState().voiceComposerTranscriptHistory).toEqual([]);
  });

  it("brain abnormal finding preserves unrelated normal anatomy", () => {
    const plan = deterministicCompose({
      transcript: "Few punctate white matter hyperintense lesions Fazekas grade 1.",
      region: "Brain",
      findingsText: normalBrain.findings,
    });
    if (!plan) return;
    const result = applyChangePlan({
      narrative: {
        clinicalHistory: "",
        technique: normalBrain.technique,
        findings: normalBrain.findings,
        impression: normalBrain.impression,
        recommendation: normalBrain.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(result.ok).toBe(true);
    expect(result.narrative!.findings).toMatch(/ventric/i);
  });

  it("preview shows untouched unrelated normals", () => {
    const plan = deterministicCompose({
      transcript: "Loss of lumbar lordosis.",
      region: "LS Spine",
      findingsText: normalLs.findings,
    })!;
    const preview = buildChangePreview({
      narrative: {
        clinicalHistory: "",
        technique: normalLs.technique,
        findings: normalLs.findings,
        impression: normalLs.impression,
        recommendation: normalLs.recommendation,
      },
      provenance: {},
      plan,
    });
    expect(preview.untouched.some((u) => /Conus|paraspinal|Sacroiliac/i.test(u))).toBe(true);
    expect(preview.adds.length).toBeGreaterThan(0);
  });
});
