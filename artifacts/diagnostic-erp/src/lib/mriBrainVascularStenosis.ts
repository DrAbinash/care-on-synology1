/**
 * mriBrainVascularStenosis.ts — the measured stenosis and carotid dissection records
 * (mra/mrv spec §7, §11).
 *
 * A percentage is the one number in vascular reporting that a template can get wrong
 * in the loud direction, so the two rules §11 states are enforced here as types and
 * arithmetic:
 *
 *   - A NASCET figure is calculated from a minimum residual lumen and a distal normal
 *     reference. `MeasuredStenosisRecord` has no path from an appearance word to a
 *     percentage: the descriptor is a separate, radiologist-selected field, and the
 *     percentage only exists if the two diameters do (or if the radiologist typed one
 *     and said where it came from).
 *   - An intramural haematoma is not "acute" because it is bright on T1. The stage
 *     word appears only when the radiologist selects it, and the dissection
 *     conclusion is a separate atom on the registered statement concept.
 *
 * Both records write to the vessel's own lumen slot — the same slot the palette's
 * descriptive row writes — so a measured number refines the appearance sentence
 * instead of standing beside it, and the dissection conclusion stays on
 * `mra_neck_dissection` where the palette puts it.
 *
 * Pure functions only — no store, no React.
 */

import type { BrainAtomSpec } from "./mriBrainAtoms";
import { brainBundleId } from "./mriBrainAtoms";
import {
  canonicalVesselSlot,
  vesselConceptId,
  vesselDisplayName,
  type VesselSide,
} from "./mriBrainVessels";
import {
  patentSentenceFor,
  remainderNormalAtom,
  vesselFindingsSection,
} from "./mriBrainVesselObservations";
import { VASCULAR_FINDINGS_SECTIONS, vascularSplitFor } from "./mriBrainVascularProse";
import {
  vascularGate,
  type VascularGateFeature,
} from "./mriBrainVascularTechnique";
import type {
  Assessable,
  VascularLesionContext,
  VascularLesionResult,
} from "./mriBrainVascularLesions";
import { vascularMeasure, vascularSentenceCase } from "./mriBrainVascularLesions";

/**
 * Where a number came from (§11 "measurement provenance", §7 "if a percentage is
 * manually entered, preserve provenance"). A caliper on the viewer is a different
 * claim from a figure the radiologist keyed, and the report says which.
 */
export const STENOSIS_PROVENANCE_SOURCES = [
  "viewer-caliper",
  "manual-entry",
  "external-study",
] as const;
export type StenosisProvenanceSource = (typeof STENOSIS_PROVENANCE_SOURCES)[number];

export const STENOSIS_PROVENANCE_LABELS: Record<StenosisProvenanceSource, string> = {
  "viewer-caliper": "measured on the viewer from the linked caliper",
  "manual-entry": "entered by the reporting radiologist without a linked caliper",
  "external-study": "carried across from the study named below",
};

export type StenosisProvenance = {
  source: StenosisProvenanceSource;
  /** The viewer measurement / annotation ids behind the diameters, when there were any. */
  annotationIds?: readonly string[];
  /** Series, protocol or external study label. */
  detail?: string;
};

export function stenosisProvenanceLabel(p: StenosisProvenance | undefined): string {
  if (!p) return "no measurement provenance recorded";
  const parts = [STENOSIS_PROVENANCE_LABELS[p.source]];
  if (p.annotationIds?.length) parts.push(`annotations ${p.annotationIds.join(", ")}`);
  if (p.detail?.trim()) parts.push(p.detail.trim());
  return parts.join("; ");
}

/** §7/§11: how the figure was obtained. `nascet` needs both diameters. */
export const STENOSIS_FORMULAS = ["nascet", "diameter-reduction", "entered"] as const;
export type StenosisFormula = (typeof STENOSIS_FORMULAS)[number];

const FORMULA_WORDS: Record<StenosisFormula, string> = {
  nascet: "NASCET",
  "diameter-reduction": "diameter reduction against the distal reference",
  entered: "visually estimated on the acquisition named below",
};

/**
 * The descriptors a radiologist may attach to a stenosis. They are words the
 * radiologist chose, never a translation of a number by the software —
 * `nascetBandFor` exists only so §19 can point out when the two disagree.
 */
export const STENOSIS_DESCRIPTORS = [
  "mild",
  "moderate",
  "severe",
  "high-grade",
  "near-occlusion",
  "occluded",
] as const;
export type StenosisDescriptor = (typeof STENOSIS_DESCRIPTORS)[number];

export type MeasuredStenosisRecord = {
  /** Free text resolved through the vessel registry, like every other vascular row. */
  vessel: string;
  side?: VesselSide | "";
  territory?: "intracranialArterial" | "neckArterial";
  formula: StenosisFormula;
  /** The two §11 diameters, in millimetres. */
  minResidualLumenMm?: number | "";
  referenceLumenMm?: number | "";
  /** A stated percentage: required by `entered`, an override for the other formulas. */
  percent?: number | "";
  /** True when `percent` is the radiologist's figure rather than the calculated one. */
  manualOverride?: boolean;
  overrideReason?: string;
  provenance?: StenosisProvenance;
  descriptor?: StenosisDescriptor | "";
  plaqueDescription?: string;
  ulceration?: Assessable;
  /** The tree-wide normal the report currently carries, if any. */
  replaceTreeNormal?: string;
  remainderNormal?: string;
  manualNote?: string;
};

/**
 * NASCET: 1 − (narrowest residual lumen / the normal distal internal carotid behind
 * it), as a whole percentage. Null when either diameter is missing, non-positive, or
 * when the "residual" is not narrower than its reference — a ratio there is a
 * measurement problem, not a 0 % stenosis.
 */
export function nascetPercent(
  residualMm: number | "" | undefined,
  referenceMm: number | "" | undefined,
): number | null {
  const residual = vascularMeasure(residualMm);
  const reference = vascularMeasure(referenceMm);
  if (residual == null || reference == null || residual >= reference) return null;
  const percent = Math.round((1 - residual / reference) * 100);
  return Math.max(0, Math.min(100, percent));
}

/** The percentage the record reports: the override when there is one, else the arithmetic. */
export function measuredStenosisPercent(r: MeasuredStenosisRecord): number | null {
  if (r.manualOverride || r.formula === "entered") return vascularMeasure(r.percent);
  return nascetPercent(r.minResidualLumenMm, r.referenceLumenMm);
}

/**
 * The NASCET trial's own bands, used ONLY to compare against a descriptor the
 * radiologist typed (§19). Reporting software should not turn a measurement into a
 * clinical word, so no sentence in this module calls itself "severe" on this basis.
 */
export function nascetBandFor(percent: number): StenosisDescriptor {
  if (percent >= 100) return "occluded";
  if (percent >= 95) return "near-occlusion";
  if (percent >= 70) return "severe";
  if (percent >= 50) return "moderate";
  return "mild";
}

/** Non-blocking: the number and the radiologist's word do not describe the same stenosis. */
export function stenosisDescriptorConflict(
  descriptor: StenosisDescriptor | "" | undefined,
  percent: number | null,
): string | null {
  if (!descriptor || percent == null) return null;
  const band = nascetBandFor(percent);
  const agree = descriptor === band
    || (descriptor === "high-grade" && (band === "severe" || band === "near-occlusion" || band === "occluded"));
  if (agree) return null;
  return (
    `"${descriptor}" does not match the measured ${percent}% (${band} at that figure). `
    + "Either the descriptor or the entered diameters need review."
  );
}

function stenosisMeasurementClause(r: MeasuredStenosisRecord): string {
  const residual = vascularMeasure(r.minResidualLumenMm);
  const reference = vascularMeasure(r.referenceLumenMm);
  if (residual == null || reference == null) return "";
  const referenceWord = r.formula === "nascet"
    ? "distal normal internal carotid reference"
    : "distal reference";
  return `minimum residual lumen ${residual} mm against a ${referenceWord} of ${reference} mm`;
}

export function stenosisFindingsSentence(r: MeasuredStenosisRecord, vesselLabel: string): string {
  const percent = measuredStenosisPercent(r);
  const clauses: string[] = [];
  if (percent != null) {
    const measurement = stenosisMeasurementClause(r);
    clauses.push(
      `Measured stenosis of the ${vesselLabel}: ${percent}% ${FORMULA_WORDS[r.formula]}`
      + `${measurement ? ` (${measurement})` : ""}.`,
    );
    if (r.manualOverride) {
      clauses.push(
        `The percentage is the reporting radiologist's figure${r.overrideReason?.trim()
          ? `: ${r.overrideReason.trim()}`
          : ", not the value calculated from the entered diameters"}.`,
      );
    }
    clauses.push(`Measurement source: ${stenosisProvenanceLabel(r.provenance)}.`);
  } else {
    clauses.push(`Atherosclerotic disease of the ${vesselLabel} without a reported percentage.`);
  }
  if (r.plaqueDescription?.trim()) clauses.push(r.plaqueDescription.trim());
  if (r.ulceration === "present") clauses.push("The lumen surface is ulcerated.");
  else if (r.ulceration === "absent") clauses.push("No ulceration is demonstrated.");
  if (r.descriptor) clauses.push(`${r.descriptor} stenosis.`);
  if (r.manualNote?.trim()) clauses.push(r.manualNote.trim());
  return clauses.join(" ");
}

export function stenosisImpressionSentence(
  r: MeasuredStenosisRecord,
  vesselLabel: string,
): string {
  const percent = measuredStenosisPercent(r);
  const lead = r.descriptor ? `${r.descriptor} ` : "";
  return vascularSentenceCase(
    `${lead}stenosis of the ${vesselLabel}`
    + `${percent != null ? ` — ${percent}% ${FORMULA_WORDS[r.formula]}` : ""}.`,
  );
}

/** True when the record claims a number, whichever formula produced it. */
export function stenosisReportsPercent(r: MeasuredStenosisRecord): boolean {
  return measuredStenosisPercent(r) != null;
}

/**
 * The measured stenosis row (§7, §11). Refuses when a percentage is claimed without
 * the acquisition to measure on, and warns — never blocks — when the number and the
 * radiologist's own descriptor disagree, or when a figure has no provenance.
 */
export function measuredStenosisAtoms(
  record: MeasuredStenosisRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const slot = canonicalVesselSlot(record.vessel, {
    side: record.side || undefined,
    territory: record.territory,
  });
  if (!slot) {
    return {
      atoms: [],
      bundleId: "",
      errors: [
        `"${record.vessel}" does not name a single vessel in the vascular registry, `
        + "so a measured stenosis cannot be attached to it.",
      ],
    };
  }
  const percent = measuredStenosisPercent(record);
  const checks: [boolean, VascularGateFeature][] = [
    [true, "arterialAssessment"],
    [percent != null, "numericStenosis"],
  ];
  for (const [applies, feature] of checks) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const label = vesselDisplayName(slot.vessel);
  if (
    (record.formula === "nascet" || record.formula === "diameter-reduction")
    && !record.manualOverride
    && percent == null
  ) {
    const residual = vascularMeasure(record.minResidualLumenMm);
    const reference = vascularMeasure(record.referenceLumenMm);
    errors.push(
      residual != null && reference != null && residual >= reference
        ? `The residual lumen (${residual} mm) is not narrower than its reference (${reference} mm), so no percentage was calculated.`
        : `A ${record.formula === "nascet" ? "NASCET" : "measured"} percentage needs both the minimum residual lumen and the distal reference diameter.`,
    );
  }
  const conflict = stenosisDescriptorConflict(record.descriptor, percent);
  if (conflict) warnings.push(conflict);
  if (percent != null && !record.provenance) {
    warnings.push(
      "A numeric stenosis is reported without measurement provenance (§11): record where the number came from.",
    );
  }
  if (record.manualOverride && !record.overrideReason?.trim() && !record.provenance) {
    warnings.push("A manual override should say what it overrides or where the figure came from.");
  }
  if (errors.length) return { atoms: [], bundleId: "", errors };

  const atoms: BrainAtomSpec[] = [{
    concept: vesselConceptId(slot.vessel),
    conflictGroup: slot.vessel.key,
    anatomicalSection: vesselFindingsSection(slot.vessel),
    findings: stenosisFindingsSentence(record, label),
    impression: stenosisImpressionSentence(record, label),
    baselineReplaces: record.replaceTreeNormal?.trim() || patentSentenceFor(slot.vessel),
    level: slot.level,
    laterality: slot.laterality || undefined,
    supportsLaterality: slot.vessel.side !== "unpaired",
    measurement: percent != null ? String(percent) : undefined,
    state: percent != null
      ? `${record.formula}${record.manualOverride ? " (radiologist override)" : ""}: ${stenosisProvenanceLabel(record.provenance)}`
      : undefined,
  }];
  if (record.remainderNormal?.trim()) {
    atoms.push(remainderNormalAtom("mra_arterial", slot.vessel.territory, record.remainderNormal));
  }
  return {
    atoms,
    bundleId: brainBundleId("stenosis", `${slot.vessel.key}-${percent ?? "none"}`),
    warnings: warnings.length ? warnings : undefined,
  };
}

// ─── §11 dissection ──────────────────────────────────────────────────────

export const DISSECTION_STAGES = ["acute", "subacute", "chronic"] as const;
export type DissectionStage = (typeof DISSECTION_STAGES)[number] | "";

export const DISSECTION_CORRELATIONS = [
  "CTA of the neck",
  "contrast-enhanced MRA",
  "catheter angiography",
  "carotid duplex ultrasonography",
] as const;
export type DissectionCorrelation = (typeof DISSECTION_CORRELATIONS)[number] | "";

export type CarotidDissectionRecord = {
  vessel: string;
  side?: VesselSide | "";
  territory?: "intracranialArterial" | "neckArterial";
  /** The descriptive half — a T1 crescent, stated without a stage or a diagnosis. */
  intramuralHematoma?: Assessable;
  hematomaExtent?: string;
  luminalChange?: string;
  intimalFlap?: Assessable;
  /** §11: selected by the radiologist, never derived from the hematoma signal. */
  stage?: DissectionStage;
  dissectionSelected?: boolean;
  pseudoaneurysm?: boolean;
  correlationRecommendation?: DissectionCorrelation;
  manualNote?: string;
};

export function dissectionFindingsSentence(
  r: CarotidDissectionRecord,
  vesselLabel: string,
): string {
  const clauses: string[] = [];
  if (r.intramuralHematoma === "present") {
    clauses.push(
      "Eccentric crescentic T1 hyperintense intramural hematoma surrounding a narrowed lumen"
      + ` in the ${vesselLabel}`
      + `${r.hematomaExtent?.trim() ? `, extending ${r.hematomaExtent.trim()}` : ""}.`,
    );
  } else if (r.intramuralHematoma === "absent") {
    clauses.push(`No intramural hematoma is demonstrated in the ${vesselLabel}.`);
  }
  if (r.intimalFlap === "present") clauses.push("An intimal flap is seen.");
  else if (r.intimalFlap === "absent") clauses.push("No intimal flap is identified.");
  if (r.luminalChange?.trim()) clauses.push(r.luminalChange.trim());
  if (r.stage) {
    clauses.push(
      `The reporting radiologist stages the appearance as ${r.stage} on the sequences and clinical information available.`,
    );
  }
  if (r.manualNote?.trim()) clauses.push(r.manualNote.trim());
  return clauses.join(" ");
}

/**
 * §11: the hematoma description, and only on the radiologist's selection the
 * dissection conclusion — with a recommendation that is likewise never volunteered.
 */
export function carotidDissectionAtoms(
  record: CarotidDissectionRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const slot = canonicalVesselSlot(record.vessel, {
    side: record.side || undefined,
    territory: record.territory ?? "neckArterial",
  });
  if (!slot) {
    return {
      atoms: [],
      bundleId: "",
      errors: [
        `"${record.vessel}" does not name a single vessel in the vascular registry, `
        + "so a dissection cannot be attached to it.",
      ],
    };
  }
  const checks: [boolean, VascularGateFeature][] = [
    [true, "arterialAssessment"],
    [record.intramuralHematoma === "present", "intramuralHematoma"],
  ];
  for (const [applies, feature] of checks) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }
  const label = vesselDisplayName(slot.vessel);
  const findings = dissectionFindingsSentence(record, label);
  if (!findings.trim()) {
    return { atoms: [], bundleId: "", errors: ["no dissection findings entered"] };
  }
  const atoms: BrainAtomSpec[] = [{
    concept: vesselConceptId(slot.vessel),
    conflictGroup: slot.vessel.key,
    anatomicalSection: VASCULAR_FINDINGS_SECTIONS.neckMeasurements,
    findings,
    // The descriptive row owns no impression: the conclusion below is the only
    // sentence that says what the appearances mean (§11).
    baselineReplaces: patentSentenceFor(slot.vessel),
    level: slot.level,
    laterality: slot.laterality || undefined,
    supportsLaterality: slot.vessel.side !== "unpaired",
    state: record.stage ? `staged ${record.stage} by the radiologist` : "not staged",
  }];
  if (record.dissectionSelected) {
    atoms.push({
      concept: "mra_neck_dissection",
      conflictGroup: "neck-dissection",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.neckMeasurements,
      findings:
        `The reporting radiologist classifies the appearances of the ${label} as a dissection`
        + `${record.stage ? ` in the ${record.stage} phase` : ""}.`,
      // §11: the library's "diagnostic of acute dissection" clause is only reachable
      // when the radiologist has itself selected the acute phase.
      impression: record.stage === "acute"
        ? vascularSplitFor("carotidDissection").interpretation
        : `Dissection of the ${label}${record.stage ? ` in the ${record.stage} phase` : ""}.`,
      recommendation: record.correlationRecommendation
        ? `Recommend ${record.correlationRecommendation} for further characterisation.`
        : undefined,
      // §11: the stage the radiologist chose, or the fact that none was chosen.
      state: record.stage ? `staged ${record.stage}` : "stage not stated",
    });
  }
  if (record.pseudoaneurysm) {
    atoms.push({
      concept: "aneurysm_pseudoaneurysm",
      conflictGroup: "neck-pseudoaneurysm",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.neckMeasurements,
      findings:
        `Outpouching of the ${label} at the level of the narrowed segment, suspicious for a pseudoaneurysm.`,
      impression: "Pseudoaneurysm at the dissection segment (radiologist-selected).",
    });
  }
  return {
    atoms,
    bundleId: brainBundleId("dissection", slot.vessel.key),
  };
}
