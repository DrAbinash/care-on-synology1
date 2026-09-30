/**
 * mriBrainVascularSubMasters.ts — the dedicated MRA / MRA-neck / MRV palettes
 * (mra/mrv spec §15, §16, §5, §8, §9, §11, §12, §13).
 *
 * These are palette tiles over the ONE brain observation model: every tile compiles
 * to `BrainAtomSpec`s that go through the existing applyMacroBundle /
 * removeMacroBundle / undo machinery, exactly like the routine brain palettes. There
 * is no second ledger, no second editor, and no preset that writes a finished report.
 *
 * Two rules shape the tile set:
 *
 *   - Where the clinical library supplies the prose, the tile quotes it. Canonical
 *     sentences are asserted verbatim by `mriBrainVascularProse.test.ts`.
 *   - Where the library states a conclusion the acquisition may not support, the
 *     tile for the description and the tile for the conclusion are DIFFERENT tiles,
 *     and the conclusion tile is gated by its vascular technique. Selecting the
 *     description never produces the conclusion (§1, §7, §8, §12, §13).
 *
 * Sentences that the library does not supply are marked as authored in the group
 * label or a comment, so the verbatim guard never claims them.
 */

import type { BrainAtomSpec } from "./mriBrainAtoms";
import type { BrainSequenceKey } from "./mriBrainSequences";
import type { BrainSubMaster, BrainTile } from "./mriBrainSubMasters";
import {
  vesselStatusAtom,
  vesselStatusByKey,
  vesselFindingsSection,
} from "./mriBrainVesselObservations";
import { vesselByKey, vesselConceptId } from "./mriBrainVessels";
import {
  VASCULAR_FINDINGS_SECTIONS,
  VASCULAR_LIBRARY_PROSE,
  vascularSplitFor,
} from "./mriBrainVascularProse";
import type { VascularGateFeature } from "./mriBrainVascularTechnique";
import {
  ANEURYSM_UNRUPTURED_IMPRESSION,
  MOYAMOYA_PATTERN_IMPRESSION,
  moyamoyaDiseaseAtom,
} from "./mriBrainVascularLesions";

/** Tiles whose sentence is a status row from the vessel model, not library prose. */
const statusTile = (
  id: string,
  label: string,
  group: string,
  vesselKey: string,
  statusKey: string,
  opts: {
    advanced?: boolean;
    requires?: BrainSequenceKey[];
    requiresVascular?: VascularGateFeature;
    acute?: boolean;
    atoms?: BrainAtomSpec[];
  } = {},
): BrainTile => {
  const vessel = vesselByKey(vesselKey);
  const status = vesselStatusByKey(statusKey);
  if (!vessel || !status) {
    throw new Error(`mriBrainVascularSubMasters: unknown tile ${id} (${vesselKey}/${statusKey})`);
  }
  return {
    id,
    label,
    group,
    advanced: opts.advanced,
    requires: opts.requires,
    requiresVascular: opts.requiresVascular,
    atoms: [
      vesselStatusAtom(vessel, status, { acute: opts.acute }),
      ...(opts.atoms ?? []),
    ],
  };
};

/**
 * Tiles whose findings text is canonical library prose rather than a status row.
 *
 * `vessel` binds the tile to one vessel's slot (the per-vessel concept, so two
 * vessels never share an observation); `concept` is for the vascular statements that
 * are not one vessel's status — a pattern, a rupture statement, a drainage claim —
 * and must be a registered concept, asserted by the palette integrity test.
 */
const proseTile = (
  id: string,
  label: string,
  group: string,
  entry: {
    concept?: string;
    vessel?: string;
    variant?: boolean;
    site?: string;
    findings: string;
    impression?: string;
    section?: string;
    severity?: "critical";
    requires?: BrainSequenceKey[];
    requiresVascular?: VascularGateFeature;
    advanced?: boolean;
    baselineReplaces?: string;
    /** Bind the tile to the vessel's §6 aneurysm slot rather than its lumen slot. */
    aneurysm?: boolean;
    extra?: BrainAtomSpec[];
  },
): BrainTile => {
  const vessel = entry.vessel ? vesselByKey(entry.vessel) : null;
  if (entry.vessel && !vessel) {
    throw new Error(`mriBrainVascularSubMasters: unknown vessel ${entry.vessel} for tile ${id}`);
  }
  const concept = vessel
    ? vesselConceptId(vessel, {
      variant: entry.variant,
      lesion: entry.aneurysm ? "aneurysm" : undefined,
    })
    : entry.concept;
  if (!concept) throw new Error(`mriBrainVascularSubMasters: tile ${id} has no concept`);
  const site = entry.site ?? vessel?.key ?? concept;
  const atom: BrainAtomSpec = {
    concept,
    conflictGroup: vessel
      ? `${vessel.key}${entry.variant ? "-variant" : ""}${entry.aneurysm ? "-aneurysm" : ""}`
      : site.toLowerCase(),
    anatomicalSection:
      entry.section ?? (vessel ? vesselFindingsSection(vessel) : VASCULAR_FINDINGS_SECTIONS.focalArterialAbnormality),
    findings: entry.findings,
    impression: entry.impression,
    baselineReplaces: entry.baselineReplaces,
    level: vessel ? vessel.key.toUpperCase() : site.toUpperCase(),
    laterality: vessel && vessel.side !== "unpaired" ? vessel.side : undefined,
    supportsLaterality: Boolean(vessel && vessel.side !== "unpaired"),
    severity: entry.severity,
  };
  return {
    id,
    label,
    group,
    advanced: entry.advanced,
    requires: entry.requires,
    requiresVascular: entry.requiresVascular,
    atoms: [atom, ...(entry.extra ?? [])],
  };
};

const treeNormalTile = (
  id: string,
  label: string,
  vesselModule: "mra" | "mraNeck" | "mrv",
): BrainTile => {
  const spec = VASCULAR_TREE_NORMALS[vesselModule];
  return {
    id,
    label,
    group: "Normal baseline",
    requiresVascular: spec.gate,
    atoms: [
      {
        concept: spec.concept,
        conflictGroup: spec.concept,
        anatomicalSection: spec.section,
        findings: spec.sentence,
        role: "baseline",
      },
    ],
  };
};

/** §15 — one normal baseline per vascular module, quoted from the library. */
export const VASCULAR_TREE_NORMALS = {
  mra: {
    concept: "mra_arterial",
    gate: "arterialAssessment" as VascularGateFeature,
    section: VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
    sentence: VASCULAR_LIBRARY_PROSE.mraIntracranialNormal,
    remainder:
      "The remaining visualised intracranial arteries demonstrate normal course, caliber and uniform flow-related signal.",
  },
  mraNeck: {
    concept: "mra_arterial",
    gate: "arterialAssessment" as VascularGateFeature,
    section: VASCULAR_FINDINGS_SECTIONS.neckVertebrals,
    sentence: VASCULAR_LIBRARY_PROSE.mraNeckNormal,
    remainder:
      "The remaining extracranial arteries demonstrate symmetric caliber and intact luminal flow voids.",
  },
  mrv: {
    concept: "mrv_venous",
    gate: "venousAssessment" as VascularGateFeature,
    section: VASCULAR_FINDINGS_SECTIONS.duralSinuses,
    sentence: VASCULAR_LIBRARY_PROSE.mrvNormal,
    remainder:
      "The remaining dural venous sinuses and deep cerebral veins demonstrate normal venous flow signal.",
  },
} as const;

export type VascularTreeModule = keyof typeof VASCULAR_TREE_NORMALS;

/**
 * The conclusion wording for the pattern and the standalone rupture statement is the
 * §6/§8 structured object's wording too — `mriBrainVascularLesions.ts` owns it, so a
 * tile and a completed form can never disagree about what the same slot says.
 */
const MOYAMOYA_DISEASE = moyamoyaDiseaseAtom();

const MRA_TILES: BrainTile[] = [
  treeNormalTile("mra-normal", "Normal dedicated intracranial MRA", "mra"),
  statusTile("mra-focal-narrowing", "Focal narrowing (descriptive)", "Stenosis without a grade",
    "mca-m1-right", "a:focalNarrowing", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-flow-loss", "Flow-related signal loss", "Stenosis without a grade",
    "mca-m1-right", "a:flowRelatedSignalLoss", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-nonvisualization", "Non-visualization", "Stenosis without a grade",
    "ica-terminus-right", "a:nonVisualization", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-suspected-occlusion", "Suspected occlusion (selected)", "Occlusion — radiologist-selected",
    "ica-terminus-right", "a:suspectedOcclusion", {
      advanced: true,
      requiresVascular: "arterialAssessment",
    }),
  statusTile("mra-confirmed-occlusion", "Confirmed occlusion (selected)", "Occlusion — radiologist-selected",
    "ica-terminus-right", "a:confirmedOcclusion", {
      advanced: true,
      requiresVascular: "selectedOcclusion",
    }),
  statusTile("mra-acute-occlusion", "Acute occlusion (selected, needs DWI)", "Occlusion — radiologist-selected",
    "ica-terminus-right", "a:confirmedOcclusion", {
      advanced: true,
      acute: true,
      requiresVascular: "acuteOcclusion",
      requires: ["dwi", "adc"],
    }),
  proseTile("mra-stenosis-graded", "Graded M1 stenosis (canonical wording)", "Stenosis — numeric, gated", {
    vessel: "mca-m1-left",
    findings: vascularSplitFor("mcaM1Stenosis").observation,
    // The percentage and the perfusion claim are the library's conclusion half; this
    // tile is only offered when a lumen-bearing acquisition exists (§7).
    impression: vascularSplitFor("mcaM1Stenosis").interpretation,
    requiresVascular: "numericStenosis",
    advanced: true,
  }),
  proseTile("mra-aneurysm-acom", "ACom aneurysm (canonical)", "Aneurysm", {
    vessel: "acom",
    // The same slot the §6 structured aneurysm record writes, so the canonical
    // starting sentence is refined by the form rather than doubled by it.
    aneurysm: true,
    findings: VASCULAR_LIBRARY_PROSE.acomAneurysm,
    section: VASCULAR_FINDINGS_SECTIONS.circleOfWillis,
    requiresVascular: "aneurysmMorphology",
  }),
  proseTile("mra-aneurysm-mca", "MCA bifurcation aneurysm (canonical)", "Aneurysm", {
    vessel: "mca-bifurcation-right",
    aneurysm: true,
    findings: VASCULAR_LIBRARY_PROSE.mcaBifurcationAneurysm,
    requiresVascular: "aneurysmMorphology",
  }),
  proseTile("mra-aneurysm-unruptured", "Unruptured — radiologist statement", "Aneurysm", {
    concept: "aneurysm_rupture_status",
    findings: "No subarachnoid blood or acute haemorrhage to attribute to the aneurysm.",
    impression: ANEURYSM_UNRUPTURED_IMPRESSION,
    requiresVascular: "aneurysmMorphology",
    advanced: true,
  }),
  proseTile("mra-moyamoya-pattern", "Moyamoya-pattern vasculopathy (canonical)", "Moyamoya", {
    concept: "mra_moyamoya_pattern",
    findings: vascularSplitFor("moyamoyaPattern").observation,
    impression: MOYAMOYA_PATTERN_IMPRESSION,
    section: VASCULAR_FINDINGS_SECTIONS.anteriorCirculation,
    requiresVascular: "arterialAssessment",
  }),
  proseTile("mra-moyamoya-disease", "Moyamoya disease — radiologist diagnosis", "Moyamoya", {
    concept: MOYAMOYA_DISEASE.concept,
    findings: MOYAMOYA_DISEASE.findings,
    impression: MOYAMOYA_DISEASE.impression,
    requiresVascular: "arterialAssessment",
    advanced: true,
  }),
  proseTile("mra-avm-nidus", "AVM with nidus and feeder (canonical)", "AVM", {
    concept: "avm",
    site: "AVM-PARIETAL",
    findings: vascularSplitFor("avmPattern").observation,
    requiresVascular: "arterialAssessment",
  }),
  proseTile("mra-avm-early-drainage", "Early draining veins (time-resolved only)", "AVM", {
    concept: "avm_venous_drainage",
    findings: vascularSplitFor("avmPattern").interpretation ?? "",
    section: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
    requiresVascular: "earlyVenousDrainage",
    advanced: true,
  }),
  statusTile("mra-variant-fetal-pca", "Fetal PCA configuration", "Variants",
    "fetal-pca-right", "a:variant", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-variant-a1", "Hypoplastic / aplastic A1", "Variants",
    "a1-hypoplasia-left", "a:variant", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-variant-vertebral", "Vertebral dominance / hypoplasia", "Variants",
    "vertebral-dominance-right", "a:variant", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-variant-pcom", "Asymmetric PCom", "Variants",
    "pcom-asymmetry-left", "a:variant", { requiresVascular: "arterialAssessment" }),
  statusTile("mra-variant-pica", "Vertebral artery terminating in PICA", "Variants",
    "pica-termination-variant-right", "a:variant", { requiresVascular: "arterialAssessment" }),
];

const MRA_NECK_TILES: BrainTile[] = [
  treeNormalTile("neck-normal", "Normal dedicated MRA neck", "mraNeck"),
  statusTile("neck-plaque", "Plaque / luminal irregularity", "Carotid system",
    "carotid-bulb-right", "a:focalNarrowing", { requiresVascular: "arterialAssessment" }),
  proseTile("neck-stenosis-atherosclerotic", "Carotid bulb stenosis (canonical)", "Carotid system", {
    vessel: "carotid-bulb-left",
    findings: vascularSplitFor("carotidBulbStenosis").observation,
    section: VASCULAR_FINDINGS_SECTIONS.leftCarotid,
    requiresVascular: "arterialAssessment",
  }),
  proseTile("neck-stenosis-nascet", "NASCET-graded stenosis (numeric, gated)", "Stenosis — numeric, gated", {
    vessel: "carotid-bulb-left",
    findings: "Measured stenosis of the [left/right] carotid bulb / proximal ICA: [value] % NASCET.",
    impression: "High-grade atherosclerotic stenosis.",
    section: VASCULAR_FINDINGS_SECTIONS.leftCarotid,
    requiresVascular: "numericStenosis",
    advanced: true,
  }),
  statusTile("neck-occlusion", "Carotid occlusion (selected)", "Carotid system",
    "ica-cervical-right", "a:confirmedOcclusion", {
      advanced: true,
      requiresVascular: "selectedOcclusion",
    }),
  proseTile("neck-dissection-pattern", "Intramural hematoma (vessel-wall gated)", "Dissection", {
    vessel: "ica-cervical-left",
    findings: vascularSplitFor("carotidDissection").observation,
    section: VASCULAR_FINDINGS_SECTIONS.leftCarotid,
    requiresVascular: "intramuralHematoma",
    requires: ["t1"],
  }),
  proseTile("neck-dissection-diagnosis", "Acute dissection — radiologist-selected", "Dissection", {
    concept: "mra_neck_dissection",
    findings: "The appearances are classified by the reporting radiologist as an acute carotid dissection.",
    impression: vascularSplitFor("carotidDissection").interpretation,
    section: VASCULAR_FINDINGS_SECTIONS.leftCarotid,
    requiresVascular: "intramuralHematoma",
    advanced: true,
  }),
  proseTile("neck-pseudoaneurysm", "Pseudoaneurysm", "Dissection", {
    concept: "aneurysm_pseudoaneurysm",
    findings: "Outpouching of the cervical [left/right] ICA at the level of the narrowed segment, suspicious for a pseudoaneurysm.",
    section: VASCULAR_FINDINGS_SECTIONS.leftCarotid,
    requiresVascular: "aneurysmMorphology",
    advanced: true,
  }),
  proseTile("neck-vertebral-hypoplasia-pica", "Vertebral hypoplasia terminating in PICA (canonical)", "Variants", {
    vessel: "pica-termination-variant-right",
    variant: true,
    findings: vascularSplitFor("vertebralPicaVariant").observation,
    impression: vascularSplitFor("vertebralPicaVariant").interpretation,
    section: VASCULAR_FINDINGS_SECTIONS.variants,
    requiresVascular: "arterialAssessment",
  }),
  statusTile("neck-ectasia", "Tortuosity / ectasia", "Carotid system",
    "cca-right", "a:ectasia", { requiresVascular: "arterialAssessment" }),
];

const MRV_TILES: BrainTile[] = [
  treeNormalTile("mrv-normal", "Normal dedicated MRV", "mrv"),
  statusTile("mrv-flow-gap", "Sinus flow gap (descriptive)", "Flow without a cause",
    "transverse-sinus-right", "v:flowGap", { requiresVascular: "venousAssessment" }),
  statusTile("mrv-reduced-flow", "Reduced flow signal", "Flow without a cause",
    "sss", "v:reducedFlowSignal", { requiresVascular: "venousAssessment" }),
  proseTile("mrv-thrombus-signal", "Clot signal in the sinuses (canonical)", "Thrombosis — description", {
    vessel: "sss",
    findings: vascularSplitFor("cvstSagittal").observation,
    section: VASCULAR_FINDINGS_SECTIONS.duralSinuses,
    requiresVascular: "thrombusSignal",
    requires: ["t1", "t2"],
  }),
  proseTile("mrv-thrombosis-diagnosis", "Dural venous sinus thrombosis (selected)", "Thrombosis — conclusion", {
    concept: "mrv_thrombosis",
    findings: "Occlusive thrombus of the superior sagittal sinus with extension into the [left/right] transverse and sigmoid sinuses.",
    impression: vascularSplitFor("cvstSagittal").interpretation,
    section: VASCULAR_FINDINGS_SECTIONS.thrombus,
    severity: "critical",
    requiresVascular: "venousAssessment",
    advanced: true,
  }),
  statusTile("mrv-filling-defect", "Transverse sinus filling defect (contrast gated)", "Thrombosis — description",
    "transverse-sinus-left", "v:fillingDefect", { requiresVascular: "fillingDefect" }),
  proseTile("mrv-filling-defect-subacute", "Filling defect with rim enhancement (canonical)", "Thrombosis — description", {
    vessel: "transverse-sinus-right",
    findings: vascularSplitFor("cvstTransverseFillingDefect").observation,
    impression: vascularSplitFor("cvstTransverseFillingDefect").interpretation,
    requiresVascular: "fillingDefect",
    requires: ["contrast"],
    advanced: true,
  }),
  proseTile("mrv-deep-venous-thrombosis", "Deep venous system thrombosis (canonical)", "Thrombosis — conclusion", {
    concept: "mrv_deep_venous_thrombosis",
    findings: VASCULAR_LIBRARY_PROSE.deepVenousThrombosis,
    impression: "Deep cerebral venous thrombosis.",
    section: VASCULAR_FINDINGS_SECTIONS.deepVenousSystem,
    severity: "critical",
    requires: ["flair"],
    requiresVascular: "venousAssessment",
  }),
  statusTile("mrv-recanalization", "Recanalization", "Thrombosis — description",
    "sss", "v:recanalization", { requiresVascular: "venousAssessment", advanced: true }),
  statusTile("mrv-collaterals", "Prominent collateral veins", "Thrombosis — description",
    "cortical-veins", "v:collateralVeins", { requiresVascular: "venousAssessment", advanced: true }),
  statusTile("mrv-transverse-hypoplasia", "Transverse sinus hypoplasia / aplasia (variant)", "Variants",
    "transverse-sinus-hypoplasia-left", "v:developmentalHypoplasia", {
      requiresVascular: "venousAssessment",
    }),
  proseTile("mrv-venous-infarct", "Venous haemorrhagic infarction", "Associated brain findings", {
    concept: "venous_infarct",
    site: "VENOUS-INFARCT",
    findings: "Cortical T2/FLAIR hyperintensity with petechial susceptibility change in the parasagittal [location], compatible with venous infarction.",
    impression: "Venous infarction in the territory of the thrombosed sinus.",
    section: VASCULAR_FINDINGS_SECTIONS.associatedBrain,
    severity: "critical",
    requires: ["flair", "swiGre"],
    requiresVascular: "blooming",
  }),
];

export const MRA_SUBMASTER: BrainSubMaster = {
  id: "mra",
  label: "Intracranial MRA (dedicated)",
  hint: "Vessel-row statuses and canonical vascular patterns. Conclusions are separate, technique-gated tiles.",
  tiles: MRA_TILES,
};

export const MRA_NECK_SUBMASTER: BrainSubMaster = {
  id: "mraNeck",
  label: "MRA neck (dedicated)",
  hint: "Extracranial carotid and vertebral rows. NASCET and dissection acuity stay gated and selected.",
  tiles: MRA_NECK_TILES,
};

export const MRV_SUBMASTER: BrainSubMaster = {
  id: "mrv",
  label: "MRV (dedicated)",
  hint: "Dural sinuses and deep venous system. A flow gap is never written as a thrombus.",
  tiles: MRV_TILES,
};

export const VASCULAR_SUB_MASTERS: readonly BrainSubMaster[] = [
  MRA_SUBMASTER,
  MRA_NECK_SUBMASTER,
  MRV_SUBMASTER,
];

/** Every tile, for the availability tests. */
export const ALL_VASCULAR_TILES: readonly BrainTile[] = VASCULAR_SUB_MASTERS.flatMap(
  (sub) => sub.tiles,
);
