/**
 * mriSpineSequences.ts — sequence / protocol awareness for spine reporting
 * (spec §12, §32, §35).
 *
 * The V3 rule is absolute: a statement that needs STIR, DWI, contrast, a
 * whole-spine localizer, dynamic imaging or a screening region may only be
 * produced when that acquisition actually exists. When it does not, the
 * composer emits limitation wording instead of the negative finding — silence
 * about a sequence is not evidence of normality.
 *
 * Availability is derived from the text the workspace already holds
 * (technique / study description / protocol / format title) and is ALWAYS
 * manually overridable in the canvas header. Deriving is a convenience; the
 * radiologist's override wins.
 *
 * Pure functions only — no store, no React.
 */

export type SpineSequenceKey =
  | "t1"
  | "t2"
  | "stir"
  | "dwi"
  | "contrast"
  | "axial"
  | "wholeSpineLocalizer"
  | "dynamic"
  | "cervicalScreening"
  | "dorsalScreening"
  | "lsScreening";

export type SpineSequencesAvailable = Record<SpineSequenceKey, boolean>;

export const SPINE_SEQUENCE_LABELS: Record<SpineSequenceKey, string> = {
  t1: "T1-weighted imaging",
  t2: "T2-weighted imaging",
  stir: "STIR / fat-suppressed fluid-sensitive sequence",
  dwi: "DWI",
  contrast: "contrast (post-gadolinium T1)",
  axial: "axial sequences",
  wholeSpineLocalizer: "whole-spine / localizer coverage",
  dynamic: "dynamic (flexion-extension / upright) imaging",
  cervicalScreening: "cervical spine screening coverage",
  dorsalScreening: "dorsal spine screening coverage",
  lsScreening: "LS spine screening coverage",
};

export const SPINE_SEQUENCE_KEYS = Object.keys(SPINE_SEQUENCE_LABELS) as SpineSequenceKey[];

/** Nothing is assumed performed until the study says so or the radiologist says so. */
export function defaultSpineSequences(): SpineSequencesAvailable {
  const out = {} as SpineSequencesAvailable;
  for (const key of SPINE_SEQUENCE_KEYS) out[key] = false;
  return out;
}

const PATTERNS: Record<SpineSequenceKey, RegExp> = {
  t1: /\bt1\b/i,
  t2: /\bt2\b/i,
  stir: /\bstir\b|space[- ]?charging|t2[- ]?(?:fs|fat[- ]?sat)|fat[- ]?sat|short tau/i,
  dwi: /\bdwi\b|\bdw[i1]\b|diffusion[- ]weighted|apparent diffusion|\badc\b/i,
  contrast: /contrast|gadolin|post[- ]?contrast|\bgd\b|\bc\+\+\b|enhancement study/i,
  axial: /\baxial\b/i,
  wholeSpineLocalizer: /whole[- ]?spine|whole spine|locali[sz]er|craniocaudal coverage|sagittal localizer/i,
  dynamic: /flexion|extension|dynamic|upright|weight[- ]?bearing|stress views?/i,
  cervicalScreening: /cervi(?:cal|s)\b/i,
  dorsalScreening: /\bdorsal\b|thoracic\b|t[- ]?spine\b/i,
  lsScreening: /\bls\b|lumbosacral|lumbar\b|lumbari|l[- ]?spine\b/i,
};

const CONTRAST_NEGATIVE = /non[- ]?contrast|without contrast|no contrast|plain\b|\bnct\b/i;

export type SpineSequenceSourceText = {
  techniqueText?: string | null;
  studyDescription?: string | null;
  protocolName?: string | null;
  reportTitle?: string | null;
  activeFormatName?: string | null;
  clinicalHistory?: string | null;
};

/**
 * Text-derived availability. Screening keys are deliberately not derived from
 * the Technique field alone — they are bound to the region roles (spec §23);
 * this is the fallback when no role information is available.
 */
export function deriveSpineSequencesAvailable(
  src: SpineSequenceSourceText,
  overrides?: Partial<SpineSequencesAvailable>,
): SpineSequencesAvailable {
  const blob = [
    src.techniqueText,
    src.studyDescription,
    src.protocolName,
    src.reportTitle,
    src.activeFormatName,
    src.clinicalHistory,
  ]
    .filter(Boolean)
    .join(" ");

  const out = defaultSpineSequences();
  for (const key of SPINE_SEQUENCE_KEYS) {
    let on = blob.length > 0 && PATTERNS[key].test(blob);
    if (key === "contrast" && on && CONTRAST_NEGATIVE.test(blob) && !/post[- ]?contrast|with contrast|gadolin/i.test(blob)) {
      on = false;
    }
    out[key] = on;
  }
  // Whole-spine coverage implies every region was at least screened.
  if (/whole[- ]?spine/i.test(blob)) {
    out.cervicalScreening = true;
    out.dorsalScreening = true;
    out.lsScreening = true;
  }
  // An explicit override always beats derivation, in both directions.
  if (overrides) {
    for (const key of SPINE_SEQUENCE_KEYS) {
      const v = overrides[key];
      if (typeof v === "boolean") out[key] = v;
    }
  }
  return out;
}

export function spineSequencesAllow(
  avail: SpineSequencesAvailable,
  keys: SpineSequenceKey | SpineSequenceKey[],
): boolean {
  const list = Array.isArray(keys) ? keys : [keys];
  return list.every((k) => avail[k] === true);
}

export function missingSpineSequenceLabels(
  avail: SpineSequencesAvailable,
  keys: SpineSequenceKey[],
): string[] {
  return keys.filter((k) => !avail[k]).map((k) => SPINE_SEQUENCE_LABELS[k]);
}

/**
 * Statements that require an acquisition the study may not have. Used by the
 * contradiction validator on text the radiologist (or an AI draft) typed —
 * warning only, never a rewrite.
 */
export const SPINE_STATEMENT_RULES: Array<{
  keys: SpineSequenceKey[];
  re: RegExp;
  label: string;
}> = [
  {
    keys: ["stir"],
    re: /\bmarrow edema\b|\bbone marrow edema\b|\bstir\b|fat[- ]?saturated|fluid[- ]sensitive/i,
    label: "a STIR / fluid-sensitive-dependent statement",
  },
  {
    keys: ["dwi"],
    re: /\brestricted diffusion\b|\bdwi\b|diffusion restriction/i,
    label: "a DWI-dependent statement",
  },
  {
    keys: ["contrast"],
    re: /enhanc\w+|non[- ]?enhancing|post-?contrast|gadolin|hyperenhancement/i,
    label: "a contrast-dependent statement",
  },
  {
    keys: ["dynamic"],
    re: /dynamic instability|flexion|extension|functional spondylolisthesis|interval translation/i,
    label: "a dynamic-imaging-dependent statement",
  },
  {
    keys: ["wholeSpineLocalizer"],
    re: /whole[- ]?spine numbering|numbering (?:confirmed|established) on the whole[- ]?spine/i,
    label: "a whole-spine-localizer-dependent statement",
  },
];

/**
 * Limitation wording substituted for a negative finding. These are system
 * statements about what the examination covered, not clinical findings.
 */
export function spineLimitationSentence(
  keys: SpineSequenceKey[],
  subject = "the corresponding abnormality",
): string {
  const named = keys.map((k) => SPINE_SEQUENCE_LABELS[k]).filter(Boolean);
  if (named.length === 0) return "";
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `This examination did not include ${list}; ${subject} cannot be assessed.`;
}

/**
 * Sagittal-only screening cannot support axial-dependent detail (foraminal
 * grading, root conclusions). Schemas mark those options `axialDependent`.
 */
export function screeningAxialDetailAllowed(avail: SpineSequencesAvailable): boolean {
  return avail.axial === true;
}

/** True when no level localizer/whole-spine coverage supports precise levels. */
export function levelPrecisionAllowed(avail: SpineSequencesAvailable): boolean {
  return avail.wholeSpineLocalizer === true;
}

export function spineSequencesSummary(avail: SpineSequencesAvailable): SpineSequenceKey[] {
  return SPINE_SEQUENCE_KEYS.filter((k) => avail[k]);
}
