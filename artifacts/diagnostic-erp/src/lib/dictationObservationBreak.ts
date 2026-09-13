/**
 * Mouse-first dictation helpers for Findings / Impression.
 * Voice engines stream run-on paragraphs; these utilities keep each
 * observation on its own line without requiring keyboard choreography.
 */

/** Replace sentence-end ". " with ".\n" so each observation stacks on a new line. */
export function breakObservationsAtSentenceEnds(text: string): string {
  if (!text) return text;
  // Collapse runs of spaces after a period into a single newline boundary.
  // Preserve existing newlines; avoid turning ".\n" into ".\n\n" accidentally.
  return text
    .replace(/\.(?:[ \t\u00a0]+)(?!\n)/g, ".\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** True when the latest edit introduced a ". " boundary that still needs a break. */
export function needsObservationBreak(prev: string, next: string): boolean {
  if (next === prev) return false;
  if (!/\.(?:[ \t\u00a0]+)(?!\n)/.test(next)) return false;
  const broken = breakObservationsAtSentenceEnds(next);
  return broken !== next;
}

/** Apply live intercept: if the buffer contains ". " run-ons, rewrite to newlines. */
export function interceptDictationRunOns(raw: string): string {
  return breakObservationsAtSentenceEnds(raw);
}

const CLINICAL_ACRONYMS = new Set([
  "mri", "ct", "xr", "us", "usg", "pet", "spect", "cxr", "ncvt", "dwi", "adc",
  "flair", "stir", "mip", "mpr", "cta", "mra", "hrct", "ncct", "cect",
]);

/** Lightweight Title Case for clinical cleanup (preserves newlines). */
export function toClinicalTitleCase(text: string): string {
  return text.replace(/[^\s\n]+/g, (word) => {
    if (word.length === 0) return word;
    // Keep all-caps acronyms (MRI, CT, XR) of 2–5 letters untouched.
    if (/^[A-Z]{2,5}$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (CLINICAL_ACRONYMS.has(lower)) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}
