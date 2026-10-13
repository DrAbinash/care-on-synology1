import type { GoldenCase } from "./contract";

/** CT BRAIN (PLAIN) — the emergency study, where haemorrhage, shift and laterality
 *  are the three things a decision is made on within minutes. */
export const CT_BRAIN_CASES: GoldenCase[] = [
  {
    key: "ct-brain-normal",
    exam: "ct-brain-plain",
    polarity: "normal",
    summary: "Plain head CT after minor head injury.",
    study: {
      modality: "CT",
      studyDescription: "CT HEAD (PLAIN)",
      bodyPart: "BRAIN",
      regions: ["Brain"],
      reportTitle: "CT Head",
      sex: "M",
      age: "29Y",
      contrast: "plain",
    },
    indication: "Minor head injury with brief loss of consciousness, GCS 15, no focal deficit.",
    observations: [
      { id: "cn1", concept: "hemorrhage", source: "quick-select", region: "Brain", text: "No acute intracranial haemorrhage." },
      { id: "cn2", concept: "mass_effect", source: "quick-findings", region: "Brain", text: "No mass effect, midline shift or herniation." },
      { id: "cn3", concept: "ventricles", source: "quick-findings", region: "Brain", text: "Ventricles and basal cisterns are normal." },
      { id: "cn4", concept: "infarct", source: "quick-findings", region: "Brain", text: "No established territorial infarct." },
      { id: "cn5", concept: "calvarial_fracture", source: "manual", region: "Brain", text: "No fracture on the bone windows." },
      { id: "cn6", concept: "extracranial", source: "manual", region: "Brain", text: "No extra-axial collection." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Minor head injury with brief loss of consciousness; GCS 15.",
      technique: "Plain CT head without contrast, axial 5 mm slices with bone reconstructions.",
      findings:
        "No acute intracranial haemorrhage. No extra-axial collection. No mass effect, midline shift or herniation. Ventricles and basal cisterns are normal. No established territorial infarct. No fracture on the bone windows.",
      impression: ["Normal CT of the head. No acute intracranial pathology."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [{ concept: "ventricles", aliases: ["ventricles"] }],
      requiredNegatives: [
        { concept: "no_haemorrhage", aliases: ["no acute intracranial haemorrhage"], supportedBy: ["cn1"] },
        { concept: "no_fracture", aliases: ["no fracture"], supportedBy: ["cn5"] },
        { concept: "no_midline_shift", aliases: ["no mass effect, midline shift"], supportedBy: ["cn2"] },
      ],
      prohibitedStatements: [
        { id: "contrast-findings", aliases: ["post-contrast", "contrast enhancement", "gadolinium"], reason: "A plain head CT cannot show enhancement; the phrase implies an injection that never happened." },
        { id: "diffusion-claim", aliases: ["diffusion weighted", "restricted diffusion"], reason: "DWI is an MRI sequence; claiming it here invents a test." },
      ],
      impressionConcepts: [{ concept: "no_acute_pathology", aliases: ["no acute intracranial pathology", "normal ct"] }],
      anatomy: { regions: ["Brain"], levels: [], laterality: ["none"] },
    },
    defects: [
      {
        id: "ct-brain-normal.unsupported-contrast",
        class: "unsupportedContrast",
        harm: "An enhancement claim on a plain scan falsifies the examination performed.",
        append: { field: "findings", text: "No abnormal contrast enhancement." },
        expect: { ruleIds: ["Q112"] },
      },
      {
        id: "ct-brain-normal.anatomical-mismatch",
        class: "anatomicalMismatch",
        harm: "MRI vocabulary in a CT report makes the referrer believe an MRI was done.",
        append: { field: "findings", text: "No abnormal signal intensity on the FLAIR sequence." },
        expect: { ruleIds: ["Q111"] },
      },
      {
        id: "ct-brain-normal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "The cervical vessels were never imaged, so clearing them closes a question nobody asked.",
        append: { field: "findings", text: "The neck vessels are normal." },
        expect: {},
      },
    ],
  },
  {
    key: "ct-brain-subdural",
    exam: "ct-brain-plain",
    polarity: "abnormal",
    summary: "Right acute subdural haematoma with midline shift.",
    study: {
      modality: "CT",
      studyDescription: "CT HEAD (PLAIN)",
      bodyPart: "BRAIN",
      regions: ["Brain"],
      reportTitle: "CT Head",
      sex: "M",
      age: "71Y",
      contrast: "plain",
    },
    indication: "Fall with confusion and left hemiparesis, on warfarin.",
    observations: [
      { id: "cs1", concept: "subdural", source: "quick-select", region: "Brain", laterality: "right", severity: "acute", measurement: "12 mm", text: "Right acute convexity subdural haematoma, maximum thickness 12 mm." },
      { id: "cs2", concept: "midline_shift", source: "quick-select", region: "Brain", measurement: "7 mm", text: "Leftward subfalcine herniation with 7 mm midline shift." },
      { id: "cs3", concept: "mass_effect", source: "quick-findings", region: "Brain", text: "Effacement of the right frontal cortical sulci." },
      { id: "cs4", concept: "extracranial", source: "manual", region: "Brain", text: "No associated extradural haematoma." },
      { id: "cs5", concept: "calvarial_fracture", source: "manual", region: "Brain", text: "No fracture identified on the bone windows." },
    ],
    measurements: [{ key: "midlineShift", label: "Midline shift", value: 7, unit: "mm", high: 2 }],
    report: {
      clinicalHistory: "Fall with confusion and left hemiparesis, on warfarin.",
      technique: "Plain CT head without contrast, axial 5 mm slices with bone reconstructions.",
      findings:
        "Right acute convexity subdural haematoma with a maximum thickness of 12 mm, causing 7 mm of leftward midline shift with subfalcine herniation and effacement of the right frontal cortical sulci. No associated extradural haematoma. No fracture identified on the bone windows.",
      impression: [
        "Right acute subdural haematoma (12 mm) with 7 mm midline shift and subfalcine herniation.",
        "Urgent neurosurgical review.",
      ],
      recommendation: "Urgent neurosurgical opinion and reversal of anticoagulation.",
    },
    expect: {
      concepts: [
        { concept: "subdural", aliases: ["subdural haematoma", "subdural hematoma"], in: "findings" },
        { concept: "midline_shift", aliases: ["midline shift"] },
      ],
      requiredNegatives: [
        { concept: "no_extradural", aliases: ["no associated extradural haematoma"], supportedBy: ["cs4"] },
        { concept: "no_fracture", aliases: ["no fracture"], supportedBy: ["cs5"] },
      ],
      prohibitedStatements: [
        { id: "intraparenchymal-contusion", aliases: ["contusion", "intraparenchymal haemorrhage"], reason: "No parenchymal bleed was supplied; adding one changes the surgical plan." },
        { id: "chronic-component", aliases: ["chronic subdural", "mixed density subdural"], reason: "Acuity was supplied as acute." },
      ],
      impressionConcepts: [
        { concept: "laterality-right", aliases: ["right"] },
        { concept: "subdural", aliases: ["subdural"] },
        { concept: "shift", aliases: ["midline shift"] },
      ],
      anatomy: { regions: ["Brain"], levels: [], laterality: ["right", "left"] },
    },
    defects: [
      {
        id: "ct-brain-subdural.wrong-side",
        class: "laterality",
        harm: "Drilling the wrong side of the skull.",
        edit: { field: "impression", find: "Right acute subdural haematoma", replace: "Left acute subdural haematoma" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "ct-brain-subdural.measurement-altered",
        class: "measurement",
        harm: "Shift and thickness are the operative thresholds.",
        changeMeasurement: { key: "midlineShift", value: 2 },
        edit: { field: "findings", find: "causing 7 mm of leftward midline shift", replace: "causing 2 mm of leftward midline shift" },
        expect: { composerErrors: ["measurement_mutation"] },
      },
      {
        id: "ct-brain-subdural.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A bleed nobody described inside the brain changes the operation and the prognosis.",
        append: { field: "impression", text: "Large left intraparenchymal haemorrhage." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "ct-brain-subdural.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "A shifting subdural signed out as normal.",
        edit: { field: "impression", find: "Right acute subdural haematoma (12 mm) with 7 mm midline shift and subfalcine herniation.", replace: "Normal CT of the head." },
        expect: { ruleIds: ["Q114"] },
      },
    ],
  },
];
