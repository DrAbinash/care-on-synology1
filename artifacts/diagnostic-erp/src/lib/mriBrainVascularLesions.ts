/**
 * mriBrainVascularLesions.ts — the three structured vascular objects:
 * aneurysm (§6), moyamoya pattern (§8) and AVM (§9).
 *
 * These are the parts of a vascular study a palette tile cannot carry, because each
 * one is a set of entered measurements and explicitly selected clauses rather than a
 * sentence. Like every other vascular module they compile to `BrainAtomSpec`s for the
 * ONE brain ledger — no second report, no second editor.
 *
 * Three rules are enforced here in code rather than left to the UI:
 *
 *   - §6: the dome-to-neck ratio is never an input. `AneurysmRecord` has no ratio
 *     field, so the only way a ratio reaches the report is by being calculated from
 *     the dome height and neck width that were entered.
 *   - §6: an aneurysm carries no rupture wording unless the radiologist selects one.
 *     Nothing here derives "ruptured" or "unruptured" from appearance.
 *   - §8/§9: pattern and diagnosis are different slots. The pattern builder cannot
 *     emit the disease sentence, the AVM builder cannot emit a temporal drainage
 *     claim without a time-resolved acquisition, and neither derives a formal grade.
 *
 * Slot identity comes from `mriBrainVessels.ts`. The generic `aneurysm` concept owns
 * every sentence that mentions an aneurysm, so an aneurysm is recorded on its parent
 * vessel's own concept: that is what makes "one or multiple aneurysms" possible
 * instead of the second overwriting the first.
 *
 * Pure functions only — no store, no React.
 */

import { brainBundleId, type BrainAtomSpec } from "./mriBrainAtoms";
import { aneurysmAspectRatio, severityForAneurysm } from "./mriBrainMeasures";
import type { BrainSequenceContext } from "./mriBrainSequences";
import {
  remainderNormalAtom,
  vesselFindingsSection,
} from "./mriBrainVesselObservations";
import {
  canonicalVesselSlot,
  isAneurysmCapableVessel,
  vesselBaseKey,
  vesselConceptId,
  vesselDisplayName,
  type VesselDefinition,
  type VesselSide,
} from "./mriBrainVessels";
import { VASCULAR_FINDINGS_SECTIONS } from "./mriBrainVascularProse";
import {
  vascularGate,
  type VascularGate,
  type VascularGateFeature,
  type VascularTechniqueState,
} from "./mriBrainVascularTechnique";

/** What every builder needs: what was acquired, and which parenchymal sequences exist. */
export type VascularLesionContext = {
  technique?: VascularTechniqueState | null;
  brain: BrainSequenceContext;
};

export type VascularLesionResult = {
  atoms: BrainAtomSpec[];
  bundleId: string;
  /** A gate refused the wording: the panel shows the notice rather than retrying. */
  blocked?: { notice: string; missing: string[] };
  /** The object is not recordable as entered — an unresolvable vessel, two rows on
   * one slot. Reported per row so a typo never writes onto another artery. */
  errors?: string[];
  /** §19: the record is written, and the report should say why it looks odd. A
   * warning never blocks a radiologist-controlled statement. */
  warnings?: string[];
};

/** §6/§8/§9: a clause is only written when the radiologist chose one of these. */
export const VESSEL_ASSESSABLE = ["present", "absent"] as const;
export type Assessable = (typeof VESSEL_ASSESSABLE)[number] | "";

export const ANEURYSM_MORPHOLOGIES = ["saccular", "fusiform", "other"] as const;
export type AneurysmMorphology = (typeof ANEURYSM_MORPHOLOGIES)[number];

/** Radiologist-stated only. An empty value writes no rupture wording at all. */
export const ANEURYSM_RUPTURE_STATUSES = ["unruptured", "ruptured"] as const;
export type AneurysmRuptureStatus = (typeof ANEURYSM_RUPTURE_STATUSES)[number] | "";

export const ANEURYSM_MORPHOLOGY_LABELS: Record<AneurysmMorphology, string> = {
  saccular: "Saccular",
  fusiform: "Fusiform",
  other: "Other morphology",
};

export const ANEURYSM_RUPTURE_LABELS: Record<
  Exclude<AneurysmRuptureStatus, "">,
  string
> = {
  unruptured: "Unruptured — stated by the radiologist for this study",
  ruptured: "Ruptured — stated by the radiologist for this study",
};

/**
 * The conclusion wording for the pattern record. The palette tile and the structured
 * object write the same slot, so the sentence is held here once.
 */
export const MOYAMOYA_PATTERN_IMPRESSION =
  "Moyamoya-pattern vasculopathy — findings raising suspicion; disease classification is a radiologist diagnosis.";

/** @see mriBrainVascularSubMasters — the palette's standalone rupture statement. */
export const ANEURYSM_UNRUPTURED_IMPRESSION =
  "Unruptured saccular aneurysm (radiologist-stated, supported by the complete study and clinical context).";

// ─── Measurement helpers ─────────────────────────────────────────────────

/** A form field is a positive number or empty — and `Number("")` is 0, not empty. */
export function vascularMeasure(raw: number | string | null | undefined): number | null {
  if (raw === "" || raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * §6's calculated value. The ratio pairs the dome HEIGHT with the NECK width, which
 * is the pairing the macro line states; the maximum transverse width is reported but
 * deliberately does not enter it.
 */
export function aneurysmDomeNeckRatio(
  a: Pick<AneurysmRecord, "domeHeightMm" | "neckWidthMm">,
): number | null {
  const dome = vascularMeasure(a.domeHeightMm);
  const neck = vascularMeasure(a.neckWidthMm);
  if (dome == null || neck == null) return null;
  return aneurysmAspectRatio(dome, neck);
}

// ─── §6 aneurysm ─────────────────────────────────────────────────────────

export type AneurysmRecord = {
  /** Free text resolved through the vessel registry; unresolved text is an error. */
  parentVessel: string;
  /** §6 exact segment / junction, when the record needs more precision than the vessel. */
  segment?: string;
  side?: VesselSide | "";
  territory?: "intracranialArterial" | "neckArterial";
  morphology?: AneurysmMorphology | "";
  /** The three §6 source measurements. The ratio is not a field of this object. */
  domeHeightMm?: number | "";
  maxWidthMm?: number | "";
  neckWidthMm?: number | "";
  orientation?: string;
  branchIncorporation?: Assessable;
  daughterSac?: boolean;
  thrombus?: Assessable;
  massEffect?: Assessable;
  /** §6: only writable when a susceptibility sequence exists to judge it from. */
  associatedHemorrhage?: Assessable;
  ruptureStatus?: AneurysmRuptureStatus;
  manualNote?: string;
};

/** True when anything beyond the parent vessel has been entered. */
export function aneurysmHasMorphologyInput(a: AneurysmRecord): boolean {
  return (
    Boolean(a.morphology)
    || vascularMeasure(a.domeHeightMm) != null
    || vascularMeasure(a.maxWidthMm) != null
    || vascularMeasure(a.neckWidthMm) != null
    || Boolean(a.orientation?.trim())
    || Boolean(a.branchIncorporation)
    || Boolean(a.daughterSac)
    || Boolean(a.thrombus)
    || Boolean(a.massEffect)
    || Boolean(a.associatedHemorrhage)
    || Boolean(a.ruptureStatus)
    || Boolean(a.manualNote?.trim())
  );
}

function aneurysmDimensionsClause(a: AneurysmRecord): string {
  const dome = vascularMeasure(a.domeHeightMm);
  const width = vascularMeasure(a.maxWidthMm);
  const neck = vascularMeasure(a.neckWidthMm);
  const parts: string[] = [];
  if (dome != null) parts.push(`maximum dome height ${dome} mm`);
  if (width != null) parts.push(`maximum width ${width} mm`);
  if (neck != null) parts.push(`neck width ${neck} mm`);
  if (!parts.length) return "";
  const last = parts.length > 1 ? parts.pop() : "";
  const list = last ? `${parts.join(", ")} and ${last}` : parts[0] ?? "";
  const ratio = aneurysmDomeNeckRatio(a);
  return `measuring ${list}${ratio != null ? ` (dome-to-neck ratio ${ratio})` : ""}`;
}

/** The rupture word is present exactly when it was selected, and never inferred. */
function ruptureWord(status: AneurysmRuptureStatus | undefined): "" | "Ruptured" | "Unruptured" {
  return status === "ruptured" ? "Ruptured" : status === "unruptured" ? "Unruptured" : "";
}

function morphologyWord(morphology: AneurysmMorphology | "" | undefined): string {
  return morphology === "saccular" || morphology === "fusiform" ? morphology : "";
}

/** The head clause is assembled from optional words, so its first letter is not known. */
export function vascularSentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function aneurysmFindingsSentence(a: AneurysmRecord, vesselLabel: string): string {
  const dims = aneurysmDimensionsClause(a);
  const head = [
    ruptureWord(a.ruptureStatus),
    morphologyWord(a.morphology),
    "aneurysm",
    `of the ${vesselLabel}`,
    a.segment?.trim() ? `at the ${a.segment.trim()}` : "",
    dims,
  ].filter(Boolean).join(" ");
  const clauses: string[] = [`${vascularSentenceCase(head)}.`];
  if (a.orientation?.trim()) {
    clauses.push(`The aneurysm is oriented ${a.orientation.trim()}.`);
  }
  if (a.branchIncorporation === "present") {
    clauses.push("A branch vessel is incorporated at the neck.");
  } else if (a.branchIncorporation === "absent") {
    clauses.push("No branch vessel is incorporated.");
  }
  if (a.daughterSac) {
    clauses.push("A daughter sac / lobulated irregularity is present.");
  }
  if (a.thrombus === "present") {
    clauses.push("There is intrinsic thrombus within the sac.");
  } else if (a.thrombus === "absent") {
    clauses.push("There is no intrinsic thrombus.");
  }
  if (a.massEffect === "present") {
    clauses.push("There is adjacent parenchymal mass effect.");
  } else if (a.massEffect === "absent") {
    clauses.push("There is no adjacent parenchymal mass effect.");
  }
  if (a.associatedHemorrhage === "present") {
    clauses.push("Associated haemorrhage is present on T2* GRE/SWI.");
  } else if (a.associatedHemorrhage === "absent") {
    clauses.push("No associated haemorrhage is seen on T2* GRE/SWI.");
  }
  if (a.manualNote?.trim()) clauses.push(a.manualNote.trim());
  return clauses.join(" ");
}

export function aneurysmImpressionSentence(a: AneurysmRecord, vesselLabel: string): string {
  const dome = vascularMeasure(a.domeHeightMm);
  const neck = vascularMeasure(a.neckWidthMm);
  const size = dome != null && neck != null
    ? ` measuring ${dome} mm with a ${neck} mm neck`
    : dome != null
      ? ` measuring ${dome} mm`
      : "";
  const head = [
    ruptureWord(a.ruptureStatus) || "Cerebral",
    morphologyWord(a.morphology),
    "aneurysm",
  ].filter(Boolean).join(" ");
  return `${vascularSentenceCase(`${head} of the ${vesselLabel}${size}`)}.`;
}

/** Every gate an aneurysm record can need, in the order the record is read. */
function aneurysmGate(a: AneurysmRecord, ctx: VascularLesionContext): VascularGate | null {
  const checks: [boolean, VascularGateFeature][] = [
    [true, "arterialAssessment"],
    [aneurysmHasMorphologyInput(a), "aneurysmMorphology"],
    [Boolean(a.thrombus), "thrombusSignal"],
    [Boolean(a.associatedHemorrhage), "blooming"],
  ];
  for (const [applies, feature] of checks) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) return gate;
  }
  return null;
}

/** The ledger slot for one aneurysm record, or null when the text names no artery. */
export function aneurysmSlotFor(
  raw: string,
  opts: {
    side?: VesselSide | "";
    territory?: AneurysmRecord["territory"];
  } = {},
): {
  concept: string;
  level: string;
  laterality: string;
  label: string;
  vessel: VesselDefinition;
} | null {
  const slot = canonicalVesselSlot(raw, {
    side: opts.side || undefined,
    territory: opts.territory,
  });
  if (!slot || !isAneurysmCapableVessel(slot.vessel)) return null;
  return {
    concept: vesselConceptId(slot.vessel, { lesion: "aneurysm" }),
    level: slot.level,
    laterality: slot.laterality,
    label: vesselDisplayName(slot.vessel),
    vessel: slot.vessel,
  };
}

/**
 * One or more aneurysms (§6). Each record is one atom on its own parent vessel's
 * slot, so additional aneurysms coexist. Two records naming the same vessel and side
 * are an error rather than a silent overwrite, because that is the one case where
 * entered wording would be lost.
 */
export function aneurysmAtoms(
  records: readonly AneurysmRecord[],
  ctx: VascularLesionContext & {
    /** The tree-wide normal sentence the report currently carries. */
    replaceTreeNormal?: string;
    /** What is left of the tree once that normal is superseded. */
    remainderNormal?: string;
  },
): VascularLesionResult {
  const atoms: BrainAtomSpec[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const record of records) {
    const slot = aneurysmSlotFor(record.parentVessel, {
      side: record.side,
      territory: record.territory,
    });
    if (!slot) {
      errors.push(
        `"${record.parentVessel}" does not name a single artery in the vascular registry, `
        + "so no aneurysm slot can be opened for it.",
      );
      continue;
    }
    const gate = aneurysmGate(record, ctx);
    if (gate) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
    const slotKey = `${slot.concept}|${slot.laterality}`;
    if (seen.has(slotKey)) {
      errors.push(
        `Two aneurysm records describe the ${slot.label}. Describe them in one record, `
        + "or name the second vessel.",
      );
      continue;
    }
    seen.set(slotKey, `${vesselBaseKey(slot.vessel)}${slot.laterality ? `-${slot.laterality}` : ""}`);

    const dome = vascularMeasure(record.domeHeightMm);
    const ratio = aneurysmDomeNeckRatio(record);
    atoms.push({
      concept: slot.concept,
      conflictGroup: `${slot.vessel.key}-aneurysm`,
      anatomicalSection: vesselFindingsSection(slot.vessel),
      findings: aneurysmFindingsSentence(record, slot.label),
      impression: aneurysmImpressionSentence(record, slot.label),
      // The report cannot claim every vessel is aneurysm-free and describe one below it.
      baselineReplaces: ctx.replaceTreeNormal?.trim() || undefined,
      level: slot.level,
      laterality: slot.laterality || undefined,
      supportsLaterality: slot.vessel.side !== "unpaired",
      severity: record.ruptureStatus === "ruptured"
        ? "critical"
        : severityForAneurysm(dome ?? 0),
      // The entered size stays on the observation, and the ratio only ever as a
      // derived statement of the same two measurements (§6).
      measurement: dome != null ? String(dome) : undefined,
      state: ratio != null ? `dome-to-neck ratio ${ratio}` : undefined,
    });
  }

  if (!atoms.length) {
    return { atoms: [], bundleId: "", errors: errors.length ? errors : ["no aneurysm record entered"] };
  }
  if (ctx.remainderNormal?.trim()) {
    // The same "the rest of the tree is normal" row the vessel status builder emits,
    // so an aneurysm and an abnormal vessel row reconcile the normal identically.
    atoms.push(remainderNormalAtom(
      "mra_arterial",
      "intracranialArterial",
      ctx.remainderNormal,
    ));
  }
  const key = [...seen.values()].join("+");
  return {
    atoms,
    bundleId: brainBundleId("aneurysm", key),
    errors: errors.length ? errors : undefined,
  };
}

// ─── §8 moyamoya pattern ─────────────────────────────────────────────────

export const MOYAMOYA_SIDES = ["right", "left", "bilateral"] as const;
export type MoyamoyaSide = (typeof MOYAMOYA_SIDES)[number] | "";

export type MoyamoyaPatternRecord = {
  /** §8 terminal ICA narrowing / occlusion, per side. */
  terminalIcaNarrowing?: MoyamoyaSide;
  proximalAcaInvolvement?: MoyamoyaSide;
  proximalMcaInvolvement?: MoyamoyaSide;
  /** The basal / lenticulostriate collateral network — the "puff of smoke". */
  basalCollateralNetwork?: boolean;
  asymmetric?: boolean;
  /** Associated brain findings, each on the gate of the sequence that shows it. */
  ischemicFindings?: boolean;
  hemorrhagicFindings?: boolean;
  manualNote?: string;
  /**
   * §8: the DISEASE is a radiologist classification on a different slot from the
   * pattern, and is never produced by the pattern record itself.
   */
  diseaseClassification?: boolean;
};

/** The library's pattern vocabulary, reassembled from what was actually entered. */
export function moyamoyaFindingsSentence(r: MoyamoyaPatternRecord): string {
  const clauses: string[] = [];
  if (r.terminalIcaNarrowing) {
    clauses.push(
      `Progressive narrowing / occlusion of the ${r.terminalIcaNarrowing} terminal `
      + "internal carotid artery extending into the proximal circle.",
    );
  }
  const proximal: string[] = [];
  if (r.proximalAcaInvolvement) proximal.push(`ACA (A1/A2) on the ${r.proximalAcaInvolvement}`);
  if (r.proximalMcaInvolvement) proximal.push(`MCA (M1/M2) on the ${r.proximalMcaInvolvement}`);
  if (proximal.length) {
    clauses.push(`Involvement of the proximal ${proximal.join(" and the ")}.`);
  }
  if (r.basalCollateralNetwork) {
    clauses.push(
      "A dense network of lenticulostriate collateral vessels is present "
      + "(\"puff of smoke\" appearance).",
    );
  }
  if (r.asymmetric) clauses.push("The pattern is asymmetric.");
  if (r.ischemicFindings) clauses.push("Associated acute ischaemic change is present on DWI/ADC.");
  if (r.hemorrhagicFindings) clauses.push("Associated haemorrhagic change is present on T2* GRE/SWI.");
  if (r.manualNote?.trim()) clauses.push(r.manualNote.trim());
  return clauses.join(" ");
}

export function moyamoyaDiseaseAtom(): BrainAtomSpec {
  return {
    concept: "mra_moyamoya_disease",
    conflictGroup: "moyamoya-disease",
    anatomicalSection: VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality,
    findings:
      "The angiographic pattern is classified by the reporting radiologist as Moyamoya disease.",
    impression: "Moyamoya disease (radiologist classification).",
  };
}

/**
 * §8: the pattern record and — only when the radiologist selects it — the separate
 * disease classification.
 */
export function moyamoyaAtoms(
  record: MoyamoyaPatternRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const bundleId = brainBundleId("moyamoya", "pattern");
  const sentence = moyamoyaFindingsSentence(record);
  if (!sentence.trim()) {
    return { atoms: [], bundleId: "", errors: ["no moyamoya-pattern findings entered"] };
  }
  const checks: [boolean, VascularGateFeature][] = [
    [true, "arterialAssessment"],
    [Boolean(record.ischemicFindings), "diffusion"],
    [Boolean(record.hemorrhagicFindings), "blooming"],
  ];
  for (const [applies, feature] of checks) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }
  const atoms: BrainAtomSpec[] = [
    {
      concept: "mra_moyamoya_pattern",
      conflictGroup: "moyamoya-pattern",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality,
      findings: sentence,
      impression: MOYAMOYA_PATTERN_IMPRESSION,
      severity: "significant",
      laterality: record.terminalIcaNarrowing === "bilateral" ? "bilateral" : undefined,
      state: record.basalCollateralNetwork ? "basal collateral network" : undefined,
    },
  ];
  // Selecting the pattern rows above does not reach this line (§8).
  if (record.diseaseClassification) atoms.push(moyamoyaDiseaseAtom());
  return { atoms, bundleId };
}

// ─── §9 AVM ──────────────────────────────────────────────────────────────

export const AVM_DRAINAGE_PATTERNS = ["superficial", "deep", "both"] as const;
export type AvmDrainagePattern = (typeof AVM_DRAINAGE_PATTERNS)[number] | "";

export const AVM_SPETZLER_MARTIN_GRADES = [1, 2, 3, 4, 5] as const;
export type SpetzlerMartinGrade = (typeof AVM_SPETZLER_MARTIN_GRADES)[number] | "";

/** §9: no grade is computed. A grade reaches the report only as an entered value. */
export const AVM_GRADING_NOTICE =
  "No AVM grade is calculated by the software. A Spetzler–Martin grade is reported only when the radiologist enters it against explicitly captured grading inputs (§9).";

export type AvmRecord = {
  /** Location / lobe — free text, because the nidus sits in brain, not in a vessel. */
  location: string;
  nidusPresent?: boolean;
  nidusApCm?: number | "";
  nidusTransverseCm?: number | "";
  nidusCcCm?: number | "";
  /** Resolved through the vessel registry, so a feeder names a real artery. */
  arterialFeeders?: readonly string[];
  venousDrainage?: string;
  drainagePattern?: AvmDrainagePattern;
  deepDrainageAssessable?: boolean;
  /** §9: a temporal claim, so the time-resolved gate applies to it. */
  earlyVenousDrainage?: boolean;
  associatedAneurysm?: boolean;
  associatedHemorrhage?: boolean;
  gliosisOrEdema?: boolean;
  massEffect?: boolean;
  spetzlerMartinGrade?: SpetzlerMartinGrade;
  manualNote?: string;
};

function nidusSizeClause(r: AvmRecord): string {
  const dims = [
    vascularMeasure(r.nidusApCm) != null ? `${r.nidusApCm} cm AP` : "",
    vascularMeasure(r.nidusTransverseCm) != null ? `${r.nidusTransverseCm} cm transverse` : "",
    vascularMeasure(r.nidusCcCm) != null ? `${r.nidusCcCm} cm craniocaudal` : "",
  ].filter(Boolean);
  return dims.length ? ` measuring ${dims.join(" × ")}` : "";
}

export function avmFindingsSentence(r: AvmRecord, feederLabels: readonly string[] = []): string {
  const clauses: string[] = [];
  const loc = r.location.trim() || "cerebral hemisphere";
  clauses.push(
    r.nidusPresent === false
      ? `Complex vascular malformation (AVM) centred in the ${loc} without a demonstrable nidus.`
      : `Complex vascular malformation (AVM) centred in the ${loc} with a central nidus${nidusSizeClause(r)}.`,
  );
  if (feederLabels.length) {
    clauses.push(`Dominant arterial feeders from the ${feederLabels.join(", ")}.`);
  }
  if (r.venousDrainage?.trim()) {
    const route = r.drainagePattern
      ? ` by ${r.drainagePattern === "both" ? "superficial and deep" : r.drainagePattern} route`
      : "";
    clauses.push(
      `Venous drainage${route} into the ${r.venousDrainage.trim()}`
      + `${r.deepDrainageAssessable && r.drainagePattern !== "superficial" ? ", including deep venues" : ""}.`,
    );
  }
  if (r.associatedHemorrhage) {
    clauses.push("Associated haemorrhage is present on T2* GRE/SWI.");
  }
  if (r.gliosisOrEdema) clauses.push("Surrounding gliosis / oedema is present.");
  if (r.massEffect) clauses.push("Adjacent mass effect is present.");
  if (r.manualNote?.trim()) clauses.push(r.manualNote.trim());
  if (r.spetzlerMartinGrade) {
    clauses.push(`Spetzler–Martin grade ${r.spetzlerMartinGrade} (radiologist-entered).`);
  }
  return clauses.join(" ");
}

/**
 * §9: one AVM record, up to three slots — the malformation itself, its venous
 * drainage (a temporal claim needs its own gate), and an associated aneurysm stated
 * as an association rather than as a §6 measurement record.
 */
export function avmAtoms(
  record: AvmRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const errors: string[] = [];
  if (!record.location.trim()) errors.push("An AVM record needs its location / lobe.");

  const feeders: string[] = [];
  for (const raw of record.arterialFeeders ?? []) {
    const slot = canonicalVesselSlot(raw, { territory: "intracranialArterial" });
    if (!slot) {
      errors.push(`"${raw}" does not name a single artery, so no feeder can be recorded.`);
      continue;
    }
    feeders.push(vesselDisplayName(slot.vessel));
  }

  const checks: [boolean, VascularGateFeature][] = [
    [true, "arterialAssessment"],
    [Boolean(record.earlyVenousDrainage), "earlyVenousDrainage"],
    [Boolean(record.associatedHemorrhage), "blooming"],
  ];
  for (const [applies, feature] of checks) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }
  if (errors.length) return { atoms: [], bundleId: "", errors };

  const bundleId = brainBundleId("avm", record.location.trim().toLowerCase());
  const atoms: BrainAtomSpec[] = [
    {
      concept: "avm",
      conflictGroup: "avm-nidus",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality,
      findings: avmFindingsSentence(record, feeders),
      impression: `Arteriovenous malformation centred in ${record.location.trim()}.`,
      severity: "significant",
      state: record.nidusPresent === false ? "no nidus demonstrated" : "nidus present",
    },
  ];
  if (record.earlyVenousDrainage) {
    atoms.push({
      concept: "avm_venous_drainage",
      conflictGroup: "avm-drainage",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings:
        "Early draining veins are demonstrated on the time-resolved acquisition"
        + `${record.venousDrainage?.trim() ? `, draining into the ${record.venousDrainage.trim()}` : ""}.`,
      impression: "Arteriovenous shunting with early venous drainage (time-resolved study).",
      severity: "significant",
    });
  }
  if (record.associatedAneurysm) {
    atoms.push({
      concept: "avm_associated_aneurysm",
      conflictGroup: "avm-associated-aneurysm",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality,
      findings: "An aneurysm is associated with the arterial supply of the malformation.",
      impression: "Associated feeder-artery aneurysm.",
      // §6: a measured aneurysm is its own record; this slot only states the association.
      state: "association stated; no morphology recorded",
    });
  }
  return { atoms, bundleId };
}
