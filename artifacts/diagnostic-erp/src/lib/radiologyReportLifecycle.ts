import { api, HttpError, NetworkError } from "./fetchApi";

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
  /** Second worklist row included in this combined report. */
  linkedStudyId?: number | string | null;
  linkedAccessionNumber?: string | null;
  linkedStudyInstanceUID?: string | null;
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
  /** True when a linked second study was also marked REPORT_FINAL. */
  linkedMarkedFinal?: boolean;
  /** Set when the linked worklist flip failed. Primary finalize still stands. */
  linkedMarkError?: string | null;
  /**
   * True when POST /api/patient-reports returned the study's EXISTING report
   * row instead of writing the content this call was given. The route keys on
   * `bound.worklist.reportId` alone (patient-reports.ts:2008-2018) and does no
   * content comparison, so a re-finalize after edits answers HTTP 200 with the
   * old row and `idempotent: true` — the new title/body/impression were
   * discarded. Callers must not report success, and must not clear the local
   * draft backups, which are the only remaining copy of what was thrown away.
   */
  idempotent?: boolean;
  /**
   * D-5 — the create POST did not answer, but the study turned out to be bound
   * to a report row that already holds exactly the content this call sent, so
   * the finalize continued from that row instead of failing. POST
   * /api/patient-reports inserts the row and writes
   * `radiology_worklist.report_id` in ONE transaction, so a response lost in
   * transit leaves exactly this state, and the remaining legs (sign, status)
   * were never sent. Measured on the synthetic fixture: the browser saw four
   * 502s while the server had committed report 13, after which every autosave
   * was refused with "This study already has a final report… withdraw it in
   * Report Hub" — a signature that did not exist and a withdrawal
   * canWithdrawSignature() declines. The radiologist could not save and could
   * not submit; only an administrator could get out.
   */
  resumedAfterLostResponse?: boolean;
  /**
   * D-5 — the bound row already carried a signature, so no sign call was made.
   * The legacy /sign route refuses an already-signed row with `already_signed`
   * precisely because re-signing "would overwrite signedByName and signedAt and
   * destroy the original signing instant"; on the resume path that refusal is
   * the state we wanted, not a failure, and reporting it as one would tell the
   * signer a signed report was not signed.
   */
  alreadySignedOnServer?: boolean;
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
 * D-5 — ask the study what it is actually bound to, after a create that never answered.
 *
 * Read-only, and deliberately narrow: the worklist row is the claim and the patient is the proof.
 * A `reportId` on a worklist whose patient is not this study's patient is a different study's
 * report, and resuming onto it would sign one patient's document under another's name — so the
 * lookup refuses rather than guesses, exactly like the server's own identity bind
 * (`bindRadiologyReportIdentity`, which throws PATIENT_MISMATCH on the same disagreement).
 */
async function lookupBoundReport(
  study: FinalizeStudyContext,
): Promise<{ reportId: number; report: Record<string, unknown>; worklistStatus: string } | null> {
  const worklistId = study.worklistId ?? study.studyId;
  if (!worklistId) return null;
  try {
    const wl = await api.get<{ reportId?: number | null; patientId?: number | null; status?: string | null }>(
      `/api/radiology/pacs-worklist/${worklistId}`,
    );
    const reportId = Number(wl?.reportId ?? 0);
    if (!Number.isInteger(reportId) || reportId <= 0) return null;
    if (study.patientId && wl?.patientId && Number(wl.patientId) !== Number(study.patientId)) return null;
    const report = await api.get<Record<string, unknown>>(`/api/patient-reports/${reportId}`);
    if (Number(report?.id) !== reportId) return null;
    if (Number(report?.patientId ?? 0) !== Number(study.patientId)) return null;
    return { reportId, report, worklistStatus: String(wl?.status ?? "") };
  } catch {
    // Nothing could be proved, so nothing is assumed: the caller re-throws the
    // original create failure rather than reporting a finalize that never happened.
    return null;
  }
}

/**
 * Mirror of the server's `SIGNED_REPORT_STATUSES`
 * (api-server/src/lib/signedArtifactGuard.ts:23). A local copy because the ERP
 * cannot import api-server source; exported so
 * `finalizePartialFailure.recovery.test.ts` can fail if the two lists drift.
 */
export const SIGNED_REPORT_STATUSES = ["pending_verification", "verified", "delivered"] as const;

/**
 * Whether a failed create leaves the outcome UNKNOWN, as opposed to REFUSED.
 *
 * `NetworkError` is thrown only when no response was ever received (see
 * fetchApi.ts:212-218) and `HttpError` only for a status the server actually
 * answered with. So this takes the two cases in which the transaction may well
 * have committed — the connection died, or a gateway/proxy answered 5xx on a
 * request the API itself completed — and refuses the rest. A 4xx is the server
 * explaining that it did NOT write anything (409 MATCH_GATE_BLOCKED, the
 * finalize content guard, a dead session); on those paths any bound row belongs
 * to an earlier finalize, and resuming onto it would report that older
 * document as this call's success.
 */
function isUnansweredWrite(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  return err instanceof HttpError && err.status >= 500;
}

/**
 * Prove the bound row is the row this create wrote, before calling the resume a
 * success. The route stores `title` trimmed and `body`/`impression` verbatim
 * from this payload (patient-reports.ts insertValues), so agreement on all
 * three means the response that was lost had already carried this clinical
 * content to the database. Anything else — including a signed row whose `body`
 * GET /:id substitutes from its structured render — is not provable, and the
 * caller re-throws the original error instead.
 */
function committedRowMatches(
  row: Record<string, unknown>,
  sent: { title: string; body: string; impression: string },
): boolean {
  return String(row.title ?? "").trim() === sent.title.trim()
    && String(row.body ?? "") === sent.body
    && String(row.impression ?? "") === sent.impression;
}

/**
 * Whether a report row already carries a signature the server will not overwrite.
 *
 * A client-side mirror of the server's ONE authority, `isSignedArtifact()` in
 * api-server/src/lib/signedArtifactGuard.ts:50, including all three of its
 * witnesses and its exact status list — `pending_verification` means "signed,
 * awaiting counter-signature", and the schema-default `draft` status is what a
 * D5-signed row keeps, so status alone sees neither. If the two predicates
 * drift, the client either re-signs a signed report (which the route refuses
 * with 409 `already_signed`, and `autoSignReport` swallows) or tells the
 * radiologist a signed report is unsigned.
 */
function rowAlreadySigned(report: Record<string, unknown> | null): boolean {
  if (!report) return false;
  if (report.signedAt != null) return true;
  const status = String(report.status ?? "");
  if (SIGNED_REPORT_STATUSES.includes(status as (typeof SIGNED_REPORT_STATUSES)[number])) return true;
  const doc = report.structuredJson as { audit?: { signature?: { state?: string } } } | null;
  return doc?.audit?.signature?.state === "final";
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
  let reportIdempotent = false;
  let resumed = false;
  let boundWorklistAlreadyFinal = false;
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
      let report: { id: number; idempotent?: boolean } & Record<string, unknown>;
      const createPayload = {
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
      };
      try {
        report = await api.post<{ id: number } & Record<string, unknown>>("/api/patient-reports", createPayload);
      } catch (createError) {
        // D-5 — a create that never answered is not a create that failed. The
        // route inserts the row and binds radiology_worklist.report_id in the
        // same transaction (patient-reports.ts claimWorklistForFinalize →
        // insert → update), so the write is durable the moment the response is
        // lost, and every later leg — sign, worklist status — was skipped.
        // Measured on the synthetic fixture: fetchApi exhausted its retries
        // against 502s while the server had committed report 13, and the study
        // then refused every autosave with "This study already has a final
        // report… withdraw it in Report Hub" — a signature that did not exist,
        // and a withdrawal the server declines. The radiologist could neither
        // save nor submit.
        if (!isUnansweredWrite(createError)) throw createError;
        const bound = await lookupBoundReport(study);
        if (!bound || !committedRowMatches(bound.report, createPayload)) throw createError;
        resumed = true;
        boundWorklistAlreadyFinal = bound.worklistStatus === "REPORT_FINAL" || bound.worklistStatus === "DELIVERED";
        // Deliberately NOT marked `idempotent`: the bound row holds exactly the
        // content this call sent (proven above), so this finalize DID write the
        // report — unlike the server's own 200 `{ idempotent: true }`, which
        // hands back an older row and writes nothing.
        report = { ...bound.report, id: bound.reportId };
      }
      reportId = report.id;
      reportRow = report;
      // `idempotent: true` means the server handed back the row that was
      // already bound to this worklist and never wrote the body above.
      reportIdempotent = report.idempotent === true;
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
  let alreadySignedOnServer = false;
  const alreadySignedByD5 = Boolean(
    reportRow && typeof reportRow.structuredFinal === "object" && reportRow.structuredFinal !== null &&
    (reportRow.structuredFinal as Record<string, unknown>).signed === true,
  );
  // D-5 — a row that already carries a signature is never signed again. The
  // legacy route refuses it with `already_signed` precisely because re-signing
  // "would overwrite signedByName and signedAt and destroy the original signing
  // instant", and autoSignReport swallows every error it meets: on the resume
  // path that refusal is the outcome that was asked for, so surfacing it as a
  // signing failure would tell a radiologist that a signed report was not
  // signed — and send them off to sign it a second time.
  const boundRowSigned = rowAlreadySigned(reportRow);
  if (reportId && !alreadySignedByD5 && !boundRowSigned) {
    const outcome = await autoSignReport(reportId, content.signatureId);
    signed = outcome.signed;
    signError = outcome.signError;
  } else if (reportId && boundRowSigned) {
    alreadySignedOnServer = true;
    signed = true;
  }

  // Re-sending the flip for a study the server already reports as final would
  // write a second REPORT_STATUS_UPDATED audit row describing a transition that
  // did not happen, so on the resume path it is only sent when the study is
  // genuinely still open.
  //
  // A flip must also never be sent when no report row was created for a study
  // that has a patient behind it: REPORT_FINAL is what the workspace's own
  // signing gate reads (`workflow.currentRow?.status === "REPORT_FINAL"`,
  // ReportCanvas.tsx:2119), so closing the study without a report leaves a
  // radiologist a study that shows as final, prints nothing, and can never be
  // signed. The documented unbilled path (no patient linked, so no report row
  // is possible by design) keeps flipping exactly as before.
  if (!(resumed && boundWorklistAlreadyFinal) && (reportId || !study.patientId)) {
    await api.post("/api/internal/radiology/report-status", {
      worklistId: study.worklistId ?? undefined,
      accessionNumber: study.accessionNumber,
      studyInstanceUID: study.studyInstanceUID,
      status: "REPORT_FINAL",
      deliveryStatus: "READY_TO_SEND",
      reportId: reportId ?? undefined,
      actor: content.actor,
      ...(content.auditDetails !== undefined ? { auditDetails: content.auditDetails } : {}),
    });
  }

  const primaryKey = String(study.worklistId ?? study.studyId ?? "");
  const linkedKey = study.linkedStudyId == null ? "" : String(study.linkedStudyId).trim();
  let linkedMarkedFinal = false;
  let linkedMarkError: string | null = null;
  if (linkedKey && linkedKey !== primaryKey) {
    const linkedWorklistId = Number(linkedKey);
    try {
      await api.post("/api/internal/radiology/report-status", {
        worklistId: Number.isInteger(linkedWorklistId) ? linkedWorklistId : undefined,
        accessionNumber: study.linkedAccessionNumber ?? undefined,
        studyInstanceUID: study.linkedStudyInstanceUID ?? undefined,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: content.actor,
      });
      linkedMarkedFinal = true;
    } catch (err) {
      linkedMarkError = err instanceof Error ? err.message : "Could not mark the linked study REPORT_FINAL";
    }
  }

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
    linkedMarkedFinal,
    linkedMarkError,
    idempotent: reportIdempotent,
    resumedAfterLostResponse: resumed,
    alreadySignedOnServer,
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
