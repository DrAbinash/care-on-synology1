// text/recommendation.ts — the Impression→Recommendation dependency behind Q005.
//
// One reading, two consumers, for the same reason ./findingsImpression.ts exists:
// the canonical text tier (./evaluate.ts) and the live workspace validator
// (artifacts/diagnostic-erp/src/lib/reportValidator.ts) both call this and nothing
// else for Q005, so the badge on the screen and the score the server persists
// cannot disagree about whether advice was due.
//
// What was wrong. Q005 used to read `!recommendation.trim()` — an empty advice
// section was itself the defect, on every report, unconditionally. That is the
// opposite of CARE's own clinical policy, which is stated in three places the
// quality engine never read: the composer prompt forbids filler advice
// ("NEVER generate filler recommendations such as 'Clinical correlation advised'
// merely to fill a section"), the composer validator DELETES a boilerplate
// recommendation and warns `filler_recommendation_cleared`, and the deterministic
// path only ever carries a recommendation the radiologist supplied. Two components
// in opposition, with nothing connecting them: the advice section is emptied on
// purpose and then penalised for being empty.
//
// Measured on the golden corpus (20 correct reports, 72 seeded defects) before this
// module existed:
//   • Q005 fired on 0 of 92 inputs as written — it detected nothing at all.
//   • On the 7 correct reports whose advice is exactly the filler the composer is
//     told to delete, the composer clears it and the score then drops 100 → 95 with
//     Q005 as the only new signal. All 7 are NORMAL studies, where no advice is the
//     correct answer.
//   • With the advice blanked on all 20, Q005 fired on 20 of 20. The predicate here
//     fires on 3: ct-brain-subdural ("Urgent neurosurgical review."),
//     mammography-normal ("Routine screening interval recommended.") and
//     mammography-suspicious-mass ("Tissue diagnosis advised."). In all three the
//     Impression states a plan and the advice section that should carry it is empty,
//     and in all three the corpus's own correct report DOES carry that advice.
//     17 false positives removed, 3 true ones kept.
//
// Why the Impression and not the Findings. A Findings sentence describes what was
// seen, not what is being asked for next, and it routinely contains a plan verb
// inside a negation: three of the twenty correct reports say "No restricted
// diffusion to suggest acute infarction", "No filling defect to suggest a ductal
// stone" and "No extraluminal gas to suggest perforation". Reading the Findings
// would have added three more false dependencies on correct reports, each one a
// denied statement.
//
// Why these five words and not more. "review", "repeat", "opinion" and
// "correlate/correlation" were all considered and left out on evidence. Bare
// "correlation" above all: it is the exact phrase CARE's anti-filler policy names as
// filler, so a rule that demanded it would recreate the defect this module removes.
// The five that remain — recommend, advise, suggest, urgent, follow-up — appear in
// three of the twenty correct Impressions and in every one of them the report is
// asking for something.
//
// Why "advised" needed one more exclusion. Two of the filler shapes the composer
// deletes — "Clinical correlation advised." and "Clinical correlation is advised." —
// contain a plan verb, so an Impression carrying that sentence would have raised a
// dependency the composer is forbidden to satisfy. The filler shape therefore lives
// here and is exported (`isFillerAdvice`), and the composer validator imports it
// instead of keeping its own copy: the sentence one component refuses to write is
// the same sentence the other refuses to demand. No measured corpus report hits this
// (0 of 20 clean, 0 of 72 seeded defects); it is closed because leaving two owners of
// one policy is how they diverge.
//
// Still advisory. Q005 keeps severity "warning", tier "heuristic" and significance
// "advisory", so nothing here can stop a signature: an absent advice section is a
// gap in the prose, and §9 of the brief is explicit that a recommendation must never
// be forced into a report that does not need one.

import { sectionSentences, statementDeniedAt } from "./clinicalTerms";

/**
 * The words with which an Impression asks for something to happen next. Matched
 * whole-word and read through the shared denial vocabulary, so "no follow-up
 * imaging recommended" is a decision NOT to act and leaves the advice section
 * correctly empty.
 */
const PLAN_VERB_RE =
  /\b(?:recommend|recommends|recommended|advise|advises|advised|suggest|suggests|suggested|urgent|urgently|follow[\s-]?up)\b/gi;

/**
 * Advice that says nothing. The whole of the text must be one of these shapes — a
 * report that adds "…and repeat the Doppler in one week" is advice, not filler.
 *
 * Single owner. `artifacts/api-server/src/lib/reportComposer/validateOutput.ts`
 * imports this to decide what to delete from an AI draft; `statedPlan` below calls
 * the same predicate to decide what not to demand.
 */
const FILLER_ADVICE_RE =
  /^(please\s+)?(clinical\s+correlation(\s+is)?\s+advised\.?|correlate\s+clinically\.?|clinical\s+correlation\.?)$/i;

export function isFillerAdvice(text: string): boolean {
  return FILLER_ADVICE_RE.test((text ?? "").trim());
}

/** The first plan an Impression states and has not withdrawn, quoted for the message. */
function statedPlan(impressionLine: string): string | null {
  for (const sentence of sectionSentences(impressionLine)) {
    if (isFillerAdvice(sentence)) continue;
    PLAN_VERB_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLAN_VERB_RE.exec(sentence)) !== null) {
      if (!statementDeniedAt(sentence, m.index, m.index + m[0].length)) return sentence.trim();
    }
  }
  return null;
}

/**
 * The reason the advice section is missing something it owes — or null when it owes
 * nothing.
 *
 * Asymmetric on purpose. An Impression that states a plan and an empty advice
 * section is a report that has lost the one line telling the referring clinician
 * what to do about it. The reverse — advice with no plan in the Impression — is not
 * a defect, because a radiologist may advise follow-up on a study whose summary
 * reads as unremarkable, and marking that up would be the rule demanding prose.
 *
 * Returns the message rather than a boolean so that both callers print the same
 * sentence and name the same plan; the parity harness compares their outputs.
 */
export function unmetRecommendationDependency(
  impression: readonly (string | null | undefined)[] | null | undefined,
  recommendation: string | null | undefined,
): string | null {
  if ((recommendation ?? "").trim()) return null;
  for (const line of impression ?? []) {
    const plan = statedPlan(line ?? "");
    if (!plan) continue;
    const quoted = plan.length > 90 ? `${plan.slice(0, 90)}…` : plan;
    return `Recommendation missing: the Impression states a plan ("${quoted}") but the Recommendation section is empty.`;
  }
  return null;
}
