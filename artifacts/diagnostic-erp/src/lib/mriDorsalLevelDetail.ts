/**
 * mriDorsalLevelDetail.ts — per-level dorsal detail compiled into ledger atoms
 * (dorsal spec §9, §11, §13-§15).
 *
 * Mirrors the shipped lumbar level-detail module but for thoracic anatomy:
 * disc / central canal / CSF morphology / cord at level / foramina R-L /
 * posterior elements / ligamentum flavum and OLF / costovertebral region /
 * listhesis / epidural space.
 *
 * Deliberately absent: the lumbar lateral-recess grading and
 * exiting/traversing-root inference engine, and the pars-defect workflow.
 * Thoracic root naming is unreliable without rib counting, so root involvement
 * stays a descriptive choice (spec §13).
 *
 * Every atom carries `proseSource`: "canonical-library" when the sentence is the
 * library's own wording, "structured-choice" when the software is only rendering
 * the radiologist's selected term. Nothing here invents clinical prose.
 *
 * Pure functions only — no React, no store instance.
 */

import type { SpineAtomSpec } from "./mriSpineAtoms";
import { spineBundleId } from "./mriSpineAtoms";
import {
  DX_ALIGN,
  DX_CANAL,
  DX_DISC,
  DX_POSTERIOR,
  DX_SOFT,
  fillDxProse,
  type DxProseVars,
} from "./mriDorsalLibrary";
import { conusCovered, dorsalLevelKeyStrings, dorsalLevelKeys, junctionCovered, type DorsalNumberingState } from "./mriDorsalNumbering";
import { normalizeLevel } from "./observationSlot";
import type { SpineSequencesAvailable } from "./mriSpineSequences";
import { spineSequencesAllow } from "./mriSpineSequences";
import {
  DORSAL_LEVEL_CANAL_BASELINE,
  DORSAL_LEVEL_CORD_BASELINE,
  DORSAL_LEVEL_DISC_BASELINE,
  DORSAL_LEVEL_FORAMINAL_BASELINE,
} from "./mriDorsalLevelState";

export type Severity = "none" | "mild" | "moderate" | "severe";

export type DorsalCanalMorphology =
  | "csf_preserved"
  | "partial_csf_effacement"
  | "complete_csf_effacement"
  | "cord_contact"
  | "cord_flattening"
  | "v_shaped_olf";

export type DorsalDiscLocation = "central" | "paracentral" | "foraminal" | "extraforaminal";

export type DorsalMigration = "none" | "cranial" | "caudal";

export type DorsalCordEffect =
  | "normal"
  | "displaced"
  | "flattened"
  | "compressed"
  | "swollen"
  | "atrophic";

export type DorsalForaminalSideDetail = {
  severity?: Exclude<Severity, "none"> | null;
  cause?: "disc" | "osteophyte" | "posterior_element" | "lesion" | null;
  laterality?: "right" | "left";
  rootDescriptive?: string | null;
};

export type DorsalFlavumDetail = {
  hypertrophy?: boolean | null;
  thicknessMm?: number | null;
  ossification?: "focal" | "nodular" | "continuous" | null;
  laterality?: "right" | "left" | "bilateral" | null;
};

export type DorsalCostovertebralDetail = {
  arthropathy?: boolean | null;
  osteophytes?: boolean | null;
};

export type DorsalListhesisDetail = {
  direction?: "antero" | "retro" | null;
  translationMm?: number | null;
};

export type DorsalEpiduralDetail = {
  finding?:
    | "normal_fat"
    | "prominent_fat"
    | "lipomatosis"
    | "mass"
    | "collection"
    | "hematoma"
    | "thecal_sac_compression"
    | null;
  canalEffect?: boolean | null;
  cordEffect?: boolean | null;
};

export type DorsalConusDetail = {
  /** Never defaulted: the radiologist states the termination level. */
  terminationLevel?: string | null;
  compressed?: boolean | null;
  displaced?: boolean | null;
  signalAbnormality?: boolean | null;
};

export type DorsalLevelDetail = {
  canalMorphology?: DorsalCanalMorphology | null;
  apMm?: number | null;
  /** Radiologist-selected central canal severity for this level. */
  canalSeverity?: Severity | null;
  discSeverity?: Severity | null;
  discLocation?: DorsalDiscLocation | null;
  migration?: DorsalMigration | null;
  migrationMm?: number | null;
  calcified?: boolean | null;
  cordEffect?: DorsalCordEffect | null;
  cordSignal?: boolean | null;
  foramRight?: DorsalForaminalSideDetail | null;
  foramLeft?: DorsalForaminalSideDetail | null;
  flavum?: DorsalFlavumDetail | null;
  costovertebral?: DorsalCostovertebralDetail | null;
  listhesis?: DorsalListhesisDetail | null;
  epidural?: DorsalEpiduralDetail | null;
  conus?: DorsalConusDetail | null;
};

export type ProvenanceKind = "canonical-library" | "structured-choice";

export type DorsalDetailAtom = SpineAtomSpec & {
  /** How the sentence was produced — auditable, and shown in the UI. */
  proseSource: ProvenanceKind;
};

export const DORSAL_CANAL_MORPHOLOGY_OPTIONS: Array<{ id: DorsalCanalMorphology; label: string }> = [
  { id: "csf_preserved", label: "CSF preserved" },
  { id: "partial_csf_effacement", label: "Partial CSF effacement" },
  { id: "complete_csf_effacement", label: "Complete local CSF effacement" },
  { id: "cord_contact", label: "Cord contact" },
  { id: "cord_flattening", label: "Cord flattening" },
  { id: "v_shaped_olf", label: "V-shaped narrowing (OLF)" },
];

export const DORSAL_SEVERITY_OPTIONS: Array<{ id: Exclude<Severity, "none">; label: string }> = [
  { id: "mild", label: "Mild narrowing" },
  { id: "moderate", label: "Moderate narrowing" },
  { id: "severe", label: "Severe stenosis" },
];

export const DORSAL_DISC_LOCATION_OPTIONS: Array<{ id: DorsalDiscLocation; label: string }> = [
  { id: "central", label: "Central" },
  { id: "paracentral", label: "Paracentral" },
  { id: "foraminal", label: "Foraminal" },
  { id: "extraforaminal", label: "Extraforaminal" },
];

export const DORSAL_MIGRATION_OPTIONS: Array<{ id: DorsalMigration; label: string }> = [
  { id: "none", label: "No migration" },
  { id: "cranial", label: "Cranial migration" },
  { id: "caudal", label: "Caudal migration" },
];

export const DORSAL_CORD_EFFECT_OPTIONS: Array<{ id: DorsalCordEffect; label: string }> = [
  { id: "normal", label: "Normal at this level" },
  { id: "displaced", label: "Displaced" },
  { id: "flattened", label: "Flattened" },
  { id: "compressed", label: "Compressed" },
  { id: "swollen", label: "Focal swelling" },
  { id: "atrophic", label: "Focal atrophy" },
];

export const DORSAL_FORAMINAL_CAUSE_OPTIONS: Array<{ id: NonNullable<DorsalForaminalSideDetail["cause"]>; label: string }> = [
  { id: "disc", label: "Disc-related" },
  { id: "osteophyte", label: "Osteophyte-related" },
  { id: "posterior_element", label: "Posterior-element related" },
  { id: "lesion", label: "Focal lesion extending in" },
];

export const DORSAL_OLF_MORPHOLOGY_OPTIONS: Array<{ id: NonNullable<DorsalFlavumDetail["ossification"]>; label: string }> = [
  { id: "focal", label: "Focal" },
  { id: "nodular", label: "Nodular" },
  { id: "continuous", label: "Continuous" },
];

export const DORSAL_EPIDURAL_OPTIONS: Array<{ id: NonNullable<DorsalEpiduralDetail["finding"]>; label: string }> = [
  { id: "normal_fat", label: "Normal epidural fat" },
  { id: "prominent_fat", label: "Prominent epidural fat" },
  { id: "lipomatosis", label: "Spinal epidural lipomatosis" },
  { id: "mass", label: "Epidural mass" },
  { id: "collection", label: "Epidural collection" },
  { id: "hematoma", label: "Epidural hematoma" },
  { id: "thecal_sac_compression", label: "Thecal-sac compression" },
];

const SECTION_FRAMES: Record<string, string> = {
  canal_morphology: "CSF space",
  canal_stenosis: "Central canal",
  disc_contour: "Disc",
  disc_migration: "Disc fragment migration",
  cord_caliber: "Spinal cord",
  cord_compression: "Spinal cord",
  cord_signal: "Spinal cord signal",
  foraminal_stenosis: "Neural foramina",
  ligamentum_flavum: "Ligamentum flavum",
  olf: "Ligamentum flavum",
  costovertebral_joint: "Costovertebral region",
  spondylolisthesis: "Alignment",
  epidural_space: "Epidural space",
  epidural_lipomatosis: "Epidural space",
  epidural_collection: "Epidural space",
  conus_medullaris: "Conus medullaris",
};

/** Canonical-library prose when it exists; the radiologist's own choice otherwise. */
function detailSentence(
  libraryTemplate: string | null,
  vars: DxProseVars,
  sectionKey: keyof typeof SECTION_FRAMES,
  choiceLabel: string,
): { findings: string; proseSource: ProvenanceKind } {
  if (libraryTemplate) {
    const { text } = fillDxProse(libraryTemplate, vars);
    return { findings: text, proseSource: "canonical-library" };
  }
  return {
    findings: `${SECTION_FRAMES[sectionKey] ?? sectionKey}: ${choiceLabel}${vars.level ? ` at ${vars.level}` : ""}.`,
    proseSource: "structured-choice",
  };
}

function atom(input: DorsalDetailAtom): DorsalDetailAtom {
  return { role: "finding", ...input };
}

export function dorsalLevelDetailHasContent(detail: DorsalLevelDetail): boolean {
  return Boolean(
    detail.canalMorphology
    || detail.apMm != null
    || (detail.canalSeverity && detail.canalSeverity !== "none")
    || detail.discLocation
    || (detail.migration && detail.migration !== "none")
    || detail.calcified
    || (detail.cordEffect && detail.cordEffect !== "normal")
    || detail.cordSignal
    || detail.foramRight?.severity
    || detail.foramRight?.cause
    || detail.foramLeft?.severity
    || detail.foramLeft?.cause
    || detail.flavum?.hypertrophy
    || detail.flavum?.thicknessMm != null
    || detail.flavum?.ossification
    || detail.costovertebral?.arthropathy
    || detail.costovertebral?.osteophytes
    || detail.listhesis?.direction
    || detail.epidural?.finding
    || detail.conus?.terminationLevel
    || detail.conus?.compressed
    || detail.conus?.displaced
    || detail.conus?.signalAbnormality
  );
}

// ─── Central canal / CSF morphology ──────────────────────────────────────

function canalAtoms(level: string, detail: DorsalLevelDetail): DorsalDetailAtom[] {
  const out: DorsalDetailAtom[] = [];
  const morph = detail.canalMorphology;
  if (morph) {
    const option = DORSAL_CANAL_MORPHOLOGY_OPTIONS.find((o) => o.id === morph);
    // The library's severe-stenosis sentence names a degenerative cause, so the
    // level form renders the morphology as the radiologist's own choice instead
    // of borrowing that etiology.
    const sentence = detailSentence(
      null,
      { level, mm: detail.apMm },
      "canal_morphology",
      `${(option?.label ?? morph).toLowerCase()}${detail.apMm != null ? ` (AP diameter = ${detail.apMm} mm)` : ""}`,
    );
    out.push(atom({
      concept: "canal_morphology",
      conflictGroup: "canal_morphology",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: morph,
      measurement: detail.apMm != null ? String(detail.apMm) : undefined,
      proseSource: sentence.proseSource,
    }));
  } else if (detail.apMm != null) {
    out.push(atom({
      concept: "canal_ap",
      conflictGroup: "canal_ap",
      anatomicalSection: level,
      level,
      findings: detailSentence(null, { level, mm: detail.apMm }, "canal_stenosis", `AP canal diameter ${detail.apMm} mm`).findings,
      measurement: String(detail.apMm),
      proseSource: "structured-choice",
    }));
  }
  if (detail.canalSeverity && detail.canalSeverity !== "none") {
    const option = DORSAL_SEVERITY_OPTIONS.find((o) => o.id === detail.canalSeverity);
    const sentence = detailSentence(
      null,
      { level, mm: detail.apMm },
      "canal_stenosis",
      `${detail.canalSeverity} canal narrowing${option && option.id !== detail.canalSeverity ? ` (${option.label})` : ""}`,
    );
    out.push(atom({
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      severity: detail.canalSeverity,
      baselineReplaces: DORSAL_LEVEL_CANAL_BASELINE,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

// ─── Disc detail: location, calcification, migration, dimensions ─────────

function discAtoms(level: string, detail: DorsalLevelDetail): DorsalDetailAtom[] {
  const out: DorsalDetailAtom[] = [];
  if (detail.discLocation) {
    const template = detail.discLocation === "extraforaminal" ? DX_DISC.extraforaminal : null;
    const sentence = detailSentence(
      template,
      { level },
      "disc_contour",
      `${detail.discLocation} disc abnormality`,
    );
    out.push(atom({
      concept: "disc_contour",
      conflictGroup: "disc_contour",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: detail.discLocation,
      baselineReplaces: DORSAL_LEVEL_DISC_BASELINE,
      proseSource: sentence.proseSource,
    }));
  }
  if (detail.calcified) {
    const sentence = detailSentence(DX_DISC.calcifiedHerniation, { level, mm: detail.apMm }, "disc_contour", "calcified disc component");
    out.push(atom({
      concept: "disc_contour",
      conflictGroup: "disc_contour_calcified",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: "calcified",
      proseSource: sentence.proseSource,
    }));
  }
  if (detail.migration && detail.migration !== "none") {
    const option = DORSAL_MIGRATION_OPTIONS.find((o) => o.id === detail.migration);
    const sentence = detailSentence(
      null,
      { level, mm: detail.migrationMm, direction: detail.migration === "cranial" ? "superiorly" : "inferiorly" },
      "disc_migration",
      `${(option?.label ?? detail.migration).toLowerCase()}${detail.migrationMm != null ? ` by ${detail.migrationMm} mm` : ""}`,
    );
    out.push(atom({
      concept: "disc_migration",
      conflictGroup: "disc_migration",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: detail.migration,
      measurement: detail.migrationMm != null ? String(detail.migrationMm) : undefined,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

// ─── Cord at this level (spec §11) ───────────────────────────────────────

function cordAtoms(
  level: string,
  detail: DorsalLevelDetail,
  sequences: SpineSequencesAvailable | null,
  conusAcquired: boolean,
): DorsalDetailAtom[] {
  const out: DorsalDetailAtom[] = [];
  const effect = detail.cordEffect;
  if (effect && effect !== "normal") {
    const option = DORSAL_CORD_EFFECT_OPTIONS.find((o) => o.id === effect);
    if (effect === "compressed") {
      const sentence = detailSentence(null, { level }, "cord_compression", "thoracic spinal cord compression");
      out.push(atom({
        concept: "cord_compression",
        conflictGroup: "cord_compression",
        anatomicalSection: level,
        level,
        findings: sentence.findings,
        state: "compression",
        severity: "significant",
        baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
        proseSource: sentence.proseSource,
      }));
    } else {
      // Cord morphology has no dedicated library sentence of its own, so the
      // selected term is rendered as a structured choice.
      const sentence = detailSentence(
        null,
        { level },
        "cord_caliber",
        (option?.label ?? effect).toLowerCase(),
      );
      out.push(atom({
        concept: "cord_caliber",
        conflictGroup: "cord_caliber",
        anatomicalSection: level,
        level,
        findings: sentence.findings,
        state: effect,
        baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
        proseSource: sentence.proseSource,
      }));
    }
  } else if (effect === "normal") {
    // The library's thoracic cord normal sentence also certifies the conus, so
    // on a study that never acquired the conus the radiologist's own scoped
    // statement is used instead of a partial quote (§12).
    const sentence = conusAcquired
      ? { findings: DX_CANAL.cordNormal, proseSource: "canonical-library" as const }
      : detailSentence(null, { level }, "cord_caliber", "normal caliber and uniform intrinsic signal at this level");
    out.push(atom({
      concept: "cord_caliber",
      conflictGroup: "cord_caliber",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: "normal",
      role: "baseline",
      baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
      proseSource: sentence.proseSource,
    }));
  }
  if (detail.cordSignal) {
    // Cord signal needs a fluid-sensitive / T2 sequence to be stated at all.
    if (!sequences || spineSequencesAllow(sequences, ["t2"])) {
      const sentence = detailSentence(DX_CANAL.cordSignal, { level }, "cord_signal", "intrinsic cord T2 hyperintensity");
      out.push(atom({
        concept: "cord_signal",
        conflictGroup: "cord_signal",
        anatomicalSection: level,
        level,
        findings: sentence.findings,
        state: "hyperintensity",
        proseSource: sentence.proseSource,
      }));
    }
  }
  return out;
}

// ─── Thoracic foramina (spec §13) — descriptive root wording only ────────

function foraminalAtoms(
  level: string,
  side: "right" | "left",
  detail: DorsalForaminalSideDetail | null | undefined,
): DorsalDetailAtom[] {
  if (!detail) return [];
  const out: DorsalDetailAtom[] = [];
  if (detail.severity) {
    const option = DORSAL_SEVERITY_OPTIONS.find((o) => o.id === detail.severity);
    const causeOption = DORSAL_FORAMINAL_CAUSE_OPTIONS.find((o) => o.id === detail.cause);
    // The library's foraminal sentence asserts a disc + costovertebral cause, so
    // it is only used when the radiologist selected one of those causes.
    const template = detail.cause === "disc" || detail.cause === "osteophyte"
      ? DX_POSTERIOR.foraminalNarrowing
      : null;
    const sentence = detailSentence(
      template,
      { level, side },
      "foraminal_stenosis",
      `${detail.severity} ${side} foraminal narrowing${causeOption ? ` — ${causeOption.label.toLowerCase()} cause` : ""} (${option?.label ?? ""})`.replace(" ()", ""),
    );
    out.push(atom({
      concept: "foraminal_stenosis",
      conflictGroup: `foraminal_stenosis-${side}`,
      anatomicalSection: level,
      level,
      laterality: side,
      supportsLaterality: true,
      findings: sentence.findings,
      severity: detail.severity,
      state: detail.cause ?? undefined,
      baselineReplaces: DORSAL_LEVEL_FORAMINAL_BASELINE,
      proseSource: sentence.proseSource,
    }));
  }
  if (detail.rootDescriptive) {
    // No auto root numbering: the radiologist's own descriptive wording only.
    out.push(atom({
      concept: "root_contact",
      conflictGroup: `root-descriptive-${side}-${level.replace(/\s+/g, "")}`,
      anatomicalSection: level,
      level,
      laterality: side,
      supportsLaterality: true,
      findings: `${SECTION_FRAMES.foraminal_stenosis}: ${detail.rootDescriptive} (${side}, ${level}).`,
      state: "descriptive",
      proseSource: "structured-choice",
    }));
  }
  return out;
}

// ─── Posterior elements: ligamentum flavum / OLF / costovertebral ────────

function flavumAtoms(level: string, flavum: DorsalFlavumDetail | null | undefined): DorsalDetailAtom[] {
  if (!flavum) return [];
  const out: DorsalDetailAtom[] = [];
  if (flavum.hypertrophy || flavum.thicknessMm != null) {
    const sentence = detailSentence(
      null,
      { level, mm: flavum.thicknessMm },
      "ligamentum_flavum",
      `ligamentum flavum hypertrophy${flavum.thicknessMm != null ? ` (${flavum.thicknessMm} mm)` : ""}`,
    );
    out.push(atom({
      concept: "ligamentum_flavum",
      conflictGroup: "ligamentum_flavum",
      anatomicalSection: level,
      level,
      findings: sentence.findings,
      state: flavum.hypertrophy ? "hypertrophy" : "",
      measurement: flavum.thicknessMm != null ? String(flavum.thicknessMm) : undefined,
      proseSource: sentence.proseSource,
    }));
  }
  if (flavum.ossification) {
    // OLF is a diagnosis: emitted only because the radiologist selected it here.
    const option = DORSAL_OLF_MORPHOLOGY_OPTIONS.find((o) => o.id === flavum.ossification);
    const sentence = detailSentence(DX_CANAL.olf, { level }, "olf", `${(option?.label ?? flavum.ossification).toLowerCase()} ossification of the ligamentum flavum`);
    out.push(atom({
      concept: "olf",
      conflictGroup: `olf-${flavum.laterality ?? "bilateral"}`,
      anatomicalSection: level,
      level,
      laterality: flavum.laterality ?? "bilateral",
      supportsLaterality: true,
      findings: sentence.findings,
      state: flavum.ossification,
      proseSource: sentence.proseSource,
    }));
  }
  return out;
}

function costovertebralAtoms(level: string, cv: DorsalCostovertebralDetail | null | undefined): DorsalDetailAtom[] {
  if (!cv) return [];
  if (!cv.arthropathy && !cv.osteophytes) return [];
  const sentence = detailSentence(
    cv.arthropathy ? DX_POSTERIOR.costovertebralArthropathy : null,
    { level },
    "costovertebral_joint",
    cv.osteophytes ? "costovertebral osteophytes at this level" : "costovertebral joint abnormality at this level",
  );
  return [atom({
    concept: "costovertebral_joint",
    conflictGroup: "costovertebral_joint",
    anatomicalSection: level,
    level,
    findings: sentence.findings,
    state: [cv.arthropathy && "arthropathy", cv.osteophytes && "osteophytes"].filter(Boolean).join(","),
    proseSource: sentence.proseSource,
  })];
}

function listhesisAtoms(level: string, listhesis: DorsalListhesisDetail | null | undefined): DorsalDetailAtom[] {
  if (!listhesis?.direction) return [];
  const template = listhesis.direction === "retro" ? DX_ALIGN.retrolisthesis : DX_ALIGN.anterolisthesis;
  const parts = level.split("-");
  // The library asserts a cause ("secondary to traumatic injury or degenerative
  // facet disease"), so it is only used when a translation was actually
  // measured and the radiologist selected the slip direction at this level.
  const useLibrary = listhesis.translationMm != null;
  const sentence = detailSentence(
    useLibrary ? template : null,
    { level: parts[0] ?? level, level2: parts[1] ?? level, mm: listhesis.translationMm },
    "spondylolisthesis",
    `${listhesis.direction}listhesis${listhesis.translationMm != null ? ` measuring approximately ${listhesis.translationMm} mm` : ""}`,
  );
  return [atom({
    concept: "spondylolisthesis",
    conflictGroup: `${listhesis.direction}listhesis-${level.replace(/\s+/g, "")}`,
    anatomicalSection: level,
    level,
    findings: sentence.findings,
    state: listhesis.direction,
    measurement: listhesis.translationMm != null ? String(listhesis.translationMm) : undefined,
    proseSource: sentence.proseSource,
  })];
}

function epiduralAtoms(level: string, epidural: DorsalEpiduralDetail | null | undefined): DorsalDetailAtom[] {
  if (!epidural?.finding) return [];
  const finding = epidural.finding;
  const option = DORSAL_EPIDURAL_OPTIONS.find((o) => o.id === finding);
  const template = finding === "lipomatosis" ? DX_SOFT.epiduralLipomatosis : null;
  const sentence = detailSentence(
    template,
    { level },
    finding === "collection" || finding === "hematoma" ? "epidural_collection" : "epidural_space",
    (option?.label ?? finding).toLowerCase(),
  );
  const concept = finding === "lipomatosis"
    ? "epidural_lipomatosis"
    : finding === "collection" || finding === "hematoma"
      ? "epidural_collection"
      : "epidural_space";
  const out: DorsalDetailAtom[] = [atom({
    concept,
    conflictGroup: "epidural_space",
    anatomicalSection: level,
    level,
    findings: sentence.findings,
    state: finding,
    proseSource: sentence.proseSource,
  })];
  if (epidural.canalEffect) {
    const s = detailSentence(null, { level }, "canal_stenosis", "canal compromise from the epidural finding");
    out.push(atom({
      concept: "canal_stenosis",
      conflictGroup: "canal_stenosis_epidural",
      anatomicalSection: level,
      level,
      findings: s.findings,
      severity: "moderate",
      proseSource: s.proseSource,
    }));
  }
  if (epidural.cordEffect) {
    const s = detailSentence(null, { level }, "cord_compression", "cord compression from the epidural finding");
    out.push(atom({
      concept: "cord_compression",
      conflictGroup: "cord_compression",
      anatomicalSection: level,
      level,
      findings: s.findings,
      state: "compression",
      severity: "significant",
      proseSource: s.proseSource,
    }));
  }
  return out;
}

// ─── Conus (only when the junction is covered) ───────────────────────────

/**
 * The conus sits at one place in the spine, so its rows belong to the junction
 * level the resolver names — never to whichever level the form happens to be on.
 */
export function dorsalConusLevelAllowed(
  level: string,
  numbering: DorsalNumberingState | null | undefined,
): boolean {
  const junction = dorsalLevelKeys(numbering).find((k) => k.junction)?.key;
  return Boolean(junction) && levelKey(level) === levelKey(junction ?? "");
}

/**
 * The conus is cord tissue, so its four detail rows are kept in four different
 * ledger slots (`conus_medullaris` for the stated termination level, then the
 * cord compression / caliber / signal concepts). Two rows sharing a concept at
 * one level would be one observation, and a selected feature would be silently
 * dropped.
 */
function conusAtoms(
  level: string,
  conus: DorsalConusDetail | null | undefined,
  numbering: DorsalNumberingState | null | undefined,
): DorsalDetailAtom[] {
  if (!conus || !junctionCovered(numbering)) return [];
  if (!dorsalConusLevelAllowed(level, numbering)) return [];
  const out: DorsalDetailAtom[] = [];
  if (conus.terminationLevel) {
    // The library keeps this level bracketed; it is only ever filled from the
    // value the radiologist stated, never defaulted (spec §12).
    const filled = fillDxProse(DX_CANAL.conusTerminates, { conusLevel: conus.terminationLevel });
    out.push(atom({
      concept: "conus_medullaris",
      conflictGroup: "conus_position",
      anatomicalSection: "dorsal spine",
      level,
      findings: filled.text,
      state: "termination_level",
      measurement: conus.terminationLevel,
      role: "baseline",
      proseSource: "canonical-library",
    }));
  }
  if (conus.compressed) {
    const s = detailSentence(null, { level }, "conus_medullaris", "compression of the conus medullaris");
    out.push(atom({
      concept: "cord_compression",
      conflictGroup: "conus_compression",
      anatomicalSection: level,
      level,
      findings: s.findings,
      state: "conus_compression",
      severity: "significant",
      baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
      proseSource: s.proseSource,
    }));
  }
  if (conus.displaced) {
    const s = detailSentence(null, { level }, "conus_medullaris", "displacement of the conus medullaris");
    out.push(atom({
      concept: "cord_caliber",
      conflictGroup: "conus_displacement",
      anatomicalSection: level,
      level,
      findings: s.findings,
      state: "conus_displacement",
      baselineReplaces: DORSAL_LEVEL_CORD_BASELINE,
      proseSource: s.proseSource,
    }));
  }
  if (conus.signalAbnormality) {
    const s = detailSentence(DX_CANAL.conusContusion, { level }, "conus_medullaris", "conus signal abnormality");
    out.push(atom({
      concept: "cord_signal",
      conflictGroup: "conus_signal",
      anatomicalSection: level,
      level,
      findings: s.findings,
      state: "conus_signal_abnormality",
      proseSource: s.proseSource,
    }));
  }
  return out;
}

// ─── Bundle ──────────────────────────────────────────────────────────────

export type DorsalLevelDetailBundle = {
  bundleId: string;
  atoms: DorsalDetailAtom[];
  /** Sentences that are not canonical-library prose — shown as such in the UI. */
  structuredChoiceCount: number;
};

/**
 * Compile the level detail selections into ledger atoms. The caller applies them
 * through `applyMacroBundle`, exactly like the existing dorsal level rows.
 */
export function buildDorsalLevelDetailBundle(opts: {
  level: string;
  detail: DorsalLevelDetail;
  numbering?: DorsalNumberingState | null;
  sequences?: SpineSequencesAvailable | null;
}): DorsalLevelDetailBundle {
  const atoms: DorsalDetailAtom[] = [
    ...canalAtoms(opts.level, opts.detail),
    ...discAtoms(opts.level, opts.detail),
    ...cordAtoms(opts.level, opts.detail, opts.sequences ?? null, conusCovered(opts.numbering)),
    ...foraminalAtoms(opts.level, "right", opts.detail.foramRight),
    ...foraminalAtoms(opts.level, "left", opts.detail.foramLeft),
    ...flavumAtoms(opts.level, opts.detail.flavum),
    ...costovertebralAtoms(opts.level, opts.detail.costovertebral),
    ...listhesisAtoms(opts.level, opts.detail.listhesis),
    ...epiduralAtoms(opts.level, opts.detail.epidural),
    ...conusAtoms(opts.level, opts.detail.conus, opts.numbering ?? null),
  ];
  return {
    bundleId: spineBundleId("dx-detail", opts.level.replace(/\s+/g, "")),
    atoms,
    structuredChoiceCount: atoms.filter((a) => a.proseSource === "structured-choice").length,
  };
}

/** Same canonical level key the V1 dorsal level blocks use (T→D lettering). */
function levelKey(raw: string): string {
  return normalizeLevel(raw) || raw.trim().toUpperCase();
}

/** Re-hydrate the detail chips from the ledger so state stays derived. */
export function deriveDorsalLevelDetail(
  rows: Array<{
    observation?: { concept?: string | null; laterality?: string; severity?: string; state?: string; level?: string; measurement?: string };
    ownership?: { concept?: string | null; laterality?: string; conflictGroup?: string | null; anatomicalSection?: string | null };
  }>,
  level: string,
): DorsalLevelDetail {
  const detail: DorsalLevelDetail = {};
  // CARE stores thoracic levels with dorsal lettering ("D8-D9"), so the ledger
  // comparison goes through the same canonical key the V1 dorsal level blocks
  // use — matching on the raw "T8-T9" string would read back nothing.
  const want = levelKey(level);
  if (!want) return detail;
  for (const row of rows) {
    const obs = row.observation;
    const concept = (obs?.concept ?? row.ownership?.concept ?? "").toLowerCase();
    const rowLevel = levelKey(obs?.level ?? row.ownership?.anatomicalSection ?? "");
    if (rowLevel !== want) continue;
    const laterality = (obs?.laterality ?? row.ownership?.laterality ?? "").toLowerCase();
    const severity = (obs?.severity ?? "").toLowerCase() as Severity;
    const state = (obs?.state ?? "").toLowerCase();
    // Conus rows live on the cord concepts so each keeps its own slot; the state
    // prefix is what identifies them again here.
    const isConusRow = state.startsWith("conus_");
    const measurement = Number(String(obs?.measurement ?? "").replace(/[^\d.]/g, ""));

    if (concept === "canal_morphology" && state) {
      detail.canalMorphology = state as DorsalCanalMorphology;
      if (Number.isFinite(measurement)) detail.apMm = measurement;
    }
    if (concept === "canal_ap" && Number.isFinite(measurement)) {
      detail.apMm = measurement;
    }
    if (concept === "canal_stenosis" && severity && row.ownership?.conflictGroup === "canal_stenosis") {
      detail.canalSeverity = severity;
    }
    if (concept === "disc_contour" && state) {
      if (state === "calcified") detail.calcified = true;
      else if (state === "central" || state === "paracentral" || state === "foraminal" || state === "extraforaminal") {
        detail.discLocation = state as DorsalDiscLocation;
      }
    }
    if (concept === "disc_migration" && state) {
      detail.migration = state as DorsalMigration;
      if (Number.isFinite(measurement)) detail.migrationMm = measurement;
    }
    if (concept === "cord_compression" && !isConusRow) detail.cordEffect = "compressed";
    if (concept === "cord_caliber" && state && !isConusRow) {
      detail.cordEffect = state as DorsalCordEffect;
    }
    if (concept === "cord_signal" && !isConusRow) detail.cordSignal = true;
    if (concept === "foraminal_stenosis") {
      const side = laterality.includes("right") ? "right" : laterality.includes("left") ? "left" : null;
      if (side) {
        const key = side === "right" ? "foramRight" : "foramLeft";
        detail[key] = {
          ...(detail[key] ?? {}),
          severity: severity ? (severity as Exclude<Severity, "none">) : undefined,
          cause: state ? (state as NonNullable<DorsalForaminalSideDetail["cause"]>) : undefined,
          laterality: side,
        };
      }
    }
    if (concept === "root_contact" && state === "descriptive") {
      const side = laterality.includes("right") ? "right" : "left";
      const key = side === "right" ? "foramRight" : "foramLeft";
      detail[key] = { ...(detail[key] ?? {}), laterality: side, rootDescriptive: "suspected intercostal nerve involvement" };
    }
    if (concept === "ligamentum_flavum") {
      detail.flavum = { ...(detail.flavum ?? {}), hypertrophy: state.includes("hypertrophy") };
      if (Number.isFinite(measurement)) detail.flavum.thicknessMm = measurement;
    }
    if (concept === "olf") {
      detail.flavum = {
        ...(detail.flavum ?? {}),
        ossification: (state || "focal") as NonNullable<DorsalFlavumDetail["ossification"]>,
        laterality: (laterality as DorsalFlavumDetail["laterality"]) ?? "bilateral",
      };
    }
    if (concept === "costovertebral_joint") {
      const states = state.split(",");
      detail.costovertebral = {
        arthropathy: states.includes("arthropathy") || detail.costovertebral?.arthropathy === true,
        osteophytes: states.includes("osteophytes") || detail.costovertebral?.osteophytes === true,
      };
    }
    if (concept === "spondylolisthesis" && state) {
      detail.listhesis = {
        direction: /retro/i.test(state) ? "retro" : "antero",
        translationMm: Number.isFinite(measurement) ? measurement : null,
      };
    }
    if (concept === "epidural_space" || concept === "epidural_lipomatosis" || concept === "epidural_collection") {
      const finding = (concept === "epidural_lipomatosis" ? "lipomatosis" : state) as NonNullable<DorsalEpiduralDetail["finding"]>;
      detail.epidural = { ...(detail.epidural ?? {}), finding };
    }
    if (concept === "conus_medullaris" && state === "termination_level") {
      const stated = String(obs?.measurement ?? "").trim();
      // Never re-derive a termination level the radiologist did not state.
      if (stated) detail.conus = { ...(detail.conus ?? {}), terminationLevel: stated };
    }
    if (state === "conus_compression") {
      detail.conus = { ...(detail.conus ?? {}), compressed: true };
    }
    if (state === "conus_displacement") {
      detail.conus = { ...(detail.conus ?? {}), displaced: true };
    }
    if (state === "conus_signal_abnormality") {
      detail.conus = { ...(detail.conus ?? {}), signalAbnormality: true };
    }
  }
  return detail;
}

/** Level options offered by the shared level component (resolver-driven). */
export function dorsalLevelOptionsFor(numbering: DorsalNumberingState | null | undefined): string[] {
  return dorsalLevelKeyStrings(numbering);
}
