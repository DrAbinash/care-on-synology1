import { api } from "@/lib/fetchApi";

/**
 * Ticket M1.1 — the ONE shared draft-save/finalize service for radiology
 * study reporting.
 *
 * Before consolidation, RadiologyReportingWorkspace, RadiologistCockpit and
 * RadiologyCommandCenter each carried their own copy of the same two-step
 * finalize (POST /api/patient-reports when a patient is linked, then POST
 * /api/internal/radiology/report-status) and the same save-draft POST, with
 * drifting payloads: the Cockpit's copy never set deliveryStatus
 * (READY_TO_SEND), never sent createdBy, and dropped the modality/accession
 * parameters blob. The canonical behavior is the Reporting Workspace's
 * (REPORT_FINAL + READY_TO_SEND + parameters + createdBy); the other pages
 * now inherit it by calling this module instead of their inline copies.
 *
 * This module is a transport consolidation only — it introduces no new
 * workflow. Page-specific steps (learned-pattern capture, FINALIZED action
 * logging, AI-inspector audit details) stay in the pages and ride through
 * the optional fields.
 */

/** The minimal study/worklist-entry shape finalize needs — both the
 *  workspace's WorklistEntry and the cockpit/command-center study rows
 *  satisfy it structurally. */
export interface FinalizeStudyContext {
  patientId?: number | null;
  studyId?: number | null;
  modality?: string | null;
  studyDescription?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
}

export interface FinalizeReportContent {
  title: string;
  /** Rendered HTML body — tags are stripped for the patient_reports row,
   *  exactly as every pre-consolidation copy did. */
  htmlBody: string;
  impression: string[];
  isCritical: boolean;
  criticalNote: string | null;
  /** Authorship label recorded on the patient_reports row (server-side D5+
   *  structured signing ignores this and uses the staff session). */
  createdBy: string;
  /** Actor recorded on the worklist report-status transition. */
  actor: string;
  /** Optional page-specific audit payload (e.g. the Cockpit's AI-inspector
   *  summary) forwarded on the report-status call. */
  auditDetails?: unknown;
}

export interface FinalizeResult {
  reportId: number | null;
}

/**
 * Canonical finalize: create the patient-facing report row (when the study
 * is linked to a patient), then flip the worklist entry to
 * REPORT_FINAL / READY_TO_SEND referencing that row.
 */
export async function finalizeRadiologyReport(
  study: FinalizeStudyContext,
  content: FinalizeReportContent,
): Promise<FinalizeResult> {
  let reportId: number | null = null;
  if (study.patientId) {
    const report = await api.post<{ id: number }>("/api/patient-reports", {
      patientId: study.patientId,
      testId: null,
      studyId: study.studyId ?? null,
      type: "radiology",
      title: content.title,
      body: content.htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      impression: content.impression.join("\n"),
      parameters: JSON.stringify({
        modality: study.modality,
        studyDescription: study.studyDescription,
        accessionNumber: study.accessionNumber,
        studyInstanceUID: study.studyInstanceUID,
      }),
      isCritical: content.isCritical,
      criticalNote: content.isCritical ? content.criticalNote : null,
      createdBy: content.createdBy,
    });
    reportId = report.id;
  }

  await api.post("/api/internal/radiology/report-status", {
    accessionNumber: study.accessionNumber,
    studyInstanceUID: study.studyInstanceUID,
    status: "REPORT_FINAL",
    deliveryStatus: "READY_TO_SEND",
    reportId: reportId ?? undefined,
    actor: content.actor,
    ...(content.auditDetails !== undefined ? { auditDetails: content.auditDetails } : {}),
  });

  return { reportId };
}

/**
 * Canonical draft save. All three reporting surfaces post to the same
 * endpoint; payload fields beyond the shared core (e.g. the workspace's
 * structured findings[], the command center's findingsSections) pass
 * through untouched.
 */
export function saveRadiologyDraft<T = { id?: number }>(payload: Record<string, unknown>): Promise<T> {
  return api.post<T>("/api/radiology/report-generator/save-draft", payload);
}
