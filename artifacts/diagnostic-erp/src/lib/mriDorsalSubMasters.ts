/**
 * mriDorsalSubMasters.ts — MRI Dorsal / Thoracic Spine clinical sub-masters
 * (dorsal spec §2-§24).
 *
 * Fourteen progressive-disclosure palettes over ONE dorsal observation model.
 * They are not fourteen editors: every tile and every preset compiles to ledger
 * atoms applied through the existing `applyMacroBundle` / `removeMacroBundle` /
 * clinical-undo machinery, exactly like the shipped lumbar palettes and the
 * existing dorsal level rows. Palette state never erases observations.
 *
 * Rules encoded here:
 *  - seeded prose is verbatim from `mriDorsalLibrary.ts` (the canonical clinical
 *    library). Where the library has no sentence the tile renders the
 *    radiologist's structured choice as "<Section>: <label>" and is marked
 *    `structured-choice`; nothing in this file invents clinical wording;
 *  - thoracic anatomy is first-class (kyphosis, rib-bearing vertebrae,
 *    costovertebral region, OLF/OPLL/DISH, cord, intradural compartment,
 *    thoracolumbar junction). Cervical uncovertebral terminology and the lumbar
 *    traversing-root / lateral-recess / pars engine are deliberately absent
 *    (spec §OBJECTIVE, §13, §41);
 *  - tiles are gated by acquisition (STIR/DWI/contrast/axial/localizer) AND by
 *    acquired coverage: nothing may claim the conus or the thoracolumbar
 *    junction when the study stops at T10 (spec §4, §12, §25);
 *  - abnormal atoms carry the normal sentence they supersede (`baselineReplaces`)
 *    so a normal baseline reconciles instead of contradicting (spec §5);
 *  - observation vs interpretation vs diagnosis stay separate. Tuberculosis,
 *    metastasis, dAVF, DISH, OLF, OPLL, myelomalacia, mechanical instability and
 *    tumour type exist only as tiles the radiologist selects explicitly; the
 *    pattern tiles beneath them never promote themselves (spec §15-§20, §36).
 *
 * Pure data + functions only — no React, no store instance.
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  DX_ALIGN,
  DX_BONE,
  DX_CANAL,
  DX_DISC,
  DX_MACRO_LINES,
  DX_POSTERIOR,
  DX_SOFT,
  fillDxProse,
  type DxProseVars,
} from "./mriDorsalLibrary";
import { spineAtomsToPatches, spineBundleId, type SpineAtomSpec } from "./mriSpineAtoms";
import {
  conusCovered,
  dorsalNumberingCautionSentence,
  junctionCovered,
  type DorsalNumberingState,
} from "./mriDorsalNumbering";
import {
  spineLimitationSentence,
  spineSequencesAllow,
  type SpineSequenceKey,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import {
  buildDorsalLevelDetailBundle,
  type DorsalLevelDetail,
} from "./mriDorsalLevelDetail";
import { withDorsalBaselineContract } from "./mriDorsalBaselines";
import {
  DORSAL_LEVEL_CANAL_BASELINE,
  DORSAL_LEVEL_CORD_BASELINE,
  DORSAL_LEVEL_DISC_BASELINE,
  DORSAL_LEVEL_FORAMINAL_BASELINE,
  DORSAL_LEVEL_VERTEBRAL_BASELINE,
} from "./mriDorsalLevelState";

export const DORSAL_SUBMASTER_IDS = [
  "routine",
  "degenerative",
  "canalCord",
  "oplOlfDish",
  "trauma",
  "infection",
  "tumorMarrow",
  "intradural",
  "vascular",
  "postop",
  "deformity",
  "congenital",
  "junction",
  "advanced",
] as const;

export type DorsalSubMasterId = (typeof DORSAL_SUBMASTER_IDS)[number];

export type DorsalSide = "left" | "right" | "bilateral";

export type DorsalTileContext = {
  /** Resolver-derived level key (T1-T2 … T12-L1). */
  level: string;
  numbering: DorsalNumberingState;
  sequences: SpineSequencesAvailable;
  region?: string;
  side?: DorsalSide;
  root?: string;
  mm?: number;
  mm2?: number;
  cm?: number;
  cm2?: number;
  cm3?: number;
  pct?: number;
  conusLevel?: string;
  vertebra?: string;
  /** Second level for extent sentences ("T4 through T7"). */
  level2?: string;
  direction?: "superiorly" | "inferiorly" | "superior" | "inferior";
  /** Word selection inside a library `[with / without]` group. */
  choice?: "with" | "without";
  label?: string;
};

export type DorsalTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind an explicit "advanced" disclosure inside the palette. */
  advanced?: boolean;
  /** Acquisitions this tile needs before it may be offered (spec §25). */
  requires?: SpineSequenceKey[];
  /** Never offered without whole-spine / localizer coverage. */
  requiresLocalizer?: boolean;
  /** Context-dependent coverage requirement (numbering basis). */
  requiresLocalizerIf?: (ctx: DorsalTileContext) => boolean;
  /** Names the thoracolumbar junction / conus: needs junction coverage (§12). */
  requiresJunction?: boolean;
  /** Needs a second level (craniocaudal extent) before it can be written. */
  requiresExtent?: boolean;
  atoms: (ctx: DorsalTileContext) => SpineAtomSpec[];
};

export type DorsalSubMaster = {
  id: DorsalSubMasterId;
  label: string;
  hint: string;
  tiles: DorsalTile[];
};

type AtomExtras = Partial<Omit<SpineAtomSpec, "concept" | "findings">>;

/** Canonical-library sentence for this tile, with variables substituted. */
function lib(template: string, ctx: DorsalTileContext, overrides: DxProseVars = {}) {
  const vars: DxProseVars = {
    level: ctx.level,
    level2: ctx.level2,
    side: ctx.side,
    root: ctx.root,
    mm: ctx.mm,
    mm2: ctx.mm2,
    cm: ctx.cm,
    cm2: ctx.cm2,
    cm3: ctx.cm3,
    pct: ctx.pct,
    conusLevel: ctx.conusLevel,
    vertebra: ctx.vertebra,
    direction: ctx.direction,
    choice: ctx.choice,
    ...overrides,
  };
  return fillDxProse(template, vars).text;
}

const SECTION_FRAMES: Record<string, string> = {
  alignment: "Alignment",
  kyphosis: "Thoracic curvature",
  deformity: "Deformity",
  marrow: "Bones / marrow",
  endplate: "Endplates",
  discs: "Discs",
  canal: "Central canal",
  csf: "CSF space",
  cord: "Spinal cord",
  conus: "Conus medullaris",
  foramina: "Neural foramina",
  costovertebral: "Costovertebral region",
  posterior: "Posterior elements",
  ligaments: "Ligaments",
  epidural: "Epidural space",
  intradural: "Intradural space",
  intramedullary: "Cord parenchyma",
  vascular: "Perimedullary vessels",
  soft: "Paravertebral soft tissues",
  junction: "Thoracolumbar junction",
  hardware: "Hardware",
  numbering: "Vertebral numbering",
  coverage: "Coverage",
};

/** The radiologist's structured choice, rendered without invented clinical prose. */
function choice(section: keyof typeof SECTION_FRAMES, label: string, ctx: DorsalTileContext) {
  return `${SECTION_FRAMES[section] ?? section}: ${label}${ctx.level ? ` at ${ctx.level}` : ""}.`;
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
 * `anatomicalSection` is the level for level-bound findings and "dorsal spine"
 * for global ones, matching how the existing dorsal level rows own their rows.
 */
function ctxSection(concept: string, level?: string): string {
  if (level) return level;
  const global = new Set([
    "alignment",
    "thoracic_kyphosis",
    "gibbus_deformity",
    "scoliosis",
    "cord_compression",
    "cord_signal",
    "cord_caliber",
    "conus_medullaris",
    "syrinx",
    "dish",
    "ankylosing_pattern",
    "visualized_pleura",
    "visualized_thoracic_aorta",
    "hardware_postop",
    "screening_limitation",
    "screening_recommendation",
    "transitional_vertebra",
  ]);
  return global.has(concept) ? "dorsal spine" : (level ?? "dorsal spine");
}

/** Coverage / numbering basis is a safety statement, not a clinical finding. */
export function dorsalNumberingAtom(ctx: DorsalTileContext): SpineAtomSpec | null {
  const caution = dorsalNumberingCautionSentence(ctx.numbering);
  if (!caution) return null;
  return {
    concept: "screening_limitation",
    conflictGroup: "dorsal_numbering_caution",
    anatomicalSection: "dorsal spine",
    findings: caution,
    role: "baseline",
  };
}

/** Normal sentence for a structure, only when the acquisition supports it. */
function baseline(concept: string, findings: string, extra?: AtomExtras): SpineAtomSpec {
  return a(concept, findings, { role: "baseline", ...extra });
}

// ─── 1. ROUTINE / NORMAL ──────────────────────────────────────────────────

const ROUTINE: DorsalSubMaster = {
  id: "routine",
  label: "Routine / Normal",
  hint: "Protocol- and coverage-aware normal baseline for the dorsal spine.",
  tiles: [
    {
      id: "dr-alignment-normal",
      label: "Normal thoracic kyphosis / alignment",
      group: "Baseline",
      atoms: (ctx) => [baseline("alignment", lib(DX_ALIGN.normal, ctx), { anatomicalSection: "dorsal spine" })],
    },
    {
      id: "dr-bone-normal",
      label: "Normal vertebral bodies / marrow",
      group: "Baseline",
      atoms: (ctx) => [baseline("compression_fracture", lib(DX_BONE.normal, ctx), { anatomicalSection: "dorsal spine" })],
    },
    {
      id: "dr-no-focal-lesion",
      label: "No fracture or focal marrow lesion",
      group: "Baseline",
      atoms: (ctx) => [baseline("bone_lesion", lib(DX_BONE.noFocalLesion, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "marrow_screen" })],
    },
    {
      id: "dr-disc-normal",
      label: "Normal discs",
      group: "Baseline",
      atoms: (ctx) => [baseline("disc_contour", lib(DX_DISC.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dr-no-herniation",
      label: "No herniation, cord flattening or foraminal compromise",
      group: "Baseline",
      atoms: (ctx) => [baseline("disc_contour", lib(DX_DISC.noHerniation, ctx), { anatomicalSection: "dorsal spine", level: undefined, conflictGroup: "disc_screen" })],
    },
    {
      id: "dr-canal-normal",
      label: "Patent central canal",
      group: "Baseline",
      atoms: (ctx) => [baseline("canal_stenosis", lib(DX_CANAL.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "dr-cord-normal",
      label: "Normal cord caliber and signal",
      group: "Baseline",
      // The library's thoracic cord normal sentence assesses the conus as well,
      // so it is only supportable when the conus was acquired (§12).
      requiresJunction: true,
      atoms: (ctx) => [
        baseline("cord_caliber", lib(DX_CANAL.cordNormal, ctx), { anatomicalSection: ctx.level, level: ctx.level, baselineReplaces: DORSAL_LEVEL_CORD_BASELINE }),
      ],
    },
    {
      id: "dr-foraminal-normal",
      label: "Patent foramina and costovertebral joints",
      group: "Baseline",
      requires: ["axial"],
      atoms: (ctx) => [baseline("foraminal_stenosis", lib(DX_POSTERIOR.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE })],
    },
    {
      id: "dr-posterior-normal",
      label: "Posterior elements intact",
      group: "Baseline",
      atoms: (ctx) => [baseline("posterior_elements", lib(DX_POSTERIOR.posteriorElementsIntact, ctx), { anatomicalSection: ctx.level, level: ctx.level, baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "dr-soft-normal",
      label: "Paravertebral / visualized soft tissues unremarkable",
      group: "Baseline",
      atoms: (ctx) => [baseline("paravertebral_collection", lib(DX_SOFT.normal, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "paravertebral", state: "normal" })],
    },
    {
      id: "dr-conus-normal",
      label: "Normal conus termination (only when covered)",
      group: "Baseline",
      requiresJunction: true,
      atoms: (ctx) => [baseline("conus_medullaris", lib(DX_CANAL.conusTerminates, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "dorsal spine" })],
    },
    {
      id: "dr-numbering-basis",
      label: "State the numbering / coverage basis",
      group: "Baseline",
      atoms: (ctx) => {
        const atom = dorsalNumberingAtom(ctx);
        return atom ? [atom] : [];
      },
    },
    {
      id: "dr-limited-coverage",
      label: "Coverage-limited assessment statement",
      group: "Baseline",
      atoms: (ctx) => {
        const absent: SpineSequenceKey[] = [];
        if (!ctx.sequences.axial) absent.push("axial");
        if (!ctx.sequences.stir) absent.push("stir");
        if (absent.length === 0) {
          return [baseline("screening_limitation", `This examination covers the dorsal spine to ${ctx.level ? `${ctx.level} at most` : "the acquired levels"}; structures outside the acquired field of view were not assessed.`, { anatomicalSection: "dorsal spine", conflictGroup: "coverage_limitation" })];
        }
        return [baseline("screening_limitation", spineLimitationSentence(absent, "the corresponding abnormality"), { anatomicalSection: "dorsal spine", conflictGroup: "coverage_limitation" })];
      },
    },
  ],
};

// ─── 2. DEGENERATIVE / DISC ───────────────────────────────────────────────

const DEGENERATIVE: DorsalSubMaster = {
  id: "degenerative",
  label: "Degenerative / Disc",
  hint: "Thoracic disc disease, desiccation and disc-osteophyte complex.",
  tiles: [
    {
      id: "dd-desiccation",
      label: "Multilevel disc desiccation / height loss",
      group: "Discs",
      atoms: (ctx) => [a("disc_signal", lib(DX_DISC.desiccation, ctx), { level: ctx.level, conflictGroup: "disc_signal", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dd-central-protrusion",
      label: "Central disc protrusion",
      group: "Discs",
      atoms: (ctx) => [a("disc_contour", lib(DX_DISC.centralProtrusion, ctx), { level: ctx.level, state: "protrusion", severity: "moderate", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dd-calcified-herniation",
      label: "Calcified disc herniation with cord flattening",
      group: "Discs",
      atoms: (ctx) => [
        a("disc_contour", lib(DX_DISC.calcifiedHerniation, ctx), { level: ctx.level, state: "herniation_calcified", severity: "severe", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        a("canal_morphology", choice("csf", "focal CSF space effacement", ctx), { level: ctx.level, conflictGroup: "canal_morphology" }),
        a("cord_caliber", choice("cord", "ventral cord flattening", ctx), { level: ctx.level, state: "flattening", conflictGroup: "cord_caliber" }),
      ],
    },
    {
      id: "dd-paracentral-extrusion",
      label: "Paracentral disc extrusion with cord displacement",
      group: "Discs",
      atoms: (ctx) => [
        a("disc_contour", lib(DX_DISC.paracentralExtrusion, ctx), { level: ctx.level, state: "extrusion", severity: "severe", laterality: "right", supportsLaterality: true, baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        a("disc_migration", choice("discs", `${ctx.direction ?? "cranio-caudal"} extension of disc material`, ctx), { level: ctx.level, conflictGroup: "disc_migration" }),
        a("cord_caliber", choice("cord", "displacement of the descending thoracic cord", ctx), { level: ctx.level, state: "displacement", conflictGroup: "cord_caliber" }),
      ],
    },
    {
      id: "dd-extraforaminal",
      label: "Far lateral / extraforaminal disc",
      group: "Discs",
      requires: ["axial"],
      requiresJunction: true,
      atoms: (ctx) => [
        a("disc_contour", lib(DX_DISC.extraforaminal, ctx), { level: ctx.level, state: "extraforaminal", laterality: ctx.side ?? "right", supportsLaterality: true, baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        a("root_contact", choice("foramina", `compression of the exiting ${ctx.root ?? "T12"} nerve root`, ctx), { level: ctx.level, state: "compression", conflictGroup: `root-exit-${ctx.root ?? "T12"}-${ctx.level.replace(/\s+/g, "")}` }),
      ],
    },
    {
      id: "dd-disc-osteophyte",
      label: "Disc-osteophyte complex",
      group: "Discs",
      atoms: (ctx) => [
        a("disc_contour", choice("discs", "disc-osteophyte complex indenting the ventral thecal sac", ctx), { level: ctx.level, state: "protrusion", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        a("osteophytes", choice("posterior", "marginal osteophytes at this level", ctx), { level: ctx.level, conflictGroup: "osteophytes" }),
      ],
    },
    {
      id: "dd-thecal-indentation",
      label: "Ventral thecal-sac indentation",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", "ventral thecal-sac indentation", ctx), { level: ctx.level, conflictGroup: "canal_morphology" })],
    },
    {
      id: "dd-csf-effacement",
      label: "CSF space effacement (partial or complete)",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", ctx.choice === "with" ? "complete local CSF space effacement" : "partial CSF space effacement", ctx), { level: ctx.level, conflictGroup: "canal_morphology" })],
    },
    {
      id: "dd-endplate-degenerative",
      label: "Degenerative endplate change",
      group: "Endplates",
      atoms: (ctx) => [a("endplate", choice("endplate", "degenerative endplate change at this level", ctx), { level: ctx.level, conflictGroup: "endplate" })],
    },
    {
      id: "dd-modic1",
      label: "Modic Type I endplate change",
      group: "Endplates",
      requires: ["stir"],
      atoms: (ctx) => [a("endplate", lib(DX_BONE.modic1, ctx), { level: ctx.level, state: "modic1", conflictGroup: "endplate", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "dd-modic2",
      label: "Modic Type II endplate change",
      group: "Endplates",
      atoms: (ctx) => [a("endplate", lib(DX_BONE.modic2, ctx), { level: ctx.level, state: "modic2", conflictGroup: "endplate", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "dd-schmorl",
      label: "Schmorl node",
      group: "Endplates",
      atoms: (ctx) => [a("schmorl_node", lib(DX_BONE.schmorl, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.level, conflictGroup: "schmorl_node" })],
    },
    {
      // The canonical dorsal library holds no sentence for a diffuse bulge, a
      // sequestration, Modic III or focal sclerosis, so these are recorded as the
      // radiologist's own selection rather than as library prose (spec §7, §8).
      id: "dd-diffuse-bulge",
      label: "Diffuse disc bulge",
      group: "Discs",
      atoms: (ctx) => [a("disc_contour", choice("discs", "diffuse disc bulge at this level", ctx), { level: ctx.level, state: "bulge", conflictGroup: "disc_contour", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dd-sequestration",
      label: "Sequestered disc fragment",
      group: "Discs",
      advanced: true,
      atoms: (ctx) => [a("disc_contour", choice("discs", "sequestered disc fragment at this level", ctx), { level: ctx.level, state: "sequestration", conflictGroup: "disc_contour_sequestration", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "dd-modic3",
      label: "Modic Type III endplate change",
      group: "Endplates",
      atoms: (ctx) => [a("endplate", choice("endplate", "Modic type III endplate change at this level", ctx), { level: ctx.level, state: "modic3", conflictGroup: "endplate", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "dd-focal-sclerosis",
      label: "Focal vertebral sclerosis",
      group: "Bones",
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "focal vertebral sclerosis at this level", ctx), { level: ctx.level, conflictGroup: "marrow_sclerosis", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
  ],
};

// ─── 3. CANAL STENOSIS / CORD COMPRESSION ────────────────────────────────

const CANALCORD: DorsalSubMaster = {
  id: "canalCord",
  label: "Canal Stenosis / Cord Compression",
  hint: "Severity, cord morphology and cord signal kept as separate observations.",
  tiles: [
    {
      id: "cc-stenosis-mild",
      label: "Mild canal narrowing",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "mild canal narrowing", ctx), { level: ctx.level, severity: "mild", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "cc-stenosis-moderate",
      label: "Moderate canal narrowing",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "moderate canal narrowing", ctx), { level: ctx.level, severity: "moderate", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "cc-stenosis-severe",
      label: "Severe canal stenosis with cord flattening",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", lib(DX_CANAL.severeStenosis, ctx), { level: ctx.level, severity: "severe", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "cc-csf-partial",
      label: "Partial CSF effacement",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", "partial effacement of the posterior CSF space", ctx), { level: ctx.level, conflictGroup: "canal_morphology" })],
    },
    {
      id: "cc-csf-complete",
      label: "Complete local CSF effacement",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", "complete effacement of the CSF space at this level", ctx), { level: ctx.level, conflictGroup: "canal_morphology" })],
    },
    {
      id: "cc-cord-contact",
      label: "Cord contact (not compression)",
      group: "Cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "contact of the cord without deformation", ctx), { level: ctx.level, state: "contact", conflictGroup: "cord_caliber" })],
    },
    {
      id: "cc-cord-flattening",
      label: "Cord flattening",
      group: "Cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "flattening of the cord", ctx), { level: ctx.level, state: "flattening", conflictGroup: "cord_caliber" })],
    },
    {
      id: "cc-cord-compression",
      label: "Cord compression",
      group: "Cord",
      atoms: (ctx) => [
        a("cord_compression", choice("cord", "thoracic spinal cord compression", ctx), {
          level: ctx.level,
          state: "compression",
          severity: "significant",
          conflictGroup: "cord_compression",
          anatomicalSection: ctx.level,
        }),
      ],
    },
    {
      id: "cc-cord-displacement",
      label: "Cord displacement",
      group: "Cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "displacement of the cord", ctx), { level: ctx.level, state: "displacement", conflictGroup: "cord_caliber" })],
    },
    {
      id: "cc-cord-swelling",
      label: "Focal cord swelling",
      group: "Cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "focal cord swelling", ctx), { level: ctx.level, state: "swelling", conflictGroup: "cord_caliber" })],
    },
    {
      id: "cc-cord-atrophy",
      label: "Focal cord atrophy",
      group: "Cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "focal cord atrophy", ctx), { level: ctx.level, state: "atrophy", conflictGroup: "cord_caliber" })],
    },
    {
      id: "cc-cord-signal",
      label: "Intrinsic T2/STIR cord hyperintensity",
      group: "Cord",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", lib(DX_CANAL.cordSignal, ctx), { level: ctx.level, state: "hyperintensity", conflictGroup: "cord_signal" })],
    },
    {
      id: "cc-cord-signal-longitudinal",
      label: "Longitudinal intramedullary signal abnormality",
      group: "Cord",
      requires: ["t2"],
      requiresExtent: true,
      atoms: (ctx) => [a("cord_signal", choice("cord", `longitudinal intramedullary T2 hyperintensity from ${ctx.level} to ${ctx.level2}`, ctx), { level: ctx.level, state: "longitudinal_hyperintensity", conflictGroup: "cord_signal_longitudinal" })],
    },
    {
      id: "cc-myelomalacia-pattern",
      label: "Myelomalacia-pattern signal (interpretation)",
      group: "Cord / Interpretation",
      advanced: true,
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", lib(DX_CANAL.cordSignal, ctx), { level: ctx.level, state: "myelomalacia_pattern", conflictGroup: "cord_signal_interpretation" })],
    },
    {
      id: "cc-compressive-myelopathy",
      label: "Compressive myelopathy (radiologist-selected)",
      group: "Cord / Interpretation",
      advanced: true,
      requires: ["t2"],
      atoms: (ctx) => [
        a("cord_signal", choice("cord", "compressive myelopathy — selected by the reporting radiologist", ctx), {
          level: ctx.level,
          state: "compressive_myelopathy",
          conflictGroup: "cord_interpretation",
          impression: lib(DX_CANAL.macroCordSignalOedema, ctx),
        }),
      ],
    },
  ],
};

// ─── 4. OPLL / OLF / DISH ────────────────────────────────────────────────

const OPLOLFDISH: DorsalSubMaster = {
  id: "oplOlfDish",
  label: "OPLL / OLF / DISH",
  hint: "Ligament ossification. MRI suggests; CT characterises mineralisation.",
  tiles: [
    {
      id: "oo-olf",
      label: "OLF at this level (selected)",
      group: "OLF",
      atoms: (ctx) => [a("olf", lib(DX_CANAL.olf, ctx), { level: ctx.level, state: "ossification", conflictGroup: "olf" })],
    },
    {
      id: "oo-olf-morphology",
      label: "OLF morphology: nodular / continuous",
      group: "OLF",
      atoms: (ctx) => [a("olf", choice("ligaments", `nodular hypointense posterolateral canal-wall thickening, ${ctx.side ?? "bilateral"}`, ctx), { level: ctx.level, laterality: ctx.side ?? "bilateral", supportsLaterality: true, conflictGroup: "olf_morphology" })],
    },
    {
      id: "oo-olf-canal-effect",
      label: "OLF canal / cord effect",
      group: "OLF",
      atoms: (ctx) => [
        a("canal_stenosis", choice("canal", "severe local canal narrowing from posterolateral ossification", ctx), { level: ctx.level, severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
        a("cord_caliber", choice("cord", "posterior cord compression / flattening", ctx), { level: ctx.level, state: "flattening", conflictGroup: "cord_caliber" }),
      ],
    },
    {
      id: "oo-olf-signal",
      label: "Associated cord signal abnormality",
      group: "OLF",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", choice("cord", "intrinsic cord T2 hyperintensity at the level of OLF", ctx), { level: ctx.level, state: "hyperintensity", conflictGroup: "cord_signal" })],
    },
    {
      id: "oo-lf-hypertrophy-only",
      label: "LF hypertrophy without ossification",
      group: "OLF",
      atoms: (ctx) => [a("ligamentum_flavum", choice("ligaments", "ligamentum flavum hypertrophy", ctx), { level: ctx.level, conflictGroup: "ligamentum_flavum" })],
    },
    {
      id: "oo-opl",
      label: "OPLL over an extent (selected)",
      group: "OPLL",
      requiresExtent: true,
      atoms: (ctx) => [a("ossification_posterior_longitudinal", lib(DX_CANAL.opll, ctx), { level: ctx.level, state: "ossification", conflictGroup: "opl_ossification" })],
    },
    {
      id: "oo-opl-focal",
      label: "OPLL pattern: focal",
      group: "OPLL",
      atoms: (ctx) => [a("ossification_posterior_longitudinal", choice("ligaments", "focal ventral ligamentous ossification", ctx), { level: ctx.level, state: "focal", conflictGroup: "opl_morphology" })],
    },
    {
      id: "oo-opl-segmental",
      label: "OPLL pattern: segmental",
      group: "OPLL",
      atoms: (ctx) => [a("ossification_posterior_longitudinal", choice("ligaments", "segmental ventral ligamentous ossification", ctx), { level: ctx.level, state: "segmental", conflictGroup: "opl_morphology" })],
    },
    {
      id: "oo-opl-continuous",
      label: "OPLL pattern: continuous over an extent",
      group: "OPLL",
      requiresExtent: true,
      atoms: (ctx) => [a("ossification_posterior_longitudinal", choice("ligaments", `continuous ventral ligamentous ossification${ctx.level2 ? ` from ${ctx.level} through ${ctx.level2}` : ""}`, ctx), { level: ctx.level, state: "continuous", conflictGroup: "opl_morphology" })],
    },
    {
      id: "oo-opl-cord-effect",
      label: "OPLL ventral cord effect",
      group: "OPLL",
      atoms: (ctx) => [a("cord_compression", choice("cord", "ventral cord compression from OPLL", ctx), { level: ctx.level, state: "compression", severity: "significant", conflictGroup: "cord_compression", anatomicalSection: ctx.level })],
    },
    {
      id: "oo-dish",
      label: "DISH pattern (selected)",
      group: "DISH",
      requiresExtent: true,
      atoms: (ctx) => [a("dish", lib(DX_BONE.dish, ctx), { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "dish" })],
    },
    {
      id: "oo-dish-disc-preserved",
      label: "Preserved disc heights with bridging ossification",
      group: "DISH",
      atoms: (ctx) => [a("dish", choice("alignment", "bridging ossification with preserved disc heights as observed", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "dish_pattern_detail" })],
    },
    {
      id: "oo-syndesmophytes",
      label: "Bridging syndesmophytes (ankylosing pattern)",
      group: "DISH",
      atoms: (ctx) => [a("ankylosing_pattern", lib(DX_BONE.ankylosingSpondylitis, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "ankylosing_pattern" })],
    },
    {
      id: "oo-ct-recommendation",
      label: "Recommend CT for mineralisation",
      group: "Recommendation",
      advanced: true,
      atoms: (ctx) => [a("screening_recommendation", choice("ligaments", "dedicated CT suggested to characterise ligamentous ossification", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "recommend_ct", role: "recommendation" })],
    },
  ],
};

// ─── 5. TRAUMA ───────────────────────────────────────────────────────────

const TRAUMA: DorsalSubMaster = {
  id: "trauma",
  label: "Trauma",
  hint: "Fracture morphology, canal compromise and ligamentous injury.",
  tiles: [
    {
      id: "tr-compression",
      label: "Acute wedge compression fracture",
      group: "Fracture",
      requires: ["stir"],
      atoms: (ctx) => [a("compression_fracture", lib(DX_BONE.acuteCompressionFracture, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.vertebra ?? ctx.level, state: "acute", severity: "significant", conflictGroup: "compression_fracture", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "tr-chronic-wedging",
      label: "Chronic wedging without oedema",
      group: "Fracture",
      atoms: (ctx) => [a("compression_fracture", lib(DX_BONE.chronicWedging, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.vertebra ?? ctx.level, state: "chronic", conflictGroup: "compression_fracture" })],
    },
    {
      id: "tr-burst",
      label: "Burst fracture with retropulsion",
      group: "Fracture",
      requires: ["stir"],
      atoms: (ctx) => [
        a("compression_fracture", lib(DX_BONE.burstFracture, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.vertebra ?? ctx.level, state: "burst", severity: "significant", conflictGroup: "compression_fracture", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE }),
        a("retropulsion", choice("canal", "posterior cortex retropulsion into the canal", ctx), { level: ctx.level, conflictGroup: "retropulsion" }),
      ],
    },
    {
      id: "tr-height-loss",
      label: "Vertebral height loss percentage",
      group: "Fracture",
      atoms: (ctx) => [a("vertebral_collapse", choice("marrow", `approximately ${ctx.pct ?? "X"}% anterior height loss`, ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "vertebral_collapse" })],
    },
    {
      id: "tr-marrow-edema",
      label: "Marrow oedema pattern",
      group: "Fracture",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("marrow", "T2/STIR hyperintense marrow oedema in this vertebral body", ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "marrow_edema" })],
    },
    {
      id: "tr-posterior-element-fracture",
      label: "Posterior element fracture",
      group: "Posterior elements",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", "fracture of the posterior elements at this level", ctx), { level: ctx.level, conflictGroup: "posterior_elements" })],
    },
    {
      id: "tr-facet-injury",
      label: "Facet injury / malalignment",
      group: "Posterior elements",
      requires: ["axial"],
      atoms: (ctx) => [a("facet_joint", choice("posterior", "facet joint injury with malalignment at this level", ctx), { level: ctx.level, conflictGroup: "facet_injury" })],
    },
    {
      id: "tr-plc",
      label: "Posterior ligamentous complex oedema",
      group: "Ligaments",
      requires: ["stir"],
      atoms: (ctx) => [a("posterior_ligamentous_complex", lib(DX_POSTERIOR.interspinousEdema, ctx), { level: ctx.level, conflictGroup: "posterior_ligamentous_complex" })],
    },
    {
      id: "tr-plc-disruption",
      label: "PLC disruption (radiologist-selected)",
      group: "Ligaments",
      requires: ["stir"],
      advanced: true,
      atoms: (ctx) => [a("posterior_ligamentous_complex", DX_POSTERIOR.macroPlcDisruption, { level: ctx.level, state: "disruption", conflictGroup: "plc_disruption" })],
    },
    {
      id: "tr-epidural-hematoma",
      label: "Epidural hematoma",
      group: "Canal / Cord",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "epidural hematoma at this level", ctx), { level: ctx.level, state: "hematoma", conflictGroup: "epidural_collection" })],
    },
    {
      id: "tr-canal-compromise",
      label: "Canal compromise",
      group: "Canal / Cord",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "canal compromise at this level", ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "tr-cord-contusion",
      label: "Cord oedema / contusion pattern",
      group: "Canal / Cord",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", choice("cord", "intrinsic cord T2 hyperintensity with an oedema / contusion pattern", ctx), { level: ctx.level, state: "contusion", conflictGroup: "cord_signal" })],
    },
    {
      id: "tr-conus-injury",
      label: "Conus injury at the junction (only when covered)",
      group: "Canal / Cord",
      requires: ["t2"],
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", lib(DX_CANAL.conusContusion, ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "conus_medullaris" })],
    },
    {
      id: "tr-soft-tissue",
      label: "Pre / paravertebral soft-tissue injury",
      group: "Soft tissues",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", "prevertebral / paravertebral soft-tissue abnormality at this level", ctx), { level: ctx.level, conflictGroup: "paravertebral" })],
    },
    {
      id: "tr-instability",
      label: "Mechanical instability (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("spondylolisthesis", choice("alignment", "mechanical instability — stated by the reporting radiologist", ctx), { level: ctx.level, conflictGroup: "instability_interpretation" })],
    },
  ],
};

// ─── 6. INFECTION / SPONDYLODISCITIS ─────────────────────────────────────

const INFECTION: DorsalSubMaster = {
  id: "infection",
  label: "Infection / Spondylodiscitis",
  hint: "Structured infective observations. Etiology is never inferred from the pattern.",
  tiles: [
    {
      id: "in-disc-involvement",
      label: "Disc involvement with fluid signal",
      group: "Disc / endplate",
      requires: ["t2"],
      atoms: (ctx) => [a("disc_signal", choice("discs", "fluid-signal disc involvement at this level", ctx), { level: ctx.level, conflictGroup: "disc_signal", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE })],
    },
    {
      id: "in-endplate-erosion",
      label: "Endplate erosion / destruction",
      group: "Disc / endplate",
      atoms: (ctx) => [a("endplate_erosion", choice("endplate", "endplate erosion and destruction at this level", ctx), { level: ctx.level, conflictGroup: "endplate_erosion" })],
    },
    {
      id: "in-spondylodiscitis",
      label: "Spondylodiscitis pattern at this level",
      group: "Disc / endplate",
      atoms: (ctx) => [a("spondylodiscitis", choice("marrow", "spondylodiscitis pattern involving the adjacent endplates and disc", ctx), { level: ctx.level, severity: "significant", conflictGroup: "spondylodiscitis" })],
    },
    {
      id: "in-marrow-edema",
      label: "Vertebral marrow oedema",
      group: "Vertebra",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("marrow", "T2/STIR hyperintense marrow oedema in the adjacent vertebral bodies", ctx), { level: ctx.level, conflictGroup: "marrow_edema" })],
    },
    {
      id: "in-confluent-marrow",
      label: "Confluent body involvement with cortical destruction",
      group: "Vertebra",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", DX_BONE.macroConfluentInfection, { level: ctx.level, conflictGroup: "marrow_infection_pattern" })],
    },
    {
      id: "in-vertebral-collapse",
      label: "Vertebral collapse",
      group: "Vertebra",
      atoms: (ctx) => [a("vertebral_collapse", choice("marrow", "vertebral body collapse at this level", ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "vertebral_collapse" })],
    },
    {
      id: "in-gibbus",
      label: "Kyphotic / gibbus deformity at the infected level",
      group: "Vertebra",
      atoms: (ctx) => [a("gibbus_deformity", DX_ALIGN.macroGibbusCentre, { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "gibbus_deformity" })],
    },
    {
      id: "in-epidural-component",
      label: "Epidural inflammatory component",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "epidural inflammatory / collection component at this level", ctx), { level: ctx.level, state: "abscess", conflictGroup: "epidural_collection" })],
    },
    {
      id: "in-prevertebral",
      label: "Prevertebral collection",
      group: "Collections",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", "prevertebral collection at this level", ctx), { level: ctx.level, laterality: ctx.side, supportsLaterality: Boolean(ctx.side), conflictGroup: "prevertebral_collection" })],
    },
    {
      id: "in-paravertebral",
      label: "Paravertebral collection with dimensions",
      group: "Collections",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", "prevertebral and paraspinal soft tissue collection at this level", ctx), { level: ctx.level, laterality: "bilateral", supportsLaterality: true, conflictGroup: "paravertebral" })],
    },
    {
      id: "in-psoas",
      label: "Psoas extension (only with junction / lower coverage)",
      group: "Collections",
      requiresJunction: true,
      advanced: true,
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", "collection extending to the psoas margin at this level", ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: "psoas_extension" })],
    },
    {
      id: "in-canal-compromise",
      label: "Canal compromise",
      group: "Canal / cord",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "canal compromise at this level", ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "in-cord-compression",
      label: "Cord compression",
      group: "Canal / cord",
      atoms: (ctx) => [a("cord_compression", choice("cord", "thoracic cord compression at this level", ctx), { level: ctx.level, state: "compression", severity: "significant", conflictGroup: "cord_compression", anatomicalSection: ctx.level })],
    },
    {
      id: "in-enhancement",
      label: "Enhancement pattern (contrast only)",
      group: "Contrast",
      requires: ["contrast"],
      atoms: (ctx) => [a("spondylodiscitis", choice("marrow", "peripheral rim enhancement of the collection and adjacent inflamed tissue", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "infection_enhancement" })],
    },
    {
      id: "in-enhancement-limited",
      label: "Enhancement not assessable (no contrast)",
      group: "Contrast",
      atoms: (ctx) => ctx.sequences.contrast
        ? []
        : [a("screening_limitation", spineLimitationSentence(["contrast"], "assessment of enhancement"), { level: ctx.level, conflictGroup: "contrast_limitation", role: "baseline" })],
    },
    {
      id: "in-tb-interpretation",
      label: "Tuberculous spondylodiscitis (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      // The library sentence states diffuse enhancement (§4/§25).
      requires: ["contrast"],
      atoms: (ctx) => [a("spondylodiscitis", lib(DX_DISC.spondylodiscitis, ctx), { level: ctx.level, state: "tuberculous_selected", severity: "significant", conflictGroup: "infection_etiology", impression: "Infective spondylodiscitis with tuberculous etiology selected by the reporting radiologist." })],
    },
    {
      id: "in-cold-abscess",
      label: "Cold abscess (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      // The library sentence itself states "peripheral thick enhancement", so it
      // may only be offered on a contrast study.
      requires: ["contrast"],
      atoms: (ctx) => [a("paravertebral_collection", lib(DX_SOFT.paraspinalAbscess, ctx), { level: ctx.level, state: "cold_abscess_selected", laterality: "bilateral", supportsLaterality: true, conflictGroup: "abscess_etiology" })],
    },
  ],
};

// ─── 7. TUMOR / MARROW / METASTASIS ──────────────────────────────────────

const TUMOR: DorsalSubMaster = {
  id: "tumorMarrow",
  label: "Tumor / Marrow / Metastasis",
  hint: "Marrow and soft-tissue lesion observations; classification stays manual.",
  tiles: [
    {
      id: "tm-focal-lesion",
      label: "Focal marrow lesion",
      group: "Marrow",
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "focal marrow-replacing lesion in this vertebral body", ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "bone_lesion" })],
    },
    {
      id: "tm-multifocal",
      label: "Multifocal marrow lesions",
      group: "Marrow",
      atoms: (ctx) => [a("bone_lesion", DX_BONE.macroMultifocalPatchy, { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "marrow_multifocal" })],
    },
    {
      id: "tm-diffuse-replacement",
      label: "Diffuse marrow replacement",
      group: "Marrow",
      atoms: (ctx) => [a("bone_lesion", DX_BONE.macroMarrowReplacement, { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "marrow_diffuse" })],
    },
    {
      id: "tm-hemangioma",
      label: "Benign-appearing hemangioma pattern",
      group: "Marrow",
      // The sentence rests on signal drop on fat-suppressed sequences.
      requires: ["stir"],
      atoms: (ctx) => [a("bone_lesion", lib(DX_BONE.hemangioma, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.vertebra ?? ctx.level, state: "hemangioma_pattern", conflictGroup: "bone_lesion" })],
    },
    {
      id: "tm-pedicle",
      label: "Pedicle / posterior element lesion",
      group: "Posterior elements",
      atoms: (ctx) => [a("posterior_elements", lib(DX_POSTERIOR.pedicleDestruction, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { level: ctx.vertebra ?? ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: "posterior_elements" })],
    },
    {
      id: "tm-pathological-fracture",
      label: "Pathological compression fracture",
      group: "Fracture",
      atoms: (ctx) => [a("compression_fracture", lib(DX_BONE.macroPathologicalFracture, ctx), { level: ctx.vertebra ?? ctx.level, state: "pathological", severity: "significant", conflictGroup: "compression_fracture", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE })],
    },
    {
      id: "tm-epidural-extension",
      label: "Epidural extension",
      group: "Extension",
      atoms: (ctx) => [a("epidural_space", lib(DX_CANAL.macroCircumferentialEpidural, ctx), { level: ctx.level, state: "tumor_extension", conflictGroup: "epidural_space" })],
    },
    {
      id: "tm-paravertebral-extension",
      label: "Paravertebral extension",
      group: "Extension",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", "paravertebral soft-tissue extension of the lesion", ctx), { level: ctx.level, laterality: ctx.side, supportsLaterality: Boolean(ctx.side), conflictGroup: "paravertebral" })],
    },
    {
      id: "tm-foraminal-extension",
      label: "Foraminal extension",
      group: "Extension",
      requires: ["axial"],
      atoms: (ctx) => [a("foraminal_stenosis", choice("foramina", "lesion extending into the neural foramen", ctx), { level: ctx.level, laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: "foraminal_stenosis" })],
    },
    {
      id: "tm-canal-compromise",
      label: "Canal compromise",
      group: "Canal / cord",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "canal compromise at this level", ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "tm-cord-compression",
      label: "Cord compression",
      group: "Canal / cord",
      atoms: (ctx) => [a("cord_compression", choice("cord", "thoracic cord compression at this level", ctx), { level: ctx.level, state: "compression", severity: "significant", conflictGroup: "cord_compression", anatomicalSection: ctx.level })],
    },
    {
      id: "tm-classify-indeterminate",
      label: "Classify: indeterminate",
      group: "Classification",
      advanced: true,
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "lesion classified by the reporting radiologist as indeterminate", ctx), { level: ctx.vertebra ?? ctx.level, state: "indeterminate", conflictGroup: "lesion_classification" })],
    },
    {
      id: "tm-classify-benign",
      label: "Classify: benign-appearing",
      group: "Classification",
      advanced: true,
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "lesion classified by the reporting radiologist as benign-appearing", ctx), { level: ctx.vertebra ?? ctx.level, state: "benign_appearing", conflictGroup: "lesion_classification" })],
    },
    {
      id: "tm-classify-suspicious",
      label: "Classify: suspicious",
      group: "Classification",
      advanced: true,
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "lesion classified by the reporting radiologist as suspicious", ctx), { level: ctx.vertebra ?? ctx.level, state: "suspicious", conflictGroup: "lesion_classification" })],
    },
    {
      id: "tm-classify-metastatic",
      label: "Classify: metastatic disease",
      group: "Classification",
      advanced: true,
      atoms: (ctx) => [a("bone_lesion", lib(DX_BONE.multifocalMarrow, ctx), { anatomicalSection: "dorsal spine", level: ctx.level, state: "metastatic_selected", conflictGroup: "lesion_classification", impression: DX_MACRO_LINES.osseousMetastasis.impression[0] })],
    },
    {
      id: "tm-classify-primary",
      label: "Classify: primary osseous lesion",
      group: "Classification",
      advanced: true,
      atoms: (ctx) => [a("bone_lesion", choice("marrow", "lesion classified by the reporting radiologist as a primary osseous lesion", ctx), { level: ctx.vertebra ?? ctx.level, state: "primary_osseous_selected", conflictGroup: "lesion_classification" })],
    },
  ],
};

// ─── 8. INTRADURAL / INTRAMEDULLARY ──────────────────────────────────────

const INTRADURAL: DorsalSubMaster = {
  id: "intradural",
  label: "Intradural / Intramedullary",
  hint: "Compartment observations. Tumour type is never inferred from compartment.",
  tiles: [
    {
      id: "id-extramedullary",
      label: "Intradural extramedullary lesion",
      group: "Compartment",
      atoms: (ctx) => [a("intradural_lesion", lib(DX_CANAL.intraduralMass, ctx), { level: ctx.level, state: "extramedullary", conflictGroup: "intradural_lesion" })],
    },
    {
      id: "id-intramedullary",
      label: "Intramedullary lesion",
      group: "Compartment",
      requiresExtent: true,
      // The library sentence names heterogeneous enhancement; without contrast
      // the compartment is recorded as the radiologist's descriptive choice.
      atoms: (ctx) => [a("intramedullary_lesion", ctx.sequences.contrast
        ? lib(DX_CANAL.intramedullaryMass, ctx)
        : choice("intramedullary", "expansile intramedullary T2 hyperintense lesion", ctx), { level: ctx.level, state: "intramedullary", conflictGroup: "intramedullary_lesion" })],
    },
    {
      id: "id-cord-expansion",
      label: "Cord expansion",
      group: "Cord effect",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "expansion of the cord at this level", ctx), { level: ctx.level, state: "expansion", conflictGroup: "cord_caliber" })],
    },
    {
      id: "id-cord-displacement",
      label: "Cord displacement",
      group: "Cord effect",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "smooth displacement of the cord", ctx), { level: ctx.level, state: "displacement", conflictGroup: "cord_caliber" })],
    },
    {
      id: "id-canal-effect",
      label: "Canal effect",
      group: "Cord effect",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "canal narrowing at this level", ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "id-associated-edema",
      label: "Associated cord oedema",
      group: "Cord effect",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", choice("cord", "intrinsic cord T2 hyperintensity above and below the lesion", ctx), { level: ctx.level, state: "oedema", conflictGroup: "cord_signal" })],
    },
    {
      id: "id-syrinx",
      label: "Syrinx",
      group: "Cord effect",
      requires: ["t2"],
      atoms: (ctx) => [a("syrinx", choice("cord", "cord cavity / syrinx at this level", ctx), { level: ctx.level, conflictGroup: "syrinx" })],
    },
    {
      id: "id-enhancement",
      label: "Enhancement pattern (contrast only)",
      group: "Contrast",
      requires: ["contrast"],
      atoms: (ctx) => [a("intradural_lesion", choice("intradural", "lesion enhancement as selected by the reporting radiologist", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "lesion_enhancement" })],
    },
    {
      id: "id-label-schwannoma",
      label: "Label: schwannoma (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("intradural_lesion", choice("intradural", "intradural extramedullary lesion labelled schwannoma by the reporting radiologist", ctx), { level: ctx.level, state: "schwannoma_selected", conflictGroup: "lesion_label" })],
    },
    {
      id: "id-label-meningioma",
      label: "Label: meningioma (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("intradural_lesion", choice("intradural", "intradural extramedullary lesion labelled meningioma by the reporting radiologist", ctx), { level: ctx.level, state: "meningioma_selected", conflictGroup: "lesion_label" })],
    },
    {
      id: "id-label-ependymoma",
      label: "Label: ependymoma (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("intramedullary_lesion", choice("intramedullary", "intramedullary lesion labelled ependymoma by the reporting radiologist", ctx), { level: ctx.level, state: "ependymoma_selected", conflictGroup: "lesion_label" })],
    },
    {
      id: "id-label-astrocytoma",
      label: "Label: astrocytoma (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("intramedullary_lesion", choice("intramedullary", "intramedullary lesion labelled astrocytoma by the reporting radiologist", ctx), { level: ctx.level, state: "astrocytoma_selected", conflictGroup: "lesion_label" })],
    },
  ],
};

// ─── 9. VASCULAR / dAVF PATTERN ──────────────────────────────────────────

const VASCULAR: DorsalSubMaster = {
  id: "vascular",
  label: "Vascular / dAVF Pattern",
  hint: "Descriptive vascular observations; the fistula diagnosis stays manual.",
  tiles: [
    {
      id: "va-flow-voids",
      label: "Serpiginous perimedullary flow voids",
      group: "Pattern",
      atoms: (ctx) => [a("spinal_flow_voids", lib(DX_SOFT.perimedullaryFlowVoids, ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "spinal_flow_voids" })],
    },
    {
      id: "va-dorsal-predominance",
      label: "Dorsal / ventral predominance",
      group: "Pattern",
      atoms: (ctx) => [a("spinal_flow_voids", choice("vascular", `perimedullary flow voids with ${ctx.side === "right" ? "ventral" : "dorsal"} predominance`, ctx), { level: ctx.level, conflictGroup: "flow_void_distribution" })],
    },
    {
      id: "va-cord-swelling",
      label: "Cord swelling",
      group: "Cord effect",
      atoms: (ctx) => [a("cord_caliber", choice("cord", "cord swelling at this level", ctx), { level: ctx.level, state: "swelling", conflictGroup: "cord_caliber" })],
    },
    {
      id: "va-longitudinal-signal",
      label: "Long-segment cord T2 hyperintensity",
      group: "Cord effect",
      requires: ["t2"],
      requiresExtent: true,
      atoms: (ctx) => [a("cord_signal", choice("cord", `longitudinal intramedullary T2 hyperintensity from ${ctx.level} through ${ctx.level2}`, ctx), { level: ctx.level, state: "longitudinal_hyperintensity", conflictGroup: "cord_signal_longitudinal" })],
    },
    {
      id: "va-conus-involvement",
      label: "Conus involvement (only when covered)",
      group: "Cord effect",
      requires: ["t2"],
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", choice("conus", "conus medullaris involvement with intrinsic signal change", ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "conus_medullaris" })],
    },
    {
      id: "va-enhancement",
      label: "Enhancement pattern (contrast only)",
      group: "Contrast",
      requires: ["contrast"],
      atoms: (ctx) => [a("spinal_flow_voids", choice("vascular", "patchy cord / perimedullary enhancement", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "vascular_enhancement" })],
    },
    {
      id: "va-davf-suspicion",
      label: "Suspicion for spinal dAVF (radiologist-selected)",
      group: "Interpretation",
      advanced: true,
      atoms: (ctx) => [a("spinal_flow_voids", choice("vascular", "findings raise suspicion for spinal dural arteriovenous fistula — selected by the reporting radiologist", ctx), { anatomicalSection: "dorsal spine", level: ctx.level, state: "davf_suspicion", conflictGroup: "vascular_impression", impression: "Suspicion for spinal dural arteriovenous fistula (dAVF) — stated by the reporting radiologist." })],
    },
    {
      id: "va-vascular-recommendation",
      label: "Recommend dedicated vascular evaluation",
      group: "Recommendation",
      advanced: true,
      atoms: (ctx) => [a("screening_recommendation", choice("vascular", "dedicated spinal vascular evaluation suggested by the reporting radiologist", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "recommend_vascular", role: "recommendation" })],
    },
  ],
};

// ─── 10. POST-OPERATIVE ─────────────────────────────────────────────────

const POSTOP: DorsalSubMaster = {
  id: "postop",
  label: "Post-operative",
  hint: "Surgical change, collections and decompression status; hardware limits respected.",
  tiles: [
    {
      id: "po-laminectomy",
      label: "Prior laminectomy / decompression",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "posterior decompression / laminectomy at this level", ctx), { level: ctx.level, state: "laminectomy", conflictGroup: "hardware_postop" })],
    },
    {
      id: "po-discectomy",
      label: "Prior discectomy",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "prior discectomy at this level", ctx), { level: ctx.level, state: "discectomy", conflictGroup: "procedure_discectomy" })],
    },
    {
      id: "po-fusion",
      label: "Fusion / instrumentation",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "instrumented fusion at this level", ctx), { level: ctx.level, state: "fusion", conflictGroup: "procedure_fusion" })],
    },
    {
      id: "po-collection",
      label: "Post-operative collection",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "post-operative epidural collection at this level", ctx), { level: ctx.level, state: "collection", conflictGroup: "epidural_collection" })],
    },
    {
      id: "po-hematoma",
      label: "Post-operative hematoma",
      group: "Collections",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "post-operative epidural hematoma at this level", ctx), { level: ctx.level, state: "hematoma", conflictGroup: "epidural_collection" })],
    },
    {
      id: "po-infection",
      label: "Post-operative infection",
      group: "Collections",
      requires: ["stir"],
      atoms: (ctx) => [a("spondylodiscitis", choice("marrow", "post-operative infective collection at this level", ctx), { level: ctx.level, state: "infection", conflictGroup: "postop_infection" })],
    },
    {
      id: "po-recurrent-stenosis",
      label: "Residual / recurrent stenosis",
      group: "Canal / cord",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", "residual / recurrent canal stenosis at this level", ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "po-fibrosis",
      label: "Epidural fibrosis (contrast-supported only)",
      group: "Canal / cord",
      requires: ["contrast"],
      atoms: (ctx) => [a("epidural_space", choice("epidural", "epidural fibrosis at this level", ctx), { level: ctx.level, state: "fibrosis", conflictGroup: "epidural_fibrosis" })],
    },
    {
      id: "po-fibrosis-limited",
      label: "Fibrosis vs recurrent disc not separable (no contrast)",
      group: "Canal / cord",
      atoms: (ctx) => ctx.sequences.contrast
        ? []
        : [a("screening_limitation", spineLimitationSentence(["contrast"], "separation of recurrent disc material from epidural fibrosis"), { level: ctx.level, conflictGroup: "contrast_limitation", role: "baseline" })],
    },
    {
      id: "po-adjacent-segment",
      label: "Adjacent segment degeneration",
      group: "Canal / cord",
      atoms: (ctx) => [a("adjacent_segment_degeneration", choice("discs", "adjacent segment degenerative change", ctx), { level: ctx.level, conflictGroup: "adjacent_segment_degeneration" })],
    },
    {
      id: "po-decompression-status",
      label: "Cord decompression status",
      group: "Canal / cord",
      atoms: (ctx) => [a("cord_caliber", choice("cord", ctx.choice === "with" ? "cord decompression achieved" : "incomplete cord decompression", ctx), { level: ctx.level, state: "decompression_status", conflictGroup: "cord_decompression_status" })],
    },
    {
      id: "po-hardware-artifact",
      label: "Hardware-related artifact limiting assessment",
      group: "Limitations",
      advanced: true,
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "susceptibility artifact from instrumentation limits assessment at this level", ctx), { level: ctx.level, state: "artifact", conflictGroup: "hardware_artifact" })],
    },
    {
      id: "po-hardware-loosening",
      label: "Hardware loosening (radiologist-selected only)",
      group: "Limitations",
      advanced: true,
      atoms: (ctx) => [a("hardware_postop", choice("hardware", "hardware loosening stated by the reporting radiologist; MRI signal alone is not sufficient", ctx), { level: ctx.level, state: "loosening_selected", conflictGroup: "hardware_loosening" })],
    },
  ],
};

// ─── 11. DEFORMITY / KYPHOSIS / SCOLIOSIS ────────────────────────────────

const DEFORMITY: DorsalSubMaster = {
  id: "deformity",
  label: "Deformity / Kyphosis / Scoliosis",
  hint: "Curvature and translation observations. Etiology is never assigned here.",
  tiles: [
    {
      id: "df-kyphosis-normal",
      label: "Thoracic kyphosis within normal limits",
      group: "Curvature",
      atoms: (ctx) => [baseline("thoracic_kyphosis", DX_ALIGN.macroKyphosisPreserved, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis" })],
    },
    {
      id: "df-hyperkyphosis",
      label: "Exaggerated thoracic kyphosis",
      group: "Curvature",
      atoms: (ctx) => [a("thoracic_kyphosis", lib(DX_ALIGN.hyperkyphosis, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis" })],
    },
    {
      id: "df-straight",
      label: "Straightening / reversal of kyphosis",
      group: "Curvature",
      atoms: (ctx) => [a("thoracic_kyphosis", lib(DX_ALIGN.kyphosisReversal, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis" })],
    },
    {
      id: "df-focal-angulation",
      label: "Focal kyphotic angulation",
      group: "Curvature",
      atoms: (ctx) => [a("thoracic_kyphosis", choice("kyphosis", `focal kyphotic angulation at ${ctx.vertebra ?? ctx.level}`, ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "kyphosis_focal" })],
    },
    {
      id: "df-gibbus",
      label: "Gibbus deformity",
      group: "Curvature",
      atoms: (ctx) => [a("gibbus_deformity", lib(DX_ALIGN.gibbus, ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "gibbus_deformity" })],
    },
    {
      id: "df-scoliosis",
      label: "Scoliotic deformity (convexity + apex)",
      group: "Curvature",
      atoms: (ctx) => [a("scoliosis", lib(DX_ALIGN.scoliosis, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), { anatomicalSection: "dorsal spine", level: ctx.level, laterality: ctx.side, supportsLaterality: Boolean(ctx.side), conflictGroup: "scoliosis" })],
    },
    {
      id: "df-rotation",
      label: "Vertebral rotation at the apex",
      group: "Curvature",
      advanced: true,
      atoms: (ctx) => [a("scoliosis", choice("deformity", "apex vertebral rotation as observed", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "scoliosis_rotation" })],
    },
    {
      id: "df-anterolisthesis",
      label: "Anterolisthesis with translation",
      group: "Translation",
      // The library sentence names an etiology, so it belongs to the explicit
      // etiology tile below. This one records only what was measured (spec §6).
      atoms: (ctx) => [a("spondylolisthesis", ctx.mm != null
        ? choice("alignment", `anterolisthesis measuring approximately ${ctx.mm} mm`, ctx)
        : choice("alignment", "anterolisthesis at this level — translation not measured", ctx), {
        level: ctx.level,
        state: "anterolisthesis",
        conflictGroup: "anterolisthesis",
        measurement: ctx.mm != null ? String(ctx.mm) : undefined,
      })],
    },
    {
      id: "df-anterolisthesis-etiology",
      label: "Anterolisthesis with traumatic / degenerative etiology (selected)",
      group: "Translation",
      advanced: true,
      atoms: (ctx) => [a("spondylolisthesis", lib(DX_ALIGN.anterolisthesis, ctx, { level: ctx.vertebra ?? ctx.level.split("-")[0], level2: ctx.level2 }), { level: ctx.level, state: "anterolisthesis", conflictGroup: "anterolisthesis" })],
    },
    {
      id: "df-retrolisthesis",
      label: "Retrolisthesis with translation",
      group: "Translation",
      // The library line states a measured translation; without one it would
      // assert a number the radiologist did not enter.
      atoms: (ctx) => [a("spondylolisthesis", ctx.mm != null
        ? lib(DX_ALIGN.retrolisthesis, ctx, { level: ctx.vertebra ?? ctx.level.split("-")[0], level2: ctx.level2 })
        : choice("alignment", "retrolisthesis at this level — translation not measured", ctx), {
        level: ctx.level,
        state: "retrolisthesis",
        conflictGroup: "retrolisthesis",
        measurement: ctx.mm != null ? String(ctx.mm) : undefined,
      })],
    },
    {
      id: "df-junctional",
      label: "Junctional deformity (only with junction coverage)",
      group: "Translation",
      requiresJunction: true,
      atoms: (ctx) => [a("thoracolumbar_junction", DX_ALIGN.macroJunctionalAngulation, { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "junctional_deformity" })],
    },
  ],
};

// ─── 12. CONGENITAL / DEVELOPMENTAL ─────────────────────────────────────

const CONGENITAL: DorsalSubMaster = {
  id: "congenital",
  label: "Congenital / Developmental",
  hint: "Conus position, cord cavity and posterior element development.",
  tiles: [
    {
      id: "cg-low-conus",
      label: "Low-lying conus (only when covered)",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", lib(DX_CANAL.lowLyingConus, ctx, { conusLevel: ctx.conusLevel ?? ctx.vertebra }), { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "conus_position" })],
    },
    {
      id: "cg-tethered",
      label: "Tethered cord pattern (radiologist-selected)",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("tethered_cord", lib(DX_CANAL.lowLyingConus, ctx, { conusLevel: ctx.conusLevel ?? ctx.vertebra }), { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "tethered_cord" })],
    },
    {
      id: "cg-conus-lesion",
      label: "Focal conus lesion (only when covered)",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", choice("conus", "focal conus medullaris lesion", ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "conus_medullaris" })],
    },
    {
      id: "cg-syrinx",
      label: "Cord cavity / syrinx",
      group: "Cord",
      requires: ["t2"],
      atoms: (ctx) => [a("syrinx", choice("cord", "long-segment cord cavity / syrinx", ctx), { level: ctx.level, conflictGroup: "syrinx" })],
    },
    {
      id: "cg-posterior-defect",
      label: "Posterior element developmental defect",
      group: "Cord",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", "posterior element developmental defect at this level", ctx), { level: ctx.level, conflictGroup: "posterior_elements_development" })],
    },
    {
      id: "cg-conus-normal-level",
      label: "Conus termination level (structured)",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", lib(DX_ALIGN.conusNormal, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "conus_position", role: "baseline" })],
    },
  ],
};

// ─── 13. THORACOLUMBAR JUNCTION / CONUS ─────────────────────────────────

const JUNCTION: DorsalSubMaster = {
  id: "junction",
  label: "Thoracolumbar Junction / Conus",
  hint: "Conus and junction detail — offered only when coverage reaches T12-L1.",
  tiles: [
    {
      id: "jj-t12l1",
      label: "T12-L1 junction level",
      group: "Junction levels",
      requiresJunction: true,
      atoms: (ctx) => [a("thoracolumbar_junction", choice("junction", `thoracolumbar junction assessed at ${ctx.level}`, ctx), { level: ctx.level, conflictGroup: "junction_level" })],
    },
    {
      id: "jj-junctional-kyphosis",
      label: "Junctional kyphosis",
      group: "Alignment",
      requiresJunction: true,
      atoms: (ctx) => [a("thoracic_kyphosis", DX_ALIGN.macroJunctionalAngulation, { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "kyphosis" })],
    },
    {
      id: "jj-fracture-retropulsion",
      label: "Junctional fracture with retropulsion",
      group: "Fracture",
      requiresJunction: true,
      atoms: (ctx) => [
        a("compression_fracture", lib(DX_BONE.burstFracture, ctx, { vertebra: ctx.vertebra ?? "T12" }), { level: ctx.vertebra ?? "T12", state: "burst", severity: "significant", conflictGroup: "compression_fracture" }),
        a("retropulsion", lib(DX_BONE.macroRetropulsion, ctx), { level: ctx.level, conflictGroup: "retropulsion" }),
      ],
    },
    {
      id: "jj-canal-compromise",
      label: "Junctional canal compromise",
      group: "Canal",
      requiresJunction: true,
      atoms: (ctx) => [a("canal_stenosis", DX_CANAL.macroCanalRetropulsion, { level: ctx.level, severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE })],
    },
    {
      id: "jj-conus-compression",
      label: "Conus compression",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", choice("conus", "compression of the conus medullaris at this level", ctx), { anatomicalSection: ctx.level, level: ctx.level, state: "compression", severity: "significant", conflictGroup: "conus_compression" })],
    },
    {
      id: "jj-conus-displacement",
      label: "Conus displacement",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", choice("conus", "displacement of the conus medullaris", ctx), { anatomicalSection: ctx.level, level: ctx.level, state: "displacement", conflictGroup: "conus_medullaris" })],
    },
    {
      id: "jj-conus-signal",
      label: "Conus oedema / signal abnormality",
      group: "Conus",
      requires: ["t2"],
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", lib(DX_CANAL.conusContusion, ctx), { anatomicalSection: ctx.level, level: ctx.level, state: "signal_abnormality", conflictGroup: "conus_signal" })],
    },
    {
      id: "jj-conus-termination",
      label: "Conus termination level (must be stated)",
      group: "Conus",
      requiresJunction: true,
      atoms: (ctx) => [a("conus_medullaris", lib(DX_CANAL.conusTerminates, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "conus_position", role: "baseline" })],
    },
    {
      id: "jj-cauda-visualized",
      label: "Cauda equina within the covered field",
      group: "Conus",
      requiresJunction: true,
      advanced: true,
      atoms: (ctx) => [a("cauda_equina", choice("conus", "cauda equina within the acquired field of view appears unremarkable", ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "cauda_equina", role: "baseline" })],
    },
    {
      id: "jj-not-covered",
      label: "Junction / conus outside the acquired field",
      group: "Coverage",
      atoms: (ctx) => junctionCovered(ctx.numbering)
        ? []
        : [a("screening_limitation", spineLimitationSentence(["lsScreening"], "the thoracolumbar junction and conus medullaris"), { anatomicalSection: "dorsal spine", conflictGroup: "coverage_junction", role: "baseline" })],
    },
  ],
};

// ─── 14. MORE / ADVANCED ────────────────────────────────────────────────

const ADVANCED: DorsalSubMaster = {
  id: "advanced",
  label: "More / Advanced",
  hint: "Epidural fat, costovertebral detail, visualized extra-spinal findings, recommendations.",
  tiles: [
    {
      id: "ad-epidural-fat",
      label: "Epidural fat prominence",
      group: "Epidural space",
      atoms: (ctx) => [a("epidural_space", choice("epidural", "prominent epidural fat at this level", ctx), { level: ctx.level, conflictGroup: "epidural_space" })],
    },
    {
      id: "ad-lipomatosis",
      label: "Epidural lipomatosis",
      group: "Epidural space",
      atoms: (ctx) => [a("epidural_lipomatosis", lib(DX_SOFT.epiduralLipomatosis, ctx), { level: ctx.level, conflictGroup: "epidural_lipomatosis" })],
    },
    {
      id: "ad-lipomatosis-with-stenosis",
      label: "Lipomatosis with degenerative stenosis (combined)",
      group: "Epidural space",
      atoms: (ctx) => [
        a("epidural_lipomatosis", lib(DX_SOFT.epiduralLipomatosis, ctx), { level: ctx.level, conflictGroup: "epidural_lipomatosis" }),
        a("canal_stenosis", choice("canal", `canal narrowing at ${ctx.level} from epidural fat together with degenerative disc and ligamentous change`, ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis_combined" }),
      ],
    },
    {
      id: "ad-costa-arthropathy",
      label: "Costovertebral arthropathy",
      group: "Costovertebral",
      atoms: (ctx) => [a("costovertebral_joint", lib(DX_POSTERIOR.costovertebralArthropathy, ctx), { level: ctx.level, conflictGroup: "costovertebral_joint" })],
    },
    {
      id: "ad-foraminal-narrowing",
      label: "Foraminal narrowing (side + cause)",
      group: "Costovertebral",
      requires: ["axial"],
      atoms: (ctx) => [a("foraminal_stenosis", lib(DX_POSTERIOR.foraminalNarrowing, ctx), { level: ctx.level, severity: "moderate", laterality: ctx.side ?? "left", supportsLaterality: true, conflictGroup: "foraminal_stenosis", baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE })],
    },
    {
      id: "ad-facet-arthropathy",
      label: "Facet arthropathy",
      group: "Costovertebral",
      atoms: (ctx) => [a("facet_joint", choice("posterior", "facet arthropathy at this level", ctx), { level: ctx.level, conflictGroup: "facet_joint" })],
    },
    {
      id: "ad-root-descriptive",
      label: "Suspected intercostal nerve involvement (descriptive)",
      group: "Costovertebral",
      requires: ["axial"],
      atoms: (ctx) => [a("root_contact", choice("foramina", "suspected involvement of the intercostal nerve at this level", ctx), { level: ctx.level, laterality: ctx.side, supportsLaterality: Boolean(ctx.side), conflictGroup: `root-descriptive-${ctx.level.replace(/\s+/g, "")}` })],
    },
    {
      id: "ad-pleural",
      label: "Visualized pleural finding",
      group: "Extra-spinal",
      atoms: (ctx) => [a("visualized_pleura", lib(DX_SOFT.pleuralEffusion, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "visualized_pleura" })],
    },
    {
      id: "ad-aorta",
      label: "Visualized thoracic aorta (descriptive)",
      group: "Extra-spinal",
      atoms: (ctx) => [a("visualized_thoracic_aorta", lib(DX_SOFT.thoracicAorta, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "visualized_aorta" })],
    },
    {
      id: "ad-limited-fov",
      label: "Limited field-of-view qualifier",
      group: "Extra-spinal",
      atoms: (ctx) => [a("screening_limitation", choice("coverage", "extra-spinal structures are only partially visualized within this limited field of view", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "fov_limitation", role: "baseline" })],
    },
    {
      id: "ad-cover-cervical",
      label: "Cervical spine not covered",
      group: "Coverage",
      advanced: true,
      atoms: (ctx) => ctx.sequences.cervicalScreening
        ? []
        : [a("screening_limitation", spineLimitationSentence(["cervicalScreening"], "the cervical spine"), { anatomicalSection: "dorsal spine", conflictGroup: "coverage_cervical", role: "baseline" })],
    },
    {
      id: "ad-cover-ls",
      label: "Lumbosacral spine / conus not covered",
      group: "Coverage",
      advanced: true,
      atoms: (ctx) => conusCovered(ctx.numbering) || ctx.sequences.lsScreening
        ? []
        : [a("screening_limitation", spineLimitationSentence(["lsScreening"], "the lumbosacral spine and conus medullaris"), { anatomicalSection: "dorsal spine", conflictGroup: "coverage_ls", role: "baseline" })],
    },
    {
      id: "ad-recommend-dedicated-dorsal",
      label: "Dedicated MRI dorsal spine suggested",
      group: "Recommendation",
      advanced: true,
      atoms: (ctx) => [a("screening_recommendation", choice("coverage", "dedicated MRI of the dorsal spine suggested", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "recommend_dorsal", role: "recommendation" })],
    },
    {
      id: "ad-recommend-whole-spine",
      label: "Whole-spine screening coverage suggested",
      group: "Recommendation",
      advanced: true,
      atoms: (ctx) => [a("screening_recommendation", choice("coverage", "whole-spine screening coverage suggested where clinically indicated", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "recommend_whole_spine", role: "recommendation" })],
    },
  ],
};

/** Every dorsal palette, in canvas order. */
export const MRI_DORSAL_SUB_MASTERS: DorsalSubMaster[] = [
  ROUTINE,
  DEGENERATIVE,
  CANALCORD,
  OPLOLFDISH,
  TRAUMA,
  INFECTION,
  TUMOR,
  INTRADURAL,
  VASCULAR,
  POSTOP,
  DEFORMITY,
  CONGENITAL,
  JUNCTION,
  ADVANCED,
];

export function dorsalSubMasterById(id: DorsalSubMasterId): DorsalSubMaster | null {
  return MRI_DORSAL_SUB_MASTERS.find((s) => s.id === id) ?? null;
}

const DORSAL_TILE_INDEX = new Map<string, { tile: DorsalTile; subMaster: DorsalSubMasterId }>();
for (const sub of MRI_DORSAL_SUB_MASTERS) {
  for (const tile of sub.tiles) DORSAL_TILE_INDEX.set(tile.id, { tile, subMaster: sub.id });
}

export function dorsalTileById(id: string): { tile: DorsalTile; subMaster: DorsalSubMasterId } | null {
  return DORSAL_TILE_INDEX.get(id) ?? null;
}

export function allDorsalTileIds(): string[] {
  return [...DORSAL_TILE_INDEX.keys()];
}

// ─── Gating (spec §25) ───────────────────────────────────────────────────

export type DorsalTileGate = {
  available: boolean;
  missing: SpineSequenceKey[];
  reason?: "sequence" | "localizer" | "coverage" | "extent";
  notice?: string;
};

/**
 * A tile is offered only when the study can support it. Unavailable tiles are
 * shown struck-through with the reason, never silently dropped.
 */
export function dorsalTileAvailability(tile: DorsalTile, ctx: DorsalTileContext): DorsalTileGate {
  if (tile.requires?.length && !spineSequencesAllow(ctx.sequences, tile.requires)) {
    const missing = tile.requires.filter((k) => !ctx.sequences[k]);
    return { available: false, missing, reason: "sequence", notice: `Requires ${missing.join(" + ")}.` };
  }
  if (tile.requiresLocalizer && !ctx.sequences.wholeSpineLocalizer) {
    return { available: false, missing: ["wholeSpineLocalizer"], reason: "localizer", notice: "Requires whole-spine / localizer coverage." };
  }
  if (tile.requiresLocalizerIf?.(ctx) && !ctx.sequences.wholeSpineLocalizer) {
    return {
      available: false,
      missing: ["wholeSpineLocalizer"],
      reason: "localizer",
      notice: "This statement names a whole-spine / localizer numbering basis that is not documented for this study.",
    };
  }
  if (tile.requiresJunction && !junctionCovered(ctx.numbering)) {
    return {
      available: false,
      missing: [],
      reason: "coverage",
      notice: "Recorded coverage does not reach the thoracolumbar junction, so the conus cannot be assessed.",
    };
  }
  if (tile.requiresExtent && !ctx.level2) {
    return { available: false, missing: [], reason: "extent", notice: "Supply the second level (extent) for this statement." };
  }
  return { available: true, missing: [] };
}

/**
 * Level-scoped tile bundle id. The same tile captured at another level is a
 * different bundle, so deselecting one level never erases another.
 */
export function dorsalTileBundleId(tileId: string, level: string): string {
  return spineBundleId("dx-tile", `${tileId}${level ? `-${level.replace(/\s+/g, "")}` : ""}`);
}

export function buildDorsalTileBundle(
  tileId: string,
  ctx: DorsalTileContext,
): { bundleId: string; observations: PendingPathologyPatch[] } {
  const found = dorsalTileById(tileId);
  const bundleId = dorsalTileBundleId(tileId, ctx.level);
  if (!found) return { bundleId, observations: [] };
  const atoms = found.tile.atoms(ctx);
  return { bundleId, observations: spineAtomsToPatches(ctx.region ?? "Dorsal Spine", bundleId, withDorsalBaselineContract(atoms)) };
}

// ─── Starting presets (spec §35) ─────────────────────────────────────────

export type DorsalPreset = {
  id: string;
  label: string;
  hint: string;
  subMasters: DorsalSubMasterId[];
  /** CRITICAL presets are flagged so the existing critical workflow can react. */
  critical?: boolean;
  /** Sequences this preset needs to emit its full wording. */
  requires?: SpineSequenceKey[];
  /** Preset names the conus / junction: needs junction coverage. */
  requiresJunction?: boolean;
  atoms: (ctx: DorsalTileContext) => SpineAtomSpec[];
};

const presetAtom = a;

/** Numbered library impression lines, joined without re-writing the library. */
function presetImpression(lines: readonly string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join(" ");
}

/**
 * A preset's summary lines are an Impression contribution. Carrying them as
 * findings prose would put an interpretation inside the Findings paragraph,
 * where the ledger cannot keep it separate from the anatomical statements.
 */
function presetImpressionAtom(concept: string, lines: readonly string[]): SpineAtomSpec {
  return presetAtom(concept, "", {
    anatomicalSection: "dorsal spine",
    conflictGroup: "impression_lines",
    impression: presetImpression(lines),
    role: "impression",
  });
}

function contrastLimitedAtom(ctx: DorsalTileContext, subject: string): SpineAtomSpec {
  return presetAtom("screening_limitation", spineLimitationSentence(["contrast"], subject), {
    level: ctx.level,
    conflictGroup: "contrast_limitation",
    role: "baseline",
  });
}

export const DORSAL_PRESETS: DorsalPreset[] = [
  {
    id: "preset-normal-dorsal",
    label: "Normal MRI Dorsal Spine",
    hint: "Coverage-aware normal baseline. Conus wording appears only when the junction is covered.",
    subMasters: ["routine"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("alignment", lib(DX_ALIGN.normal, ctx), { anatomicalSection: "dorsal spine", role: "baseline" }),
        presetAtom("thoracic_kyphosis", DX_ALIGN.macroKyphosisPreserved, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis", role: "baseline" }),
        presetAtom("compression_fracture", lib(DX_BONE.normal, ctx), { anatomicalSection: "dorsal spine", role: "baseline" }),
        presetAtom("bone_lesion", lib(DX_BONE.noFocalLesion, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "marrow_screen", role: "baseline" }),
        presetAtom("disc_contour", lib(DX_DISC.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, role: "baseline", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        presetAtom("canal_stenosis", lib(DX_CANAL.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, role: "baseline", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
      ];
      if (ctx.sequences.axial) {
        atoms.push(presetAtom("foraminal_stenosis", lib(DX_POSTERIOR.normal, ctx), { anatomicalSection: ctx.level, level: ctx.level, role: "baseline", baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE }));
      }
      atoms.push(
        presetAtom("posterior_elements", lib(DX_POSTERIOR.posteriorElementsIntact, ctx), { anatomicalSection: ctx.level, level: ctx.level, role: "baseline", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE }),
        presetAtom("paravertebral_collection", lib(DX_SOFT.normal, ctx), { anatomicalSection: "dorsal spine", conflictGroup: "paravertebral", state: "normal", role: "baseline" }),
      );
      // Never a normal conus sentence when the conus was not acquired (§12).
      // The library's cord normal sentence names the conus too, so it is gated
      // with it rather than rewritten into a partial quote.
      if (conusCovered(ctx.numbering)) {
        atoms.push(
          presetAtom("cord_caliber", lib(DX_CANAL.cordNormal, ctx), { anatomicalSection: ctx.level, level: ctx.level, role: "baseline", baselineReplaces: DORSAL_LEVEL_CORD_BASELINE }),
          presetAtom("conus_medullaris", lib(DX_CANAL.conusTerminates, ctx, { conusLevel: ctx.conusLevel }), { anatomicalSection: "dorsal spine", role: "baseline" }),
        );
      }
      const numbering = dorsalNumberingAtom(ctx);
      if (numbering) atoms.push(numbering);
      return atoms;
    },
  },
  {
    id: "preset-multilevel-degeneration",
    label: "Multilevel Thoracic Degeneration",
    hint: "Library disc desiccation / height loss pattern across the mid-to-lower thoracic spine.",
    subMasters: ["degenerative"],
    atoms: (ctx) => [
      presetAtom("alignment", DX_ALIGN.macroAlignmentPreserved, { anatomicalSection: "dorsal spine", baselineReplaces: DX_ALIGN.normal }),
      presetAtom("disc_signal", lib(DX_DISC.desiccation, ctx), { level: ctx.level, conflictGroup: "disc_signal", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
      presetAtom("disc_height", choice("discs", "reduced disc heights at the affected levels", ctx), { level: ctx.level, conflictGroup: "disc_height" }),
      presetAtom("endplate", choice("endplate", "degenerative endplate change without erosion", ctx), { level: ctx.level, conflictGroup: "endplate" }),
    ],
  },
  {
    id: "preset-focal-protrusion",
    label: "Focal Thoracic Disc Protrusion",
    hint: "Central protrusion indenting the ventral thecal sac, without cord compression.",
    subMasters: ["degenerative", "canalCord"],
    atoms: (ctx) => [
      presetAtom("disc_contour", lib(DX_DISC.centralProtrusion, ctx), { level: ctx.level, state: "protrusion", severity: "moderate", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
      presetAtom("canal_morphology", choice("csf", "ventral thecal-sac indentation without cord deformation", ctx), { level: ctx.level, conflictGroup: "canal_morphology" }),
    ],
  },
  {
    id: "preset-calcified-disc-cord",
    label: "Calcified Disc Herniation with Cord Compression",
    hint: "Library macro 1 — calcified extrusion, severe stenosis and intrinsic cord signal change.",
    subMasters: ["degenerative", "canalCord"],
    requires: ["t2"],
    critical: true,
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("alignment", DX_ALIGN.macroKyphosisPreserved, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis", baselineReplaces: DX_ALIGN.normal }),
        presetAtom("compression_fracture", DX_BONE.macroHeightsPreserved, { anatomicalSection: "dorsal spine", baselineReplaces: DX_BONE.normal }),
        presetAtom("disc_contour", DX_DISC.macroFocalCalcified, { level: ctx.level, state: "herniation_calcified", severity: "severe", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        presetAtom("disc_contour", lib(DX_DISC.calcifiedHerniation, ctx), { level: ctx.level, state: "herniation_calcified", severity: "severe", conflictGroup: "disc_contour_calcified", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        presetAtom("canal_stenosis", lib(DX_CANAL.macroCordCompressionLevel, ctx), { level: ctx.level, severity: "severe", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
        presetAtom("cord_compression", choice("cord", "marked compression of the ventral thoracic cord", ctx), { level: ctx.level, state: "compression", severity: "significant", anatomicalSection: ctx.level, conflictGroup: "cord_compression" }),
      ];
      if (ctx.sequences.t2) {
        atoms.push(presetAtom("cord_signal", DX_CANAL.macroCordSignalOedema, { level: ctx.level, state: "hyperintensity", conflictGroup: "cord_signal" }));
      }
      if (conusCovered(ctx.numbering)) {
        atoms.push(presetAtom("conus_medullaris", DX_CANAL.macroConusNormalL1, { anatomicalSection: "dorsal spine", conflictGroup: "conus_position", role: "baseline" }));
      }
      atoms.push(presetImpressionAtom("alignment", DX_MACRO_LINES.calcifiedDiscMyelopathy.impression));
      return atoms;
    },
  },
  {
    id: "preset-cord-compression-signal",
    label: "Cord Compression + Signal Abnormality",
    hint: "Compression and intrinsic signal kept as two separable observations.",
    subMasters: ["canalCord"],
    requires: ["t2"],
    critical: true,
    atoms: (ctx) => [
      presetAtom("cord_compression", choice("cord", "thoracic spinal cord compression at this level", ctx), { level: ctx.level, state: "compression", severity: "significant", anatomicalSection: ctx.level, conflictGroup: "cord_compression" }),
      presetAtom("cord_signal", lib(DX_CANAL.cordSignal, ctx), { level: ctx.level, state: "hyperintensity", conflictGroup: "cord_signal" }),
      presetAtom("canal_stenosis", choice("canal", "significant canal narrowing at the compressed level", ctx), { level: ctx.level, severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
    ],
  },
  {
    id: "preset-olf-stenosis",
    label: "OLF with Canal Stenosis",
    hint: "Library macro 4 — nodular posterolateral ossification with V-shaped canal narrowing.",
    subMasters: ["oplOlfDish", "canalCord"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("alignment", DX_ALIGN.macroAlignmentPreserved, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis", baselineReplaces: DX_ALIGN.normal }),
        presetAtom("compression_fracture", DX_BONE.macroHeightsPreserved, { anatomicalSection: "dorsal spine", baselineReplaces: DX_BONE.normal }),
        presetAtom("disc_signal", DX_DISC.macroMultilevelMildDesiccation, { level: ctx.level, conflictGroup: "disc_signal" }),
        presetAtom("olf", DX_CANAL.macroOlfNodular, { level: ctx.level, state: "ossification", laterality: "bilateral", supportsLaterality: true, conflictGroup: "olf" }),
        presetAtom("canal_stenosis", lib(DX_CANAL.macroOlfVShaped, ctx), { level: ctx.level, severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
        presetAtom("cord_caliber", lib(DX_CANAL.macroCordFlatteningWithOrWithout, ctx, { choice: ctx.choice }), { level: ctx.level, state: "flattening", conflictGroup: "cord_caliber" }),
      ];
      if (conusCovered(ctx.numbering)) {
        atoms.push(presetAtom("conus_medullaris", DX_CANAL.macroConusNormalL1, { anatomicalSection: "dorsal spine", conflictGroup: "conus_position", role: "baseline" }));
      }
      atoms.push(presetImpressionAtom("olf", DX_MACRO_LINES.olfCanalStenosis.impression));
      return atoms;
    },
  },
  {
    id: "preset-opll-compression",
    label: "OPLL with Cord Compression",
    hint: "Continuous ventral ossification over an extent; CT suggested for mineralisation.",
    subMasters: ["oplOlfDish", "canalCord"],
    atoms: (ctx) => [
      presetAtom("ossification_posterior_longitudinal", lib(DX_CANAL.opll, ctx), { level: ctx.level, state: "ossification", conflictGroup: "opl_ossification" }),
      presetAtom("cord_compression", choice("cord", "continuous ventral cord compression from OPLL", ctx), { level: ctx.level, state: "compression", severity: "significant", anatomicalSection: ctx.level, conflictGroup: "cord_compression" }),
      presetAtom("screening_recommendation", choice("ligaments", "dedicated CT suggested to characterise the extent of ossification", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "recommend_ct", role: "recommendation" }),
    ],
  },
  {
    id: "preset-acute-compression-fracture",
    label: "Acute Compression Fracture",
    hint: "Without STIR the oedema claim is dropped and the chronic pattern is used.",
    subMasters: ["trauma"],
    atoms: (ctx) => [
      presetAtom("compression_fracture", ctx.sequences.stir
        ? lib(DX_BONE.acuteCompressionFracture, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] })
        : lib(DX_BONE.chronicWedging, ctx, { vertebra: ctx.vertebra ?? ctx.level.split("-")[0] }), {
        level: ctx.vertebra ?? ctx.level,
        state: ctx.sequences.stir ? "acute" : "chronic",
        conflictGroup: "compression_fracture",
        baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE,
      }),
      ...(ctx.sequences.stir ? [] : [presetAtom("screening_limitation", spineLimitationSentence(["stir"], "assessment of acute marrow oedema"), { level: ctx.level, conflictGroup: "stir_limitation", role: "baseline" })]),
    ],
  },
  {
    id: "preset-thoracolumbar-burst",
    label: "Thoracolumbar Burst Fracture",
    hint: "Library macro 2. Conus wording requires junction coverage; PLC wording requires STIR.",
    subMasters: ["trauma", "junction"],
    requires: ["stir"],
    requiresJunction: true,
    critical: true,
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("thoracic_kyphosis", DX_ALIGN.macroJunctionalAngulation, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis", baselineReplaces: DX_ALIGN.normal }),
        presetAtom("compression_fracture", lib(DX_BONE.macroBurstBody, ctx), { level: "T12", state: "burst", severity: "significant", conflictGroup: "compression_fracture", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE }),
        presetAtom("marrow_edema", DX_BONE.macroBodyEdema, { level: "T12", conflictGroup: "marrow_edema" }),
        presetAtom("retropulsion", lib(DX_BONE.macroRetropulsion, ctx), { level: "T12", conflictGroup: "retropulsion" }),
        presetAtom("disc_signal", DX_DISC.macroDiscFluid, { level: ctx.level, conflictGroup: "disc_signal" }),
        presetAtom("canal_stenosis", DX_CANAL.macroCanalRetropulsion, { level: "T12", severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
      ];
      if (ctx.sequences.stir) {
        atoms.push(presetAtom("posterior_ligamentous_complex", DX_POSTERIOR.macroPlcDisruption, { level: "T12-L1", state: "disruption", conflictGroup: "posterior_ligamentous_complex" }));
      } else {
        atoms.push(presetAtom("screening_limitation", spineLimitationSentence(["stir"], "assessment of posterior ligamentous injury"), { level: "T12-L1", conflictGroup: "stir_limitation", role: "baseline" }));
      }
      if (conusCovered(ctx.numbering)) {
        atoms.push(presetAtom("conus_medullaris", DX_CANAL.macroConusEdema, { anatomicalSection: "T12", level: "T12", state: "signal_abnormality", conflictGroup: "conus_signal" }));
      }
      atoms.push(presetImpressionAtom("compression_fracture", DX_MACRO_LINES.thoracolumbarBurst.impression));
      return atoms;
    },
  },
  {
    id: "preset-spondylodiscitis",
    label: "Infective Spondylodiscitis",
    hint: "Structured disc / endplate / marrow observations. Etiology is not asserted.",
    subMasters: ["infection"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("marrow_edema", DX_BONE.macroConfluentInfection, { level: ctx.level, conflictGroup: "marrow_edema", baselineReplaces: DORSAL_LEVEL_VERTEBRAL_BASELINE }),
        // "peripheral enhancement" belongs to the contrast macro line only.
        presetAtom("disc_signal", ctx.sequences.contrast
          ? DX_DISC.macroDiscDestruction
          : DX_DISC.macroDiscFluid, { level: ctx.level, conflictGroup: "disc_signal", baselineReplaces: DORSAL_LEVEL_DISC_BASELINE }),
        presetAtom("endplate_erosion", choice("endplate", "extensive endplate erosion with cortical destruction", ctx), { level: ctx.level, conflictGroup: "endplate_erosion" }),
      ];
      atoms.push(ctx.sequences.contrast
        ? presetAtom("spondylodiscitis", choice("marrow", "diffuse enhancement of the disc and adjacent inflamed tissue", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "infection_enhancement" })
        : contrastLimitedAtom(ctx, "assessment of enhancement"));
      return atoms;
    },
  },
  {
    id: "preset-spondylodiscitis-collection",
    label: "Spondylodiscitis + Paravertebral / Epidural Collection",
    hint: "Library macro 3 pattern. TB / cold-abscess labels are separate selected tiles.",
    subMasters: ["infection", "canalCord"],
    critical: true,
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("gibbus_deformity", DX_ALIGN.macroGibbusCentre, { anatomicalSection: ctx.level, conflictGroup: "gibbus_deformity", baselineReplaces: DX_ALIGN.normal }),
        presetAtom("marrow_edema", DX_BONE.macroConfluentInfection, { level: ctx.level, conflictGroup: "marrow_edema" }),
        // The macro 3 lines describe enhancing disc and collection, so on a
        // non-contrast study only the descriptive observations are made and the
        // enhancement element becomes a stated limitation.
        presetAtom("disc_signal", ctx.sequences.contrast
          ? DX_DISC.macroDiscDestruction
          : DX_DISC.macroDiscFluid, { level: ctx.level, conflictGroup: "disc_signal" }),
        presetAtom(
          "paravertebral_collection",
          ctx.sequences.contrast
            ? lib(DX_SOFT.macroColdAbscess, ctx)
            : choice("soft", "large bilateral prevertebral and paraspinal soft tissue collection", ctx),
          { level: ctx.level, laterality: "bilateral", supportsLaterality: true, conflictGroup: "paravertebral" },
        ),
        presetAtom("epidural_collection", lib(DX_CANAL.macroEpiduralCordFlattening, ctx), { level: ctx.level, state: "abscess", severity: "severe", conflictGroup: "epidural_collection" }),
        presetAtom("cord_compression", choice("cord", "thoracic cord compression from the epidural component", ctx), { level: ctx.level, state: "compression", severity: "significant", anatomicalSection: ctx.level, conflictGroup: "cord_compression" }),
      ];
      if (ctx.sequences.contrast) {
        atoms.push(presetAtom("paravertebral_collection", choice("soft", "thick peripheral rim enhancement of the collection", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "collection_enhancement" }));
      } else {
        atoms.push(contrastLimitedAtom(ctx, "assessment of collection enhancement"));
      }
      return atoms;
    },
  },
  {
    id: "preset-multifocal-marrow",
    label: "Multifocal Marrow Lesions",
    hint: "Descriptive multifocal pattern — no automatic metastatic diagnosis.",
    subMasters: ["tumorMarrow"],
    atoms: (ctx) => [
      presetAtom("bone_lesion", DX_BONE.macroMultifocalPatchy, { anatomicalSection: "dorsal spine", level: ctx.level, conflictGroup: "marrow_multifocal" }),
      presetAtom("bone_lesion", choice("marrow", "lesions remain unclassified pending radiologist review", ctx), { anatomicalSection: "dorsal spine", conflictGroup: "lesion_classification", role: "baseline" }),
    ],
  },
  {
    id: "preset-pathological-fracture-epidural",
    label: "Pathological Compression Fracture + Epidural Extension",
    hint: "Library macro 5 pattern; the metastatic label stays a separate selection.",
    subMasters: ["tumorMarrow", "canalCord"],
    critical: true,
    atoms: (ctx) => [
      presetAtom("thoracic_kyphosis", DX_ALIGN.macroFocalAngulation, { anatomicalSection: "dorsal spine", conflictGroup: "kyphosis", baselineReplaces: DX_ALIGN.normal }),
      presetAtom("bone_lesion", DX_BONE.macroMarrowReplacement, { level: "T6", conflictGroup: "marrow_diffuse", baselineReplaces: DX_BONE.normal }),
      presetAtom("compression_fracture", lib(DX_BONE.macroPathologicalFracture, ctx), { level: "T6", state: "pathological", severity: "significant", conflictGroup: "compression_fracture" }),
      presetAtom("posterior_elements", choice("posterior", "extension of tumour tissue into the pedicles and posterior elements", ctx), { level: "T6", conflictGroup: "posterior_elements" }),
      presetAtom("disc_contour", DX_DISC.macroDiscPreserved, { level: ctx.level, conflictGroup: "disc_contour_preserved", role: "baseline" }),
      presetAtom("epidural_space", lib(DX_CANAL.macroCircumferentialEpidural, ctx), { level: "T6", state: "tumor_extension", conflictGroup: "epidural_space" }),
      presetAtom("canal_stenosis", choice("canal", "severe central canal stenosis at the involved level", ctx), { level: "T6", severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
      presetAtom("cord_compression", choice("cord", "thoracic cord compression at the involved level", ctx), { level: "T6", state: "compression", severity: "significant", anatomicalSection: "T6", conflictGroup: "cord_compression" }),
    ],
  },
  {
    id: "preset-intradural-mass",
    label: "Intradural Extramedullary Mass",
    hint: "Compartment observations only — the tumour label is a separate selection.",
    subMasters: ["intradural", "canalCord"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("intradural_lesion", lib(DX_CANAL.intraduralMass, ctx), { level: ctx.level, state: "extramedullary", conflictGroup: "intradural_lesion" }),
        presetAtom("cord_caliber", choice("cord", "smooth displacement of the cord with severe canal narrowing", ctx), { level: ctx.level, state: "displacement", conflictGroup: "cord_caliber" }),
        presetAtom("canal_stenosis", choice("canal", "severe canal narrowing at the lesion level", ctx), { level: ctx.level, severity: "severe", conflictGroup: "canal_stenosis", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
      ];
      atoms.push(ctx.sequences.contrast
        ? presetAtom("intradural_lesion", choice("intradural", "homogeneous enhancement of the intradural lesion", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "lesion_enhancement" })
        : contrastLimitedAtom(ctx, "characterisation of lesion enhancement"));
      return atoms;
    },
  },
  {
    id: "preset-intramedullary-mass",
    label: "Intramedullary Mass",
    hint: "Longitudinal extent required; enhancement gated on contrast.",
    subMasters: ["intradural", "canalCord"],
    requires: ["t2"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        // The library sentence names heterogeneous enhancement, so without
        // contrast the lesion is recorded as the radiologist's own descriptive
        // choice rather than as a partially supported quotation.
        presetAtom("intramedullary_lesion", ctx.sequences.contrast
          ? lib(DX_CANAL.intramedullaryMass, ctx)
          : choice("intramedullary", "expansile intramedullary T2 hyperintense lesion", ctx), { level: ctx.level, state: "intramedullary", conflictGroup: "intramedullary_lesion" }),
        presetAtom("cord_caliber", choice("cord", "expansion of the cord over the involved segment", ctx), { level: ctx.level, state: "expansion", conflictGroup: "cord_caliber" }),
        presetAtom("cord_signal", choice("cord", "associated cord oedema above and below the lesion", ctx), { level: ctx.level, state: "oedema", conflictGroup: "cord_signal" }),
      ];
      atoms.push(ctx.sequences.contrast
        ? presetAtom("intramedullary_lesion", choice("intramedullary", "heterogeneous enhancement of the intramedullary lesion", ctx), { level: ctx.level, state: "enhancement", conflictGroup: "lesion_enhancement" })
        : contrastLimitedAtom(ctx, "characterisation of lesion enhancement"));
      return atoms;
    },
  },
  {
    id: "preset-davf-pattern",
    label: "dAVF Suspicion Pattern",
    hint: "Observations plus an explicit suspicion line — never an automatic diagnosis.",
    subMasters: ["vascular", "canalCord"],
    requires: ["t2"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("spinal_flow_voids", lib(DX_SOFT.perimedullaryFlowVoids, ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "spinal_flow_voids" }),
        presetAtom("cord_caliber", choice("cord", "cord swelling at the involved levels", ctx), { level: ctx.level, state: "swelling", conflictGroup: "cord_caliber" }),
        presetAtom("cord_signal", choice("cord", `longitudinal intramedullary T2 hyperintensity from ${ctx.level}${ctx.level2 ? ` through ${ctx.level2}` : ""}`, ctx), { level: ctx.level, state: "longitudinal_hyperintensity", conflictGroup: "cord_signal_longitudinal" }),
      ];
      if (conusCovered(ctx.numbering)) {
        atoms.push(presetAtom("conus_medullaris", choice("conus", "conus medullaris involvement with intrinsic signal change", ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "conus_medullaris" }));
      }
      atoms.push(presetAtom("spinal_flow_voids", choice("vascular", "findings raise suspicion for spinal dural arteriovenous fistula — selected by the reporting radiologist", ctx), {
        anatomicalSection: "dorsal spine",
        conflictGroup: "vascular_impression",
        role: "impression",
        impression: "Suspicion for spinal dural arteriovenous fistula (dAVF) — stated by the reporting radiologist.",
      }));
      atoms.push(presetAtom("screening_recommendation", choice("vascular", "dedicated spinal vascular evaluation suggested by the reporting radiologist", ctx), {
        anatomicalSection: "dorsal spine",
        conflictGroup: "recommend_vascular",
        role: "recommendation",
      }));
      return atoms;
    },
  },
  {
    id: "preset-epidural-lipomatosis",
    label: "Epidural Lipomatosis",
    hint: "Fat deposition with thecal-sac compression; combines with stenosis without duplicating.",
    subMasters: ["advanced", "canalCord"],
    atoms: (ctx) => [
      presetAtom("epidural_lipomatosis", lib(DX_SOFT.epiduralLipomatosis, ctx), { level: ctx.level, conflictGroup: "epidural_lipomatosis" }),
      presetAtom("canal_stenosis", choice("canal", `canal narrowing at ${ctx.level} from epidural fat with smooth anterior thecal-sac compression`, ctx), { level: ctx.level, severity: "moderate", conflictGroup: "canal_stenosis_combined", baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE }),
    ],
  },
  {
    id: "preset-gibbus-deformity",
    label: "Kyphotic / Gibbus Deformity",
    hint: "Focal angular deformity — etiology stays a separate selection.",
    subMasters: ["deformity"],
    atoms: (ctx) => [
      presetAtom("gibbus_deformity", lib(DX_ALIGN.gibbus, ctx), { anatomicalSection: ctx.level, level: ctx.level, conflictGroup: "gibbus_deformity", baselineReplaces: DX_ALIGN.normal }),
      presetAtom("vertebral_collapse", choice("marrow", `focal vertebral collapse at ${ctx.vertebra ?? ctx.level.split("-")[0]}`, ctx), { level: ctx.vertebra ?? ctx.level, conflictGroup: "vertebral_collapse" }),
    ],
  },
];

export function dorsalPresetById(id: string): DorsalPreset | null {
  return DORSAL_PRESETS.find((p) => p.id === id) ?? null;
}

export function dorsalPresetBundleId(presetId: string, level: string): string {
  return spineBundleId("dx-preset", `${presetId}${level ? `-${level.replace(/\s+/g, "")}` : ""}`);
}

/** Preset availability plus the one-line downgrade notice (spec §25). */
export function dorsalPresetAvailability(
  preset: DorsalPreset,
  ctx: DorsalTileContext,
): { supported: boolean; notice: string | null } {
  const missing = (preset.requires ?? []).filter((k) => !ctx.sequences[k]);
  if (missing.length > 0) {
    return {
      supported: false,
      notice: `Partly limited: this study does not include ${missing.map((k) => k).join(" + ")}; unsupported sentences are replaced with limitation wording.`,
    };
  }
  if (preset.requiresJunction && !junctionCovered(ctx.numbering)) {
    return { supported: false, notice: "Recorded coverage does not reach the thoracolumbar junction, so conus sentences are omitted." };
  }
  return { supported: true, notice: null };
}

export function buildDorsalPresetBundle(
  presetId: string,
  ctx: DorsalTileContext,
): { bundleId: string; observations: PendingPathologyPatch[]; critical: boolean; notice: string | null } {
  const preset = dorsalPresetById(presetId);
  const bundleId = dorsalPresetBundleId(presetId, ctx.level);
  if (!preset) return { bundleId, observations: [], critical: false, notice: null };
  const gate = dorsalPresetAvailability(preset, ctx);
  const atoms = preset.atoms(ctx).filter((atom) =>
    atom.findings.trim() || atom.impression?.trim() || atom.recommendation?.trim());
  return {
    bundleId,
    observations: spineAtomsToPatches(ctx.region ?? "Dorsal Spine", bundleId, withDorsalBaselineContract(atoms)),
    critical: preset.critical === true,
    notice: gate.notice,
  };
}

/** Level detail and tile bundles share one entry point for the canvas. */
export function buildDorsalLevelBundle(opts: {
  level: string;
  detail: DorsalLevelDetail;
  numbering: DorsalNumberingState;
  sequences: SpineSequencesAvailable;
  region?: string;
}): { bundleId: string; observations: PendingPathologyPatch[]; structuredChoiceCount: number } {
  const built = buildDorsalLevelDetailBundle(opts);
  return {
    bundleId: built.bundleId,
    observations: spineAtomsToPatches(opts.region ?? "Dorsal Spine", built.bundleId, withDorsalBaselineContract(built.atoms)),
    structuredChoiceCount: built.structuredChoiceCount,
  };
}

// ─── Shared lesion / collection characterization (spec §19, §24) ─────────

export type DorsalLesionCompartment =
  | "epidural"
  | "intradural"
  | "intramedullary"
  | "vertebral"
  | "paravertebral"
  | "postop_collection";

export type DorsalLesionInput = {
  compartment: DorsalLesionCompartment;
  level: string;
  level2?: string;
  laterality?: DorsalSide;
  apMm?: number;
  transverseMm?: number;
  craniocaudalMm?: number;
  cmAP?: number;
  cmTransverse?: number;
  cmCraniocaudal?: number;
  t1?: string;
  t2?: string;
  stir?: string;
  dwi?: string;
  susceptibility?: string;
  enhancement?: "none" | "rim" | "diffuse" | "heterogeneous" | "intense";
  canalEffect?: boolean;
  cordEffect?: boolean;
  foraminalEffect?: boolean;
  paravertebralExtension?: boolean;
  label?: string;
};

const LESION_CONCEPT: Record<DorsalLesionCompartment, string> = {
  epidural: "epidural_collection",
  intradural: "intradural_lesion",
  intramedullary: "intramedullary_lesion",
  vertebral: "bone_lesion",
  paravertebral: "paravertebral_collection",
  postop_collection: "epidural_collection",
};

const LESION_SECTION: Record<DorsalLesionCompartment, keyof typeof SECTION_FRAMES> = {
  epidural: "epidural",
  intradural: "intradural",
  intramedullary: "intramedullary",
  vertebral: "marrow",
  paravertebral: "soft",
  postop_collection: "epidural",
};

function dimensionsPhrase(input: DorsalLesionInput): string {
  const cm = [input.cmAP, input.cmTransverse, input.cmCraniocaudal].filter((n) => n != null && Number.isFinite(n));
  if (cm.length > 0) return ` measuring ${cm.join(" x ")} cm`;
  const mm = [input.apMm, input.transverseMm, input.craniocaudalMm].filter((n) => n != null && Number.isFinite(n));
  if (mm.length > 0) return ` measuring ${mm.join(" x ")} mm`;
  return "";
}

/**
 * The signal characteristics the radiologist stated. Each one is a structured
 * choice — the software never converts "T2 hyperintense" into a diagnosis.
 */
function signalPhrase(input: DorsalLesionInput, ctx: DorsalTileContext): string {
  const bits: string[] = [];
  if (input.t1) bits.push(`T1: ${input.t1}`);
  if (input.t2) bits.push(`T2: ${input.t2}`);
  if (input.stir) bits.push(`STIR: ${input.stir}`);
  if (input.dwi && ctx.sequences.dwi) bits.push(`DWI/ADC: ${input.dwi}`);
  if (input.susceptibility && ctx.sequences.dwi) bits.push(`susceptibility: ${input.susceptibility}`);
  if (bits.length === 0) return "";
  return ` Signal pattern — ${bits.join("; ")}.`;
}

/**
 * ONE lesion form reused by the tumor, infection, post-operative, intradural and
 * conus palettes (spec §24). The sentence is the radiologist's own structured
 * choice — compartment, extent, measurements, signal pattern — because drawing a
 * lesion in a compartment does not make it the schwannoma / cold abscess /
 * hemangioma that the library names, and those sentences stay on their own
 * explicitly selected tiles. Sequence-dependent descriptors are dropped when not
 * acquired.
 */
export function buildDorsalLesionAtoms(
  input: DorsalLesionInput,
  ctx: DorsalTileContext,
): SpineAtomSpec[] {
  const concept = LESION_CONCEPT[input.compartment];
  const extent = input.level2 ? `from ${input.level} to ${input.level2}` : `at ${input.level}`;
  const base = `${SECTION_FRAMES[LESION_SECTION[input.compartment]]}: ${input.label ?? "focal lesion"} ${extent}${dimensionsPhrase(input)}.`;

  const atoms: SpineAtomSpec[] = [
    {
      concept,
      conflictGroup: `lesion-${input.compartment}-${input.level.replace(/\s+/g, "")}`,
      anatomicalSection: input.level,
      findings: base + signalPhrase(input, ctx),
      level: input.level,
      laterality: input.laterality,
      supportsLaterality: Boolean(input.laterality),
      measurement: input.apMm != null ? String(input.apMm) : undefined,
      state: input.enhancement ? `enhancement:${input.enhancement}` : "",
    },
  ];

  if (input.enhancement && input.enhancement !== "none") {
    atoms.push(ctx.sequences.contrast
      ? {
        concept,
        conflictGroup: `lesion-enhancement-${input.level.replace(/\s+/g, "")}`,
        anatomicalSection: input.level,
        findings: `${SECTION_FRAMES[LESION_SECTION[input.compartment]]}: ${input.enhancement} enhancement at ${input.level}.`,
        level: input.level,
        state: "enhancement",
      }
      : {
        concept: "screening_limitation",
        conflictGroup: "contrast_limitation",
        anatomicalSection: input.level,
        findings: spineLimitationSentence(["contrast"], "assessment of enhancement"),
        level: input.level,
        role: "baseline",
      });
  }
  if (input.canalEffect) {
    atoms.push({
      concept: "canal_stenosis",
      conflictGroup: `lesion-canal-${input.level.replace(/\s+/g, "")}`,
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.canal}: canal compromise at ${input.level}.`,
      level: input.level,
      severity: "moderate",
      baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE,
    });
  }
  if (input.cordEffect) {
    atoms.push({
      concept: "cord_compression",
      conflictGroup: "cord_compression",
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.cord}: thoracic spinal cord compression at ${input.level}.`,
      level: input.level,
      state: "compression",
      severity: "significant",
    });
  }
  if (input.foraminalEffect && ctx.sequences.axial) {
    atoms.push({
      concept: "foraminal_stenosis",
      conflictGroup: "foraminal_stenosis",
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.foramina}: foraminal narrowing at ${input.level}${input.laterality ? ` on the ${input.laterality}` : ""}.`,
      level: input.level,
      laterality: input.laterality,
      supportsLaterality: Boolean(input.laterality),
      severity: "moderate",
      baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE,
    });
  }
  if (input.paravertebralExtension) {
    atoms.push({
      concept: "paravertebral_collection",
      conflictGroup: "paravertebral",
      anatomicalSection: input.level,
      findings: `${SECTION_FRAMES.soft}: paravertebral soft-tissue extension at ${input.level}.`,
      level: input.level,
      laterality: input.laterality,
      supportsLaterality: Boolean(input.laterality),
    });
  }
  return atoms;
}

export function buildDorsalLesionBundle(
  input: DorsalLesionInput,
  ctx: DorsalTileContext,
): { bundleId: string; observations: PendingPathologyPatch[] } {
  const bundleId = spineBundleId("dx-lesion", `${input.compartment}-${input.level.replace(/\s+/g, "")}`);
  return {
    bundleId,
    observations: spineAtomsToPatches(
      ctx.region ?? "Dorsal Spine",
      bundleId,
      withDorsalBaselineContract(buildDorsalLesionAtoms(input, ctx)),
    ),
  };
}
