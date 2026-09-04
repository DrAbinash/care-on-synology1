/**
 * Staged shadow/overnight AI proposals awaiting Composer-style Apply.
 * Accept stages; Apply materializes; never auto-finalizes.
 */
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

export function materializeStagedProposals(existingFindings: string, staged: StagedAiProposal[]): string {
  let out = existingFindings;
  for (const p of staged) {
    const t = p.text.trim();
    if (!t) continue;
    out = out.trim() ? `${out.trimEnd()}\n${t}` : t;
  }
  return out;
}
