// rules/structured/fixtures.ts — representative structured fixtures exercising
// every Phase-3 executor across MRI/USG/CT/X-Ray. Used by tests and the offline
// validation harness. Fixtures may populate flag-gated slots (findingInstances)
// that are `undefined` in production, precisely to exercise those executors.

import type { QualityContext } from "../../contract";

// USG fetal — numeric-range x3, unit mm/cm hazard, enum exclusive, laterality pair, required-measurement x5
export const usgFetalFixture: QualityContext = {
  modality: "USG",
  studyDescription: "Growth scan",
  study: {
    authoritativeSource: "study", authoritativeModality: "US", authoritativeModalityRaw: "US",
    authoritativeIsSentinel: false, declaredModality: "US", declaredModalityRaw: "USG",
    studyName: "OBSTETRIC ULTRASOUND", studyDescription: "Growth scan",
  },
  text: { findings: "Single live intrauterine fetus.", impression: ["Growth scan."] },
  measurements: [
    { key: "fetalHeartRate", label: "FHR", value: 178, unit: "bpm", low: 110, high: 160 },
    { key: "afi", label: "AFI", value: 26, unit: "mm", low: 5, high: 24 },
    { key: "cervicalLength", label: "Cervical length", value: 22, unit: "mm", low: 25 },
    { key: "ductusVenoususAWave", label: "DV a-wave", value: NaN, classification: "reversed" },
    { key: "rightKidneyLengthMm", label: "R kidney length", value: 38, unit: "mm" },
  ],
  protocolRequiredMeasurements: {
    studyType: "OBSTETRIC ULTRASOUND", modality: "US",
    requiredMeasurements: ["bpd", "hc", "ac", "fl", "efw"],
    expectedUnits: { afi: "cm", cervicalLength: "mm", fetalHeartRate: "bpm" },
  },
};

// CT brain — draft says MRI but the authoritative study is CT → study-modality mismatch; unit mm/cm; required missing
export const ctBrainFixture: QualityContext = {
  modality: "MRI", // declared as MRI…
  studyDescription: "CT Brain Plain",
  study: {
    authoritativeSource: "worklist", authoritativeModality: "CT", authoritativeModalityRaw: "CT",
    authoritativeIsSentinel: false, declaredModality: "MR", declaredModalityRaw: "MRI", // …authoritative CT
    studyName: "CT Brain Plain", studyDescription: "CT Brain Plain",
  },
  text: { findings: "No acute infarct.", impression: ["Normal study."] },
  measurements: [{ key: "Midline shift", label: "Midline shift", value: 3, unit: "cm" }], // unit cm != mm
  protocolRequiredMeasurements: {
    studyType: "CT Brain Plain", modality: "CT",
    requiredMeasurements: ["Midline shift", "Hemorrhage volume"], // Hemorrhage volume absent
    expectedUnits: { "Midline shift": "mm", "Hemorrhage volume": "ml" },
  },
};

// X-Ray chest — unit "" mismatch; modality consistent (no mismatch); CTR present (no required-missing)
export const xrChestFixture: QualityContext = {
  modality: "X-RAY",
  studyDescription: "CXR PA",
  study: {
    authoritativeSource: "worklist", authoritativeModality: "XR", authoritativeModalityRaw: "CR",
    authoritativeIsSentinel: false, declaredModality: "XR", declaredModalityRaw: "X-RAY",
    studyName: "X-Ray Chest PA", studyDescription: "CXR PA",
  },
  text: { findings: "Clear lung fields.", impression: ["Normal chest."] },
  measurements: [{ key: "Cardiothoracic ratio", label: "Cardiothoracic ratio", value: 0.55, unit: "mm" }], // expected ''
  protocolRequiredMeasurements: {
    studyType: "X-Ray Chest PA", modality: "XR",
    requiredMeasurements: ["Cardiothoracic ratio"], expectedUnits: { "Cardiothoracic ratio": "" },
  },
};

// MRI brain — SYNTHETIC findingInstances exercise conflict-group exclusivity + required-section coverage
export const mriBrainFixture: QualityContext = {
  modality: "MRI",
  studyDescription: "MRI Brain Plain",
  study: {
    authoritativeSource: "worklist", authoritativeModality: "MR", authoritativeModalityRaw: "MR",
    authoritativeIsSentinel: false, declaredModality: "MR", declaredModalityRaw: "MRI",
    studyName: "Brain", studyDescription: "MRI Brain Plain",
  },
  text: { findings: "White matter changes.", impression: ["Small vessel disease."] },
  template: {
    templateId: "MRI_BRAIN_PLAIN", modality: "MR",
    sections: [
      { name: "WHITE MATTER", required: true },
      { name: "POSTERIOR FOSSA", required: true },
      { name: "VENTRICULAR SYSTEM / CSF SPACES", required: true },
    ],
  },
  knowledgePack: {
    packId: "mri.brain", modality: "MRI", studyType: "Brain", version: "1", status: "enabled",
    comparisonMeasurements: [], notApplicableSections: ["POSTERIOR FOSSA"],
    criticalFindings: ["hemorrhage", "midline shift"], normalValues: [],
  },
  findingInstances: [
    { instanceId: 1, findingId: 10, label: "Fazekas 1", studyType: "Brain", anatomicalSection: "WHITE MATTER", conflictGroup: "Fazekas", properties: ["severity"], side: "", severity: "mild", chronicity: "", level: "", value: "", source: "quickselect", targetRef: "report_finding_instances:1" },
    { instanceId: 2, findingId: 11, label: "Fazekas 2", studyType: "Brain", anatomicalSection: "WHITE MATTER", conflictGroup: "Fazekas", properties: ["severity"], side: "", severity: "moderate", chronicity: "", level: "", value: "", source: "quickselect", targetRef: "report_finding_instances:2" },
  ],
};

export const ALL_FIXTURES = {
  "USG fetal": usgFetalFixture,
  "CT brain": ctBrainFixture,
  "X-Ray chest": xrChestFixture,
  "MRI brain": mriBrainFixture,
};
