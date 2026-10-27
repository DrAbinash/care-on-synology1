import type { GoldenCase } from "./contract";

/** ULTRASOUND ABDOMEN — the study where size and echogenicity carry the
 *  diagnosis, and where the report routinely over-clears structures it skipped. */
export const USG_ABDOMEN_CASES: GoldenCase[] = [
  {
    key: "usg-abdomen-normal",
    exam: "usg-abdomen",
    polarity: "normal",
    summary: "Normal abdominal ultrasound for raised liver enzymes.",
    study: {
      modality: "US",
      studyDescription: "ULTRASOUND ABDOMEN (WHOLE)",
      bodyPart: "ABDOMEN",
      regions: ["Abdomen"],
      reportTitle: "Ultrasound Abdomen",
      sex: "M",
      age: "44Y",
      contrast: "not-applicable",
    },
    indication: "Incidentally raised transaminases in an asymptomatic patient.",
    observations: [
      { id: "un1", concept: "liver", source: "quick-findings", region: "Abdomen", measurement: "13 cm", text: "The liver is normal in size and echotexture without focal lesion." },
      { id: "un2", concept: "biliary_tract", source: "quick-findings", region: "Abdomen", measurement: "4 mm", text: "The common bile duct measures 4 mm, with no intrahepatic dilatation." },
      { id: "un3", concept: "gallstones", source: "quick-select", region: "Abdomen", text: "The gallbladder is decompressed with no stones or wall thickening." },
      { id: "un4", concept: "pancreas", source: "quick-findings", region: "Abdomen", text: "The visualised pancreas is unremarkable." },
      { id: "un5", concept: "kidney", source: "manual", region: "Abdomen", laterality: "bilateral", text: "Both kidneys are normal in size and echogenicity, without calculus or hydronephrosis." },
      { id: "un6", concept: "spleen", source: "manual", region: "Abdomen", measurement: "10 cm", text: "The spleen measures 10 cm." },
      { id: "un7", concept: "prostate", source: "manual", region: "Pelvis", measurement: "28 g", text: "The prostate is normal in size at 28 g." },
    ],
    measurements: [
      { key: "liverLength", label: "Liver span", value: 13, unit: "cm", high: 15 },
      { key: "cbdDiameter", label: "CBD diameter", value: 4, unit: "mm", high: 7 },
      { key: "spleenLength", label: "Spleen length", value: 10, unit: "cm", high: 12 },
    ],
    report: {
      clinicalHistory: "Incidentally raised transaminases.",
      technique: "Real-time abdominal ultrasound with a curved array transducer, grayscale and colour Doppler.",
      findings:
        "The liver is normal in size and echotexture, spanning 13 cm, without focal lesion. The common bile duct measures 4 mm, with no intrahepatic dilatation. The gallbladder is decompressed with no stones or wall thickening. The visualised pancreas is unremarkable. Both kidneys are normal in size and echogenicity, without calculus or hydronephrosis. The spleen measures 10 cm. The prostate is normal in size at 28 g.",
      impression: ["Normal abdominal ultrasound."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "liver", aliases: ["liver"], in: "findings" },
        { concept: "spleen", aliases: ["spleen"] },
        { concept: "prostate", aliases: ["prostate"] },
      ],
      requiredNegatives: [
        { concept: "no_gallstones", aliases: ["no stones"], supportedBy: ["un3"] },
        { concept: "no_focal_liver_lesion", aliases: ["without focal lesion", "no focal lesion"], supportedBy: ["un1"] },
        { concept: "no_hydronephrosis", aliases: ["without calculus or hydronephrosis", "no hydronephrosis"], supportedBy: ["un5"] },
      ],
      prohibitedStatements: [
        { id: "uterine-content", aliases: ["uterus", "ovary", "ovaries"], reason: "A male patient; uterine content in the report is a wrong-patient or wrong-sex error." },
        { id: "malignancy-clearance", aliases: ["no evidence of malignancy", "no cancer"], reason: "Ultrasound does not clear malignancy, and this sentence stops a referral." },
        { id: "pancreas-not-seen-as-seen", aliases: ["pancreas is fully visualised", "entire pancreas"], reason: "Only the visualised pancreas can be reported; claiming the whole gland hides a limit." },
      ],
      impressionConcepts: [{ concept: "normal_study", aliases: ["normal abdominal ultrasound"] }],
      anatomy: { regions: ["Abdomen"], levels: [], laterality: ["bilateral", "none"] },
    },
    defects: [
      {
        id: "usg-normal.anatomical-mismatch",
        class: "anatomicalMismatch",
        harm: "Female anatomy in a male patient's report is either a wrong-patient record or an unreviewed template.",
        append: { field: "findings", text: "The uterus and both ovaries are normal." },
        expect: { ruleIds: ["Q109"] },
      },
      {
        id: "usg-normal.measurement-dropped",
        class: "measurement",
        harm: "The CBD diameter is the obstruction threshold; a normal duct without a number cannot be compared next visit.",
        dropMeasurement: "cbdDiameter",
        edit: { field: "findings", find: "The common bile duct measures 4 mm, with", replace: "The common bile duct is normal caliber, with" },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "usg-normal.unsupported-normal-finding",
        class: "unsupportedNormalFinding",
        harm: "A clearance statement the modality cannot support.",
        append: { field: "impression", text: "No evidence of malignancy." },
        expect: {},
      },
      {
        id: "usg-normal.unsupported-contrast",
        class: "unsupportedContrast",
        harm: "Contrast-enhanced ultrasound is a different examination with different indications.",
        append: { field: "technique", text: "Contrast enhancement was assessed after a gadolinium bolus." },
        expect: {},
      },
    ],
  },
  {
    key: "usg-abdomen-cholelithiasis",
    exam: "usg-abdomen",
    polarity: "abnormal",
    summary: "Symptomatic gallstones with a simple right renal cortical cyst.",
    study: {
      modality: "US",
      studyDescription: "ULTRASOUND ABDOMEN (WHOLE)",
      bodyPart: "ABDOMEN",
      regions: ["Abdomen"],
      reportTitle: "Ultrasound Abdomen",
      sex: "F",
      age: "55Y",
      contrast: "not-applicable",
    },
    indication: "Recurrent right upper quadrant colic after fatty meals.",
    observations: [
      { id: "ug1", concept: "gallstones", source: "quick-select", region: "Abdomen", measurement: "9 mm", text: "Multiple mobile gallstones, the largest 9 mm, with acoustic shadowing, impacted at the neck." },
      { id: "ug2", concept: "gallbladder_wall", source: "quick-findings", region: "Abdomen", measurement: "3 mm", text: "Gallbladder wall measures 3 mm, without pericholecystic fluid." },
      { id: "ug3", concept: "sonographic_murphy", source: "manual", region: "Abdomen", text: "Positive sonographic Murphy sign." },
      { id: "ug4", concept: "renal_cortical_cyst", source: "quick-select", region: "Abdomen", laterality: "right", measurement: "30 mm", text: "A 30 mm anechoic right renal cortical cyst with thin walls and posterior acoustic enhancement, no internal vascularity." },
      { id: "ug5", concept: "biliary_tract", source: "manual", region: "Abdomen", measurement: "5 mm", text: "The common bile duct measures 5 mm, without dilatation." },
      { id: "ug6", concept: "liver", source: "manual", region: "Abdomen", text: "The liver is normal without focal lesion." },
    ],
    measurements: [
      { key: "gallstoneSize", label: "Largest gallstone", value: 9, unit: "mm" },
      { key: "gallbladderWall", label: "GB wall", value: 3, unit: "mm", high: 3 },
      { key: "cbdDiameter", label: "CBD diameter", value: 5, unit: "mm", high: 7 },
      { key: "rightRenalCyst", label: "Right renal cyst", value: 30, unit: "mm" },
    ],
    report: {
      clinicalHistory: "Recurrent right upper quadrant colic after fatty meals.",
      technique: "Real-time abdominal ultrasound with a curved array transducer, grayscale and colour Doppler.",
      findings:
        "Multiple mobile gallstones are present within the gallbladder, the largest measuring 9 mm with acoustic shadowing and impaction at the neck. The gallbladder wall measures 3 mm, without pericholecystic fluid. A positive sonographic Murphy sign is recorded. A 30 mm anechoic right renal cortical cyst shows thin walls and posterior acoustic enhancement with no internal vascularity. The common bile duct measures 5 mm, without dilatation. The liver is normal without focal lesion.",
      impression: [
        "Cholelithiasis with an impacted neck stone, a positive sonographic Murphy sign and a normal wall thickness — findings in keeping with symptomatic gallstone disease.",
        "Simple 30 mm right renal cortical cyst, benign.",
      ],
      recommendation: "Surgical opinion.",
    },
    expect: {
      concepts: [
        { concept: "gallstones", aliases: ["gallstones", "cholelithiasis"], in: "findings" },
        { concept: "renal_cortical_cyst", aliases: ["renal cortical cyst", "cortical cyst"] },
      ],
      requiredNegatives: [
        { concept: "no_wall_thickening", aliases: ["without pericholecystic fluid", "wall measures 3 mm"], supportedBy: ["ug2"] },
        { concept: "no_biliary_dilatation", aliases: ["without dilatation", "no dilatation"], supportedBy: ["ug5"] },
        { concept: "no_internal_vascularity", aliases: ["no internal vascularity"], supportedBy: ["ug4"] },
      ],
      prohibitedStatements: [
        { id: "acute-cholecystitis-grade", aliases: ["gangrenous cholecystitis", "emphysematous"], reason: "No gas or necrosis was supplied; asserting it changes the urgency to emergency surgery." },
        { id: "left-renal-cyst", aliases: ["left renal cyst", "left kidney cyst"], reason: "Only the right kidney was supplied as abnormal." },
        { id: "choledocholithiasis", aliases: ["common bile duct stone", "choledocholithiasis"], reason: "The duct was reported as 5 mm and undilated, so a duct stone is invented." },
      ],
      impressionConcepts: [
        { concept: "cholelithiasis", aliases: ["gallstone", "cholelithiasis"] },
        { concept: "cyst", aliases: ["cortical cyst"] },
      ],
      anatomy: { regions: ["Abdomen"], levels: [], laterality: ["right"] },
    },
    defects: [
      {
        id: "usg-abnormal.measurement-dropped",
        class: "measurement",
        harm: "Stone size and wall thickness decide cholecystitis versus biliary colic.",
        dropMeasurement: "gallstoneSize",
        edit: { field: "findings", find: "the largest measuring 9 mm with acoustic shadowing", replace: "with acoustic shadowing" },
        expect: { ruleIds: ["Q007"] },
      },
      {
        id: "usg-abnormal.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "A duct stone nobody saw converts a laparoscopic cholecystectomy into an ERCP-first pathway.",
        append: { field: "impression", text: "Common bile duct stone with obstructive dilatation." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "usg-abnormal.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "Symptomatic stones summarised as a normal study send the patient home.",
        edit: { field: "impression", find: "Cholelithiasis with an impacted neck stone, a positive sonographic Murphy sign and a normal wall thickness — findings in keeping with symptomatic gallstone disease.", replace: "Unremarkable abdominal ultrasound with no abnormality." },
        expect: { ruleIds: ["Q114"] },
      },
      {
        id: "usg-abnormal.laterality",
        class: "laterality",
        harm: "The renal cyst side determines which kidney is followed up.",
        edit: { field: "impression", find: "Simple 30 mm right renal cortical cyst", replace: "Simple 30 mm left renal cortical cyst" },
        expect: {},
      },
    ],
  },
];
