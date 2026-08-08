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

export interface StudyTextOverridePayload {
  finding: string;
  impression: string;
  technique: string;
  recommendation: string;
}

export interface QuickSelectFindingPayload {
  findingId: number;
  // The 5-field abnormality instance, optionally carrying:
  //   __structured  — Structured Finding Assistant dropdown values
  //   __textOverride — study-local double-click edit (this report only)
  // The whole object is stored verbatim in the finding's persisted params.
  params:
    | AbnormalityInstance
    | (AbnormalityInstance & { __structured?: Record<string, string>; __textOverride?: StudyTextOverridePayload });
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
  structuredValues?: Map<number, Record<string, string>>,
  textOverrides?: Map<number, StudyTextOverridePayload>,
): QuickSelectFindingPayload[] {
  return Array.from(selectedQuickIds).map((findingId) => {
    const base = quickInstances.get(findingId) ?? EMPTY_INSTANCE;
    const sv = structuredValues?.get(findingId);
    const to = textOverrides?.get(findingId);
    const extras: { __structured?: Record<string, string>; __textOverride?: StudyTextOverridePayload } = {};
    if (sv && Object.keys(sv).length > 0) extras.__structured = sv;
    if (to) extras.__textOverride = to;
    return Object.keys(extras).length > 0
      ? { findingId, params: { ...base, ...extras } }
      : { findingId, params: base };
  });
}
