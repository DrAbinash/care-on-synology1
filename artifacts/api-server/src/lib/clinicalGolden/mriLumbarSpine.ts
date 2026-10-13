import type { GoldenCase } from "./contract";

/** MRI LUMBAR SPINE — the highest-volume spine study and the one where a level
 *  or a side error changes which root is explored. */
export const MRI_LUMBAR_CASES: GoldenCase[] = [
  {
    key: "mri-lumbar-normal",
    exam: "mri-lumbar-spine",
    polarity: "normal",
    summary: "Normal lumbar spine MRI for mechanical low back pain.",
    study: {
      modality: "MR",
      studyDescription: "MRI LUMBO-SACRAL SPINE (PLAIN)",
      bodyPart: "SPINE_LS",
      regions: ["LS Spine"],
      reportTitle: "MRI Lumbo-sacral Spine",
      sex: "M",
      age: "37Y",
      contrast: "plain",
    },
    indication: "Low back pain for 3 months, no radiculopathy, normal examination.",
    observations: [
      { id: "ln1", concept: "alignment", source: "quick-findings", region: "LS Spine", text: "Normal lumbar alignment." },
      { id: "ln2", concept: "cord", source: "quick-findings", region: "LS Spine", text: "The conus terminates normally at L1 with normal signal." },
      { id: "ln3", concept: "disc_contour", source: "quick-findings", region: "LS Spine", text: "The lumbar discs are normal in contour and hydration." },
      { id: "ln4", concept: "canal_stenosis", source: "quick-select", region: "LS Spine", text: "No canal stenosis." },
      { id: "ln5", concept: "foraminal_stenosis", source: "quick-select", region: "LS Spine", text: "No neural foraminal narrowing." },
      { id: "ln6", concept: "bone_marrow", source: "manual", region: "LS Spine", text: "Normal marrow signal. No destructive lesion." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Low back pain for 3 months, no radiculopathy.",
      technique: "MRI lumbo-sacral spine performed without contrast: sagittal T1W, T2W and STIR with axial T2W images at L3-L4 to L5-S1.",
      findings:
        "Normal lumbar alignment. The conus terminates normally at L1 with normal signal. The lumbar discs are normal in contour and hydration. No canal stenosis. No neural foraminal narrowing. Normal marrow signal, with no destructive lesion.",
      impression: ["Normal MRI of the lumbo-sacral spine."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "alignment", aliases: ["lumbar alignment"] },
        { concept: "conus", aliases: ["conus"] },
      ],
      requiredNegatives: [
        { concept: "no_canal_stenosis", aliases: ["no canal stenosis"], supportedBy: ["ln4"] },
        { concept: "no_foraminal_stenosis", aliases: ["no neural foraminal narrowing"], supportedBy: ["ln5"] },
      ],
      prohibitedStatements: [
        { id: "cervical-content", aliases: ["cervical cord", "C5-C6"], reason: "The cervical spine was not examined." },
        { id: "listhesis", aliases: ["spondylolisthesis", "anterolisthesis"], reason: "Alignment was supplied as normal; a slip is a different operation." },
      ],
      impressionConcepts: [{ concept: "normal_study", aliases: ["normal mri"] }],
      anatomy: { regions: ["LS Spine"], levels: ["L1", "L3", "L4", "L5", "S1"], laterality: ["none"] },
    },
    defects: [
      {
        id: "lumbar-normal.level-drift",
        class: "level",
        harm: "Naming an unexamined thoracic level as abnormal sends the patient to the wrong site.",
        append: { field: "findings", text: "T7-T8 disc protrusion with cord compression." },
        expect: { composerVectors: ["levelChanges"] },
      },
      {
        id: "lumbar-normal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A slip nobody described is read as instability and fused.",
        append: { field: "impression", text: "L4-L5 isthmic spondylolisthesis." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
    ],
  },
  {
    key: "mri-lumbar-herniation",
    exam: "mri-lumbar-spine",
    polarity: "abnormal",
    summary: "Left L4-L5 disc extrusion with canal stenosis and left L5 root contact.",
    study: {
      modality: "MR",
      studyDescription: "MRI LUMBO-SACRAL SPINE (PLAIN)",
      bodyPart: "SPINE_LS",
      regions: ["LS Spine"],
      reportTitle: "MRI Lumbo-sacral Spine",
      sex: "F",
      age: "45Y",
      contrast: "plain",
    },
    indication: "Low back pain with left L5 radiculopathy and a weak extensor hallucis longus.",
    observations: [
      { id: "la1", concept: "disc_herniation", source: "quick-select", region: "LS Spine", level: "L4", laterality: "left", severity: "extrusion", text: "Left paracentral disc extrusion at L4-L5." },
      { id: "la2", concept: "canal_stenosis", source: "quick-select", region: "LS Spine", level: "L4", severity: "moderate", measurement: "8 mm", text: "Moderate canal stenosis at L4-L5." },
      { id: "la3", concept: "nerve_root_contact", source: "quick-findings", region: "LS Spine", level: "L4", laterality: "left", text: "Contact of the traversing left L5 nerve root." },
      { id: "la4", concept: "disc_desiccation", source: "quick-findings", region: "LS Spine", level: "L5", text: "Early desiccation change at L5-S1 without disc herniation." },
      { id: "la5", concept: "alignment", source: "manual", region: "LS Spine", text: "Lumbar alignment maintained." },
      { id: "la6", concept: "conus", source: "manual", region: "LS Spine", text: "The conus is normal in position and signal." },
    ],
    measurements: [{ key: "canalApDiameter", label: "Canal AP diameter", value: 8, unit: "mm", low: 10 }],
    report: {
      clinicalHistory: "Low back pain with left L5 radiculopathy and weak extensor hallucis longus.",
      technique: "MRI lumbo-sacral spine performed without contrast: sagittal T1W, T2W and STIR with axial T2W images at L3-L4 to L5-S1.",
      findings:
        "Left paracentral disc extrusion at L4-L5 causing moderate canal stenosis, with the canal AP diameter measuring 8 mm, and contact of the traversing left L5 nerve root. Early desiccation change at L5-S1 without disc herniation. Lumbar alignment maintained. The conus is normal in position and signal.",
      impression: [
        "Left L4-L5 paracentral disc extrusion with moderate canal stenosis and left L5 nerve root contact, matching the clinical picture.",
        "No disc herniation at other levels.",
      ],
      recommendation: "Spinal surgical opinion.",
    },
    expect: {
      concepts: [
        { concept: "disc_herniation", aliases: ["disc extrusion", "disc herniation"], in: "findings" },
        { concept: "canal_stenosis", aliases: ["canal stenosis"] },
      ],
      requiredNegatives: [
        { concept: "no_other_herniation", aliases: ["no disc herniation at other levels", "without disc herniation"], supportedBy: ["la4"] },
        { concept: "alignment_maintained", aliases: ["alignment maintained"], supportedBy: ["la5"] },
      ],
      prohibitedStatements: [
        { id: "cauda-equinica", aliases: ["cauda equina syndrome", "cauda equina compression"], reason: "Conus and cauda were reported normal; this phrase triggers emergency surgery." },
        { id: "right-sided-lesion", aliases: ["right paracentral", "right L5"], reason: "The extrusion was supplied on the left only." },
        { id: "spondylolisthesis", aliases: ["spondylolisthesis"], reason: "Alignment was supplied as maintained." },
      ],
      impressionConcepts: [
        { concept: "level", aliases: ["l4-l5"] },
        { concept: "laterality-left", aliases: ["left"] },
        { concept: "canal_stenosis", aliases: ["canal stenosis"] },
      ],
      anatomy: { regions: ["LS Spine"], levels: ["L1", "L3", "L4", "L5", "S1"], laterality: ["left"] },
    },
    defects: [
      {
        id: "lumbar-abnormal.wrong-level",
        class: "level",
        harm: "Exploring L5-S1 for an L4-L5 lesion leaves the pathology untouched.",
        edit: { field: "impression", find: "Left L4-L5 paracentral", replace: "Left L5-S1 paracentral" },
        expect: { composerVectors: ["levelChanges"] },
      },
      {
        id: "lumbar-abnormal.wrong-side",
        class: "laterality",
        harm: "A left radiculopathy reported on the right inverts the clinical picture.",
        edit: { field: "impression", find: "Left L4-L5", replace: "Right L4-L5" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "lumbar-abnormal.measurement-dropped",
        class: "measurement",
        harm: "Stenosis severity without the diameter cannot be graded or followed up.",
        dropMeasurement: "canalApDiameter",
        edit: { field: "findings", find: "with the canal AP diameter measuring 8 mm", replace: "" },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "lumbar-abnormal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "A whole-exam normal alongside an extruding disc hides the operative lesion.",
        append: { field: "impression", text: "Normal study with no significant abnormality." },
        expect: { ruleIds: ["Q103", "Q114"] },
      },
      {
        id: "lumbar-abnormal.anatomical-mismatch",
        class: "anatomicalMismatch",
        harm: "CT vocabulary inside an MR report tells the referrer a different test was done.",
        append: { field: "findings", text: "Hounsfield units within the disc are low." },
        expect: { ruleIds: ["Q111"] },
      },
    ],
  },
];
