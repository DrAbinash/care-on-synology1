/**
 * mriBrainVascularTechnique.ts — what vascular acquisition was ACTUALLY performed
 * (mra/mrv spec §4), separate from the parenchymal sequence model.
 *
 * `mriBrainSequences.ts` answers "was there an MRA?" as one boolean derived from
 * free text. That is not enough for vascular reporting, because the safety of a
 * vascular sentence depends on *which* angiographic technique produced it:
 *
 *   - 2D/3D TOF shows flowing blood, not a lumen. Signal loss can be slow flow,
 *     turbulence or a saturated slab, so TOF alone may not generate a numeric
 *     stenosis or an occlusion (§5, §7).
 *   - "Early draining veins" is a temporal claim and needs a time-resolved
 *     technique; a static MRA cannot support it (§9).
 *   - An intramural hematoma is a vessel-wall claim and needs vessel-wall /
 *     black-blood or an equivalent source sequence (§11).
 *   - Enhancement needs contrast; diffusion needs DWI + ADC; blooming needs
 *     GRE/SWI — these come from the parenchymal model and are reused, not
 *     duplicated.
 *
 * Availability is derived from the recorded technique text and is ALWAYS manually
 * overridable, with the manual answer winning on every re-derivation (spec §2:
 * "Performed protocol/sequence availability is authoritative and manually
 * overridable by the radiologist. Billing label alone must not fabricate a
 * performed vascular sequence"). Billing is therefore never read here at all —
 * see `mriBrainVascularCatalog.ts` for the booking side, which only ever
 * *proposes* a module role.
 *
 * Pure functions only — no store, no React.
 */

import type { BrainSequenceKey, BrainSequenceContext } from "./mriBrainSequences";

export type VascularTechniqueKey =
  | "mraTof"
  | "mraCe"
  | "mraVesselWall"
  | "mrvTof"
  | "mrvPhaseContrast"
  | "mrvCe"
  | "sourceImages"
  | "mipReformatted"
  | "timeResolved"
  | "otherManual";

export const VASCULAR_TECHNIQUE_KEYS: VascularTechniqueKey[] = [
  "mraTof",
  "mraCe",
  "mraVesselWall",
  "mrvTof",
  "mrvPhaseContrast",
  "mrvCe",
  "sourceImages",
  "mipReformatted",
  "timeResolved",
  "otherManual",
];

export const VASCULAR_TECHNIQUE_LABELS: Record<VascularTechniqueKey, string> = {
  mraTof: "TOF MRA (time-of-flight)",
  mraCe: "contrast-enhanced MRA",
  mraVesselWall: "vessel-wall / black-blood MRA",
  mrvTof: "TOF MRV",
  mrvPhaseContrast: "phase-contrast MRV",
  mrvCe: "contrast-enhanced MRV",
  sourceImages: "angiographic source images",
  mipReformatted: "MIP / reformatted images",
  timeResolved: "time-resolved acquisition",
  otherManual: "other technique stated by the radiologist",
};

export type VascularTechniqueState = {
  /** What the recorded technique text (or the radiologist) says was acquired. */
  acquired: Record<VascularTechniqueKey, boolean>;
  /**
   * Keys the radiologist stated by hand. Re-derivation from the Technique field
   * never overwrites these, in either direction — saying "no contrast was given"
   * must survive a technique line that mentions gadolinium.
   */
  manual: Partial<Record<VascularTechniqueKey, boolean>>;
  /** Free-text designation for `otherManual`. */
  designationNote?: string | null;
};

const PATTERNS: Record<VascularTechniqueKey, RegExp> = {
  mraTof: /\b(?:2d|3d)\s*tof\b|\btof\s*mra\b|\bmra\b[^.]{0,40}\btof\b|time[- ]of[- ]flight/i,
  mraCe: /\bce[- ]?mra\b|contrast[- ]enhanced[^.]{0,25}\b(?:mra|mr\s+angiograph\w*|angiograph\w*)|post[- ]contrast[^.]{0,25}\bmra\b|\bgadolin\w*[^.]{0,30}\b(?:mra|angiograph\w*)/i,
  mraVesselWall: /vessel[- ]wall|black[- ]blood|\bvr\s?black\b|dark[- ]blood/i,
  mrvTof: /\btof\s*mrv\b|mr\s*venograph[^.]{0,30}\btof\b/i,
  mrvPhaseContrast: /phase[- ]?contrast|pc[- ]?mrv|\bpc\s*mrv\b/i,
  mrvCe: /\bce[- ]?mrv\b|contrast[- ]enhanced[^.]{0,25}\b(?:mrv|mr\s+venograph\w*|venograph\w*)|post[- ]contrast[^.]{0,25}\b(?:mrv|venograph\w*)/i,
  sourceImages: /source\s+images?|\braw\s+data\b|maximum\s|intensity\s+projection/i,
  mipReformatted: /\bmip\b|reformatt|max(?:imum)?[- ]intensity[- ]projection/i,
  timeResolved: /time[- ]?resolved|\btricks\b|\b4d\b[- ]?(?:mra|flow|nc)|dynamic\s+mra/i,
  otherManual: /\b(other|alternative)\s+(?:angiographic|vascular)\s+technique/i,
};

/** Nothing is assumed acquired until the study says so or the radiologist says so. */
export function defaultVascularTechnique(
  overrides: Partial<VascularTechniqueState> = {},
): VascularTechniqueState {
  const acquired = {} as Record<VascularTechniqueKey, boolean>;
  for (const key of VASCULAR_TECHNIQUE_KEYS) acquired[key] = false;
  return { acquired, manual: {}, designationNote: null, ...overrides };
}

export type VascularTechniqueSourceText = {
  techniqueText?: string | null;
  protocolName?: string | null;
  studyDescription?: string | null;
  reportTitle?: string | null;
};

/**
 * Text-derived acquisition state. Deliberately conservative: an absent mention is
 * "unknown, treat as not acquired" for gating purposes, never an assumption that
 * a vascular sequence exists.
 */
export function deriveVascularTechniqueAcquired(
  src: VascularTechniqueSourceText,
): Record<VascularTechniqueKey, boolean> {
  const blob = [
    src.techniqueText,
    src.protocolName,
    src.studyDescription,
    src.reportTitle,
  ]
    .filter(Boolean)
    .join(" ");
  const out = {} as Record<VascularTechniqueKey, boolean>;
  for (const key of VASCULAR_TECHNIQUE_KEYS) out[key] = blob.length > 0 && PATTERNS[key].test(blob);
  // "non-contrast" TOF is the default intracranial MRA; the phrase must not light
  // the contrast-enhanced keys, exactly as the parenchymal model guards contrast.
  if (/non[- ]?contrast|without contrast|no contrast/i.test(blob)) {
    out.mraCe = false;
    out.mrvCe = false;
  }
  return out;
}

/** Manual answers win; derived answers fill the rest. */
export function resolveVascularTechnique(
  state: VascularTechniqueState | null | undefined,
): Record<VascularTechniqueKey, boolean> {
  const s = state ?? defaultVascularTechnique();
  return { ...s.acquired, ...s.manual };
}

/**
 * Fold a fresh derivation into stored state without touching anything the
 * radiologist stated by hand.
 */
export function withDerivedVascularTechnique(
  state: VascularTechniqueState | null | undefined,
  derived: Record<VascularTechniqueKey, boolean>,
): VascularTechniqueState {
  const s = state ?? defaultVascularTechnique();
  return { ...s, acquired: { ...derived, ...s.manual } };
}

/** Record the radiologist's own answer for one key. */
export function markVascularTechniqueManual(
  state: VascularTechniqueState | null | undefined,
  key: VascularTechniqueKey,
  performed: boolean,
): VascularTechniqueState {
  const s = state ?? defaultVascularTechnique();
  return {
    ...s,
    acquired: { ...s.acquired, [key]: performed },
    manual: { ...s.manual, [key]: performed },
  };
}

// ─── What each acquisition is allowed to answer ──────────────────────────

/**
 * A vascular claim that depends on technique. The gate is the mechanism behind
 * the specification's recurring instruction — the observation stays recordable,
 * the dependent interpretation does not.
 */
export type VascularGateFeature =
  | "arterialAssessment"
  | "venousAssessment"
  | "numericStenosis"
  | "selectedOcclusion"
  | "acuteOcclusion"
  | "aneurysmMorphology"
  | "earlyVenousDrainage"
  | "intramuralHematoma"
  | "vesselWallCharacterisation"
  | "thrombusSignal"
  | "fillingDefect"
  | "enhancement"
  | "diffusion"
  | "blooming";

export type VascularGateRule = {
  label: string;
  /** Any ONE of these vascular acquisitions satisfies the feature. */
  anyOf?: VascularTechniqueKey[];
  /** Every one of these parenchymal sequences is required. */
  requiresBrain?: BrainSequenceKey[];
  /** Why the feature is unsafe without them — shown to the radiologist. */
  notice: string;
};

export const VASCULAR_GATES: Record<VascularGateFeature, VascularGateRule> = {
  arterialAssessment: {
    label: "arterial assessment",
    anyOf: ["mraTof", "mraCe", "mraVesselWall", "timeResolved"],
    notice: "No intracranial arterial acquisition is recorded, so no arterial statement can be produced.",
  },
  venousAssessment: {
    label: "venous assessment",
    anyOf: ["mrvTof", "mrvPhaseContrast", "mrvCe"],
    notice: "No MR venography acquisition is recorded, so no venous statement can be produced.",
  },
  numericStenosis: {
    label: "numeric intracranial stenosis",
    // §7: a percentage needs a lumen-bearing acquisition (contrast-enhanced or
    // vessel-wall) or source images to measure on — never signal loss on TOF.
    anyOf: ["mraCe", "mraVesselWall", "sourceImages", "mipReformatted"],
    notice: "A numeric intracranial stenosis is not generated from TOF signal loss. Enter it only against a contrast-enhanced / vessel-wall acquisition or measured source images, and its provenance is recorded.",
  },
  selectedOcclusion: {
    label: "confirmed / selected occlusion",
    anyOf: ["mraCe", "mraVesselWall", "sourceImages"],
    notice: "Non-visualisation on TOF is recorded as non-visualisation. A confirmed occlusion needs a lumen-bearing acquisition and is selected by the radiologist.",
  },
  acuteOcclusion: {
    label: "acute arterial occlusion",
    anyOf: ["mraCe", "mraVesselWall", "sourceImages"],
    requiresBrain: ["dwi"],
    notice: "Acuity is never assigned from MRA non-visualisation alone (§5, §7, §18). An acute occlusion needs supporting brain sequences — including DWI — and a radiologist-selected interpretation.",
  },
  aneurysmMorphology: {
    label: "aneurysm morphology workflow",
    anyOf: ["mraTof", "mraCe", "sourceImages", "mipReformatted"],
    notice: "Formal aneurysm morphology needs a dedicated angiographic acquisition to measure on.",
  },
  earlyVenousDrainage: {
    label: "early / temporal venous drainage",
    anyOf: ["timeResolved"],
    notice: "Early draining veins are a temporal observation. A static MRA cannot establish them, however strongly an AVM is suspected (§9, §18).",
  },
  intramuralHematoma: {
    label: "intramural hematoma",
    anyOf: ["mraVesselWall"],
    requiresBrain: ["t1"],
    notice: "A T1 intramural hematoma is claimed only when vessel-wall / black-blood or an equivalent source sequence exists (§4, §11). Its presence is never by itself proof of an acute dissection.",
  },
  vesselWallCharacterisation: {
    label: "vessel-wall characterisation",
    anyOf: ["mraVesselWall"],
    notice: "Vessel-wall characterisation requires a vessel-wall / black-blood acquisition.",
  },
  thrombusSignal: {
    label: "thrombus signal characteristics",
    requiresBrain: ["t1", "t2"],
    notice: "Thrombus signal is described only against the source sequences that show it.",
  },
  fillingDefect: {
    label: "venous filling defect",
    anyOf: ["mrvCe", "mrvPhaseContrast"],
    notice: "A filling defect is a contrast / phase-contrast observation; on a TOF venogram a gap in flow signal is recorded as a flow gap, not a thrombus (§12).",
  },
  enhancement: {
    label: "contrast enhancement",
    requiresBrain: ["contrast"],
    notice: "Enhancement wording needs contrast to have been given.",
  },
  diffusion: {
    label: "diffusion restriction",
    requiresBrain: ["dwi", "adc"],
    notice: "Diffusion wording needs DWI with ADC.",
  },
  blooming: {
    label: "GRE/SWI blooming",
    requiresBrain: ["swiGre"],
    notice: "Blooming / susceptibility wording needs a GRE or SWI acquisition.",
  },
};

export type VascularGate = {
  allowed: boolean;
  feature: VascularGateFeature;
  label: string;
  /** What is missing, for the notice and the technique row. */
  missing: string[];
  notice: string;
};

/**
 * Can this technique support that vascular claim? `false` never means "the
 * finding is wrong" — it means the software may not produce that wording, and the
 * radiologist either states the acquisition or records the descriptive form.
 */
export function vascularGate(
  feature: VascularGateFeature,
  state: VascularTechniqueState | null | undefined,
  brain: BrainSequenceContext,
): VascularGate {
  const rule = VASCULAR_GATES[feature];
  const acquired = resolveVascularTechnique(state);
  const missing: string[] = [];
  if (rule.anyOf && !rule.anyOf.some((k) => acquired[k])) {
    missing.push(rule.anyOf.map((k) => VASCULAR_TECHNIQUE_LABELS[k]).join(" / "));
  }
  for (const key of rule.requiresBrain ?? []) {
    if (!brain.performed[key]) missing.push(`parenchymal ${key}`);
  }
  return {
    allowed: missing.length === 0,
    feature,
    label: rule.label,
    missing,
    notice: rule.notice,
  };
}

/** Statements that need an acquisition the study may not have (spec §19). */
export const VASCULAR_STATEMENT_RULES: Array<{
  feature: VascularGateFeature;
  re: RegExp;
  label: string;
}> = [
  { feature: "numericStenosis", re: /\d{1,3}\s*%[^.]{0,40}\b(?:steno\w*|narrowing|occlusion)|\b(?:stenosis|narrowing)\b[^.]{0,30}\d{1,3}\s*%/i, label: "a numeric stenosis percentage" },
  { feature: "acuteOcclusion", re: /\bacute\s+(?:arterial\s+)?(?:occlusion|infarct|large[- ]vessel)/i, label: "an acute arterial occlusion" },
  { feature: "earlyVenousDrainage", re: /early\s+drain\w+|premature\s+(?:vein|venous)\s+drainage|early\s+venous/i, label: "early venous drainage" },
  { feature: "intramuralHematoma", re: /intramural\s+hematoma|intramural\s+haematoma|crescentic\s+t1\s+hyperintense/i, label: "an intramural hematoma" },
  { feature: "vesselWallCharacterisation", re: /vessel[- ]wall(?:\s+(?:thickening|enhancement|imaging))?|black[- ]blood/i, label: "vessel-wall characterisation" },
  { feature: "fillingDefect", re: /filling\s+defect/i, label: "a venous filling defect" },
  { feature: "thrombusSignal", re: /\bclot\b|thromb(?:us|osis)[^.]{0,40}\bt1\b|t1\s+hyperintense\s+clot/i, label: "thrombus signal characteristics" },
];
