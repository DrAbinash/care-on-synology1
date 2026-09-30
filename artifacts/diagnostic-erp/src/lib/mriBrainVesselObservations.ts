/**
 * mriBrainVesselObservations.ts — the per-vessel observation model (§5, §7, §12).
 *
 * Every row of the arterial and venous trees compiles to the SAME brain atoms the
 * existing palette tiles use, addressed by the canonical vessel slot from
 * `mriBrainVessels.ts`: concept + level (vessel key) + laterality. One vessel
 * therefore holds one status, whichever row or panel wrote it, and the previous
 * status is superseded rather than left to contradict it in print.
 *
 * The heart of this module is the separation §5 and §7 demand between what an
 * angiogram shows and what may be written:
 *
 *   - `flowRelatedSignalLoss` and `nonVisualization` are descriptive. Their text
 *     never contains "stenosis" or "occlusion", because a TOF signal gap is not a
 *     lumen measurement.
 *   - `confirmedOcclusion` and the thrombosis statuses are interpretations, and they
 *     are only offered when the acquisition gate allows the claim — with acuity
 *     ("acute") gated separately, since §5 forbids assigning acuity from
 *     non-visualisation at all.
 *   - Variants (`variant`, `developmentalHypoplasia`) sit in their own conflict
 *     group: §10 says a vessel being small on one technique must not cancel the
 *     pathology recorded on it, and vice versa.
 *
 * Pure functions only — no store, no React.
 */

import { brainBundleId, type BrainAtomSpec } from "./mriBrainAtoms";
import {
  canonicalVesselSlot,
  vesselConceptId,
  vesselDisplayName,
  vesselsForTerritory,
  type VascularTerritory,
  type VesselDefinition,
  type VesselSide,
} from "./mriBrainVessels";
import {
  vascularGate,
  type VascularGate,
  type VascularGateFeature,
  type VascularTechniqueState,
} from "./mriBrainVascularTechnique";
import { VASCULAR_FINDINGS_SECTIONS } from "./mriBrainVascularProse";
import type { BrainSequenceContext } from "./mriBrainSequences";

export type VesselSystem = "arterial" | "venous";

export type ArterialStatusKey =
  | "patent"
  | "caliberAsymmetry"
  | "focalNarrowing"
  | "multifocalNarrowing"
  | "flowRelatedSignalLoss"
  | "nonVisualization"
  | "suspectedOcclusion"
  | "confirmedOcclusion"
  | "ectasia"
  | "aneurysmalOutpouching"
  | "variant"
  | "other";

export type VenousStatusKey =
  | "patent"
  | "reducedFlowSignal"
  | "flowGap"
  | "fillingDefect"
  | "thrombusSignal"
  | "partialThrombosis"
  | "occlusiveThrombosis"
  | "recanalization"
  | "collateralVeins"
  | "developmentalHypoplasia"
  | "other";

export type VesselStatusKey = `a:${ArterialStatusKey}` | `v:${VenousStatusKey}`;

export type VesselStatusDef = {
  key: VesselStatusKey;
  system: VesselSystem;
  label: string;
  /**
   * The study-wide concept family this row belongs to (arterial tree, venous system,
   * aneurysm, thrombosis). Identity of an individual vessel row is the per-vessel
   * concept from `vesselConceptId`; this field is what the tree normal and the
   * remainder-normal baseline are filed under, and what validation reads.
   */
  familyConcept: string;
  /** Variants get their own conflict group so they never cancel pathology (§10). */
  variant?: boolean;
  /**
   * An interpretation rather than a description: the conclusion text is only
   * produced when the gate allows and the radiologist selected it.
   */
  interpretation?: boolean;
  /** Acuity wording is gated apart from the finding itself (§5, §7, §13). */
  acuityGate?: VascularGateFeature;
  gate?: VascularGateFeature;
  severity?: "critical";
  /** `{vessel}` is replaced with the side-aware vessel label. */
  finding: string;
  impression?: string;
};

const A = (
  key: ArterialStatusKey,
  def: Omit<VesselStatusDef, "key" | "system" | "familyConcept"> & Partial<Pick<VesselStatusDef, "familyConcept">>,
): VesselStatusDef => ({
  key: `a:${key}`,
  system: "arterial",
  familyConcept: "mra_arterial",
  ...def,
});

const V = (
  key: VenousStatusKey,
  def: Omit<VesselStatusDef, "key" | "system" | "familyConcept"> & Partial<Pick<VesselStatusDef, "familyConcept">>,
): VesselStatusDef => ({
  key: `v:${key}`,
  system: "venous",
  familyConcept: "mrv_venous",
  ...def,
});

/** §5 status list, in the order the panel rows present it. */
export const ARTERIAL_VESSEL_STATUSES: readonly VesselStatusDef[] = [
  A("patent", {
    label: "Patent / normal",
    gate: "arterialAssessment",
    finding: "The {vessel} is patent with normal course and caliber.",
  }),
  A("caliberAsymmetry", {
    label: "Caliber asymmetry",
    gate: "arterialAssessment",
    finding: "Caliber asymmetry of the {vessel}, without focal luminal narrowing.",
  }),
  A("focalNarrowing", {
    label: "Focal narrowing",
    gate: "arterialAssessment",
    // Qualitative only: a percentage is a separate, measured statement (§7).
    finding: "Focal luminal narrowing of the {vessel}, on the angiographic source data.",
  }),
  A("multifocalNarrowing", {
    label: "Multifocal narrowing",
    gate: "arterialAssessment",
    finding: "Multifocal segmental luminal narrowing along the {vessel}.",
  }),
  A("flowRelatedSignalLoss", {
    label: "Flow-related signal loss",
    gate: "arterialAssessment",
    finding:
      "Reduced flow-related signal within the {vessel} on the angiographic acquisition, without an assigned luminal grade.",
  }),
  A("nonVisualization", {
    label: "Non-visualization",
    gate: "arterialAssessment",
    finding: "The {vessel} is not visualized on the angiographic acquisition.",
  }),
  A("suspectedOcclusion", {
    label: "Suspected occlusion",
    gate: "arterialAssessment",
    interpretation: true,
    finding:
      "Absent flow signal in the {vessel} across the available acquisitions, raising suspicion for occlusion.",
    impression: "Suspicion for occlusion of the {vessel}.",
  }),
  A("confirmedOcclusion", {
    label: "Confirmed / selected occlusion",
    gate: "selectedOcclusion",
    acuityGate: "acuteOcclusion",
    interpretation: true,
    severity: "critical",
    finding: "Occlusion of the {vessel}.",
    impression: "Occlusion of the {vessel}.",
  }),
  A("ectasia", {
    label: "Ectasia / tortuosity",
    gate: "arterialAssessment",
    finding: "Ectatic, tortuous course of the {vessel} without focal mass effect.",
  }),
  A("aneurysmalOutpouching", {
    label: "Aneurysmal outpouching",
    familyConcept: "aneurysm",
    gate: "aneurysmMorphology",
    finding:
      "Outpouching arising from the {vessel}; morphology and dimensions are recorded in the aneurysm fields.",
  }),
  A("variant", {
    label: "Anatomic variant",
    familyConcept: "mra_variant",
    gate: "arterialAssessment",
    variant: true,
    finding: "Normal anatomic variant of the {vessel}.",
  }),
  A("other", {
    label: "Other / manual",
    gate: "arterialAssessment",
    finding: "Additional arterial finding for the {vessel}: [describe]",
  }),
];

/** §12 status list. */
export const VENOUS_VESSEL_STATUSES: readonly VesselStatusDef[] = [
  V("patent", {
    label: "Patent / preserved flow",
    gate: "venousAssessment",
    finding: "The {vessel} demonstrates preserved venous flow signal.",
  }),
  V("reducedFlowSignal", {
    label: "Reduced flow signal",
    gate: "venousAssessment",
    finding: "Reduced flow signal within the {vessel}.",
  }),
  V("flowGap", {
    label: "Flow gap / non-visualization",
    gate: "venousAssessment",
    // §12: a sinus flow gap stays described as what it is. It does not name a cause,
    // because "not thrombus" printed in a findings line is still a thrombosis claim
    // the technique did not earn.
    finding:
      "Segmental flow gap in the {vessel}, a recognised appearance on this technique rather than an assigned cause.",
  }),
  V("fillingDefect", {
    label: "Filling defect",
    gate: "fillingDefect",
    finding: "Focal filling defect within the {vessel}.",
  }),
  V("thrombusSignal", {
    label: "Thrombus signal",
    gate: "thrombusSignal",
    familyConcept: "cvst",
    finding: "T1 hyperintense / T2 hypointense clot signal within the {vessel}.",
  }),
  V("partialThrombosis", {
    label: "Partial / non-occlusive thrombosis",
    familyConcept: "cvst",
    gate: "venousAssessment",
    interpretation: true,
    finding: "Non-occlusive thrombus within the {vessel}.",
    impression: "Dural venous sinus thrombosis involving the {vessel}.",
  }),
  V("occlusiveThrombosis", {
    label: "Occlusive thrombosis",
    familyConcept: "cvst",
    gate: "venousAssessment",
    acuityGate: "thrombusSignal",
    interpretation: true,
    severity: "critical",
    finding: "Occlusive thrombus within the {vessel}.",
    impression: "Occlusive dural venous sinus thrombosis of the {vessel}.",
  }),
  V("recanalization", {
    label: "Recanalization",
    familyConcept: "cvst",
    gate: "venousAssessment",
    finding: "Recanalization of the {vessel}, indicating organised thrombus.",
  }),
  V("collateralVeins", {
    label: "Collateral veins",
    gate: "venousAssessment",
    finding: "Prominent collateral venous channels around the {vessel}.",
  }),
  V("developmentalHypoplasia", {
    label: "Developmental hypoplasia / aplasia",
    familyConcept: "mrv_variant",
    gate: "venousAssessment",
    variant: true,
    finding: "Hypoplasia / aplasia of the {vessel}.",
    impression: "Developmental hypoplasia of the {vessel}, a non-pathologic variant.",
  }),
  V("other", {
    label: "Other / manual",
    gate: "venousAssessment",
    finding: "Additional venous finding for the {vessel}: [describe]",
  }),
];

export const ALL_VESSEL_STATUSES: readonly VesselStatusDef[] = [
  ...ARTERIAL_VESSEL_STATUSES,
  ...VENOUS_VESSEL_STATUSES,
];

export function vesselStatusByKey(key: VesselStatusKey | string): VesselStatusDef | null {
  return ALL_VESSEL_STATUSES.find((s) => s.key === key) ?? null;
}

export function statusesForSystem(system: VesselSystem): readonly VesselStatusDef[] {
  return system === "arterial" ? ARTERIAL_VESSEL_STATUSES : VENOUS_VESSEL_STATUSES;
}

export function systemForTerritory(territory: VascularTerritory): VesselSystem {
  return territory === "venous" ? "venous" : "arterial";
}

/** The vessel label used inside a sentence, e.g. "right MCA M1" / "basilar artery". */
export function vesselSentenceLabel(vessel: VesselDefinition): string {
  return vesselDisplayName(vessel);
}

/**
 * Whether the acquisition can carry this status. `null` means the status needs no
 * acquisition at all. A `false` here never says the finding is wrong — it says the
 * software may not produce that wording, so the panel offers the descriptive form
 * and the radiologist states the technique if it really was performed.
 */
export function vesselStatusGate(
  status: VesselStatusDef | VesselStatusKey,
  technique: VascularTechniqueState | null | undefined,
  brain: BrainSequenceContext,
): VascularGate | null {
  const def = typeof status === "string" ? vesselStatusByKey(status) : status;
  if (!def?.gate) return null;
  return vascularGate(def.gate, technique, brain);
}

/** Interpolates the vessel into the status sentence and its interpretation clause. */
export function vesselStatusText(
  status: VesselStatusDef,
  vessel: VesselDefinition,
  opts: { acute?: boolean } = {},
): { findings: string; impression?: string } {
  const label = vesselSentenceLabel(vessel);
  const fill = (text: string) => text.replace(/\{vessel\}/g, label);
  if (!status.impression) return { findings: fill(status.finding) };
  const impression = fill(status.impression);
  // Acuity is a separate claim from the finding: "acute" is only ever prefixed on an
  // explicit selection whose acuity gate passed (§5, §7, §13).
  const withAcuity = (text: string) => `Acute ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return {
    findings: opts.acute ? withAcuity(fill(status.finding)) : fill(status.finding),
    impression: opts.acute ? withAcuity(impression) : impression,
  };
}

/** The ledger slot a vessel row owns. Returns null when the wording does not
 * identify one vessel — the caller must ask which vessel is meant rather than
 * guessing, because a wrong guess writes a real observation onto the wrong artery. */
export function vesselSlotFor(
  raw: string | null | undefined,
  opts: { territory?: VascularTerritory; side?: VesselSide } = {},
): { level: string; laterality: string; vessel: VesselDefinition } | null {
  return canonicalVesselSlot(raw, opts);
}

export type VesselObservationResult = {
  atoms: BrainAtomSpec[];
  bundleId: string;
  /** Set when the atoms were refused. The panel must show `blocked` rather than retry. */
  blocked?: { notice: string; missing: string[] };
  error?: string;
};

/**
 * Compile one vessel status into atoms for the existing bundle machinery.
 *
 * Refuses (with the gate notice) when an *interpretation* status is built while the
 * acquisition cannot carry it — that is §1's rule enforced in code: the descriptive
 * row is always recordable, the conclusion is not producible without the technique
 * that supports it.
 */
export function vesselObservationAtoms(input: {
  vessel: string | VesselDefinition;
  status: VesselStatusKey;
  territory?: VascularTerritory;
  side?: VesselSide;
  /** Radiologist explicitly selected the acuity wording, in addition to the status. */
  acute?: boolean;
  technique?: VascularTechniqueState | null;
  brain: BrainSequenceContext;
  /**
   * The tree-wide normal sentence currently in the report (the dedicated-MRA normal
   * preset). When supplied, this row supersedes it and a "remaining vessels normal"
   * baseline is emitted in its place, so one abnormal vessel never leaves the report
   * claiming all of them are normal.
   */
  replaceTreeNormal?: string;
  /** Sentence kept for the rest of the tree once `replaceTreeNormal` is superseded. */
  remainderNormal?: string;
}): VesselObservationResult {
  const status = vesselStatusByKey(input.status);
  if (!status) return { atoms: [], bundleId: "", error: `unknown vessel status ${input.status}` };
  const vessel =
    typeof input.vessel === "string"
      ? canonicalVesselSlot(input.vessel, { territory: input.territory, side: input.side })?.vessel ?? null
      : input.vessel;
  if (!vessel) {
    return { atoms: [], bundleId: "", error: `vessel not identified: ${String(input.vessel)}` };
  }
  if (status.system !== systemForTerritory(vessel.territory)) {
    return {
      atoms: [],
      bundleId: "",
      error: `${status.key} is a ${status.system} status; ${vessel.key} is ${vessel.territory}`,
    };
  }

  const gate = vesselStatusGate(status, input.technique, input.brain);
  // Any gated wording needs its acquisition, descriptive rows included: a "patent"
  // sentence for a vessel no angiogram covered is the same class of unsupported
  // prose as an occlusion claim (§4).
  if (gate && !gate.allowed) {
    return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
  }
  const acuity = Boolean(input.acute);
  const acuityGate = status.acuityGate && input.brain
    ? vascularGate(status.acuityGate, input.technique, input.brain)
    : null;
  if (acuity && !status.acuityGate) {
    return { atoms: [], bundleId: "", error: `${status.key} carries no acuity wording` };
  }
  if (acuity && acuityGate && !acuityGate.allowed) {
    return { atoms: [], bundleId: "", blocked: { notice: acuityGate.notice, missing: acuityGate.missing } };
  }

  const bundleId = brainBundleId("vessel", `${vessel.key}-${status.key}`);
  const atoms: BrainAtomSpec[] = [
    vesselStatusAtom(vessel, status, {
      acute: acuity,
      replaceTreeNormal: input.replaceTreeNormal,
    }),
  ];
  if (!status.variant && input.replaceTreeNormal?.trim() && input.remainderNormal?.trim()) {
    atoms.push(remainderNormalAtom(
      treeFamilyConcept(status.familyConcept, vessel.territory),
      vessel.territory,
      input.remainderNormal,
    ));
  }
  return { atoms, bundleId };
}

/**
 * The family slot that owns a territory's all-normal sentence. The intracranial tree and
 * the extracranial (neck) tree are different acquisitions with different normal prose, so
 * they must not share one ledger slot — a combined MRA + MRA-neck report is expected to
 * keep both statements (mra/mrv spec §2, §15).
 */
export function treeFamilyConcept(
  familyConcept: string,
  territory: VascularTerritory,
): string {
  if (familyConcept !== "mra_arterial") return familyConcept;
  return territory === "neckArterial" ? "mra_neck_arterial" : "mra_arterial";
}

/**
 * §5/§17: a named abnormality cannot sit under a sentence that denies one. When the report
 * carries the territory's all-normal baseline, the builder supersedes that sentence and keeps
 * the rest of the tree normal on the territory's own family slot. Called by the builders that
 * describe an abnormality the tree sentence excludes; the caller decides because only it
 * knows whether the report actually carries that sentence.
 */
export function applyTreeNormalSupersession(
  atoms: BrainAtomSpec[],
  ctx: { replaceTreeNormal?: string; remainderNormal?: string },
  territory: VascularTerritory,
): BrainAtomSpec[] {
  const sentence = ctx.replaceTreeNormal?.trim();
  if (!atoms.length || !sentence) return atoms;
  const out = atoms.map((atom, index) =>
    index === 0 ? { ...atom, baselineReplaces: sentence } : atom,
  );
  if (ctx.remainderNormal?.trim()) {
    out.push(
      remainderNormalAtom(
        treeFamilyConcept("mra_arterial", territory),
        territory,
        ctx.remainderNormal,
      ),
    );
  }
  return out;
}

/**
 * The atom for one vessel status, without any gate decision. `vesselObservationAtoms`
 * is the gate-checked caller a panel uses; a palette tile uses this directly, because
 * whether a tile is offered at all is decided by tile availability, not per keystroke.
 */
export function vesselStatusAtom(
  vessel: VesselDefinition,
  status: VesselStatusDef,
  opts: { acute?: boolean; impression?: boolean; replaceTreeNormal?: string } = {},
): BrainAtomSpec {
  const text = vesselStatusText(status, vessel, { acute: Boolean(opts.acute) });
  const isPatent = status.key === "a:patent" || status.key === "v:patent";
  return {
    concept: vesselConceptId(vessel, { variant: Boolean(status.variant) }),
    conflictGroup: status.variant ? `${vessel.key}-variant` : vessel.key,
    anatomicalSection: vesselFindingsSection(vessel),
    findings: text.findings,
    impression: opts.impression === false ? undefined : text.impression,
    // A patent row is that vessel's baseline. An abnormal row supersedes either the
    // vessel's own normal sentence, or — when the caller says the tree-wide normal is
    // what the report currently carries — that sentence instead.
    baselineReplaces: isPatent
      ? undefined
      : opts.replaceTreeNormal?.trim() || patentSentenceFor(vessel),
    level: vessel.key.toUpperCase(),
    laterality: vessel.side === "unpaired" ? undefined : vessel.side,
    supportsLaterality: vessel.side !== "unpaired",
    severity: status.severity,
    role: isPatent ? "baseline" : "finding",
  };
}

/** What is left of the tree once its all-normal sentence has been superseded. */
export function remainderNormalAtom(
  concept: string,
  territory: VascularTerritory,
  sentence: string,
): BrainAtomSpec {
  return {
    concept,
    conflictGroup: `${territory}-remainder-normal`,
    anatomicalSection: VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality,
    findings: sentence.trim(),
    role: "baseline",
  };
}

/** The vessel's own normal sentence, used as the supersede target. */
export function patentSentenceFor(vessel: VesselDefinition): string {
  const key: VesselStatusKey = vessel.territory === "venous" ? "v:patent" : "a:patent";
  const status = vesselStatusByKey(key)!;
  return vesselStatusText(status, vessel).findings;
}

/** Which Findings subsection a vessel belongs to (§17). */
export function vesselFindingsSection(vessel: VesselDefinition): string {
  switch (vessel.system) {
    case "anteriorCirculation":
      return VASCULAR_FINDINGS_SECTIONS.anteriorCirculation;
    case "posteriorCirculation":
      return VASCULAR_FINDINGS_SECTIONS.posteriorCirculation;
    case "carotidSystem":
      return vessel.side === "left"
        ? VASCULAR_FINDINGS_SECTIONS.leftCarotid
        : VASCULAR_FINDINGS_SECTIONS.rightCarotid;
    case "vertebralSystem":
      return VASCULAR_FINDINGS_SECTIONS.neckVertebrals;
    case "duralSinus":
      return VASCULAR_FINDINGS_SECTIONS.duralSinuses;
    case "deepVenous":
      return VASCULAR_FINDINGS_SECTIONS.deepVenousSystem;
    default:
      return VASCULAR_FINDINGS_SECTIONS.otherVeins;
  }
}

/**
 * The tree the panel shows for a territory: real vessels first, variant-only slots
 * last, unpaired before paired so the rows read in the order §5/§11/§12 list them.
 */
export function vesselRowsForTerritory(territory: VascularTerritory): VesselDefinition[] {
  return vesselsForTerritory(territory).slice().sort((a, b) => {
    if (Boolean(a.variantOnly) !== Boolean(b.variantOnly)) return a.variantOnly ? 1 : -1;
    if ((a.side === "unpaired") !== (b.side === "unpaired")) return a.side === "unpaired" ? -1 : 1;
    return a.system === b.system ? 0 : a.system < b.system ? -1 : 1;
  });
}
