import type { GoldenCase } from "./contract";

/** LOWER-LIMB VENOUS DOPPLER — a study whose entire clinical product is "is there
 *  thrombus, in which veins, on which side, and was the calf actually looked at". */
export const DOPPLER_LOWER_LIMB_CASES: GoldenCase[] = [
  {
    key: "doppler-lower-limb-normal",
    exam: "doppler-lower-limb-venous",
    polarity: "normal",
    summary: "Normal right lower limb venous Doppler, no deep vein thrombosis.",
    study: {
      modality: "US",
      studyDescription: "DOPPLER RIGHT LOWER LIMB VENOUS",
      bodyPart: "EXTREMITY_VENOUS",
      regions: ["Right Lower Limb"],
      reportTitle: "Venous Doppler Right Lower Limb",
      sex: "F",
      age: "52Y",
      contrast: "not-applicable",
    },
    indication: "Right calf swelling and pain after a long flight; Wells score 2.",
    observations: [
      { id: "dn1", concept: "compressibility", source: "quick-findings", region: "Right Lower Limb", laterality: "right", text: "The right common femoral, femoral and popliteal veins are fully compressible with normal wall-to-wall flow." },
      { id: "dn2", concept: "thrombus", source: "quick-select", region: "Right Lower Limb", laterality: "right", text: "No intraluminal echogenic thrombus." },
      { id: "dn3", concept: "phlebectasia", source: "quick-findings", region: "Right Lower Limb", text: "No superficial venous reflux at the saphenofemoral junction." },
      { id: "dn4", concept: "soft_tissue", source: "manual", region: "Right Lower Limb", text: "No Baker's cyst or popliteal collection." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Right calf swelling and pain after a long flight.",
      technique: "Grayscale and colour Doppler of the right lower limb deep venous system with compression ultrasonography, including the common femoral, femoral and popliteal veins.",
      findings:
        "The right common femoral, femoral and popliteal veins are fully compressible with normal wall-to-wall flow. No intraluminal echogenic thrombus. No superficial venous reflux at the saphenofemoral junction. No Baker's cyst or popliteal collection.",
      impression: ["No deep vein thrombosis in the examined right lower limb deep venous system."],
      recommendation: "Clinical correlation; repeat imaging if symptoms persist.",
    },
    expect: {
      concepts: [
        { concept: "compressibility", aliases: ["compressible"], in: "findings" },
        { concept: "popliteal_vein", aliases: ["popliteal vein"] },
      ],
      requiredNegatives: [
        { concept: "no_thrombus", aliases: ["no intraluminal echogenic thrombus", "no thrombus"], supportedBy: ["dn2"] },
        { concept: "no_reflux", aliases: ["no superficial venous reflux"], supportedBy: ["dn3"] },
      ],
      prohibitedStatements: [
        { id: "left-limb-cleared", aliases: ["left lower limb", "left leg"], reason: "Only the right limb was examined; clearing the left is a claim about a limb nobody scanned." },
        { id: "calf-veins-cleared", aliases: ["calf veins are patent", "posterior tibial veins normal", "peroneal veins normal"], reason: "The examined segment list stops at the popliteal vein, so the calf cannot be declared normal." },
        { id: "pelvic-veins-cleared", aliases: ["iliac veins are patent", "IVC normal"], reason: "Retroperitoneal veins are outside this examination." },
      ],
      impressionConcepts: [{ concept: "no_dvt", aliases: ["no deep vein thrombosis"] }],
      anatomy: { regions: ["Right Lower Limb"], levels: [], laterality: ["right"] },
    },
    defects: [
      {
        id: "doppler-normal.laterality-vs-order",
        class: "laterality",
        harm: "The patient's left leg is now documented as clear, and the right stays unexamined.",
        edit: { field: "findings", find: "The right common femoral", replace: "The left common femoral" },
        expect: { ruleIds: ["Q107"] },
      },
      {
        id: "doppler-normal.unsupported-screening-claim",
        class: "unsupportedScreeningClaim",
        harm: "Clearing unexamined calf veins is the classic false reassurance that misses an isolated distal DVT.",
        append: { field: "findings", text: "The calf veins including posterior tibial and peroneal veins are patent." },
        expect: {},
      },
      {
        id: "doppler-normal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A thrombus nobody described starts anticoagulation.",
        append: { field: "impression", text: "Acute occlusive thrombus in the right femoral vein." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
    ],
  },
  {
    key: "doppler-lower-limb-dvt",
    exam: "doppler-lower-limb-venous",
    polarity: "abnormal",
    summary: "Acute deep vein thrombosis of the right popliteal vein.",
    study: {
      modality: "US",
      studyDescription: "DOPPLER RIGHT LOWER LIMB VENOUS",
      bodyPart: "EXTREMITY_VENOUS",
      regions: ["Right Lower Limb"],
      reportTitle: "Venous Doppler Right Lower Limb",
      sex: "M",
      age: "61Y",
      contrast: "not-applicable",
    },
    indication: "Acute right calf pain and swelling, Wells score 4.",
    observations: [
      { id: "da1", concept: "thrombus", source: "quick-select", region: "Right Lower Limb", laterality: "right", severity: "acute", text: "The right popliteal vein is non-compressible and contains heterogeneous intraluminal thrombus." },
      { id: "da2", concept: "flow", source: "quick-findings", region: "Right Lower Limb", laterality: "right", text: "Absent colour flow and no spontaneous or phasic signal in the popliteal vein." },
      { id: "da3", concept: "proximal_extent", source: "manual", region: "Right Lower Limb", text: "The common femoral and femoral veins remain compressible with patent lumina." },
      { id: "da4", concept: "calf_veins", source: "manual", region: "Right Lower Limb", text: "Calf veins were not assessed." },
    ],
    measurements: [],
    report: {
      clinicalHistory: "Acute right calf pain and swelling.",
      technique: "Grayscale and colour Doppler of the right lower limb deep venous system with compression ultrasonography, including the common femoral, femoral and popliteal veins.",
      findings:
        "The right popliteal vein is non-compressible and contains heterogeneous intraluminal thrombus, with absent colour flow and no spontaneous or phasic signal at that level. The common femoral and femoral veins remain compressible with patent lumina. Calf veins were not assessed.",
      impression: [
        "Acute deep vein thrombosis of the right popliteal vein.",
        "No thrombus in the examined common femoral and femoral veins. Calf veins not assessed.",
      ],
      recommendation: "Anticoagulation as per protocol and clinical review.",
    },
    expect: {
      concepts: [
        { concept: "thrombus", aliases: ["intraluminal thrombus", "thrombus"], in: "findings" },
        { concept: "compressibility", aliases: ["non-compressible"] },
      ],
      requiredNegatives: [
        { concept: "proximal_veins_patent", aliases: ["remain compressible", "patent lumina"], supportedBy: ["da3"] },
      ],
      prohibitedStatements: [
        { id: "calf-veins-cleared", aliases: ["calf veins are patent", "no calf vein thrombosis", "calf veins normal"], reason: "The report itself states the calf veins were not assessed." },
        { id: "pe-claim", aliases: ["pulmonary embolism"], reason: "No chest imaging was performed; asserting embolism changes the treatment to thrombolysis territory." },
      ],
      impressionConcepts: [
        { concept: "dvt", aliases: ["deep vein thrombosis"] },
        { concept: "laterality-right", aliases: ["right"] },
        { concept: "popliteal", aliases: ["popliteal"] },
      ],
      anatomy: { regions: ["Right Lower Limb"], levels: [], laterality: ["right"] },
    },
    defects: [
      {
        id: "doppler-dvt.wrong-side",
        class: "laterality",
        harm: "Anticoagulation justified by a clot placed in the wrong limb; the symptomatic limb is unexplained.",
        edit: { field: "impression", find: "thrombosis of the right popliteal vein", replace: "thrombosis of the left popliteal vein" },
        expect: { ruleIds: ["Q104"], composerVectors: ["lateralitySwaps"] },
      },
      {
        id: "doppler-dvt.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "A negative stated about an unassessed segment — the exact sentence that stops a repeat scan.",
        append: { field: "impression", text: "No calf vein thrombosis." },
        expect: { composerVectors: ["unsupportedMentions"] },
      },
      {
        id: "doppler-dvt.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "A proven DVT signed out as normal, in a patient being assessed for embolism risk.",
        edit: { field: "impression", find: "Acute deep vein thrombosis of the right popliteal vein.", replace: "Normal venous Doppler study of the right lower limb." },
        expect: { ruleIds: ["Q114"] },
      },
      {
        id: "doppler-dvt.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "The same clot listed twice reads as two separate events.",
        append: { field: "impression", text: "Acute deep vein thrombosis of the right popliteal vein." },
        expect: { ruleIds: ["Q102"] },
      },
    ],
  },
];
