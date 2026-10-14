import { describe, it, expect } from "vitest";
import {
  runQualityEngine,
  textParityScorer,
  toQualityReportDTO,
  RULE_CATALOG,
  RULE_CATALOG_VERSION,
  evaluateTextTier,
  significanceOfRule,
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

  it("every entry is classified, and classified into one of the two declared values", () => {
    for (const entry of Object.values(RULE_CATALOG)) {
      expect(["high", "advisory"]).toContain(entry.significance);
    }
  });

  /**
   * The clinical-significance ratchet. Both directions matter: it catches a new
   * rule shipped unclassified (the field is required, so the compiler catches
   * that too, but this catches a classification nobody intended) and it catches
   * a quiet reclassification. 17 high / 13 advisory is the census of the whole
   * catalogue at 1.4.0 — a change to these lists is a clinical policy change and
   * must be a visible diff, not a side effect of editing a rule.
   */
  const HIGH_SIGNIFICANCE = [
    "Q103", "Q104", "Q107", "Q109", "Q110", "Q111", "Q112", "Q113", "Q114",
    "Q116", "Q117", "Q118", "Q119", "Q120", "Q121", "Q122", "Q123",
  ];
  const ADVISORY_SIGNIFICANCE = [
    "Q001", "Q002", "Q003", "Q004", "Q005", "Q006", "Q007",
    "Q101", "Q102", "Q105", "Q106", "Q108", "Q115",
  ];

  it("the high-significance set is exactly these 17 ids", () => {
    const high = Object.values(RULE_CATALOG)
      .filter((e) => e.significance === "high")
      .map((e) => e.id)
      .sort();
    expect(high).toEqual(HIGH_SIGNIFICANCE);
  });

  it("the advisory set is exactly these 13 ids, and the two sets cover the catalogue", () => {
    const advisory = Object.values(RULE_CATALOG)
      .filter((e) => e.significance === "advisory")
      .map((e) => e.id)
      .sort();
    expect(advisory).toEqual(ADVISORY_SIGNIFICANCE);
    expect(HIGH_SIGNIFICANCE.length + ADVISORY_SIGNIFICANCE.length).toBe(Object.keys(RULE_CATALOG).length);
  });

  it("significanceOfRule reads the same classification by id or by canonical id", () => {
    expect(significanceOfRule("Q104")).toBe("high");
    expect(significanceOfRule("Q001")).toBe("advisory");
    expect(significanceOfRule(RULE_CATALOG.Q104.canonicalId)).toBe("high");
    expect(significanceOfRule(RULE_CATALOG.Q001.canonicalId)).toBe("advisory");
  });

  it("significanceOfRule returns null for an id it does not know — never a default", () => {
    // A caller that reads null as "advisory" would silently bury every future
    // rule, and would bury the structured tier, whose ids are not in this
    // catalogue at all. null means "nobody declared this", which is not the same
    // statement as "this is prose".
    expect(significanceOfRule("Q999")).toBeNull();
    expect(significanceOfRule("care.structured.consistency.study-modality.mr")).toBeNull();
    expect(significanceOfRule("")).toBeNull();
  });

  it("classifying a rule does not change what it can do — severity and tier are untouched", () => {
    // The point of the significance field is that it is inert. All 17 high rules
    // are still warning/heuristic, so `isHardBlockingFinding` (blocker AND
    // structured) is still false for every one of them and no text finding can
    // reach the finalize blocker list. If this test ever fails, the classification
    // has started enforcing signing, which is a policy decision this PR does not
    // have the authority to make.
    for (const id of HIGH_SIGNIFICANCE) {
      expect(RULE_CATALOG[id as keyof typeof RULE_CATALOG].defaultSeverity).toBe("warning");
      expect(RULE_CATALOG[id as keyof typeof RULE_CATALOG].tier).toBe("heuristic");
    }
  });
});

describe("evaluateTextTier", () => {
  it("tags an empty report with the completeness rule ids in order", () => {
    // Q005 is absent, and that is the change. It used to read `!recommendation.trim()`
    // and so fired here too, on a report with nothing in it — the same unconditional
    // reading that marked up every normal study CARE's anti-filler policy had emptied
    // on purpose. An empty report states no plan, so the advice section owes nothing.
    // Score 30, not 25.
    const r = evaluateTextTier({ findings: "", impression: [] });
    expect(r.findings.map((f) => f.ruleId)).toEqual(["Q001", "Q002", "Q003", "Q004"]);
    expect(r.score).toBe(30);
  });

  it("Q005 is a dependency: a stated plan the advice section fails to carry", () => {
    const report = {
      findings: "Acute infarct in the right middle cerebral artery territory. No haemorrhage.",
      technique: "MRI brain with DWI and ADC sequences.",
      clinicalHistory: "Left-sided weakness for three hours.",
      impression: ["Acute right MCA territory infarct.", "Urgent stroke team review."],
      recommendation: "",
    };
    const ids = (r: ReturnType<typeof evaluateTextTier>) => r.findings.map((f) => f.ruleId);
    const q005 = (r: ReturnType<typeof evaluateTextTier>) =>
      r.findings.find((f) => f.ruleId === "Q005")?.message;

    const unmet = evaluateTextTier(report);
    expect(ids(unmet)).toContain("Q005");
    // The message names the plan, so the radiologist is told what is missing rather
    // than merely that a section is empty.
    expect(q005(unmet)).toContain("Urgent stroke team review.");
    expect(unmet.score).toBe(95);

    // Carried: the dependency is met and Q005 is silent.
    expect(ids(evaluateTextTier({ ...report, recommendation: "Admit to the stroke unit." }))).not.toContain("Q005");
  });

  it("Q005 stays silent where no advice is due — the four ways a plan is not a plan", () => {
    const ids = (impression: string[], recommendation = "") =>
      evaluateTextTier({
        findings: "No acute intracranial abnormality. No haemorrhage or infarct.",
        technique: "MRI brain with DWI and ADC sequences.",
        clinicalHistory: "Headache.",
        impression,
        recommendation,
      }).findings.map((f) => f.ruleId);

    // 1. A normal study. No advice is the correct answer, and this is the case the
    //    old unconditional reading marked up 7 times in 20 correct corpus reports.
    expect(ids(["No acute intracranial abnormality."])).not.toContain("Q005");
    // 2. A plan the same Impression withdraws — a decision NOT to act. Read through
    //    the shared denial vocabulary, so the negation is the canonical one.
    expect(ids(["No follow-up imaging recommended."])).not.toContain("Q005");
    // 3. A Findings-style negation that merely contains a plan verb. The dependency
    //    reads the Impression only, precisely because prose like this is a denial.
    expect(ids(["No restricted diffusion to suggest acute infarction."])).not.toContain("Q005");
    // 4. The anti-filler boilerplate the composer deletes on sight. Demanding it back
    //    would put the quality engine in opposition with the composer's own policy.
    expect(ids(["Clinical correlation is advised."])).not.toContain("Q005");
    expect(ids(["Clinical correlation advised."])).not.toContain("Q005");
  });

  it("Q005 still cannot block — the redefined rule keeps its advisory classification", () => {
    expect(RULE_CATALOG.Q005.defaultSeverity).toBe("warning");
    expect(RULE_CATALOG.Q005.tier).toBe("heuristic");
    expect(RULE_CATALOG.Q005.significance).toBe("advisory");
    expect(significanceOfRule("Q005")).toBe("advisory");
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
