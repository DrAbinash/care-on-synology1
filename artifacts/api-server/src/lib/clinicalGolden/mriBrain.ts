import type { GoldenCase } from "./contract";

/**
 * MRI BRAIN — the two cases the clinic reports most.
 *
 * The plain study is the interesting one for validation: the sequences acquired
 * are a clinical claim, so a sentence about enhancement on a study that never
 * had gadolinium is not a wording problem, it is a false statement about what
 * was done to the patient.
 */
export const MRI_BRAIN_CASES: GoldenCase[] = [
  {
    key: "mri-brain-normal",
    exam: "mri-brain",
    polarity: "normal",
    summary: "Plain MRI brain for headache with a normal neurological examination.",
    study: {
      modality: "MR",
      studyDescription: "MRI BRAIN (PLAIN)",
      bodyPart: "BRAIN",
      regions: ["Brain"],
      reportTitle: "MRI Brain",
      sex: "F",
      age: "34Y",
      contrast: "plain",
    },
    indication: "Six months of generalised headache. Normal neurological examination. No focal deficit.",
    observations: [
      { id: "b1", concept: "brain_parenchyma", source: "quick-select", region: "Brain", text: "The cerebral parenchyma is normal in signal and morphology." },
      { id: "b2", concept: "ventricles", source: "quick-select", region: "Brain", text: "The ventricles, sulci and cisterns are normal in size and configuration for age." },
      { id: "b3", concept: "diffusion", source: "quick-findings", region: "Brain", text: "No restricted diffusion to suggest acute infarction." },
      { id: "b4", concept: "midline", source: "quick-findings", region: "Brain", text: "No mass effect and no midline shift." },
      { id: "b5", concept: "hemorrhage", source: "quick-findings", region: "Brain", text: "No acute intracranial haemorrhage." },
      { id: "b6", concept: "brainstem", source: "manual", region: "Brain", text: "The brainstem, cerebellum and posterior fossa are unremarkable." },
      { id: "b7", concept: "normal_study", source: "manual", region: "Brain", text: "No space-occupying lesion." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Six months of generalised headache. Normal neurological examination.",
      technique: "MRI brain performed without intravenous contrast: sagittal T1W, axial T2W, axial FLAIR and DWI/ADC sequences.",
      findings:
        "The cerebral parenchyma is normal in signal and morphology. No space-occupying lesion. The ventricles, sulci and cisterns are normal in size and configuration for age. No restricted diffusion to suggest acute infarction. No acute intracranial haemorrhage. No mass effect and no midline shift. The brainstem, cerebellum and posterior fossa are unremarkable.",
      impression: ["Normal MRI of the brain on plain sequences."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "brain_parenchyma", aliases: ["cerebral parenchyma"] },
        { concept: "ventricles", aliases: ["ventricles"] },
        { concept: "brainstem", aliases: ["brainstem", "brain stem"] },
      ],
      requiredNegatives: [
        { concept: "no_acute_infarct", aliases: ["no restricted diffusion", "no acute infarct"], supportedBy: ["b3"] },
        { concept: "no_haemorrhage", aliases: ["no acute intracranial haemorrhage", "no acute intracranial hemorrhage"], supportedBy: ["b5"] },
        { concept: "no_mass_lesion", aliases: ["no space-occupying lesion", "no mass lesion"], supportedBy: ["b7"] },
        { concept: "no_midline_shift", aliases: ["no midline shift"], supportedBy: ["b4"] },
      ],
      prohibitedStatements: [
        { id: "gadolinium-administered", aliases: ["gadolinium", "post-contrast", "contrast enhancement"], reason: "The study is plain; saying it enhanced claims a procedure the patient did not have." },
        { id: "angiography-issued", aliases: ["MR angiography", "MRA", "no vascular stenosis"], reason: "No angiographic sequence was acquired, so no vessel can be called normal." },
        { id: "skull-bone-cleared", aliases: ["no fracture", "calvarial"], reason: "Bone detail is not the question a brain MRI answers and no bone window was reviewed." },
      ],
      impressionConcepts: [{ concept: "normal_study", aliases: ["normal mri"] }],
      anatomy: { regions: ["Brain"], levels: [], laterality: ["none"] },
    },
    defects: [
      {
        id: "brain-normal.unsupported-contrast",
        class: "unsupportedContrast",
        harm: "A plain study reports enhancement, so the referrer believes the patient received gadolinium.",
        append: { field: "findings", text: "No abnormal contrast enhancement is seen." },
        expect: { ruleIds: ["Q112"] },
      },
      {
        id: "brain-normal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A lesion nobody described enters the Impression of a normal study.",
        append: { field: "impression", text: "Small left frontal meningioma." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "brain-normal.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "The same conclusion printed twice reads as two separate findings on a quick review.",
        append: { field: "impression", text: "Normal MRI of the brain on plain sequences." },
        expect: { ruleIds: ["Q102"] },
      },
      {
        id: "brain-normal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "An unexamined vessel is declared normal, closing off a question nobody answered.",
        append: { field: "findings", text: "The intracranial vessels are normal." },
        expect: {},
      },
    ],
  },
  {
    key: "mri-brain-infarct",
    exam: "mri-brain",
    polarity: "abnormal",
    summary: "Acute right middle cerebral territory infarct on a plain MRI brain.",
    study: {
      modality: "MR",
      studyDescription: "MRI BRAIN (PLAIN)",
      bodyPart: "BRAIN",
      regions: ["Brain"],
      reportTitle: "MRI Brain",
      sex: "M",
      age: "68Y",
      contrast: "plain",
    },
    indication: "Sudden onset left facial and arm weakness, 3 hours.",
    observations: [
      { id: "i1", concept: "infarct", source: "quick-select", region: "Brain", laterality: "right", severity: "acute", text: "Restricted diffusion in the right middle cerebral artery territory cortex, consistent with acute infarction." },
      { id: "i2", concept: "diffusion", source: "quick-findings", region: "Brain", text: "Corresponding low signal on ADC mapping." },
      { id: "i3", concept: "hemorrhage", source: "quick-findings", region: "Brain", text: "No acute intracranial haemorrhage." },
      { id: "i4", concept: "midline_shift", source: "quick-findings", region: "Brain", measurement: "0 mm", text: "No mass effect and no midline shift." },
      { id: "i5", concept: "ventricles", source: "manual", region: "Brain", text: "Ventricles are normal in calibre and configuration." },
    ],
    measurements: [{ key: "midlineShift", label: "Midline shift", value: 0, unit: "mm", low: 0, high: 2 }],
    report: {
      clinicalHistory: "Sudden onset left facial and arm weakness, 3 hours.",
      technique: "MRI brain performed without intravenous contrast: sagittal T1W, axial T2W, axial FLAIR and DWI/ADC sequences.",
      findings:
        "Restricted diffusion in the right middle cerebral artery territory cortex with corresponding low signal on ADC mapping, consistent with acute infarction. No acute intracranial haemorrhage. No mass effect and no midline shift (0 mm). Ventricles are normal in calibre and configuration.",
      impression: ["Acute right middle cerebral artery territory infarct. No haemorrhage."],
      recommendation: "Urgent stroke team review and vascular imaging.",
    },
    expect: {
      concepts: [
        { concept: "infarct", aliases: ["acute infarct", "infarction"], in: "findings" },
        { concept: "diffusion", aliases: ["restricted diffusion"] },
      ],
      requiredNegatives: [
        { concept: "no_haemorrhage", aliases: ["no acute intracranial haemorrhage", "no haemorrhage"], supportedBy: ["i3"] },
        { concept: "no_midline_shift", aliases: ["no midline shift"], supportedBy: ["i4"] },
      ],
      prohibitedStatements: [
        { id: "haemorrhagic-transformation", aliases: ["haemorrhagic transformation", "hemorrhagic transformation"], reason: "No blood products were described, and asserting transformation changes thrombolysis eligibility." },
        { id: "chronicity-inflation", aliases: ["chronic infarct"], reason: "The supplied lesion is acute; adding a chronic infarct invents a second event." },
        { id: "vascular-occlusion", aliases: ["occlusion", "occluded"], reason: "No angiography was performed, so an occlusion cannot be reported." },
      ],
      impressionConcepts: [
        { concept: "infarct", aliases: ["infarct", "infarction"] },
        { concept: "laterality-right", aliases: ["right"] },
      ],
      anatomy: { regions: ["Brain"], levels: [], laterality: ["right"] },
    },
    defects: [
      {
        id: "brain-infarct.laterality",
        class: "laterality",
        harm: "The side of an infarct decides which limbs are examined and which carotid is investigated.",
        edit: { field: "impression", find: "Acute right middle cerebral", replace: "Acute left middle cerebral" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "brain-infarct.measurement-altered",
        class: "measurement",
        harm: "A midline shift value is the herniation question; changing it changes the triage.",
        changeMeasurement: { key: "midlineShift", value: 9 },
        edit: { field: "findings", find: "no midline shift (0 mm)", replace: "midline shift of 9 mm" },
        expect: {},
      },
      {
        id: "brain-infarct.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "An abnormal study signed out as normal is the single most dangerous contradiction.",
        edit: { field: "impression", find: "Acute right middle cerebral artery territory infarct. No haemorrhage.", replace: "No significant abnormality." },
        expect: { ruleIds: ["Q114"] },
      },
      {
        id: "brain-infarct.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A diagnosis nobody supplied reaches the referrer as fact.",
        append: { field: "impression", text: "Cerebral venous sinus thrombosis." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
    ],
  },
];
