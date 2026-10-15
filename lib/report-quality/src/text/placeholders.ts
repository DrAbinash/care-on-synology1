// text/placeholders.ts — the un-filled placeholder vocabulary.
//
// One list of the ways CARE's own content writes "a value goes here", and one
// function that finds them. Q106 in ./evaluate.ts and the workspace's
// `validateReport` both read it, so the badge, the persisted quality findings
// and the finalize dialog cannot disagree about what counts as unfilled.
//
// WHY A LIST RATHER THAN A PATTERN. The rule this replaces was
// `text.includes("{value}")` — one literal, chosen because it was the first
// spelling anyone wrote down. Measured over the shipped catalogue, `{value}` is
// not even the commonest blank CARE emits: 13 Findings tiles and 1
// Recommendation tile in `quick-select-tiles.data.ts` write `___`, the
// "Standard H&P" history tile writes `[symptom]`/`[duration]`, the master
// templates write `[vascular territory]` and `[normal/reduced]`, and the spine
// libraries write a bare `X` before a unit. A report CARE generated itself from
// its own tiles therefore printed "Mass effect with midline shift of ___ mm."
// and scored 95/100, with the single finding being a missing clinical history.
//
// Each dialect below cites the shipped content that uses it. Nothing here is
// speculative: a spelling that no producer emits would only be a way to mark up
// a correct report.
//
// WHY NOT THE WRITE SIDE. `quickSelectParameterContract.ts` refuses a tile whose
// `{side}`/`{severity}` was never chosen, and its header declines the rest on
// purpose — "text a radiologist types is first-class, braces and all (an
// unfilled `___` blank or their own shorthand is not this contract's business)."
// That is the correct division: the write boundary cannot know whether a blank is
// a template nobody filled or shorthand its author intends to complete. Reading
// the finished report can, and that reading is this module.
//
// Deliberately conservative:
//   • A brace counts only when it holds one of the five tokens
//     `abnormalityEngine.fillTemplate` substitutes. `{a, b}` and `{BIRADS}` are
//     prose, not slots.
//   • Two underscores do not count — only a run of three or more, which is how
//     every shipped blank is written. A hand-drawn signature line and an
//     em-dash run are not measurement slots.
//   • A bracket counts only when it opens with a letter, so `[1]` and `[+/-]`
//     are left alone.
//   • A bare `X` counts only when a measurement unit follows it, so "X-ray" and
//     "X ray projection" are not slots.
//
// The measured false-positive floor is zero: across the 20 golden-corpus reports
// (both polarities, all ten examinations) and the baseline manifests that generate
// a normal report, none of the four dialects appears once.

/** The four ways shipped content writes an un-filled slot. */
export type PlaceholderKind =
  /** `{side}` `{severity}` `{chronicity}` `{level}` `{value}` — see abnormalityEngine.fillTemplate. */
  | "template-token"
  /** A run of three or more underscores: `___ mm`, `___ × ___ × ___ cm`. */
  | "blank"
  /** A bracketed fill-in: `[symptom]`, `[vascular territory]`, `[normal/reduced]`. */
  | "bracket-slot"
  /** A bare `X` where a number belongs, written as one dimension group: `X mm`, `X x X cm`. */
  | "bare-measurement";

export interface PlaceholderDialect {
  kind: PlaceholderKind;
  /** Human-readable name for the dialect, used in the emitted message. */
  label: string;
  pattern: RegExp;
}

/**
 * The vocabulary, in the order the dialects were found in the shipped content.
 * Every pattern is global so one call can find every occurrence; `lastIndex` is
 * reset on each use, so the array is safe to share.
 */
export const PLACEHOLDER_DIALECTS: readonly PlaceholderDialect[] = [
  {
    kind: "template-token",
    label: "template token",
    pattern: /\{(?:side|severity|chronicity|level|value)\}/g,
  },
  {
    kind: "blank",
    label: "blank",
    pattern: /_{3,}/g,
  },
  {
    kind: "bracket-slot",
    label: "bracketed slot",
    pattern: /\[[A-Za-z][^\]\n]*\]/g,
  },
  {
    // One match per dimension group, not per `X`: "X x X cm" is a single
    // measurement the reporter still has to supply, and reporting it three times
    // would make one blank look like three.
    kind: "bare-measurement",
    label: "un-entered measurement",
    pattern: /\bX\b(?:\s*[x×]\s*X\b)*(?=\s*(?:mm|cm|%))/gi,
  },
] as const;

export interface PlaceholderHit {
  kind: PlaceholderKind;
  /** The exact text that is still unfilled, as it appears in the report. */
  raw: string;
  /** Character offset of the hit, so callers can point at it. */
  index: number;
}

/**
 * Every un-filled placeholder in `text`, in the order they appear.
 *
 * Ordered across dialects rather than grouped by them: a message that names the
 * first thing a reporter left blank has to name the first thing in the sentence,
 * not the first thing in whichever dialect happens to be listed first.
 */
export function unfilledPlaceholders(text: string): PlaceholderHit[] {
  if (!text) return [];
  const hits: PlaceholderHit[] = [];
  for (const dialect of PLACEHOLDER_DIALECTS) {
    dialect.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = dialect.pattern.exec(text)) !== null) {
      if (m[0] === "") {
        // Guard against a zero-width match advancing nowhere and looping forever.
        dialect.pattern.lastIndex += 1;
        continue;
      }
      hits.push({ kind: dialect.kind, raw: m[0], index: m.index });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * The first un-filled placeholder, or null when the text is complete.
 *
 * Q106 emits once per report rather than once per blank — a report with four
 * `___` in it is one unfinished measurement story, and four separate deductions
 * would let a single unfilled tile outweigh a laterality contradiction in the
 * score.
 */
export function firstUnfilledPlaceholder(text: string): PlaceholderHit | null {
  return unfilledPlaceholders(text)[0] ?? null;
}

export function hasUnfilledPlaceholder(text: string): boolean {
  return firstUnfilledPlaceholder(text) !== null;
}

/** The prose sections of a report, as both callers of Q106 hold them. */
export interface ReportProseFields {
  findings?: string | null;
  impression?: string[] | string | null;
  technique?: string | null;
  recommendation?: string | null;
  clinicalHistory?: string | null;
}

/** Scanned in this order, so the message names a Findings blank before a Technique one. */
const FIELD_SCAN_ORDER: ReadonlyArray<{ key: keyof ReportProseFields; label: string }> = [
  { key: "findings", label: "Findings" },
  { key: "impression", label: "Impression" },
  { key: "technique", label: "Technique" },
  { key: "recommendation", label: "Recommendation" },
  { key: "clinicalHistory", label: "Clinical history" },
];

/**
 * The Q106 warning for a whole report, or null when every section is filled in.
 *
 * Both consumers — the canonical text tier and the workspace's `validateReport` —
 * call this rather than assembling the sentence themselves. They are compared
 * message-for-message by the shadow parity harness, and a rule whose wording each
 * side writes out is a rule that drifts: that is how this file's predecessor came
 * to be one `includes("{value}")` in one place and the same literal in another.
 */
export function reportPlaceholderWarning(fields: ReportProseFields): string | null {
  for (const { key, label } of FIELD_SCAN_ORDER) {
    const value = fields[key];
    const text = Array.isArray(value) ? value.join("\n") : (value ?? "");
    const hit = firstUnfilledPlaceholder(text);
    if (hit) return `An un-filled placeholder "${hit.raw}" is still present in the report (${label}).`;
  }
  return null;
}
