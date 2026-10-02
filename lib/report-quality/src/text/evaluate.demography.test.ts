import { describe, it, expect } from "vitest";
import { evaluateTextTier } from "./evaluate";
import type { TextReportInput } from "../contract";

/**
 * The demography- and array-shaped inputs. These rules were implemented and
 * catalogued but could never fire from the reporting workspace: the finalize
 * request builder sent neither `sex` nor `age`, and it sent the whole
 * Impression field as ONE array element, so there was never a pair of lines for
 * Q102 to compare. Each case below pins the rule's firing condition so a future
 * caller that starves the input again fails a test instead of silently
 * disarming a wrong-patient detector.
 */

function input(over: Partial<TextReportInput>): TextReportInput {
  return { findings: "", impression: [], ...over };
}

function ruleIds(findings: Array<{ ruleId: string }>): string[] {
  return findings.map((f) => f.ruleId);
}

describe("Q109 — sex vs anatomy contradiction (wrong-patient-report signature)", () => {
  it("fires when a female patient's report mentions male anatomy", () => {
    const { findings } = evaluateTextTier(input({
      findings: "The prostate gland is normal in size.",
      impression: ["Benign prostatic hyperplasia."],
      sex: "F",
    }));
    expect(ruleIds(findings)).toContain("Q109");
  });

  it("fires when a male patient's report mentions female anatomy", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Uterus and endometrium appear normal.",
      impression: ["No pelvic abnormality."],
      sex: "M",
    }));
    expect(ruleIds(findings)).toContain("Q109");
  });

  it("accepts the free-text ERP gender values, not just the DICOM letter", () => {
    // patients.gender is free text; a strict === "F" check never matched a real
    // patient and this rule was silently dead once before for exactly that
    // reason.
    for (const sex of ["F", "female", "FEMALE"]) {
      const { findings } = evaluateTextTier(input({
        findings: "Prostate measured 8.7 mm.",
        impression: ["Enlarged prostate."],
        sex,
      }));
      expect(ruleIds(findings), `sex="${sex}"`).toContain("Q109");
    }
  });

  it("stays silent when the sex agrees with the anatomy", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Uterus and endometrium appear normal.",
      impression: ["No pelvic abnormality."],
      sex: "F",
    }));
    expect(ruleIds(findings)).not.toContain("Q109");
  });

  it("does not fire on an unknown or absent sex — no guess, no false alarm", () => {
    for (const sex of [undefined, null, "", "O", "UNKNOWN"]) {
      const { findings } = evaluateTextTier(input({
        findings: "Uterus appears normal.",
        impression: ["No pelvic abnormality."],
        sex,
      }));
      expect(ruleIds(findings), `sex=${JSON.stringify(sex)}`).not.toContain("Q109");
    }
  });

  it("reads sex across the whole report, so a contradiction in the technique or history is still caught", () => {
    const { findings } = evaluateTextTier(input({
      findings: "No acute intracranial abnormality.",
      impression: ["Normal study."],
      clinicalHistory: "Referred for evaluation of the prostate.",
      sex: "F",
    }));
    expect(ruleIds(findings)).toContain("Q109");
  });
});

describe("Q110 — age-appropriateness of wording", () => {
  it("fires when a paediatric patient is described with adult degenerative terms", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Multilevel degenerative changes are noted.",
      impression: ["Spondylosis."],
      age: "9 Yrs",
    }));
    expect(ruleIds(findings)).toContain("Q110");
  });

  it("fires when an adult is described with paediatric phrasing", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Growth plates open throughout the visualised skeleton.",
      impression: ["No fracture."],
      age: "62 Yrs",
    }));
    expect(ruleIds(findings)).toContain("Q110");
  });

  it("parses the first number out of a display age string", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Senile osteopenia.",
      impression: ["Age-related change."],
      age: "045Y",
    }));
    expect(ruleIds(findings)).not.toContain("Q110");
    const paediatric = evaluateTextTier(input({
      findings: "Senile osteopenia.",
      impression: ["Age-related change."],
      age: "007Y",
    }));
    expect(ruleIds(paediatric.findings)).toContain("Q110");
  });

  it("does not fire when age is absent", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Multilevel degenerative changes.",
      impression: ["Spondylosis."],
    }));
    expect(ruleIds(findings)).not.toContain("Q110");
  });
});

describe("Q102 — duplicate impression line", () => {
  const dupe = [
    "Moderate canal stenosis at L4-L5.",
    "Moderate canal stenosis at L4-L5.",
  ];

  it("fires when the impression is passed as one element per point", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Disc herniation at L4-L5 with canal stenosis.",
      impression: dupe,
    }));
    expect(ruleIds(findings)).toContain("Q102");
  });

  it("cannot fire when the whole impression arrives as a single element", () => {
    // This is the starvation this change removes: identical content, one array
    // element, no pair to compare.
    const { findings } = evaluateTextTier(input({
      findings: "Disc herniation at L4-L5 with canal stenosis.",
      impression: [dupe.join("\n")],
    }));
    expect(ruleIds(findings)).not.toContain("Q102");
  });

  it("stays silent when the impression points differ", () => {
    const { findings } = evaluateTextTier(input({
      findings: "Disc herniation at L4-L5.",
      impression: ["Moderate canal stenosis at L4-L5.", "No other abnormality."],
    }));
    expect(ruleIds(findings)).not.toContain("Q102");
  });
});
