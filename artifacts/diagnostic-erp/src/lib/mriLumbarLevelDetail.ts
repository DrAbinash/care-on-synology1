/**
 * mriLumbarLevelDetail.ts — the shared level-by-level detail model (spec §7,
 * §8, §11, §13).
 *
 * The existing `buildLumbarLevelApplyBundle` already owns disc morphology,
 * canal severity, foraminal severity, Modic / Pfirrmann grading and AP canal.
 * This module adds the detail the V3 sub-masters need — lateral recess per
 * side, foraminal perineural fat, canal morphology, disc migration, facet and
 * ligamentum flavum detail, pars / listhesis pattern, epidural space and
 * SEPARATE traversing / exiting root observations — and compiles them into the
 * same atomic ledger rows so same-slot replacement, undo and provenance all
 * keep working through the existing machinery.
 *
 * Root identity is the safety-critical part (spec §8): traversal and exit roots
 * at one level are DIFFERENT concepts (`root_traversing` / `root_exiting`), so
 * describing both at L4-L5 keeps two observations instead of one silently
 * replacing the other.
 *
 * Seeded prose is verbatim from `mriLumbarLibrary.ts` wherever the canonical
 * library has a sentence. Where it does not, the radiologist's own structured
 * choice is rendered as "<Section>: <label>" and marked `structured-choice`,
 * so nothing here invents clinical wording.
 *
 * Pure functions only — no React, no store.
 */

import {
  LS_CANAL,
  LS_DISC,
  LS_FORAMEN,
  LS_POSTERIOR,
  LS_ALIGN,
  fillLsProse,
  type LsProseVars,
} from "./mriLumbarLibrary";
import {
  lumbarLevelKeyStrings,
  lumbarRootConflictGroup,
  lumbarRootSuggestion,
  type LumbarNumberingState,
} from "./mriSpineNumbering";
import { spineBundleId, type SpineAtomSpec } from "./mriSpineAtoms";
import type { SpineSequencesAvailable } from "./mriSpineSequences";
import {
  LATERALITY_OPTIONS,
  type LumbarLevelSelection,
} from "./mriLumbarRegions";

export type Severity = "none" | "mild" | "moderate" | "severe";

export type RootEffect = "contact" | "displacement" | "impingement" | "compression";

export type RecessSideDetail = {
  severity?: Exclude<Severity, "none"> | null;
  rootEffect?: RootEffect | null;
};

export type ForaminalSideDetail = {
  severity?: Exclude<Severity, "none"> | null;
  /** Perineural fat is the specific foraminal detail the spec asks for. */
  fat?: "preserved" | "partial_loss" | "complete_loss" | null;
  rootEffect?: RootEffect | null;
};

export type CanalMorphology =
  | "csf_preserved"
  | "partial_csf_effacement"
  | "complete_csf_effacement"
  | "cauda_crowding"
  | "trefoil"
  | "combined_degenerative";

export type DiscMigration = "none" | "cranial" | "caudal";

export type FacetDetail = {
  arthropathy?: boolean;
  hypertrophy?: boolean;
  effusion?: boolean;
  synovialCyst?: boolean;
  laterality?: "left" | "right" | "bilateral";
  cystMm?: number | null;
};

export type LigamentumFlavumDetail = {
  hypertrophy?: boolean;
  buckling?: boolean;
  thicknessMm?: number | null;
};

export type ParsDetail = {
  side?: "right" | "left" | "bilateral" | null;
  chronic?: boolean;
  marrowEdema?: boolean;
};

export type ListhesisDetail = {
  direction?: "antero" | "retro" | null;
  levelLabel?: string;
  displacedLevel?: string;
  displacementMm?: number | null;
  grade?: "I" | "II" | "III" | "IV" | null;
  cause?: "degenerative" | "isthmic" | "other" | null;
};

export type EpiduralDetail = {
  finding?:
    | "normal_fat"
    | "prominent_fat"
    | "lipomatosis"
    | "mass"
    | "collection"
    | "hematoma"
    | "thecal_sac_compression"
    | null;
  levelExtent?: string;
};

export type LumbarLevelDetail = {
  migration?: DiscMigration | null;
  migrationMm?: number | null;
  canalMorphology?: CanalMorphology | null;
  recessRight?: RecessSideDetail | null;
  recessLeft?: RecessSideDetail | null;
  foramRight?: ForaminalSideDetail | null;
  foramLeft?: ForaminalSideDetail | null;
  facet?: FacetDetail | null;
  ligamentumFlavum?: LigamentumFlavumDetail | null;
  pars?: ParsDetail | null;
  listhesis?: ListhesisDetail | null;
  epidural?: EpiduralDetail | null;
};

export type ProvenanceKind = "canonical-library" | "structured-choice";

export type DetailAtom = SpineAtomSpec & {
  /** How the sentence was produced — auditable, and shown in the UI. */
  proseSource: ProvenanceKind;
};

export const CANAL_MORPHOLOGY_OPTIONS: Array<{ id: CanalMorphology; label: string }> = [
  { id: "csf_preserved", label: "CSF preserved" },
  { id: "partial_csf_effacement", label: "Partial CSF effacement" },
  { id: "complete_csf_effacement", label: "Complete CSF effacement" },
  { id: "cauda_crowding", label: "Cauda equina crowding" },
  { id: "trefoil", label: "Trefoil configuration" },
  { id: "combined_degenerative", label: "Combined degenerative stenosis" },
];

export const RECESS_OPTIONS: Array<{ id: Exclude<Severity, "none">; label: string }> = [
  { id: "mild", label: "Mild narrowing" },
  { id: "moderate", label: "Moderate narrowing" },
  { id: "severe", label: "Severe stenosis" },
];

export const ROOT_EFFECT_OPTIONS: Array<{ id: RootEffect; label: string }> = [
  { id: "contact", label: "Root contact" },
  { id: "displacement", label: "Root displacement" },
  { id: "impingement", label: "Root impingement" },
  { id: "compression", label: "Root compression" },
];

export const PERINEURAL_FAT_OPTIONS: Array<{ id: NonNullable<ForaminalSideDetail["fat"]>; label: string }> = [
  { id: "preserved", label: "Perineural fat preserved" },
  { id: "partial_loss", label: "Partial loss of perineural fat" },
  { id: "complete_loss", label: "Complete loss of perineural fat" },
];

export const MIGRATION_OPTIONS: Array<{ id: DiscMigration; label: string }> = [
  { id: "none", label: "No migration" },
  { id: "cranial", label: "Cranial migration" },
  { id: "caudal", label: "Caudal migration" },
];

export const EPIDURAL_OPTIONS: Array<{ id: NonNullable<EpiduralDetail["finding"]>; label: string }> = [
  { id: "normal_fat", label: "Normal epidural fat" },
  { id: "prominent_fat", label: "Prominent epidural fat" },
  { id: "lipomatosis", label: "Spinal epidural lipomatosis" },
  { id: "mass", label: "Epidural mass" },
  { id: "collection", label: "Epidural collection" },
  { id: "hematoma", label: "Epidural hematoma" },
  { id: "thecal_sac_compression", label: "Thecal sac compression" },
];

const ROOT_EFFECT_VERB: Record<RootEffect, string> = {
  contact: "contact",
  displacement: "displacement",
  impingement: "impingement",
  compression: "compression",
};

const SECTION_FRAMES: Record<string, string> = {
  lateral_recess_stenosis: "Lateral recess",
  canal_morphology: "Central canal",
  disc_migration: "Disc fragment migration",
  facet_arthropathy: "Facet joints",
  ligamentum_flavum: "Ligamentum flavum",
  pars_defect: "Pars interarticularis",
  epidural_space: "Epidural space",
};

/** Canonical-library prose when it exists; the radiologist's own choice otherwise. */
function detailSentence(
  libraryTemplate: string | null,
  vars: LsProseVars,
  sectionKey: keyof typeof SECTION_FRAMES,
  choiceLabel: string,
): { findings: string; proseSource: ProvenanceKind } {
  if (libraryTemplate) {
    const { text } = fillLsProse(libraryTemplate, vars);
    return { findings: text, proseSource: "canonical-library" };
  }
  return {
    findings: `${SECTION_FRAMES[sectionKey]}: ${choiceLabel}${vars.level ? ` at ${vars.level}` : ""}.`,
    proseSource: "structured-choice",
  };
}

function atom(input: DetailAtom): DetailAtom {
  return { role: "finding", ...input };
}

export function lumbarLevelDetailHasContent(detail: LumbarLevelDetail): boolean {
  return Boolean(
    (detail.migration && detail.migration !== "none")
    || detail.canalMorphology
    || detail.recessRight?.severity
    || detail.recessRight?.rootEffect
    || detail.recessLeft?.severity
    || detail.recessLeft?.rootEffect
    || detail.foramRight?.severity
    || detail.foramRight?.fat
    || detail.foramRight?.rootEffect
    || detail.foramLeft?.severity
    || detail.foramLeft?.fat
    || detail.foramLeft?.rootEffect
    || detail.facet?.arthropathy
    || detail.facet?.hypertrophy
    || detail.facet?.effusion
    || detail.facet?.synovialCyst
    || detail.ligamentumFlavum?.hypertrophy
    || detail.ligamentumFlavum?.buckling
    || detail.ligamentumFlavum?.thicknessMm
    || detail.pars?.side
    || detail.listhesis?.direction
    || detail.epidural?.finding
  );
}

/**
 * Lateral recess detail. The canonical library describes recess stenosis only
 * inside its extrusion sentence, so the recess statement itself is a
 * structured choice — never a borrowed clinical assertion.
 */
function recessAtoms(
  level: string,
  side: "right" | "left",
  detail: RecessSideDetail | null | undefined,
): DetailAtom[] {
  if (!detail) return [];
  const out: DetailAtom[] = [];
  if (detail.severity && detail.severity !== "none") {
    const label = RECESS_OPTIONS.find((o) => o.id === detail.severity)?.label ?? detail.severity;
    const sentence = detailSentence(null, { level, side }, "lateral_recess_stenosis", `${detail.severity} ${side} ${label.toLowerCase()}`);
    out.push(atom({
      concept: "lateral_recess_stenosis",
      conflictGroup: `lateral_recess_stenosis-${side}`,
      anatomicalSection: level,
      findings: sentence.findings,
      impression: `${level}: ${side} lateral recess ${label.toLowerCase()}.`,
      level,
      laterality: side,
      severity: detail.severity,
      supportsLaterality: true,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

function foraminalAtoms(
  level: string,
  side: "right" | "left",
  detail: ForaminalSideDetail | null | undefined,
): DetailAtom[] {
  if (!detail) return [];
  const out: DetailAtom[] = [];
  if (detail.fat && detail.fat === "complete_loss") {
    const sentence = detailSentence(LS_FORAMEN.completeFatLoss, { level, side }, "foraminal_stenosis", "");
    out.push(atom({
      concept: "foraminal_stenosis",
      conflictGroup: `foraminal_stenosis-${side}`,
      anatomicalSection: level,
      findings: sentence.findings,
      impression: `${level}: complete loss of perineural fat, ${side} side.`,
      level,
      laterality: side,
      severity: "severe",
      supportsLaterality: true,
      proseSource: sentence.proseSource,
    }));
  } else if (detail.severity && detail.severity !== "none") {
    const template = detail.severity === "severe"
      ? (side === "left" ? LS_FORAMEN.severeLeftStenosis : null)
      : (detail.severity === "moderate" ? LS_FORAMEN.moderateBilateral : null);
    const sentence = detailSentence(
      template,
      { level, side: detail.severity === "moderate" ? "bilateral" : side },
      "foraminal_stenosis",
      `${detail.severity} ${side} neural foraminal narrowing`,
    );
    out.push(atom({
      concept: "foraminal_stenosis",
      conflictGroup: `foraminal_stenosis-${side}`,
      anatomicalSection: level,
      findings: sentence.findings,
      impression: `${level}: ${detail.severity} ${side} foraminal stenosis.`,
      level,
      laterality: side,
      severity: detail.severity,
      supportsLaterality: true,
      proseSource: sentence.proseSource,
    }));
  } else if (detail.fat) {
    const label = PERINEURAL_FAT_OPTIONS.find((o) => o.id === detail.fat)?.label ?? detail.fat;
    const sentence = detailSentence(null, { level, side }, "foraminal_stenosis", `${side} ${label.toLowerCase()}`);
    out.push(atom({
      concept: "foraminal_stenosis",
      conflictGroup: `foraminal_stenosis-${side}`,
      anatomicalSection: level,
      findings: sentence.findings,
      level,
      laterality: side,
      state: detail.fat,
      supportsLaterality: true,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

/**
 * Root observations (§8). Traversing and exiting roots are separate concepts
 * with their own conflict groups, so both can describe one level at once.
 * The suggested root is an assist only — never a silent correction.
 */
export function rootAtoms(opts: {
  level: string;
  numbering: LumbarNumberingState | null | undefined;
  sel: LumbarLevelSelection;
  detail?: LumbarLevelDetail;
}): DetailAtom[] {
  const { level, sel } = opts;
  const numbering = opts.numbering ?? null;
  const suggestion = lumbarRootSuggestion(level, numbering);
  const out: DetailAtom[] = [];

  const push = (kind: "traversing" | "exiting", root: string, effect: RootEffect, sentence: { findings: string; proseSource: ProvenanceKind }) => {
    out.push(atom({
      concept: kind === "traversing" ? "root_traversing" : "root_exiting",
      conflictGroup: lumbarRootConflictGroup(level, root, kind),
      anatomicalSection: level,
      findings: sentence.findings,
      // An uncertain mapping (transitional anatomy) is stated, not hidden.
      impression: `${level}: ${root} root ${ROOT_EFFECT_VERB[effect]}${suggestion.uncertain ? " (level stated with reduced certainty)" : ""}.`,
      level,
      state: effect,
      severity: effect === "compression" ? "severe" : "",
      proseSource: sentence.proseSource,
    }));
  };

  const traversingEffect = sel.rootRelation ?? (sel.rootContact ? "contact" : undefined);
  if (traversingEffect) {
    const root = (sel.rootLevel ?? "").trim() || suggestion.traversing;
    const effect: RootEffect = traversingEffect === "compression" ? "compression" : "contact";
    const template = effect === "compression" && level === "L5-S1" ? LS_FORAMEN.severeLeftStenosis : null;
    const sentence = template
      ? { findings: fillLsProse(template, { level, side: "right", root }).text, proseSource: "canonical-library" as ProvenanceKind }
      : {
        findings: `${SECTION_FRAMES.lateral_recess_stenosis}: ${root} ${ROOT_EFFECT_VERB[effect]} at ${level}.`,
        proseSource: "structured-choice" as ProvenanceKind,
      };
    push("traversing", root, effect, sentence);
  }

  for (const side of ["right", "left"] as const) {
    const detailEffect = (side === "right" ? opts.detail?.foramRight?.rootEffect : opts.detail?.foramLeft?.rootEffect);
    if (!detailEffect) continue;
    const root = suggestion.exiting;
    const sentence = {
      findings: `${SECTION_FRAMES.lateral_recess_stenosis.replace("Lateral recess", "Neural foramen")}: exiting ${root} root ${ROOT_EFFECT_VERB[detailEffect]} at ${level}, ${side} side.`,
      proseSource: "structured-choice" as ProvenanceKind,
    };
    push("exiting", root, detailEffect, sentence);
  }

  return out;
}

/** Anatomically expected root for a level + location, with an override path. */
export function expectedRootForLocation(
  level: string,
  location: string,
  numbering: LumbarNumberingState | null | undefined,
): { root: string; kind: "traversing" | "exiting"; uncertain: boolean } {
  const suggestion = lumbarRootSuggestion(level, numbering);
  const loc = location.toLowerCase();
  const foraminalish = /foraminal|extraforaminal|far lateral/.test(loc);
  return foraminalish
    ? { root: suggestion.exiting, kind: "exiting", uncertain: suggestion.uncertain }
    : { root: suggestion.traversing, kind: "traversing", uncertain: suggestion.uncertain };
}

/**
 * A level + disc location + root combination that does not fit lumbar
 * anatomy is a WARNING for the radiologist, never an automatic correction
 * (spec §8). Transitional anatomy widens the uncertainty and is flagged too.
 */
export function rootConsistencyWarning(opts: {
  level: string;
  location?: string | null;
  root?: string | null;
  numbering?: LumbarNumberingState | null;
}): string[] {
  const location = (opts.location ?? "").trim();
  const root = (opts.root ?? "").trim().toUpperCase();
  if (!location || !root) return [];
  const expected = expectedRootForLocation(opts.level, location, opts.numbering ?? null);
  const warnings: string[] = [];
  if (expected.root.toUpperCase() !== root) {
    warnings.push(
      `Root mapping: ${opts.level} ${location.toLowerCase()} is expected to involve the ${expected.kind} ${expected.root} root, but the report names ${root}. Confirm before finalizing.`,
    );
  }
  if (expected.uncertain) {
    warnings.push(
      `Root mapping: vertebral numbering is non-standard, so the ${expected.kind} root at ${opts.level} is stated with reduced certainty.`,
    );
  }
  return warnings;
}

function canalMorphologyAtoms(level: string, morphology: CanalMorphology | null | undefined): DetailAtom[] {
  if (!morphology) return [];
  const label = CANAL_MORPHOLOGY_OPTIONS.find((o) => o.id === morphology)?.label ?? morphology;
  const template = morphology === "cauda_crowding"
    ? LS_CANAL.severeStenosis
    : morphology === "partial_csf_effacement"
      ? LS_CANAL.mildStenosis
      : morphology === "complete_csf_effacement"
        ? LS_CANAL.severeStenosis
        : null;
  const sentence = detailSentence(template, { level }, "canal_morphology", label);
  return [atom({
    concept: "canal_morphology",
    conflictGroup: "canal_morphology",
    anatomicalSection: level,
    findings: sentence.findings,
    impression: `${level}: ${label.toLowerCase()}.`,
    level,
    state: morphology,
    proseSource: sentence.proseSource,
  })];
}

function migrationAtoms(level: string, migration: DiscMigration | null | undefined, mm: number | null | undefined): DetailAtom[] {
  if (!migration || migration === "none") return [];
  const direction = migration === "cranial" ? "superiorly" : "inferiorly";
  const sentence = detailSentence(
    LS_DISC.sequestration,
    { level, direction, mm: mm ?? undefined },
    "disc_migration",
    `${migration === "cranial" ? "cranially" : "caudally"} migrated disc fragment`,
  );
  return [atom({
    concept: "disc_migration",
    conflictGroup: "disc_migration",
    anatomicalSection: level,
    findings: sentence.findings,
    impression: `${level}: disc fragment migration ${direction}${mm != null ? ` ${mm} mm` : ""}.`,
    level,
    state: migration,
    measurement: mm != null ? String(mm) : undefined,
    proseSource: sentence.proseSource,
  })];
}

function facetAtoms(level: string, facet: FacetDetail | null | undefined): DetailAtom[] {
  if (!facet) return [];
  const out: DetailAtom[] = [];
  const states = [
    facet.arthropathy ? "arthropathy" : "",
    facet.hypertrophy ? "hypertrophy" : "",
    facet.effusion ? "effusion" : "",
  ].filter(Boolean);
  if (states.length > 0) {
    // Facet subtype lives in `state`: `facet_joint` is the established owner of
    // facet wording, and splitting it into new concepts would re-route the
    // aliases every existing facet row resolves through.
    const template = facet.arthropathy
      ? LS_POSTERIOR.facetArthropathy
      : facet.effusion
        ? LS_POSTERIOR.facetEffusion
        : null;
    const sentence = detailSentence(
      template,
      { level, level2: level, side: facet.laterality ?? "bilateral" },
      "facet_arthropathy",
      `facet ${states.join(", ")}`,
    );
    out.push(atom({
      concept: "facet_joint",
      conflictGroup: "facet_joint",
      anatomicalSection: level,
      findings: sentence.findings,
      impression: `${level}: facet ${states.join(", ")}.`,
      level,
      laterality: facet.laterality ?? "bilateral",
      state: states.join(","),
      supportsLaterality: true,
      proseSource: sentence.proseSource,
    }));
  }
  if (facet.synovialCyst) {
    const sentence = detailSentence(
      LS_POSTERIOR.synovialCyst,
      { level, side: facet.laterality ?? "left", mm: facet.cystMm ?? undefined },
      "facet_arthropathy",
      "synovial cyst",
    );
    out.push(atom({
      concept: "synovial_cyst",
      conflictGroup: "synovial_cyst",
      anatomicalSection: level,
      findings: sentence.findings,
      impression: `${level}: facet synovial cyst.`,
      level,
      laterality: facet.laterality ?? "",
      measurement: facet.cystMm != null ? String(facet.cystMm) : undefined,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

function flavumAtoms(level: string, lf: LigamentumFlavumDetail | null | undefined): DetailAtom[] {
  if (!lf?.hypertrophy && !lf?.buckling && !lf?.thicknessMm) return [];
  const label = [lf.hypertrophy ? "hypertrophy" : "", lf.buckling ? "buckling" : ""].filter(Boolean).join(" and ");
  const sentence = detailSentence(
    LS_POSTERIOR.lfHypertrophy,
    { level, mm: lf.thicknessMm ?? undefined },
    "ligamentum_flavum",
    label || "ligamentum flavum change",
  );
  return [atom({
    concept: "ligamentum_flavum",
    conflictGroup: "ligamentum_flavum",
    anatomicalSection: level,
    findings: sentence.findings,
    level,
    measurement: lf.thicknessMm != null ? String(lf.thicknessMm) : undefined,
    state: label,
    proseSource: sentence.proseSource,
  })];
}

export function parsAtoms(level: string, pars: ParsDetail | null | undefined, sequences: SpineSequencesAvailable | null): DetailAtom[] {
  if (!pars?.side) return [];
  const vertebra = level.toUpperCase().match(/L(\d)/)?.[0] ?? level;
  const edemaClaim = pars.marrowEdema === true;
  // Marrow edema is a fluid-sensitive-sequence claim (spec §35).
  if (edemaClaim && sequences && !sequences.stir) return [];
  const template = edemaClaim ? LS_POSTERIOR.parsDefect : null;
  const label = `${pars.side} pars defect${pars.chronic ? " (chronic)" : ""}`;
  const sentence = detailSentence(template, { vertebra }, "pars_defect", label);
  return [atom({
    concept: "pars_defect",
    conflictGroup: `pars_defect-${pars.side}`,
    anatomicalSection: level,
    findings: sentence.findings,
    impression: `${vertebra}: ${pars.side} pars defect.`,
    level,
    laterality: pars.side,
    state: pars.chronic ? "chronic" : "",
    supportsLaterality: true,
    proseSource: sentence.proseSource,
  })];
}

export function listhesisAtoms(
  level: string,
  listhesis: ListhesisDetail | null | undefined,
): DetailAtom[] {
  if (!listhesis?.direction) return [];
  const [upper, lower] = level.toUpperCase().split("-");
  const pairLevel = upper && lower ? lower : undefined;
  const vars: LsProseVars = {
    level: upper,
    level2: pairLevel,
    mm: listhesis.displacementMm ?? undefined,
  };
  const isthmic = listhesis.cause === "isthmic";
  const template = listhesis.direction === "retro"
    ? LS_ALIGN.retrolisthesis
    : isthmic
      ? LS_ALIGN.anterolisthesisIsthmic
      : LS_ALIGN.anterolisthesisDegenerative;
  const label = `${listhesis.direction === "retro" ? "Retro" : "Antero"}listhesis${listhesis.grade ? ` grade ${listhesis.grade}` : ""}`;
  const sentence = detailSentence(template, vars, "pars_defect", label);
  return [atom({
    concept: "spondylolisthesis",
    conflictGroup: "spondylolisthesis",
    anatomicalSection: level,
    findings: sentence.findings,
    impression: `${level}: ${label.toLowerCase()}.`,
    level,
    severity: listhesis.grade ?? "",
    state: listhesis.cause ?? "",
    measurement: listhesis.displacementMm != null ? String(listhesis.displacementMm) : undefined,
    proseSource: sentence.proseSource,
  })];
}

/**
 * Epidural space (§13). Lipomatosis plus degenerative stenosis at the same
 * level must produce ONE combined sentence, never two competing statements.
 */
export function epiduralAtoms(
  level: string,
  epidural: EpiduralDetail | null | undefined,
  sel: LumbarLevelSelection,
): DetailAtom[] {
  const finding = epidural?.finding;
  if (!finding) return [];
  const label = EPIDURAL_OPTIONS.find((o) => o.id === finding)?.label ?? finding;
  const canalSevere = sel.canal === "moderate" || sel.canal === "severe";
  if (finding === "lipomatosis" && canalSevere) {
    return [atom({
      concept: "epidural_lipomatosis",
      conflictGroup: "epidural_space",
      anatomicalSection: level,
      findings: `Epidural space: combined degenerative and epidural lipomatosis-related canal stenosis at ${level}.`,
      impression: `${level}: combined degenerative and lipomatosis-related canal stenosis.`,
      level,
      state: "combined",
      proseSource: "structured-choice",
    })];
  }
  const sentence = detailSentence(null, { level }, "epidural_space", label);
  return [atom({
    concept: finding === "lipomatosis" ? "epidural_lipomatosis" : "epidural_space",
    conflictGroup: "epidural_space",
    anatomicalSection: level,
    findings: sentence.findings,
    impression: `${level}: ${label.toLowerCase()}.`,
    level,
    state: finding,
    severity: finding === "hematoma" || finding === "collection" ? "significant" : "",
    proseSource: sentence.proseSource,
  })];
}

export type LumbarLevelDetailBundle = {
  bundleId: string;
  atoms: DetailAtom[];
  /** Sentences that are not canonical-library prose — shown as such in the UI. */
  structuredChoiceCount: number;
};

/**
 * Compile the level detail selections into ledger atoms. The caller applies
 * them through `applyMacroBundle`, exactly like the existing level rows.
 */
export function buildLumbarLevelDetailBundle(opts: {
  level: string;
  detail: LumbarLevelDetail;
  sel?: LumbarLevelSelection;
  numbering?: LumbarNumberingState | null;
  sequences?: SpineSequencesAvailable | null;
}): LumbarLevelDetailBundle {
  const sel = opts.sel ?? {};
  const atoms: DetailAtom[] = [
    ...recessAtoms(opts.level, "right", opts.detail.recessRight),
    ...recessAtoms(opts.level, "left", opts.detail.recessLeft),
    ...foraminalAtoms(opts.level, "right", opts.detail.foramRight),
    ...foraminalAtoms(opts.level, "left", opts.detail.foramLeft),
    ...canalMorphologyAtoms(opts.level, opts.detail.canalMorphology),
    ...migrationAtoms(opts.level, opts.detail.migration, opts.detail.migrationMm),
    ...facetAtoms(opts.level, opts.detail.facet),
    ...flavumAtoms(opts.level, opts.detail.ligamentumFlavum),
    ...rootAtoms({ level: opts.level, numbering: opts.numbering, sel, detail: opts.detail }),
    ...listhesisAtoms(opts.level, opts.detail.listhesis),
    ...parsAtoms(opts.level, opts.detail.pars, opts.sequences ?? null),
    ...epiduralAtoms(opts.level, opts.detail.epidural, sel),
  ];
  return {
    bundleId: spineBundleId("ls-detail", opts.level.replace(/\s+/g, "")),
    atoms,
    structuredChoiceCount: atoms.filter((a) => a.proseSource === "structured-choice").length,
  };
}

/** Re-hydrate the detail chips from the ledger so state stays derived. */
export function deriveLumbarLevelDetail(
  rows: Array<{
    observation?: { concept?: string | null; laterality?: string; severity?: string; state?: string; level?: string; measurement?: string };
    ownership?: { concept?: string | null; laterality?: string; conflictGroup?: string | null; anatomicalSection?: string | null };
  }>,
  level: string,
): LumbarLevelDetail {
  const want = level.toUpperCase().replace(/\s+/g, "");
  const detail: LumbarLevelDetail = {};
  for (const row of rows) {
    const obs = row.observation;
    const concept = (obs?.concept ?? row.ownership?.concept ?? "").toLowerCase();
    const rowLevel = (obs?.level ?? row.ownership?.anatomicalSection ?? "").toUpperCase().replace(/\s+/g, "");
    if (rowLevel !== want) continue;
    const laterality = (obs?.laterality ?? row.ownership?.laterality ?? "").toLowerCase();
    const severity = (obs?.severity ?? "").toLowerCase() as Severity;
    const state = (obs?.state ?? "").toLowerCase();

    if (concept === "lateral_recess_stenosis" && severity) {
      const side = laterality.includes("left") ? "left" : "right";
      const key = side === "left" ? "recessLeft" : "recessRight";
      detail[key] = { ...(detail[key] ?? {}), severity: severity as Exclude<Severity, "none"> };
    }
    if (concept === "canal_morphology" && state) {
      detail.canalMorphology = state as CanalMorphology;
    }
    if (concept === "disc_migration" && state) {
      detail.migration = state as DiscMigration;
      const mm = Number((obs?.measurement ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(mm)) detail.migrationMm = mm;
    }
    if (concept === "foraminal_stenosis") {
      const side = laterality.includes("right") ? "right" : laterality.includes("left") ? "left" : null;
      if (side) {
        const key = side === "right" ? "foramRight" : "foramLeft";
        detail[key] = {
          ...(detail[key] ?? {}),
          severity: severity ? (severity as Exclude<Severity, "none">) : undefined,
          fat: state ? (state as NonNullable<ForaminalSideDetail["fat"]>) : undefined,
        };
      }
    }
    if (concept === "facet_joint") {
      const states = state.split(",").filter(Boolean);
      detail.facet = {
        ...(detail.facet ?? {}),
        arthropathy: states.includes("arthropathy") || detail.facet?.arthropathy === true,
        hypertrophy: states.includes("hypertrophy") || detail.facet?.hypertrophy === true,
        effusion: states.includes("effusion") || detail.facet?.effusion === true,
        laterality: (laterality as FacetDetail["laterality"]) ?? detail.facet?.laterality ?? "bilateral",
      };
    }
    if (concept === "synovial_cyst") detail.facet = { ...(detail.facet ?? {}), synovialCyst: true };
    if (concept === "ligamentum_flavum") {
      detail.ligamentumFlavum = {
        hypertrophy: state.includes("hypertrophy"),
        buckling: state.includes("buckling"),
      };
      const mm = Number((obs?.measurement ?? "").replace(/[^\d.]/g, ""));
      if (Number.isFinite(mm)) detail.ligamentumFlavum.thicknessMm = mm;
    }
    if (concept === "pars_defect" && laterality) {
      detail.pars = { side: laterality as ParsDetail["side"], chronic: state === "chronic" };
    }
    if (concept === "spondylolisthesis") {
      detail.listhesis = {
        direction: /retro/i.test(obs?.concept ? "" : state) ? "retro" : "antero",
        cause: (state as ListhesisDetail["cause"]) ?? null,
        grade: (severity as ListhesisDetail["grade"]) ?? null,
      };
    }
    if (concept === "epidural_space" || concept === "epidural_lipomatosis") {
      detail.epidural = { finding: (state || (concept === "epidural_lipomatosis" ? "lipomatosis" : "")) as EpiduralDetail["finding"] };
    }
  }
  return detail;
}

/** Level options offered by the shared level component (resolver-driven). */
export function lumbarLevelOptionsFor(numbering: LumbarNumberingState | null | undefined): string[] {
  return lumbarLevelKeyStrings(numbering);
}

export const LUMBAR_DISC_LOCATION_OPTIONS = LATERALITY_OPTIONS;
