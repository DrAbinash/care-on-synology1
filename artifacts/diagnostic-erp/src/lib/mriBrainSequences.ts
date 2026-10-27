/**
 * mriBrainSequences.ts — sequence-awareness for MRI Brain reporting.
 *
 * Derives which MR sequences / contrast were actually performed from the
 * Technique field (+ report title / clinical history), reusing the same
 * free-text markers normalBootstrap.ts keys on. No DB change: techniqueText
 * is the single source of truth the workspace already has.
 *
 * Pure functions only — no store, no React.
 */

export type BrainSequenceKey =
  | "t1"
  | "t2"
  | "flair"
  | "dwi"
  | "adc"
  | "swiGre"
  | "contrast"
  | "mrs"
  | "mra"
  | "mrv"
  | "pediatric";

export type BrainSequenceContext = {
  performed: Record<BrainSequenceKey, boolean>;
  /** True when the technique text names at least one recognizable sequence. */
  hasTechniqueSignal: boolean;
};

const SEQUENCE_PATTERNS: Record<BrainSequenceKey, RegExp> = {
  t1: /\bt1[- ]?w\b|\bt1\b|spin[- ]?echo/i,
  t2: /\bt2[- ]?w\b|\bt2\b|fiesta|true[- ]?fisp|haste/i,
  flair: /flair|fluid[- ]attenuated/i,
  dwi: /\bdwi\b|\bdw[i1]\b|diffusion[- ]weighted/i,
  adc: /\badc\b|apparent diffusion/i,
  swiGre: /\bswi\b|\bgre\b|gradient[- ]?echo|t2\*|susceptibility/i,
  contrast: /contrast|gadolin|\bce[- ]?mri\b|post[- ]?contrast|\bwith contrast\b|enhancement study/i,
  mrs: /\bmrs\b|spectroscopy/i,
  mra: /\bmra\b|angio(graph|graphy)\b|arterial/i,
  mrv: /\bmrv\b|veno(graph|graphy)|venous sinus/i,
  pediatric: /paedi|pediatr|neonat|infant|infants?\b|\bchild\b|\bmonths? old\b|\byears? old\b/i,
};

export const BRAIN_SEQUENCE_LABELS: Record<BrainSequenceKey, string> = {
  t1: "T1",
  t2: "T2",
  flair: "FLAIR",
  dwi: "DWI",
  adc: "ADC",
  swiGre: "GRE/SWI",
  contrast: "contrast",
  mrs: "MRS",
  mra: "MRA",
  mrv: "MRV",
  pediatric: "pediatric protocol",
};

const CONTRAST_NEGATIVE = /non[- ]?contrast|without contrast|no contrast|\bnct\b/i;

export function parseBrainSequences(text: string | null | undefined): BrainSequenceContext {
  const t = (text ?? "").trim();
  const performed = {} as Record<BrainSequenceKey, boolean>;
  let hits = 0;
  (Object.keys(SEQUENCE_PATTERNS) as BrainSequenceKey[]).forEach((key) => {
    let on = t.length > 0 && SEQUENCE_PATTERNS[key].test(t);
    // "non-contrast" mentions the word but is the opposite of contrast.
    if (key === "contrast" && on && CONTRAST_NEGATIVE.test(t)) on = false;
    performed[key] = on;
    if (on && key !== "pediatric" && key !== "contrast") hits += 1;
  });
  return { performed, hasTechniqueSignal: hits > 0 };
}

/**
 * Conservative gate for generated statements: a sequence-dependent statement
 * may only be produced when the technique positively names that sequence.
 * With no technique signal at all we allow the conventional core (T1/T2/FLAIR)
 * but never DWI/ADC, SWI/GRE, contrast, MRS or angiography conclusions.
 */
export function sequenceAllows(
  ctx: BrainSequenceContext,
  key: BrainSequenceKey | BrainSequenceKey[],
): boolean {
  const keys = Array.isArray(key) ? key : [key];
  return keys.every((k) => ctx.performed[k]);
}

export function missingSequenceLabels(
  ctx: BrainSequenceContext,
  keys: BrainSequenceKey[],
): string[] {
  return keys.filter((k) => !ctx.performed[k]).map((k) => BRAIN_SEQUENCE_LABELS[k]);
}

/** Statement prefixes that assert a sequence-dependent conclusion. */
export const SEQUENCE_STATEMENT_RULES: Array<{
  key: BrainSequenceKey;
  /** Requires ALL of these when listed alongside `key`. */
  also?: BrainSequenceKey[];
  re: RegExp;
  label: string;
}> = [
  {
    key: "dwi",
    also: ["adc"],
    re: /restricted diffusion|restriction is seen|no restricted diffusion|dw\/adc/i,
    label: "a DWI/ADC-dependent statement",
  },
  {
    key: "swiGre",
    re: /susceptibility|blooming|micro-?bleed|siderosis|gre\/swi sequence/i,
    label: "a GRE/SWI-dependent statement",
  },
  {
    key: "contrast",
    re: /enhanc\w+|post-?contrast|gadolin/i,
    label: "a contrast-dependent statement",
  },
  { key: "mrs", re: /spectroscop|\bmrs\b|naa|choline/i, label: "an MRS-dependent statement" },
  { key: "mra", re: /\bmra\b|arterial occlusion|arterial stenosis/i, label: "an MRA-dependent statement" },
  { key: "mrv", re: /\bmrv\b|venous sinus thrombosis|dural venous/i, label: "an MRV-dependent statement" },
];
