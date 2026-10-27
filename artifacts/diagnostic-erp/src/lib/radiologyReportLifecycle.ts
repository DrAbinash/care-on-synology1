import { api, HttpError, NetworkError } from "./fetchApi";
import { resolveSignerChoice, type RecordedSigner, type SignerRow } from "./reportSignerEligibility";
import { readStaffSession } from "./staffSession";

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
   *  (patient_reports.test_id is NOT NULL, so a report row requires it).
   *
   *  NOT the page's study key. The two sequences overlap by design, so a
   *  worklist ROW id passed here does not 404 — it answers with whichever
   *  billed study happens to share that number, and that study's patient,
   *  test, order and bill. Use `finalizeContextForWorkspaceStudy()` rather
   *  than setting this by hand from a route param. */
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

/**
 * The ONE place the Reporting Workspace's study key becomes a finalize
 * context.
 *
 * The workspace is addressed by `radiology_worklist.id` — the route param, the
 * draft key, the lock key, the queue key. `FinalizeStudyContext.studyId` is a
 * different table's id (`radiology_studies.id`, the billed study) and is looked
 * up by `GET /api/patient-reports/from-study/:id`, which is keyed purely on
 * that column. The two sequences overlap by design, so handing the row id to
 * both fields is not a 404 on a bad day — it is an answer from somebody else's
 * study, carrying that study's patient, test, order and bill, which the create
 * POST then writes into this report. That is how one study's signature ends up
 * billed against another patient's test.
 *
 * So the mapping is stated once, here, and is a plain function so a test can
 * drive it directly:
 *   - `worklistId`  ← the route param (row id). Draft lookup and the status
 *     flip both key on it.
 *   - `studyId`     ← the queue row's `studyId` FK, and only that. Null when
 *     the row is unbilled, which is a real state: the lifecycle then attempts
 *     `auto-link-billed-study` and, if nothing is found, reports the skip
 *     instead of guessing.
 */
export function finalizeContextForWorkspaceStudy(args: {
  /** The workspace route param: radiology_worklist.id. */
  worklistRowId: number;
  /** The open Reading Queue row for that same study. */
  row: {
    patientId?: number | null;
    /** radiology_studies.id — null while the row is unbilled. */
    studyId?: number | string | null;
    modality?: string | null;
    studyDescription?: string | null;
    accessionNumber?: string | null;
    studyInstanceUID?: string | null;
  } | null | undefined;
  /** Second worklist row of an authorized combined report. */
  linked?: {
    studyId?: number | string | null;
    accessionNumber?: string | null;
    studyInstanceUID?: string | null;
  } | null;
}): FinalizeStudyContext {
  const row = args.row ?? {};
  const billedStudyId = Number(row.studyId);
  return {
    // The row id is the study key everything else in the workspace uses, and it
    // is what the create POST carries as `studyId` (patient_reports.study_id is
    // documented as the worklist row id — see `draftStudyKey` below).
    worklistId: args.worklistRowId,
    studyId: Number.isInteger(billedStudyId) && billedStudyId > 0 ? billedStudyId : null,
    patientId: row.patientId ?? null,
    modality: row.modality ?? "",
    studyDescription: row.studyDescription ?? "",
    accessionNumber: row.accessionNumber ?? "",
    studyInstanceUID: row.studyInstanceUID ?? "",
    linkedStudyId: args.linked?.studyId ?? null,
    linkedAccessionNumber: args.linked?.accessionNumber ?? null,
    linkedStudyInstanceUID: args.linked?.studyInstanceUID ?? null,
  };
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
   *  attach). null = a report row was created, or the study has no patient to
   *  report against. Whether the worklist status flip still happened is NOT
   *  implied by this field — read `reportStatusSent`: a skipped row for a study
   *  that DOES have a patient sends no flip at all (see the guard above the
   *  report-status POST), and treating that as a completion is what told a
   *  radiologist a study was final when the database still said STUDY_RECEIVED. */
  reportCreationSkipped: string | null;
  /**
   * Whether POST /api/internal/radiology/report-status was actually sent and
   * answered for THIS finalize — i.e. whether the study is REPORT_FINAL in the
   * database, as opposed to merely looking that way on screen. The flip is
   * withheld when no report row was created for a study that has a patient
   * (`finalizeRadiologyReport`, the guard above the report-status POST), so a
   * skipped creation answers with this false. Callers must not mark the study
   * completed, clear the draft backups, lock the editors or advance the queue
   * on a finalize that sent nothing.
   */
  reportStatusSent: boolean;
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
   * Freeze-at-sign outcome: how many picker references became part of the
   * signed artifact's own picture store ({frozen}), how many degraded to an
   * explicit "IMAGE COULD NOT BE READ" placeholder row because their pixels
   * could not be fetched at signing ({placeholders}), and how many were
   * already covered by a frozen row ({skipped}). Null when the server did not
   * report it (older response, no draft, or total freeze failure — the signed
   * report itself is unaffected either way).
   */
  frozenImageRefs?: { frozen: number; placeholders: number; skipped: number } | null;
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

/**
 * Whether this finalize left the study COMPLETED — i.e. the worklist row is
 * REPORT_FINAL in the database and what is on screen is what the server holds.
 *
 * The workspace used to treat "did not throw" as completion, which is how a
 * study with no report and no status change ended up locked, cleared of its
 * local backups, removed from the reading queue and auto-advanced to the next
 * row: `finalizeRadiologyReport` returns normally for a skipped report creation
 * (an explicit reason in `reportCreationSkipped`, no exception), so the caller's
 * only `false` case was `idempotent`. A skipped creation for a study that HAS a
 * patient sends no status flip at all (see the guard above the report-status
 * POST), so the row stays STUDY_RECEIVED while the screen says final — measured
 * on the synthetic fixture as `GET /api/patient-reports/from-study/4 → 404`, no
 * create and no flip, with the editors locked and
 * `{status: "STUDY_RECEIVED", reportId: null}` in the queue response.
 *
 * Everything a caller does AFTER the finalize — markCompleted, clearing the
 * draft backups, `completeFinalize()`, crediting the reading session,
 * auto-advancing to the next study — must be gated on this predicate, because
 * every one of those is irreversible from the radiologist's side: the backup is
 * the only surviving copy of the discarded text, and the auto-advance moves the
 * route underneath the still-open gauntlet.
 */
export function isFinalizeCompletion(result: FinalizeResult): boolean {
  // The server handed back the study's existing row and wrote nothing this call.
  if (result.idempotent) return false;
  if (result.reportStatusSent) return true;
  // D-5 resume of a study the server already reports REPORT_FINAL: this call
  // deliberately skipped the flip because the transition had already happened,
  // and the bound row was proved to hold exactly this content. Nothing to undo,
  // nothing to keep open — the study IS finished.
  return Boolean(result.resumedAfterLostResponse && result.reportId);
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
  role?: string | null;
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
 * matches what a manual Sign click would have chosen. When more than one
 * signature could authorize the report and the radiologist has not chosen one,
 * auto-sign deliberately declines rather than guessing — see autoSignReport()
 * below and `reportSignerEligibility.ts`, which decides eligibility from the
 * records. Never throws:
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
    // Only this account's own blocks can be chosen automatically. A colleague's block
    // would be refused by the server anyway; declining here keeps the attempt from
    // being made at all, and keeps the outcome honest ("no signer of mine on file")
    // rather than a 403 the reporter cannot act on.
    const choice = resolveSignerChoice(signatures, preferredSignatureId, readStaffSession()?.user?.id ?? null);
    if (choice.kind === "preferred" || choice.kind === "single") {
      await api.post(`/api/patient-reports/${reportId}/sign`, { signatureId: choice.signatureId });
      return { signed: true, signError: null };
    }
    if (choice.kind === "refused") {
      return { signed: false, signError: "Selected signature is not active — choose another signer." };
    }
    if (choice.kind === "choose") {
      return { signed: false, signError: "More than one active signature is on file — choose the signer from Report Hub." };
    }
    return { signed: false, signError: "No active signature is configured — sign this report from Report Hub." };
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
 * What the workspace may claim about the report behind the open study.
 *
 * `signed` and `not-signed` come from the report ROW — the same three witnesses
 * the server itself uses (`isSignedArtifact`), read off the row the existing
 * `workspace-final-report` query already fetches. Nothing here infers a
 * signature from `reportId` / `finalReportId` being present: a finalize that
 * created the row and could not sign it leaves a bound, unsigned row behind —
 * measured in the browser as patient_reports 171, `status = 'draft'`,
 * `signed_at IS NULL`, while the overlay read "Report signed".
 *
 * `unknown` is deliberately not folded into `signed`. The row is fetched
 * asynchronously and re-fetched whenever the finalize outcome changes it, so
 * between those two events there is a real window in which the id is known and
 * the signature is not yet. Showing "signed" there would be the same
 * fabrication in a new place; the caller shows a neutral chip instead.
 */
export type SignedReportDisplayState = "signed" | "not-signed" | "no-signed-report" | "unknown";

export function signedReportDisplayState(args: {
  /** The report the study is bound to, as `linkedReportId` resolves it. */
  reportId: number | null | undefined;
  /** The authoritative row from GET /api/patient-reports/:id, or null until it lands. */
  report: Record<string, unknown> | null | undefined;
  /** Study finalization, which is a DIFFERENT question from signing. */
  studyFinal: boolean;
}): { state: SignedReportDisplayState; signedByName: string | null } {
  if (!args.reportId) {
    // A study marked final with nothing behind it: there is no report to sign,
    // so no signature to claim. This is the state the red banner already names.
    return { state: args.studyFinal ? "no-signed-report" : "unknown", signedByName: null };
  }
  const row = args.report ?? null;
  if (!row || row.id == null) return { state: "unknown", signedByName: null };
  if (!rowAlreadySigned(row)) return { state: "not-signed", signedByName: null };
  const name = typeof row.signedByName === "string" && row.signedByName.trim() ? row.signedByName.trim() : null;
  return { state: "signed", signedByName: name };
}

export type SignedReportTone = "success" | "warning" | "danger" | "neutral";

/**
 * The words the workspace is allowed to use about that state.
 *
 * Kept as a pure function rather than JSX so the claims are testable — the
 * overlay file is `@ts-nocheck` and a string typed there would be checked by
 * nothing but a browser. Same reasoning as `hopeDeliveryToast()`: the outcome
 * classification lives in the lib, the colour classes live in the view.
 */
export function signedReportBadge(
  state: SignedReportDisplayState,
  signedByName: string | null,
): { label: string; tone: SignedReportTone; lock: string; lockTitle: string } {
  switch (state) {
    case "signed":
      return {
        label: signedByName ? `Report signed — ${signedByName}` : "Report signed",
        tone: "success",
        lock: "Locked — corrections need an administrator",
        lockTitle: "The signed text is locked. Nothing typed here can change it.",
      };
    case "not-signed":
      // The row is bound and the study is final, so the editors ARE locked —
      // but what is locked is an UNSIGNED document, and the remedy is a
      // signature, not an administrator.
      return {
        label: "Report saved — NOT signed",
        tone: "warning",
        lock: "Locked — sign this report in Report Hub",
        lockTitle:
          "The study is final, so nothing typed here is saved. The report exists but carries no signature; the signer or an administrator signs it in Report Hub.",
      };
    case "no-signed-report":
      return {
        label: "Study marked final — NO report exists",
        tone: "danger",
        lock: "No report to sign — link and bill the study, then finalize again",
        lockTitle:
          "The study was closed without a patient report behind it, so there is nothing to print, send or withdraw.",
      };
    case "unknown":
      // Deliberately not "Report signed" and not "NOT signed": the row has not
      // been read back yet, and a chip that guesses is how this bug came to be.
      return {
        label: "Report saved — signature status not confirmed",
        tone: "neutral",
        lock: "Checking the report's signature",
        lockTitle:
          "The report row has not been read back from the server yet, so the workspace will not claim it is signed.",
      };
  }
}

/**
 * The signer a printed document may name, read off the report's own record.
 *
 * The finalized PDF and print routes took the name from this browser's
 * `radiology_print_settings`, so whichever machine happened to be printing
 * decided who had authorized the report: a study signed by a visiting
 * radiologist printed the resident's name, and a report nobody had signed
 * printed a name as though it had been. One default profile sat on every
 * station, so both were the ordinary case rather than the exception.
 *
 * `rowAlreadySigned` is the same witness the badge, the lock and the finalize
 * caption use, so a signed row that prints no name cannot happen. The identity
 * is the block the report was signed under (`signatureId`), looked up in the
 * signature rows the caller already holds; `signedByName` covers reports signed
 * with a staff account and no block.
 *
 * An absent fact stays absent. A block with no qualification prints none, and a
 * block with no image prints no image — printing the name and designation
 * without fabricating handwriting is the documented output, not a fallback.
 */
export function recordedSignerForReport(
  report: Record<string, unknown> | null | undefined,
  rows: readonly SignerRow[],
): RecordedSigner | null {
  if (!report || !rowAlreadySigned(report)) return null;
  const recordedName =
    typeof report.signedByName === "string" && report.signedByName.trim()
      ? report.signedByName.trim()
      : null;
  const signatureId = typeof report.signatureId === "number" ? report.signatureId : null;
  // A block retired AFTER this report was signed still describes it: `isActive`
  // gates who may sign from here on, not what an old report is allowed to say.
  const block = signatureId == null ? null : (rows.find((r) => r.id === signatureId) ?? null);
  const name = (block?.name.trim() || recordedName || "").trim();
  if (!name) return null;
  if (!block) return { name, qualification: null, registrationNo: null, imageDataUrl: null };
  return {
    name,
    qualification: block.qualification ?? null,
    registrationNo: block.registrationNo ?? null,
    imageDataUrl: block.imageDataUrl ?? null,
  };
}

/**
 * Read the authorization a printed document may claim, from the server, at the
 * moment of printing.
 *
 * Called by the export doors rather than from reactive UI state: a signature
 * taken in another station's session, or withdrawn since this page opened, has
 * to be reflected in the file being made now. `unsigned` is what the door draws
 * when the answer is not a name — including when the row could not be read at
 * all, because "we could not check" must not fall through to this station's own
 * configured signer.
 *
 * A `reportId` of null means there is no report of record behind the document at
 * all — an unsaved draft, or one of the other generators' pages. Nothing has
 * authorized it either, so it is unsigned. Reading it as "not unsigned" let the
 * export door fall through to this workstation's own configured signature block:
 * a measured draft PDF left the reporting workspace bearing
 * "Dr. <name on this bench>, Reg. No: <reg on this bench>" with no NOT-SIGNED
 * marking, which is an authorization claim for a document no radiologist has
 * signed. A draft that DOES have a report row already prints NOT SIGNED (the row
 * is read, no signing record is found); an unsaved draft is the same legal
 * status and must look the same.
 */
export async function loadSignerOfRecord(reportId: number | null | undefined): Promise<{
  signerOfRecord: RecordedSigner | null;
  unsigned: boolean;
  /**
   * True when the read itself failed — a THIRD state, distinct from a
   * verified-unsigned row. The old catch returned the verified-unsigned
   * answer, and the PDF door fell through to a full client re-render of a
   * signed study's editable screen (a DRAFT-watermarked document for a
   * report that HAS a signer) while the Word door merged live editor text
   * over the signed print HTML. The export doors refuse to draw anything on
   * a failed read: "could not check" is not "checked, and nobody signed".
   */
  readFailed: boolean;
}> {
  if (!reportId) return { signerOfRecord: null, unsigned: true, readFailed: false };
  try {
    const [row, rows] = await Promise.all([
      api.get<Record<string, unknown>>(`/api/patient-reports/${reportId}`),
      api.get<SignerRow[]>("/api/signatures"),
    ]);
    const signerOfRecord = recordedSignerForReport(row, rows);
    return { signerOfRecord, unsigned: signerOfRecord === null, readFailed: false };
  } catch {
    return { signerOfRecord: null, unsigned: true, readFailed: true };
  }
}

/**
 * Which document Print must produce.
 *
 * Word and PDF have redirected to the server-frozen artifact for a signed report
 * since #1085/#1100 — Print was the door left behind. Measured 2026-10-27 in a real
 * browser on a report that had just signed (`POST /api/patient-reports/14/sign`
 * → 200): Ctrl+P still asked
 * `/api/radiology/report-generator/drafts/1/print-preview?autoPrint=true&likeFinal=true`
 * and the page that reached the printer said **PREVIEW — NOT SIGNED**, carried no
 * signer and no registration number, and still held the unfilled `___` blank — while
 * the same study's Word and PDF downloads came off `/api/patient-reports/14/…` with
 * the signature on them. One authorized report, three printed forms.
 *
 * `null` is the answer for anything that is not authorized — no linked row, or a row
 * with no signature on record — and the caller then keeps the draft route, which is
 * where the DRAFT watermark belongs. The URL takes no layout, impression-style or
 * format overrides on purpose: a signed report prints as it was frozen when it was
 * signed, which is the entire point of freezing it.
 */
export function signedReportPrintUrl(input: {
  reportId?: number | string | null;
  authorized: boolean;
}): string | null {
  if (input.reportId == null || input.reportId === "" || !input.authorized) return null;
  return `/api/patient-reports/${input.reportId}/print`;
}

/**
 * The finalize control's own caption, and the one place that decides it.
 *
 * `isFinalized` is client state: it says a gauntlet ran, not that a signature
 * exists. Keying the caption on it made a bound-but-unsigned study read
 * "Signed", and — the mirror image, on reopening a study that WAS signed —
 * left a finished signed report offering "Confirm & Sign" on a disabled button.
 *
 * The signature states only describe a CLOSED study. A withdrawn signature
 * reverts the worklist row to REPORT_IN_PROGRESS and clears its reportId, but
 * the draft can still point at the row, so an unsigned report exists while the
 * study is perfectly editable — and the caption must say "Confirm & Sign", not
 * "Not signed", or the radiologist is told to go sign somewhere else while the
 * button in front of them does exactly that.
 */
export function finalizeActionLabel(args: {
  allowEditSigned: boolean;
  isFinalized: boolean;
  studyFinal: boolean;
  signatureState: SignedReportDisplayState;
}): string {
  if (args.allowEditSigned) return "Re-finalize";
  if (!(args.isFinalized || args.studyFinal)) return "Confirm & Sign";
  switch (args.signatureState) {
    case "signed":
      return "Signed";
    case "not-signed":
      return "Not signed";
    case "no-signed-report":
      return "No report";
    default:
      // Closed, and the row has not been read back yet: say the study is closed
      // without borrowing the word "signed".
      return "Finalized";
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
  // signing gate reads (`workflow.currentRow?.status === "REPORT_FINAL"` in
  // ReportCanvas's `finalizeDisabled`), so closing the study without a report leaves a
  // radiologist a study that shows as final, prints nothing, and can never be
  // signed. The documented unbilled path (no patient linked, so no report row
  // is possible by design) keeps flipping exactly as before.
  let reportStatusSent = false;
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
    reportStatusSent = true;
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
    frozenImageRefs:
      reportRow && typeof reportRow.frozenImageRefs === "object" && reportRow.frozenImageRefs !== null
        ? (reportRow.frozenImageRefs as { frozen: number; placeholders: number; skipped: number })
        : null,
    reportCreationSkipped,
    reportStatusSent,
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
