/**
 * radiologyDraftId.ts — pure draft-identity logic for the Radiology
 * Reporting Workspace (Roadmap Ticket A3.0).
 *
 * Deliberately zero-dependency (no React, no @/lib/fetchApi) so it's
 * unit-testable under the root vitest config with no path-alias resolution
 * needed — same reasoning as lib/abnormalityEngine.ts / quickFindingsMerge.ts.
 * hooks/useRadiologyDraftId.ts wires this logic to useState/useEffect/useQuery.
 */

export interface RadiologyDraftRow {
  id: number;
  studyId: number | null;
  worklistId: number | null;
  patientId: number | null;
  templateId: string | null;
  modality: string | null;
  studyName: string | null;
  clinicalHistory: string | null;
  rawFindings: string | null;
  findingsSections: string | null;
  impression: string | null;
  recommendation: string | null;
  formattedReportHtml: string | null;
  formattedReportText: string | null;
  status: string;
  updatedAt: string;
  // M1.4 — additive columns GET /drafts already returns (full-row select):
  // the canonical D1 draft document written by D3 (selection-restore
  // fallback source) and the patient_reports row a D5 structured finalize
  // promoted this draft into (lifecycle-metadata lookup key).
  structuredJsonD1?: unknown;
  finalReportId?: number | null;
}

/**
 * Given a possibly-loaded existing draft, returns the id a caller should
 * adopt as the "current draft" identity — or null if there is none (blank
 * draft).
 */
export function pickAdoptedDraftId(existingDraft: RadiologyDraftRow | null): number | null {
  return existingDraft ? existingDraft.id : null;
}

/**
 * Merges a save-draft POST body with the currently-tracked draft id: absent
 * on the first save (server creates a new row), present on every save after
 * (server updates that same row — see radiology-report-generator.ts's
 * `if (id) { update } else { insert }` branch, which already supported this
 * and was simply never sent an id by RadiologyReportingWorkspace.tsx).
 */
export function withDraftId<T extends object>(body: T, draftId: number | null): T & { id?: number } {
  return { ...body, id: draftId ?? undefined };
}
