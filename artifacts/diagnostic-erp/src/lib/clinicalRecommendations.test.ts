/**
 * clinicalRecommendations.test.ts — Clinical Recommendation Registry validation.
 *
 * Step-10 validation of the CDS PR: recommendations resolve correctly for
 * MRI/USG/CT/X-Ray, no duplicates, no conflicting advice, no orphan entries,
 * and the legacy Follow-Up database derives intact from the registry.
 */
import { describe, it, expect } from "vitest";
import {
  CLINICAL_RECOMMENDATION_REGISTRY,
  matchRecommendations,
  recommendationQuestions,
  legacyFollowUpDatabase,
} from "./clinicalRecommendations";
import { FOLLOW_UP_DATABASE, getFollowUp, searchFollowUp } from "./radiologyFollowUpEngine";
import { recommendationModuleItems } from "./copilotRecommendationModule";

const reg = CLINICAL_RECOMMENDATION_REGISTRY;
const base = { measurements: [], reportText: "", priorChanges: [] as { label: string; deltaText: string }[] };

describe("registry-driven recommendations — the spec's worked examples", () => {
  it("stone >6 mm → urology opinion", () => {
    const m = matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Stone size", value: 7, unit: "mm" }] });
    expect(m.some((x) => x.recommendation.id === "rec.ct.kub.stone-urology")).toBe(true);
  });
  it("midline shift >5 mm → urgent neurosurgical review (critical)", () => {
    const m = matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Midline shift", value: 6, unit: "mm" }] });
    const hit = m.find((x) => x.recommendation.id === "rec.ct.brain.midline-neurosurgery");
    expect(hit?.recommendation.severity).toBe("critical");
    expect(hit?.recommendation.priority).toBe("immediate");
  });
  it("CBD >7 mm → correlate with LFT", () => {
    const m = matchRecommendations({ ...base, modality: "USG", measurements: [{ label: "CBD diameter", value: 8, unit: "mm" }] });
    expect(m.some((x) => x.recommendation.id === "rec.usg.abdomen.cbd-lft")).toBe(true);
  });
  it("pulmonary nodule ≥6 mm → Fleischner guidance", () => {
    const m = matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Nodule size", value: 7, unit: "mm" }] });
    expect(m.some((x) => x.recommendation.id === "rec.ct.chest.nodule-fleischner")).toBe(true);
  });
  it("CTR >0.5 → clinical correlation", () => {
    const m = matchRecommendations({ ...base, modality: "X-RAY", measurements: [{ label: "Cardiothoracic ratio", value: 0.55, unit: "" }] });
    expect(m.some((x) => x.recommendation.id === "rec.xr.chest.ctr-correlation")).toBe(true);
  });
  it("CRL inconsistent → review dating", () => {
    const m = matchRecommendations({ ...base, modality: "USG", reportText: "CRL inconsistent with LMP dates." });
    expect(m.some((x) => x.recommendation.id === "rec.usg.ob.crl-dating")).toBe(true);
  });
});

describe("deterministic matching semantics", () => {
  it("reconciles mm↔cm before comparing (0.7 cm stone fires the 6 mm rule)", () => {
    const m = matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Stone size", value: 0.7, unit: "cm" }] });
    expect(m.some((x) => x.recommendation.id === "rec.ct.kub.stone-urology")).toBe(true);
  });
  it("below threshold does not fire; incompatible units never guess", () => {
    expect(matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Stone size", value: 4, unit: "mm" }] })
      .some((x) => x.recommendation.id === "rec.ct.kub.stone-urology")).toBe(false);
    expect(matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Stone size", value: 900, unit: "HU" }] })
      .some((x) => x.recommendation.id === "rec.ct.kub.stone-urology")).toBe(false);
  });
  it("comparison triggers: nodule grew → follow-up CT; stone increased → progression", () => {
    expect(matchRecommendations({ ...base, modality: "CT", priorChanges: [{ label: "Nodule size", deltaText: "increased 4→9 mm" }] })
      .some((x) => x.recommendation.id === "rec.cmp.nodule-growth")).toBe(true);
    expect(matchRecommendations({ ...base, modality: "USG", priorChanges: [{ label: "Stone size", deltaText: "larger than prior" }] })
      .some((x) => x.recommendation.id === "rec.cmp.stone-progression")).toBe(true);
  });
  it("modality scoping: XR variants match; MRI never gets the CTR entry", () => {
    expect(matchRecommendations({ ...base, modality: "XR", measurements: [{ label: "Cardiothoracic ratio", value: 0.55, unit: "" }] })
      .some((x) => x.recommendation.id === "rec.xr.chest.ctr-correlation")).toBe(true);
    expect(matchRecommendations({ ...base, modality: "MRI", measurements: [{ label: "Cardiothoracic ratio", value: 0.6, unit: "" }] })
      .some((x) => x.recommendation.id === "rec.xr.chest.ctr-correlation")).toBe(false);
  });
  it("garbage input degrades gracefully — never throws", () => {
    expect(() => matchRecommendations({ ...base, modality: "" })).not.toThrow();
    expect(() => matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "", value: NaN, unit: "" }] })).not.toThrow();
  });
});

describe("registry hygiene — no duplicates, no orphans, no conflicting advice", () => {
  it("ids are unique and hierarchical (rec.*)", () => {
    expect(new Set(reg.map((r) => r.id)).size).toBe(reg.length);
    for (const r of reg) expect(r.id).toMatch(/^rec\./);
  });
  it("no orphan entries — every entry anchors to a pack, rule, measurement, or graded condition", () => {
    for (const r of reg) {
      const anchored = r.knowledgePackRefs.length > 0 || r.qualityRuleRefs.length > 0
        || r.measurementRefs.length > 0 || r.trigger.kind === "condition";
      expect(anchored, r.id).toBe(true);
    }
  });
  it("no conflicting advice — one entry per (measurement label, comparator, modality)", () => {
    const seen = new Map<string, string>();
    for (const r of reg) {
      if (r.trigger.kind !== "measurement") continue;
      for (const l of r.trigger.labels) for (const m of r.modalities) {
        const sig = `${l.toLowerCase()}|${r.trigger.comparator}|${m}`;
        expect(seen.has(sig), `${r.id} conflicts with ${seen.get(sig)} on ${sig}`).toBe(false);
        seen.set(sig, r.id);
      }
    }
  });
  it("every modality resolves registry entries", () => {
    for (const mod of ["MRI", "USG", "CT", "X-RAY"]) {
      expect(reg.filter((r) => r.modalities.includes(mod) || r.modalities.includes("*")).length).toBeGreaterThan(0);
    }
  });
  it("complete metadata on every entry", () => {
    for (const r of reg) {
      expect(r.followUp.action, r.id).toBeTruthy();
      expect(r.rationale, r.id).toBeTruthy();
      expect(r.version, r.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("legacy Follow-Up database derives from the registry (single source)", () => {
  it("all 18 original groups intact with rows preserved", () => {
    const db = legacyFollowUpDatabase();
    expect(Object.keys(db)).toHaveLength(18);
    expect(db["meningioma"]).toHaveLength(3);
    expect(db["meningioma"][0].followUp).toBe("MRI Brain");
    expect(db["cervical-stenosis"].some((x) => x.priority === "critical")).toBe(true);
  });
  it("radiologyFollowUpEngine keeps its public API over the derived data", () => {
    expect(FOLLOW_UP_DATABASE["thyroid-nodule"]).toHaveLength(3);
    expect(getFollowUp("hcc")?.length).toBe(3);
    expect(searchFollowUp("biopsy").length).toBeGreaterThan(0);
  });
});

describe("Copilot + Companion consume the registry (no second engine)", () => {
  const ctx = {
    modality: "CT", studyDescription: "CT KUB", clinicalHistory: "", technique: "",
    findings: "Right ureteric calculus.", impression: ["Calculus."], recommendation: "",
    selectedFindingLabels: [],
    viewerMeasurements: [{ label: "Stone size", value: 8, unit: "mm", imported: true }],
    prior: { available: true, significantChanges: [{ label: "Stone size", deltaText: "increased" }] },
  };
  it("Copilot module surfaces registry matches and explains WHY", () => {
    const items = recommendationModuleItems(ctx as never);
    const stone = items.find((i) => i.id === "recommendation:rec.ct.kub.stone-urology");
    expect(stone).toBeTruthy();
    expect(stone?.category).toBe("recommendation");
    expect(stone?.why).toContain("Evidence:"); // explains WHY, not just WHAT
    expect(stone?.why).toContain("rec.ct.kub.stone-urology"); // provenance, no hidden logic
    // Comparison-driven advisory rides the same registry.
    expect(items.some((i) => i.id === "recommendation:rec.cmp.stone-progression")).toBe(true);
  });
  it("Companion gets follow-up questions from the registry (asks, never creates)", () => {
    const matches = matchRecommendations({ ...base, modality: "CT", measurements: [{ label: "Stone size", value: 8, unit: "mm" }] });
    const qs = recommendationQuestions(matches);
    expect(qs.some((q) => /hydronephrosis/i.test(q.question))).toBe(true);
  });
});
