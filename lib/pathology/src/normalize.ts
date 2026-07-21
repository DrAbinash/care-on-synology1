// normalize.ts — the single label-normalization used for alias resolution.
//
// The same analyte is spelled many ways across templates and imported lab
// dictionaries: "Haemoglobin" / "Hemoglobin" / "Hb" / "HGB" / "Hemoglobin
// (Hb)". Normalization collapses case/punctuation/separator differences;
// genuinely different word forms are handled by explicit `aliases` on each
// definition — never by fuzzy matching, so resolution stays deterministic.
// (Same design as lib/measurements/src/normalize.ts.)

/** Lowercase; any run of non-alphanumerics (except % and /) becomes one space. */
export function normalizeAnalyteLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9%/]+/g, " ")
    .trim();
}

/**
 * Secondary form with parenthetical qualifiers removed, so labels like
 * "Hemoglobin (Hb)" or "SGPT (ALT)" also resolve via their base alias. Applied
 * only when the full form found no match.
 */
export function stripParenthetical(raw: string): string {
  return raw.replace(/\([^)]*\)/g, " ");
}
