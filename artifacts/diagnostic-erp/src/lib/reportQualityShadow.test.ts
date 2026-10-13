import { describe, it, expect } from "vitest";
import { computeParity } from "./reportQualityShadow";
import { runQualityEngine, textParityScorer } from "@workspace/report-quality";
import { buildQualityContext } from "./reportQualityShadow";
import type { QualityInput } from "./reportValidator";

// Golden parity fixtures — representative reports across the four modalities the
// engine must serve. Each exercises a different mix of completeness gaps and
// consistency rules so parity is proven on real-shaped inputs, not empty ones.
const FIXTURES: Record<string, QualityInput> = {
  "MRI Brain (laterality + contradiction)": {
    modality: "MR",
    studyDescription: "MRI BRAIN PLAIN",
    sex: "male",
    age: "54",
    technique: "Multiplanar multisequence MRI of the brain was performed.",
    clinicalHistory: "Left-sided weakness.",
    findings:
      "Acute infarct in the right MCA territory with restricted diffusion. " +
      "No mass effect or midline shift. Rest of the brain parenchyma is unremarkable.",
    impression: ["Acute right MCA territory infarct.", "Left cerebral hemisphere appears normal."],
    recommendation: "Clinical correlation and stroke workup advised.",
  },
  "USG Abdomen (missing technique + history)": {
    modality: "US",
    studyDescription: "USG WHOLE ABDOMEN",
    sex: "female",
    age: "37",
    findings:
      "Liver is normal in size and echotexture. Gall bladder shows a hyperechoic focus with acoustic shadowing. " +
      "Both kidneys are normal.",
    impression: ["Cholelithiasis."],
    recommendation: "Surgical consultation.",
  },
  "CT Chest (non-contrast, cross-modality wording)": {
    modality: "CT",
    studyDescription: "NCCT CHEST",
    sex: "male",
    age: "63",
    technique: "Non-contrast CT of the chest.",
    clinicalHistory: "Chronic cough.",
    findings:
      "A spiculated nodule is noted in the right upper lobe. No pleural effusion. " +
      "Mediastinum is within normal limits.",
    impression: ["Right upper lobe pulmonary nodule, likely neoplastic — recommend follow-up."],
    recommendation: "PET-CT and pulmonology referral.",
  },
  "X-Ray Knee (sparse, missing sections)": {
    modality: "CR",
    studyDescription: "X-RAY LEFT KNEE AP/LAT",
    sex: "female",
    age: "29",
    findings: "No fracture or dislocation. Joint spaces are preserved. Soft tissues are unremarkable.",
    impression: ["No acute bony injury."],
  },
  // Held out from the golden corpus, and added because the contradiction rules
  // now read one shared vocabulary: these are the shapes that used to make the
  // two paths disagree — everything denied, both spellings, a segment list, and
  // a BI-RADS category that only the new Q116 can see.
  "CT Head (every pathology term present, all of them denied)": {
    modality: "CT",
    studyDescription: "CT HEAD PLAIN",
    sex: "male",
    age: "61",
    technique: "Plain CT head without contrast, axial 5 mm slices with bone reconstructions.",
    clinicalHistory: "Dizziness.",
    findings:
      "No acute intracranial haemorrhage. No mass effect, midline shift or herniation. " +
      "No extra-axial collection and no fracture. The ventricles and basal cisterns are normal in calibre.",
    impression: ["Normal CT of the head."],
    recommendation: "Clinical correlation.",
  },
  "Venous Doppler (segment list that repeats a word)": {
    modality: "US",
    studyDescription: "DOPPLER LOWER LIMB VENOUS",
    sex: "female",
    age: "44",
    technique: "Grayscale and colour Doppler of the right lower limb deep venous system with compression.",
    clinicalHistory: "Right leg swelling.",
    findings:
      "The common femoral, femoral and popliteal veins are compressible with spontaneous phasic flow. " +
      "No intraluminal thrombus. No reflux on augmentation at the saphenofemoral junction.",
    impression: ["No deep vein thrombosis in the examined segments."],
    recommendation: "Clinical correlation.",
  },
  "Mammography (BI-RADS category contradicts the Findings)": {
    modality: "MG",
    studyDescription: "DIAGNOSTIC LEFT MAMMOGRAPHY",
    sex: "female",
    age: "58",
    technique: "Diagnostic left mammography with spot compression and magnification views.",
    clinicalHistory: "Palpable left breast lump.",
    findings:
      "A 12 mm spiculated hyperdense mass in the left upper outer quadrant with grouped microcalcification. " +
      "The right breast is unremarkable.",
    impression: ["Left BI-RADS category 2 — benign. Routine follow-up."],
    recommendation: "Ultrasound correlation.",
  },
};

describe("report-quality shadow parity (legacy vs canonical engine)", () => {
  for (const [name, input] of Object.entries(FIXTURES)) {
    it(`matches the legacy score and issues exactly — ${name}`, () => {
      const p = computeParity(input);
      expect(p.engineScore).toBe(p.legacyScore);
      expect(p.engineIssues).toEqual(p.legacyIssues);
      expect(p.scoreMatches).toBe(true);
      expect(p.issuesMatch).toBe(true);
      expect(p.warningsMatch).toBe(true);
    });
  }

  it("keeps every free-text finding advisory — no blockers from the text tier", () => {
    for (const input of Object.values(FIXTURES)) {
      const report = runQualityEngine(buildQualityContext(input), { scorer: textParityScorer });
      expect(report.blockingCount).toBe(0);
      expect(report.findings.every((f) => f.severity === "warning")).toBe(true);
      expect(report.findings.every((f) => f.tier === "heuristic")).toBe(true);
    }
  });

  it("reports honest coverage: structured-tier rules are notEvaluated without structured data", () => {
    const report = runQualityEngine(buildQualityContext(FIXTURES["USG Abdomen (missing technique + history)"]), {
      scorer: textParityScorer,
    });
    // Phase 1 registers only the text tier; no structured rules exist yet, so
    // notEvaluated is empty (nothing was skipped for missing data).
    expect(report.notEvaluated).toEqual([]);
    expect(report.evaluatedRuleCount).toBeGreaterThan(0);
  });
});
