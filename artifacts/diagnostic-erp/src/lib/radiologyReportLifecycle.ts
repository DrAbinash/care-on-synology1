import { api } from "./fetchApi";

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
  /** Rendered HTML body — stored VERBATIM on the patient_reports row and
   *  rendered as TRUSTED, unescaped HTML by reportPresentation.ts. This
   *  module does no sanitization: every caller is solely responsible for
   *  HTML-escaping its own interpolated values (e.g. patient name, clinical
   *  history) before building this string, exactly as buildPreviewHtml()'s
   *  escHtml() does in RadiologyReportingWorkspace.tsx. */
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
  /** When 2+ active signatures exist, the workspace finalize dialog
   *  collects an explicit signer id. When set, auto-sign uses it instead of
   *  declining as ambiguous. */
  signatureId?: number | null;
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
  /** R1.4 — whether the legacy (non-D5) report row was actually signed via
   *  POST /:id/sign as part of THIS finalize call. When D5 already signed
   *  the row (structuredFinal.signed === true) this is false — the row is
   *  already a signed structured document and calling the legacy /sign route
   *  on it would be rejected (structured_signed_report, D9 Phase 2). Callers
   *  must never say "Report Finalized" implying a completed, signed,
   *  deliverable document unless this is true OR structuredFinal.signed is
   *  true. */
  signed: boolean;
  /** Truthful reason signing did not happen, for surfacing to the user
   *  instead of silently claiming success (e.g. "no active signature is
   *  configured", "role_cannot_sign", or the server's error message). null
   *  when signed is true, or when no report row exists to sign. */
  signError: string | null;
}

/** GET /api/patient-reports/from-study/:studyId prefill shape (subset). */
interface FromStudyPrefill {
  patientId: number | null;
  testId: number | null;
  orderTestId: number | null;
  orderId: number | null;
  billId: number | null;
}

interface SignatureRow {
  id: number;
  name: string;
  isActive: boolean;
}

/**
 * R1.4 — auto-sign a freshly created legacy report row as part of the SAME
 * deliberate action the radiologist already confirmed ("Finalize this
 * report? ... After finalizing, editing is disabled."). Before this fix,
 * finalize created the row and flipped the worklist status but NEVER called
 * POST /:id/sign, so every default-configuration (ff_radiology_structured_final
 * off) report stayed at its schema-default status="draft" forever — the
 * patient PDF link 403'd, Share 404'd, and Verify was hidden — while the UI
 * told the radiologist "Report Finalized". This mirrors ReportHub's own
 * SignDialog default (the sole ACTIVE signature on file — the
 * single-radiologist clinic this ticket targets) so the auto-sign identity
 * matches what a manual Sign click would have chosen. When the signer
 * identity is AMBIGUOUS (2+ active signatures and none is the clinic
 * radiologist), auto-sign deliberately declines rather than guessing —
 * see autoSignReport() below. Never throws:
 * a failure here must not undo the report row that was already created or
 * block the worklist flip; the caller surfaces `signed`/`signError`
 * truthfully instead.
 */
async function autoSignReport(
  reportId: number,
  preferredSignatureId?: number | null,
): Promise<{ signed: boolean; signError: string | null }> {
  try {
    const signatures = await api.get<SignatureRow[]>("/api/signatures");
    const activeSignatures = signatures.filter((s) => s.isActive);
    if (activeSignatures.length === 0) {
      return { signed: false, signError: "No active signature is configured — sign this report from Report Hub." };
    }
    // Explicit picker from workspace finalize dialog (multi-signer clinics).
    if (preferredSignatureId != null) {
      const chosen = activeSignatures.find((s) => s.id === preferredSignatureId);
      if (!chosen) {
        return { signed: false, signError: "Selected signature is not active — choose another signer." };
      }
      await api.post(`/api/patient-reports/${reportId}/sign`, { signatureId: chosen.id });
      return { signed: true, signError: null };
    }
    // Solo clinic: Dr. Sugandha is the reporting radiologist. A leftover
    // second signature (e.g. referring / neurosurgeon) must not block sign-off.
    const clinicRadiologist = activeSignatures.find((s) => /sugandha/i.test(s.name));
    if (clinicRadiologist) {
      await api.post(`/api/patient-reports/${reportId}/sign`, { signatureId: clinicRadiologist.id });
      return { signed: true, signError: null };
    }
    // R1.4 review finding: with 2+ active signatures on file and no clinic
    // radiologist match, silently picking the alphabetically-first one would
    // misattribute authorship. Require the visible signer picker instead.
    if (activeSignatures.length > 1) {
      return { signed: false, signError: "More than one active signature is on file — choose the signer from Report Hub." };
    }
    await api.post(`/api/patient-reports/${reportId}/sign`, { signatureId: activeSignatures[0].id });
    return { signed: true, signError: null };
  } catch (err) {
    return { signed: false, signError: err instanceof Error ? err.message : "Could not sign the report" };
  }
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
    let resolvedStudyId = study.studyId ?? null;

    // When the patient is billed but PACS intake never linked study_id, try
    // to auto-link before creating the patient_reports row.
    if (!resolvedStudyId && study.worklistId) {
      try {
        const link = await api.post<{ success: boolean; studyId?: number }>(
          `/api/radiology/pacs-worklist/${study.worklistId}/auto-link-billed-study`,
          {},
        );
        if (link.success && link.studyId) {
          resolvedStudyId = link.studyId;
        }
      } catch {
        /* best-effort — finalize still proceeds */
      }
    }

    if (resolvedStudyId) {
      try {
        prefill = await api.get<FromStudyPrefill>(`/api/patient-reports/from-study/${resolvedStudyId}`);
      } catch {
        prefill = null;
      }
    }
    if (!prefill?.testId) {
      reportCreationSkipped = resolvedStudyId
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
        // R1.4 — store the real, structured HTML (section headings, line
        // breaks, lists) exactly as the D5/structured path already does for
        // its `body` column (both feed `bodyHtml`, rendered as TRUSTED HTML
        // by reportPresentation.ts — never escaped). Previously this
        // stripped every tag AND collapsed every newline into a single
        // space, so the delivered/signed/printed document was one run-on
        // paragraph with no section structure — different from, and far
        // worse than, the well-formatted draft preview the radiologist had
        // just reviewed and approved. User-entered text within htmlBody is
        // already HTML-escaped by escHtml() in buildPreviewHtml().
        body: content.htmlBody,
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
  } else {
    // R1.4 review finding: leaving this unset made the 3 callers' generic
    // `!signed` fallback claim "Signing failed" for a study that was never
    // eligible for signing in the first place (no patient linked at all —
    // e.g. an unmatched DICOM study) — sending the radiologist to "sign it
    // from Report Hub" for a report row that was never created.
    reportCreationSkipped = "no patient is linked to this study";
  }

  // R1.4 — sign the legacy row now, as part of this same already-confirmed
  // finalize action. Skip when D5 already produced a SIGNED structured
  // document (structuredFinal.signed === true) — that row is not eligible
  // for the legacy /sign route (D9 Phase 2 refuses to overwrite a structured
  // signature) and is already a completed, signed document.
  let signed = false;
  let signError: string | null = null;
  const alreadySignedByD5 = Boolean(
    reportRow && typeof reportRow.structuredFinal === "object" && reportRow.structuredFinal !== null &&
    (reportRow.structuredFinal as Record<string, unknown>).signed === true,
  );
  if (reportId && !alreadySignedByD5) {
    const outcome = await autoSignReport(reportId, content.signatureId);
    signed = outcome.signed;
    signError = outcome.signError;
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
    signed: signed || alreadySignedByD5,
    signError,
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
