// normalize.ts — the single label-normalization used for alias resolution.
//
// The audit found the same concept spelled many ways across layers:
//   "Midline Shift" / "Midline shift" / "midline_shift" / "meas.midline_shift"
//   "CBD" / "CBD Diameter" / "Common Bile Duct Diameter" / "cbd_diameter"
// Normalization collapses case/punctuation/separator differences; genuinely
// different word forms are handled by explicit `aliases` on each definition —
// never by fuzzy matching, so resolution stays deterministic.

/** Lowercase; any run of non-alphanumerics (except % and /) becomes one space. */
export function normalizeMeasurementLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9%/]+/g, " ")
    .trim();
}

/**
 * Secondary form with parenthetical qualifiers removed, so labels like
 * "BPD (Biparietal Diameter)" or "Stone Size (if present)" also resolve via
 * their base alias. Applied only when the full form found no match.
 */
export function stripParenthetical(raw: string): string {
  return raw.replace(/\([^)]*\)/g, " ");
}
