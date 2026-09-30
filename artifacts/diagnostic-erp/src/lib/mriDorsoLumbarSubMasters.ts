/**
 * mriDorsoLumbarSubMasters.ts — the fourteen clinical palettes of one dedicated
 * Dorso-Lumbar examination (spec §3, §8–§22).
 *
 * These are palettes over ONE report state, not separate editors: every tile
 * compiles to atoms on the single observation ledger, and switching palettes
 * never deletes an unrelated observation.
 *
 * What makes a Dorso-Lumbar palette different from pasting the dorsal palette
 * above the lumbar one:
 *
 *   1. Every tile declares which anatomical DOMAINS it may be written in
 *      (thoracic / junction / lumbar). The domain comes from the coverage
 *      resolver, not from the panel that clicked, so a cord sentence cannot be
 *      produced at a lumbar level and a lateral-recess sentence cannot be
 *      produced at a thoracic one (spec §11, §12, §14, §15).
 *   2. Coverage gates are hard: a tile naming the conus, the cauda or a level
 *      outside the acquired field of view is offered struck-through with the
 *      reason, and refuses to compile.
 *   3. The neural element is chosen by `dorsolumbarNeuralStructure`, so the same
 *      compression tile says cord, conus or cauda according to where it was
 *      applied — the transition the library makes a first-class section (§6).
 *   4. Sentences come from the Dorso-Lumbar library only. Where the library
 *      lists a supported finding as a phrase rather than a sentence, the tile
 *      writes the radiologist's structured choice into the section frame
 *      ("Central canal: central canal narrowing at T12-L1.") and nothing more —
 *      no invented prognosis, no auto-etiology.
 *
 * Pure functions only — no store, no React.
 */

import {
  DL_ALIGN,
  DL_BONE,
  DL_CANAL,
  DL_COVER,
  DL_DEFORMITY,
  DL_DEGEN,
  DL_DISC,
  DL_FORAMEN,
  DL_INFECTION,
  DL_INTRADURAL,
  DL_JUNCTION,
  DL_LUMBAR,
  DL_MACROS,
  DL_OSSIFICATION,
  DL_POSTERIOR,
  DL_POSTOP,
  DL_SOFT,
  DL_TRAUMA,
  DL_TUMOR,
  fillDlProse,
  type DlProseVars,
} from "./mriDorsoLumbarLibrary";
import {
  canonicalDorsoLumbarLevel,
  dorsolumbarCaudaCovered,
  dorsolumbarConusCovered,
  dorsolumbarCordCovered,
  dorsolumbarDomains,
  dorsolumbarLevelDomain,
  dorsolumbarNeuralStructure,
  dorsolumbarNumberingCaution,
  isDorsoLumbarLevelAcquired,
  type DorsoLumbarDomain,
  type DorsoLumbarState,
} from "./mriDorsoLumbarCoverage";
import {
  spineLimitationSentence,
  spineSequencesAllow,
  type SpineSequenceKey,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import { spineAtomsToPatches, spineBundleId, type SpineAtomSpec } from "./mriSpineAtoms";

/** Spec §3, in the order the rail presents them. */
export const DORSOLUMBAR_SUBMASTER_IDS = [
  "routine",
  "degenerative",
  "canalNeural",
  "junction",
  "ossification",
  "trauma",
  "infection",
  "tumorMarrow",
  "intradural",
  "vascular",
  "postop",
  "deformity",
  "congenital",
  "advanced",
] as const;

export type DorsoLumbarSubMasterId = (typeof DORSOLUMBAR_SUBMASTER_IDS)[number];

export type DorsoLumbarSide = "left" | "right" | "bilateral";

export type DorsoLumbarTileContext = {
  /** Resolver-derived canonical key (T8-T9 … L5-T); "" for a study-wide tile. */
  level: string;
  state: DorsoLumbarState;
  sequences: SpineSequencesAvailable;
  /** Empty when the level could not be resolved at all. */
  domain: DorsoLumbarDomain | "";
  side?: DorsoLumbarSide;
  root?: string;
  mm?: number;
  mm2?: number;
  cm?: number;
  cm2?: number;
  cm3?: number;
  pct?: number;
  degree?: string;
  conusLevel?: string;
  vertebra?: string;
  vertebra2?: string;
  /** Second level for extent sentences ("T4 through T7"). */
  level2?: string;
  direction?: "superiorly" | "inferiorly" | "superior" | "inferior";
  /** Word selection inside a library `[with / without]` group. */
  choice?: "with" | "without";
  /** Extra slot values, keyed by the group's alternatives joined without spaces. */
  slotValues?: Record<string, string>;
  /** Overrides the canonical region; normally left unset. */
  region?: string;
};

export type DorsoLumbarTile = {
  id: string;
  label: string;
  group: string;
  /** Hidden behind the palette's own "advanced" disclosure. */
  advanced?: boolean;
  /**
   * Domains this tile may be written in. Omitted means "any acquired domain";
   * a tile that names cord, conus or cauda anatomy always declares it.
   */
  domains?: DorsoLumbarDomain[];
  /** Acquisitions this tile needs before it may be offered (spec §22). */
  requires?: SpineSequenceKey[];
  /** Needs the thoracolumbar junction inside the field of view (spec §4). */
  requiresJunction?: boolean;
  /** Needs the conus actually covered (spec §12). */
  requiresConus?: boolean;
  /** Needs cauda-equina coverage, i.e. a covered lumbar segment (spec §12). */
  requiresCauda?: boolean;
  /** Needs thoracic cord coverage (spec §12). */
  requiresCord?: boolean;
  /** Never offered without whole-spine / localizer coverage. */
  requiresLocalizer?: boolean;
  /** Only meaningful when transitional (LSTV) anatomy is recorded (spec §5). */
  requiresTransitional?: boolean;
  /** Needs a second level (craniocaudal extent) before it can be written. */
  requiresExtent?: boolean;
  atoms: (ctx: DorsoLumbarTileContext) => SpineAtomSpec[];
};

export type DorsoLumbarSubMaster = {
  id: DorsoLumbarSubMasterId;
  label: string;
  hint: string;
  tiles: DorsoLumbarTile[];
};

type AtomExtras = Partial<Omit<SpineAtomSpec, "concept" | "findings">>;

/** Library sentence for this tile, with the radiologist's structured input filled in. */
function lib(template: string, ctx: DorsoLumbarTileContext, overrides: DlProseVars = {}): string {
  return fillDlProse(template, {
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
    degree: ctx.degree,
    conusLevel: ctx.conusLevel,
    vertebra: ctx.vertebra,
    vertebra2: ctx.vertebra2,
    direction: ctx.direction,
    choice: ctx.choice,
    slotValues: ctx.slotValues,
    ...overrides,
  }).text;
}

const SECTION_FRAMES: Record<string, string> = {
  alignment: "Alignment",
  curvature: "Curvature",
  deformity: "Deformity",
  bone: "Vertebral bodies / marrow",
  endplate: "Endplates",
  discs: "Intervertebral discs",
  canal: "Central canal",
  csf: "CSF space",
  cord: "Spinal cord",
  conus: "Conus medullaris",
  cauda: "Cauda equina",
  recess: "Lateral recess",
  foramina: "Neural foramina",
  posterior: "Posterior elements",
  ligaments: "Ligaments",
  plc: "Posterior ligamentous complex",
  costovertebral: "Costovertebral region",
  epidural: "Epidural space",
  intradural: "Intradural space",
  intramedullary: "Cord / conus parenchyma",
  vascular: "Perimedullary vessels",
  soft: "Paravertebral / psoas soft tissues",
  junction: "Thoracolumbar junction",
  hardware: "Hardware",
  infection: "Infection / disc",
  coverage: "Coverage",
  numbering: "Vertebral numbering",
  sacroiliac: "Sacroiliac joints",
  paraspinal: "Paraspinal muscles",
};

/** The radiologist's structured choice, rendered without invented clinical prose. */
function choice(section: keyof typeof SECTION_FRAMES, label: string, ctx: DorsoLumbarTileContext): string {
  return `${SECTION_FRAMES[section] ?? section}: ${label}${ctx.level ? ` at ${ctx.level}` : ""}.`;
}

/**
 * `anatomicalSection` is the level for level-bound findings and "dorso-lumbar
 * spine" for study-wide ones, so a global sentence never impersonates a level
 * slot that the junction rule protects.
 */
function ctxSection(concept: string, level?: string): string {
  if (level) return level;
  const global = new Set([
    "alignment",
    "kyphosis",
    "gibbus_deformity",
    "scoliosis",
    "spondylolisthesis",
    "listhesis_dynamic",
    "cord_compression",
    "cord_signal",
    "cord_caliber",
    "conus_medullaris",
    "cauda_equina",
    "syrinx",
    "dish",
    "ankylosing_pattern",
    "hardware_postop",
    "screening_limitation",
    "screening_recommendation",
    "transitional_vertebra",
    "bertolotti_syndrome",
    "tethered_cord",
    "filum_terminale",
    "arachnoiditis",
  ]);
  return global.has(concept) ? "dorso-lumbar spine" : (level ?? "dorso-lumbar spine");
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

function baseline(concept: string, findings: string, extra?: AtomExtras): SpineAtomSpec {
  return a(concept, findings, { role: "baseline", ...extra });
}

/**
 * The Dorso-Lumbar normal statements (library §1–§6). Only these strings are
 * used as baselines, so normal-to-abnormal reconciliation removes the conflicting
 * normal slot without touching any other region's finding (spec §8).
 */
export const DL_NORMAL_BY_CONCEPT: Record<string, string> = {
  alignment: DL_ALIGN.normal,
  kyphosis: DL_ALIGN.curvesPreserved,
  gibbus_deformity: DL_ALIGN.curvesPreserved,
  scoliosis: DL_ALIGN.curvesPreserved,
  spondylolisthesis: DL_ALIGN.normal,
  listhesis_dynamic: DL_ALIGN.normal,
  compression_fracture: DL_BONE.noFracture,
  retropulsion: DL_BONE.noFracture,
  vertebral_collapse: DL_BONE.noFracture,
  bone_lesion: DL_BONE.normal,
  marrow_edema: DL_BONE.normal,
  endplate: DL_BONE.normal,
  schmorl_node: DL_BONE.normal,
  posterior_elements: DL_BONE.normal,
  pars_defect: DL_BONE.normal,
  disc_contour: DL_BONE.normal,
  disc_signal: DL_BONE.normal,
  disc_height: DL_BONE.normal,
  canal_stenosis: DL_CANAL.noCanalCompromise,
  canal_morphology: DL_CANAL.noCanalCompromise,
  cord_caliber: DL_CANAL.cordNormal,
  cord_compression: DL_CANAL.cordNormal,
  cord_signal: DL_CANAL.cordNormal,
  conus_medullaris: DL_JUNCTION.conusNormal,
  foraminal_stenosis: DL_CANAL.noCanalCompromise,
  lateral_recess_stenosis: DL_CANAL.noCanalCompromise,
  cauda_equina: DL_CANAL.cordNormal,
};

/** Stamp the normal sentence each abnormal atom supersedes. */
export function withDorsoLumbarBaselineContract<A extends SpineAtomSpec>(atoms: A[]): A[] {
  return atoms.map((atom) => {
    if (atom.role === "baseline" || atom.baselineReplaces) return atom;
    const normal = DL_NORMAL_BY_CONCEPT[atom.concept];
    if (!normal || atom.findings.includes(normal)) return atom;
    return { ...atom, baselineReplaces: normal };
  });
}

/**
 * The neural element the report may name at the level in context. A tile that
 * describes compression of the neural element uses this rather than hard-coding
 * "cord", which is how a conus finding at T12 stops being called a thoracic cord
 * finding (spec §12).
 */
export function dorsoLumbarNeuralWord(ctx: DorsoLumbarTileContext): string {
  const neural = dorsolumbarNeuralStructure(ctx.level, ctx.state);
  return neural === "unknown" ? "neural elements" : neural;
}

const NEURAL_SECTION: Record<string, keyof typeof SECTION_FRAMES> = {
  cord: "cord",
  conus: "conus",
  cauda: "cauda",
};

function neuralFrame(ctx: DorsoLumbarTileContext): string {
  const word = dorsoLumbarNeuralWord(ctx);
  return SECTION_FRAMES[NEURAL_SECTION[word] ?? "cord"] ?? "Spinal cord";
}

/** Study-wide atoms inherit the reporting region; level atoms take the canonical owner. */
function tileRegion(ctx: DorsoLumbarTileContext): string {
  if (ctx.region) return ctx.region;
  if (!ctx.level) return "";
  return canonicalDorsoLumbarLevel(ctx.level)?.ledgerRegion ?? "";
}

function junctionCovered(state: DorsoLumbarState): boolean {
  return dorsolumbarDomains(state).junction.length > 0;
}

/** Transitional (LSTV) anatomy is what makes the congenital tiles meaningful. */
function hasTransitionalAnatomy(state: DorsoLumbarState): boolean {
  return state.lumbar.mode === "lstv-sacralization" || state.lumbar.mode === "lstv-lumbarization";
}

/**
 * Level-bound atoms carry the canonical key, so a bridge entered as "L1-T12" or
 * "D12-L1" lands in the same ledger slot as one entered as "T12-L1" (spec §6).
 */
function levelOf(ctx: DorsoLumbarTileContext): string | undefined {
  return canonicalLevelOf(ctx.level);
}

/**
 * The library lists several supported findings as phrases prefixed
 * `right/left` rather than as a bracketed choice group, so the side comes from
 * the form rather than from the prose engine. An unsupplied side is left as the
 * library wrote it — the tile is not silently made unilateral.
 */
function sidePhrase(phrase: string, side: DorsoLumbarSide | undefined): string {
  const chosen = side === "left" || side === "right"
    ? side
    : side === "bilateral"
      ? "right and left"
      : "";
  return chosen ? phrase.replace(/right\/left/i, chosen) : phrase;
}

/** The canonical key a level-bound atom carries, so spellings cannot split a slot. */
function canonicalLevelOf(level: string | undefined): string | undefined {
  if (!level) return undefined;
  return canonicalDorsoLumbarLevel(level)?.key ?? level;
}

/** Library dimensions sentence, listing only the measurements actually given. */
function dimensionsPhrase(ctx: DorsoLumbarTileContext, subject: string): string {
  const parts = [
    ctx.cm != null ? `${ctx.cm} cm craniocaudal extent` : "",
    ctx.mm != null ? `${ctx.mm} mm transverse` : "",
    ctx.mm2 != null ? `${ctx.mm2} mm anteroposterior` : "",
  ].filter(Boolean);
  return parts.length === 0
    ? `${subject}: ${DL_INFECTION.dimensions} are not recorded on this entry.`
    : `${subject}: ${DL_INFECTION.dimensions} — ${parts.join(", ")}.`;
}

// ─── 1. ROUTINE / NORMAL (spec §8) ───────────────────────────────────────

const ROUTINE: DorsoLumbarSubMaster = {
  id: "routine",
  label: "Routine / Normal",
  hint: "Coverage-aware normal baseline for the whole dorso-lumbar examination.",
  tiles: [
    {
      id: "dlr-alignment-normal",
      label: "Normal dorso-lumbar alignment",
      group: "Baseline",
      atoms: () => [baseline("alignment", DL_ALIGN.normal, { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dlr-curves-preserved",
      label: "Thoracic kyphosis / lumbar lordosis preserved",
      group: "Baseline",
      atoms: () => [baseline("kyphosis", DL_ALIGN.curvesPreserved, { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dlr-bone-normal",
      label: "Normal vertebral bodies / marrow",
      group: "Baseline",
      atoms: () => [baseline("bone_lesion", DL_BONE.normal, { anatomicalSection: "dorso-lumbar spine", conflictGroup: "marrow_screen" })],
    },
    {
      id: "dlr-no-fracture",
      label: "No fracture or destructive marrow lesion",
      group: "Baseline",
      atoms: () => [baseline("compression_fracture", DL_BONE.noFracture, { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dlr-cord-normal",
      label: "Normal thoracic cord (only when the cord is covered)",
      group: "Baseline",
      requiresCord: true,
      atoms: (ctx) => [baseline("cord_caliber", DL_CANAL.cordNormal, { level: levelOf(ctx) })],
    },
    {
      id: "dlr-canal-normal",
      label: "Patent thoracic canal (only when covered)",
      group: "Baseline",
      requiresCord: true,
      atoms: (ctx) => [baseline("canal_stenosis", DL_CANAL.noCanalCompromise, { level: levelOf(ctx) })],
    },
    {
      id: "dlr-conus-normal",
      label: "Normal conus termination (only when covered)",
      group: "Baseline",
      requiresConus: true,
      atoms: (ctx) => [baseline("conus_medullaris", DL_JUNCTION.conusNormal, { anatomicalSection: ctx.level || "dorso-lumbar spine", level: levelOf(ctx) })],
    },
    {
      id: "dlr-numbering-basis",
      label: "State the numbering / coverage basis",
      group: "Baseline",
      atoms: (ctx) => {
        const caution = dorsolumbarNumberingCaution(ctx.state);
        if (!caution) {
          return [baseline("screening_limitation", DL_COVER.numberingDocumented, {
            anatomicalSection: "dorso-lumbar spine",
            conflictGroup: "dorsolumbar_numbering_caution",
          })];
        }
        return [a("screening_limitation", caution, {
          anatomicalSection: "dorso-lumbar spine",
          conflictGroup: "dorsolumbar_numbering_caution",
          role: "baseline",
        })];
      },
    },
    {
      id: "dlr-limited-coverage",
      label: "Coverage-limited assessment statement",
      group: "Baseline",
      atoms: (ctx) => {
        const absent: SpineSequenceKey[] = [];
        if (!ctx.sequences.axial) absent.push("axial");
        if (!ctx.sequences.stir) absent.push("stir");
        if (absent.length > 0) {
          return [baseline("screening_limitation", spineLimitationSentence(absent, "the corresponding abnormality"), {
            anatomicalSection: "dorso-lumbar spine",
            conflictGroup: "coverage_limitation",
          })];
        }
        return [baseline("screening_limitation", DL_COVER.limitedCoverage, {
          anatomicalSection: "dorso-lumbar spine",
          conflictGroup: "coverage_limitation",
        })];
      },
    },
  ],
};

// ─── 2. DEGENERATIVE / DISC (spec §11) ───────────────────────────────────

const DEGENERATIVE: DorsoLumbarSubMaster = {
  id: "degenerative",
  label: "Degenerative / Disc",
  hint: "Disc findings keep the context of the domain they sit in: cord at thoracic, roots at lumbar.",
  tiles: [
    {
      id: "dlg-disc-preserved",
      label: "Preserved disc height / signal",
      group: "Disc",
      atoms: (ctx) => [baseline("disc_signal", choice("discs", DL_DISC.preserved, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-disc-desiccation",
      label: "Disc desiccation / space reduction",
      group: "Disc",
      atoms: (ctx) => [a("disc_signal", choice("discs", DL_DEGEN.discDesiccation, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-disc-bulge",
      label: "Diffuse bulge",
      group: "Disc",
      atoms: (ctx) => [a("disc_contour", choice("discs", DL_DISC.diffuseBulge, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-disc-protrusion",
      label: "Broad-based protrusion",
      group: "Disc",
      atoms: (ctx) => [a("disc_contour", choice("discs", DL_DISC.broadProtrusion, ctx), { level: levelOf(ctx), conflictGroup: "disc_contour" })],
    },
    {
      id: "dlg-disc-focal",
      label: "Focal protrusion",
      group: "Disc",
      atoms: (ctx) => [a("disc_contour", choice("discs", DL_DISC.focalProtrusion, ctx), { level: levelOf(ctx), conflictGroup: "disc_contour" })],
    },
    {
      id: "dlg-disc-extrusion",
      label: "Extrusion",
      group: "Disc",
      atoms: (ctx) => [a("disc_contour", choice("discs", DL_DISC.extrusion, ctx), { level: levelOf(ctx), conflictGroup: "disc_contour", severity: "significant" })],
    },
    {
      id: "dlg-disc-migration",
      label: "Disc migration (when demonstrated)",
      group: "Disc",
      requiresExtent: true,
      atoms: (ctx) => [a("disc_migration", `${choice("discs", DL_DISC.migration, ctx)} Extent ${ctx.level2 ? `from ${ctx.level} to ${ctx.level2}` : ""}`.trim(), {
        level: levelOf(ctx),
        direction: ctx.direction,
      })],
    },
    {
      id: "dlg-disc-calcified",
      label: "Calcified / low-signal disc component (descriptive)",
      group: "Disc",
      atoms: (ctx) => [a("disc_contour", choice("discs", DL_DISC.calcified, ctx), { level: levelOf(ctx), conflictGroup: "disc_contour", state: "calcified" })],
    },
    {
      id: "dlg-endplate-degeneration",
      label: "Endplate degeneration",
      group: "Endplate",
      atoms: (ctx) => [a("endplate", choice("endplate", DL_DEGEN.endplateDegeneration, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-osteophytes",
      label: "Osteophytes",
      group: "Endplate",
      atoms: (ctx) => [a("osteophytes", choice("bone", DL_DEGEN.osteophytes, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-modic",
      label: "Modic endplate change (sequence criteria fulfilled)",
      group: "Endplate",
      requires: ["t1", "t2"],
      atoms: (ctx) => [a("endplate", lib(DL_BONE.modic, ctx), { level: levelOf(ctx), conflictGroup: "modic_endplate" })],
    },
    {
      id: "dlg-schmorl",
      label: "Schmorl node",
      group: "Endplate",
      atoms: (ctx) => [a("schmorl_node", lib(DL_BONE.schmorl, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-thoracic-disc-effect",
      label: "Thoracic disc with cord / canal effect",
      group: "Neural effect",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("cord_compression", `${choice("discs", DL_DEGEN.thoracicDisc, ctx)} ${neuralFrame(ctx)} effect at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_compression",
        state: "compression",
        severity: "significant",
      })],
    },
    {
      id: "dlg-facet-flavum",
      label: "Facet arthropathy with ligamentum flavum hypertrophy",
      group: "Lumbar degeneration",
      domains: ["lumbar"],
      atoms: (ctx) => [
        a("facet_joint", choice("posterior", DL_DEGEN.facet, ctx), { level: levelOf(ctx) }),
        a("ligamentum_flavum", choice("ligaments", DL_DEGEN.flavum, ctx), { level: levelOf(ctx) }),
      ],
    },
    {
      id: "dlg-neural-effect",
      label: "Canal / recess / foraminal degenerative effect",
      group: "Lumbar degeneration",
      domains: ["lumbar"],
      atoms: (ctx) => [a("canal_stenosis", choice("canal", DL_DEGEN.neuralEffect, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlg-adjacent-level",
      label: "Adjacent-level degeneration",
      group: "Lumbar degeneration",
      atoms: (ctx) => [a("adjacent_segment_degeneration", choice("discs", DL_DEGEN.neuralEffect, ctx), {
        level: levelOf(ctx),
        conflictGroup: "adjacent_segment_degeneration",
      })],
    },
  ],
};

// ─── 3. CANAL STENOSIS / NEURAL COMPRESSION (spec §12, §14) ──────────────

const CANALNEURAL: DorsoLumbarSubMaster = {
  id: "canalNeural",
  label: "Canal Stenosis / Neural Compression",
  hint: "The compressed element is named from the level's anatomy — cord, conus or cauda — never from the panel.",
  tiles: [
    {
      id: "dln-canal-mild",
      label: "Mild canal narrowing",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", lib(DL_CANAL.canalNarrowing, ctx), { level: levelOf(ctx), severity: "mild" })],
    },
    {
      id: "dln-canal-moderate",
      label: "Moderate canal narrowing",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", lib(DL_CANAL.canalNarrowing, ctx), { level: levelOf(ctx), severity: "moderate" })],
    },
    {
      id: "dln-canal-severe",
      label: "Severe canal narrowing",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", lib(DL_CANAL.canalNarrowing, ctx), { level: levelOf(ctx), severity: "severe" })],
    },
    {
      id: "dln-thecal-indentation",
      label: "Thecal sac indentation",
      group: "Canal",
      atoms: (ctx) => [a("canal_morphology", lib(DL_CANAL.thecalIndentation, ctx), { level: levelOf(ctx), conflictGroup: "canal_morphology" })],
    },
    {
      id: "dln-csf-partial",
      label: "Partial CSF effacement",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", "partial effacement of the posterior CSF space", ctx), {
        level: levelOf(ctx),
        conflictGroup: "canal_morphology",
      })],
    },
    {
      id: "dln-csf-complete",
      label: "Complete local CSF effacement",
      group: "Canal / CSF",
      atoms: (ctx) => [a("canal_morphology", choice("csf", "complete effacement of the CSF space at this level", ctx), {
        level: levelOf(ctx),
        conflictGroup: "canal_morphology",
      })],
    },
    {
      id: "dln-neural-compression",
      label: "Neural-element compression (named by level)",
      group: "Neural",
      atoms: (ctx) => [a("cord_compression", `${neuralFrame(ctx)}: ${dorsoLumbarNeuralWord(ctx)} compression at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_compression",
        state: "compression",
        severity: "significant",
      })],
    },
    {
      id: "dln-neural-flattening",
      label: "Neural-element flattening / deformation",
      group: "Neural",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("cord_caliber", lib(DL_CANAL.cordFlattening, ctx), {
        level: levelOf(ctx),
        conflictGroup: "cord_caliber",
        state: "flattening",
      })],
    },
    {
      id: "dln-neural-signal",
      label: "Intrinsic T2 / STIR signal abnormality",
      group: "Neural",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", ctx.domain === "lumbar"
        ? choice("cauda", "intrinsic signal abnormality of the neural elements", ctx)
        : lib(DL_CANAL.cordSignal, ctx), {
        level: levelOf(ctx),
        conflictGroup: "cord_signal",
        state: "signal",
      })],
    },
    {
      id: "dln-myelomalacia",
      label: "Cord volume loss / myelomalacic pattern (radiologist-selected)",
      group: "Neural",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("cord_caliber", lib(DL_CANAL.myelomalacia, ctx), {
        level: levelOf(ctx),
        conflictGroup: "cord_caliber",
        state: "atrophy",
      })],
    },
    {
      id: "dln-recess-left",
      label: "Left lateral recess narrowing",
      group: "Lumbar",
      domains: ["lumbar"],
      atoms: (ctx) => [a("lateral_recess_stenosis", choice("recess", sidePhrase(DL_LUMBAR.recessStenosis, "left"), ctx), {
        level: levelOf(ctx),
        laterality: "left",
        conflictGroup: "lateral_recess_left",
        severity: "moderate",
      })],
    },
    {
      id: "dln-recess-right",
      label: "Right lateral recess narrowing",
      group: "Lumbar",
      domains: ["lumbar"],
      atoms: (ctx) => [a("lateral_recess_stenosis", choice("recess", sidePhrase(DL_LUMBAR.recessStenosis, "right"), ctx), {
        level: levelOf(ctx),
        laterality: "right",
        conflictGroup: "lateral_recess_right",
        severity: "moderate",
      })],
    },
    {
      id: "dln-cauda-crowding",
      label: "Cauda-equina crowding / compression",
      group: "Lumbar",
      domains: ["lumbar"],
      requiresCauda: true,
      atoms: (ctx) => [a("cauda_equina", choice("cauda", DL_LUMBAR.cauda, ctx), {
        level: levelOf(ctx),
        conflictGroup: "cauda_equina",
        state: "crowding",
        severity: "significant",
      })],
    },
    {
      id: "dln-foraminal-thoracic",
      label: "Thoracic foraminal narrowing (side required)",
      group: "Foramina",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("foraminal_stenosis", lib(sidePhrase(DL_FORAMEN.thoracic, ctx.side), ctx), {
        level: levelOf(ctx),
        laterality: ctx.side,
        supportsLaterality: true,
        severity: "moderate",
      })],
    },
    {
      id: "dln-foraminal-lumbar",
      label: "Lumbar foraminal narrowing with exiting-root relationship",
      group: "Foramina",
      domains: ["lumbar"],
      requires: ["axial"],
      atoms: (ctx) => [a("foraminal_stenosis", lib(sidePhrase(DL_FORAMEN.lumbar, ctx.side), ctx), {
        level: levelOf(ctx),
        laterality: ctx.side,
        supportsLaterality: true,
        severity: "moderate",
      })],
    },
    {
      id: "dln-root-traversing",
      label: "Traversing-root contact (lumbar model, overridable)",
      group: "Foramina",
      domains: ["lumbar"],
      atoms: (ctx) => [a("root_traversing", choice("foramina", DL_LUMBAR.traversingRoot, ctx), {
        level: levelOf(ctx),
        laterality: ctx.side,
        root: ctx.root,
        supportsLaterality: true,
        conflictGroup: "root_traversing",
      })],
    },
    {
      id: "dln-root-exiting",
      label: "Exiting-root contact (lumbar model, overridable)",
      group: "Foramina",
      domains: ["lumbar"],
      atoms: (ctx) => [a("root_exiting", choice("foramina", DL_LUMBAR.exitingRoot, ctx), {
        level: levelOf(ctx),
        laterality: ctx.side,
        root: ctx.root,
        supportsLaterality: true,
        conflictGroup: "root_exiting",
      })],
    },
    {
      id: "dln-conus-compression",
      label: "Conus compression (junction only, when covered)",
      group: "Junction",
      domains: ["junction"],
      requiresConus: true,
      atoms: (ctx) => [a("conus_medullaris", `${SECTION_FRAMES.conus}: ${DL_JUNCTION.conusCompression} at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "conus_compression",
        state: "compression",
        severity: "significant",
      })],
    },
  ],
};

// ─── 4. THORACOLUMBAR JUNCTION / CONUS (spec §12 — the defining palette) ──

const JUNCTION: DorsoLumbarSubMaster = {
  id: "junction",
  label: "Thoracolumbar Junction / Conus",
  hint: "One bridge, entered once: alignment, discs, conus and the cord→conus→cauda transition.",
  tiles: [
    {
      id: "dlj-alignment",
      label: "Junctional alignment (T10-L2)",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [a("alignment", lib(DL_JUNCTION.alignment, ctx), {
        anatomicalSection: ctx.level || "dorso-lumbar spine",
        level: levelOf(ctx),
        conflictGroup: "junction_alignment",
      })],
    },
    {
      id: "dlj-disc-disease",
      label: "Junctional disc / endplate disease where covered",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [a("disc_contour", lib(DL_JUNCTION.discDisease, ctx), { level: levelOf(ctx), conflictGroup: "junction_disc" })],
    },
    {
      id: "dlj-fracture",
      label: "Junctional fracture / retropulsion",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [
        a("compression_fracture", lib(DL_JUNCTION.fracture, ctx), { level: levelOf(ctx), conflictGroup: "junction_fracture" }),
        a("retropulsion", `${SECTION_FRAMES.junction}: ${DL_TRAUMA.retropulsion} at ${ctx.level}.`, {
          level: levelOf(ctx),
          conflictGroup: "junction_retropulsion",
        }),
      ],
    },
    {
      id: "dlj-plc",
      label: "Posterior ligamentous complex observations",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [a("posterior_ligamentous_complex", lib(DL_JUNCTION.plc, ctx), {
        level: levelOf(ctx),
        conflictGroup: "junction_plc",
      })],
    },
    {
      id: "dlj-epidural",
      label: "Junctional epidural collection / hematoma / mass",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [a("epidural_collection", lib(DL_JUNCTION.epidural, ctx), { level: levelOf(ctx), conflictGroup: "junction_epidural" })],
    },
    {
      id: "dlj-conus-level",
      label: "Conus termination level (must be stated)",
      group: "Conus",
      requiresConus: true,
      atoms: (ctx) => [a("conus_medullaris", `${SECTION_FRAMES.conus}: ${DL_JUNCTION.conusLevel} at ${ctx.conusLevel ?? ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "conus_level",
      })],
    },
    {
      id: "dlj-conus-caliber-signal",
      label: "Conus caliber and signal",
      group: "Conus",
      requiresConus: true,
      atoms: (ctx) => [a("conus_medullaris", `${SECTION_FRAMES.conus}: ${DL_JUNCTION.conusCaliberSignal}.`, {
        level: levelOf(ctx),
        conflictGroup: "conus_caliber_signal",
      })],
    },
    {
      id: "dlj-conus-signal",
      label: "Intrinsic conus T2 / STIR signal",
      group: "Conus",
      requires: ["t2"],
      requiresConus: true,
      atoms: (ctx) => [a("cord_signal", lib(DL_JUNCTION.conusSignal, ctx), {
        level: levelOf(ctx),
        conflictGroup: "conus_signal",
        state: "signal",
      })],
    },
    {
      id: "dlj-transition",
      label: "Cord → conus → cauda transition described",
      group: "Conus",
      requiresJunction: true,
      requiresCauda: true,
      atoms: (ctx) => [a("conus_medullaris", `${SECTION_FRAMES.conus}: ${DL_JUNCTION.transition} Documented at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "conus_transition",
      })],
    },
    {
      id: "dlj-extension",
      label: "Paravertebral / psoas extension when included",
      group: "Junction",
      requiresJunction: true,
      atoms: (ctx) => [a("paravertebral_collection", lib(DL_JUNCTION.extension, ctx), {
        level: levelOf(ctx),
        conflictGroup: "junction_extension",
      })],
    },
  ],
};

// ─── 5. OPLL / OLF / DISH (spec §16) ─────────────────────────────────────

const OSSIFICATION: DorsoLumbarSubMaster = {
  id: "ossification",
  label: "OPLL / OLF / DISH",
  hint: "MRI may suggest ossification; the pattern is radiologist-selected and CT may characterize it better.",
  tiles: [
    {
      id: "dlo-flavum-thickening",
      label: "Ligamentum flavum low-signal thickening",
      group: "Ligament",
      atoms: (ctx) => [a("ligamentum_flavum", choice("ligaments", DL_OSSIFICATION.flavum, ctx), {
        level: levelOf(ctx),
        conflictGroup: "olf_pattern",
      })],
    },
    {
      id: "dlo-opl-thickening",
      label: "Posterior longitudinal ligament low-signal thickening",
      group: "Ligament",
      atoms: (ctx) => [a("opl_ossification", choice("canal", DL_OSSIFICATION.opl, ctx), {
        level: levelOf(ctx),
        conflictGroup: "opl_pattern",
      })],
    },
    {
      id: "dlo-olf-pattern",
      label: "OLF pattern (radiologist-selected)",
      group: "Selected diagnosis",
      atoms: (ctx) => [a("olf", lib(DL_CANAL.ossificationPattern, ctx), { level: levelOf(ctx), conflictGroup: "olf_pattern" })],
    },
    {
      id: "dlo-opll-pattern",
      label: "OPLL pattern (radiologist-selected)",
      group: "Selected diagnosis",
      atoms: (ctx) => [a("opl_ossification", lib(DL_CANAL.ossificationPattern, ctx), { level: levelOf(ctx), conflictGroup: "opl_pattern" })],
    },
    {
      id: "dlo-effect",
      label: "Canal / neural effect of the ossified strip",
      group: "Effect",
      atoms: (ctx) => [a("canal_stenosis", `${choice("canal", DL_OSSIFICATION.effect, ctx)} ${dorsoLumbarNeuralWord(ctx)} effect as described.`, {
        level: levelOf(ctx),
      })],
    },
    {
      id: "dlo-dish-pattern",
      label: "Flowing / bridging ALL ossification pattern",
      group: "Selected diagnosis",
      requiresExtent: true,
      atoms: (ctx) => [
        a("dish", lib(DL_OSSIFICATION.dish, ctx), { anatomicalSection: "dorso-lumbar spine" }),
        a("ankylosing_pattern", `${SECTION_FRAMES.deformity}: Bridging pattern extends from ${ctx.level} to ${ctx.level2}.`, {
          anatomicalSection: "dorso-lumbar spine",
          conflictGroup: "dish_extent",
        }),
      ],
    },
    {
      id: "dlo-ct-recommendation",
      label: "CT characterization recommendation",
      group: "Recommendation",
      atoms: (ctx) => [a("screening_recommendation", DL_OSSIFICATION.ctNote, {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        conflictGroup: "ossification_ct",
        role: "recommendation",
      })],
    },
    {
      id: "dlo-spanning-junction",
      label: "Pathology extending across the junction",
      group: "Extent",
      requiresJunction: true,
      requiresExtent: true,
      atoms: (ctx) => [a("ligamentum_flavum", `${SECTION_FRAMES.ligaments}: Continuous abnormality from ${ctx.level} to ${ctx.level2}, crossing the thoracolumbar junction.`, {
        anatomicalSection: ctx.level,
        conflictGroup: "ossification_across_junction",
      })],
    },
  ],
};

// ─── 6. TRAUMA (spec §17) ────────────────────────────────────────────────

const TRAUMA: DorsoLumbarSubMaster = {
  id: "trauma",
  label: "Trauma",
  hint: "Fracture morphology, canal compromise and neural effect; instability is not declared from supine MRI.",
  tiles: [
    {
      id: "dlt-fracture",
      label: "Acute / subacute compression or wedge fracture",
      group: "Fracture",
      atoms: (ctx) => [a("compression_fracture", lib(DL_BONE.acuteFracture, ctx), { level: levelOf(ctx), state: "acute" })],
    },
    {
      id: "dlt-burst",
      label: "Burst-fracture pattern with posterior cortical involvement",
      group: "Fracture",
      atoms: (ctx) => [
        a("compression_fracture", lib(DL_BONE.burst, ctx), { level: levelOf(ctx), conflictGroup: "fracture_morphology", state: "burst" }),
        a("retropulsion", choice("bone", DL_TRAUMA.retropulsion, ctx), { level: levelOf(ctx), conflictGroup: "retropulsion" }),
      ],
    },
    {
      id: "dlt-height-loss",
      label: "Vertebral height loss (percentage)",
      group: "Morphology",
      atoms: (ctx) => [a("vertebral_collapse", `${choice("bone", DL_TRAUMA.heightLoss, ctx)}${ctx.pct != null ? ` approximately ${ctx.pct}%` : ""}.`, {
        level: levelOf(ctx),
        measurement: ctx.pct != null ? String(ctx.pct) : undefined,
      })],
    },
    {
      id: "dlt-posterior-wall",
      label: "Posterior-wall involvement",
      group: "Morphology",
      atoms: (ctx) => [a("retropulsion", choice("bone", DL_TRAUMA.posteriorWall, ctx), { level: levelOf(ctx), conflictGroup: "posterior_wall" })],
    },
    {
      id: "dlt-marrow-edema",
      label: "Marrow edema (STIR hyperintense)",
      group: "Morphology",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("bone", DL_TRAUMA.marrowEdema, ctx), { level: levelOf(ctx), state: "edema" })],
    },
    {
      id: "dlt-chronic-wedging",
      label: "Chronic wedging without marrow edema",
      group: "Morphology",
      atoms: (ctx) => [a("vertebral_collapse", lib(DL_BONE.chronicWedging, ctx), { level: levelOf(ctx), state: "chronic" })],
    },
    {
      id: "dlt-posterior-element",
      label: "Posterior-element injury",
      group: "Posterior column",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", DL_TRAUMA.posteriorElement, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlt-plc",
      label: "Posterior ligamentous complex observations",
      group: "Posterior column",
      atoms: (ctx) => [a("posterior_ligamentous_complex", choice("plc", DL_TRAUMA.plc, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlt-epidural-hematoma",
      label: "Epidural hematoma",
      group: "Canal",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", DL_TRAUMA.epiduralHematoma, ctx), {
        level: levelOf(ctx),
        conflictGroup: "epidural_hematoma",
        state: "hematoma",
      })],
    },
    {
      id: "dlt-canal-compromise",
      label: "Canal compromise",
      group: "Canal",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", DL_TRAUMA.canalCompromise, ctx), { level: levelOf(ctx), severity: "significant" })],
    },
    {
      id: "dlt-neural-compression",
      label: "Cord / conus / cauda compression (named by level)",
      group: "Neural",
      atoms: (ctx) => [a(ctx.domain === "lumbar" ? "cauda_equina" : "cord_compression",
        `${neuralFrame(ctx)}: ${dorsoLumbarNeuralWord(ctx)} compression at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_compression",
        state: "compression",
        severity: "significant",
      })],
    },
    {
      id: "dlt-neural-signal",
      label: "Intrinsic cord / conus T2 signal",
      group: "Neural",
      requires: ["t2"],
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("cord_signal", choice("cord", DL_TRAUMA.signal, ctx), { level: levelOf(ctx), conflictGroup: "cord_signal", state: "signal" })],
    },
    {
      id: "dlt-soft-tissue",
      label: "Paravertebral soft-tissue injury",
      group: "Soft tissue",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", DL_TRAUMA.softTissue, ctx), { level: levelOf(ctx), conflictGroup: "paravertebral" })],
    },
    {
      id: "dlt-no-instability-claim",
      label: "Mechanical instability not declared from supine MRI",
      group: "Safety",
      atoms: (ctx) => [a("screening_limitation", `${SECTION_FRAMES.coverage}: Mechanical instability cannot be declared from a supine MRI examination; clinical and upright or CT correlation remains with the treating team.`, {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        conflictGroup: "trauma_instability_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 7. INFECTION / SPONDYLODISCITIS (spec §18) ──────────────────────────

const INFECTION: DorsoLumbarSubMaster = {
  id: "infection",
  label: "Infection / Spondylodiscitis",
  hint: "Cross-junction infection is ONE pathology object; etiology stays radiologist-selected.",
  tiles: [
    {
      id: "dli-spondylodiscitis",
      label: "Spondylodiscitis of the involved vertebrae and disc",
      group: "Infection",
      atoms: (ctx) => [a("spondylodiscitis", `${SECTION_FRAMES.discs}: ${DL_INFECTION.involved} at ${ctx.level}${ctx.level2 ? ` through ${ctx.level2}` : ""}.`, {
        level: levelOf(ctx),
        conflictGroup: "spondylodiscitis",
      })],
    },
    {
      id: "dli-endplate-destruction",
      label: "Endplate erosion / destruction",
      group: "Infection",
      atoms: (ctx) => [a("endplate_erosion", choice("endplate", DL_INFECTION.endplate, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dli-disc-signal",
      label: "Abnormal disc / endplate inflammatory signal",
      group: "Infection",
      requires: ["stir"],
      atoms: (ctx) => [a("disc_signal", choice("discs", DL_DISC.inflammatorySignal, ctx), { level: levelOf(ctx), conflictGroup: "disc_signal" })],
    },
    {
      id: "dli-marrow-edema",
      label: "Marrow edema",
      group: "Infection",
      requires: ["stir"],
      atoms: (ctx) => [a("marrow_edema", choice("bone", DL_INFECTION.marrowEdema, ctx), { level: levelOf(ctx), state: "edema" })],
    },
    {
      id: "dli-collapse",
      label: "Vertebral collapse",
      group: "Infection",
      atoms: (ctx) => [a("vertebral_collapse", choice("bone", DL_INFECTION.collapse, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dli-gibbus",
      label: "Kyphosis / gibbus at the infected level",
      group: "Deformity",
      atoms: (ctx) => [a("gibbus_deformity", choice("deformity", DL_INFECTION.kyphosis, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dli-epidural",
      label: "Epidural component",
      group: "Extension",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", DL_INFECTION.epidural, ctx), { level: levelOf(ctx), conflictGroup: "epidural_collection" })],
    },
    {
      id: "dli-paravertebral",
      label: "Pre / paravertebral collection",
      group: "Extension",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", DL_INFECTION.paravertebral, ctx), { level: levelOf(ctx), conflictGroup: "paravertebral" })],
    },
    {
      id: "dli-psoas",
      label: "Psoas extension (only when covered)",
      group: "Extension",
      domains: ["lumbar", "junction"],
      atoms: (ctx) => [a("paravertebral_collection", lib(DL_SOFT.psoas, ctx), { level: levelOf(ctx), conflictGroup: "psoas_extension" })],
    },
    {
      id: "dli-dimensions",
      label: "Collection dimensions and craniocaudal extent",
      group: "Measurement",
      requiresExtent: true,
      atoms: (ctx) => [a("epidural_collection", dimensionsPhrase(ctx, SECTION_FRAMES.soft), {
        level: levelOf(ctx),
        conflictGroup: "collection_dimensions",
        measurement: ctx.cm != null ? String(ctx.cm) : undefined,
      })],
    },
    {
      id: "dli-canal-compromise",
      label: "Canal compromise",
      group: "Effect",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", DL_INFECTION.canal, ctx), { level: levelOf(ctx), severity: "significant" })],
    },
    {
      id: "dli-neural-compression",
      label: "Cord / conus / cauda compression (named by level)",
      group: "Effect",
      atoms: (ctx) => [a(ctx.domain === "lumbar" ? "cauda_equina" : "cord_compression",
        `${neuralFrame(ctx)}: ${dorsoLumbarNeuralWord(ctx)} compression at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_compression",
        state: "compression",
        severity: "significant",
      })],
    },
    {
      id: "dli-enhancement",
      label: "Enhancement (only when contrast was performed)",
      group: "Contrast",
      requires: ["contrast"],
      atoms: (ctx) => [a("spondylodiscitis", `${SECTION_FRAMES.infection ?? "Infection"}: ${DL_INFECTION.enhancement}`, {
        level: levelOf(ctx),
        conflictGroup: "infection_enhancement",
        state: "enhancement",
      })],
    },
    {
      id: "dli-no-contrast-limitation",
      label: "Contrast not performed — enhancement cannot be assessed",
      group: "Contrast",
      atoms: (ctx) => [a("screening_limitation", spineLimitationSentence(["contrast"], "assessment of enhancement"), {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        conflictGroup: "contrast_limitation",
        role: "baseline",
      })],
    },
    {
      id: "dli-etiology-radiologist",
      label: "Etiology remains radiologist-selected (TB / Pott not auto-generated)",
      group: "Safety",
      atoms: () => [a("screening_limitation", "Infective spondylodiscitis and any tuberculous etiology are radiologist-selected determinations; the presence of a collection alone does not generate them.", {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "infection_etiology_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 8. TUMOR / MARROW / METASTASIS (spec §19) ───────────────────────────

const TUMOR: DorsoLumbarSubMaster = {
  id: "tumorMarrow",
  label: "Tumor / Marrow / Metastasis",
  hint: "A lesion that spans the junction is recorded once, with its extensions attached.",
  tiles: [
    {
      id: "dltm-marrow-lesion",
      label: "Focal / multifocal marrow lesion",
      group: "Marrow",
      atoms: (ctx) => [a("bone_lesion", lib(DL_TUMOR.marrowLesion, ctx), { level: levelOf(ctx), conflictGroup: "marrow_lesion" })],
    },
    {
      id: "dltm-hemangioma",
      label: "Hemangioma characteristics (radiologist-selected)",
      group: "Marrow",
      requires: ["t1", "t2", "stir"],
      atoms: (ctx) => [a("bone_lesion", lib(DL_BONE.hemangioma, ctx), { level: levelOf(ctx), conflictGroup: "hemangioma_selected" })],
    },
    {
      id: "dltm-pathologic-fracture",
      label: "Vertebral collapse / pathological fracture",
      group: "Bone",
      atoms: (ctx) => [a("vertebral_collapse", lib(DL_TUMOR.collapse, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dltm-posterior-element",
      label: "Posterior-element involvement",
      group: "Bone",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", DL_TUMOR.posteriorElement, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dltm-epidural-extension",
      label: "Epidural extension",
      group: "Extension",
      atoms: (ctx) => [a("epidural_space", choice("epidural", DL_TUMOR.epidural, ctx), { level: levelOf(ctx), conflictGroup: "epidural_extension" })],
    },
    {
      id: "dltm-paravertebral-extension",
      label: "Paravertebral extension",
      group: "Extension",
      atoms: (ctx) => [a("paravertebral_collection", choice("soft", DL_TUMOR.paravertebral, ctx), { level: levelOf(ctx), conflictGroup: "paravertebral_extension" })],
    },
    {
      id: "dltm-canal-compromise",
      label: "Canal compromise",
      group: "Effect",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", DL_TUMOR.canal, ctx), { level: levelOf(ctx), severity: "significant" })],
    },
    {
      id: "dltm-neural-effect",
      label: "Cord / conus / cauda effect (named by level)",
      group: "Effect",
      atoms: (ctx) => [a("cord_compression", `${neuralFrame(ctx)}: ${dorsoLumbarNeuralWord(ctx)} effect at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_compression",
        state: "effect",
      })],
    },
    {
      id: "dltm-intradural-component",
      label: "Intradural / intramedullary component",
      group: "Extension",
      atoms: (ctx) => [a("intradural_lesion", choice("intradural", DL_TUMOR.intradural, ctx), { level: levelOf(ctx), conflictGroup: "intradural_component" })],
    },
    {
      id: "dltm-enhancement",
      label: "Enhancement pattern (only when contrast exists)",
      group: "Contrast",
      requires: ["contrast"],
      atoms: (ctx) => [a("bone_lesion", `${SECTION_FRAMES.bone}: ${DL_TUMOR.enhancement}`, {
        level: levelOf(ctx),
        conflictGroup: "lesion_enhancement",
        state: "enhancement",
      })],
    },
    {
      id: "dltm-spanning-lesion",
      label: "Lesion spanning the junction (one object, two levels)",
      group: "Extent",
      requiresExtent: true,
      requiresJunction: true,
      atoms: (ctx) => [a("bone_lesion", `${SECTION_FRAMES.bone}: Single lesion extending from ${ctx.level} to ${ctx.level2} across the thoracolumbar junction.`, {
        anatomicalSection: canonicalLevelOf(ctx.level),
        level: canonicalLevelOf(ctx.level),
        conflictGroup: "lesion_across_junction",
      })],
    },
    {
      id: "dltm-no-metastasis-claim",
      label: "Indeterminate marrow lesion is not auto-labelled metastasis",
      group: "Safety",
      atoms: () => [a("screening_limitation", "A focal or multifocal marrow signal abnormality is reported descriptively; metastatic disease is a radiologist-selected determination.", {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "marrow_etiology_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 9. INTRADURAL / INTRAMEDULLARY (spec §20) ───────────────────────────

const INTRADURAL: DorsoLumbarSubMaster = {
  id: "intradural",
  label: "Intradural / Intramedullary",
  hint: "Compartment, expansion and signal kept separate; the named tumour stays radiologist-selected.",
  tiles: [
    {
      id: "dld-intramedullary",
      label: "Intramedullary cord / conus lesion",
      group: "Compartment",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("intramedullary_lesion", choice("intramedullary", DL_INTRADURAL.intramedullary, ctx), {
        level: levelOf(ctx),
        conflictGroup: "intramedullary_lesion",
      })],
    },
    {
      id: "dld-extramedullary",
      label: "Intradural extramedullary lesion",
      group: "Compartment",
      atoms: (ctx) => [a("intradural_lesion", choice("intradural", DL_INTRADURAL.extramedullary, ctx), {
        level: levelOf(ctx),
        conflictGroup: "intradural_lesion",
      })],
    },
    {
      id: "dld-expansion",
      label: "Cord / conus expansion",
      group: "Morphology",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("cord_caliber", `${neuralFrame(ctx)}: ${DL_INTRADURAL.expansion} at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_caliber",
        state: "expansion",
      })],
    },
    {
      id: "dld-signal",
      label: "Intrinsic signal abnormality",
      group: "Morphology",
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", `${neuralFrame(ctx)}: ${DL_INTRADURAL.signal} at ${ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_signal",
        state: "signal",
      })],
    },
    {
      id: "dld-edema",
      label: "Associated cord edema",
      group: "Morphology",
      domains: ["thoracic", "junction"],
      requires: ["t2"],
      atoms: (ctx) => [a("cord_signal", `${neuralFrame(ctx)}: ${DL_INTRADURAL.edema}.`, {
        level: levelOf(ctx),
        conflictGroup: "cord_edema",
        state: "edema",
      })],
    },
    {
      id: "dld-syrinx",
      label: "Syrinx / central cavitation",
      group: "Morphology",
      requires: ["t2"],
      atoms: (ctx) => [a("syrinx", choice("intramedullary", "central cavitation / syrinx", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dld-extent-across-junction",
      label: "Lesion extent across the junction",
      group: "Extent",
      requiresExtent: true,
      requiresJunction: true,
      atoms: (ctx) => [a("intradural_lesion", `${SECTION_FRAMES.intradural}: Lesion extends from ${ctx.level} to ${ctx.level2}, crossing the thoracolumbar junction as ONE lesion.`, {
        anatomicalSection: canonicalLevelOf(ctx.level),
        level: canonicalLevelOf(ctx.level),
        conflictGroup: "lesion_across_junction",
      })],
    },
    {
      id: "dld-cauda-lesion",
      label: "Cauda-equina / filum lesion (lumbar coverage only)",
      group: "Compartment",
      domains: ["lumbar"],
      requiresCauda: true,
      atoms: (ctx) => [a("cauda_equina", choice("cauda", "cauda equina / filum terminale lesion", ctx), {
        level: levelOf(ctx),
        conflictGroup: "cauda_lesion",
      })],
    },
    {
      id: "dld-tumor-diagnosis-limitation",
      label: "Specific tumour diagnosis is radiologist-selected",
      group: "Safety",
      atoms: () => [a("screening_limitation", "Compartment and signal characteristics are descriptive; a specific tumour diagnosis is radiologist-selected.", {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "intradural_etiology_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 10. VASCULAR / dAVF PATTERN (spec §20) ──────────────────────────────

const VASCULAR: DorsoLumbarSubMaster = {
  id: "vascular",
  label: "Vascular / dAVF Pattern",
  hint: "Flow voids and cord edema are described; a dAVF is named only by the radiologist.",
  tiles: [
    {
      id: "dlv-flow-voids",
      label: "Serpiginous perimedullary flow-void pattern",
      group: "Vessels",
      requires: ["t2"],
      atoms: (ctx) => [a("spinal_flow_voids", choice("vascular", DL_INTRADURAL.flowVoid, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlv-flow-voids-with-edema",
      label: "Flow voids with cord edema (pattern)",
      group: "Vessels",
      requires: ["t2"],
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [
        a("spinal_flow_voids", choice("vascular", DL_INTRADURAL.flowVoid, ctx), { level: levelOf(ctx), conflictGroup: "spinal_flow_voids" }),
        a("cord_signal", `${SECTION_FRAMES.cord}: ${DL_INTRADURAL.edema}.`, { level: levelOf(ctx), conflictGroup: "cord_edema", state: "edema" }),
      ],
    },
    {
      id: "dlv-hemorrhage",
      label: "Hemorrhage / blooming (only when GRE or SWI performed)",
      group: "Vessels",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", "hemorrhagic collection with susceptibility blooming", ctx), {
        level: levelOf(ctx),
        conflictGroup: "hemorrhage_pattern",
        state: "hemorrhage",
      })],
      requires: ["contrast"],
    },
    {
      id: "dlv-davf-selected",
      label: "dAVF pattern (radiologist-selected wording)",
      group: "Selected diagnosis",
      advanced: true,
      domains: ["thoracic", "junction", "lumbar"],
      atoms: (ctx) => [a("spinal_flow_voids", `${SECTION_FRAMES.vascular}: Dilated serpiginous perimedullary vessels with cord/conus edema, a pattern that raises the possibility of a spinal vascular malformation; definitive diagnosis and angiographic correlation remain radiologist-selected.`, {
        level: levelOf(ctx),
        conflictGroup: "davf_selected",
      })],
    },
    {
      id: "dlv-angiography-recommendation",
      label: "Angiography correlation recommendation",
      group: "Recommendation",
      atoms: (ctx) => [a("screening_recommendation", "Spinal digital subtraction angiography is recommended for definitive characterization when a vascular malformation is suspected.", {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        conflictGroup: "vascular_recommendation",
        role: "recommendation",
      })],
    },
  ],
};

// ─── 11. POST-OPERATIVE (spec §21) ───────────────────────────────────────

const POSTOP: DorsoLumbarSubMaster = {
  id: "postop",
  label: "Post-operative",
  hint: "Decompression, fusion and hardware recorded across thoracic, junctional and lumbar levels.",
  tiles: [
    {
      id: "dlp-decompression",
      label: "Decompression / laminectomy (level range)",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", `${SECTION_FRAMES.posterior}: ${DL_POSTOP.decompression} at ${ctx.level}${ctx.level2 ? ` through ${ctx.level2}` : ""}.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_procedure",
      })],
    },
    {
      id: "dlp-fusion",
      label: "Fixation / fusion",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", `${SECTION_FRAMES.hardware}: ${DL_POSTOP.fusion} at ${ctx.level}${ctx.level2 ? ` through ${ctx.level2}` : ""}.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_fusion",
      })],
    },
    {
      id: "dlp-hardware",
      label: "Screws / rods / cages recorded",
      group: "Procedure",
      atoms: (ctx) => [a("hardware_postop", `${SECTION_FRAMES.hardware}: ${DL_POSTOP.hardware} at ${ctx.level}.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_hardware",
      })],
    },
    {
      id: "dlp-operated-levels",
      label: "Operated levels enumerated (spans the junction)",
      group: "Procedure",
      requiresExtent: true,
      atoms: (ctx) => [a("hardware_postop", `${SECTION_FRAMES.coverage}: ${DL_POSTOP.operatedLevels} — ${ctx.level} to ${ctx.level2}, including the thoracolumbar junction where covered.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_levels",
      })],
    },
    {
      id: "dlp-alignment",
      label: "Post-operative alignment",
      group: "Follow-up",
      atoms: (ctx) => [a("alignment", `${SECTION_FRAMES.alignment}: ${DL_POSTOP.alignment} post-operatively.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_alignment",
      })],
    },
    {
      id: "dlp-recurrent",
      label: "Residual / recurrent canal compromise",
      group: "Follow-up",
      atoms: (ctx) => [a("canal_stenosis", choice("canal", DL_POSTOP.recurrent, ctx), { level: levelOf(ctx), conflictGroup: "postop_recurrent" })],
    },
    {
      id: "dlp-collection",
      label: "Epidural / post-operative collection",
      group: "Follow-up",
      atoms: (ctx) => [a("epidural_collection", choice("epidural", DL_POSTOP.collection, ctx), { level: levelOf(ctx), conflictGroup: "postop_collection" })],
    },
    {
      id: "dlp-artifact",
      label: "Hardware-related artifact limiting assessment",
      group: "Limitation",
      atoms: (ctx) => [a("screening_limitation", `${SECTION_FRAMES.hardware}: ${DL_POSTOP.artifact} limits assessment at ${ctx.level}.`, {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        conflictGroup: "postop_artifact",
        role: "baseline",
      })],
    },
    {
      id: "dlp-adjacent",
      label: "Adjacent-level degeneration",
      group: "Follow-up",
      atoms: (ctx) => [a("adjacent_segment_degeneration", choice("discs", DL_POSTOP.adjacent, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dlp-no-loosening-claim",
      label: "Loosening is not inferred from nonspecific signal",
      group: "Safety",
      atoms: () => [a("screening_limitation", "Hardware loosening is stated only when morphologically demonstrated; nonspecific peri-hardware signal change is not reported as loosening.", {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "postop_loosening_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 12. DEFORMITY / KYPHOSIS / SCOLIOSIS (spec §9) ──────────────────────

const DEFORMITY: DorsoLumbarSubMaster = {
  id: "deformity",
  label: "Deformity / Kyphosis / Scoliosis",
  hint: "Curvature is described across both halves; etiology is never assigned from curvature alone.",
  tiles: [
    {
      id: "dldf-hyperkyphosis",
      label: "Exaggerated thoracic kyphosis",
      group: "Curvature",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("kyphosis", lib(DL_ALIGN.hyperkyphosis, ctx), { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dldf-kyphosis-reversed",
      label: "Straightening / reversal of thoracic kyphosis",
      group: "Curvature",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("kyphosis", lib(DL_ALIGN.kyphosisStraightened, ctx), { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dldf-lordosis-lost",
      label: "Loss / straightening of lumbar lordosis",
      group: "Curvature",
      domains: ["lumbar"],
      atoms: (ctx) => [a("kyphosis", lib(DL_ALIGN.lordosisLost, ctx), { anatomicalSection: "dorso-lumbar spine", conflictGroup: "lumbar_lordosis" })],
    },
    {
      id: "dldf-junction-kyphosis",
      label: "Focal junction kyphosis / gibbus",
      group: "Curvature",
      domains: ["junction"],
      requiresJunction: true,
      atoms: (ctx) => [a("gibbus_deformity", lib(DL_ALIGN.junctionKyphosis, ctx), {
        anatomicalSection: canonicalLevelOf(ctx.level),
        level: canonicalLevelOf(ctx.level),
        conflictGroup: "junction_gibbus",
      })],
    },
    {
      id: "dldf-scoliosis",
      label: "Scoliotic curvature (convexity and apex)",
      group: "Curvature",
      atoms: (ctx) => [a("scoliosis", lib(DL_ALIGN.scoliosis, ctx), { anatomicalSection: "dorso-lumbar spine" })],
    },
    {
      id: "dldf-rotation",
      label: "Vertebral rotation where appropriate",
      group: "Curvature",
      advanced: true,
      atoms: (ctx) => [a("scoliosis", choice("deformity", "rotational deformity of the vertebrae at the curve apex", ctx), {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "vertebral_rotation",
      })],
    },
    {
      id: "dldf-listhesis",
      label: "Anterolisthesis / retrolisthesis with measurement",
      group: "Alignment",
      atoms: (ctx) => [a("spondylolisthesis", lib(DL_ALIGN.listhesis, ctx), {
        level: levelOf(ctx),
        measurement: ctx.mm != null ? String(ctx.mm) : undefined,
      })],
    },
    {
      id: "dldf-dynamic-listhesis",
      label: "Dynamic listhesis (only with dynamic imaging)",
      group: "Alignment",
      requires: ["dynamic"],
      advanced: true,
      atoms: (ctx) => [a("listhesis_dynamic", choice("alignment", "translation on dynamic imaging", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dldf-spanning-junction",
      label: "Deformity spanning the junction",
      group: "Curvature",
      requiresJunction: true,
      requiresExtent: true,
      atoms: (ctx) => [a("kyphosis", `${SECTION_FRAMES.deformity}: Curvature spans from ${ctx.level} to ${ctx.level2} across the thoracolumbar junction.`, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "deformity_across_junction",
      })],
    },
    {
      id: "dldf-no-etiology-claim",
      label: "Etiology is not auto-assigned from curvature",
      group: "Safety",
      atoms: () => [a("screening_limitation", "Curvature is described; the cause of a kyphotic or scoliotic deformity is not assigned by the reporting software.", {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "deformity_etiology_limitation",
        role: "baseline",
      })],
    },
  ],
};

// ─── 13. CONGENITAL / DEVELOPMENTAL / LSTV (spec §5, §9) ─────────────────

const CONGENITAL: DorsoLumbarSubMaster = {
  id: "congenital",
  label: "Congenital / Developmental / LSTV",
  hint: "Transitional anatomy is described and its numbering consequence stated — never propagated upward.",
  tiles: [
    {
      id: "dlc-segmentation",
      label: "Segmentation anomaly",
      group: "Developmental",
      atoms: (ctx) => [a("bone_lesion", choice("bone", DL_DEFORMITY.segmentation, ctx), { level: levelOf(ctx), conflictGroup: "segmentation_anomaly" })],
    },
    {
      id: "dlc-hemivertebra",
      label: "Hemivertebra",
      group: "Developmental",
      atoms: (ctx) => [a("bone_lesion", choice("bone", DL_DEFORMITY.hemivertebra, ctx), { level: levelOf(ctx), conflictGroup: "hemivertebra" })],
    },
    {
      id: "dlc-block-vertebra",
      label: "Block vertebra",
      group: "Developmental",
      atoms: (ctx) => [a("bone_lesion", choice("bone", DL_DEFORMITY.blockVertebra, ctx), { level: levelOf(ctx), conflictGroup: "block_vertebra" })],
    },
    {
      id: "dlc-lstv",
      label: "Lumbosacral transitional vertebra (when covered)",
      group: "Transitional",
      domains: ["lumbar"],
      requiresTransitional: true,
      atoms: (ctx) => [a("transitional_vertebra", lib(DL_DEFORMITY.lstv, ctx), {
        anatomicalSection: levelOf(ctx) ?? "dorso-lumbar spine",
        level: levelOf(ctx),
        conflictGroup: "lstv",
      })],
    },
    {
      id: "dlc-bertolotti",
      label: "Bertolotti-type facet joint (radiologist-selected)",
      group: "Transitional",
      domains: ["lumbar"],
      requiresTransitional: true,
      advanced: true,
      atoms: (ctx) => [a("bertolotti_syndrome", choice("posterior", "enlarged transverse process with a pseudo-articulation to the sacrum", ctx), {
        level: levelOf(ctx),
        conflictGroup: "bertolotti",
      })],
    },
    {
      id: "dlc-numbering-caution",
      label: "Numbering caution for transitional / uncertain levels",
      group: "Transitional",
      atoms: (ctx) => {
        const caution = dorsolumbarNumberingCaution(ctx.state);
        return caution
          ? [a("screening_limitation", caution, {
            anatomicalSection: "dorso-lumbar spine",
            conflictGroup: "dorsolumbar_numbering_caution",
            role: "baseline",
          })]
          : [];
      },
    },
    {
      id: "dlc-low-conus",
      label: "Low-lying conus (only when the conus is covered)",
      group: "Cord / conus",
      requiresConus: true,
      atoms: (ctx) => [a("conus_medullaris", `${SECTION_FRAMES.conus}: Conus terminates lower than expected at ${ctx.conusLevel ?? ctx.level}.`, {
        level: levelOf(ctx),
        conflictGroup: "conus_level",
      })],
    },
    {
      id: "dlc-tethered",
      label: "Tethered cord / thickened filum",
      group: "Cord / conus",
      domains: ["lumbar"],
      requiresCauda: true,
      atoms: (ctx) => [a("tethered_cord", choice("cauda", "tethered cord appearance with a low-lying, thickened filum terminale", ctx), {
        anatomicalSection: "dorso-lumbar spine",
        level: levelOf(ctx),
      })],
    },
  ],
};

// ─── 14. MORE / ADVANCED ────────────────────────────────────────────────

const ADVANCED: DorsoLumbarSubMaster = {
  id: "advanced",
  label: "More / Advanced",
  hint: "Longer-tail observations kept out of the primary palettes.",
  tiles: [
    {
      id: "dla-costovertebral",
      label: "Costovertebral / costotransverse abnormality",
      group: "Thoracic",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [a("costovertebral_joint", lib(DL_SOFT.costovertebral, ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dla-pedicle",
      label: "Pedicle abnormality",
      group: "Posterior elements",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", DL_POSTERIOR.pedicles, ctx), { level: levelOf(ctx), conflictGroup: "pedicle" })],
    },
    {
      id: "dla-lamina-spinous",
      label: "Laminae / spinous process abnormality",
      group: "Posterior elements",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", `${DL_POSTERIOR.laminae} / ${DL_POSTERIOR.spinous}`, ctx), {
        level: levelOf(ctx),
        conflictGroup: "lamina_spinous",
      })],
    },
    {
      id: "dla-pars",
      label: "Pars defect (lumbar anatomy only)",
      group: "Posterior elements",
      domains: ["lumbar"],
      atoms: (ctx) => [a("pars_defect", choice("posterior", DL_POSTERIOR.pars, ctx), { level: levelOf(ctx), laterality: ctx.side, supportsLaterality: true })],
    },
    {
      id: "dla-interspinous",
      label: "Interspinous ligament injury pattern",
      group: "Ligaments",
      atoms: (ctx) => [a("posterior_ligamentous_complex", choice("ligaments", DL_POSTERIOR.interspinous, ctx), {
        level: levelOf(ctx),
        conflictGroup: "interspinous",
      })],
    },
    {
      id: "dla-sacroiliac",
      label: "Sacroiliac joint abnormality",
      group: "Soft tissue",
      domains: ["lumbar"],
      atoms: (ctx) => [a("sacroiliac_joints", choice("sacroiliac", "sacroiliac joint abnormality", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dla-paraspinal",
      label: "Paraspinal muscle atrophy / oedema",
      group: "Soft tissue",
      domains: ["lumbar"],
      atoms: (ctx) => [a("muscle_atrophy", choice("paraspinal", "paraspinal muscle atrophy", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dla-epidural-lipomatosis",
      label: "Epidural lipomatosis",
      group: "Canal",
      atoms: (ctx) => [a("epidural_lipomatosis", choice("epidural", "excess epidural fat", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dla-arachnoiditis",
      label: "Arachnoiditis pattern",
      group: "Intradural",
      domains: ["lumbar"],
      atoms: (ctx) => [a("arachnoiditis", choice("cauda", "clumped peripheral nerve roots with an obliterated subarachnoid space", ctx), {
        anatomicalSection: "dorso-lumbar spine",
        level: levelOf(ctx),
      })],
    },
    {
      id: "dla-disc-uncapping",
      label: "Disc uncapping (lumbar degenerative pattern)",
      group: "Disc",
      domains: ["lumbar"],
      atoms: (ctx) => [a("disc_uncapping", choice("discs", "uncapping of the vertebral endplate", ctx), { level: levelOf(ctx) })],
    },
    {
      id: "dla-synovial-cyst",
      label: "Facet synovial cyst",
      group: "Posterior elements",
      domains: ["lumbar"],
      atoms: (ctx) => [a("synovial_cyst", choice("posterior", "facet synovial cyst", ctx), { level: levelOf(ctx), laterality: ctx.side, supportsLaterality: true })],
    },
    {
      id: "dla-pleura-aorta",
      label: "Visualised pleura / thoracic aorta",
      group: "Adjacent structures",
      domains: ["thoracic", "junction"],
      atoms: (ctx) => [
        a("visualized_pleura", choice("soft", "visualised pleural spaces unremarkable", ctx), { anatomicalSection: "dorso-lumbar spine" }),
        a("visualized_thoracic_aorta", choice("soft", "visualised thoracic aorta unremarkable", ctx), { anatomicalSection: "dorso-lumbar spine" }),
      ],
    },
    {
      id: "dla-posterior-element-marrow",
      label: "Posterior-element marrow lesion",
      group: "Posterior elements",
      atoms: (ctx) => [a("bone_lesion", choice("posterior", DL_POSTERIOR.marrowLesion, ctx), { level: levelOf(ctx), conflictGroup: "posterior_marrow" })],
    },
    {
      id: "dla-posterior-element-fracture",
      label: "Posterior-element fracture",
      group: "Posterior elements",
      atoms: (ctx) => [a("posterior_elements", choice("posterior", DL_POSTERIOR.fracture, ctx), { level: levelOf(ctx), conflictGroup: "posterior_fracture" })],
    },
  ],
};

// ─── Assembly ────────────────────────────────────────────────────────────

export const MRI_DORSOLUMBAR_SUB_MASTERS: DorsoLumbarSubMaster[] = [
  ROUTINE,
  DEGENERATIVE,
  CANALNEURAL,
  JUNCTION,
  OSSIFICATION,
  TRAUMA,
  INFECTION,
  TUMOR,
  INTRADURAL,
  VASCULAR,
  POSTOP,
  DEFORMITY,
  CONGENITAL,
  ADVANCED,
];

export function dorsoLumbarSubMasterById(id: DorsoLumbarSubMasterId): DorsoLumbarSubMaster | null {
  return MRI_DORSOLUMBAR_SUB_MASTERS.find((s) => s.id === id) ?? null;
}

const TILE_INDEX = new Map<string, { tile: DorsoLumbarTile; subMaster: DorsoLumbarSubMasterId }>();
for (const sub of MRI_DORSOLUMBAR_SUB_MASTERS) {
  for (const tile of sub.tiles) TILE_INDEX.set(tile.id, { tile, subMaster: sub.id });
}

export function dorsoLumbarTileById(id: string): { tile: DorsoLumbarTile; subMaster: DorsoLumbarSubMasterId } | null {
  return TILE_INDEX.get(id) ?? null;
}

export function allDorsoLumbarTileIds(): string[] {
  return [...TILE_INDEX.keys()];
}

// ─── Gating (spec §4, §12, §22) ──────────────────────────────────────────

export type DorsoLumbarTileGate = {
  available: boolean;
  missing: SpineSequenceKey[];
  reason?: "sequence" | "localizer" | "coverage" | "extent" | "domain" | "transitional";
  notice?: string;
};

/**
 * A tile is offered only when the study can support the sentence. Unavailable
 * tiles are shown struck-through with the reason, never silently dropped — and
 * `buildDorsoLumbarTileBundle` refuses to compile a refused tile, so a struck
 * label cannot be applied programmatically either.
 */
export function dorsoLumbarTileAvailability(tile: DorsoLumbarTile, ctx: DorsoLumbarTileContext): DorsoLumbarTileGate {
  if (tile.requires?.length && !spineSequencesAllow(ctx.sequences, tile.requires)) {
    const missing = tile.requires.filter((k) => !ctx.sequences[k]);
    return { available: false, missing, reason: "sequence", notice: `Requires ${missing.join(" + ")}.` };
  }
  if (tile.requiresLocalizer && !ctx.sequences.wholeSpineLocalizer) {
    return { available: false, missing: ["wholeSpineLocalizer"], reason: "localizer", notice: "Requires whole-spine / localizer coverage." };
  }
  if (tile.requiresJunction && !junctionCovered(ctx.state)) {
    return {
      available: false,
      missing: [],
      reason: "coverage",
      notice: "Recorded coverage does not reach the thoracolumbar junction.",
    };
  }
  if (tile.requiresConus && !dorsolumbarConusCovered(ctx.state)) {
    return {
      available: false,
      missing: [],
      reason: "coverage",
      notice: "Recorded coverage does not reach the conus, so conus sentences are omitted.",
    };
  }
  if (tile.requiresCauda && !dorsolumbarCaudaCovered(ctx.state)) {
    return { available: false, missing: [], reason: "coverage", notice: "No lumbar segment was covered, so cauda-equina sentences are omitted." };
  }
  if (tile.requiresCord && !dorsolumbarCordCovered(ctx.state)) {
    return { available: false, missing: [], reason: "coverage", notice: "No thoracic segment was covered, so cord sentences are omitted." };
  }
  if (tile.requiresTransitional && !hasTransitionalAnatomy(ctx.state)) {
    return { available: false, missing: [], reason: "transitional", notice: "Only meaningful when transitional (LSTV) anatomy is recorded." };
  }
  if (tile.requiresExtent && !ctx.level2) {
    return { available: false, missing: [], reason: "extent", notice: "Supply the second level (extent) for this statement." };
  }
  // The domain check is last: a tile may be perfectly supportable in general and
  // still be the wrong anatomy for the level the radiologist is standing at.
  if (tile.domains?.length) {
    const domain = ctx.domain || dorsolumbarLevelDomain(ctx.level);
    if (domain && !tile.domains.includes(domain)) {
      return {
        available: false,
        missing: [],
        reason: "domain",
        notice: `This statement belongs to the ${tile.domains.join(" / ")} domain, not the ${domain} anatomy at ${ctx.level}.`,
      };
    }
  }
  if (ctx.level && !isDorsoLumbarLevelAcquired(ctx.level, ctx.state)) {
    return { available: false, missing: [], reason: "coverage", notice: `${ctx.level} is outside the acquired coverage of this examination.` };
  }
  return { available: true, missing: [] };
}

/**
 * Level-scoped tile bundle id, keyed on the CANONICAL level so the same bridge
 * entered under two spellings is one bundle that replaces itself.
 */
export function dorsoLumbarTileBundleId(tileId: string, level: string): string {
  const canonical = canonicalDorsoLumbarLevel(level)?.key ?? level;
  return spineBundleId("dl-tile", `${tileId}${canonical ? `-${canonical.replace(/\s+/g, "")}` : ""}`);
}

export function buildDorsoLumbarTileBundle(
  tileId: string,
  ctx: DorsoLumbarTileContext,
): { bundleId: string; observations: ReturnType<typeof spineAtomsToPatches>; notice: string | null } {
  const found = dorsoLumbarTileById(tileId);
  const bundleId = dorsoLumbarTileBundleId(tileId, ctx.level);
  if (!found) return { bundleId, observations: [], notice: `Unknown Dorso-Lumbar tile ${tileId}.` };
  const gate = dorsoLumbarTileAvailability(found.tile, ctx);
  if (!gate.available) {
    // Refused, not silently emptied: the caller shows the reason.
    return { bundleId, observations: [], notice: gate.notice ?? "This statement is not supported on this examination." };
  }
  const atoms = withDorsoLumbarBaselineContract(found.tile.atoms(ctx));
  return { bundleId, observations: spineAtomsToPatches(tileRegion(ctx), bundleId, atoms), notice: null };
}

/** Every tile of one palette that the study currently supports. */
export function dorsoLumbarPaletteAvailability(
  id: DorsoLumbarSubMasterId,
  ctx: DorsoLumbarTileContext,
): Array<{ tile: DorsoLumbarTile; gate: DorsoLumbarTileGate }> {
  const sub = dorsoLumbarSubMasterById(id);
  if (!sub) return [];
  return sub.tiles.map((tile) => ({ tile, gate: dorsoLumbarTileAvailability(tile, ctx) }));
}

// ─── Starting presets (spec §8, §17, §18) ────────────────────────────────

export type DorsoLumbarPreset = {
  id: string;
  label: string;
  hint: string;
  subMasters: DorsoLumbarSubMasterId[];
  /** CRITICAL presets are flagged so the existing critical workflow can react. */
  critical?: boolean;
  requires?: SpineSequenceKey[];
  requiresJunction?: boolean;
  requiresConus?: boolean;
  atoms: (ctx: DorsoLumbarTileContext) => SpineAtomSpec[];
};

const presetAtom = a;

/** Numbered library impression lines, joined without re-writing the library. */
function presetImpression(lines: readonly string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line}`).join(" ");
}

/**
 * A preset's summary lines are an Impression contribution. Putting them in the
 * Findings paragraph would hide an interpretation inside the anatomical text,
 * where the ledger cannot keep it separate.
 */
function presetImpressionAtom(concept: string, lines: readonly string[]): SpineAtomSpec {
  return presetAtom(concept, "", {
    anatomicalSection: "dorso-lumbar spine",
    conflictGroup: "impression_lines",
    impression: presetImpression(lines),
    role: "impression",
  });
}

export const DORSOLUMBAR_PRESETS: DorsoLumbarPreset[] = [
  {
    id: "preset-normal-dorsolumbar",
    label: "Normal MRI Dorso-Lumbar Spine",
    hint: "Coverage-aware normal baseline. Cord, conus and cauda sentences appear only for anatomy actually acquired.",
    subMasters: ["routine"],
    atoms: (ctx) => {
      const atoms: SpineAtomSpec[] = [
        presetAtom("alignment", DL_ALIGN.normal, { anatomicalSection: "dorso-lumbar spine", role: "baseline" }),
        presetAtom("kyphosis", DL_ALIGN.curvesPreserved, { anatomicalSection: "dorso-lumbar spine", role: "baseline" }),
        presetAtom("bone_lesion", DL_BONE.normal, { anatomicalSection: "dorso-lumbar spine", role: "baseline", conflictGroup: "marrow_screen" }),
        presetAtom("compression_fracture", DL_BONE.noFracture, { anatomicalSection: "dorso-lumbar spine", role: "baseline" }),
      ];
      // Each neural statement is earned by coverage, never by the study label.
      if (dorsolumbarCordCovered(ctx.state)) {
        atoms.push(presetAtom("cord_caliber", DL_CANAL.cordNormal, { role: "baseline", conflictGroup: "cord_normal" }));
        atoms.push(presetAtom("canal_stenosis", DL_CANAL.noCanalCompromise, { role: "baseline", conflictGroup: "canal_normal" }));
      }
      if (dorsolumbarConusCovered(ctx.state)) {
        atoms.push(presetAtom("conus_medullaris", DL_JUNCTION.conusNormal, { role: "baseline", conflictGroup: "conus_normal" }));
      }
      // The library writes no normal cauda-equina sentence, and the normal
      // baseline is built only from library lines: lumbar normality is carried
      // by the alignment and vertebral-body statements above, not by prose the
      // software invented (spec §8).
      const caution = dorsolumbarNumberingCaution(ctx.state);
      atoms.push(presetAtom("screening_limitation", caution || DL_COVER.numberingDocumented, {
        anatomicalSection: "dorso-lumbar spine",
        conflictGroup: "dorsolumbar_numbering_caution",
        role: "baseline",
      }));
      return atoms;
    },
  },
  {
    id: "preset-thoracolumbar-burst",
    label: DL_MACROS.thoracolumbarBurst.label,
    hint: "Canonical junction burst fracture with retropulsion and canal compromise (library macro, verbatim).",
    subMasters: ["trauma", "junction"],
    critical: true,
    requiresJunction: true,
    atoms: (ctx) => {
      const filled = lib(DL_MACROS.thoracolumbarBurst.findings, ctx);
      const neural = dorsoLumbarNeuralWord(ctx);
      const atoms: SpineAtomSpec[] = [
        presetAtom("compression_fracture", filled, {
          anatomicalSection: canonicalLevelOf(ctx.level) ?? "dorso-lumbar spine",
          level: canonicalLevelOf(ctx.level),
          conflictGroup: "junction_burst",
          state: "burst",
        }),
        presetAtom("retropulsion", `${SECTION_FRAMES.junction}: Retropulsed fragment projecting ${ctx.mm != null ? `${ctx.mm} mm ` : ""}into the canal at ${ctx.level}.`, {
          anatomicalSection: canonicalLevelOf(ctx.level),
          level: canonicalLevelOf(ctx.level),
          conflictGroup: "junction_retropulsion",
        }),
        presetAtom("canal_stenosis", `${SECTION_FRAMES.canal}: ${ctx.degree ? `${ctx.degree} ` : ""}canal compromise at ${ctx.level}.`, {
          anatomicalSection: canonicalLevelOf(ctx.level),
          level: canonicalLevelOf(ctx.level),
          conflictGroup: "junction_canal",
          severity: "significant",
        }),
        presetAtom("cord_compression", `${neuralFrame(ctx)}: ${neural} compression at ${ctx.level}.`, {
          anatomicalSection: canonicalLevelOf(ctx.level),
          level: canonicalLevelOf(ctx.level),
          conflictGroup: "cord_compression",
          state: "compression",
          severity: "significant",
        }),
        presetImpressionAtom("compression_fracture", DL_MACROS.thoracolumbarBurst.impression.map((line) => lib(line, ctx))),
      ];
      return atoms;
    },
  },
  {
    id: "preset-junction-spondylodiscitis",
    label: DL_MACROS.junctionSpondylodiscitis.label,
    hint: "Infection crossing the thoracolumbar junction as ONE pathology object (library macro, verbatim).",
    subMasters: ["infection", "junction"],
    critical: true,
    requiresJunction: true,
    atoms: (ctx) => {
      const level = canonicalLevelOf(ctx.level) ?? "";
      const neural = dorsoLumbarNeuralWord(ctx);
      return [
        presetAtom("spondylodiscitis", lib(DL_MACROS.junctionSpondylodiscitis.findings, ctx), {
          anatomicalSection: level || "dorso-lumbar spine",
          level,
          conflictGroup: "spondylodiscitis",
        }),
        presetAtom("endplate_erosion", `${SECTION_FRAMES.endplate}: Endplate destruction at ${ctx.level}${ctx.level2 ? ` and ${ctx.level2}` : ""}.`, {
          anatomicalSection: level,
          level,
          conflictGroup: "infection_endplate",
        }),
        presetAtom("paravertebral_collection", `${SECTION_FRAMES.soft}: Pre / paravertebral soft-tissue component${ctx.level2 ? ` extending from ${ctx.level} to ${ctx.level2}` : ""}.`, {
          anatomicalSection: level || "dorso-lumbar spine",
          level,
          conflictGroup: "paravertebral",
        }),
        presetAtom("canal_stenosis", `${SECTION_FRAMES.canal}: ${ctx.degree ? `${ctx.degree} ` : ""}canal compromise at ${ctx.level}.`, {
          anatomicalSection: level,
          level,
          conflictGroup: "infection_canal",
          severity: "significant",
        }),
        presetAtom("cord_compression", `${neuralFrame(ctx)}: ${neural} effect at ${ctx.level}.`, {
          anatomicalSection: level,
          level,
          conflictGroup: "cord_compression",
          state: "compression",
        }),
        presetImpressionAtom("spondylodiscitis", DL_MACROS.junctionSpondylodiscitis.impression.map((line) => lib(line, ctx))),
      ];
    },
  },
];

export function dorsoLumbarPresetById(id: string): DorsoLumbarPreset | null {
  return DORSOLUMBAR_PRESETS.find((p) => p.id === id) ?? null;
}

export function dorsoLumbarPresetBundleId(presetId: string, level: string): string {
  const canonical = canonicalDorsoLumbarLevel(level)?.key ?? level;
  return spineBundleId("dl-preset", `${presetId}${canonical ? `-${canonical.replace(/\s+/g, "")}` : ""}`);
}

export function dorsoLumbarPresetAvailability(
  preset: DorsoLumbarPreset,
  ctx: DorsoLumbarTileContext,
): { supported: boolean; notice: string | null } {
  if (preset.requires?.length && !spineSequencesAllow(ctx.sequences, preset.requires)) {
    const missing = preset.requires.filter((k) => !ctx.sequences[k]);
    return { supported: false, notice: `Requires ${missing.join(" + ")}.` };
  }
  if (preset.requiresJunction && !junctionCovered(ctx.state)) {
    return { supported: false, notice: "Recorded coverage does not reach the thoracolumbar junction." };
  }
  if (preset.requiresConus && !dorsolumbarConusCovered(ctx.state)) {
    return { supported: false, notice: "Recorded coverage does not reach the conus." };
  }
  return { supported: true, notice: null };
}

export function buildDorsoLumbarPresetBundle(
  presetId: string,
  ctx: DorsoLumbarTileContext,
): { bundleId: string; observations: ReturnType<typeof spineAtomsToPatches>; critical: boolean; notice: string | null } {
  const preset = dorsoLumbarPresetById(presetId);
  const bundleId = dorsoLumbarPresetBundleId(presetId, ctx.level);
  if (!preset) return { bundleId, observations: [], critical: false, notice: `Unknown Dorso-Lumbar preset ${presetId}.` };
  const gate = dorsoLumbarPresetAvailability(preset, ctx);
  if (!gate.supported) return { bundleId, observations: [], critical: false, notice: gate.notice };
  const atoms = preset.atoms(ctx).filter((atom) =>
    atom.findings.trim() || atom.impression?.trim() || atom.recommendation?.trim());
  return {
    bundleId,
    observations: spineAtomsToPatches(tileRegion(ctx), bundleId, withDorsoLumbarBaselineContract(atoms)),
    critical: preset.critical === true,
    notice: gate.notice,
  };
}

// ─── Shared lesion form (spec §10, §18, §19) ─────────────────────────────

export type DorsoLumbarLesionCompartment =
  | "vertebral"
  | "posterior_element"
  | "epidural"
  | "intradural"
  | "intramedullary"
  | "paravertebral"
  | "psoas"
  | "postop_collection";

export type DorsoLumbarLesionInput = {
  compartment: DorsoLumbarLesionCompartment;
  /** Superior level of the lesion's own span. */
  level: string;
  /** Inferior level of the span; a lesion crossing the junction stays ONE object. */
  level2?: string;
  laterality?: DorsoLumbarSide;
  apMm?: number;
  transverseMm?: number;
  craniocaudalMm?: number;
  cmAP?: number;
  cmTransverse?: number;
  cmCraniocaudal?: number;
  t1?: string;
  t2?: string;
  stir?: string;
  enhancement?: "none" | "rim" | "diffuse" | "heterogeneous" | "intense";
  canalEffect?: boolean;
  neuralEffect?: boolean;
  extensionToJunction?: boolean;
  label?: string;
};

const LESION_CONCEPT: Record<DorsoLumbarLesionCompartment, string> = {
  vertebral: "bone_lesion",
  posterior_element: "posterior_elements",
  epidural: "epidural_space",
  intradural: "intradural_lesion",
  intramedullary: "intramedullary_lesion",
  paravertebral: "paravertebral_collection",
  psoas: "paravertebral_collection",
  postop_collection: "epidural_collection",
};

const LESION_SECTION: Record<DorsoLumbarLesionCompartment, keyof typeof SECTION_FRAMES> = {
  vertebral: "bone",
  posterior_element: "posterior",
  epidural: "epidural",
  intradural: "intradural",
  intramedullary: "intramedullary",
  paravertebral: "soft",
  psoas: "soft",
  postop_collection: "epidural",
};

function lesionExtent(input: DorsoLumbarLesionInput): string {
  return input.level2 && input.level2 !== input.level
    ? `from ${input.level} to ${input.level2}${input.extensionToJunction ? ", crossing the thoracolumbar junction" : ""}`
    : `at ${input.level}`;
}

function lesionDimensions(input: DorsoLumbarLesionInput): string {
  const bits = [
    input.cmCraniocaudal != null ? `${input.cmCraniocaudal} cm craniocaudal` : "",
    input.cmTransverse != null ? `${input.cmTransverse} cm transverse` : "",
    input.cmAP != null ? `${input.cmAP} cm anteroposterior` : "",
    input.craniocaudalMm != null ? `${input.craniocaudalMm} mm craniocaudal` : "",
    input.transverseMm != null ? `${input.transverseMm} mm transverse` : "",
    input.apMm != null ? `${input.apMm} mm anteroposterior` : "",
  ].filter(Boolean);
  return bits.length ? ` Measures ${bits.join(", ")}.` : "";
}

function lesionSignal(input: DorsoLumbarLesionInput, ctx: DorsoLumbarTileContext): string {
  const bits = [
    input.t1 ? `T1 ${input.t1}` : "",
    input.t2 ? `T2 ${input.t2}` : "",
    input.stir && ctx.sequences.stir ? `STIR ${input.stir}` : "",
  ].filter(Boolean);
  return bits.length ? ` Signal pattern — ${bits.join("; ")}.` : "";
}

/**
 * ONE lesion form reused by the tumor, infection, post-operative, intradural and
 * junction palettes. A lesion that crosses the bridge is written once, at its
 * canonical superior level, with its span named in the sentence — not as a
 * dorsal copy and a lumbar copy. The wording is the radiologist's own structured
 * choice; drawing a lesion in a compartment never makes it the metastasis, cold
 * abscess or schwannoma that the library names, and sequence-dependent
 * descriptors are dropped when the sequence was not acquired.
 */
export function buildDorsoLumbarLesionAtoms(
  input: DorsoLumbarLesionInput,
  ctx: DorsoLumbarTileContext,
): SpineAtomSpec[] {
  const concept = LESION_CONCEPT[input.compartment];
  const section = SECTION_FRAMES[LESION_SECTION[input.compartment]];
  const anchor = canonicalLevelOf(input.level) ?? input.level;
  const base = `${section}: ${input.label ?? "focal lesion"} ${lesionExtent(input)}.${lesionDimensions(input)}`;

  const atoms: SpineAtomSpec[] = [
    {
      concept,
      conflictGroup: `lesion-${input.compartment}-${anchor.replace(/\s+/g, "")}`,
      anatomicalSection: anchor,
      findings: base + lesionSignal(input, ctx),
      level: anchor,
      laterality: input.laterality,
      supportsLaterality: Boolean(input.laterality),
      measurement: input.apMm != null ? String(input.apMm) : undefined,
      state: input.enhancement && input.enhancement !== "none" ? `enhancement:${input.enhancement}` : "",
    },
  ];

  if (input.enhancement && input.enhancement !== "none") {
    atoms.push(ctx.sequences.contrast
      ? {
        concept,
        conflictGroup: `lesion-enhancement-${anchor.replace(/\s+/g, "")}`,
        anatomicalSection: anchor,
        findings: `${section}: ${input.enhancement} enhancement${lesionExtent(input)}.`,
        level: anchor,
        state: "enhancement",
      }
      : {
        concept: "screening_limitation",
        conflictGroup: "contrast_limitation",
        anatomicalSection: anchor,
        findings: spineLimitationSentence(["contrast"], "assessment of enhancement"),
        level: anchor,
        role: "baseline",
      });
  }

  if (input.canalEffect) {
    atoms.push({
      concept: "canal_stenosis",
      conflictGroup: `lesion-canal-${anchor.replace(/\s+/g, "")}`,
      anatomicalSection: anchor,
      findings: `${SECTION_FRAMES.canal}: Canal compromise${lesionExtent(input)}.`,
      level: anchor,
      severity: "significant",
    });
  }

  // The element named is decided by the anatomy at the lesion's anchor level, so
  // a lesion spanning the bridge never turns the conus into "thoracic cord".
  if (input.neuralEffect) {
    const neural = dorsolumbarNeuralStructure(anchor, ctx.state);
    atoms.push({
      concept: neural === "cauda" ? "cauda_equina" : "cord_compression",
      conflictGroup: neural === "cauda" ? "cauda_compression" : "cord_compression",
      anatomicalSection: anchor,
      findings: `${SECTION_FRAMES[NEURAL_SECTION[neural] ?? "cord"]}: ${neural} effect${lesionExtent(input)}.`,
      level: anchor,
      state: "compression",
      severity: "significant",
    });
  }

  return atoms;
}

export function buildDorsoLumbarLesionBundle(
  input: DorsoLumbarLesionInput,
  ctx: DorsoLumbarTileContext,
): { bundleId: string; observations: ReturnType<typeof spineAtomsToPatches> } {
  const anchor = canonicalLevelOf(input.level) ?? input.level;
  const bundleId = spineBundleId("dl-lesion", `${input.compartment}-${anchor.replace(/\s+/g, "")}`);
  return {
    bundleId,
    observations: spineAtomsToPatches(
      canonicalDorsoLumbarLevel(anchor)?.ledgerRegion ?? tileRegion(ctx),
      bundleId,
      withDorsoLumbarBaselineContract(buildDorsoLumbarLesionAtoms(input, ctx)),
    ),
  };
}


