import { describe, it, expect } from "vitest";
import {
  composeFinalizeQualityGate,
  computeUnresolvedBlockers,
  isHardBlockingFinding,
  stampEvaluationId,
  buildWorkspaceQualityRequest,
  type CanonicalQualityFinding,
  type QualityOverrideRow,
} from "./reportQualityFinalize";

describe("reportQualityFinalize", () => {
  it("only structured-tier blockers are hard blocking", () => {
    expect(isHardBlockingFinding({ ruleId: "a", severity: "blocker", tier: "structured", message: "x" })).toBe(true);
    expect(isHardBlockingFinding({ ruleId: "b", severity: "blocker", tier: "heuristic", message: "x" })).toBe(false);
    expect(isHardBlockingFinding({ ruleId: "c", severity: "warning", tier: "structured", message: "x" })).toBe(false);
  });

  it("computeUnresolvedBlockers respects override history by ruleId", () => {
    const findings: CanonicalQualityFinding[] = [
      { ruleId: "S1", severity: "blocker", tier: "structured", message: "blocked", evaluationId: 10 },
      { ruleId: "Q001", severity: "warning", tier: "heuristic", message: "warn" },
    ];
    const overrides: QualityOverrideRow[] = [
      { id: 1, evaluationId: 10, ruleId: "S1", reason: "clinically acceptable", action: "override" },
    ];
    expect(computeUnresolvedBlockers(findings, overrides)).toEqual([]);
    expect(computeUnresolvedBlockers(findings, [])).toHaveLength(1);
  });

  it("composeFinalizeQualityGate merges text + structured findings", () => {
    const gate = composeFinalizeQualityGate(
      {
        evaluationId: 1,
        shadowStructuredEvaluationId: 2,
        score: 80,
        blockingCount: 0,
        warningCount: 2,
        infoCount: 0,
        findings: [{ ruleId: "Q001", severity: "warning", tier: "heuristic", message: "missing findings" }],
      },
      [{ ruleId: "M1", severity: "blocker", tier: "structured", message: "measurement missing" }],
      [],
    );
    expect(gate.findings).toHaveLength(2);
    expect(gate.findings[0].evaluationId).toBe(1);
    expect(gate.findings[1].evaluationId).toBe(2);
    expect(gate.unresolvedBlockers).toHaveLength(1);
    expect(gate.advisoryFindings).toHaveLength(1);
  });

  it("buildWorkspaceQualityRequest maps workspace fields", () => {
    const req = buildWorkspaceQualityRequest({
      draftId: 42,
      modality: "MR",
      studyDescription: "MRI BRAIN",
      findings: "Normal",
      impression: "No acute abnormality",
      checklistPercent: 90,
    });
    expect(req.reportDraftId).toBe(42);
    expect(req.source).toBe("workspace-finalize");
    expect(req.text.impression).toEqual(["No acute abnormality"]);
    expect(req.text.checklistPercent).toBe(90);
  });

  it("stampEvaluationId attaches parent evaluation id", () => {
    const stamped = stampEvaluationId([{ ruleId: "Q1", severity: "warning", message: "x" }], 99);
    expect(stamped[0].evaluationId).toBe(99);
  });
});
