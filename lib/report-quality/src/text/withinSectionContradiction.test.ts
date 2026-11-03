/**
 * Q124 — a single section that both denies and reports the same finding.
 *
 * Every text here is copied from a real artefact: the firing cases are qwen3:14b output from the
 * measured 30-call RAG matrix (tmp/rag-image/live-results-repeat3.json), and the quiet cases are
 * CARE's own clinically-sound reports — the golden corpus and the shipped de-identified house
 * normal templates. No sentence here was invented to make a rule look good.
 *
 * The control matters more than the detection. A previous within-Findings contradiction detector
 * on this project was measured and refuted at 4 false positives per 20 correct reports against 1
 * true positive, because its guards could not tell "no thrombus in the femoral veins" from
 * "thrombus in the popliteal vein". These tests pin the anatomy granularity that refutation
 * demanded: the word the sentence actually used, not the organ group it belongs to.
 */
import { describe, expect, it } from "vitest";
import { withinSectionContradictions } from "./findingsImpression";
import { evaluateTextTier } from "./evaluate";
import type { TextReportInput } from "../contract";

function report(over: Partial<TextReportInput> & Pick<TextReportInput, "findings" | "impression">): TextReportInput {
  return {
    technique: "Examination performed per protocol.",
    clinicalHistory: "For the purpose of this case.",
    recommendation: "Clinical correlation advised.",
    ...over,
  };
}

/** The real Findings of the measured MRI brain case A, arm ON, repeat 1 — verbatim. */
const CASE_A_FINDINGS =
  "Brain parenchyma demonstrates normal signal intensity with preserved grey-white differentiation. "
  + "No acute infarct is identified. No intracranial hemorrhage is seen. "
  + "No restricted diffusion is identified on DWI/ADC sequences. "
  + "The ventricular system and cisternal spaces are normal in size and configuration. "
  + "No extra-axial collection is identified. No midline shift is observed. "
  + "The basal ganglia and thalami exhibit normal signal intensity. "
  + "Flow voids in the major intracranial vessels are preserved. "
  + "Restricted diffusion is noted in the right basal ganglia, with corresponding hyperintensity on "
  + "DWI and hypointensity on ADC. Scattered T2 and FLAIR hyperintense foci are present in the "
  + "bilateral periventricular and subcortical white matter.";

/** The measured case B, arm OFF, repeat 1 — the same defect on the left thalamus. */
const CASE_B_FINDINGS =
  "No restricted diffusion is observed on DWI/ADC. "
  + "Restricted diffusion is noted in the left thalamus, with hyperintensity on DWI and "
  + "corresponding low signal on ADC.";

/** The measured case E, arm ON, repeat 1 — a lumbar study whose normal line survived the merge. */
const CASE_E_FINDINGS =
  "No significant disc bulge or protrusion is seen. Diffuse posterior disc bulge is present.";

/** The correct normal brain report: every one of these findings is denied, none is asserted. */
const CORRECT_NORMAL_BRAIN =
  "Brain parenchyma demonstrates normal signal intensity. No acute infarct is identified. "
  + "No intracranial hemorrhage is seen. No restricted diffusion is identified on DWI/ADC sequences. "
  + "No extra-axial collection is identified. No midline shift is observed. "
  + "The basal ganglia and thalami exhibit normal signal intensity.";

describe("Q124 — detects the contradiction the measured model output actually contains", () => {
  it("fires on the real case-A Findings that deny and report restricted diffusion", () => {
    const out = withinSectionContradictions(CASE_A_FINDINGS, "");
    expect(out.map((c) => c.ruleId)).toContain("Q124");
    const message = out.find((c) => c.ruleId === "Q124")!.message;
    expect(message).toMatch(/restricted diffusion/i);
    expect(message).toContain("Findings");
  });

  it("fires on the real case-B Findings, on the left thalamus", () => {
    const out = withinSectionContradictions(CASE_B_FINDINGS, "");
    expect(out.map((c) => c.ruleId)).toContain("Q124");
  });

  it("fires on the real case-E Findings, on the disc", () => {
    const out = withinSectionContradictions(CASE_E_FINDINGS, "");
    expect(out.map((c) => c.ruleId)).toContain("Q124");
    expect(out.find((c) => c.ruleId === "Q124")!.message).toMatch(/disc/i);
  });

  it("fires once per finding, not once per sentence", () => {
    const out = withinSectionContradictions(CASE_A_FINDINGS, "").filter((c) => c.ruleId === "Q124");
    expect(out).toHaveLength(1);
  });

  it("reads the Impression as its own section", () => {
    const out = withinSectionContradictions("", "No restricted diffusion is seen. Restricted diffusion is noted in the right basal ganglia.");
    expect(out.map((c) => c.ruleId)).toContain("Q124");
    expect(out.find((c) => c.ruleId === "Q124")!.message).toContain("Impression");
  });
});

describe("Q124 — stays quiet on the reports the clinic is right about", () => {
  const quiet = (name: string, findings: string) => {
    it(name, () => {
      expect(withinSectionContradictions(findings, "")).toEqual([]);
    });
  };

  quiet("a normal brain report that denies every finding it names", CORRECT_NORMAL_BRAIN);

  quiet(
    "gallstones with no ductal stone — the correct MRCP",
    "The gallbladder contains multiple stones without wall thickening or pericholecystic fluid. "
      + "No filling defect to suggest a ductal stone.",
  );

  quiet(
    "popliteal DVT with clear femoral veins — the correct Doppler",
    "No thrombus in the examined common femoral and femoral veins. "
      + "The right popliteal vein is non-compressible and contains heterogeneous intraluminal thrombus.",
  );

  quiet(
    "a subdural haematoma with no extradural collection — the correct CT brain",
    "Right acute convexity subdural haematoma with a maximum thickness of 12 mm. "
      + "No associated extradural haematoma.",
  );

  quiet(
    "a denial scoped to one level beside an assertion at another",
    "No nerve root compression at L3-L4. Thecal sac indentation is seen at L4-L5.",
  );

  quiet(
    "an acuity that separates the two halves",
    "No acute infarct is identified. A chronic infarct with gliotic change is seen in the left MCA territory.",
  );

  quiet(
    "a denial of a subset beside the finding that stands",
    "No suspicious masses or calcifications. Two stable fibroadenomas with coarse calcifications are seen.",
  );

  quiet(
    "a side that separates the two halves",
    "No left renal stone. A right renal stone of 6 mm is seen.",
  );
});

describe("Q124 — never touches the text it reads", () => {
  it("returns rule id and message only", () => {
    const out = withinSectionContradictions(CASE_A_FINDINGS, "");
    for (const c of out) expect(Object.keys(c).sort()).toEqual(["message", "ruleId"]);
  });
});

/**
 * The rule function is not the product. Three consumers call it — the canonical text tier, the live
 * ERP badge, and the Composer validator that screens an AI draft before a radiologist ever sees it —
 * and a suite that only exercises the function stays green when any one of those three stops
 * calling. This block is what the mutation battery checks against: deleting the emit loop in
 * ./evaluate.ts must turn one of these red.
 */
describe("Q124 — reaches the report the radiologist is shown", () => {
  const findings = CASE_B_FINDINGS;

  it("is emitted by the canonical text tier, with its own rule id", () => {
    const out = evaluateTextTier(
      report({ findings, impression: ["Acute infarct in the left thalamus."] }),
    );
    const hit = out.findings.filter((f) => f.ruleId === "Q124");
    expect(hit.length).toBe(1);
    expect(hit[0]!.message).toContain("denies restricted diffusion");
  });

  it("reaches the tier from the Impression side too, not only the Findings", () => {
    const out = evaluateTextTier(
      report({
        findings: "Scattered T2 and FLAIR hyperintense foci in the bilateral periventricular white matter.",
        impression: [
          "No restricted diffusion is observed on DWI/ADC. Restricted diffusion is noted in the left thalamus.",
        ],
      }),
    );
    const hit = out.findings.filter((f) => f.ruleId === "Q124");
    expect(hit.length).toBe(1);
    expect(hit[0]!.message).toContain("in the Impression");
  });

  it("scores a self-contradicting report below the same report with the pair resolved", () => {
    const contradictory = evaluateTextTier(report({ findings, impression: ["Acute left thalamic infarct."] }));
    const resolved = evaluateTextTier(
      report({
        findings: "Restricted diffusion is noted in the left thalamus, with corresponding low signal on ADC.",
        impression: ["Acute left thalamic infarct."],
      }),
    );
    expect(contradictory.findings.map((f) => f.ruleId)).toContain("Q124");
    expect(resolved.findings.map((f) => f.ruleId)).not.toContain("Q124");
    expect(contradictory.score).toBeLessThan(resolved.score);
  });
});
