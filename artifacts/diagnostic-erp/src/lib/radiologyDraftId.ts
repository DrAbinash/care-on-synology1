/**
 * radiologyDraftId.ts — pure draft-identity logic for the Radiology
 * Reporting Workspace (Roadmap Ticket A3.0).
 *
 * Deliberately zero-dependency (no React, no @/lib/fetchApi) so it's
 * unit-testable under the root vitest config with no path-alias resolution
 * needed — same reasoning as lib/abnormalityEngine.ts / quickFindingsMerge.ts.
 * hooks/useRadiologyDraftId.ts wires this logic to useState/useEffect/useQuery.
 */

import { TECHNIQUE_SECTION_KEY } from "./draftTechniqueRoundTrip";

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
  structuredJson?: unknown;
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

/**
 * The narrative a save request carried, in the editor's own field names. A null
 * field means the request sent no value for that column at all, which is not the
 * same claim as an empty one: `RadiologyReportGenerator` writes Findings as
 * sections and never sends `rawFindings`, so its row keeps null there.
 */
export type SavedDraftNarrative = {
  clinicalHistoryText: string | null;
  techniqueText: string | null;
  findingsText: string | null;
  impressionText: string | null;
  recommendationText: string | null;
};

/** The response fields this module is willing to believe, and no others. */
export type SavedDraftResponseRow = {
  templateId?: string | null;
  modality?: string | null;
  studyName?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  finalReportId?: number | null;
  formattedReportHtml?: string | null;
  formattedReportText?: string | null;
  /**
   * Present on the real response and deliberately NOT read — see the rule above:
   * `.returning()` runs before the structured_json patch, so this field is one
   * save behind the row it describes. Declared so the omission is visible rather
   * than accidental.
   */
  structuredJson?: unknown;
};

/**
 * The draft row a successful save proves the server now holds.
 *
 * WHY THE BROWSER HAS TO BUILD IT
 *
 * The reporting workspace caches one draft row per study (`useRadiologyDraftId`)
 * and hydrates the editor from that cache. Before this, a save recorded only the
 * row *id*, so the cached row kept the narrative as it was when the study was
 * opened. Switch patients and come back before the next read settles and the
 * editor is handed that stale row — and because hydration then clears `isDirty`,
 * the 30-second autosave never re-arms, so the following save writes the stale
 * narrative over the newer one on the server. Measured in the browser audit as
 * an acknowledged sentence disappearing after a patient switch.
 *
 * WHAT COUNTS AS PROVEN
 *
 * HTTP 200 from `/save-draft` acknowledges the BYTES THIS REQUEST SENT, so the
 * narrative columns are restated from the request, not from the response. The
 * identity and lifecycle fields come from the response when it carries them; an
 * older or partial response body must not invent a timestamp.
 *
 * `structuredJson` deliberately keeps the previously-known envelope rather than
 * the response's: `writeDraftRow` reads the row back with `.returning()` BEFORE
 * the A4 cache regeneration, the D3 writer and `persistCareStructuredJsonPatch`
 * run, so the envelope in any save response is one save behind the row it
 * describes. Claiming it would put measurements the server never confirmed into
 * the hydration source; the settled read replaces this field, and the live
 * store — not this cache — is what the next save sends.
 */
export type AcknowledgedDraftRowArgs = {
  /** The study key the save was sent for (the worklist row id). */
  studyId: number;
  /** The row id the server acknowledged. */
  draftId: number;
  /** Patient the save was sent under, or null when the study has none yet. */
  patientId: number | null | undefined;
  /** The exact narrative this request carried. */
  sent: SavedDraftNarrative;
  /** The structured sections map this request carried, when it carried one. */
  sentSections: Record<string, unknown> | undefined;
  /** `res.draft` from the save response. */
  responseDraft: SavedDraftResponseRow | null | undefined;
  /** The row known for THIS study before this save, when there is one. */
  previous: RadiologyDraftRow | null | undefined;
};

export function acknowledgedDraftRow(args: AcknowledgedDraftRowArgs): RadiologyDraftRow {
  const { sent, previous } = args;
  const response = args.responseDraft ?? {};
  // Mirrors save-draft's `sectionsForStore`: the request's sections, then the
  // trimmed Technique folded in, then null when nothing is left to store.
  const sections: Record<string, unknown> = { ...(args.sentSections ?? {}) };
  if (sent.techniqueText?.trim()) sections[TECHNIQUE_SECTION_KEY] = sent.techniqueText.trim();
  const storedSections = Object.keys(sections).length > 0 ? JSON.stringify(sections) : null;
  const textOr = (value: string | null | undefined, fallback: string | null | undefined) =>
    value === undefined ? fallback ?? null : value;
  return {
    id: args.draftId,
    // POST /save-draft overwrites study_id with the resolved worklist row, so
    // both columns hold the same key — the same value a later read returns.
    studyId: args.studyId,
    worklistId: args.studyId,
    patientId: args.patientId ?? previous?.patientId ?? null,
    templateId: textOr(response.templateId, previous?.templateId),
    modality: textOr(response.modality, previous?.modality),
    studyName: textOr(response.studyName, previous?.studyName),
    clinicalHistory: sent.clinicalHistoryText,
    rawFindings: sent.findingsText,
    findingsSections: storedSections,
    // The route stores `JSON.stringify(rest.impression)` and the workspace sends
    // `[impressionText]`, so this is the column the server wrote.
    impression: sent.impressionText == null ? null : JSON.stringify([sent.impressionText]),
    recommendation: sent.recommendationText,
    formattedReportHtml: textOr(response.formattedReportHtml, previous?.formattedReportHtml),
    formattedReportText: textOr(response.formattedReportText, previous?.formattedReportText),
    status: textOr(response.status, previous?.status) ?? "draft",
    finalReportId: response.finalReportId ?? previous?.finalReportId ?? null,
    structuredJson: previous?.structuredJson ?? null,
    structuredJsonD1: previous?.structuredJsonD1 ?? null,
    updatedAt: textOr(response.updatedAt, previous?.updatedAt) ?? new Date().toISOString(),
  };
}
