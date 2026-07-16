import { describe, it, expect } from "vitest";
import {
  detectedFindings, buildCompanionSuggestions, buildLiveChecklist, computeReportConfidence,
  type SuggestionFinding,
} from "./usgCompanionSuggestions";

const f = (id: number, label: string, over: Partial<SuggestionFinding> = {}): SuggestionFinding => ({
  id, studyType: "KUB", label, suggests: "", questionsJson: "[]", isActive: true, ...over,
});

const FINDINGS: SuggestionFinding[] = [
  f(1, "Hydronephrosis", { suggests: "Renal Calculus, Ureteric Calculus", questionsJson: '[{"key":"side","label":"Side"},{"key":"grade","label":"Grade"}]' }),
  f(2, "Renal Calculus", { suggests: "Hydronephrosis" }),
  f(3, "Ureteric Calculus"),
];

describe("detectedFindings", () => {
  it("detects selected + text-present findings, skips inactive", () => {
    const det = detectedFindings(
      [...FINDINGS, f(4, "Old", { isActive: false })],
      [2],
      "Right kidney shows mild hydronephrosis.",
    );
    const labels = det.map((d) => d.label).sort();
    expect(labels).toEqual(["Hydronephrosis", "Renal Calculus"]);
  });
});

describe("buildCompanionSuggestions", () => {
  it("suggests co-occurring findings via `suggests` (deterministic, not hardcoded)", () => {
    const s = buildCompanionSuggestions({ findings: FINDINGS, region: "KUB", selectedIds: [], reportText: "gross hydronephrosis noted" });
    const co = s.filter((x) => x.kind === "cooccurrence").map((x) => x.label).sort();
    expect(co).toEqual(["Renal Calculus", "Ureteric Calculus"]);
    expect(s.find((x) => x.kind === "cooccurrence")?.sourceLabel).toBe("Hydronephrosis");
  });

  it("suggests structured follow-ups from questionsJson", () => {
    const s = buildCompanionSuggestions({ findings: FINDINGS, region: "KUB", selectedIds: [1], reportText: "" });
    const fu = s.find((x) => x.kind === "followup");
    expect(fu?.label).toContain("Side");
    expect(fu?.label).toContain("Grade");
  });

  it("does not suggest a finding already present in the report", () => {
    const s = buildCompanionSuggestions({ findings: FINDINGS, region: "KUB", selectedIds: [], reportText: "hydronephrosis and renal calculus seen" });
    expect(s.some((x) => x.kind === "cooccurrence" && x.label === "Renal Calculus")).toBe(false);
  });
});

describe("buildLiveChecklist", () => {
  it("marks core rows ok/pending/warn and appends missing/mismatch rows", () => {
    const items = buildLiveChecklist({
      templateSelected: true, protocolSelected: true, measurementsFound: 3, measurementsExpected: 5,
      historyPresent: false, findingsPresent: true, impressionPresent: false, recommendationPresent: true,
      missingMeasurements: ["GB wall thickness", "CBD diameter"], checklistRemaining: ["Appendix"], mismatches: ["Study type mismatch"],
    });
    expect(items.find((i) => i.key === "measurements")?.status).toBe("warn");
    expect(items.find((i) => i.key === "history")?.status).toBe("pending");
    expect(items.find((i) => i.key === "impression")?.status).toBe("warn");
    expect(items.some((i) => i.label === "GB wall thickness missing")).toBe(true);
    expect(items.some((i) => i.label === "Appendix not addressed")).toBe(true);
    expect(items.some((i) => i.label === "Study type mismatch")).toBe(true);
  });
});

describe("computeReportConfidence", () => {
  it("computes machine/clinical/report completeness and finalization readiness", () => {
    const c = computeReportConfidence({
      measurementsFound: 4, measurementsExpected: 8,
      findingsPresent: true, impressionPresent: true, recommendationPresent: true, techniquePresent: true,
      readinessScore: 75, locked: false, hasBlockingWarnings: false,
    });
    expect(c.machineCompleteness).toBe(50);
    expect(c.clinicalCompleteness).toBe(100);
    expect(c.reportCompleteness).toBe(75);
    expect(c.readyForFinalization).toBe(false); // machineCompleteness < 100
  });

  it("is ready only when complete, unlocked, no blocking warnings", () => {
    const c = computeReportConfidence({
      measurementsFound: 8, measurementsExpected: 8,
      findingsPresent: true, impressionPresent: true, recommendationPresent: true, techniquePresent: true,
      readinessScore: 100, locked: false, hasBlockingWarnings: false,
    });
    expect(c.readyForFinalization).toBe(true);
  });

  it("treats zero-expected measurements as complete (thyroid/breast)", () => {
    const c = computeReportConfidence({
      measurementsFound: 0, measurementsExpected: 0,
      findingsPresent: true, impressionPresent: true, recommendationPresent: false, techniquePresent: true,
      readinessScore: 60, locked: false, hasBlockingWarnings: false,
    });
    expect(c.machineCompleteness).toBe(100);
  });
});
