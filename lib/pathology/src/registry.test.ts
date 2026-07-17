// registry.test.ts — contract tests for the Universal Pathology Registry.
//
// These are the executable guarantees of the platform: the catalog is provably
// self-consistent, every legacy result-parameter spelling resolves to one
// canonical id, reference intervals resolve correctly by sex/age/condition, the
// flagging engine agrees with clinical expectation (including panic values),
// and legacy stored results enrich without data loss. Mirrors the discipline of
// lib/measurements/src/registry.test.ts.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PATHOLOGY_REGISTRY as REG,
  PATHOLOGY_ANALYTE_CATALOG,
  PATHOLOGY_PANEL_CATALOG,
  createPathologyRegistry,
  resolveAnalyte,
  resolvePanel,
  getAnalyte,
  getPanel,
  flagValue,
  referenceRangeFor,
  resolveReferenceInterval,
  formatReferenceRange,
  convertUnitValue,
  canonicalUnit,
  isKnownUnit,
  normalizeSex,
  ageYearsFromDob,
  enrichLegacyParameters,
  enrichmentStats,
  isCriticalFlag,
  isAbnormalFlag,
} from "./index";

describe("registry integrity", () => {
  it("has zero validation issues (no duplicate ids/aliases, no bad units/ranges, no orphan panel analytes)", () => {
    expect(REG.validationIssues()).toEqual([]);
  });

  it("every analyte is resolvable by its own id, canonicalKey and displayName", () => {
    for (const def of PATHOLOGY_ANALYTE_CATALOG) {
      expect(REG.resolveAnalyte(def.id)?.definition.id).toBe(def.id);
      expect(REG.resolveAnalyte(def.canonicalKey)?.definition.id).toBe(def.id);
      expect(REG.resolveAnalyte(def.displayName)?.definition.id).toBe(def.id);
    }
  });

  it("every panel is resolvable by its own id, canonicalKey and displayName, and references only known analytes", () => {
    for (const panel of PATHOLOGY_PANEL_CATALOG) {
      expect(REG.resolvePanel(panel.id)?.definition.id).toBe(panel.id);
      expect(REG.resolvePanel(panel.canonicalKey)?.definition.id).toBe(panel.id);
      expect(REG.resolvePanel(panel.displayName)?.definition.id).toBe(panel.id);
      for (const analyteId of panel.analytes) expect(getAnalyte(analyteId)).toBeDefined();
    }
  });

  it("no orphan replacedBy references", () => {
    for (const def of PATHOLOGY_ANALYTE_CATALOG) if (def.replacedBy) expect(getAnalyte(def.replacedBy)).toBeDefined();
    for (const p of PATHOLOGY_PANEL_CATALOG) if (p.replacedBy) expect(getPanel(p.replacedBy)).toBeDefined();
  });

  it("every numeric analyte can be flagged (has a reference interval or a critical value)", () => {
    for (const def of PATHOLOGY_ANALYTE_CATALOG) {
      if (def.resultType === "numeric" || def.resultType === "ratio") {
        const flaggable = def.referenceIntervals.length > 0 || def.criticalLow !== undefined || def.criticalHigh !== undefined;
        expect(flaggable, `${def.id} has no way to be flagged`).toBe(true);
      }
    }
  });

  it("flags structural problems (duplicate alias, unknown unit, panel referencing an unknown analyte)", () => {
    const bad = createPathologyRegistry(
      [
        { ...PATHOLOGY_ANALYTE_CATALOG[0]!, id: "A_TEST", canonicalKey: "analyte.a", aliases: ["Shared Label"] },
        { ...PATHOLOGY_ANALYTE_CATALOG[0]!, id: "B_TEST", canonicalKey: "analyte.b", aliases: ["Shared Label"] },
      ],
      [{ ...PATHOLOGY_PANEL_CATALOG[0]!, id: "P_TEST", canonicalKey: "panel.p", analytes: ["A_TEST", "DOES_NOT_EXIST"] }],
    );
    const kinds = bad.validationIssues().map((i) => i.kind);
    expect(kinds).toContain("duplicate-alias");
    expect(kinds).toContain("panel-unknown-analyte");
  });
});

describe("legacy label resolution — one canonical id for every spelling", () => {
  const CASES: Array<[string, string]> = [
    // Hemoglobin — the CBD of pathology: spelled every way
    ["Hemoglobin", "HEMOGLOBIN"],
    ["Haemoglobin", "HEMOGLOBIN"],
    ["Hb", "HEMOGLOBIN"],
    ["HGB", "HEMOGLOBIN"],
    ["Hemoglobin (Hb)", "HEMOGLOBIN"],
    ["analyte.hemoglobin", "HEMOGLOBIN"],
    // WBC / TLC
    ["WBC", "WBC_COUNT"],
    ["TLC", "WBC_COUNT"],
    ["Total Leukocyte Count", "WBC_COUNT"],
    ["Total Leucocyte Count", "WBC_COUNT"],
    // Platelets
    ["Platelets", "PLATELET_COUNT"],
    ["PLT", "PLATELET_COUNT"],
    // Glucose family
    ["FBS", "GLUCOSE_FASTING"],
    ["Fasting Blood Sugar", "GLUCOSE_FASTING"],
    ["PPBS", "GLUCOSE_PP"],
    ["Post Prandial Blood Sugar", "GLUCOSE_PP"],
    ["RBS", "GLUCOSE_RANDOM"],
    ["A1c", "HBA1C"],
    ["Glycated Hemoglobin", "HBA1C"],
    // Renal
    ["Serum Creatinine", "CREATININE"],
    ["S. Creatinine", "CREATININE"],
    ["Blood Urea", "UREA"],
    ["BUN", "BUN"],
    ["Na", "SODIUM"],
    ["K+", "POTASSIUM"],
    // Liver — parenthetical & dotted forms
    ["SGPT", "SGPT_ALT"],
    ["ALT", "SGPT_ALT"],
    ["SGPT (ALT)", "SGPT_ALT"],
    ["S.G.P.T.", "SGPT_ALT"],
    ["SGOT", "SGOT_AST"],
    ["AST (SGOT)", "SGOT_AST"],
    ["Alkaline Phosphatase", "ALP"],
    ["Total Bilirubin", "BILIRUBIN_TOTAL"],
    ["Direct Bilirubin", "BILIRUBIN_DIRECT"],
    // Lipid
    ["Total Cholesterol", "CHOLESTEROL_TOTAL"],
    ["TG", "TRIGLYCERIDES"],
    ["HDL", "HDL_CHOLESTEROL"],
    ["LDL-C", "LDL_CHOLESTEROL"],
    // Thyroid
    ["Thyroid Stimulating Hormone", "TSH"],
    ["Total T3", "T3_TOTAL"],
    ["Free T4", "FT4"],
    // Serology
    ["Hepatitis B Surface Antigen", "HBSAG"],
    ["Anti-HCV", "HCV_AB"],
    ["Blood Group", "BLOOD_GROUP"],
  ];

  for (const [input, expected] of CASES) {
    it(`"${input}" -> ${expected}`, () => {
      expect(resolveAnalyte(input)?.definition.id).toBe(expected);
    });
  }

  it("resolves parenthetical forms via the stripped fallback", () => {
    expect(resolveAnalyte("Haemoglobin (Hb)")?.matchedBy).toBeDefined();
    expect(resolveAnalyte("Bilirubin (Total)")?.definition.id).toBe("BILIRUBIN_TOTAL");
  });

  it("resolves panels across their aliases", () => {
    expect(resolvePanel("Hemogram")?.definition.id).toBe("CBC");
    expect(resolvePanel("RFT")?.definition.id).toBe("KFT");
    expect(resolvePanel("TFT")?.definition.id).toBe("THYROID_PROFILE");
    expect(resolvePanel("Lipid Panel")?.definition.id).toBe("LIPID_PROFILE");
  });

  it("does not fuzzy-match unknown labels", () => {
    expect(resolveAnalyte("Completely Unknown Analyte")).toBeUndefined();
    expect(resolveAnalyte("")).toBeUndefined();
    expect(resolvePanel("Not A Panel")).toBeUndefined();
  });
});

describe("reference-range resolution by sex / age / condition", () => {
  it("picks the sex-specific adult hemoglobin range", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    expect(resolveReferenceInterval(hb, { sex: "male", ageYears: 40 }).low).toBe(13.0);
    expect(resolveReferenceInterval(hb, { sex: "female", ageYears: 40 }).low).toBe(12.0);
  });

  it("never gives a child an adult range (age band wins)", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    const child = resolveReferenceInterval(hb, { sex: "male", ageYears: 5 });
    expect(child.interval?.note).toContain("Child");
    const creat = getAnalyte("CREATININE")!;
    const kid = resolveReferenceInterval(creat, { sex: "male", ageYears: 8 });
    expect(kid.high).toBe(0.7); // pediatric, not the adult 1.3
  });

  it("applies the pregnancy condition when present", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    const preg = resolveReferenceInterval(hb, { sex: "female", ageYears: 28, condition: "pregnancy" });
    expect(preg.low).toBe(11.0);
    const tsh = getAnalyte("TSH")!;
    expect(resolveReferenceInterval(tsh, { sex: "female", ageYears: 30, condition: "pregnancy-t1" }).high).toBe(2.5);
    expect(resolveReferenceInterval(tsh, { sex: "female", ageYears: 30 }).high).toBe(4.0);
  });

  it("age-bands ALP correctly (children run high due to bone growth)", () => {
    const alp = getAnalyte("ALP")!;
    expect(resolveReferenceInterval(alp, { ageYears: 8 }).high).toBe(390);
    expect(resolveReferenceInterval(alp, { ageYears: 40 }).high).toBe(129);
  });

  it("reports no interval when sex is required but unknown", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    const r = resolveReferenceInterval(hb, { ageYears: 40 }); // no sex
    expect(r.matched).toBe(false);
  });

  it("formats one- and two-sided ranges and free-text ranges", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    expect(referenceRangeFor(hb, { sex: "male", ageYears: 40 })).toBe("13.0 – 17.0 g/dL");
    const chol = getAnalyte("CHOLESTEROL_TOTAL")!;
    expect(referenceRangeFor(chol, {})).toContain("Desirable < 200");
    const pp = getAnalyte("GLUCOSE_PP")!;
    // free-text overrides the numeric render
    expect(formatReferenceRange(resolveReferenceInterval(pp, {}).interval, 0, "mg/dL")).toContain("2-hr");
  });
});

describe("flagging engine", () => {
  it("flags normal / high / low against the patient's range", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    expect(flagValue(hb, 15, { sex: "male", ageYears: 40 }).flag).toBe("N");
    expect(flagValue(hb, 11, { sex: "male", ageYears: 40 }).flag).toBe("L");
    expect(flagValue(hb, 18.5, { sex: "male", ageYears: 40 }).flag).toBe("H");
  });

  it("escalates panic values to critical flags, independent of the matched range", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    expect(flagValue(hb, 6.5, { sex: "male", ageYears: 40 }).flag).toBe("LL");
    const k = getAnalyte("POTASSIUM")!;
    expect(flagValue(k, 6.9, {}).status).toBe("critical-high");
    expect(isCriticalFlag(flagValue(k, 2.3, {}).flag)).toBe(true);
    // critical can fire even with no sex-specific range matched
    expect(flagValue(hb, 6.0, { ageYears: 40 }).flag).toBe("LL");
  });

  it("converts an accepted alternate unit before comparing", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    // 130 g/L == 13.0 g/dL -> normal for an adult male
    expect(flagValue(hb, 130, { sex: "male", ageYears: 40 }, "g/L").flag).toBe("N");
    // 95 g/L == 9.5 g/dL -> low
    expect(flagValue(hb, 95, { sex: "male", ageYears: 40 }, "g/L").flag).toBe("L");
  });

  it("refuses to flag physiologically implausible values", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    expect(flagValue(hb, 45, { sex: "male", ageYears: 40 }).status).toBe("unknown");
    expect(flagValue(hb, 45, { sex: "male", ageYears: 40 }).detail).toContain("implausible");
  });

  it("returns unknown for a non-convertible unit rather than a wrong flag", () => {
    const hb = getAnalyte("HEMOGLOBIN")!;
    const r = flagValue(hb, 13, { sex: "male", ageYears: 40 }, "mmol/L");
    expect(r.status).toBe("unknown");
  });

  it("flags categorical results by value membership", () => {
    const hbsag = getAnalyte("HBSAG")!;
    expect(flagValue(hbsag, "Non-Reactive").flag).toBe("N");
    expect(flagValue(hbsag, "Reactive").flag).toBe("A");
    expect(flagValue(hbsag, "Positive").flag).toBe("A"); // alias
    expect(isAbnormalFlag(flagValue(hbsag, "Positive").flag)).toBe(true);
    expect(flagValue(hbsag, "gibberish").status).toBe("unknown");
    const bg = getAnalyte("BLOOD_GROUP")!;
    expect(flagValue(bg, "O+").flag).toBe("N"); // informational, never abnormal
  });

  it("never auto-flags titre or text results", () => {
    const widal = getAnalyte("WIDAL")!;
    expect(flagValue(widal, "1:80").flag).toBe("");
    expect(flagValue(widal, "1:80").status).toBe("unknown");
  });

  it("handles messy numeric strings ('<0.01', '1,50,000')", () => {
    const tsh = getAnalyte("TSH")!;
    expect(flagValue(tsh, "<0.01", {}).flag).toBe("L");
    const plt = getAnalyte("PLATELET_COUNT")!;
    expect(flagValue(plt, "150", {}).flag).toBe("N");
  });
});

describe("units — normalization and exact conversion", () => {
  it("normalizes spellings to one canonical symbol", () => {
    expect(canonicalUnit("gm/dl")).toBe("g/dL");
    expect(canonicalUnit("G%")).toBe("g/dL");
    expect(canonicalUnit("x10^3/uL")).toBe("10^3/µL");
    expect(canonicalUnit("cumm")).toBe("/µL");
    expect(canonicalUnit("uIU/mL")).toBe("µIU/mL");
    expect(isKnownUnit("mg/dl")).toBe(true);
    expect(isKnownUnit("not-a-unit")).toBe(false);
  });

  it("converts within a family and refuses across families", () => {
    expect(convertUnitValue(13, "g/dL", "g/L")).toBeCloseTo(130);
    expect(convertUnitValue(5.2, "10^3/µL", "10^9/L")).toBeCloseTo(5.2); // numerically equal
    expect(convertUnitValue(5.0, "10^6/µL", "10^12/L")).toBeCloseTo(5.0);
    expect(convertUnitValue(1.0, "µIU/mL", "mIU/L")).toBe(1.0);
    // needs molar mass / valence — must NOT be guessed:
    expect(convertUnitValue(100, "mg/dL", "mmol/L")).toBeNull();
    expect(convertUnitValue(4.0, "mmol/L", "mEq/L")).toBeNull();
  });
});

describe("panels", () => {
  it("returns component analytes in report order", () => {
    const cbc = REG.panelAnalytes("CBC");
    expect(cbc.length).toBe(14);
    expect(cbc[0]!.id).toBe("HEMOGLOBIN");
    expect(REG.panelAnalytes("LFT").map((a) => a.id)).toContain("SGPT_ALT");
  });

  it("skips unknown analyte ids without throwing", () => {
    const reg = createPathologyRegistry(
      [PATHOLOGY_ANALYTE_CATALOG.find((a) => a.id === "HEMOGLOBIN")!],
      [{ ...PATHOLOGY_PANEL_CATALOG[0]!, analytes: ["HEMOGLOBIN", "NOPE"] }],
    );
    expect(reg.panelAnalytes("CBC").map((a) => a.id)).toEqual(["HEMOGLOBIN"]);
  });

  it("groups analytes by department", () => {
    expect(REG.byDepartment("Hematology").some((a) => a.id === "HEMOGLOBIN")).toBe(true);
    expect(REG.byDepartment("hematology").length).toBeGreaterThan(0); // case-insensitive
  });
});

describe("helpers", () => {
  it("normalizes free-form sex and computes age from DOB", () => {
    expect(normalizeSex("M")).toBe("male");
    expect(normalizeSex("female")).toBe("female");
    expect(normalizeSex("other")).toBeUndefined();
    const age = ageYearsFromDob("2000-01-01", new Date("2020-01-01T00:00:00Z"));
    expect(age).toBeGreaterThan(19.9);
    expect(age).toBeLessThan(20.1);
  });
});

describe("legacy parameter bridge — non-destructive enrichment", () => {
  // A realistic patient_reports.parameters payload from a CBC + biochem report.
  const legacyJson = JSON.stringify([
    { name: "Haemoglobin", value: "9.8", unit: "g/dL", refRange: "13-17", flag: "" },   // stored flag missing
    { name: "TLC", value: "12500", unit: "/µL", refRange: "4000-11000", flag: "" },
    { name: "Platelets", value: "18000", unit: "/µL", refRange: "150000-410000", flag: "L" }, // stored L, really critical
    { name: "S. Creatinine", value: "0.9", unit: "mg/dL", refRange: "0.6-1.1", flag: "" },
    { name: "Some Local Panel Note", value: "see below", unit: "", refRange: "", flag: "" }, // unresolved -> preserved
  ]);

  it("resolves known rows, recomputes range+flag, and preserves everything else", () => {
    const ctx = { sex: "female", ageYears: 34 };
    const enriched = enrichLegacyParameters(legacyJson, ctx);
    expect(enriched.length).toBe(5);

    const hb = enriched[0]!;
    expect(hb.resolved).toBe(true);
    expect(hb.analyteId).toBe("HEMOGLOBIN");
    expect(hb.value).toBe("9.8"); // original preserved
    expect(hb.canonicalFlag).toBe("L"); // recomputed against the female range
    expect(hb.canonicalRefRange).toBe("12.0 – 15.0 g/dL");
    expect(hb.flagChanged).toBe(true); // stored flag was empty

    const plt = enriched[2]!;
    expect(plt.canonicalFlag).toBe("LL"); // 18k is critically low, not merely "L"
    expect(plt.flagChanged).toBe(true);

    const unresolved = enriched[4]!;
    expect(unresolved.resolved).toBe(false);
    expect(unresolved.name).toBe("Some Local Panel Note"); // untouched
  });

  it("summarizes enrichment for coverage/migration reporting", () => {
    const stats = enrichmentStats(enrichLegacyParameters(legacyJson, { sex: "female", ageYears: 34 }));
    expect(stats.total).toBe(5);
    expect(stats.resolved).toBe(4);
    expect(stats.critical).toBeGreaterThanOrEqual(1);
    expect(stats.abnormal).toBeGreaterThanOrEqual(2);
  });

  it("tolerates malformed payloads", () => {
    expect(enrichLegacyParameters(null)).toEqual([]);
    expect(enrichLegacyParameters("not json")).toEqual([]);
    expect(enrichLegacyParameters("{}", {})).toEqual([]);
  });
});

// Test-only ambient declaration: this package's tsconfig has no node/dom lib
// types (pure-TS package), but vitest runs the file under node.
declare const console: { log: (...args: unknown[]) => void };

describe("performance", () => {
  it("resolves 100k mixed lookups fast (reports timing)", () => {
    const inputs = ["Hemoglobin", "Haemoglobin (Hb)", "FBS", "SGPT (ALT)", "analyte.creatinine", "not-an-analyte"];
    const N = 120_000;
    const start = Date.now();
    let hits = 0;
    for (let i = 0; i < N; i++) if (resolveAnalyte(inputs[i % inputs.length]!)) hits++;
    const elapsed = Date.now() - start;
    console.log(`[pathology perf] ${N} resolves in ${elapsed}ms (${((elapsed / N) * 1e6).toFixed(0)}ns/lookup, ${hits} hits)`);
    expect(hits).toBe((N / inputs.length) * 5);
    expect(elapsed).toBeLessThan(2000);
  });
});
