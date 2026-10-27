/**
 * laterality.ts — the stated-side ↔ written-side conflict, in one spelling.
 *
 * A structure was selected as LEFT and the sentence that carries it now says
 * RIGHT. This is the most consequential typo a radiologist can leave in a signed
 * report, because everything downstream — the surgical side, the marker scan, the
 * consent — reads the side from the prose and never from the selection.
 *
 * The rule lived only in the AI finding gauntlet
 * (`artifacts/api-server/src/lib/ai/findingValidation.ts`), which meant the one
 * reader that could see it was the reader judging a MODEL's output. The
 * radiologist's own keystrokes overwrote a structured observation's side with no
 * check at all: the ledger kept `laterality: "left"`, the narrative said "right",
 * and nothing compared the two. Moved here rather than copied because a second
 * spelling of the side vocabulary is a second thing to keep honest — the same
 * reasoning that pulled Q104's four regexes out of `reportValidator.ts` and into
 * `findingsImpression.ts`. The gauntlet re-exports it, so its callers and its
 * tests are unchanged and there is still exactly one rule.
 *
 * Deliberately as permissive as the gauntlet's copy has always been. Both silences
 * below are clinical necessities, not leniency:
 *
 *   • a stated side of "bilateral", "none" or nothing at all is never in conflict
 *     — a bilateral finding is legitimate, and a structure with no side (midline,
 *     whole-organ) has nothing to contradict;
 *   • a sentence that names no side is never in conflict, and a sentence that names
 *     the stated side ALONGSIDE others is not either. "Left and right paravertebral
 *     collections" against a LEFT selection agrees with the selection; so does the
 *     correct contralateral picture "right hemispheric infarct with left-sided
 *     weakness".
 *
 * Warns. Rewrites nothing — see the callers.
 */

/**
 * The one side vocabulary, spelled once. Both readers below are built from it, so
 * the words this module COUNTS and the words {@link sideBlindText} REMOVES can never
 * drift apart — a strip that missed a word the counter sees would make a
 * side-edited sentence look like a different sentence entirely.
 */
const SIDE_WORDS = "left|right|bilateral";

/** The side a structured observation records. `""` / `"none"` = no side claimed. */
export type StatedLaterality = "left" | "right" | "bilateral" | "none";

/** Every side this text names. Empty when the text is silent on side. */
export function sidesNamedInText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of (text ?? "").matchAll(new RegExp(`\\b(${SIDE_WORDS})\\b`, "gi"))) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * The text with every side word deleted, for asking "is this the same sentence,
 * written about the other side?"
 *
 * Only the observation ledger needs this, and only because CARE's own
 * contribution match (`normalizeContributionMatch`) is an exact normalized
 * equality: the moment a radiologist types RIGHT over LEFT the recorded
 * contribution no longer matches anything, so the sentence he edited is invisible
 * to every rule that locates a contribution by equality — including this one,
 * which would then skip precisely the case it exists to catch.
 */
export function sideBlindText(text: string): string {
  return (text ?? "").replace(new RegExp(`\\b(${SIDE_WORDS})\\b`, "gi"), " ");
}

/**
 * Whether a stated side contradicts the sides a text names, as a sentence fit to
 * show a signer — or null when there is nothing to say.
 *
 * Named for the stated side it judges, because this package already exports a
 * different laterality rule and the two must not be confused at a call site:
 * `lateralityContradictions` (Q104) compares the Findings SECTION against the
 * Impression SECTION and never sees a selection. This one compares a structured
 * selection against the sentence that carries it.
 *
 * `stated` is typed loosely on purpose: the two live sources hand it different
 * shapes (the gauntlet's `Laterality`, the observation ledger's bare `string`
 * which is `""` when the structure has no side), and a caller that had to
 * pre-translate would translate differently in each place. Lowercasing is a no-op
 * for every value the gauntlet's union type allows.
 */
export function statedLateralityConflict(
  stated: string | null | undefined,
  text: string,
): string | null {
  const side = String(stated ?? "").trim().toLowerCase();
  if (side !== "left" && side !== "right") return null;
  const inText = sidesNamedInText(text);
  if (inText.size === 0) return null; // text is silent on side — nothing to contradict
  if (inText.has(side)) return null; // text names the stated side, alone or among others
  return `stated laterality "${side}" conflicts with text laterality (${[...inText].join("/")})`;
}
