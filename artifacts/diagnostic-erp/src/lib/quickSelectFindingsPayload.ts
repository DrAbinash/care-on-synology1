import { EMPTY_INSTANCE, type AbnormalityInstance } from "./abnormalityEngine";

/**
 * quickSelectFindingsPayload.ts — pure derivation of the optional `findings[]`
 * field on the save-draft payload (Radiology Roadmap Ticket A3.1).
 *
 * Deliberately zero-dependency beyond abnormalityEngine.ts (itself alias-free)
 * so it's unit-testable under the root vitest config with no path-alias
 * resolution needed — same reasoning as lib/radiologyDraftId.ts.
 *
 * This ticket only SERIALIZES the Quick Select selection state into the
 * payload. Nothing consumes `findings[]` server-side yet (Ticket A3.2 owns
 * that) — see radiology-report-generator.ts's SaveDraftBody, which accepts
 * and validates the field but never writes it to any column.
 */

export interface QuickSelectFindingPayload {
  findingId: number;
  params: AbnormalityInstance;
}

/**
 * Builds the findings[] payload from the workspace's own Quick Select
 * selection state. Iterates `selectedQuickIds` (not just `quickInstances`'
 * keys) per the ticket's requirement, so a defensive fallback to
 * EMPTY_INSTANCE covers the case where the two pieces of state have ever
 * drifted out of sync — they are kept in sync by construction in
 * handleQuickToggle/handleInstanceUpdate, but this function does not rely
 * on that invariant holding.
 */
export function deriveQuickSelectFindings(
  selectedQuickIds: Iterable<number>,
  quickInstances: Map<number, AbnormalityInstance>,
): QuickSelectFindingPayload[] {
  return Array.from(selectedQuickIds).map((findingId) => ({
    findingId,
    params: quickInstances.get(findingId) ?? EMPTY_INSTANCE,
  }));
}
