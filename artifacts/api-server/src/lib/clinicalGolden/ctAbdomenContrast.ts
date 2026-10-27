import type { GoldenCase } from "./contract";

/** CT ABDOMEN (CONTRAST) — organ-by-organ survey where the negative that matters
 *  is the one about a structure the study actually covered. */
export const CT_ABDOMEN_CASES: GoldenCase[] = [
  {
    key: "ct-abdomen-normal",
    exam: "ct-abdomen-contrast",
    polarity: "normal",
    summary: "Normal contrast CT abdomen and pelvis for right iliac fossa pain.",
    study: {
      modality: "CT",
      studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
      bodyPart: "ABDOMEN",
      regions: ["Abdomen", "Pelvis"],
      reportTitle: "CT Abdomen and Pelvis",
      sex: "F",
      age: "26Y",
      contrast: "contrast",
    },
    indication: "Right iliac fossa pain for 2 days, normal white count, negative urine.",
    observations: [
      { id: "an1", concept: "appendix", source: "quick-findings", region: "Abdomen", measurement: "5 mm", text: "The appendix is normal in calibre at 5 mm with no wall thickening or fat stranding." },
      { id: "an2", concept: "liver", source: "quick-findings", region: "Abdomen", text: "Normal liver morphology without focal lesion." },
      { id: "an3", concept: "biliary_tract", source: "manual", region: "Abdomen", text: "No intra- or extra-hepatic biliary dilatation." },
      { id: "an4", concept: "kidney", source: "manual", region: "Abdomen", laterality: "bilateral", text: "Both kidneys enhance normally without hydronephrosis or calculus." },
      { id: "an5", concept: "lymph_nodes", source: "quick-findings", region: "Pelvis", text: "No abdominal or pelvic lymphadenopathy." },
      { id: "an6", concept: "free_liquid", source: "quick-findings", region: "Pelvis", text: "No free fluid or collections." },
    ],
    measurements: [{ key: "appendixDiameter", label: "Appendix diameter", value: 5, unit: "mm", high: 6 }],
    report: {
      clinicalHistory: "Right iliac fossa pain for 2 days.",
      technique: "CT abdomen and pelvis with intravenous contrast, oral contrast administered, axial acquisition with coronal and sagittal reformats.",
      findings:
        "The appendix is normal in calibre at 5 mm, with no wall thickening or periappendiceal fat stranding. Normal liver morphology without focal lesion. No intra- or extra-hepatic biliary dilatation. Both kidneys enhance normally, without hydronephrosis or calculus. No abdominal or pelvic lymphadenopathy. No free fluid or collections.",
      impression: ["No acute abnormality on this contrast CT of the abdomen and pelvis."],
      recommendation: "Clinical correlation.",
    },
    expect: {
      concepts: [
        { concept: "appendix", aliases: ["appendix"], in: "findings" },
        { concept: "liver", aliases: ["liver"] },
      ],
      requiredNegatives: [
        { concept: "no_appendicitis", aliases: ["no wall thickening", "normal in calibre"], supportedBy: ["an1"] },
        { concept: "no_free_fluid", aliases: ["no free fluid"], supportedBy: ["an6"] },
        { concept: "no_hydronephrosis", aliases: ["without hydronephrosis", "no hydronephrosis"], supportedBy: ["an4"] },
      ],
      prohibitedStatements: [
        { id: "diverticular-disease", aliases: ["diverticulitis", "diverticulum"], reason: "Nothing was supplied about the colon wall, and this phrase starts antibiotics." },
        { id: "no-contrast-claim", aliases: ["no contrast was administered", "non-contrast study"], reason: "The study WAS a contrast examination; denying the contrast contradicts the technique." },
      ],
      impressionConcepts: [{ concept: "no_acute_abnormality", aliases: ["no acute abnormality"] }],
      anatomy: { regions: ["Abdomen", "Pelvis"], levels: [], laterality: ["bilateral", "none"] },
    },
    defects: [
      {
        id: "ct-abdomen-normal.contradiction-no-contrast",
        class: "unsupportedContrast",
        harm: "The report denies the contrast the patient received, so the enhancement findings become unexplained.",
        append: { field: "findings", text: "As this was a non-contrast study, enhancement cannot be assessed." },
        expect: { ruleIds: ["Q112"] },
      },
      {
        id: "ct-abdomen-normal.duplicate-conclusion",
        class: "duplicateConclusion",
        harm: "The same negative sentence twice makes a scan look auto-filled.",
        append: { field: "findings", text: "The appendix is normal in calibre at 5 mm with no wall thickening or periappendiceal fat stranding." },
        expect: { ruleIds: ["Q101"] },
      },
      {
        id: "ct-abdomen-normal.anatomical-mismatch",
        class: "anatomicalMismatch",
        harm: "Female-only anatomy asserted about a patient whose sex is on the request is a data-integrity failure.",
        append: { field: "findings", text: "The prostate is normal." },
        expect: { ruleIds: ["Q109"] },
      },
    ],
  },
  {
    key: "ct-abdomen-appendicitis",
    exam: "ct-abdomen-contrast",
    polarity: "abnormal",
    summary: "Acute appendicitis with an appendicolith, no perforation.",
    study: {
      modality: "CT",
      studyDescription: "CT ABDOMEN AND PELVIS (WITH CONTRAST)",
      bodyPart: "ABDOMEN",
      regions: ["Abdomen", "Pelvis"],
      reportTitle: "CT Abdomen and Pelvis",
      sex: "M",
      age: "19Y",
      contrast: "contrast",
    },
    indication: "Migrating right iliac fossa pain, fever and leukocytosis.",
    observations: [
      { id: "aa1", concept: "appendicitis", source: "quick-select", region: "Abdomen", measurement: "11 mm", text: "Dilated blind-ending tubular structure in the right iliac fossa measuring 11 mm with wall thickening and mucosal hyperaemia." },
      { id: "aa2", concept: "appendicolith", source: "quick-select", region: "Abdomen", text: "Calcified appendicolith at the base." },
      { id: "aa3", concept: "fat_stranding", source: "quick-findings", region: "Abdomen", text: "Moderate periappendiceal fat stranding." },
      { id: "aa4", concept: "abscess", source: "quick-findings", region: "Pelvis", text: "No collection or abscess." },
      { id: "aa5", concept: "perforation", source: "manual", region: "Abdomen", text: "No extraluminal gas to suggest perforation." },
    ],
    measurements: [{ key: "appendixDiameter", label: "Appendix diameter", value: 11, unit: "mm", high: 6 }],
    report: {
      clinicalHistory: "Migrating right iliac fossa pain, fever and leukocytosis.",
      technique: "CT abdomen and pelvis with intravenous contrast, oral contrast administered, axial acquisition with coronal and sagittal reformats.",
      findings:
        "Dilated blind-ending tubular structure in the right iliac fossa measuring 11 mm, with wall thickening and mucosal hyperaemia, and a calcified appendicolith at its base. Moderate periappendiceal fat stranding. No collection or abscess. No extraluminal gas to suggest perforation.",
      impression: ["Acute appendicitis with an appendicolith, without perforation or abscess formation."],
      recommendation: "Surgical opinion.",
    },
    expect: {
      concepts: [
        { concept: "appendicitis", aliases: ["appendicitis", "dilated blind-ending"], in: "findings" },
        { concept: "appendicolith", aliases: ["appendicolith"] },
      ],
      requiredNegatives: [
        { concept: "no_abscess", aliases: ["no collection or abscess"], supportedBy: ["aa4"] },
        { concept: "no_perforation", aliases: ["no extraluminal gas", "without perforation"], supportedBy: ["aa5"] },
      ],
      prohibitedStatements: [
        { id: "generalised-peritonitis", aliases: ["generalised peritonitis", "free fluid throughout"], reason: "No distant fluid was supplied; peritonitis changes the operation." },
        { id: "diverticulitis", aliases: ["diverticulitis"], reason: "The caecal appendix was the supplied diagnosis." },
      ],
      impressionConcepts: [
        { concept: "appendicitis", aliases: ["appendicitis"] },
        { concept: "no-perforation", aliases: ["without perforation", "no perforation"] },
      ],
      anatomy: { regions: ["Abdomen", "Pelvis"], levels: [], laterality: ["none"] },
    },
    defects: [
      {
        id: "ct-appendicitis.measurement-altered",
        class: "measurement",
        harm: "Diameter is the difference between appendicitis and a normal appendix.",
        changeMeasurement: { key: "appendixDiameter", value: 5 },
        edit: { field: "findings", find: "measuring 11 mm", replace: "measuring 5 mm" },
        expect: { composerErrors: ["measurement_mutation"], ruleIds: ["Q007"] },
      },
      {
        id: "ct-appendicitis.invented-diagnosis",
        class: "inventedDiagnosis",
        harm: "Spread nobody described converts a keyhole appendicectomy into a laparotomy.",
        append: { field: "impression", text: "Generalised peritonitis with free fluid throughout." },
        expect: { composerErrors: ["impression_ungrounded"] },
      },
      {
        id: "ct-appendicitis.findings-impression-contradiction",
        class: "findingsImpressionContradiction",
        harm: "Findings that describe appendicitis and an impression that clears the patient.",
        edit: { field: "impression", find: "Acute appendicitis with an appendicolith, without perforation or abscess formation.", replace: "Normal CT of the abdomen and pelvis." },
        expect: { ruleIds: ["Q114"] },
      },
    ],
  },
];
