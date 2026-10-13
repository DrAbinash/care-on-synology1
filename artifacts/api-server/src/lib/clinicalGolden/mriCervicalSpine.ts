import type { GoldenCase } from "./contract";

/**
 * MRI CERVICAL SPINE.
 *
 * Levels are the spine report's identity: C5-C6 and C6-C7 are different
 * operations on different nerve roots. The corpus therefore states the supplied
 * levels explicitly, and the level defects below are the ones that matter most.
 */
export const MRI_CERVICAL_CASES: GoldenCase[] = [
  {
    key: "mri-cervical-normal",
    exam: "mri-cervical-spine",
    polarity: "normal",
    summary: "Normal cervical spine MRI for neck pain with no neurological deficit.",
    study: {
      modality: "MR",
      studyDescription: "MRI CERVICAL SPINE (PLAIN)",
      bodyPart: "SPINE_CERVICAL",
      regions: ["Cervical Spine"],
      reportTitle: "MRI Cervical Spine",
      sex: "F",
      age: "41Y",
      contrast: "plain",
    },
    indication: "Neck pain for 8 weeks, no radiculopathy, normal neurological examination.",
    observations: [
      { id: "cn1", concept: "alignment", source: "quick-findings", region: "Cervical Spine", text: "Normal cervical alignment." },
      { id: "cn2", concept: "cord", source: "quick-findings", region: "Cervical Spine", text: "The cervical cord is normal in calibre and signal." },
      { id: "cn3", concept: "canal_stenosis", source: "quick-select", region: "Cervical Spine", text: "No canal stenosis." },
      { id: "cn4", concept: "foraminal_stenosis", source: "quick-select", region: "Cervical Spine", text: "No neural foraminal narrowing." },
      { id: "cn5", concept: "disc_contour", source: "quick-findings", region: "Cervical Spine", text: "The discs are normal in contour and signal." },
      { id: "cn6", concept: "bone_marrow", source: "manual", region: "Cervical Spine", text: "Normal marrow signal. No destructive lesion." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Neck pain for 8 weeks. No radiculopathy.",
      technique: "MRI cervical spine performed without contrast: sagittal T1W, T2W and STIR with axial T2W images at C3-C4 to C6-C7.",
      findings:
        "Normal cervical alignment. The cervical cord is normal in calibre and signal. No canal stenosis. No neural foraminal narrowing. The discs are normal in contour and signal. Normal marrow signal, with no destructive lesion.",
      impression: ["Normal MRI of the cervical spine."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "alignment", aliases: ["cervical alignment"] },
        { concept: "cord", aliases: ["cervical cord"] },
      ],
      requiredNegatives: [
        { concept: "no_canal_stenosis", aliases: ["no canal stenosis"], supportedBy: ["cn3"] },
        { concept: "no_foraminal_stenosis", aliases: ["no neural foraminal narrowing", "no foraminal narrowing"], supportedBy: ["cn4"] },
      ],
      prohibitedStatements: [
        { id: "level-specific-disc-protrusion", aliases: ["disc protrusion at c", "annular fissure"], reason: "No disc abnormality was supplied; naming one at a level invents a surgical target." },
        { id: "lumbosacral-content", aliases: ["lumbosacral", "L4-L5", "L5-S1"], reason: "The lumbar spine was not examined." },
        { id: "contrast-administered", aliases: ["gadolinium", "post-contrast"], reason: "The study is plain." },
      ],
      impressionConcepts: [{ concept: "normal_study", aliases: ["normal mri"] }],
      anatomy: { regions: ["Cervical Spine"], levels: ["C3", "C4", "C5", "C6", "C7"], laterality: ["none"] },
    },
    defects: [
      {
        id: "cervical-normal.wrong-level-injected",
        class: "level",
        harm: "A level nobody imaged is now described, and a surgeon reads it as reviewed.",
        append: { field: "findings", text: "L4-L5 disc extrusion with left S1 root contact." },
        expect: { composerVectors: ["levelChanges"] },
      },
      {
        id: "cervical-normal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "The thoracic spine was not imaged, so 'dorsal spine is normal' is invented clearance.",
        append: { field: "findings", text: "The dorsal spine is normal." },
        expect: {},
      },
      {
        id: "cervical-normal.unsupported-contrast",
        class: "unsupportedContrast",
        harm: "Enhancement claimed on a plain study misstates what the patient received.",
        append: { field: "findings", text: "No abnormal gadolinium enhancement." },
        expect: { ruleIds: ["Q112"] },
      },
    ],
  },
  {
    key: "mri-cervical-cord-compression",
    exam: "mri-cervical-spine",
    polarity: "abnormal",
    summary: "C5-C6 left paracentral disc herniation with cord compression and myelomalacia.",
    study: {
      modality: "MR",
      studyDescription: "MRI CERVICAL SPINE (PLAIN)",
      bodyPart: "SPINE_CERVICAL",
      regions: ["Cervical Spine"],
      reportTitle: "MRI Cervical Spine",
      sex: "M",
      age: "52Y",
      contrast: "plain",
    },
    indication: "Progressive gait unsteadiness, hyperreflexia and bilateral Hoffmann signs.",
    observations: [
      { id: "ca1", concept: "disc_herniation", source: "quick-select", region: "Cervical Spine", level: "C5", laterality: "left", severity: "paracentral", text: "Left paracentral disc herniation at C5-C6 indenting the thecal sac." },
      { id: "ca2", concept: "cord_compression", source: "quick-select", region: "Cervical Spine", level: "C5", text: "Resultant compression of the cervical cord at C5-C6." },
      { id: "ca3", concept: "cord_signal", source: "quick-findings", region: "Cervical Spine", level: "C5", text: "Intrinsic T2 hyperintensity at the level of compression, consistent with myelomalacia." },
      { id: "ca4", concept: "canal_stenosis", source: "quick-findings", region: "Cervical Spine", level: "C5", measurement: "8 mm", text: "Associated developmental canal narrowing." },
      { id: "ca5", concept: "alignment", source: "quick-findings", region: "Cervical Spine", text: "Cervical alignment is maintained." },
      { id: "ca6", concept: "foraminal_stenosis", source: "manual", region: "Cervical Spine", level: "C5", text: "No significant foraminal narrowing at other levels." },
    ],
    measurements: [{ key: "canalApDiameter", label: "Canal AP diameter", value: 8, unit: "mm", low: 10 }],
    report: {
      clinicalHistory: "Progressive gait unsteadiness with hyperreflexia and bilateral Hoffmann signs.",
      technique: "MRI cervical spine performed without contrast: sagittal T1W, T2W and STIR with axial T2W images at C3-C4 to C6-C7.",
      findings:
        "Left paracentral disc herniation at C5-C6 indenting the thecal sac, with resultant compression of the cervical cord at that level and intrinsic T2 hyperintensity consistent with myelomalacia. Canal AP diameter 8 mm. Cervical alignment is maintained. No significant neural foraminal narrowing at other levels.",
      impression: [
        "C5-C6 left paracentral disc herniation with cervical cord compression and myelomalacia, in keeping with the clinical myelopathy.",
        "No significant abnormality at other cervical levels.",
      ],
      recommendation: "Neurosurgical opinion.",
    },
    expect: {
      concepts: [
        { concept: "disc_herniation", aliases: ["disc herniation"], in: "findings" },
        { concept: "cord_compression", aliases: ["cord compression", "compression of the cervical cord"] },
        { concept: "cord_signal", aliases: ["myelomalacia"] },
      ],
      requiredNegatives: [
        { concept: "alignment_maintained", aliases: ["alignment is maintained", "normal cervical alignment"], supportedBy: ["ca5"] },
      ],
      prohibitedStatements: [
        { id: "fracture", aliases: ["fracture", "dislocation"], reason: "No trauma was described and no fracture was supplied." },
        { id: "other-level-herniation", aliases: ["c6-c7 disc herniation", "c3-c4 disc herniation"], reason: "Only C5-C6 was supplied; a second herniation is a second surgical target." },
      ],
      impressionConcepts: [
        { concept: "level", aliases: ["c5-c6"] },
        { concept: "laterality-left", aliases: ["left"] },
        { concept: "cord_compression", aliases: ["cord compression"] },
      ],
      anatomy: { regions: ["Cervical Spine"], levels: ["C3", "C4", "C5", "C6", "C7"], laterality: ["left"] },
    },
    defects: [
      {
        id: "cervical-abnormal.wrong-level",
        class: "level",
        harm: "The wrong level is the wrong operation — a classic wrong-site surgery route.",
        edit: { field: "impression", find: "C5-C6 left paracentral", replace: "C6-C7 left paracentral" },
        expect: { composerVectors: ["levelChanges"] },
      },
      {
        id: "cervical-abnormal.laterality",
        class: "laterality",
        harm: "Side of a paracentral herniation predicts which root is compressed.",
        edit: { field: "impression", find: "left paracentral", replace: "right paracentral" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "cervical-abnormal.measurement-dropped",
        class: "measurement",
        harm: "The canal diameter is the operative threshold; without it the compression is unquantified.",
        dropMeasurement: "canalApDiameter",
        edit: { field: "findings", find: "Canal AP diameter 8 mm.", replace: "" },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "cervical-abnormal.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "Duplicating the operative conclusion reads as two compressions.",
        append: { field: "impression", text: "C5-C6 left paracentral disc herniation with cervical cord compression and myelomalacia, in keeping with the clinical myelopathy." },
        expect: { ruleIds: ["Q102"] },
      },
      {
        id: "cervical-abnormal.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "A compressed cord summarised as a normal study.",
        edit: { field: "impression", find: "C5-C6 left paracentral disc herniation with cervical cord compression and myelomalacia, in keeping with the clinical myelopathy.", replace: "Normal MRI of the cervical spine." },
        expect: { ruleIds: ["Q114"] },
      },
      {
        id: "cervical-abnormal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "An infection nobody described triggers antibiotics and an MRI with contrast.",
        append: { field: "impression", text: "Feature suggestive of spondylodiscitis." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "cervical-abnormal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "A focal lesion plus a whole-exam normal is the contradiction the global-normal rule exists for.",
        append: { field: "impression", text: "Otherwise normal study with no significant abnormality." },
        expect: { ruleIds: ["Q103", "Q114"] },
      },
    ],
  },
];
