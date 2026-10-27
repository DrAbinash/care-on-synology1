/**
 * Held-out clinical cases for the contradiction rules.
 *
 * These reports were written from routine radiology reporting — different
 * organs, different wording, different negation idioms from the golden corpus in
 * artifacts/api-server/src/lib/clinicalGolden. They exist so that the vocabulary
 * and the negation reading are tested against text the rules were NOT tuned on:
 * a rule that only works on the corpus it was written against is not a rule, and
 * every quiet line below is a report CARE must stop marking up.
 *
 * Where both Q103 (a normal phrase anywhere beside an asserted abnormality) and
 * the directional Q113/Q114 answer the same report, both are listed: they overlap
 * today, which is recorded as remediation item R-4 rather than papered over here.
 *
 * Each case is synthetic. None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { evaluateTextTier } from "./evaluate";
import type { TextReportInput } from "../contract";

const CONTRADICTION_RULES = ["Q103", "Q105", "Q113", "Q114", "Q116"];

function ruleIds(input: TextReportInput): string[] {
  return evaluateTextTier(input).findings.map((f) => f.ruleId);
}

function contradictions(input: TextReportInput): string[] {
  return ruleIds(input).filter((r) => CONTRADICTION_RULES.includes(r));
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
      "CT head, all negatives, three items under one 'no'",
      report({
        findings:
          "No acute intracranial haemorrhage. No mass effect, midline shift or herniation. " +
          "No extra-axial collection and no fracture. The ventricles and basal cisterns are normal in calibre.",
        impression: ["Normal CT of the head."],
        modality: "CT",
        studyDescription: "CT HEAD PLAIN",
      }),
    ],
    [
      // The impression names the diagnosis the Findings gave as a sign
      // ("restricted diffusion" → infarct). No text rule can prove that equivalence,
      // which is why Q113 waits for a whole-study normal claim instead of reading
      // every structure-level "unremarkable" as one.
      "MRI brain with a scoped negative beside a real infarct",
      report({
        findings:
          "Restricted diffusion in the left posterior cerebral artery territory. " +
          "Rest of the brain parenchyma is unremarkable.",
        impression: ["Left posterior cerebral artery territory infarct.", "No significant abnormality at other territories."],
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
      }),
    ],
    [
      "Ankle radiograph, British spelling, every term denied",
      report({
        findings: "No fracture, dislocation or joint effusion. The ankle mortise is intact. Soft tissues are unremarkable.",
        impression: ["Normal radiograph of the ankle."],
        modality: "CR",
        studyDescription: "X-RAY RIGHT ANKLE",
      }),
    ],
    [
      "Venous Doppler naming a segment list twice",
      report({
        findings:
          "The common femoral, femoral and popliteal veins are compressible with spontaneous phasic flow. " +
          "No intraluminal thrombus. No reflux on augmentation at the saphenofemoral junction.",
        impression: ["No deep vein thrombosis in the examined segments."],
        modality: "US",
        studyDescription: "DOPPLER LOWER LIMB VENOUS",
      }),
    ],
    [
      "Abdominal ultrasound with normal parenchyma and denied stones",
      report({
        findings:
          "The liver is normal in size, echo texture and contour, without focal lesion. " +
          "The gallbladder is thin-walled and without calculus. No intrabiliary dilatation. " +
          "The pancreas and spleen are unremarkable. Both kidneys are normal in size with no hydronephrosis.",
        impression: ["Normal abdominal ultrasound."],
        modality: "US",
        studyDescription: "USG WHOLE ABDOMEN",
      }),
    ],
    [
      "Screening mammogram, density stated as a composition category",
      report({
        findings:
          "Scattered fibroglandular densities, BI-RADS composition category B. " +
          "No dominant mass, no suspicious calcification and no architectural distortion. " +
          "Skin and nipples are unremarkable. No axillary lymphadenopathy.",
        impression: ["Negative — BI-RADS category 1. Routine recall."],
        modality: "MG",
        studyDescription: "BILATERAL SCREENING MAMMOGRAPHY",
      }),
    ],
    [
      "CT chest reporting bilateral lung disease honestly",
      report({
        findings:
          "Bilateral basal reticulation without honeycombing. No pleural effusion or pneumothorax. " +
          "The heart is normal in size and the mediastinum is within normal limits. No lymphadenopathy.",
        impression: ["No evidence of fibrotic interstitial lung disease."],
        modality: "CT",
        studyDescription: "HRCT CHEST",
      }),
    ],
    [
      // A hedge that travels with a denial is still a denial — "no likely
      // fracture" must not be read as a fracture.
      "Wrist radiograph, hedged denials",
      report({
        findings: "No likely fracture. No definite dislocation. The joint space is preserved and there is no effusion.",
        impression: ["Normal radiograph of the wrist."],
        modality: "CR",
        studyDescription: "X-RAY LEFT WRIST",
      }),
    ],
    [
      "Lumbar MRI with a chronic, unchanged finding",
      report({
        findings:
          "L4-L5 disc bulge with left neural foraminal narrowing, unchanged since the prior study. " +
          "No canal stenosis. The conus is normal in position and signal. No destructive lesion.",
        impression: ["Chronic left L4-L5 disc bulge without significant canal stenosis."],
        modality: "MR",
        studyDescription: "MRI LUMBAR SPINE PLAIN",
      }),
    ],
  ];

  for (const [name, input] of cases) {
    it(`says nothing contradictory: ${name}`, () => {
      expect(contradictions(input), name).toEqual([]);
    });
  }
});

describe("speaks up on contradictory reports (held out from the corpus)", () => {
  const cases: [string, TextReportInput, string[]][] = [
    [
      "acute subdural collection cleared as a normal head CT",
      report({
        findings: "A 9 mm right acute subdural collection with 4 mm of midline shift and effacement of the adjacent sulci.",
        impression: ["Normal CT of the head."],
        modality: "CT",
        studyDescription: "CT HEAD PLAIN",
      }),
      ["Q103", "Q114"],
    ],
    [
      "ascites and a nodular liver reported as a normal study",
      report({
        findings: "Moderate ascites with a nodular liver surface and splenomegaly. Both kidneys are normal.",
        impression: ["Normal study."],
        modality: "US",
        studyDescription: "USG WHOLE ABDOMEN",
      }),
      ["Q103", "Q114"],
    ],
    [
      "asserted nodule with metastasis only hedged, under a normal impression",
      report({
        findings: "A 6 mm right lower lobe pulmonary nodule; metastasis cannot be excluded.",
        impression: ["Normal CT of the chest."],
        modality: "CT",
        studyDescription: "CT CHEST",
      }),
      ["Q103", "Q114"],
    ],
    [
      "hydrocephalus asserted after a denied dilatation",
      report({
        findings: "The ventricles are not dilated and there is early hydrocephalus with transependymal flow.",
        impression: ["Normal MRI of the brain."],
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
      }),
      ["Q103", "Q114"],
    ],
    [
      "haemothorax in a report whose impression says no abnormality",
      report({
        findings: "A moderate right haemothorax with associated basal atelectasis.",
        impression: ["No abnormality on the CT study of the chest."],
        modality: "CT",
        studyDescription: "CT CHEST CONTRAST",
      }),
      ["Q103", "Q114"],
    ],
    [
      "American twin of the same thoracic blood",
      report({
        findings: "A moderate right hemothorax with associated basal atelectasis.",
        impression: ["Normal CT of the chest."],
        modality: "CT",
        studyDescription: "CT CHEST",
      }),
      ["Q103", "Q114"],
    ],
    [
      "pathology in Findings, Impression left blank",
      report({
        findings: "Acute fracture of the left tibial plateau with a joint effusion.",
        impression: [""],
        modality: "CR",
        studyDescription: "X-RAY LEFT KNEE",
      }),
      ["Q105"],
    ],
    [
      // The same hedge with no denial cue is not a denial: the abnormality stays
      // on the record, so a normal impression contradicts it.
      "hedged infarct under a normal impression",
      report({
        findings: "Possible early infarct in the right basal ganglia — correlation with DWI advised.",
        impression: ["Normal MRI of the brain."],
        modality: "MR",
        studyDescription: "MRI BRAIN PLAIN",
      }),
      ["Q103", "Q114"],
    ],
    [
      "BI-RADS 2 beside a spiculated mass",
      report({
        findings: "A 12 mm spiculated hyperdense mass in the left upper outer quadrant with associated microcalcification.",
        impression: ["Left breast BI-RADS category 2 — benign."],
        modality: "MG",
        studyDescription: "DIAGNOSTIC LEFT MAMMOGRAPHY",
      }),
      ["Q116"],
    ],
    [
      "BI-RADS 4 with nothing in the Findings to be about",
      report({
        findings: "No dominant mass. No suspicious calcification. No architectural distortion. Normal fibroglandular tissue.",
        impression: ["BI-RADS category 4 — tissue diagnosis advised."],
        modality: "MG",
        studyDescription: "DIAGNOSTIC LEFT MAMMOGRAPHY",
      }),
      ["Q116"],
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(`names the contradiction: ${name}`, () => {
      expect(contradictions(input), name).toEqual(expected);
    });
  }
});

describe("recorded limits of a text-only check (held out from the corpus)", () => {
  // This report IS clinically wrong and CARE does not currently see it. The
  // assertion locks the silence so the gap is measured rather than assumed, and
  // names what it would take to close it. If a future rule starts firing here the
  // suite goes red and the case belongs in the corpus register instead — that is
  // the point of asserting it.
  it("does not see a mass in the Impression beside structure-by-structure normal Findings", () => {
    // Q113 needs a whole-study normal claim ("Normal CT of the chest"). Findings
    // that clear the lungs, mediastinum and pleura one at a time are not that,
    // and treating them as one is the false-positive class this round removed.
    // Closing it needs the examined-structure map, not more prose matching.
    expect(contradictions(report({
      findings: "The lungs are clear. The mediastinum is within normal limits. No pleural abnormality.",
      impression: ["Right hilar mass, suspicious for malignancy."],
      modality: "CT",
      studyDescription: "CT CHEST CONTRAST",
    }))).toEqual([]);
  });
});

describe("dictation artifact rule keeps its edge (held out)", () => {
  const artifact = (findings: string) =>
    ruleIds(report({ findings, impression: ["Findings as described."] })).filter((r) => r === "Q115");

  it("catches a doubled word in mid-sentence", () => {
    expect(artifact("The liver is normal in size and the the spleen is unremarkable.")).toEqual(["Q115"]);
  });

  it("catches a doubled word whose partner is capitalised", () => {
    expect(artifact("Spleen is normal in size. The the portal vein is patent.")).toEqual(["Q115"]);
  });

  it("leaves an anatomical list alone", () => {
    expect(artifact("The common femoral, femoral and popliteal veins are compressible.")).toEqual([]);
  });

  it("leaves a sentence boundary alone", () => {
    expect(artifact("The spleen is normal. Normal in size and echotexture throughout.")).toEqual([]);
  });
});
