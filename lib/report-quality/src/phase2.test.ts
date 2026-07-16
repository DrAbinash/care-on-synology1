import { describe, it, expect } from "vitest";
import {
  runQualityEngine,
  textParityScorer,
  toQualityReportDTO,
  RULE_CATALOG,
  RULE_CATALOG_VERSION,
  evaluateTextTier,
  type QualityContext,
} from "./index";

function ctx(over: Partial<QualityContext["text"]> = {}, modality = "MR"): QualityContext {
  return {
    modality,
    studyDescription: "MRI BRAIN",
    text: { findings: "", impression: [], ...over },
  };
}

describe("rule catalog", () => {
  it("every entry's id matches its key and has valid metadata", () => {
    for (const [key, entry] of Object.entries(RULE_CATALOG)) {
      expect(entry.id).toBe(key);
      expect(["info", "warning", "blocker"]).toContain(entry.defaultSeverity);
      expect(["structured", "heuristic"]).toContain(entry.tier);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it("all Phase-2 text rules are advisory heuristic (never blockers)", () => {
    for (const entry of Object.values(RULE_CATALOG)) {
      expect(entry.tier).toBe("heuristic");
      expect(entry.defaultSeverity).toBe("warning");
    }
  });
});

describe("evaluateTextTier", () => {
  it("tags an empty report with the completeness rule ids in order", () => {
    const r = evaluateTextTier({ findings: "", impression: [] });
    expect(r.findings.map((f) => f.ruleId)).toEqual(["Q001", "Q002", "Q003", "Q004", "Q005"]);
    expect(r.score).toBe(25);
  });
});

describe("runQualityEngine — Phase 2 structured metadata", () => {
  it("stamps modality/study type, versioning, timing and tier counts", () => {
    const report = runQualityEngine(ctx({ findings: "", impression: [] }), {
      scorer: textParityScorer,
      now: (() => { let t = 0; return () => (t += 5); })(), // 0 then 5 → runtime 5ms
      evaluatedAtIso: "2026-01-01T00:00:00.000Z",
    });
    expect(report.ruleVersion).toBe(RULE_CATALOG_VERSION);
    expect(report.knowledgePackVersion).toBeNull();
    expect(report.evaluatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(report.runtimeMs).toBe(5);
    // Only the text executor runs → 1 evaluated heuristic rule, 0 deterministic.
    expect(report.evaluatedRuleCount).toBe(1);
    expect(report.heuristicRuleCount).toBe(1);
    expect(report.deterministicRuleCount).toBe(0);
    // Findings are self-describing.
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(f.modality).toBe("MR");
      expect(f.studyType).toBe("MRI BRAIN");
      expect(f.severity).toBe("warning");
      expect(f.ruleId).toMatch(/^Q\d{3}$/);
    }
  });

  it("never emits a blocker from the text tier", () => {
    const report = runQualityEngine(ctx({ findings: "x", impression: ["y"] }), { scorer: textParityScorer });
    expect(report.blockingCount).toBe(0);
  });
});

describe("toQualityReportDTO", () => {
  it("serializes findings structurally with identity and versioning", () => {
    const report = runQualityEngine(ctx({ findings: "", impression: [] }), {
      scorer: textParityScorer,
      evaluatedAtIso: "2026-01-01T00:00:00.000Z",
    });
    const dto = toQualityReportDTO(report, { reportDraftId: 42, source: "workspace", modality: "MR", studyType: "MRI BRAIN" });
    expect(dto.reportDraftId).toBe(42);
    expect(dto.source).toBe("workspace");
    expect(dto.engineVersion).toBe(report.engineVersion);
    expect(dto.ruleVersion).toBe(RULE_CATALOG_VERSION);
    expect(dto.findings[0].ruleId).toBe("Q001");
    // DTO exposes structured fields, never a rendered blob.
    expect(dto.findings[0]).toHaveProperty("category");
    expect(dto.findings[0]).toHaveProperty("tier");
    expect(dto.reportId).toBeNull();
  });
});
