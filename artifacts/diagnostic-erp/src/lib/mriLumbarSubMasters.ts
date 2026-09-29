/**
 * mriLumbarSubMasters.ts — MRI Lumbar Spine clinical sub-masters (spec §2-§21).
 *
 * Twelve progressive-disclosure palettes over ONE lumbar observation model.
 * They are not twelve editors: every tile and every preset compiles to ledger
 * atoms applied through the existing `applyMacroBundle` / `removeMacroBundle` /
 * clinical-undo machinery, exactly like the existing level rows. Switching a
 * palette on or off only changes which tiles are offered — observations are
 * never erased by palette state.
 *
 * Rules encoded here:
 *  - seeded prose is verbatim from `mriLumbarLibrary.ts` (the canonical
 *    clinical library). Where the library has no sentence, the tile renders
 *    the radiologist's own structured choice as "<Section>: <label>" and is
 *    marked `structured-choice`; nothing in this file invents clinical wording;
 *  - tiles that need contrast / STIR / DWI / dynamic imaging / a whole-spine
 *    localizer are gated by `mriSpineSequences` (spec §35);
 *  - abnormal atoms carry the normal sentence they supersede (`baselineReplaces`)
 *    so a normal baseline reconciles instead of contradicting (spec §4);
 *  - no tile auto-diagnoses: Bertolotti, arachnoiditis and histopathological
 *    labels exist only as radiologist-selected tiles;
 *  - level keys always come from the numbering resolver, never a fixed array.
 *
 * Pure data + functions only — no React, no store instance.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  LS_ALIGN,
  LS_BONE,
  LS_CANAL,
  LS_DISC,
  LS_FORAMEN,
  LS_POSTERIOR,
  LS_POSTOP,
  LS_SOFT_TISSUE,
  LS_MACRO_LINES,
  fillLsProse,
  type LsProseVars,
  type LsSide,
} from "./mriLumbarLibrary";
import { spineAtomsToPatches, spineBundleId, type SpineAtomSpec } from "./mriSpineAtoms";
import {
  LS_LEVEL_CANAL_BASELINE,
  LS_LEVEL_DISC_BASELINE,
  LS_LEVEL_ENDPLATE_BASELINE,
  LS_LEVEL_FORAMINAL_BASELINE,
  LS_LEVEL_HEIGHT_BASELINE,
  LS_LEVEL_ROOT_BASELINE,
  LS_LEVEL_SIGNAL_BASELINE,
} from "./mriLumbarLevelState";
import {
  buildLumbarLevelDetailBundle,
  type LumbarLevelDetail,
} from "./mriLumbarLevelDetail";
import {
  numberingCautionSentence,
  type LumbarNumberingState,
} from "./mriSpineNumbering";
import {
  spineSequencesAllow,
  type SpineSequenceKey,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";

export const LUMBAR_SUBMASTER_IDS = [
  "routine",
  "degenerative",
  "discNeural",
  "listhesis",
  "trauma",
  "infection",
  "tumorMarrow",
  "postop",
  "conusCauda",
  "congenital",
  "inflammatory",
  "advanced",
] as const;

export type LumbarSubMasterId = (typeof LUMBAR_SUBMASTER_IDS)[number];

export type LumbarTileContext = {
  /** Resolver-derived level key (L1-L2 … L5-T). */
  level: string;
  numbering: LumbarNumberingState;
  sequences: SpineSequencesAvailable;
  side?: LsSide;
  root?: string;
  mm?: number;
  mm2?: number;
  pct?: number;
  cm?: number;
  cm2?: number;
  conusLevel?: string;
  vertebra?: string;
  castellvi?: string;
  direction?: "superiorly" | "inferiorly";
  endplateFace?: string;
  region?: string;
  detail?: LumbarLevelDetail;
};

export type LumbarTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind an explicit "advanced" disclosure inside the palette. */
  advanced?: boolean;
  /** Acquisitions this tile needs before it may be offered (spec §35). */
  requires?: SpineSequenceKey[];
  /** Never offered without whole-spine / localizer coverage. */
  requiresLocalizer?: boolean;
  /** Tile is only meaningful when numbering is non-standard. */
  requiresTransitional?: boolean;
  atoms: (ctx: LumbarTileContext) => SpineAtomSpec[];
};

export type LumbarSubMaster = {
  id: LumbarSubMasterId;
  label: string;
  hint: string;
  tiles: LumbarTile[];
};

type AtomExtras = Partial<Omit<SpineAtomSpec, "concept" | "findings">>;

/** Canonical-library sentence for this tile, with variables substituted. */
function lib(template: string, ctx: LumbarTileContext, overrides: LsProseVars = {}) {
  const vars: LsProseVars = {
    level: ctx.level,
    side: ctx.side,
    root: ctx.root,
    mm: ctx.mm,
    mm2: ctx.mm2,
    cm: ctx.cm,
    cm2: ctx.cm2,
    pct: ctx.pct,
    conusLevel: ctx.conusLevel,
    vertebra: ctx.vertebra,
    castellvi: ctx.castellvi,
    direction: ctx.direction,
    endplateFace: ctx.endplateFace,
    ...overrides,
  };
  return fillLsProse(template, vars).text;
}

const SECTION_FRAMES: Record<string, string> = {
  alignment: "Alignment",
  marrow: "Bones / marrow",
  discs: "Discs",
  canal: "Central canal",
  foramina: "Neural foramina",
  recess: "Lateral recess",
  facets: "Facet joints",
  flavum: "Ligamentum flavum",
  conus: "Conus medullaris",
  cauda: "Cauda equina",
  epidural: "Epidural space",
  soft: "Paraspinal soft tissues",
  si: "Sacroiliac joints",
  pars: "Pars interarticularis",
  hardware: "Hardware",
  numbering: "Vertebral numbering",
};

/** The radiologist's structured choice, rendered without invented clinical prose. */
function choice(section: keyof typeof SECTION_FRAMES, label: string, ctx: LumbarTileContext) {
  return `${SECTION_FRAMES[section]}: ${label}${ctx.level ? ` at ${ctx.level}` : ""}.`;
}

function a(concept: string, findings: string, extra?: AtomExtras): SpineAtomSpec {
  return {
    concept,
    conflictGroup: extra?.conflictGroup ?? concept,
    anatomicalSection: extra?.anatomicalSection ?? ctxSection(concept, extra?.level),
    findings,
    ...extra,
  };
}

/**
 * `anatomicalSection` is the level for level-bound findings and the region name
 * for global ones, matching how the existing lumbar level rows own their rows.
 */
function ctxSection(concept: string, level?: string): string {
  if (level) return level;
  const global = new Set([
    "alignment",
    "conus_medullaris",
    "cauda_equina",
    "sacroiliac_joints",
    "muscle_atrophy",
    "transitional_vertebra",
    "bertolotti_syndrome",
    "tethered_cord",
    "arachnoiditis",
    "screening_limitation",
    "screening_recommendation",
  ]);
  return global.has(concept) ? "lumbar spine" : (level ?? "lumbar spine");
}

/** Non-standard numbering always states its basis (spec §5). */
export function numberingAtom(ctx: LumbarTileContext): SpineAtomSpec | null {
  const caution = numberingCautionSentence(ctx.numbering);
  if (!caution) return null;
  return {
    concept: "transitional_vertebra",
    conflictGroup: "numbering_caution",
    anatomicalSection: "lumbar spine",
    findings: caution,
    role: "baseline",
  };
}

// ─── 1. ROUTINE / NORMAL ──────────────────────────────────────────────────

const ROUTINE: LumbarSubMaster = {
  id: "routine",
  label: "Routine / Normal",
  hint: "Protocol-aware normal baseline and the common incidental deviations.",
  tiles: [
    {
      id: "rt-alignment-normal",
      label: "Normal alignment / lordosis",
      group: "Baseline",
      atoms: (ctx) => [a("alignment", lib(LS_ALIGN.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" })],
    },
    {
      id: "rt-bone-normal",
      label: "Normal vertebral bodies / marrow",
      group: "Baseline",
      atoms: (ctx) => [
        a("compression_fracture", lib(LS_BONE.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
        a("bone_lesion", lib(LS_BONE.noFocalLesion, ctx), { anatomicalSection: "lumbar spine", conflictGroup: "bone_lesion", role: "baseline" }),
      ],
    },
    {
      id: "rt-disc-normal",
      label: "Normal discs",
      group: "Baseline",
      atoms: (ctx) => [
        a("disc_contour", lib(LS_DISC.normal, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, role: "baseline", baselineReplaces: LS_LEVEL_DISC_BASELINE }),
        a("disc_height", lib(LS_DISC.noHerniation, ctx), { anatomicalSection: "lumbar spine", conflictGroup: "disc_height", role: "baseline", baselineReplaces: LS_LEVEL_HEIGHT_BASELINE }),
      ],
    },
    {
      id: "rt-canal-normal",
      label: "Patent canal / normal conus",
      group: "Baseline",
      atoms: (ctx) => [
        a("canal_stenosis", lib(LS_CANAL.normal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine", level: ctx.level, role: "baseline", baselineReplaces: LS_LEVEL_CANAL_BASELINE }),
        a("conus_medullaris", lib(LS_ALIGN.conusNormal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine", conflictGroup: "conus_medullaris", role: "baseline" }),
      ],
    },
    {
      id: "rt-cauda-normal",
      label: "Normal cauda equina",
      group: "Baseline",
      atoms: (ctx) => [a("cauda_equina", lib(LS_CANAL.caudaNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" })],
    },
    {
      id: "rt-foramina-normal",
      label: "Patent foramina",
      group: "Baseline",
      atoms: (ctx) => [a("foraminal_stenosis", lib(LS_FORAMEN.normal, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, role: "baseline", baselineReplaces: LS_LEVEL_FORAMINAL_BASELINE })],
    },
    {
      id: "rt-posterior-normal",
      label: "Normal facets / ligamentum flavum",
      group: "Baseline",
      atoms: (ctx) => [
        a("facet_joint", lib(LS_POSTERIOR.facetNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
        a("ligamentum_flavum", lib(LS_POSTERIOR.lfNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      ],
    },
    {
      id: "rt-soft-normal",
      label: "Normal paraspinal / SI joints",
      group: "Baseline",
      atoms: (ctx) => [
        a("muscle_atrophy", lib(LS_SOFT_TISSUE.normal, ctx), { anatomicalSection: "lumbar spine", conflictGroup: "paraspinal", role: "baseline" }),
        a("sacroiliac_joints", lib(LS_SOFT_TISSUE.siNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      ],
    },
    {
      id: "rt-lordosis-loss",
      label: "Loss of lordosis (positional / spasm)",
      group: "Common deviations",
      atoms: (ctx) => [a("alignment", lib(LS_ALIGN.lordosisLoss, ctx), { anatomicalSection: "lumbar spine", baselineReplaces: LS_ALIGN.normal })],
    },
    {
      id: "rt-osteophytes",
      label: "Marginal osteophytes",
      group: "Common deviations",
      atoms: (ctx) => [a("osteophytes", lib(LS_BONE.osteophytes, ctx, { level2: ctx.level }), { baselineReplaces: LS_BONE.normal })],
    },
    {
      id: "rt-hemangioma",
      label: "Benign vertebral haemangioma",
      group: "Common deviations",
      requires: ["stir"],
      atoms: (ctx) => [a("bone_lesion", lib(LS_BONE.hemangioma, ctx), { baselineReplaces: LS_BONE.noFocalLesion })],
    },
    {
      id: "rt-schmorl",
      label: "Schmorl node",
      group: "Common deviations",
      atoms: (ctx) => [a("schmorl_node", lib(LS_BONE.schmorl, ctx), { level: ctx.vertebra ?? ctx.level })],
    },
  ],
};

// ─── 2. DEGENERATIVE ──────────────────────────────────────────────────────

const DEGENERATIVE: LumbarSubMaster = {
  id: "degenerative",
  label: "Degenerative",
  hint: "Alignment, endplate, disc, facet and flavum change with level detail.",
  tiles: [
    {
      id: "dg-lordosis-reversal",
      label: "Reversal of lordosis",
      group: "Alignment",
      atoms: (ctx) => [a("alignment", lib(LS_ALIGN.lordosisReversal, ctx), { anatomicalSection: "lumbar spine", baselineReplaces: LS_ALIGN.normal })],
    },
    {
      id: "dg-scoliosis",
      label: "Degenerative scoliosis",
      group: "Alignment",
      atoms: (ctx) => [a("alignment", lib(LS_ALIGN.scoliosis, ctx), { anatomicalSection: "lumbar spine", baselineReplaces: LS_ALIGN.normal })],
    },
    {
      id: "dg-anterolisthesis",
      label: "Degenerative anterolisthesis",
      group: "Alignment",
      atoms: (ctx) => [a("spondylolisthesis", lib(LS_ALIGN.anterolisthesisDegenerative, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, baselineReplaces: LS_ALIGN.normal })],
    },
    {
      id: "dg-retrolisthesis",
      label: "Retrolisthesis",
      group: "Alignment",
      atoms: (ctx) => [a("spondylolisthesis", lib(LS_ALIGN.retrolisthesis, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, state: "retro" })],
    },
    {
      id: "dg-modic1",
      label: "Modic type 1",
      group: "Endplates / marrow",
      requires: ["stir"],
      atoms: (ctx) => [a("endplate", lib(LS_BONE.modic1, ctx), { level: ctx.level, severity: "modic1", baselineReplaces: LS_LEVEL_ENDPLATE_BASELINE })],
    },
    {
      id: "dg-modic2",
      label: "Modic type 2",
      group: "Endplates / marrow",
      atoms: (ctx) => [a("endplate", lib(LS_BONE.modic2, ctx), { level: ctx.level, severity: "modic2", baselineReplaces: LS_LEVEL_ENDPLATE_BASELINE })],
    },
    {
      id: "dg-modic3",
      label: "Modic type 3",
      group: "Endplates / marrow",
      atoms: (ctx) => [a("endplate", lib(LS_BONE.modic3, ctx), { level: ctx.level, severity: "modic3", baselineReplaces: LS_LEVEL_ENDPLATE_BASELINE })],
    },
    {
      id: "dg-desiccation",
      label: "Disc desiccation / height loss",
      group: "Discs",
      atoms: (ctx) => [
        a("disc_signal", lib(LS_DISC.desiccation, ctx, { level2: ctx.level }), { level: ctx.level, baselineReplaces: LS_LEVEL_SIGNAL_BASELINE }),
        a("disc_height", choice("discs", "reduced disc height", ctx), { level: ctx.level, conflictGroup: "disc_height", baselineReplaces: LS_LEVEL_HEIGHT_BASELINE }),
      ],
    },
    {
      id: "dg-diffuse-bulge",
      label: "Diffuse posterior bulge",
      group: "Discs",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.diffuseBulge, ctx), { level: ctx.level, baselineReplaces: LS_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dg-osteophyte-complex",
      label: "Disc-osteophyte complex",
      group: "Discs",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.discOsteophyteComplex, ctx), { level: ctx.level, state: "disc_osteophyte", baselineReplaces: LS_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dg-annular-fissure",
      label: "Annular fissure / HIZ",
      group: "Discs",
      atoms: (ctx) => [a("annular_fissure", lib(LS_DISC.hiz, ctx), { level: ctx.level })],
    },
    {
      id: "dg-facet-arthropathy",
      label: "Facet arthropathy",
      group: "Posterior elements",
      atoms: (ctx) => [a("facet_joint", lib(LS_POSTERIOR.facetArthropathy, ctx, { level2: ctx.level }), { level: ctx.level, state: "arthropathy", laterality: ctx.side ?? "bilateral", supportsLaterality: true })],
    },
    {
      id: "dg-facet-effusion",
      label: "Facet effusion",
      group: "Posterior elements",
      atoms: (ctx) => [a("facet_joint", lib(LS_POSTERIOR.facetEffusion, ctx), { level: ctx.level, state: "effusion", laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
    {
      id: "dg-synovial-cyst",
      label: "Synovial cyst",
      group: "Posterior elements",
      atoms: (ctx) => [a("synovial_cyst", lib(LS_POSTERIOR.synovialCyst, ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true })],
    },
    {
      id: "dg-flavum",
      label: "Flavum hypertrophy / buckling",
      group: "Posterior elements",
      atoms: (ctx) => [a("ligamentum_flavum", lib(LS_POSTERIOR.lfHypertrophy, ctx), { level: ctx.level })],
    },
    {
      id: "dg-canal-stenosis",
      label: "Canal stenosis with AP diameter",
      group: "Effects",
      atoms: (ctx) => [a("canal_stenosis", lib(LS_CANAL.moderateStenosis, ctx), { level: ctx.level, severity: "moderate", measurement: ctx.mm != null ? String(ctx.mm) : undefined, baselineReplaces: LS_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "dg-foraminal-stenosis",
      label: "Foraminal stenosis",
      group: "Effects",
      atoms: (ctx) => [a("foraminal_stenosis", lib(LS_FORAMEN.moderateBilateral, ctx), { level: ctx.level, severity: "moderate", laterality: ctx.side ?? "bilateral", supportsLaterality: true, baselineReplaces: LS_LEVEL_FORAMINAL_BASELINE })],
    },
    {
      id: "dg-recess-stenosis",
      label: "Lateral recess narrowing",
      group: "Effects",
      advanced: true,
      atoms: (ctx) => [a("lateral_recess_stenosis", choice("recess", "lateral recess narrowing", ctx), { level: ctx.level, laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
    {
      id: "dg-thecal-indentation",
      label: "Thecal sac indentation",
      group: "Effects",
      advanced: true,
      atoms: (ctx) => [a("canal_morphology", choice("canal", "ventral thecal sac indentation", ctx), { level: ctx.level })],
    },
  ],
};

// ─── 3. DISC HERNIATION / NEURAL COMPRESSION ──────────────────────────────

const DISC_NEURAL: LumbarSubMaster = {
  id: "discNeural",
  label: "Disc Herniation / Neural Compression",
  hint: "Focal disc disease: morphology, location, size, migration, root effect.",
  tiles: [
    {
      id: "dn-protrusion",
      label: "Central protrusion",
      group: "Morphology",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.centralProtrusion, ctx), { level: ctx.level, state: "protrusion", severity: "moderate", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
    {
      id: "dn-extrusion",
      label: "Paracentral extrusion",
      group: "Morphology",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.paracentralExtrusion, ctx), { level: ctx.level, state: "extrusion", severity: "severe", laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
    {
      id: "dn-sequestration",
      label: "Sequestration with migration",
      group: "Morphology",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.sequestration, ctx), { level: ctx.level, state: "sequestration", severity: "severe" }),
        a("disc_migration", choice("discs", "migrated disc fragment", ctx), { level: ctx.level, state: ctx.direction === "superiorly" ? "cranial" : "caudal", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
    {
      id: "dn-extraforaminal",
      label: "Far lateral / extraforaminal",
      group: "Location",
      atoms: (ctx) => [a("disc_contour", lib(LS_DISC.extraforaminal, ctx), { level: ctx.level, state: "extraforaminal", laterality: ctx.side ?? "left", supportsLaterality: true })],
    },
    {
      id: "dn-recess-effect",
      label: "Lateral recess effect",
      group: "Neural effect",
      atoms: (ctx) => [a("lateral_recess_stenosis", choice("recess", "disc material extending into the lateral recess", ctx), { level: ctx.level, laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
    {
      id: "dn-root-contact",
      label: "Root contact",
      group: "Neural effect",
      atoms: (ctx) => [a("root_traversing", choice("recess", "traversing root contact", ctx), { level: ctx.level, state: "contact", conflictGroup: `root-trav-${ctx.root ?? ""}-${ctx.level.replace(/\s+/g, "")}` })],
    },
    {
      id: "dn-root-compression",
      label: "Root compression",
      group: "Neural effect",
      atoms: (ctx) => [a("root_traversing", choice("recess", "traversing root compression", ctx), { level: ctx.level, state: "compression", severity: "severe", conflictGroup: `root-trav-${ctx.root ?? ""}-${ctx.level.replace(/\s+/g, "")}` })],
    },
    {
      id: "dn-exiting-root",
      label: "Exiting root (foraminal)",
      group: "Neural effect",
      atoms: (ctx) => [a("root_exiting", lib(LS_FORAMEN.severeLeftStenosis, ctx), { level: ctx.level, state: "impingement", laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: `root-exit-${ctx.root ?? ""}-${ctx.level.replace(/\s+/g, "")}` })],
    },
    {
      id: "dn-fat-loss",
      label: "Complete perineural fat loss",
      group: "Neural effect",
      advanced: true,
      atoms: (ctx) => [a("foraminal_stenosis", lib(LS_FORAMEN.completeFatLoss, ctx), { level: ctx.level, state: "complete_loss", laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
  ],
};

// ─── 4. SPONDYLOLISTHESIS / PARS ──────────────────────────────────────────

const LISTHESIS: LumbarSubMaster = {
  id: "listhesis",
  label: "Spondylolisthesis / Pars",
  hint: "Slip pattern, cause, pars status and associated foraminal effect.",
  tiles: [
    {
      id: "sp-degenerative-slip",
      label: "Degenerative slip",
      group: "Pattern",
      atoms: (ctx) => [a("spondylolisthesis", lib(LS_ALIGN.anterolisthesisDegenerative, ctx), { level: ctx.level, state: "degenerative", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
    {
      id: "sp-isthmic-slip",
      label: "Isthmic slip",
      group: "Pattern",
      atoms: (ctx) => [a("spondylolisthesis", lib(LS_ALIGN.anterolisthesisIsthmic, ctx), { level: ctx.level, state: "isthmic", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
    {
      id: "sp-pars-bilateral",
      label: "Bilateral pars defect",
      group: "Pars",
      atoms: (ctx) => [a("pars_defect", lib(LS_POSTERIOR.parsDefect, ctx), { level: ctx.level, laterality: "bilateral", supportsLaterality: true })],
    },
    {
      id: "sp-pars-unilateral",
      label: "Unilateral pars defect",
      group: "Pars",
      atoms: (ctx) => [a("pars_defect", choice("pars", "unilateral pars defect", ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: `pars_defect-${ctx.side ?? "left"}` })],
    },
    {
      id: "sp-pars-stress",
      label: "Pars stress reaction (oedema)",
      group: "Pars",
      requires: ["stir"],
      advanced: true,
      atoms: (ctx) => [a("pars_defect", lib(LS_POSTERIOR.parsDefect, ctx), { level: ctx.level, state: "stress_reaction", laterality: ctx.side ?? "bilateral" })],
    },
    {
      id: "sp-uncapping",
      label: "Disc uncapping / pseudobulge",
      group: "Associated",
      atoms: (ctx) => [a("disc_uncapping", choice("discs", "disc uncapping / pseudobulge", ctx), { level: ctx.level })],
    },
    {
      id: "sp-foraminal-effect",
      label: "Foraminal stenosis with root compression",
      group: "Associated",
      atoms: (ctx) => [
        a("foraminal_stenosis", lib(LS_MACRO_LINES.macro3.l5s1, ctx), { level: ctx.level, severity: "severe", laterality: "bilateral", supportsLaterality: true }),
        a("root_exiting", choice("foramina", "exiting root compression", ctx), { level: ctx.level, state: "compression", conflictGroup: `root-exit-${ctx.root ?? ""}-${ctx.level.replace(/\s+/g, "")}` }),
      ],
    },
    {
      id: "sp-preserved-canal",
      label: "Canal AP preserved despite slip",
      group: "Associated",
      advanced: true,
      atoms: () => [a("canal_morphology", LS_MACRO_LINES.macro3.l5s1Tail, { level: "L5-S1", conflictGroup: "canal_morphology" })],
    },
    {
      id: "sp-dynamic",
      label: "Dynamic instability",
      group: "Dynamic (only when imaged)",
      requires: ["dynamic"],
      atoms: (ctx) => [a("listhesis_dynamic", choice("alignment", "interval translation on dynamic imaging", ctx), { level: ctx.level, measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
  ],
};

// ─── 5. TRAUMA ────────────────────────────────────────────────────────────

const TRAUMA: LumbarSubMaster = {
  id: "trauma",
  label: "Trauma",
  hint: "Fracture pattern, acuity, height loss, retropulsion and soft tissue injury.",
  tiles: [
    {
      id: "tr-compression-acute",
      label: "Acute compression fracture",
      group: "Fracture",
      requires: ["stir"],
      atoms: (ctx) => [a("compression_fracture", lib(LS_BONE.acuteFracture, ctx), { level: ctx.vertebra ?? ctx.level, state: "acute", measurement: ctx.pct != null ? `${ctx.pct}%` : undefined })],
    },
    {
      id: "tr-compression-chronic",
      label: "Chronic wedge fracture",
      group: "Fracture",
      atoms: (ctx) => [a("compression_fracture", lib(LS_BONE.chronicFracture, ctx), { level: ctx.vertebra ?? ctx.level, state: "chronic" })],
    },
    {
      id: "tr-burst",
      label: "Burst fracture with retropulsion",
      group: "Fracture",
      atoms: (ctx) => [
        a("vertebral_collapse", choice("marrow", "burst fracture with retropulsion", ctx), { level: ctx.vertebra ?? ctx.level, state: "burst", measurement: ctx.mm != null ? String(ctx.mm) : undefined }),
      ],
    },
    {
      id: "tr-marrow-edema",
      label: "Bone marrow oedema",
      group: "Marrow",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("marrow", "marrow oedema", ctx), { level: ctx.vertebra ?? ctx.level })],
    },
    {
      id: "tr-endplate-fracture",
      label: "Endplate fracture",
      group: "Marrow",
      atoms: (ctx) => [a("endplate_erosion", choice("marrow", "endplate fracture", ctx), { level: ctx.vertebra ?? ctx.level })],
    },
    {
      id: "tr-posterior-element",
      label: "Posterior element fracture",
      group: "Posterior elements",
      atoms: (ctx) => [a("pars_defect", choice("pars", "posterior element fracture", ctx), { level: ctx.level, laterality: ctx.side ?? "", supportsLaterality: Boolean(ctx.side) })],
    },
    {
      id: "tr-ligamentous",
      label: "Ligamentous injury",
      group: "Ligaments",
      requires: ["stir"],
      advanced: true,
      atoms: (ctx) => [a("ligamentum_flavum", choice("flavum", "ligamentous injury", ctx), { level: ctx.level })],
    },
    {
      id: "tr-epidural-hematoma",
      label: "Epidural haematoma",
      group: "Canal / neural",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "epidural haematoma", ctx), { level: ctx.level, state: "hematoma" })],
    },
    {
      id: "tr-canal-compromise",
      label: "Canal compromise / conus effect",
      group: "Canal / neural",
      atoms: (ctx) => [a("canal_stenosis", lib(LS_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
  ],
};

// ─── 6. INFECTION ─────────────────────────────────────────────────────────

const INFECTION: LumbarSubMaster = {
  id: "infection",
  label: "Infection",
  hint: "Discitis / osteomyelitis, epidural and paraspinal collections.",
  tiles: [
    {
      id: "in-spondylodiscitis",
      label: "Spondylodiscitis",
      group: "Disc / endplate",
      atoms: (ctx) => [a("spondylodiscitis", lib(LS_DISC.discitis, ctx), { level: ctx.level, severity: "significant" })],
    },
    {
      id: "in-endplate-erosion",
      label: "Endplate erosion",
      group: "Disc / endplate",
      atoms: (ctx) => [a("endplate_erosion", choice("marrow", "endplate erosion", ctx), { level: ctx.level })],
    },
    {
      id: "in-marrow-edema",
      label: "Vertebral marrow oedema",
      group: "Disc / endplate",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("marrow", "vertebral marrow oedema", ctx), { level: ctx.level })],
    },
    {
      id: "in-enhancement",
      label: "Enhancement pattern",
      group: "Contrast findings",
      requires: ["contrast"],
      atoms: (ctx) => [a("spondylodiscitis", choice("marrow", "enhancement of the disc and endplates", ctx), { level: ctx.level, conflictGroup: "infection_enhancement", state: "enhancement" })],
    },
    {
      id: "in-epidural-collection",
      label: "Epidural collection / abscess",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "epidural collection", ctx), { level: ctx.level, state: "abscess", severity: "significant" })],
    },
    {
      id: "in-phlegmon",
      label: "Epidural phlegmon",
      group: "Collections",
      advanced: true,
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "epidural phlegmon", ctx), { level: ctx.level, state: "phlegmon", conflictGroup: "epidural_phlegmon" })],
    },
    {
      id: "in-psoas",
      label: "Psoas abscess",
      group: "Collections",
      atoms: (ctx) => [a("paravertebral_collection", lib(LS_SOFT_TISSUE.psoasAbscess, ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true })],
    },
    {
      id: "in-neural-effect",
      label: "Canal compromise with neural compression",
      group: "Effects",
      atoms: (ctx) => [a("canal_stenosis", lib(LS_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe" }),
        a("root_traversing", choice("recess", "nerve root compression", ctx), { level: ctx.level, state: "compression", conflictGroup: `root-trav-${ctx.root ?? ""}-${ctx.level.replace(/\s+/g, "")}` })],
    },
  ],
};

// ─── 7. TUMOR / MARROW / MASS ─────────────────────────────────────────────

const TUMOR: LumbarSubMaster = {
  id: "tumorMarrow",
  label: "Tumor / Marrow / Mass",
  hint: "Marrow and osseous lesions, epidural and intradural masses.",
  tiles: [
    {
      id: "tm-focal-lesion",
      label: "Focal marrow lesion",
      group: "Marrow",
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "focal marrow signal abnormality", ctx), { level: ctx.vertebra ?? ctx.level })],
    },
    {
      id: "tm-multifocal",
      label: "Multifocal marrow alteration",
      group: "Marrow",
      requires: ["stir"],
      atoms: () => [a("marrow_edema", LS_BONE.multifocalMarrow, { anatomicalSection: "lumbar spine", conflictGroup: "marrow_infiltrative", state: "multifocal" })],
    },
    {
      id: "tm-posterior-element",
      label: "Posterior element involvement",
      group: "Osseous",
      atoms: (ctx) => [a("bone_lesion", choice("pars", "posterior element involvement", ctx), { level: ctx.level })],
    },
    {
      id: "tm-pathological-fracture",
      label: "Pathological fracture",
      group: "Osseous",
      atoms: (ctx) => [a("vertebral_collapse", choice("marrow", "pathological fracture", ctx), { level: ctx.vertebra ?? ctx.level, state: "pathological" })],
    },
    {
      id: "tm-epidural-extension",
      label: "Epidural extension",
      group: "Epidural / intradural",
      atoms: (ctx) => [a("epidural_space", choice("epidural", "epidural extension", ctx), { level: ctx.level, state: "extension" })],
    },
    {
      id: "tm-intradural-mass",
      label: "Intradural mass (shared lesion form)",
      group: "Epidural / intradural",
      atoms: (ctx) => [a("epidural_space", choice("cauda", "intradural mass", ctx), { level: ctx.level, conflictGroup: "intradural_mass", state: "intradural" })],
    },
    {
      id: "tm-enhancement",
      label: "Enhancement pattern",
      group: "Epidural / intradural",
      requires: ["contrast"],
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "lesion enhancement", ctx), { level: ctx.vertebra ?? ctx.level, state: "enhancement", conflictGroup: "lesion_enhancement" })],
    },
    {
      id: "tm-canal-compromise",
      label: "Canal compromise / conus compression",
      group: "Effects",
      atoms: (ctx) => [a("canal_stenosis", lib(LS_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe" }),
        a("cauda_equina", choice("cauda", "cauda equina compression", ctx), { anatomicalSection: "lumbar spine", level: ctx.level })],
    },
  ],
};

// ─── 8. POST-OPERATIVE ────────────────────────────────────────────────────

const POSTOP: LumbarSubMaster = {
  id: "postop",
  label: "Post-Operative",
  hint: "Procedure, expected change, recurrence versus fibrosis, hardware limits.",
  tiles: [
    {
      id: "po-expected",
      label: "Expected post-surgical change",
      group: "Baseline",
      atoms: () => [a("hardware_postop", LS_POSTOP.normal, { anatomicalSection: "lumbar spine", role: "baseline" })],
    },
    {
      id: "po-laminectomy",
      label: "Laminectomy / discectomy defect",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", lib(LS_POSTOP.priorLaminectomy, ctx), { level: ctx.level, state: "laminectomy", laterality: ctx.side ?? "right", supportsLaterality: true })],
    },
    {
      id: "po-fusion",
      label: "Fusion / instrumentation",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", lib(LS_POSTOP.fusionIntact, ctx), { level: ctx.level, state: "fusion" })],
    },
    {
      id: "po-recurrent-disc",
      label: "Recurrent disc (contrast-dependent)",
      group: "Findings",
      requires: ["contrast"],
      atoms: (ctx) => [a("disc_contour", lib(LS_POSTOP.recurrentDisc, ctx), { level: ctx.level, state: "recurrent", laterality: ctx.side ?? "right", baselineReplaces: LS_LEVEL_DISC_BASELINE })],
    },
    {
      id: "po-fibrosis",
      label: "Epidural fibrosis (contrast-dependent)",
      group: "Findings",
      requires: ["contrast"],
      atoms: (ctx) => [a("epidural_space", lib(LS_POSTOP.epiduralFibrosis, ctx), { level: ctx.level, state: "fibrosis", conflictGroup: "epidural_fibrosis" })],
    },
    {
      id: "po-residual-stenosis",
      label: "Residual / recurrent stenosis",
      group: "Findings",
      atoms: (ctx) => [a("canal_stenosis", lib(LS_CANAL.moderateStenosis, ctx), { level: ctx.level, severity: "moderate" })],
    },
    {
      id: "po-adjacent-segment",
      label: "Adjacent segment degeneration",
      group: "Findings",
      atoms: (ctx) => [a("adjacent_segment_degeneration", choice("discs", "adjacent segment degeneration", ctx), { level: ctx.level })],
    },
    {
      id: "po-pseudomeningocele",
      label: "Pseudomeningocele / collection",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", lib(LS_POSTOP.pseudomeningocele, ctx), { level: ctx.level, state: "pseudomeningocele", measurement: ctx.mm != null ? String(ctx.mm) : undefined })],
    },
    {
      id: "po-infection",
      label: "Post-operative infection",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "post-operative infected collection", ctx), { level: ctx.level, state: "infection", conflictGroup: "epidural_postop_infection" })],
    },
    {
      id: "po-hardware-limitation",
      label: "Hardware assessment limited by artefact",
      group: "Limitations",
      advanced: true,
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "hardware integrity cannot be fully assessed due to susceptibility artefact", ctx), { level: ctx.level, conflictGroup: "hardware_limitation" })],
    },
  ],
};

// ─── 9. CONUS / CAUDA EQUINA / INTRADURAL ─────────────────────────────────

const CONUS: LumbarSubMaster = {
  id: "conusCauda",
  label: "Conus / Cauda Equina / Intradural",
  hint: "Conus level and signal, tethering, cauda pattern, descriptive arachnoiditis.",
  tiles: [
    {
      id: "cn-conus-level",
      label: "Conus termination level",
      group: "Conus",
      atoms: (ctx) => [a("conus_medullaris", lib(LS_ALIGN.conusNormal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine" })],
    },
    {
      id: "cn-low-lying",
      label: "Low-lying conus",
      group: "Conus",
      atoms: (ctx) => [a("conus_medullaris", choice("conus", "low-lying conus", ctx), { anatomicalSection: "lumbar spine", level: ctx.conusLevel ?? ctx.level, state: "low_lying" })],
    },
    {
      id: "cn-conus-signal",
      label: "Conus signal abnormality",
      group: "Conus",
      atoms: (ctx) => [a("conus_medullaris", lib(LS_CANAL.conusSignal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine", state: "signal" })],
    },
    {
      id: "cn-tethered",
      label: "Tethered cord / filum",
      group: "Tethering",
      atoms: (ctx) => [a("tethered_cord", lib(LS_CANAL.tetheredCord, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine" }),
        a("filum_terminale", choice("conus", "thickened filum terminale", ctx), { anatomicalSection: "lumbar spine", conflictGroup: "filum_terminale" })],
    },
    {
      id: "cn-crowding",
      label: "Cauda crowding / compression",
      group: "Cauda equina",
      atoms: (ctx) => [a("cauda_equina", choice("cauda", "cauda equina crowding", ctx), { anatomicalSection: "lumbar spine", level: ctx.level, state: "crowding" })],
    },
    {
      id: "cn-clumping",
      label: "Root clumping (descriptive)",
      group: "Cauda equina",
      atoms: () => [a("cauda_equina", LS_CANAL.arachnoiditis, { anatomicalSection: "lumbar spine", state: "clumping" })],
    },
    {
      id: "cn-arachnoiditis",
      label: "Arachnoiditis (radiologist-selected)",
      group: "Cauda equina",
      advanced: true,
      atoms: () => [a("arachnoiditis", LS_CANAL.arachnoiditis, { anatomicalSection: "lumbar spine" })],
    },
    {
      id: "cn-intradural-mass",
      label: "Intradural mass (shared lesion form)",
      group: "Intradural",
      atoms: (ctx) => [a("epidural_space", choice("cauda", "intradural lesion", ctx), { level: ctx.level, conflictGroup: "intradural_mass", state: "intradural" })],
    },
  ],
};

// ─── 10. CONGENITAL / LSTV ────────────────────────────────────────────────

const CONGENITAL: LumbarSubMaster = {
  id: "congenital",
  label: "Congenital / LSTV",
  hint: "Transitional anatomy, Castellvi detail and the numbering it implies.",
  tiles: [
    {
      id: "cg-lstv",
      label: "LSTV present",
      group: "Transitional anatomy",
      atoms: (ctx) => [a("transitional_vertebra", lib(LS_ALIGN.lstv, ctx), { anatomicalSection: "lumbar spine" }), numberingAtom(ctx) ?? a("transitional_vertebra", LS_ALIGN.lstv, { anatomicalSection: "lumbar spine", conflictGroup: "numbering_caution" })],
    },
    {
      id: "cg-castellvi",
      label: "Castellvi grade detail",
      group: "Transitional anatomy",
      atoms: (ctx) => [a("transitional_vertebra", lib(LS_MACRO_LINES.macro4.alignment, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, severity: ctx.castellvi ?? "" })],
    },
    {
      id: "cg-pseudoarthrosis",
      label: "Pseudoarthrosis with reactive change",
      group: "Transitional anatomy",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", lib(LS_MACRO_LINES.macro4.marrow, ctx), { anatomicalSection: "lumbar spine", level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: "lstv_pseudoarthrosis" })],
    },
    {
      id: "cg-supratransitional",
      label: "Supratransitional disc degeneration",
      group: "Transitional anatomy",
      atoms: (ctx) => [a("disc_contour", lib(LS_MACRO_LINES.macro4.supratransitional, ctx), { level: ctx.level, state: "supratransitional", baselineReplaces: LS_LEVEL_DISC_BASELINE })],
    },
    {
      id: "cg-protected-level",
      label: "Protected transitional level",
      group: "Transitional anatomy",
      advanced: true,
      atoms: (ctx) => [a("canal_stenosis", lib(LS_MACRO_LINES.macro4.transitional, ctx), { level: ctx.level, role: "baseline", baselineReplaces: LS_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "cg-bertolotti",
      label: "Bertolotti syndrome (selected interpretation)",
      group: "Interpretation",
      advanced: true,
      requiresTransitional: true,
      atoms: () => [a("bertolotti_syndrome", LS_MACRO_LINES.macro4.impression[0], { anatomicalSection: "lumbar spine" })],
    },
    {
      id: "cg-spina-bifida",
      label: "Spina bifida occulta",
      group: "Other congenital",
      advanced: true,
      atoms: (ctx) => [a("pars_defect", choice("pars", "spina bifida occulta of the posterior arch", ctx), { level: ctx.level, conflictGroup: "spina_bifida_occulta" })],
    },
    {
      id: "cg-congenital-fusion",
      label: "Congenital fusion / segmentation anomaly",
      group: "Other congenital",
      advanced: true,
      atoms: (ctx) => [a("alignment", choice("alignment", "congenital fusion / segmentation anomaly", ctx), { anatomicalSection: "lumbar spine" })],
    },
  ],
};

// ─── 11. INFLAMMATORY / SACROILIAC ────────────────────────────────────────

const INFLAMMATORY: LumbarSubMaster = {
  id: "inflammatory",
  label: "Inflammatory / Sacroiliac",
  hint: "Visualised SI joints with coverage-aware, cautious wording.",
  tiles: [
    {
      id: "si-normal",
      label: "Normal SI joints",
      group: "Sacroiliac joints",
      atoms: () => [a("sacroiliac_joints", LS_SOFT_TISSUE.siNormal, { anatomicalSection: "lumbar spine", role: "baseline" })],
    },
    {
      id: "si-edema",
      label: "SI marrow oedema",
      group: "Sacroiliac joints",
      requires: ["stir"],
      atoms: (ctx) => [a("sacroiliac_joints", choice("si", "subchondral marrow oedema", ctx), { anatomicalSection: "lumbar spine", laterality: ctx.side ?? "bilateral", supportsLaterality: true, state: "edema" })],
    },
    {
      id: "si-sacroiliitis",
      label: "Active sacroiliitis pattern",
      group: "Sacroiliac joints",
      requires: ["stir"],
      atoms: (ctx) => [a("sacroiliac_joints", lib(LS_SOFT_TISSUE.sacroiliitis, ctx), { anatomicalSection: "lumbar spine", laterality: ctx.side ?? "bilateral", supportsLaterality: true, state: "active" })],
    },
    {
      id: "si-erosions",
      label: "Erosions / sclerosis",
      group: "Sacroiliac joints",
      atoms: (ctx) => [a("sacroiliac_joints", choice("si", "subchondral erosion and sclerosis", ctx), { anatomicalSection: "lumbar spine", laterality: ctx.side ?? "bilateral", conflictGroup: "si_erosions", supportsLaterality: true })],
    },
    {
      id: "si-ankylosis",
      label: "Fusion / ankylosis",
      group: "Sacroiliac joints",
      advanced: true,
      atoms: (ctx) => [a("sacroiliac_joints", choice("si", "joint fusion", ctx), { anatomicalSection: "lumbar spine", laterality: ctx.side ?? "bilateral", conflictGroup: "si_ankylosis", supportsLaterality: true })],
    },
    {
      id: "si-limited-coverage",
      label: "Limited SI coverage caveat",
      group: "Coverage",
      advanced: true,
      atoms: () => [a("screening_limitation", "Sacroiliac joints: limited coverage on a routine lumbar study; the assessment is not a dedicated SI-joint sequence.", { anatomicalSection: "lumbar spine", conflictGroup: "si_coverage", role: "baseline" })],
    },
    {
      id: "si-infection",
      label: "Septic sacroiliitis",
      group: "Sacroiliac joints",
      advanced: true,
      atoms: (ctx) => [a("sacroiliac_joints", choice("si", "peripheral enhancement with adjacent fluid collection", ctx), { anatomicalSection: "lumbar spine", state: "septic", laterality: ctx.side ?? "unilateral" })],
    },
  ],
};

// ─── 12. MORE / ADVANCED ──────────────────────────────────────────────────

const ADVANCED: LumbarSubMaster = {
  id: "advanced",
  label: "More / Advanced",
  hint: "Shared lesion form, numbering controls, epidural detail and caveats.",
  tiles: [
    {
      id: "ad-numbering-basis",
      label: "State the numbering basis",
      group: "Numbering",
      atoms: (ctx) => (numberingAtom(ctx) ? [numberingAtom(ctx)!] : []),
    },
    {
      id: "ad-epidural-lipomatosis",
      label: "Epidural lipomatosis",
      group: "Epidural space",
      atoms: (ctx) => [a("epidural_lipomatosis", choice("epidural", "prominent epidural fat (lipomatosis)", ctx), { level: ctx.level })],
    },
    {
      id: "ad-epidural-mass",
      label: "Epidural mass",
      group: "Epidural space",
      atoms: (ctx) => [a("epidural_space", choice("epidural", "epidural mass", ctx), { level: ctx.level, state: "mass" })],
    },
    {
      id: "ad-thecal-compression",
      label: "Thecal sac compression",
      group: "Epidural space",
      atoms: (ctx) => [a("canal_morphology", choice("canal", "thecal sac compression", ctx), { level: ctx.level })],
    },
    {
      id: "ad-muscle-atrophy",
      label: "Paraspinal muscle atrophy",
      group: "Soft tissue",
      atoms: () => [a("muscle_atrophy", LS_SOFT_TISSUE.muscleAtrophy, { anatomicalSection: "lumbar spine" })],
    },
    {
      id: "ad-syrinx",
      label: "Conus / cord cavity (syrinx)",
      group: "Soft tissue",
      advanced: true,
      atoms: (ctx) => [a("syrinx", choice("cauda", "cord / conus cavity", ctx), { anatomicalSection: "lumbar spine", level: ctx.level })],
    },
    {
      id: "ad-limited-sequence",
      label: "State a sequence limitation",
      group: "Limitations",
      atoms: () => [a("screening_limitation", "This examination did not include the sequence required to assess the stated abnormality.", { anatomicalSection: "lumbar spine", conflictGroup: "sequence_limitation", role: "baseline" })],
    },
  ],
};

export const MRI_LUMBAR_SUB_MASTERS: LumbarSubMaster[] = [
  ROUTINE,
  DEGENERATIVE,
  DISC_NEURAL,
  LISTHESIS,
  TRAUMA,
  INFECTION,
  TUMOR,
  POSTOP,
  CONUS,
  CONGENITAL,
  INFLAMMATORY,
  ADVANCED,
];

export function lumbarSubMasterById(id: LumbarSubMasterId): LumbarSubMaster | null {
  return MRI_LUMBAR_SUB_MASTERS.find((m) => m.id === id) ?? null;
}

const TILE_INDEX = new Map<string, { tile: LumbarTile; subMaster: LumbarSubMasterId }>();
for (const master of MRI_LUMBAR_SUB_MASTERS) {
  for (const tile of master.tiles) TILE_INDEX.set(tile.id, { tile, subMaster: master.id });
}

export function lumbarTileById(id: string): { tile: LumbarTile; subMaster: LumbarSubMasterId } | null {
  return TILE_INDEX.get(id) ?? null;
}

/** Every tile id — used by tests to prove no tile is unreachable. */
export function allLumbarTileIds(): string[] {
  return [...TILE_INDEX.keys()];
}

export type LumbarTileGate = {
  available: boolean;
  missing: SpineSequenceKey[];
  reason?: "sequence" | "localizer" | "numbering";
  notice?: string;
};

/**
 * A tile is offered only when the study can support it. Unavailable tiles are
 * shown struck-through with the reason, never silently dropped (spec §35/§42).
 */
export function lumbarTileAvailability(tile: LumbarTile, ctx: LumbarTileContext): LumbarTileGate {
  const missing: SpineSequenceKey[] = [];
  if (tile.requires?.length && !spineSequencesAllow(ctx.sequences, tile.requires)) {
    missing.push(...tile.requires.filter((k) => !ctx.sequences[k]));
    return { available: false, missing, reason: "sequence", notice: `Requires ${missing.join(" + ")}.` };
  }
  if (tile.requiresLocalizer && !ctx.sequences.wholeSpineLocalizer) {
    return { available: false, missing: ["wholeSpineLocalizer"], reason: "localizer", notice: "Requires whole-spine / localizer coverage." };
  }
  if (tile.requiresTransitional && ctx.numbering.mode === "standard") {
    return { available: false, missing: [], reason: "numbering", notice: "Available only when transitional anatomy is recorded." };
  }
  return { available: true, missing: [] };
}

export function buildLumbarTileBundle(
  tileId: string,
  ctx: LumbarTileContext,
): { bundleId: string; observations: PendingPathologyPatch[] } {
  const found = lumbarTileById(tileId);
  if (!found) return { bundleId: spineBundleId("ls-tile", tileId), observations: [] };
  const atoms = found.tile.atoms(ctx);
  const bundleId = spineBundleId("ls-tile", `${tileId}${ctx.level ? `-${ctx.level.replace(/\s+/g, "")}` : ""}`);
  return { bundleId, observations: spineAtomsToPatches(ctx.region ?? "LS Spine", bundleId, atoms) };
}

// ─── Starting presets (spec §36) ──────────────────────────────────────────

export type LumbarPreset = {
  id: string;
  label: string;
  hint: string;
  subMasters: LumbarSubMasterId[];
  /** CRITICAL presets are flagged so the existing critical workflow can react. */
  critical?: boolean;
  atoms: (ctx: LumbarTileContext) => SpineAtomSpec[];
};

const presetAtom = a;

export const LUMBAR_PRESETS: LumbarPreset[] = [
  {
    id: "preset-normal-ls",
    label: "Normal MRI Lumbar Spine",
    hint: "Protocol-aware normal baseline. Conus level must be confirmed.",
    subMasters: ["routine"],
    atoms: (ctx) => [
      presetAtom("alignment", lib(LS_ALIGN.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      presetAtom("compression_fracture", lib(LS_BONE.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      presetAtom("disc_contour", lib(LS_DISC.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline", baselineReplaces: LS_LEVEL_DISC_BASELINE }),
      presetAtom("canal_stenosis", lib(LS_CANAL.normal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine", role: "baseline", baselineReplaces: LS_LEVEL_CANAL_BASELINE }),
      presetAtom("cauda_equina", lib(LS_CANAL.caudaNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      presetAtom("foraminal_stenosis", lib(LS_FORAMEN.normal, ctx), { anatomicalSection: "lumbar spine", role: "baseline", baselineReplaces: LS_LEVEL_FORAMINAL_BASELINE }),
      presetAtom("facet_joint", lib(LS_POSTERIOR.facetNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      presetAtom("ligamentum_flavum", lib(LS_POSTERIOR.lfNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
      presetAtom("muscle_atrophy", lib(LS_SOFT_TISSUE.normal, ctx), { anatomicalSection: "lumbar spine", conflictGroup: "paraspinal", role: "baseline" }),
      presetAtom("sacroiliac_joints", lib(LS_SOFT_TISSUE.siNormal, ctx), { anatomicalSection: "lumbar spine", role: "baseline" }),
    ].filter(Boolean),
  },
  {
    id: "preset-degenerative-stenosis",
    label: "Degenerative Lumbar Spondylosis with Canal & Foraminal Stenosis",
    hint: "Library macro 1 — multilevel degenerative change with canal and foraminal stenosis.",
    subMasters: ["degenerative", "discNeural"],
    atoms: (ctx) => [
      presetAtom("alignment", LS_MACRO_LINES.macro1.alignment, { anatomicalSection: "lumbar spine", impression: "", baselineReplaces: LS_ALIGN.normal }),
      presetAtom("endplate", LS_MACRO_LINES.macro1.marrow, { level: "L4-L5", state: "modic2", baselineReplaces: LS_BONE.normal }),
      presetAtom("disc_signal", LS_MACRO_LINES.macro1.discs, { level: "L4-L5", conflictGroup: "disc_signal" }),
      presetAtom("canal_stenosis", LS_MACRO_LINES.macro1.l4l5, { level: "L4-L5", severity: "moderate", baselineReplaces: LS_LEVEL_CANAL_BASELINE }),
      presetAtom("foraminal_stenosis", LS_MACRO_LINES.macro1.l5s1, { level: "L5-S1", severity: "severe", laterality: "right", supportsLaterality: true, baselineReplaces: LS_LEVEL_FORAMINAL_BASELINE }),
      presetAtom("conus_medullaris", LS_MACRO_LINES.macro1.conus, { anatomicalSection: "lumbar spine" }),
      presetAtom("alignment", LS_LIBRARY_IMPRESSION(macroImpressionLines("macro1")), { anatomicalSection: "lumbar spine", conflictGroup: "impression_lines", role: "impression" }),
    ],
  },
  {
    id: "preset-acute-extrusion",
    label: "Acute Focal Disc Extrusion with Nerve Root Compression",
    hint: "Library macro 2 — focal extrusion with migration and root compression.",
    subMasters: ["discNeural"],
    atoms: (ctx) => [
      presetAtom("alignment", LS_MACRO_LINES.macro2.alignment, { anatomicalSection: "lumbar spine" }),
      presetAtom("compression_fracture", LS_MACRO_LINES.macro2.marrow, { anatomicalSection: "lumbar spine" }),
      presetAtom("disc_contour", LS_MACRO_LINES.macro2.l5s1, { level: "L5-S1", state: "extrusion", severity: "severe", laterality: "right", supportsLaterality: true, baselineReplaces: LS_LEVEL_DISC_BASELINE }),
      presetAtom("lateral_recess_stenosis", choice("recess", "disc material extending into the right lateral recess", ctx), { level: "L5-S1", laterality: "right", supportsLaterality: true }),
      presetAtom("root_traversing", choice("recess", "descending right S1 root compression", ctx), {
        level: "L5-S1",
        state: "compression",
        severity: "severe",
        conflictGroup: "root-trav-S1-L5-S1",
        impression: "L5-S1: descending right S1 nerve root compression.",
      }),
      presetAtom("conus_medullaris", LS_MACRO_LINES.macro2.conus, { anatomicalSection: "lumbar spine" }),
    ],
  },
  {
    id: "preset-isthmic-spondylolisthesis",
    label: "Isthmic Spondylolisthesis with Foraminal Impingement",
    hint: "Library macro 3 — pars-related slip with bilateral foraminal stenosis.",
    subMasters: ["listhesis", "discNeural"],
    atoms: (ctx) => [
      presetAtom("spondylolisthesis", LS_MACRO_LINES.macro3.alignment, { level: "L5-S1", state: "isthmic" }),
      presetAtom("pars_defect", LS_MACRO_LINES.macro3.marrow, { level: "L5-S1", laterality: "bilateral", supportsLaterality: true }),
      presetAtom("disc_uncapping", LS_MACRO_LINES.macro3.discs, { level: "L5-S1" }),
      presetAtom("foraminal_stenosis", LS_MACRO_LINES.macro3.l5s1, { level: "L5-S1", severity: "severe", laterality: "bilateral", supportsLaterality: true }),
      presetAtom("canal_morphology", LS_MACRO_LINES.macro3.l5s1Tail, { level: "L5-S1" }),
    ],
  },
  {
    id: "preset-lstv-supratransitional",
    label: "LSTV with Supratransitional Disc Degeneration",
    hint: "Library macro 4 — transitional anatomy, numbering caution and the level above it.",
    subMasters: ["congenital", "degenerative"],
    atoms: (ctx) => [
      presetAtom("transitional_vertebra", LS_MACRO_LINES.macro4.alignment, { anatomicalSection: "lumbar spine" }),
      numberingAtom(ctx) ?? presetAtom("transitional_vertebra", LS_ALIGN.lstv, { anatomicalSection: "lumbar spine", conflictGroup: "numbering_caution" }),
      presetAtom("marrow_edema", LS_MACRO_LINES.macro4.marrow, { level: "L5-S1", conflictGroup: "lstv_pseudoarthrosis", laterality: "left", supportsLaterality: true }),
      presetAtom("disc_signal", LS_MACRO_LINES.macro4.discs, { level: "L5-S1", conflictGroup: "disc_signal" }),
      presetAtom("disc_contour", LS_MACRO_LINES.macro4.supratransitional, { level: "L4-L5", baselineReplaces: LS_LEVEL_DISC_BASELINE }),
      presetAtom("canal_stenosis", LS_MACRO_LINES.macro4.transitional, { level: "L5-S1", role: "baseline", baselineReplaces: LS_LEVEL_CANAL_BASELINE }),
    ],
  },
  {
    id: "preset-postop-recurrent-vs-fibrosis",
    label: "Post-operative Lumbar Spine — Recurrent Disc vs Epidural Fibrosis",
    hint: "Library macro 5. Contrast-dependent statements are gated.",
    subMasters: ["postop", "discNeural"],
    atoms: (ctx) => [
      presetAtom("alignment", LS_MACRO_LINES.macro5.alignment, { anatomicalSection: "lumbar spine" }),
      presetAtom("hardware_postop", LS_MACRO_LINES.macro5.marrow, { level: "L5-S1", state: "hemilaminectomy", laterality: "right" }),
      presetAtom("disc_height", LS_MACRO_LINES.macro5.discs, { level: "L5-S1", conflictGroup: "disc_height", baselineReplaces: LS_LEVEL_HEIGHT_BASELINE }),
      presetAtom("epidural_space", LS_MACRO_LINES.macro5.l5s1, { level: "L5-S1", conflictGroup: "epidural_space", laterality: "right", supportsLaterality: true }),
      ...(ctx.sequences.contrast
        ? [
          presetAtom("disc_contour", LS_MACRO_LINES.macro5.recurrentDisc, { level: "L5-S1", state: "recurrent", baselineReplaces: LS_LEVEL_DISC_BASELINE }),
          presetAtom("epidural_space", LS_MACRO_LINES.macro5.fibrosis, { level: "L5-S1", conflictGroup: "epidural_fibrosis", state: "fibrosis" }),
        ]
        : [
          presetAtom("screening_limitation", "This examination did not include contrast, so recurrent disc material cannot be separated from epidural fibrosis.", {
            level: "L5-S1",
            conflictGroup: "contrast_limitation",
            role: "baseline",
          }),
        ]),
    ],
  },
  {
    id: "preset-acute-compression-fracture",
    label: "Acute Compression Fracture",
    hint: "Requires a fluid-sensitive sequence for the oedema claim.",
    subMasters: ["trauma"],
    atoms: (ctx) => [
      presetAtom("compression_fracture", ctx.sequences.stir
        ? LS_BONE.acuteFracture
        : LS_BONE.chronicFracture, { level: ctx.vertebra ?? "L1", state: ctx.sequences.stir ? "acute" : "chronic" }),
    ],
  },
  {
    id: "preset-severe-canal-stenosis",
    label: "Severe Lumbar Canal Stenosis",
    hint: "Severe stenosis with cauda equina crowding at one level.",
    subMasters: ["degenerative", "conusCauda"],
    atoms: (ctx) => [
      presetAtom("canal_stenosis", lib(LS_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe", baselineReplaces: LS_LEVEL_CANAL_BASELINE }),
      presetAtom("cauda_equina", choice("cauda", "cauda equina crowding", ctx), { level: ctx.level, state: "crowding" }),
    ],
  },
  {
    id: "preset-spondylodiscitis",
    label: "Spondylodiscitis with Epidural / Paraspinal Collection",
    hint: "Disc / endplate infection with collection and neural effect.",
    subMasters: ["infection"],
    atoms: (ctx) => [
      presetAtom("spondylodiscitis", lib(LS_DISC.discitis, ctx), { level: ctx.level, severity: "significant" }),
      presetAtom("epidural_collection", choice("epidural", "epidural collection", ctx), { level: ctx.level, state: "abscess" }),
      presetAtom("paravertebral_collection", choice("soft", "paraspinal fluid collection", ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true }),
    ],
  },
  {
    id: "preset-tethered-cord",
    label: "Tethered Cord / Low-Lying Conus",
    hint: "Conus level must be stated by the reporting radiologist.",
    subMasters: ["conusCauda", "congenital"],
    atoms: (ctx) => [
      presetAtom("tethered_cord", lib(LS_CANAL.tetheredCord, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "lumbar spine" }),
      presetAtom("filum_terminale", choice("conus", "thickened filum terminale", ctx), { anatomicalSection: "lumbar spine" }),
    ],
  },
  {
    id: "preset-cauda-equina-syndrome",
    label: "Acute Cauda Equina Syndrome",
    hint: "CRITICAL starting point — the critical-result workflow still needs the radiologist.",
    subMasters: ["conusCauda", "discNeural"],
    critical: true,
    atoms: (ctx) => [
      presetAtom("canal_stenosis", lib(LS_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe", impression: `${ctx.level}: severe canal stenosis with cauda equina compression.` }),
      presetAtom("cauda_equina", choice("cauda", "cauda equina compression", ctx), { level: ctx.level, state: "compression", impression: "Cauda equina compression — correlate clinically for cauda equina syndrome." }),
    ],
  },
  {
    id: "preset-modic-discitis",
    label: "Modic Changes with Discitis / Spondylodiscitis",
    hint: "Endplate change with infection pattern; contrast claims stay gated.",
    subMasters: ["degenerative", "infection"],
    atoms: (ctx) => [
      presetAtom("endplate", lib(LS_BONE.modic1, ctx), { level: ctx.level, severity: "modic1", baselineReplaces: LS_LEVEL_ENDPLATE_BASELINE }),
      presetAtom("spondylodiscitis", lib(LS_DISC.discitis, ctx), { level: ctx.level }),
    ],
  },
];

function macroImpressionLines(macro: keyof typeof LS_MACRO_LINES): string[] {
  return [...(LS_MACRO_LINES[macro].impression as readonly string[])];
}

/** Preset impressions are joined as numbered lines, keeping library wording. */
function LS_LIBRARY_IMPRESSION(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join(" ");
}

export function lumbarPresetById(id: string): LumbarPreset | null {
  return LUMBAR_PRESETS.find((p) => p.id === id) ?? null;
}

export function buildLumbarPresetBundle(
  presetId: string,
  ctx: LumbarTileContext,
): { bundleId: string; observations: PendingPathologyPatch[]; critical: boolean } {
  const preset = lumbarPresetById(presetId);
  if (!preset) {
    return { bundleId: spineBundleId("ls-preset", presetId), observations: [], critical: false };
  }
  const bundleId = spineBundleId("ls-preset", `${presetId}${ctx.level ? `-${ctx.level.replace(/\s+/g, "")}` : ""}`);
  const atoms = preset.atoms(ctx).filter((atom) => atom.findings.trim().length > 0);
  return {
    bundleId,
    observations: spineAtomsToPatches(ctx.region ?? "LS Spine", bundleId, atoms),
    critical: preset.critical === true,
  };
}

/** Level detail and tile bundles share one entry point for the canvas. */
export function buildLumbarLevelBundle(opts: {
  level: string;
  detail: LumbarLevelDetail;
  numbering: LumbarNumberingState;
  sequences: SpineSequencesAvailable;
  region?: string;
}): { bundleId: string; observations: PendingPathologyPatch[]; structuredChoiceCount: number } {
  const built = buildLumbarLevelDetailBundle(opts);
  return {
    bundleId: built.bundleId,
    observations: spineAtomsToPatches(opts.region ?? "LS Spine", built.bundleId, built.atoms),
    structuredChoiceCount: built.structuredChoiceCount,
  };
}

// ─── Shared lesion / collection characterization (spec §21) ───────────────

export type LumbarLesionCompartment =
  | "epidural"
  | "intradural"
  | "vertebral"
  | "paraspinal"
  | "psoas"
  | "facet"
  | "postop_collection";

export type LumbarLesionInput = {
  compartment: LumbarLesionCompartment;
  level: string;
  laterality?: LsSide;
  apMm?: number;
  transverseMm?: number;
  craniocaudalMm?: number;
  cmAP?: number;
  cmTransverse?: number;
  enhancement?: "none" | "rim" | "diffuse" | "intense";
  canalEffect?: boolean;
  neuralEffect?: boolean;
  label?: string;
};

const LESION_CONCEPT: Record<LumbarLesionCompartment, string> = {
  epidural: "epidural_collection",
  intradural: "epidural_space",
  vertebral: "bone_lesion",
  paraspinal: "paravertebral_collection",
  psoas: "paravertebral_collection",
  facet: "synovial_cyst",
  postop_collection: "epidural_collection",
};

const LESION_LIBRARY: Partial<Record<LumbarLesionCompartment, string>> = {
  facet: LS_POSTERIOR.synovialCyst,
  psoas: LS_SOFT_TISSUE.psoasAbscess,
  postop_collection: LS_POSTOP.pseudomeningocele,
  vertebral: LS_BONE.hemangioma,
};

function dimensionsPhrase(input: LumbarLesionInput): string {
  const mm = [input.apMm, input.transverseMm, input.craniocaudalMm].filter((n) => n != null && Number.isFinite(n));
  const cm = [input.cmAP, input.cmTransverse].filter((n) => n != null && Number.isFinite(n));
  if (cm.length > 0) return ` measuring ${cm.join(" x ")} cm`;
  if (mm.length > 0) return ` measuring ${mm.join(" x ")} mm`;
  return "";
}

/**
 * ONE lesion form reused by the tumor, infection, post-operative and conus /
 * cauda palettes. Prose comes from the library sentence for that compartment
 * when one exists; otherwise it is the radiologist's own structured choice.
 */
export function buildLumbarLesionAtoms(
  input: LumbarLesionInput,
  ctx: LumbarTileContext,
): SpineAtomSpec[] {
  const concept = LESION_CONCEPT[input.compartment];
  const template = LESION_LIBRARY[input.compartment];
  const base = template
    ? fillLsProse(template, {
      level: input.level,
      side: input.laterality,
      mm: input.apMm,
      cm: input.cmAP,
      cm2: input.cmTransverse,
      vertebra: input.level.split("-")[0],
    }).text
    : `${SECTION_FRAMES[input.compartment === "postop_collection" ? "epidural" : input.compartment === "intradural" ? "cauda" : input.compartment]}: ${input.label ?? "focal lesion"} at ${input.level}${dimensionsPhrase(input)}.`;

  const atoms: SpineAtomSpec[] = [
    {
      concept,
      conflictGroup: `lesion-${input.compartment}-${input.level.replace(/\s+/g, "")}`,
      anatomicalSection: input.level,
      findings: base,
      level: input.level,
      laterality: input.laterality,
      supportsLaterality: Boolean(input.laterality),
      measurement: input.apMm != null ? String(input.apMm) : undefined,
      state: input.enhancement ? `enhancement:${input.enhancement}` : "",
    },
  ];
  if (input.canalEffect) {
    atoms.push({
      concept: "canal_stenosis",
      conflictGroup: `lesion-canal-${input.level.replace(/\s+/g, "")}`,
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.canal}: canal compromise at ${input.level}.`,
      level: input.level,
      severity: "moderate",
      role: ctx.sequences ? "finding" : "finding",
    });
  }
  if (input.neuralEffect) {
    atoms.push({
      concept: "root_traversing",
      conflictGroup: `root-trav-${ctx.root ?? ""}-${input.level.replace(/\s+/g, "")}`,
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.recess}: nerve root compression at ${input.level}.`,
      level: input.level,
      state: "compression",
      severity: "severe",
    });
  }
  return atoms;
}

export function buildLumbarLesionBundle(
  input: LumbarLesionInput,
  ctx: LumbarTileContext,
): { bundleId: string; observations: PendingPathologyPatch[] } {
  const bundleId = spineBundleId("ls-lesion", `${input.compartment}-${input.level.replace(/\s+/g, "")}`);
  return {
    bundleId,
    observations: spineAtomsToPatches(ctx.region ?? "LS Spine", bundleId, buildLumbarLesionAtoms(input, ctx)),
  };
}
