// rules/structured/index.ts — the Phase 3 structured-tier rule set.
//
// SHADOW MODE: these rules are compiled into a SEPARATE engine instance
// (createStructuredEngine) and are NEVER registered on the default global engine
// that backs the live badge. They therefore cannot change the user-visible score
// or block finalize. `blockingEligibility` is false on every definition (the
// finalize gate is Phase 5).
//
// Every definition is data-driven (interpreted by a generic executor) and its
// params are sourced from REAL protocol/pack/threshold data (see provenance).

import { createExecutorRegistry, compileRule } from "../../executor";
import type { RuleDefinition } from "../../executor";
import type { QualityRule } from "../../contract";
import { createQualityEngine } from "../../engine";
import type { RuleProvider, QualityEngine } from "../../engine";
import { STRUCTURED_EXECUTORS } from "./executors";

export const STRUCTURED_RULE_SET_VERSION = "3.0.0";

const base = {
  owner: "care-core",
  pack: null,
  version: STRUCTURED_RULE_SET_VERSION,
  tier: "structured",
  blockingEligibility: false, // SHADOW — nothing blocks in Phase 3
} as const;

function def(d: Omit<RuleDefinition, keyof typeof base> & Partial<Pick<RuleDefinition, "legacyAlias" | "weight">>): RuleDefinition {
  return { ...base, ...d };
}

export const STRUCTURED_RULE_DEFINITIONS: RuleDefinition[] = [
  // ── study-modality-consistency (fires on TODAY's data, all modalities) ──
  def({ id: "care.structured.consistency.study-modality.mr", canonicalId: "care.structured.consistency.study-modality.mr", category: "consistency", modalities: ["MR"], severity: "blocker", executor: "structured.study-modality-consistency", params: { ignoreSentinel: "OT" }, requires: ["study"], provenance: { source: "radiology_worklist/studies/dicom_studies.modality", ref: "radiology-report-generator.ts:1302" } }),
  def({ id: "care.structured.consistency.study-modality.ct", canonicalId: "care.structured.consistency.study-modality.ct", category: "consistency", modalities: ["CT"], severity: "blocker", executor: "structured.study-modality-consistency", params: { ignoreSentinel: "OT" }, requires: ["study"], provenance: { source: "radiology_worklist/studies/dicom_studies.modality", ref: "radiology-report-generator.ts:1302" } }),
  def({ id: "care.structured.consistency.study-modality.us", canonicalId: "care.structured.consistency.study-modality.us", category: "consistency", modalities: ["US"], severity: "blocker", executor: "structured.study-modality-consistency", params: { ignoreSentinel: "OT" }, requires: ["study"], provenance: { source: "radiology_worklist/studies/dicom_studies.modality", ref: "radiology-report-generator.ts:1302" } }),
  def({ id: "care.structured.consistency.study-modality.xr", canonicalId: "care.structured.consistency.study-modality.xr", category: "consistency", modalities: ["XR"], severity: "blocker", executor: "structured.study-modality-consistency", params: { ignoreSentinel: "OT" }, requires: ["study"], provenance: { source: "radiology_worklist/studies/dicom_studies.modality", ref: "radiology-report-generator.ts:1302" } }),

  // ── USG fetal (fires on TODAY's data — fetal_usg_measurements is live) ──
  def({ id: "care.structured.measurement.range.usg.fetal.fhr", canonicalId: "care.structured.measurement.range.usg.fetal.fhr", category: "measurement", modalities: ["US"], severity: "blocker", executor: "structured.numeric-range", params: { ranges: [{ key: "fetalHeartRate", unit: "bpm", low: 110, high: 160 }] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.fetalHeartRate", ref: "fetalUsgLevel4.ts:117" } }),
  def({ id: "care.structured.measurement.range.usg.fetal.nt", canonicalId: "care.structured.measurement.range.usg.fetal.nt", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "nt", unit: "mm", high: 3.0 }] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.nt", ref: "fetalUsgLevel4.ts:120" } }),
  def({ id: "care.structured.measurement.range.usg.fetal.afi", canonicalId: "care.structured.measurement.range.usg.fetal.afi", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "afi", unit: "cm", low: 5, high: 24, classify: { below: "oligohydramnios", above: "polyhydramnios" } }] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.afi", ref: "obstetricCalculations.ts:327" } }),
  def({ id: "care.structured.measurement.range.usg.fetal.cervical-length", canonicalId: "care.structured.measurement.range.usg.fetal.cervical-length", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "cervicalLength", unit: "mm", low: 25, classify: { below: "short_cervix" } }] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.cervicalLength", ref: "obstetricCalculations.ts:355" } }),
  def({ id: "care.structured.measurement.range.usg.fetal.ua-pi", canonicalId: "care.structured.measurement.range.usg.fetal.ua-pi", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "umbilicalArteryPi", unit: "", high: 1.5 }] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.umbilicalArteryPi", ref: "fetalUsgLevel4.ts:142" } }),
  def({ id: "care.structured.consistency.exclusive.usg.fetal.dv-awave", canonicalId: "care.structured.consistency.exclusive.usg.fetal.dv-awave", category: "consistency", modalities: ["US"], severity: "warning", executor: "structured.mutually-exclusive-state", params: { mode: "enumField", key: "ductusVenoususAWave", abnormalValues: ["reversed", "absent"] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements.ductusVenoususAWave", ref: "fetalUsgLevel4.ts:144" } }),
  def({ id: "care.structured.measurement.required.usg.growth", canonicalId: "care.structured.measurement.required.usg.growth", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.required-measurement", params: { requiredMeasurements: ["bpd", "hc", "ac", "fl", "efw"] }, requires: ["measurements"], provenance: { source: "fetal growth study required biometry", ref: "manifest usg.growth" } }),
  def({ id: "care.structured.measurement.unit.usg.fetal", canonicalId: "care.structured.measurement.unit.usg.fetal", category: "measurement", modalities: ["US"], severity: "warning", executor: "structured.unit-validation", params: { expectedUnits: { afi: "cm", cervicalLength: "mm", fetalHeartRate: "bpm", umbilicalArteryPi: "", efw: "g" }, mmCmHazardKeys: ["afi", "cervicalLength"] }, requires: ["measurements"], provenance: { source: "fetal_usg_measurements column types", ref: "fetalUsgLevel4.ts" } }),
  def({ id: "care.structured.laterality.usg.kidneys", canonicalId: "care.structured.laterality.usg.kidneys", category: "laterality", modalities: ["US"], severity: "warning", executor: "structured.required-laterality", params: { mode: "pair", pairs: [["rightKidneyLengthMm", "leftKidneyLengthMm"]] }, requires: ["measurements"], provenance: { source: "usg_measurements paired *Mm fields", ref: "usgMeasurements.ts" } }),

  // ── CT ──
  def({ id: "care.structured.measurement.required.ct.brain-plain", canonicalId: "care.structured.measurement.required.ct.brain-plain", category: "measurement", modalities: ["CT"], severity: "warning", executor: "structured.required-measurement", params: { requiredMeasurements: ["Midline shift", "Hemorrhage volume"] }, requires: ["measurements"], provenance: { source: "radiology_protocols 'CT Brain Plain'.required_measurements", ref: "radiology_protocols" } }),
  def({ id: "care.structured.measurement.unit.ct", canonicalId: "care.structured.measurement.unit.ct", category: "measurement", modalities: ["CT"], severity: "warning", executor: "structured.unit-validation", params: { expectedUnits: { "Midline shift": "mm", "Hemorrhage volume": "ml", "Stone size": "mm", "Stone density": "HU", "Nodule size": "mm" } }, requires: ["measurements"], provenance: { source: "radiology_quick_measurements", ref: "radiology_quick_measurements" } }),
  def({ id: "care.structured.measurement.range.ct.pe.rvlv", canonicalId: "care.structured.measurement.range.ct.pe.rvlv", category: "measurement", modalities: ["CT"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "RV:LV ratio", unit: "", high: 1 }] }, requires: ["measurements"], provenance: { source: "radiology_protocols 'CT Pulmonary Angiography' normal_text", ref: "radiology_protocols" } }),

  // ── MR ──
  def({ id: "care.structured.measurement.range.mr.brain.midline-shift", canonicalId: "care.structured.measurement.range.mr.brain.midline-shift", category: "measurement", modalities: ["MR"], severity: "warning", executor: "structured.numeric-range", params: { ranges: [{ key: "Midline Shift", unit: "mm", low: 0, high: 2 }] }, requires: ["measurements"], provenance: { source: "MEASUREMENT_TEMPLATES MRI_BRAIN", ref: "radiologyLesions.ts:310" } }),
  def({ id: "care.structured.consistency.exclusive.mr.spine.alignment", canonicalId: "care.structured.consistency.exclusive.mr.spine.alignment", category: "consistency", modalities: ["MR"], severity: "warning", executor: "structured.mutually-exclusive-state", params: { mode: "enumField", key: "alignment", allowed: ["normal", "kyphosis", "lordosis", "scoliosis", "listhesis"] }, requires: ["measurements"], provenance: { source: "spinal_measurements.alignment", ref: "spinal_measurements" } }),

  // ── XR ──
  def({ id: "care.structured.measurement.required.xr.chest-pa", canonicalId: "care.structured.measurement.required.xr.chest-pa", category: "measurement", modalities: ["XR"], severity: "warning", executor: "structured.required-measurement", params: { requiredMeasurements: ["Cardiothoracic ratio"] }, requires: ["measurements"], provenance: { source: "radiology_protocols 'X-Ray Chest PA'", ref: "radiology_protocols" } }),
  def({ id: "care.structured.measurement.unit.xr", canonicalId: "care.structured.measurement.unit.xr", category: "measurement", modalities: ["XR"], severity: "warning", executor: "structured.unit-validation", params: { expectedUnits: { "Cardiothoracic ratio": "", "Cobb angle": "deg", "Vertebral height loss": "%", "Stone size": "mm" }, nullableWhenClassification: true }, requires: ["measurements"], provenance: { source: "radiology_quick_measurements", ref: "radiology_quick_measurements" } }),

  // ── universal, but gated on structured finding instances (notEvaluated today) ──
  def({ id: "care.structured.consistency.exclusive.quickselect.conflict-group", canonicalId: "care.structured.consistency.exclusive.quickselect.conflict-group", category: "consistency", modalities: "*", severity: "warning", executor: "structured.mutually-exclusive-state", params: { mode: "conflictGroup", groupBy: ["studyType", "conflictGroup"], maxSelected: 1 }, requires: ["findingInstances"], provenance: { source: "radiology_quick_findings.conflict_group", ref: "report_finding_instances (ff off)" } }),
  def({ id: "care.structured.laterality.quickselect.side", canonicalId: "care.structured.laterality.quickselect.side", category: "laterality", modalities: "*", severity: "warning", executor: "structured.required-laterality", params: { mode: "finding", field: "side", allowed: ["left", "right", "bilateral"], appliesWhen: { property: "side" } }, requires: ["findingInstances"], provenance: { source: "report_finding_instances.side", ref: "report_finding_instances (ff off)" } }),
  def({ id: "care.structured.completeness.section.coverage", canonicalId: "care.structured.completeness.section.coverage", category: "completeness", modalities: "*", severity: "warning", executor: "structured.required-section", params: { coverageFrom: "findingInstances", excludeNotApplicable: true }, requires: ["template", "findingInstances"], provenance: { source: "template sections vs finding anatomical_section", ref: "report_finding_instances (ff off)" } }),
];

// Build the executor registry and compile the definitions into runnable rules.
const executorRegistry = createExecutorRegistry();
for (const [name, exec] of Object.entries(STRUCTURED_EXECUTORS)) executorRegistry.register(name, exec);

export const structuredRules: QualityRule[] = STRUCTURED_RULE_DEFINITIONS.map((d) => compileRule(d, executorRegistry));

/** The Phase-3 structured rule bundle. NOT registered on the global engine. */
export const structuredProvider: RuleProvider = {
  name: "care-core:structured-v3",
  rules: structuredRules,
};

/** A scoped engine containing ONLY the structured rules — the shadow runner. */
export function createStructuredEngine(): QualityEngine {
  return createQualityEngine({ providers: [structuredProvider] });
}
