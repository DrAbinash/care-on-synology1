/**
 * mriBrainVascularScreening.ts — Basic intracranial MRA screening inside MRI Brain
 * (mra/mrv spec §14, with §15's screening baseline).
 *
 * §14 is explicit that this is "intentionally NOT a second dedicated MRA editor", so
 * the module is a checklist and nothing more: six arterial families, one quick
 * observation each, the canonical normal seed, the canonical limitation line, and a
 * recommendation the radiologist selects. It has no field where an aneurysm's dome or
 * a carotid's percentage could be typed, which is how "must not expose the full
 * morphology / NASCET / angioarchitecture / vessel-wall / segment-by-segment grading"
 * workflows is enforced — the data shape cannot carry them, and the sentences it does
 * write are asserted against the wording those workflows would require.
 *
 * Three rules the ledger keeps for it:
 *
 *   - The limitation is one observation on its own concept, so applying the module
 *     twice cannot print the caveat twice, and removing it cannot leave an orphan.
 *   - A row says what the limited acquisition saw. "Suspected" stays in the sentence;
 *     nothing here grades, stages or confirms, because the dedicated modules do that
 *     when they exist.
 *   - Screening rows sit on screening concepts, not on the dedicated per-segment vessel
 *     slots, so a screening pass never overwrites a dedicated observation. Which panel
 *     a study gets is the composition resolver's decision (§2), never this module's.
 *
 * Pure functions only — no store, no React.
 */

import type { BrainAtomSpec } from "./mriBrainAtoms";
import { brainBundleId } from "./mriBrainAtoms";
import { VASCULAR_LIBRARY_PROSE, MRA_SCREENING_PROSE } from "./mriBrainVascularProse";
import { vascularGate } from "./mriBrainVascularTechnique";
import type {
  VascularLesionContext,
  VascularLesionResult,
} from "./mriBrainVascularLesions";

/** §14's checklist: the six arterial families, with the sides the study reports. */
export type ScreeningVesselFamily = {
  id: string;
  label: string;
  sides: readonly ("right" | "left")[];
  /** The dedicated-registry segments this compact row stands for. */
  covers: readonly string[];
};

export const SCREENING_VESSEL_FAMILIES: readonly ScreeningVesselFamily[] = [
  { id: "ica", label: "intracranial ICA", sides: ["right", "left"], covers: ["ica-intracranial", "ica-terminus"] },
  { id: "aca", label: "ACA", sides: ["right", "left"], covers: ["aca-a1", "aca-a2"] },
  { id: "mca", label: "MCA", sides: ["right", "left"], covers: ["mca-m1", "mca-m2", "mca-bifurcation"] },
  { id: "pca", label: "PCA", sides: ["right", "left"], covers: ["pca-p1", "pca-p2"] },
  { id: "vertebral", label: "vertebral artery", sides: ["right", "left"], covers: ["vertebral-intracranial"] },
  { id: "basilar", label: "basilar artery", sides: [], covers: ["basilar"] },
];

export type ScreeningRowKey = `${string}-${"right" | "left" | "unpaired"}`;

/**
 * The ledger slot for one screening row.
 *
 * The side is part of the concept rather than only `laterality`, because an
 * alias-resolved concept can collide across laterality in the ownership helpers
 * (`observationsMutuallyExclusive` treats an opposite side as a sibling rather than a
 * distinct identity, and a sentence naming "right … left …" reads as bilateral). A
 * screening pass is a distinct record from the dedicated per-segment observation on
 * the same artery, so it takes its own identity outright: right and left MCA are two
 * rows, and neither of them is the dedicated MRA's M1.
 */
export function screeningRowConcept(
  family: ScreeningVesselFamily,
  side: "right" | "left" | "unpaired",
): string {
  return side === "unpaired"
    ? `mra_screening_${family.id}`
    : `mra_screening_${family.id}_${side}`;
}

/** One checklist row for the panel: a side of a family, or the unpaired basilar. */
export function screeningChecklistRows(): {
  key: ScreeningRowKey;
  family: ScreeningVesselFamily;
  side: "right" | "left" | "unpaired";
  label: string;
  concept: string;
}[] {
  const rows: ReturnType<typeof screeningChecklistRows> = [];
  for (const family of SCREENING_VESSEL_FAMILIES) {
    if (!family.sides.length) {
      rows.push({
        key: `${family.id}-unpaired` as ScreeningRowKey,
        family,
        side: "unpaired",
        label: family.label,
        concept: screeningRowConcept(family, "unpaired"),
      });
      continue;
    }
    for (const side of family.sides) {
      rows.push({
        key: `${family.id}-${side}` as ScreeningRowKey,
        family,
        side,
        label: `${side} ${family.label}`,
        concept: screeningRowConcept(family, side),
      });
    }
  }
  return rows;
}

/** §14's seven quick observations, in the order the panel lists them. */
export const SCREENING_OBSERVATIONS = [
  "grosslyPatent",
  "focalFlowReduction",
  "significantStenosisSuspected",
  "nonVisualizationSuspected",
  "grossAneurysmalOutpouching",
  "majorAnatomicVariant",
  "otherSignificantAbnormality",
] as const;
export type ScreeningObservation = (typeof SCREENING_OBSERVATIONS)[number];

export const SCREENING_OBSERVATION_LABELS: Record<ScreeningObservation, string> = {
  grosslyPatent: "Major intracranial arteries grossly patent",
  focalFlowReduction: "Focal flow-related signal reduction / narrowing",
  significantStenosisSuspected: "Significant stenosis suspected",
  nonVisualizationSuspected: "Vessel non-visualisation / occlusion suspected",
  grossAneurysmalOutpouching: "Gross aneurysmal outpouching",
  majorAnatomicVariant: "Major anatomic variant",
  otherSignificantAbnormality: "Other significant vascular abnormality",
};

/** §14, listed as data so the module can be checked against it rather than argued with. */
export const SCREENING_FORBIDDEN_WORKFLOWS = [
  "full aneurysm morphology workflow",
  "formal neck/dome ratio workflow",
  "NASCET calculations",
  "detailed AVM angioarchitecture/grading",
  "detailed vessel-wall characterisation",
  "exhaustive segment-by-segment stenosis grading",
] as const;

/**
 * The words those workflows would put in a sentence. Screening prose is asserted
 * against this, so a future edit that quietly adds a grade fails a test instead of
 * shipping a screening panel that behaves like a dedicated one.
 */
export const SCREENING_PROHIBITED_WORDING =
  /nascet|\d+\s*%|\bdome\b|neck width|aspect ratio|spetzler|nidus|draining vein|intramural|vessel[- ]wall|wall thickening|ulcerat|segment-by-segment| stenosis of (\d+)|mild|moderate|severe|high-grade/i;

/** The fields the record can carry — the shape IS the §14 restriction. */
export type ScreeningRow = {
  key: ScreeningRowKey;
  observation: ScreeningObservation;
  /** Required for `otherSignificantAbnormality`: what the radiologist saw. */
  note?: string;
};

export type ScreeningRecord = {
  /** §14: the limited acquisition was actually performed — stated, never billed. */
  performed: boolean;
  /** The canonical normal seed, selected when the whole checklist is normal. */
  normalSeedSelected?: boolean;
  rows?: readonly ScreeningRow[];
  /** §14: a radiologist-selected recommendation, not an automatic escalation. */
  recommendDedicatedVascularEvaluation?: boolean;
  recommendationDetail?: string;
  manualNote?: string;
};

/** Does the screening module contribute anything to this report? */
export function screeningContributes(record: ScreeningRecord): boolean {
  return Boolean(
    record.performed
    && (record.normalSeedSelected || (record.rows?.length ?? 0) > 0 || record.manualNote?.trim()),
  );
}

function screeningRowSentence(row: ScreeningRow, label: string): string {
  switch (row.observation) {
    case "grosslyPatent":
      return `The ${label} demonstrates preserved flow-related signal.`;
    case "focalFlowReduction":
      return `Focal flow-related signal reduction in the ${label}, without a graded stenosis.`;
    case "significantStenosisSuspected":
      return `Haemodynamically significant stenosis is suspected in the ${label} on this limited acquisition.`;
    case "nonVisualizationSuspected":
      return `Non-visualisation of the ${label} on this limited acquisition; occlusion is suspected rather than confirmed.`;
    case "grossAneurysmalOutpouching":
      return `A gross aneurysmal outpouching is suggested at the ${label}.`;
    case "majorAnatomicVariant":
      return `A major anatomic variant is noted at the ${label}.`;
    case "otherSignificantAbnormality":
      return `Significant vascular abnormality of the ${label}: ${(row.note ?? "").trim()}`;
  }
}

function screeningRowsFor(record: ScreeningRecord) {
  return new Map(screeningChecklistRows().map((row) => [row.key, row]));
}

/** Every concept this module can write, so the concept canon cannot drift from it. */
export function screeningConceptEntries(): {
  concept: string;
  label: string;
  description: string;
  impressionworthyAbnormal: boolean;
}[] {
  return [
    ...screeningChecklistRows().map((row) => ({
      concept: row.concept,
      label: `Basic MRA screening: ${row.label}`,
      description: "Compact §14 screening observation for one arterial family and side, never a dedicated segment record.",
      impressionworthyAbnormal: true,
    })),
    {
      concept: "mra_screening",
      label: "Basic Intracranial MRA Screening",
      description: "The screening module's canonical normal statement (§14, §15).",
      impressionworthyAbnormal: false,
    },
    {
      concept: "mra_screening_limitation",
      label: "MRA Screening Limitation",
      description: "The §14 limitation statement, held once per report while screening contributes.",
      impressionworthyAbnormal: false,
    },
  ];
}

/** The §14 limitation, on its own slot so it can only be present once. */
export function screeningLimitationAtom(record: ScreeningRecord): BrainAtomSpec {
  return {
    concept: "mra_screening_limitation",
    conflictGroup: "mra-screening-limitation",
    anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
    findings: MRA_SCREENING_PROSE.limitation,
    role: "baseline",
    recommendation: record.recommendDedicatedVascularEvaluation
      ? `Recommend dedicated MR angiography${record.recommendationDetail?.trim()
        ? ` — ${record.recommendationDetail.trim()}`
        : " for complete vascular assessment"}.`
      : undefined,
  };
}

/**
 * Compile the screening record onto the brain ledger: the selected checklist rows,
 * the canonical normal seed, and the limitation statement exactly once.
 */
export function screeningAtoms(
  record: ScreeningRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const bundleId = brainBundleId("mra-screening", "module");
  if (!record.performed) {
    return {
      atoms: [],
      bundleId: "",
      errors: [
        "Basic intracranial MRA screening is recorded only when the limited angiographic acquisition was performed; the booking does not decide that (§2, §14).",
      ],
    };
  }
  const gate = vascularGate("arterialAssessment", ctx.technique ?? null, ctx.brain);
  if (!gate.allowed) {
    return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
  }
  if (!screeningContributes(record)) {
    return { atoms: [], bundleId: "", errors: ["nothing recorded for basic MRA screening"] };
  }

  const rowsByKey = screeningRowsFor(record);
  const atoms: BrainAtomSpec[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const row of record.rows ?? []) {
    const checklistRow = rowsByKey.get(row.key);
    if (!checklistRow) {
      errors.push(`"${row.key}" is not a row of the §14 screening checklist.`);
      continue;
    }
    if (row.observation === "otherSignificantAbnormality" && !row.note?.trim()) {
      errors.push(
        `An "other significant abnormality" row needs what was seen in the ${checklistRow.label}.`,
      );
      continue;
    }
    const isNormal = row.observation === "grosslyPatent";
    atoms.push({
      concept: checklistRow.concept,
      conflictGroup: checklistRow.key,
      anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
      findings: screeningRowSentence(row, checklistRow.label),
      // A suspected abnormality belongs in the impression; a patent row does not.
      impression: isNormal
        ? undefined
        : `${cap(checklistRow.label)}: ${suspectedPhrase(row.observation)}.`,
      baselineReplaces: isNormal ? undefined : MRA_SCREENING_PROSE.normal,
      laterality: checklistRow.side === "unpaired" ? undefined : checklistRow.side,
      supportsLaterality: checklistRow.side !== "unpaired",
      role: isNormal ? "baseline" : "finding",
      state: SCREENING_OBSERVATION_LABELS[row.observation],
    });
  }
  if (record.normalSeedSelected) {
    atoms.push({
      concept: "mra_screening",
      conflictGroup: "mra-screening-normal",
      anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
      findings: MRA_SCREENING_PROSE.normal,
      // The seed is the screening module's normal; a dedicated all-normal MRA sentence
      // is a different claim, and both in one report would contradict each other.
      baselineReplaces: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
      role: "baseline",
    });
    if ((record.rows ?? []).some((r) => r.observation !== "grosslyPatent")) {
      warnings.push(
        "The screening normal seed is recorded beside an abnormal screening row; the seed should describe what was actually seen.",
      );
    }
  }
  if (record.manualNote?.trim()) {
    atoms.push({
      concept: "mra_screening",
      conflictGroup: "mra-screening-note",
      anatomicalSection: MRA_SCREENING_PROSE.sectionLabel,
      findings: record.manualNote.trim(),
    });
  }
  if (errors.length) return { atoms: [], bundleId: "", errors };

  // §14: one limitation statement whenever — and only while — the module contributes.
  atoms.push(screeningLimitationAtom(record));
  return {
    atoms,
    bundleId,
    warnings: warnings.length ? warnings : undefined,
  };
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The impression keeps the uncertainty the acquisition carries (§7, §14). */
function suspectedPhrase(observation: ScreeningObservation): string {
  switch (observation) {
    case "focalFlowReduction":
      return "focal flow-related signal reduction, ungraded";
    case "significantStenosisSuspected":
      return "significant stenosis suspected on a limited acquisition";
    case "nonVisualizationSuspected":
      return "non-visualisation, occlusion suspected rather than confirmed";
    case "grossAneurysmalOutpouching":
      return "gross aneurysmal outpouching suggested";
    case "majorAnatomicVariant":
      return "major anatomic variant noted";
    case "otherSignificantAbnormality":
      return "significant vascular abnormality, as described";
    case "grosslyPatent":
      return "grossly patent";
  }
}
