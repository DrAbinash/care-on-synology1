/**
 * unfilledMeasurements.ts — an unfinished measurement never reaches the report.
 *
 * Two shapes, both measured on the shipped catalogue (13 of 496 active Quick Select
 * boxes, `radiology_quick_findings`):
 *
 *  * a LITERAL blank an author typed where a number belongs — "largest measuring
 *    ___ mm", "maximum thickness ___ mm", "Follow-up scan recommended in ___ weeks".
 *    Those boxes carry no questions at all, so nothing in the app ever asked the
 *    radiologist for the number: the blank was the only thing the box could print,
 *    and it printed on the signed report.
 *  * a PARAMETER SLOT left empty — "…acute infarct. ASPECTS {aspects}." with the
 *    ASPECTS text question defaulted to "" leaves the bare label "ASPECTS." on the
 *    page, which reads as a score of nothing.
 *
 * Both are taken out here rather than refused with a dialog: the box still says
 * what it observed ("multiple echogenic foci with acoustic shadowing in the
 * gallbladder lumen, suggestive of cholelithiasis"), and an unanswered measurement
 * is simply not a measurement. What the sentence loses is returned in `removed` so
 * a caller that wants to tell the radiologist a size is missing can say so without
 * re-deriving it.
 *
 * ANCHORING IS THE WHOLE RULE. Only text that touches the hole may be removed:
 * every blank is first replaced by a sentinel and the follow-up rules match solely
 * against that sentinel. An earlier version ran a global "measure noun" cleanup
 * instead, and it silently rewrote "Ventricular system is otherwise normal in size
 * and configuration." to "normal in and configuration." in the same string — the
 * noun was nowhere near the blank. Prose that was complete when it arrived must
 * leave complete.
 */

/** One or more underscores — an author's blank, never a filled value. */
const BLANK = "_{2,}(?:\\s*[×x*]\\s*_{2,})*";
/** A unit that only makes sense attached to a measurement, when one follows. */
const UNIT = "(?:\\s*(?:mm|cm|cc|ml|mg|kg|g|weeks?|months?|years?|days?|hours?|minutes?)(?![a-z]))?";
/** A score denominator — "ASPECTS: ___/10" is an empty score, not "ASPECTS: /10". */
const SCORE = "(?:\\s*/\\s*\\d+(?:[.,]\\d+)?)?";
/** The value itself: the blank, its unit, its denominator. */
const VALUE = `${BLANK}${UNIT}${SCORE}`;
/** Where an excision happened. Turned into a space at the end, never printed. */
const MARK = "\u0001";

/** Measure phrases that exist only to carry the blank, so they go with it. */
const PASS1 = new RegExp(
  `\\s*\\b(?:measur(?:ing|es|ed))\\b(?:\\s+(?:approximately|about|up to))?\\s+${VALUE}\\b`,
  "gi",
);
/** "in ___ weeks", "of ___ mm", "at ___ cm", "dated ____" — the word belongs to the blank. */
const PASS2 = new RegExp(`\\s*\\b(?:in|of|at|to|up to|dated)\\s+(?:approximately\\s+)?${VALUE}\\b`, "gi");
/** Anything still blank: the blank and a trailing unit or score, nothing else. */
const PASS3 = new RegExp(`\\s*${VALUE}`, "g");

/**
 * Anchored on the sentinel, so they can only ever touch the hole:
 *  - a bracket whose only content was an unfilled measurement says nothing
 *    ("(FHR ___ bpm)", "(AP diameter ___ mm)")
 *  - the measure noun the blank followed (", maximum thickness ___ mm")
 *  - the sentence-initial label the blank was the whole answer to ("ASPECTS: ___/10",
 *    "Midline shift: ___ mm"). Matched only from a sentence start and never across a
 *    full stop, so the word run cannot reach back into the sentence before it.
 *  - a modifier stranded with no noun (", largest,")
 */
const ANCHORED = [
  { re: new RegExp(`\\(\\s*[^()]*${MARK}[^()]*\\)`, "gi"), keepsMark: true },
  {
    re: new RegExp(
      `\\s*,?\\s*(?:\\b(?:maximum|minimal|largest|smallest|mean|residual|post-void)\\b\\s*)?`
      + `\\b(?:thickness|diameter|width|length|volume|size|span|height)\\b[ \\t]*(?=[,:]?[ \\t]*${MARK})`,
      "gi",
    ),
    keepsMark: false,
  },
  {
    // "g" so every label in a scaffold like "BPD: ___ mm. HC: ___ mm. AC: ___ mm."
    // goes, not only the first.
    re: new RegExp(
      `(?<=^|(?<=[.])\\s)(?:[A-Za-z][A-Za-z0-9/-]*[ \\t]+){0,3}[A-Za-z][A-Za-z0-9/-]*[ \\t]*:[ \\t]*(?=${MARK})`,
      "g",
    ),
    keepsMark: false,
  },
  {
    re: new RegExp(`\\s*,?\\s*\\b(?:maximum|minimal|largest|smallest|mean)\\b[ \\t]*(?=${MARK})`, "gi"),
    keepsMark: false,
  },
];

/**
 * Grammar repair after an excision: no doubled spaces, no orphan punctuation, and no
 * comma stranded in front of a connective — the same rule `fillStructuredTemplate`
 * applies, so the two doors leave the same shape of sentence.
 */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    // Two commas first, so an excision that left ", ," does not hand the connective
    // rule below its chance — it would eat one comma and strand the other.
    .replace(/,\s*,/g, ",")
    .replace(/,\s*(and\b|with\b|causing\b)/gi, " $1")
    .replace(/\s*,\s*\./g, ".")
    // Several whole-sentence excisions in a row each leave their full stop behind.
    .replace(/\.{2,}/g, ".")
    .replace(/\.\s*\./g, ".")
    .replace(/(^[\s,]+|[\s,]+$)/g, "")
    .trim();
}

export type UnfilledStrip = { text: string; removed: string[] };

/** A section a box never carried is `undefined`; it still holds no blank. */
export function stripUnfilledMeasurements(text: string | undefined): UnfilledStrip {
  const original = text ?? "";
  if (!/_{2,}/.test(original)) return { text: original, removed: [] };
  const removed: string[] = [];
  let next = original;
  for (const pass of [PASS1, PASS2, PASS3]) {
    next = next.replace(pass, (match: string) => {
      if (!match.includes("__")) return match;
      const trimmed = match.trim();
      if (trimmed) removed.push(trimmed);
      return MARK;
    });
  }
  // The anchored rules are empty by construction wherever no hole was cut, because
  // each one demands the sentinel. Two rounds: a noun removed in round one can
  // expose the label in front of it.
  for (let round = 0; round < 2; round += 1) {
    for (const { re, keepsMark } of ANCHORED) {
      next = next.replace(re, (match: string) => {
        const trimmed = match.replace(/[\s\u0001]+$/g, "").trim();
        if (trimmed) removed.push(trimmed);
        return keepsMark ? MARK : "";
      });
    }
  }
  next = tidy(next.replace(/\u0001/g, " "));
  if (next) next = next[0].toUpperCase() + next.slice(1);
  return { text: next, removed };
}

/** True when text still carries a blank the strip could not account for. */
export function hasUnfilledMeasurement(text: string | undefined): boolean {
  return /_{2,}/.test(text ?? "");
}
