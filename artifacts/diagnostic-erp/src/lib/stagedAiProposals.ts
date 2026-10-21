/**
 * Staged shadow/overnight AI proposals awaiting Composer-style Apply.
 * Accept stages; Apply materializes; never auto-finalizes.
 */
import { normalizeForDedupe } from "./reportFieldMerge";

export type StagedAiProposal = {
  id: string;
  findingKey: string;
  text: string;
  source: "shadow_ai";
  draftId?: number | string | null;
};

export function stageShadowProposal(
  existing: StagedAiProposal[],
  proposal: Omit<StagedAiProposal, "id"> & { id?: string },
): StagedAiProposal[] {
  const id = proposal.id ?? `shadow:${proposal.findingKey}:${Date.now()}`;
  // Replace same findingKey so Accept is idempotent per finding.
  const without = existing.filter((p) => p.findingKey !== proposal.findingKey);
  return [...without, { ...proposal, id, source: "shadow_ai" }];
}

/** True when the report already says this line, punctuation and spacing aside. */
function alreadySaid(block: string, line: string): boolean {
  const needle = normalizeForDedupe(line);
  return needle.length > 0 && normalizeForDedupe(block).includes(needle);
}

/**
 * True when every line of this proposal is already said by the report, so staging or
 * applying it would change nothing. The queue uses this to stop offering a sentence
 * the radiologist has already accepted.
 */
export function proposalAddsNothing(findings: string, text: string): boolean {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => alreadySaid(findings, line));
}

/**
 * Append each staged line that the report does not already say.
 *
 * The skip is the whole reason Apply is safe to press twice. A queued AI draft stays
 * in the report's queue until it is applied, and the same sentence can arrive again
 * from a re-open, a second Accept on the same finding, or a draft that was applied
 * before the row's status was read — and an append that cannot tell "new" from
 * "already in the report" would put the same finding in a radiologist's Findings
 * twice, which then prints twice on a signed report.
 */
export function materializeStagedProposals(existingFindings: string, staged: StagedAiProposal[]): string {
  let out = existingFindings;
  for (const p of staged) {
    for (const line of p.text.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      if (alreadySaid(out, line)) continue;
      out = out.trim() ? `${out.trimEnd()}\n${line}` : line;
    }
  }
  return out;
}

