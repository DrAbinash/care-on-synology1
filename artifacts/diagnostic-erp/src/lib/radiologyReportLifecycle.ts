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
  /** radiology_studies id — the billing/test linkage. Used to resolve the
   *  study's REAL testId via GET /api/patient-reports/from-study/:id
   *  (patient_reports.test_id is NOT NULL, so a report row requires it). */
  studyId?: number | null;
  /** M1.4 — the worklist row id, i.e. the canonical page's study key. Drafts
   *  are saved under this key, and D5's structured finalize looks the draft
   *  up by the create POST's studyId — so when present, THIS is what the
   *  create call sends as studyId. Callers that don't pass it (deprecated
   *  pages) keep their existing studyId behavior unchanged. */
  worklistId?: number | null;
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
  /** M1.4 — the created patient_reports row as returned by the server. When
   *  ff_radiology_structured_final is on, `structuredFinal` carries the D5
   *  diagnostics ({signed: true, documentId, ...} or {signed: false,
   *  fallback: "legacy", reason}) so callers can surface the TRUE finalize
   *  path instead of guessing. */
  report: Record<string, unknown> | null;
  structuredFinal: Record<string, unknown> | null;
  /** M1.4 — truthful reason when NO patient-facing report row was created
   *  (patient_reports.test_id is NOT NULL; an unbilled study has no test to
   *  attach). The worklist status flip below still happens. null = a report
   *  row was created, or the study has no patient to report against. */
  reportCreationSkipped: string | null;
}

/** GET /api/patient-reports/from-study/:studyId prefill shape (subset). */
interface FromStudyPrefill {
  patientId: number | null;
  testId: number | null;
  orderTestId: number | null;
  orderId: number | null;
  billId: number | null;
}

/**
 * Canonical finalize: create the patient-facing report row (when the study
 * is linked to a patient AND a billed test can be resolved), then flip the
 * worklist entry to REPORT_FINAL / READY_TO_SEND referencing that row.
 *
 * Pre-M1.4 this sent `testId: null`, which POST /api/patient-reports rejects
 * with 400 ("patientId and testId are required" — the column is NOT NULL), so
 * finalize from every consolidated page THREW before the worklist flip: no
 * report row, no status change, only an error toast. The test linkage is now
 * resolved truthfully through the existing from-study prefill; when no billed
 * test exists the report-row step is SKIPPED with an explicit reason instead
 * of failing the whole finalize.
 */
export async function finalizeRadiologyReport(
  study: FinalizeStudyContext,
  content: FinalizeReportContent,
): Promise<FinalizeResult> {
  let reportId: number | null = null;
  let reportRow: Record<string, unknown> | null = null;
  let reportCreationSkipped: string | null = null;
  // The study key drafts were saved under — D5's structured finalize resolves
  // "the draft for this study" by this exact value (see
  // structuredFinalizeTransaction's drafts lookup in patient-reports.ts).
  const draftStudyKey = study.worklistId ?? study.studyId ?? null;

  if (study.patientId) {
    let prefill: FromStudyPrefill | null = null;
    if (study.studyId) {
      try {
        prefill = await api.get<FromStudyPrefill>(`/api/patient-reports/from-study/${study.studyId}`);
      } catch {
        prefill = null;
      }
    }
    if (!prefill?.testId) {
      reportCreationSkipped = study.studyId
        ? "the study's billed test could not be resolved (from-study lookup)"
        : "no billed test is linked to this study";
    } else {
      const report = await api.post<{ id: number } & Record<string, unknown>>("/api/patient-reports", {
        patientId: study.patientId,
        testId: prefill.testId,
        orderTestId: prefill.orderTestId ?? null,
        orderId: prefill.orderId ?? null,
        billId: prefill.billId ?? null,
        studyId: draftStudyKey,
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
      reportRow = report;
    }
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

  return {
    reportId,
    report: reportRow,
    structuredFinal:
      reportRow && typeof reportRow.structuredFinal === "object" && reportRow.structuredFinal !== null
        ? (reportRow.structuredFinal as Record<string, unknown>)
        : null,
    reportCreationSkipped,
  };
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
