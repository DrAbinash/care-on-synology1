import { reportAssertsAbnormality, statesAbnormalImpressionText } from "@/lib/conceptCanon/normalImpression";
import type { AppliedPathologyPatch } from "./store";
import type { MergeSentence } from "./types";

/**
 * Which sentences of a merged Impression the merge door will actually write.
 *
 * Ruling 2 — "a second report format must use the same provenance-aware rules as Quick
 * Select" — is enforced by `applyMergedResult`, and this is that enforcement. It lives here
 * as one pure function because two surfaces have to give the radiologist the same answer:
 * the door, which decides what lands on the page, and the Merge Preview, which shows him
 * what is about to land. A preview that promises "Normal MRI of the lumbosacral spine." and
 * then withholds it is a dialog that lies on the way to a clinically-correct result.
 *
 * The rule is scoped to the one contradiction a merge can create. When the report already
 * asserts an abnormality, the merged conclusion contributes the sentences that assert one;
 * its normality claims and its denials are withheld, because a whole-study normal printed
 * over a recorded abnormality is a report answering itself. `statesAbnormalImpressionText`
 * is the classifier the printed surfaces already use to decide which lines to bold, so the
 * door introduces no second vocabulary of what counts as normal.
 *
 * What the second format genuinely adds still lands, and nothing here removes a sentence
 * already on the page — that is the additive merge's job, not this function's.
 */
export function withheldMergedImpression(
  merged: ReadonlyArray<MergeSentence>,
  patches: ReadonlyArray<AppliedPathologyPatch>,
  fields: { findings?: string; impression?: string },
): { contributed: MergeSentence[]; withheld: MergeSentence[] } {
  if (!reportAssertsAbnormality(patches, fields)) {
    return { contributed: [...merged], withheld: [] };
  }
  const withheld = merged.filter((s) => !statesAbnormalImpressionText(s.text));
  return { contributed: merged.filter((s) => statesAbnormalImpressionText(s.text)), withheld };
}
