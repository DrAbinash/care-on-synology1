import type { GoldenCase } from "./contract";

/** MRCP — a ductal study where the diameter and the presence of a stone are the
 *  whole clinical question, and where "no contrast was given" is the normal
 *  technique rather than an omission. */
export const MRCP_CASES: GoldenCase[] = [
  {
    key: "mrcp-normal",
    exam: "mrcp",
    polarity: "normal",
    summary: "Normal MRCP for suspected ductal stone.",
    study: {
      modality: "MR",
      studyDescription: "MRCP (PLAIN)",
      bodyPart: "BILIARY",
      regions: ["Biliary System", "Pancreas"],
      reportTitle: "MRCP",
      sex: "F",
      age: "48Y",
      contrast: "plain",
    },
    indication: "Recurrent biliary-type pain with raised liver enzymes; ultrasound showed gallstones.",
    observations: [
      { id: "mn1", concept: "cbd_calibre", source: "quick-findings", region: "Biliary System", measurement: "5 mm", text: "The common bile duct measures 5 mm and is normal in calibre." },
      { id: "mn2", concept: "intrahepatic_ducts", source: "quick-findings", region: "Biliary System", text: "No intrahepatic biliary dilatation." },
      { id: "mn3", concept: "duct_filling_defect", source: "quick-select", region: "Biliary System", text: "No filling defect to suggest a ductal stone." },
      { id: "mn4", concept: "pancreatic_duct", source: "quick-findings", region: "Pancreas", text: "The main pancreatic duct is normal in calibre." },
      { id: "mn5", concept: "gallbladder", source: "manual", region: "Biliary System", text: "The gallbladder contains multiple stones without wall thickening or pericholecystic fluid." },
    ],
    measurements: [{ key: "cbdDiameter", label: "CBD diameter", value: 5, unit: "mm", high: 7 }],
    report: {
      clinicalHistory: "Recurrent biliary-type pain with raised liver enzymes.",
      technique: "MRCP performed without intravenous contrast using heavily T2-weighted single-shot and slab thick-slab maximum intensity projections, with axial T1W and T2W sequences.",
      findings:
        "The common bile duct measures 5 mm and is normal in calibre. No intrahepatic biliary dilatation. No filling defect to suggest a ductal stone. The main pancreatic duct is normal in calibre. The gallbladder contains multiple stones without wall thickening or pericholecystic fluid.",
      impression: ["No MRCP evidence of a common bile duct stone or biliary obstruction. Cholelithiasis without cholecystitis."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "cbd_calibre", aliases: ["common bile duct"], in: "findings" },
        { concept: "pancreatic_duct", aliases: ["main pancreatic duct", "pancreatic duct"] },
      ],
      requiredNegatives: [
        { concept: "no_intrahepatic_dilatation", aliases: ["no intrahepatic biliary dilatation"], supportedBy: ["mn2"] },
        { concept: "no_ductal_stone", aliases: ["no filling defect"], supportedBy: ["mn3"] },
      ],
      prohibitedStatements: [
        { id: "gadolinium-enhancement", aliases: ["gadolinium", "post-contrast", "contrast enhancement"], reason: "MRCP is a T2-weighted fluid sequence study; enhancement would claim a sequence that was never run." },
        { id: "peripampullary-mass", aliases: ["pancreatic head mass", "periamullary mass", "periampullary mass"], reason: "No mass was supplied, and this phrase triggers a Whipple pathway." },
      ],
      impressionConcepts: [{ concept: "no_ductal_stone", aliases: ["no common bile duct stone", "no mrcp evidence"] }],
      anatomy: { regions: ["Biliary System", "Pancreas"], levels: [], laterality: ["none"] },
    },
    defects: [
      {
        id: "mrcp-normal.unsupported-contrast",
        class: "unsupportedContrast",
        harm: "An enhancement claim on a plain MRCP misdescribes the examination the patient had.",
        append: { field: "findings", text: "No abnormal post-contrast enhancement of the duct walls." },
        expect: { ruleIds: ["Q112"] },
      },
      {
        id: "mrcp-normal.measurement-dropped",
        class: "measurement",
        harm: "Duct calibre is the obstruction question; without the number, dilatation is unfalsifiable.",
        dropMeasurement: "cbdDiameter",
        edit: { field: "findings", find: "The common bile duct measures 5 mm and is normal in calibre.", replace: "The common bile duct is normal in calibre." },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "mrcp-normal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A mass nobody saw sends the patient to a pancreatic operation.",
        append: { field: "impression", text: "Small pancreatic head mass with distal duct dilatation." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
    ],
  },
  {
    key: "mrcp-cbd-stone",
    exam: "mrcp",
    polarity: "abnormal",
    summary: "Common bile duct stone with obstructive dilatation.",
    study: {
      modality: "MR",
      studyDescription: "MRCP (PLAIN)",
      bodyPart: "BILIARY",
      regions: ["Biliary System", "Pancreas"],
      reportTitle: "MRCP",
      sex: "M",
      age: "63Y",
      contrast: "plain",
    },
    indication: "Obstructive jaundice with rigors; suspected ascending cholangitis.",
    observations: [
      { id: "ms1", concept: "duct_filling_defect", source: "quick-select", region: "Biliary System", measurement: "9 mm", text: "A 9 mm rounded filling defect in the distal common bile duct, consistent with a calculus." },
      { id: "ms2", concept: "cbd_dilatation", source: "quick-findings", region: "Biliary System", measurement: "14 mm", text: "The common bile duct is dilated at 14 mm proximal to the stone." },
      { id: "ms3", concept: "intrahepatic_ducts", source: "quick-findings", region: "Biliary System", text: "Mild intrahepatic biliary radicle dilatation." },
      { id: "ms4", concept: "pancreatic_duct", source: "manual", region: "Pancreas", text: "The main pancreatic duct is normal in calibre with no filling defect." },
      { id: "ms5", concept: "cholecystitis", source: "manual", region: "Biliary System", text: "No gallbladder wall thickening or pericholecystic fluid." },
    ],
    measurements: [{ key: "cbdDiameter", label: "CBD diameter", value: 14, unit: "mm", high: 7 }],
    report: {
      clinicalHistory: "Obstructive jaundice with rigors; suspected ascending cholangitis.",
      technique: "MRCP performed without intravenous contrast using heavily T2-weighted single-shot and slab thick-slab maximum intensity projections, with axial T1W and T2W sequences.",
      findings:
        "A 9 mm rounded filling defect in the distal common bile duct, consistent with a calculus, with the duct dilated to 14 mm proximal to it. Mild intrahepatic biliary radicle dilatation. The main pancreatic duct is normal in calibre with no filling defect. No gallbladder wall thickening or pericholecystic fluid.",
      impression: [
        "Distal common bile duct calculus (9 mm) with obstructive dilatation of the duct to 14 mm and intrahepatic radicle dilatation.",
        "Findings are in keeping with the suspected biliary obstruction.",
      ],
      recommendation: "Urgent ERCP.",
    },
    expect: {
      concepts: [
        { concept: "duct_filling_defect", aliases: ["filling defect", "calculus", "stone"], in: "findings" },
        { concept: "cbd_dilatation", aliases: ["dilated", "dilatation"] },
      ],
      requiredNegatives: [
        { concept: "pancreatic_duct_normal", aliases: ["pancreatic duct is normal in calibre"], supportedBy: ["ms4"] },
      ],
      prohibitedStatements: [
        { id: "mass", aliases: ["stricture from a mass", "pancreatic head mass", "cholangiocarcinoma"], reason: "The obstruction was supplied as a stone; a mass changes the operation." },
        { id: "ductal-drainage", aliases: ["biliary drain", "stent in situ"], reason: "No intervention had been performed." },
      ],
      impressionConcepts: [
        { concept: "stone", aliases: ["calculus", "stone"] },
        { concept: "dilatation", aliases: ["dilat", "dilated"] },
      ],
      anatomy: { regions: ["Biliary System"], levels: [], laterality: ["none"] },
    },
    defects: [
      {
        id: "mrcp-stone.measurement-altered",
        class: "measurement",
        harm: "The diameter decides whether this is obstruction or normal variation.",
        changeMeasurement: { key: "cbdDiameter", value: 6 },
        edit: { field: "findings", find: "the duct dilated to 14 mm proximal to it", replace: "the duct measuring 6 mm proximally" },
        expect: { composerVectors: [] },
      },
      {
        id: "mrcp-stone.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "An obstructing stone summarised as an unremarkable study delays ERCP in a septic patient.",
        edit: { field: "impression", find: "Distal common bile duct calculus (9 mm) with obstructive dilatation of the duct to 14 mm and intrahepatic radicle dilatation.", replace: "Unremarkable MRCP with no significant abnormality." },
        expect: { ruleIds: ["Q114"] },
      },
      {
        id: "mrcp-stone.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "The same stone described twice in Findings reads as two stones.",
        append: { field: "findings", text: "A 9 mm rounded filling defect in the distal common bile duct, consistent with a calculus, with the duct dilated to 14 mm proximal to it." },
        expect: { ruleIds: ["Q101"] },
      },
    ],
  },
];
