/**
 * sideSwap.ts — laterality helpers for the Smart Reporting side selector.
 *
 * One template serves LEFT / RIGHT / BILATERAL: at insert time the chosen
 * side replaces every whole-word occurrence of left/right/bilateral in the
 * template text, preserving the original capitalization style (lower,
 * Capitalized, UPPER). Word boundaries prevent mangling words that merely
 * contain the letters (e.g. "brighter" is never touched).
 *
 * Pure, dependency-free, unit-tested (sideSwap.test.ts).
 */

export type Side = "left" | "right" | "bilateral";

const SIDE_WORD = /\b(left|right|bilateral)\b/gi;

function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Replaces every whole-word left/right/bilateral with `side`, case-preserved. */
export function applySide(text: string, side: Side): string {
  return text.replace(SIDE_WORD, (match) => matchCase(side, match));
}

/** Swaps left↔right throughout (bilateral untouched), case-preserved. */
export function swapSides(text: string): string {
  return text.replace(SIDE_WORD, (match) => {
    const lower = match.toLowerCase();
    if (lower === "left") return matchCase("right", match);
    if (lower === "right") return matchCase("left", match);
    return match; // bilateral stays
  });
}

/** True if the template mentions any side word (i.e. the selector applies). */
export function hasSideWords(text: string): boolean {
  return /\b(left|right|bilateral)\b/i.test(text);
}
