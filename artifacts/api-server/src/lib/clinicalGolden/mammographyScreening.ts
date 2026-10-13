import type { GoldenCase } from "./contract";

/** MAMMOGRAPHY — the one examination in this corpus whose output is a management
 *  category. A BI-RADS assignment the supplied findings do not support changes
 *  whether a woman is sent home or sent to biopsy. */
export const MAMMOGRAPHY_CASES: GoldenCase[] = [
  {
    key: "mammography-normal",
    exam: "mammography-screening",
    polarity: "normal",
    summary: "Routine bilateral screening mammography, BI-RADS 1.",
    study: {
      modality: "MG",
      studyDescription: "MAMMOGRAM BILATERAL SCREENING (CC AND MLO)",
      bodyPart: "BREAST",
      regions: ["Breast"],
      protocol: "Population breast screening",
      reportTitle: "Screening Mammography Bilateral",
      sex: "F",
      age: "51Y",
      contrast: "not-applicable",
    },
    indication: "Asymptomatic population screening invitation.",
    observations: [
      { id: "gn1", concept: "breast_composition", source: "quick-findings", region: "Breast", text: "Scattered fibroglandular densities, BI-RADS composition category B." },
      { id: "gn2", concept: "mass", source: "quick-select", region: "Breast", text: "No dominant mass." },
      { id: "gn3", concept: "suspicious_calcification", source: "quick-select", region: "Breast", text: "No suspicious cluster or grouped microcalcification." },
      { id: "gn4", concept: "architectural_distortion", source: "quick-findings", region: "Breast", text: "No architectural distortion or skin thickening." },
      { id: "gn5", concept: "axillary_nodes", source: "manual", region: "Axilla", text: "Both axillae contain small normal nodes." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Asymptomatic screening invitation.",
      technique: "Bilateral screening mammography, craniocaudal and mediolateral oblique projections on each side, with radiographic quality assessed as adequate.",
      findings:
        "Scattered fibroglandular densities (BI-RADS composition category B). No dominant mass. No suspicious cluster or grouped microcalcification. No architectural distortion or skin thickening. Both axillae contain small normal nodes.",
      impression: ["Negative. BI-RADS category 1. Routine screening interval recommended."],
      recommendation: "Repeat screening in 2 years.",
    },
    expect: {
      concepts: [
        { concept: "breast_composition", aliases: ["fibroglandular"], in: "findings" },
        { concept: "birads", aliases: ["bi-rads"] },
      ],
      requiredNegatives: [
        { concept: "no_mass", aliases: ["no dominant mass"], supportedBy: ["gn2"] },
        { concept: "no_microcalcification", aliases: ["no suspicious cluster", "no grouped microcalcification"], supportedBy: ["gn3"] },
        { concept: "no_architectural_distortion", aliases: ["no architectural distortion"], supportedBy: ["gn4"] },
      ],
      prohibitedStatements: [
        { id: "ultrasound-findings", aliases: ["targeted ultrasound", "sonographically"], reason: "No ultrasound was performed; citing it as a finding makes a recall look already resolved." },
        { id: "lesion-size", aliases: ["mm mass", "cm mass"], reason: "No lesion exists, so any size is invented." },
        { id: "biopsy-advice", aliases: ["core biopsy", "tissue diagnosis"], reason: "BI-RADS 1 does not warrant tissue sampling, and recommending it exposes the patient to an unnecessary procedure." },
      ],
      impressionConcepts: [
        { concept: "birads-1", aliases: ["category 1", "bi-rads 1"] },
        { concept: "negative", aliases: ["negative"] },
      ],
      anatomy: { regions: ["Breast"], levels: [], laterality: ["bilateral"] },
    },
    defects: [
      {
        id: "mammo-normal.unsupported-screening-claim",
        class: "unsupportedScreeningClaim",
        harm: "A screening study asserting cancer clearance is the over-reach that stops a symptomatic referral.",
        append: { field: "impression", text: "No evidence of breast malignancy in either breast." },
        expect: {},
      },
      {
        id: "mammo-normal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A BI-RADS 4 assignment nobody supplied triggers recall, anxiety and a biopsy.",
        append: { field: "impression", text: "BI-RADS category 4 — suspicious lesion, tissue diagnosis advised." },
        expect: {},
      },
      {
        id: "mammo-normal.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "Duplicated Findings sentence reads as an unreviewed template.",
        append: { field: "findings", text: "No dominant mass. No suspicious cluster or grouped microcalcification." },
        expect: { ruleIds: ["Q101"] },
      },
    ],
  },
  {
    key: "mammography-suspicious-mass",
    exam: "mammography-screening",
    polarity: "abnormal",
    summary: "Left breast spiculated mass with axillary nodes, BI-RADS 4C.",
    study: {
      modality: "MG",
      studyDescription: "MAMMOGRAM LEFT DIAGNOSTIC (CC AND MLO PLUS SPOT COMPRESSION)",
      bodyPart: "BREAST",
      regions: ["Breast"],
      reportTitle: "Diagnostic Mammography Left",
      sex: "F",
      age: "58Y",
      contrast: "not-applicable",
    },
    indication: "Palpable lump in the upper outer quadrant of the left breast for 6 weeks.",
    observations: [
      { id: "ga1", concept: "mass", source: "quick-select", region: "Breast", laterality: "left", measurement: "14 mm", text: "A 14 mm spiculated hyperdense mass in the upper outer quadrant of the left breast, confirmed on spot compression and two projections." },
      { id: "ga2", concept: "suspicious_calcification", source: "quick-findings", region: "Breast", laterality: "left", text: "Associated fine pleomorphic microcalcification within the mass." },
      { id: "ga3", concept: "axillary_nodes", source: "quick-findings", region: "Axilla", laterality: "left", text: "Left axillary nodes with loss of the fatty hilum, morphologically suspicious." },
      { id: "ga4", concept: "breast_composition", source: "manual", region: "Breast", text: "Heterogeneously dense breasts, BI-RADS composition category C." },
      { id: "ga5", concept: "right_breast", source: "manual", region: "Breast", laterality: "right", text: "The right breast shows no suspicious lesion." },
    ],
    measurements: [{ key: "lesionSize", label: "Lesion size", value: 14, unit: "mm" }],
    report: {
      clinicalHistory: "Palpable lump in the upper outer quadrant of the left breast for 6 weeks.",
      technique: "Diagnostic left mammography with craniocaudal and mediolateral oblique projections, spot compression and magnification views; right side screened with standard projections for comparison.",
      findings:
        "A 14 mm spiculated hyperdense mass is demonstrated in the upper outer quadrant of the left breast, confirmed on spot compression and on two projections, with associated fine pleomorphic microcalcification within it. Left axillary nodes show loss of the fatty hilum and are morphologically suspicious. Heterogeneously dense breasts (BI-RADS composition category C). The right breast shows no suspicious lesion.",
      impression: [
        "Left breast upper outer quadrant suspicious spiculated mass with associated microcalcification and morphologically abnormal left axillary nodes.",
        "BI-RADS category 4C — high suspicion for malignancy. Tissue diagnosis advised.",
      ],
      recommendation: "Targeted ultrasound with ultrasound-guided core biopsy, and discussion at the breast MDT.",
    },
    expect: {
      concepts: [
        { concept: "mass", aliases: ["spiculated", "mass"], in: "findings" },
        { concept: "suspicious_calcification", aliases: ["microcalcification", "microcalcification"] },
        { concept: "axillary_nodes", aliases: ["axillary nodes"] },
      ],
      requiredNegatives: [
        { concept: "right_breast_clear", aliases: ["right breast shows no suspicious lesion"], supportedBy: ["ga5"] },
      ],
      prohibitedStatements: [
        { id: "histological-diagnosis", aliases: ["invasive ductal carcinoma", "dcis", "fibroadenoma"], reason: "Mammography cannot give the histology; stating it precedes the biopsy it is meant to guide." },
        { id: "staging", aliases: ["t2n1", "stage ii", "tumour staging"], reason: "No staging examination has been performed." },
        { id: "benign-reassurance", aliases: ["benign lesion", "probably benign", "bi-rads category 2", "bi-rads category 3"], reason: "A spiculated mass with abnormal nodes cannot be downgraded; a lower category delays diagnosis." },
      ],
      impressionConcepts: [
        { concept: "laterality-left", aliases: ["left"] },
        { concept: "birads-4", aliases: ["category 4", "4c"] },
        { concept: "biopsy", aliases: ["tissue diagnosis"] },
      ],
      anatomy: { regions: ["Breast", "Axilla"], levels: [], laterality: ["left", "right"] },
    },
    defects: [
      {
        id: "mammo-abnormal.wrong-side",
        class: "laterality",
        harm: "Biopsy of the wrong breast.",
        edit: { field: "impression", find: "Left breast upper outer quadrant", replace: "Right breast upper outer quadrant" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "mammo-abnormal.measurement-dropped",
        class: "measurement",
        harm: "Lesion size is a staging input and the baseline for response assessment.",
        dropMeasurement: "lesionSize",
        edit: { field: "findings", find: "A 14 mm spiculated hyperdense mass", replace: "A spiculated hyperdense mass" },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "mammo-abnormal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "Histology asserted before any tissue has been taken.",
        append: { field: "impression", text: " appearances are diagnostic of invasive ductal carcinoma." },
        expect: { composerVectors: ["unsupportedMentions"] },
      },
      {
        id: "mammo-abnormal.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "A BI-RADS downgrade of a suspicious mass takes the patient out of the cancer pathway.",
        edit: { field: "impression", find: "BI-RADS category 4C — high suspicion for malignancy. Tissue diagnosis advised.", replace: "BI-RADS category 2 — benign." },
        expect: {},
      },
    ],
  },
];
