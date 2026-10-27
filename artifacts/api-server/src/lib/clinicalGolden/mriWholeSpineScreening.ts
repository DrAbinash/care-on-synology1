import type { GoldenCase } from "./contract";

/**
 * MRI WHOLE-SPINE SCREENING.
 *
 * This is the examination where the boundary between "screened" and "diagnostic"
 * is a clinical claim: a limited screening protocol cannot clear a segment it
 * only surveyed, and the report must not read as a multiplanar multisequence
 * study of the whole spine.
 */
export const MRI_WHOLE_SPINE_CASES: GoldenCase[] = [
  {
    key: "mri-whole-spine-screening-normal",
    exam: "mri-whole-spine-screening",
    polarity: "normal",
    summary: "Whole-spine screening for scoliosis, no focal lesion.",
    study: {
      modality: "MR",
      studyDescription: "MRI WHOLE SPINE SCREENING (PLAIN)",
      bodyPart: "SPINE_WHOLE",
      regions: ["Whole Spine Screening", "Cervical Spine", "Dorsal Spine", "LS Spine"],
      protocol: "Whole spine screening (limited)",
      reportTitle: "MRI Whole Spine Screening",
      sex: "F",
      age: "16Y",
      contrast: "plain",
    },
    indication: "Adolescent idiopathic scoliosis, pre-bracing assessment.",
    observations: [
      { id: "ws1", concept: "scoliosis", source: "quick-findings", region: "Dorsal Spine", text: "Right thoracic scoliotic curve with a flexible thoracic segment." },
      { id: "ws2", concept: "alignment", source: "quick-findings", region: "Cervical Spine", text: "Cervical alignment is within normal limits." },
      { id: "ws3", concept: "cord", source: "quick-findings", region: "Whole Spine Screening", text: "The cord is normal in position and signal throughout the screened segments, with the conus at the L1 level." },
      { id: "ws4", concept: "bone_lesion", source: "quick-select", region: "Whole Spine Screening", text: "No focal vertebral lesion identified on the screening sequences." },
      { id: "ws5", concept: "canal_stenosis", source: "manual", region: "LS Spine", text: "No canal narrowing identified." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Adolescent idiopathic scoliosis, pre-bracing assessment.",
      technique: "MRI whole spine screening performed without contrast using limited rapid sagittal T1W and T2W sequences covering the cervical, dorsal and lumbar segments. Not a multiplanar multisequence diagnostic examination.",
      findings:
        "Right thoracic scoliotic curve with a flexible thoracic segment. Cervical alignment is within normal limits. The cord is normal in position and signal throughout the screened segments, with the conus at the L1 level. No focal vertebral lesion identified on the screening sequences. No canal narrowing identified.",
      impression: [
        "Scoliotic curve as described; no focal vertebral lesion or cord abnormality on this limited screening study.",
        "Screening technique only — this study does not replace a diagnostic examination of a symptomatic segment.",
      ],
      recommendation: "Clinical and radiological correlation.",
    },
    expect: {
      concepts: [
        { concept: "scoliosis", aliases: ["scoliotic curve", "scoliosis"] },
        { concept: "conus", aliases: ["conus"] },
      ],
      requiredNegatives: [
        { concept: "no_focal_lesion", aliases: ["no focal vertebral lesion"], supportedBy: ["ws4"] },
        { concept: "cord_normal", aliases: ["cord is normal in position and signal"], supportedBy: ["ws3"] },
      ],
      prohibitedStatements: [
        { id: "full-diagnostic-claim", aliases: ["multiplanar multisequence whole spine MRI", "whole spine MRI"], reason: "The screening protocol is limited; describing it as a full diagnostic study removes the reader's doubt about a segment that was only surveyed." },
        { id: "quantified-curve", aliases: ["cobb angle"], reason: "No Cobb measurement was supplied, and a number here drives bracing versus surgery." },
      ],
      impressionConcepts: [
        { concept: "scoliosis", aliases: ["scoliotic", "scoliosis"] },
        { concept: "screening-limitation", aliases: ["screening"] },
      ],
      anatomy: { regions: ["Cervical Spine", "Dorsal Spine", "LS Spine"], levels: ["L1"], laterality: ["right"] },
    },
    defects: [
      {
        id: "whole-spine.unsupported-screening-claim",
        class: "unsupportedScreeningClaim",
        harm: "A limited screening study presented as a full diagnostic whole-spine MRI clears segments it never properly assessed.",
        edit: { field: "technique", find: "Not a multiplanar multisequence diagnostic examination.", replace: "Multiplanar multisequence whole spine MRI." },
        expect: { composerWarnings: ["screening_wording_may_be_missing"] },
      },
      {
        id: "whole-spine.invented-measurement",
        class: "measurement",
        harm: "A Cobb angle nobody measured decides whether a child is braced.",
        append: { field: "findings", text: "Cobb angle 28 degrees." },
        expect: {},
      },
      {
        id: "whole-spine.wrong-level",
        class: "level",
        harm: "The conus level is a claim about tethering; moving it changes the neurosurgical question.",
        edit: { field: "findings", find: "the conus at the L1 level", replace: "the conus at the L4 level" },
        expect: { composerVectors: ["levelChanges"] },
      },
    ],
  },
  {
    key: "mri-whole-spine-screening-lesion",
    exam: "mri-whole-spine-screening",
    polarity: "abnormal",
    summary: "Whole-spine screening that finds a dorsal hemangioma and lumbar degenerative change.",
    study: {
      modality: "MR",
      studyDescription: "MRI WHOLE SPINE SCREENING (PLAIN)",
      bodyPart: "SPINE_WHOLE",
      regions: ["Whole Spine Screening", "Cervical Spine", "Dorsal Spine", "LS Spine"],
      protocol: "Whole spine screening (limited)",
      reportTitle: "MRI Whole Spine Screening",
      sex: "M",
      age: "58Y",
      contrast: "plain",
    },
    indication: "Back pain with weight loss; screen for metastatic disease.",
    observations: [
      { id: "wl1", concept: "bone_lesion", source: "quick-select", region: "Dorsal Spine", level: "T8", text: "A T8 vertebral body lesion with the vertical striation pattern of an atypical haemangioma." },
      { id: "wl2", concept: "disc_contour", source: "quick-findings", region: "LS Spine", level: "L4", text: "Mild lumbar disc bulges at L4-L5." },
      { id: "wl3", concept: "cord", source: "quick-findings", region: "Whole Spine Screening", text: "No cord signal abnormality within the screened segments." },
      { id: "wl4", concept: "metastasis", source: "manual", region: "Whole Spine Screening", text: "No additional focal vertebral lesion suspicious for metastasis on these screening sequences." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Back pain with weight loss; screen for metastatic disease.",
      technique: "MRI whole spine screening performed without contrast using limited rapid sagittal T1W and T2W sequences covering the cervical, dorsal and lumbar segments. Not a multiplanar multisequence diagnostic examination.",
      findings:
        "A T8 vertebral body lesion showing vertical striation, in keeping with an atypical haemangioma. Mild lumbar disc bulges at L4-L5. No cord signal abnormality within the screened segments. No additional focal vertebral lesion suspicious for metastasis on these screening sequences.",
      impression: [
        "T8 vertebral body lesion with features of an atypical haemangioma; no other lesion suspicious for metastasis on this limited screening study.",
        "Screening technique only — a symptomatic or equivocal segment requires a dedicated diagnostic examination.",
      ],
      recommendation: "Consider CT or dedicated MRI of the dorsal spine for the T8 lesion.",
    },
    expect: {
      concepts: [
        { concept: "bone_lesion", aliases: ["vertebral body lesion"], in: "findings" },
        { concept: "haemangioma", aliases: ["haemangioma", "hemangioma"] },
      ],
      requiredNegatives: [
        { concept: "no_cord_abnormality", aliases: ["no cord signal abnormality"], supportedBy: ["wl3"] },
      ],
      prohibitedStatements: [
        { id: "metastasis-asserted", aliases: ["metastatic deposit", "bone metastasis"], reason: "The supplied lesion was characterised as an atypical haemangioma; calling it metastatic starts oncology treatment." },
        { id: "pathological-fracture", aliases: ["pathological fracture", "compression fracture"], reason: "No fracture was supplied at T8." },
      ],
      impressionConcepts: [
        { concept: "level", aliases: ["t8"] },
        { concept: "haemangioma", aliases: ["haemangioma", "hemangioma"] },
        { concept: "screening-limitation", aliases: ["screening"] },
      ],
      anatomy: { regions: ["Dorsal Spine", "LS Spine"], levels: ["T8", "L4", "L5"], laterality: ["none"] },
    },
    defects: [
      {
        id: "whole-spine-lesion.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A benign-looking vertebral lesion reissued as metastasis changes the whole treatment plan.",
        append: { field: "impression", text: "T8 metastatic deposit with pathological fracture." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "whole-spine-lesion.unsupported-screening-claim",
        class: "unsupportedScreeningClaim",
        harm: "Clearing the whole spine for metastasis on a limited screen is a false reassurance.",
        edit: {
          field: "impression",
          find: "no other lesion suspicious for metastasis on this limited screening study",
          replace: "no evidence of metastatic disease anywhere in the spine",
        },
        expect: {},
      },
      {
        id: "whole-spine-lesion.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "The same lesion listed twice reads as two deposits.",
        append: { field: "impression", text: "T8 vertebral body lesion with features of an atypical haemangioma; no other lesion suspicious for metastasis on this limited screening study." },
        expect: { ruleIds: ["Q102"] },
      },
    ],
  },
];
