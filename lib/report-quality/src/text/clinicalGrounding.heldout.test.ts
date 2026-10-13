/**
 * Held-out cases for the three clinical-integrity rules: contrast claimed
 * against what the patient received (Q112), a named diagnosis the report never
 * describes (Q117), and spine content from outside the examined region (Q118).
 *
 * Written from routine reporting, deliberately different in wording and organ
 * mix from the golden corpus in artifacts/api-server/src/lib/clinicalGolden — a
 * rule tuned on one corpus and proven only against it is not a rule. Every quiet
 * line below is a correct report CARE must not mark up, and every armed line is
 * a defect a referrer would act on.
 *
 * Each case is synthetic. None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { evaluateTextTier } from "./evaluate";
import { findRuleEntry } from "../ruleCatalog";
import type { TextReportInput } from "../contract";

const RULES = ["Q112", "Q117", "Q118"];

function armed(input: TextReportInput): string[] {
  return evaluateTextTier(input)
    .findings.filter((f) => RULES.includes(f.ruleId))
    .map((f) => f.ruleId);
}

function report(over: Partial<TextReportInput> & Pick<TextReportInput, "findings" | "impression">): TextReportInput {
  return {
    technique: "Examination performed per protocol.",
    clinicalHistory: "For the purpose of this case.",
    recommendation: "Clinical correlation advised.",
    ...over,
  };
}

describe("quiet on correct reports (held out from the corpus)", () => {
  const cases: [string, TextReportInput][] = [
    [
      "Plain MRI brain where enhancement is expressly denied",
      report({
        modality: "MR",
        studyDescription: "MRI BRAIN (PLAIN)",
        technique: "Multiplanar multisequence MRI of the brain performed without contrast.",
        findings:
          "The ventricles, sulci and basal cisterns are normal in calibre. No extra-axial collection. " +
          "No abnormal gadolinium enhancement is seen.",
        impression: ["No acute intracranial abnormality on plain sequences."],
      }),
    ],
    [
      // "Posterior acoustic enhancement" is ultrasound's word for the bright
      // area behind a cyst. It is not contrast, and on a study a worklist may
      // well title "(PLAIN)" it must not arm the contrast rule.
      "Ultrasound describing posterior acoustic enhancement",
      report({
        modality: "US",
        studyDescription: "ULTRASOUND ABDOMEN (PLAIN)",
        technique: "Grayscale ultrasound of the abdomen, no contrast administered.",
        findings:
          "A 30 mm anechoic right renal cortical cyst shows thin walls and posterior acoustic enhancement, " +
          "with no internal vascularity. The liver is normal in size and echotexture.",
        impression: ["Simple right renal cyst."],
      }),
    ],
    [
      // The everyday appendicitis report: the Findings give the anatomy and the
      // Impression gives the diagnosis. Naming the inflamed organ's entity is
      // what makes this a conclusion rather than an invention.
      "Appendicitis concluded from described appendiceal anatomy",
      report({
        modality: "CT",
        studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
        technique: "CT abdomen and pelvis with intravenous contrast.",
        findings:
          "A dilated, blind-ending tubular structure in the right iliac fossa measuring 12 mm with wall thickening " +
          "and a calcified appendicolith at its base. Moderate periappendiceal fat stranding. No collection.",
        impression: ["Acute appendicitis with an appendicolith, no perforation or abscess."],
      }),
    ],
    [
      "Cholecystitis denied in the Impression of a normal gallbladder",
      report({
        modality: "US",
        studyDescription: "ULTRASOUND ABDOMEN (WHOLE)",
        findings:
          "The gallbladder is normal in wall thickness with no pericholecystic fluid. The common bile duct measures 4 mm. " +
          "The liver and both kidneys are unremarkable.",
        impression: ["No evidence of cholecystitis."],
      }),
    ],
    [
      // A summary is allowed to re-describe. "Small vessel ischaemic disease"
      // over punctate white-matter changes is the standard form of that, and a
      // rule that demands the Findings repeat the Impression's words would mark
      // up most normal-variant brain MRIs in the clinic.
      "Chronic white-matter change summarised as small vessel disease",
      report({
        modality: "MR",
        studyDescription: "MRI BRAIN (PLAIN)",
        findings:
          "Scattered punctate T2 hyperintensities in the periventricular and subcortical white matter, " +
          "without restricted diffusion. No mass lesion or hydrocephalus.",
        impression: ["Mild chronic small vessel ischaemic disease."],
      }),
    ],
    [
      // Cord signal change is the single most common abnormal finding on this
      // clinic's cervical MRIs, and it is written with the sequence name.
      "Cervical MRI naming the T2 sequence, not a thoracic level",
      report({
        modality: "MR",
        studyDescription: "MRI CERVICAL SPINE (PLAIN)",
        technique: "Sagittal T1W, T2W and STIR with axial T2W images at C3-C4 to C6-C7.",
        findings:
          "Left paramedian disc herniation at C5-C6 indenting the thecal sac with cord compression at that level. " +
          "Intrinsic T2 hyperintensity within the cord at C5-C6 consistent with myelomalacia. " +
          "Cervical alignment is maintained. No significant foraminal narrowing at other levels.",
        impression: ["C5-C6 disc herniation with cervical cord compression and myelomalacia."],
      }),
    ],
    [
      // Two-phase protocol: contrast WAS given, so describing enhancement is
      // correct reporting. Reading "without contrast" out of this wording would
      // turn every enhanced brain MRI into a contrast contradiction.
      "Brain MRI with and without contrast, enhancement described",
      report({
        modality: "MR",
        studyDescription: "MRI BRAIN (WITH AND WITHOUT CONTRAST)",
        technique: "Multiplanar multisequence MRI of the brain with and without intravenous contrast.",
        findings:
          "A 14 mm extra-axial left frontal lesion broad-based to the dura, with vivid homogeneous enhancement. " +
          "No perilesional oedema. The ventricles are normal.",
        impression: ["Left frontal extra-axial lesion, likely neoplastic."],
      }),
    ],
    [
      "Whole-spine screen naming levels in every region",
      report({
        modality: "MR",
        studyDescription: "MRI WHOLE SPINE SCREENING (CERVICAL TO LUMBAR)",
        findings:
          "C5-C6 disc desiccation without canal narrowing. T4-T5 and T9-T10 discs are preserved. " +
          "L4-L5 broad-based disc bulge with mild canal narrowing. Conus ends at L1.",
        impression: ["Degenerative changes at C5-C6 and L4-L5, otherwise normal whole-spine screen."],
      }),
    ],
  ];

  for (const [name, input] of cases) {
    it(`says nothing: ${name}`, () => {
      expect(armed(input), name).toEqual([]);
    });
  }
});

describe("speaks up on defective reports (held out from the corpus)", () => {
  const cases: [string, string[], TextReportInput][] = [
    [
      "Enhancement described on a study performed without contrast",
      ["Q112"],
      report({
        modality: "MR",
        studyDescription: "MRI CERVICAL SPINE (PLAIN)",
        technique: "Multiplanar multisequence MRI of the cervical spine performed without contrast.",
        findings:
          "C5-C6 disc herniation compressing the cervical cord. There is diffuse dural enhancement " +
          "and an enhancing epidural collection. No fracture.",
        impression: ["C5-C6 disc herniation with myelopathy."],
      }),
    ],
    [
      // The worklist title says nothing about contrast here; only the Technique
      // line records that none was given. Reading the description alone leaves
      // this study with no contrast state at all, and the claim goes unmarked.
      "Enhancement on a study whose protocol, not its title, excludes contrast",
      ["Q112"],
      report({
        modality: "MR",
        studyDescription: "MRI BRAIN",
        technique: "Multiplanar multisequence MRI of the brain performed without intravenous contrast.",
        findings:
          "There is nodular pachymeningeal enhancement along the left convexity. " +
          "No restricted diffusion. No mass lesion.",
        impression: ["Meningeal enhancement — correlate clinically."],
      }),
    ],
    [
      "A contrast study whose Findings state no contrast was given",
      ["Q112"],
      report({
        modality: "CT",
        studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
        technique: "CT abdomen and pelvis with intravenous contrast, portal venous phase.",
        findings: "No contrast was administered. The liver is normal and the spleen is unremarkable.",
        impression: ["Normal CT of the abdomen and pelvis."],
      }),
    ],
    [
      "A tumour named in the Impression of a normal abdominal CT",
      ["Q117"],
      report({
        modality: "CT",
        studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
        findings:
          "The liver, spleen, pancreas and both kidneys are normal. No lymphadenopathy. No free fluid. " +
          "The appendix is not visualised and there is no periappendiceal stranding.",
        impression: ["Normal abdominal examination. Renal cell carcinoma is not excluded."],
      }),
    ],
    [
      "Peritonitis asserted where nothing peritoneal was described",
      ["Q117"],
      report({
        modality: "CT",
        studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
        findings:
          "A dilated blind-ending tubular structure in the right iliac fossa measuring 13 mm with wall thickening, " +
          "consistent with an inflamed appendix. No collection.",
        impression: ["Acute appendicitis. Generalised peritonitis."],
      }),
    ],
    [
      "An infection named over an unremarkable spine",
      ["Q117"],
      report({
        modality: "MR",
        studyDescription: "MRI LUMBO-SACRAL SPINE (PLAIN)",
        findings:
          "L4-L5 disc desiccation with a broad-based posterior bulge and mild canal narrowing. " +
          "No canal or foraminal stenosis at other levels. The conus is normal.",
        impression: ["L4-L5 disc degeneration. Feature suggestive of spondylodiscitis."],
      }),
    ],
    [
      "A lumbar level described in a cervical report",
      ["Q118"],
      report({
        modality: "MR",
        studyDescription: "MRI CERVICAL SPINE (PLAIN)",
        technique: "Sagittal T1W, T2W and STIR with axial T2W images at C3-C4 to C6-C7.",
        findings:
          "C4-C5 and C5-C6 discs are normal in signal and height. L4-L5 disc extrusion with left S1 root contact. " +
          "The dorsal spine is normal.",
        impression: ["Cervical spine normal. L4-L5 disc extrusion."],
      }),
    ],
    [
      // The one shape that keeps the sequence guard honest: a token doing level
      // work in a report that did not image it.
      "A thoracic fracture in a cervical report, with no sequence reading available",
      ["Q118"],
      report({
        modality: "MR",
        studyDescription: "MRI CERVICAL SPINE (PLAIN)",
        findings:
          "C3-C4 to C6-C6 discs are preserved with no cord signal change. T12 compression fracture with mild loss of height.",
        impression: ["No acute cervical disc or cord pathology."],
      }),
    ],
  ];

  for (const [name, expected, input] of cases) {
    it(`names the defect: ${name}`, () => {
      expect(armed(input), name).toEqual(expected);
    });
  }
});

describe("the three rules stay advisory", () => {
  // STEP 3 asks for clinically important checks on every authoring path without
  // turning the editor into a wall. Deterministic blockers live elsewhere; these
  // are heuristics over prose, so they warn, cost five points, and never stop a
  // report a radiologist wants to sign.
  for (const id of RULES) {
    it(`${id} is a heuristic warning, not a blocker`, () => {
      const entry = findRuleEntry(id);
      expect(entry?.tier).toBe("heuristic");
      expect(entry?.defaultSeverity).toBe("warning");
    });
  }

  it("deducts the same five points as every other text-tier warning", () => {
    const findings = evaluateTextTier({
      modality: "MR",
      studyDescription: "MRI CERVICAL SPINE (PLAIN)",
      findings: "L4-L5 disc extrusion with S1 root contact. Diffuse dural enhancement is present.",
      impression: ["Renal cell carcinoma."],
    }).findings;
    const clinical = findings.filter((f) => RULES.includes(f.ruleId));
    expect(clinical.length).toBeGreaterThan(0);
    for (const f of clinical) expect(f.deduct).toBe(5);
  });
});
