/**
 * mriBrainVascularThrombosis.ts — the CVST / deep venous thrombosis record
 * (mra/mrv spec §13, with §12's flow-gap rule).
 *
 * §12's prohibition — a transverse-sinus flow gap is not thrombosis — is the same
 * split the rest of this phase draws: the description is recordable, the conclusion is
 * selected. So this record keeps the two apart in code. The vein's own row carries the
 * extent, the clot signal, the filling defect, the recanalisation and the collaterals,
 * and the thrombosis statement is a separate atom that only `thrombosisSelected`
 * reaches. The stage is the same matter again: §13 forbids deriving acute / subacute /
 * chronic from one signal characteristic, so a stage exists only as the radiologist's
 * own interpretation, and the library's "diagnostic of ACUTE dural venous sinus
 * thrombosis" line is only reachable when "acute" is what was chosen.
 *
 * The associated brain findings ride on the concepts the routine brain palettes
 * already own (`venous_infarct`, `edema`, `mass_effect`, `midline_shift`, `infarct`),
 * so a venous infarct described here is the same slot as one described anywhere else
 * in the report — and each keeps its own sequence gate.
 *
 * Pure functions only — no store, no React.
 */

import type { BrainAtomSpec } from "./mriBrainAtoms";
import { brainBundleId } from "./mriBrainAtoms";
import {
  composeMidlineSentence,
  severityForMidline,
  type MidlineSide,
} from "./mriBrainMeasures";
import { missingSequenceLabels, sequenceAllows, type BrainSequenceKey } from "./mriBrainSequences";
import {
  canonicalVesselSlot,
  vesselConceptId,
  vesselDisplayName,
  type VesselDefinition,
  type VesselSide,
} from "./mriBrainVessels";
import { patentSentenceFor, vesselFindingsSection } from "./mriBrainVesselObservations";
import { VASCULAR_FINDINGS_SECTIONS, vascularSplitFor } from "./mriBrainVascularProse";
import {
  vascularGate,
  type VascularGate,
  type VascularGateFeature,
} from "./mriBrainVascularTechnique";
import type {
  Assessable,
  VascularLesionContext,
  VascularLesionResult,
} from "./mriBrainVascularLesions";
import { vascularMeasure } from "./mriBrainVascularLesions";

/** §13: a stage is an interpretation, so it is only ever selected — never derived. */
export const THROMBOSIS_STAGES = ["acute", "subacute", "chronic"] as const;
export type ThrombosisStage = (typeof THROMBOSIS_STAGES)[number] | "";

export const THROMBOSIS_OCCLUSION = ["occlusive", "non-occlusive"] as const;
export type ThrombosisOcclusion = (typeof THROMBOSIS_OCCLUSION)[number] | "";

export type CvstBrainFindings = {
  /** Where the parenchymal change sits, when the record names it. */
  location?: string;
  edema?: boolean;
  venousInfarction?: boolean;
  /** Needs the susceptibility sequence that demonstrates blood products. */
  hemorrhagicVenousInfarction?: boolean;
  petechialHemorrhage?: boolean;
  massEffect?: boolean;
  midlineShiftMm?: number | "";
  midlineShiftSide?: MidlineSide | "";
  /** §13's deep-system marker; it rides on the deep venous conclusion, as the library words it. */
  bilateralThalamicEdema?: boolean;
  diffusionRestriction?: boolean;
};

export type CvstRecord = {
  /** Resolved through the vessel registry, like every other vascular row. */
  vein: string;
  side?: VesselSide | "";
  /** §13 segment / extent, in the radiologist's words. */
  extent?: string;
  occlusion?: ThrombosisOcclusion;
  /** §13 thrombus signal, stated against the sequences that show it. */
  thrombusSignal?: string;
  fillingDefect?: Assessable;
  /** Further venous structures involved — each takes its own slot (§13 "extension"). */
  extension?: readonly string[];
  recanalization?: Assessable;
  collateralization?: Assessable;
  stage?: ThrombosisStage;
  /** The conclusion. A flow gap, a filling defect or a clot signal does not reach it. */
  thrombosisSelected?: boolean;
  brainFindings?: CvstBrainFindings;
  manualNote?: string;
  /** The tree-wide MRV normal the report currently carries, if any. */
  replaceTreeNormal?: string;
  remainderNormal?: string;
};

/** §13: the deep system is its own statement, because its consequences are. */
export function isDeepVenousVessel(vessel: VesselDefinition): boolean {
  return vessel.system === "deepVenous";
}

function sequenceGate(ctx: VascularLesionContext, keys: BrainSequenceKey[]): VascularGate | null {
  if (sequenceAllows(ctx.brain, keys)) return null;
  const missing = keys.filter((k) => !ctx.brain.performed[k]);
  const labels = missingSequenceLabels(ctx.brain, missing);
  return {
    allowed: false,
    feature: "venousAssessment",
    label: labels.join(" and "),
    missing: labels.map((l) => `parenchymal ${l}`),
    notice: `${labels.join(" and ")} ${labels.length > 1 ? "are" : "is"} not recorded as performed, so this report cannot state the finding that depends on ${labels.length > 1 ? "them" : "it"} (§4, §13).`,
  };
}

export function venousThrombosisFindingsSentence(
  r: CvstRecord,
  veinLabel: string,
): string {
  const clauses: string[] = [];
  if (r.occlusion === "occlusive") {
    clauses.push(
      `Occlusive thrombus filling the ${veinLabel}`
      + `${r.extent?.trim() ? `, ${r.extent.trim()}` : ""}.`,
    );
  } else if (r.occlusion === "non-occlusive") {
    clauses.push(
      `Non-occlusive thrombus along the ${veinLabel} wall`
      + `${r.extent?.trim() ? `, ${r.extent.trim()}` : ""}.`,
    );
  } else if (r.extent?.trim()) {
    clauses.push(`Thrombus in the ${veinLabel}, ${r.extent.trim()}.`);
  }
  if (r.thrombusSignal?.trim()) {
    clauses.push(`Thrombus signal: ${r.thrombusSignal.trim()}.`);
  }
  if (r.fillingDefect === "present") {
    clauses.push(`Filling defect within the ${veinLabel}.`);
  } else if (r.fillingDefect === "absent") {
    clauses.push(`No filling defect within the ${veinLabel}.`);
  }
  if (r.recanalization === "present") {
    clauses.push("Partial recanalisation of the thrombus.");
  } else if (r.recanalization === "absent") {
    clauses.push("No recanalisation.");
  }
  if (r.collateralization === "present") {
    clauses.push("Prominent collateral veins are present.");
  } else if (r.collateralization === "absent") {
    clauses.push("No collateral veins are demonstrated.");
  }
  if (r.stage) {
    clauses.push(
      `The reporting radiologist stages the thrombus as ${r.stage} on the available sequences and clinical context.`,
    );
  }
  if (r.manualNote?.trim()) clauses.push(r.manualNote.trim());
  return clauses.join(" ");
}

export function venousThrombosisConclusionSentence(
  r: CvstRecord,
  veinLabel: string,
): string {
  const lead = r.occlusion ? `${cap(r.occlusion)} thrombosis` : "Thrombosis";
  return (
    `${lead} of the ${veinLabel}`
    + `${r.extent?.trim() ? `, ${r.extent.trim()}` : ""}`
    + `${r.stage ? ` — staged ${r.stage} by the reporting radiologist` : ""}.`
  );
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function brainFindingAtoms(findings: CvstBrainFindings): BrainAtomSpec[] {
  const atoms: BrainAtomSpec[] = [];
  const where = findings.location?.trim()
    ? `in the ${findings.location.trim()}`
    : "in the cortex drained by the thrombosed sinus";
  if (findings.edema) {
    atoms.push({
      concept: "edema",
      conflictGroup: "venous-edema",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings: `Vasogenic oedema ${where}, in the territory of the thrombosed sinus.`,
      role: "finding",
    });
  }
  if (findings.venousInfarction) {
    const hemorrhagic = findings.hemorrhagicVenousInfarction || findings.petechialHemorrhage;
    atoms.push({
      concept: "venous_infarct",
      conflictGroup: "venous-infarct",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings: hemorrhagic
        ? `Cortical T2/FLAIR hyperintensity ${where}`
          + `${findings.petechialHemorrhage ? " with petechial susceptibility change" : ""}`
          + `${findings.hemorrhagicVenousInfarction ? " with haemorrhagic change" : ""}`
          + ", compatible with venous haemorrhagic infarction."
        : `Cortical T2/FLAIR hyperintensity ${where}, compatible with venous infarction.`,
      impression: "Venous infarction in the territory of the thrombosed sinus.",
      severity: hemorrhagic ? "critical" : "significant",
    });
  }
  if (findings.massEffect) {
    atoms.push({
      concept: "mass_effect",
      conflictGroup: "venous-mass-effect",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings: `Adjacent mass effect with sulcal effacement${findings.location?.trim() ? ` at the ${findings.location.trim()}` : ""}.`,
    });
  }
  const shift = vascularMeasure(findings.midlineShiftMm);
  if (shift != null) {
    const side = String(findings.midlineShiftSide || "right");
    atoms.push({
      concept: "midline_shift",
      conflictGroup: "midline",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings: composeMidlineSentence({ mm: shift, side }),
      impression: `Midline shift ${shift} mm ${side}.`,
      severity: severityForMidline(shift),
      laterality: side,
      measurement: String(shift),
      baselineReplaces: "No midline shift.",
    });
  }
  if (findings.diffusionRestriction) {
    atoms.push({
      concept: "infarct",
      conflictGroup: "venous-diffusion",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
      findings:
        `Restricted diffusion with ADC correlate ${where}, in a distribution that follows the thrombosed sinus rather than an arterial territory.`,
      impression: "Venous ischaemia with restricted diffusion.",
      severity: "significant",
    });
  }
  return atoms;
}

/**
 * The CVST record. Returns the vein's descriptive row, one row per structure the
 * thrombus extends into, the selected thrombosis conclusion, and the brain findings
 * the radiologist recorded — every one on its own existing slot.
 */
export function venousThrombosisAtoms(
  record: CvstRecord,
  ctx: VascularLesionContext,
): VascularLesionResult {
  const slot = canonicalVesselSlot(record.vein, {
    side: record.side || undefined,
    territory: "venous",
  });
  if (!slot) {
    return {
      atoms: [],
      bundleId: "",
      errors: [
        `"${record.vein}" does not name a single venous structure in the registry, `
        + "so thrombosis cannot be attached to it.",
      ],
    };
  }
  const findings = record.brainFindings ?? {};
  const gates: [boolean, VascularGateFeature][] = [
    [true, "venousAssessment"],
    [Boolean(record.fillingDefect), "fillingDefect"],
    [Boolean(record.thrombusSignal?.trim()), "thrombusSignal"],
    [
      Boolean(findings.hemorrhagicVenousInfarction || findings.petechialHemorrhage),
      "blooming",
    ],
    [Boolean(findings.diffusionRestriction), "diffusion"],
  ];
  for (const [applies, feature] of gates) {
    if (!applies) continue;
    const gate = vascularGate(feature, ctx.technique ?? null, ctx.brain);
    if (!gate.allowed) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }
  // T2/FLAIR hyperintensity wording, and the deep-system thalamic oedema, need FLAIR.
  const needsFlair = Boolean(
    findings.edema
    || findings.venousInfarction
    || findings.bilateralThalamicEdema,
  );
  if (needsFlair) {
    const gate = sequenceGate(ctx, ["flair"]);
    if (gate) {
      return { atoms: [], bundleId: "", blocked: { notice: gate.notice, missing: gate.missing } };
    }
  }

  const veinLabel = vesselDisplayName(slot.vessel);
  const deep = isDeepVenousVessel(slot.vessel);
  const descriptive = venousThrombosisFindingsSentence(record, veinLabel);
  const atoms: BrainAtomSpec[] = [];
  const errors: string[] = [];

  if (descriptive.trim()) {
    atoms.push({
      concept: vesselConceptId(slot.vessel),
      conflictGroup: slot.vessel.key,
      anatomicalSection: vesselFindingsSection(slot.vessel),
      findings: descriptive,
      // A thrombus statement supersedes this sinus's own normal flow sentence.
      baselineReplaces: record.replaceTreeNormal?.trim() || patentSentenceFor(slot.vessel),
      level: slot.level,
      laterality: slot.laterality || undefined,
      supportsLaterality: slot.vessel.side !== "unpaired",
      state: record.stage ? `staged ${record.stage} by the radiologist` : "not staged",
    });
  }
  for (const raw of record.extension ?? []) {
    const extended = canonicalVesselSlot(raw, { territory: "venous" });
    if (!extended) {
      errors.push(
        `"${raw}" does not name a single venous structure, so the extent of the thrombus cannot be recorded.`,
      );
      continue;
    }
    const label = vesselDisplayName(extended.vessel);
    atoms.push({
      concept: vesselConceptId(extended.vessel),
      conflictGroup: extended.vessel.key,
      anatomicalSection: vesselFindingsSection(extended.vessel),
      findings: `Extension of thrombus into the ${label}.`,
      baselineReplaces: patentSentenceFor(extended.vessel),
      level: extended.level,
      laterality: extended.laterality || undefined,
      supportsLaterality: extended.vessel.side !== "unpaired",
    });
  }
  if (!atoms.length && !errors.length) {
    return { atoms: [], bundleId: "", errors: ["no venous thrombosis findings entered"] };
  }

  if (findings.bilateralThalamicEdema && !deep && !record.thrombosisSelected) {
    errors.push(
      `Bilateral thalamic oedema belongs with thrombosis of the deep venous system; the recorded vessel is the ${veinLabel}.`,
    );
  }
  if (record.thrombosisSelected) {
    const conclusion = venousThrombosisConclusionSentence(record, veinLabel);
    // §13 words the deep system's own consequence inside its statement, as the
    // library line does, so the finding never becomes a second general oedema row.
    const thalamic = deep && findings.bilateralThalamicEdema
      ? " with secondary bilateral thalamic oedema on FLAIR"
      : "";
    atoms.push({
      concept: deep ? "mrv_deep_venous_thrombosis" : "mrv_thrombosis",
      conflictGroup: deep ? "deep-venous-thrombosis" : "dural-venous-thrombosis",
      anatomicalSection: deep
        ? VASCULAR_FINDINGS_SECTIONS.deepVenousSystem
        : VASCULAR_FINDINGS_SECTIONS.thrombus,
      findings: `${conclusion.replace(/\.$/, "")}${thalamic}.`,
      // §13: only an acute selection may say "diagnostic of acute … thrombosis".
      impression: record.stage === "acute" && !deep
        ? vascularSplitFor("cvstSagittal").interpretation
        : deep
          ? `Deep cerebral venous thrombosis${record.stage ? ` (${record.stage}, radiologist-staged)` : ""}.`
          : `Dural venous sinus thrombosis${record.occlusion ? `, ${record.occlusion}` : ""}${record.stage ? ` (${record.stage}, radiologist-staged)` : ""}.`,
      severity: "critical",
      state: record.stage ? `staged ${record.stage}` : "stage not stated",
    });
  }
  atoms.push(...brainFindingAtoms(findings));
  if (errors.length) return { atoms: [], bundleId: "", errors };
  if (record.remainderNormal?.trim()) {
    atoms.push({
      concept: "mrv_venous",
      conflictGroup: "mrv_venous-remainder-normal",
      anatomicalSection: VASCULAR_FINDINGS_SECTIONS.duralSinuses,
      findings: record.remainderNormal.trim(),
      role: "baseline",
    });
  }
  return {
    atoms,
    bundleId: brainBundleId("cvst", slot.vessel.key),
  };
}
