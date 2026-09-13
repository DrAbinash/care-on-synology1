/**
 * Mouse-first dictation helpers for Findings / Impression.
 * Voice engines stream run-on paragraphs; these utilities keep each
 * observation on its own line without requiring keyboard choreography.
 */

/**
 * Clinical / medical abbreviations that commonly end with a period.
 * A following ". " must NOT force a newline (case-insensitive match).
 */
export const CLINICAL_SENTENCE_ABBREVIATIONS = [
  // Titles & anatomy
  "Dr", "Mr", "Mrs", "Ms", "Pt", "Lt", "Rt", "Ant", "Post", "Sup", "Inf", "Lat", "Med", "No",
  // Measurements & time
  "mm", "cm", "m", "g", "mg", "ml", "vol", "sec", "min", "hr", "approx", "wt", "ht", "mo", "yr",
  // Clinical shorthand
  "vs", "eg", "ie", "etc", "fig", "ref", "bilat", "unilat",
] as const;

const ABBREV_SET = new Set(
  CLINICAL_SENTENCE_ABBREVIATIONS.map((a) => a.toLowerCase()),
);

/** Word characters allowed in an abbreviation token immediately before '.'. */
const ABBREV_TOKEN = /[A-Za-z]+$/;

/**
 * True when the period at `periodIndex` is a decimal point (digit on both sides),
 * e.g. `1.5`, `0.9`, `3.2`.
 */
export function isDecimalPeriod(text: string, periodIndex: number): boolean {
  if (periodIndex < 0 || periodIndex >= text.length || text[periodIndex] !== ".") return false;
  const prev = text[periodIndex - 1];
  const next = text[periodIndex + 1];
  return prev != null && next != null && /\d/.test(prev) && /\d/.test(next);
}

/**
 * True when the period at `periodIndex` closes a guarded clinical abbreviation
 * (e.g. `Dr.`, `approx.`, `vs.`).
 */
export function isClinicalAbbreviationPeriod(text: string, periodIndex: number): boolean {
  if (periodIndex < 0 || periodIndex >= text.length || text[periodIndex] !== ".") return false;
  const before = text.slice(0, periodIndex);
  const token = before.match(ABBREV_TOKEN)?.[0];
  if (!token) return false;
  // Require a non-letter boundary before the token (start, space, punct) so
  // "border." does not match "Dr" / "r" fragments incorrectly — full token only.
  const tokenStart = periodIndex - token.length;
  if (tokenStart > 0 && /[A-Za-z]/.test(text[tokenStart - 1]!)) return false;
  return ABBREV_SET.has(token.toLowerCase());
}

/** True when this ". " (or ".\t") boundary should become a newline. */
export function shouldBreakAfterPeriod(text: string, periodIndex: number): boolean {
  if (isDecimalPeriod(text, periodIndex)) return false;
  if (isClinicalAbbreviationPeriod(text, periodIndex)) return false;
  return true;
}

export type BreakObservationsResult = {
  text: string;
  /** Mapped caret after transformation (same index when length-neutral edits). */
  caret: number;
};

/**
 * Replace sentence-end ". " with ".\n" so each observation stacks on a new line.
 * Skips clinical abbreviations and decimal numbers.
 * When `caret` is provided, returns a remapped caret for live typing.
 */
export function breakObservationsAtSentenceEnds(
  text: string,
  caret?: number,
): string;
export function breakObservationsAtSentenceEnds(
  text: string,
  caret: number,
): BreakObservationsResult;
export function breakObservationsAtSentenceEnds(
  text: string,
  caret?: number,
): string | BreakObservationsResult {
  if (!text) {
    return caret == null ? text : { text, caret: caret ?? 0 };
  }

  let out = "";
  let mappedCaret = caret ?? 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] === ".") {
      // Consume the period first.
      out += ".";
      i += 1;

      // Decimal like 1.5 — period already emitted; continue with digits.
      if (i < text.length && /\d/.test(text[i]!) && /\d/.test(text[i - 2] ?? "")) {
        continue;
      }

      // Whitespace run after period?
      let j = i;
      while (j < text.length && /[ \t\u00a0]/.test(text[j]!)) j += 1;
      const wsLen = j - i;

      if (wsLen > 0 && (j >= text.length || text[j] !== "\n")) {
        const periodIndex = i - 1;
        if (shouldBreakAfterPeriod(text, periodIndex)) {
          // ". " / ".   " → ".\n" (period already written)
          out += "\n";
          if (caret != null && caret > i) {
            // Removed (wsLen - 1) characters (spaces beyond the one that became \n).
            mappedCaret -= wsLen - 1;
          } else if (caret != null && caret > periodIndex && caret <= j) {
            // Caret was inside the whitespace run → park it after the newline.
            mappedCaret = out.length;
          }
          i = j;
          continue;
        }
        // Guarded abbreviation / decimal-adjacent: keep a single space.
        out += " ";
        if (caret != null && caret > i) {
          mappedCaret -= wsLen - 1;
        } else if (caret != null && caret > periodIndex && caret <= j) {
          mappedCaret = out.length;
        }
        i = j;
        continue;
      }
      continue;
    }

    out += text[i];
    i += 1;
  }

  // Collapse accidental triple+ newlines from prior edits.
  const collapsed = out.replace(/\n{3,}/g, "\n\n");
  if (collapsed !== out && caret != null) {
    // Rare; clamp caret into range.
    mappedCaret = Math.min(mappedCaret, collapsed.length);
  }

  if (caret == null) return collapsed;
  return {
    text: collapsed,
    caret: Math.max(0, Math.min(mappedCaret, collapsed.length)),
  };
}

/** True when the latest edit introduced a ". " boundary that still needs a break. */
export function needsObservationBreak(prev: string, next: string): boolean {
  if (next === prev) return false;
  if (!/\.(?:[ \t\u00a0]+)(?!\n)/.test(next)) return false;
  const broken = breakObservationsAtSentenceEnds(next);
  return broken !== next;
}

/** Apply live intercept: if the buffer contains breakable ". " run-ons, rewrite. */
export function interceptDictationRunOns(raw: string): string {
  return breakObservationsAtSentenceEnds(raw);
}

/** Live intercept that also remaps the caret for accurate cursor placement. */
export function interceptDictationRunOnsWithCaret(
  raw: string,
  caret: number,
): BreakObservationsResult {
  return breakObservationsAtSentenceEnds(raw, caret);
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
