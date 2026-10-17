import { db, pool } from "@workspace/db";
import {
  radiologyStudiesTable,
  radiologyWorklistTable,
  patientsTable,
  patientReportsTable,
  radiologyAuditLogTable,
  radiologyPacsArchiveRevisionsTable,
} from "@workspace/db/schema";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { chromium } from "playwright";
import { buildReportArtifact, type ReportArtifact } from "../routes/patient-reports.js";
import { logger } from "./logger.js";
import { isObstetricUsgStudy } from "./usgModality";
import { checkPcpndtFormFCompliance } from "./pcpndtCompliance";
import { planUsgPacsReturn, type PacsReturnBlockReason } from "./usgPacsReturnPolicy";

import { getRadiologyConfig } from "./pacs/pacsConfig";

async function getOrthancConfig() {
  const cfg = await getRadiologyConfig();
  const url = cfg.orthanc.dicomWebUrl.replace(/\/dicom-web$/, "");
  const user = process.env.ORTHANC_USERNAME || "";
  const pass = process.env.ORTHANC_PASSWORD || "";
  return { url, user, pass };
}

function orthancHeaders(user: string, pass: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user && pass) {
    headers["Authorization"] = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  return headers;
}

/** DECISION 2, in the owner's own words — the sentence staff and the audit trail must see. */
export const NO_ELIGIBLE_REPORT_MESSAGE = "No finalized signed report available for this examination.";
/** DECISION 5 — the study lock is held by another run, so this one must not touch the records. */
export const ARCHIVE_IN_PROGRESS_MESSAGE =
  "An archive for this study is already running. Try again once it finishes.";

/**
 * One sentence per blocker the reused eligibility policy can report, keyed by ITS reason codes — the
 * decision of whether to archive stays entirely with `planUsgPacsReturn`; this is presentation only.
 *
 * The three report-derived codes keep the owner's sentence, which is what he wrote it for. The others
 * must not: a study whose report is signed and finalized but cannot be LINKED to a PACS study, or an
 * obstetric study on a statutory hold, is not a study without a signed report. Saying so sent staff to
 * look for a signature that was already there while the real blocker stayed invisible — the post-merge
 * compatibility audit of 2026-10-17, point 3.
 */
const ARCHIVE_REFUSAL_SENTENCE: Record<PacsReturnBlockReason, string> = {
  no_report: NO_ELIGIBLE_REPORT_MESSAGE,
  not_finalized: NO_ELIGIBLE_REPORT_MESSAGE,
  superseded_report: NO_ELIGIBLE_REPORT_MESSAGE,
  no_study_uid:
    "This study has no Study Instance UID, so the report cannot be linked to it in PACS. Nothing was uploaded — register or re-link the study, then archive.",
  no_patient:
    "This study has no patient record to attribute the report to, so nothing was uploaded.",
  pcpndt_missing:
    "PCPNDT Form-F has not been evaluated for this obstetric study, so nothing was uploaded. Complete the Form-F verification first.",
  pcpndt_not_compliant:
    "PCPNDT Form-F is not compliant for this patient, so nothing was uploaded. Correct the statutory record first.",
};

/**
 * The outcome of one archive run. Every field exists because a caller must be able to tell
 * "archived", "already archived — nothing uploaded", "refused before any upload" and "Orthanc took it
 * but we could not record it" apart. They are four different clinical states, and a plain boolean
 * conflated them (RIS-010).
 */
export interface ArchiveOutcome {
  success: boolean;
  instanceId?: string;
  /** Prefixed with the reason CODE so the durable job's failure rules can classify it. */
  error?: string;
  reason?: string;
  /** Plain-language sentence for staff (same text lands in radiology_audit_log). */
  message?: string;
  /** DECISION 3 — this revision was already archived; the existing object is returned, no copy made. */
  idempotent?: boolean;
  /** DECISIONS 1/2/5 — nothing was uploaded and nothing was filed. */
  refused?: boolean;
  /** DECISION 5 — another run holds this study's lock. */
  inProgress?: boolean;
  /** DECISION 6 — Orthanc accepted the object; the ERP could not record it. Never auto-retried. */
  accepted?: boolean;
  /** The reused policy's own vocabulary, so a refusal can be explained without re-deriving it. */
  blockReasons?: string[];
}

/**
 * DECISION 5 — one archive per study at a time, enforced in PostgreSQL.
 *
 * `pacsArchiveStatus: "pending"` never excluded anything: mutant M10 of the RIS-010 battery deleted the
 * write and every archive still passed. A session-scoped advisory lock does exclude, and the repo
 * already runs this exact shape for another cross-process writer
 * (`emergencyNasClient.ts:99-117`): take a pooled client, `pg_try_advisory_lock`, run, unlock, release.
 * A lock — not a queue and not a state machine — also covers the two shapes a status column cannot:
 * a manual Retry while the finalize trigger's un-awaited run is still in flight, and two workers that
 * both claimed work for the same study.
 */
async function withStudyArchiveLock<T>(studyId: number, fn: (locked: boolean) => Promise<T>): Promise<T> {
  const key = `care_pacs_archive_study_${studyId}`;
  const client = await pool.connect();
  try {
    const r = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [key],
    );
    const locked = !!r.rows[0]?.locked;
    try {
      return await fn(locked);
    } finally {
      if (locked) {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Which `patient_reports` row the PACS archive may render for a billed study — or none.
 *
 * `patient_reports.study_id` is a SHARED identifier space, which is why both spellings have to be
 * considered: the Reporting Workspace finalize path writes the `radiology_worklist` row id into it,
 * while legacy rows were written with the billed `radiology_studies` id. The two tables count
 * independently, so the same number means "worklist row 41" for one row and "billed study 41" for
 * another — and 41 is therefore reachable twice.
 *
 * Two separate obligations follow from that, and neither implies the other:
 *
 *  - PATIENT. A report found through the wrong spelling can belong to a different human being, so
 *    every candidate is required to carry this study's `patient_id`. Both columns are NOT NULL.
 *  - EXAMINATION. The right patient is not the right test: an MRI Brain and an MRI LS Spine share
 *    `patient_id` and differ in everything a radiologist cares about, and a patient's 2024 MRI Brain
 *    and 2026 MRI Brain share `patient_id` AND `test_id`. The worklist spelling is examination-correct
 *    by construction (that row is bound to this billed study). The legacy spelling is only accepted
 *    when the report's own billing identity still names this study.
 *
 * The identity terms are the ones `bindRadiologyReportIdentity()` (lib/radiologyIdentity.ts) already
 * enforces when a report is written — it refuses TEST_MISMATCH and ORDER_MISMATCH against the billed
 * study, and copies `bill_id`/`order_id`/`order_test_id` from that same study onto the row. So the
 * predicate below admits every report the finalize path could have produced for this examination, and
 * refuses a number that merely coincides. `order_test_id` is unique per study, which is what makes a
 * repeat examination of the SAME test separable.
 *
 * Those columns are nullable on a legacy row, so absence is allowed and only a CONTRADICTION refuses —
 * otherwise this would strand reports it has no way to disprove. The residual hole, stated plainly: a
 * legacy row with no billing identity at all, whose `study_id` coincides with a different study of the
 * same patient for the same test, is not distinguishable from its true owner and would be adopted.
 *
 * Exported because this is the step that decides which report becomes a DICOM object in the
 * archive, and `archiveReportToPacs` cannot be exercised without launching Chromium and POSTing to
 * Orthanc. Ambiguity returns null, which the caller handles as "no report row"; nothing is guessed.
 */
export async function resolveArchiveReportRow(study: {
  id: number;
  patientId: number;
  testId: number;
  billId?: number | null;
  orderId?: number | null;
  orderTestId?: number | null;
}): Promise<{ id: number; status: string | null; signedAt: Date | null } | null> {
  // Every worklist row bound to this billed study, not an arbitrary one: duplicate intake can bind
  // two rows to the same study, and a report may hang off either.
  const boundWorklists = await db
    .select({ id: radiologyWorklistTable.id })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.studyId, study.id));
  const worklistIds = boundWorklists.map((w) => w.id).filter((id) => id != null);

  const legacySpelling = and(
    eq(patientReportsTable.studyId, study.id),
    eq(patientReportsTable.testId, study.testId),
    study.billId != null
      ? or(isNull(patientReportsTable.billId), eq(patientReportsTable.billId, study.billId))
      : undefined,
    study.orderId != null
      ? or(isNull(patientReportsTable.orderId), eq(patientReportsTable.orderId, study.orderId))
      : undefined,
    study.orderTestId != null
      ? or(isNull(patientReportsTable.orderTestId), eq(patientReportsTable.orderTestId, study.orderTestId))
      : undefined,
  );

  const [report] = await db
    .select({
      id: patientReportsTable.id,
      // DECISION 1 needs the row's own finality facts. `resolveReportVersion` will still decide WHICH
      // revision is served; these say whether that revision may be served to PACS at all.
      status: patientReportsTable.status,
      signedAt: patientReportsTable.signedAt,
    })
    .from(patientReportsTable)
    .where(
      and(
        eq(patientReportsTable.patientId, study.patientId),
        or(
          worklistIds.length > 0 ? inArray(patientReportsTable.studyId, worklistIds) : undefined,
          legacySpelling,
        ),
      ),
    )
    // Deterministic, newest first. Without an ORDER BY the engine returns whichever row the heap
    // reaches, and `versionMode: "specific"` archives exactly the row picked here.
    .orderBy(desc(patientReportsTable.id))
    .limit(1);
  return report ?? null;
}

/**
 * DECISIONS 1 and 2 — may anything at all be filed for this study, and if not, why.
 *
 * The clinic's rule already lives in exactly one place: `usgPacsReturnPolicy.planUsgPacsReturn`, whose
 * header states it as "only a finalized/verified/signed report is eligible (never a draft)", never a
 * superseded version, never without StudyInstanceUID or patient, and fail-closed on PCPNDT for an
 * obstetric study. This function calls THAT policy — it does not restate it — so the archive and the
 * scheduled USG return path cannot drift into two different eligibility meanings.
 *
 * One input needs a mapping rather than a guess. `patient_reports.status` is not a signature: the sign
 * route writes `status = "pending_verification"` at the same instant it records `signedAt`
 * (`routes/patient-reports.ts:2569-2574`), which is why the patient-facing surfaces treat
 * `pending_verification` as deliverable (`:3570`, `:3633`). Feeding the raw column to the policy would
 * refuse every freshly signed report and silently stop the clinic archiving, so the fact the policy is
 * asking about — is this report signed? — is answered with the schema's own authority, `signed_at`,
 * mapped onto the policy's existing `signed` vocabulary. A draft with no signature keeps its own
 * `draft` status and is refused, which is the defect this decision closes.
 *
 * The legacy free-text shape (`radiology_studies.final_report`, written by `peerReview.finalizeReport`
 * with `status = "reported_final"` and a radiologist id) has no `patient_reports` row, so the policy's
 * two report-derived blocks are answered from the study row instead: attributed, finalized, non-empty.
 * Its structural conditions (UID, patient, obstetric PCPNDT) still come from the policy, so the
 * placeholder case — no text at all — is refused. That mapping is the only exception, and it is a
 * substitution of the same two facts, not a second policy.
 */
async function evaluateArchiveEligibility(args: {
  study: typeof radiologyStudiesTable.$inferSelect;
  patientName: string;
  patientDisplayId: string;
  reportRow: { id: number; status: string | null; signedAt: Date | null } | null;
  delivered: { reportId: number; sequenceNumber: number; superseded: boolean; latestReportId: number } | null;
}): Promise<
  | { eligible: true; blockReasons: []; reasons: [] }
  | { eligible: false; blockReasons: PacsReturnBlockReason[]; reasons: string[] }
> {
  const { study, reportRow, delivered } = args;

  // A legacy free-text final is authoritative when the finalization writers' own attribution columns
  // are set — the text, the radiologist it is attributed to, and the instant it was reported. It is NOT
  // keyed on `radiology_studies.status === "reported_final"`: of the four writers of that text, three set
  // the status (peerReview.finalizeReport, internal-reporting-studio, the teleradiology submit) and one
  // does not — POST /api/boundary/studies/:accession/report stores an attributed, dated final and only
  // flips the status when the caller's payload happens to say "reported_final" (boundary.ts:372, and
  // `status` is unvalidated there). Keying on the status silently stopped federated finals archiving,
  // and a study already `delivered` to the patient could never be re-archived. Cancellation is the one
  // status that must refuse: a cancelled examination has no report to file, whatever its columns hold.
  const legacyFinalText =
    !reportRow &&
    study.status !== "cancelled" &&
    typeof study.finalReport === "string" &&
    study.finalReport.trim().length > 0 &&
    !!study.finalReportedBy &&
    !!study.finalReportedAt;

  const isObstetric = isObstetricUsgStudy(study.modality, study.studyDescription ?? "");
  const pcpndt = isObstetric ? await checkPcpndtFormFCompliance(study.patientId) : null;

  const decision = planUsgPacsReturn(
    {
      studyId: study.id,
      studyInstanceUid: study.studyInstanceUid ?? null,
      accessionNumber: study.accessionNumber ?? null,
      patientId: study.patientId,
      patientName: args.patientName,
      patientDisplayId: args.patientDisplayId,
      modality: study.modality,
      isObstetric,
      studyDate: study.studyDate ? String(study.studyDate) : null,
      referringDoctor: study.referringDoctor ?? null,
    },
    delivered && reportRow
      ? {
          reportId: delivered.reportId,
          status: reportRow.signedAt ? "signed" : reportRow.status,
          sequenceNumber: delivered.sequenceNumber,
          supersededByReportId: delivered.superseded ? delivered.latestReportId : null,
        }
      : { reportId: reportRow?.id ?? null, status: reportRow?.status ?? null },
    pcpndt ? { compliant: pcpndt.compliant, errors: pcpndt.errors } : null,
  );

  const blockReasons = legacyFinalText
    ? decision.blockReasons.filter((r) => r !== "no_report" && r !== "not_finalized")
    : decision.blockReasons;

  if (blockReasons.length === 0) return { eligible: true, blockReasons: [], reasons: [] as [] };

  // Sentence order follows the policy's own reason order, so the most fundamental blocker is the one
  // staff are shown: a study with no report stays on the owner's DECISION 2 sentence even if it also
  // lacks a UID. `reasons` carries every blocker's own sentence for the record and the audit trail.
  const reasons = [...new Set(blockReasons.map((r) => ARCHIVE_REFUSAL_SENTENCE[r]))];
  return { eligible: false, blockReasons, reasons };
}

/** Append the refusal to the archive's own audit history. Best-effort by design: an audit write must
 *  never turn a refusal into an exception. */
async function auditArchiveRefusal(
  accessionNumber: string | null,
  reason: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(radiologyAuditLogTable)
    .values({
      accessionNumber: accessionNumber ?? undefined,
      action: "PACS_ARCHIVE_REFUSED",
      actor: "system",
      details: JSON.stringify({ reason, ...details }),
    })
    .catch(() => undefined);
}

/** DECISION 6 outcome builder: Orthanc has the object, the ERP could not finish recording it. */
async function acceptedButUnrecorded(
  study: typeof radiologyStudiesTable.$inferSelect,
  studyId: number,
  instanceId: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): Promise<ArchiveOutcome> {
  const errorMsg = err instanceof Error ? err.message : String(err);
  const message =
    `Orthanc accepted the report as ${instanceId || "an unnamed instance"}, but the ERP could not ` +
    `record it (${errorMsg}). Do not retry blindly — verify the object in PACS first.`;
  logger.error({ studyId, instanceId, err }, "[pacs-archive] ACCEPTED BUT UNRECORDED");
  await db
    .insert(radiologyAuditLogTable)
    .values({
      accessionNumber: study.accessionNumber,
      action: "PACS_ARCHIVE_RECORDING_FAILED",
      actor: "system",
      details: JSON.stringify({ studyId, instanceId, error: errorMsg.slice(0, 500), ...extra }),
    })
    .catch(() => undefined);
  return {
    success: false,
    accepted: true,
    instanceId,
    reason: "ARCHIVE_ACCEPTED_BUT_UNRECORDED",
    message,
    error: `ARCHIVE_ACCEPTED_BUT_UNRECORDED: ${message}`,
  } satisfies ArchiveOutcome;
}

export interface ArchiveReportOptions {
  /** D8 — PACS archives the LATEST signed version by default; pass
   *  "specific" to explicitly archive the historical row as-is (it renders
   *  with the superseded watermark). */
  versionMode?: "latest" | "specific";
  /** DECISION 4 — the ONLY way an already-archived revision may be uploaded a second time.
   *  Reachable solely through the admin-gated `/api/radiology-ops/repair` action, which demands a
   *  reason and a confirmation token and audits the actor. Ordinary Retry never sets this. */
  restore?: { reason: string; actor: string };
}

export async function archiveReportToPacs(
  studyId: number,
  opts: ArchiveReportOptions = {},
): Promise<ArchiveOutcome> {
  return withStudyArchiveLock(studyId, async (locked) => {
    if (locked) return runArchiveReportToPacs(studyId, opts);

    // DECISION 5 — the loser of the lock writes nothing to the study row: the run that holds it owns
    // `pending`/`success`/`failed`, so the records stay consistent with the one upload that happened.
    const [study] = await db
      .select({ accessionNumber: radiologyStudiesTable.accessionNumber })
      .from(radiologyStudiesTable)
      .where(eq(radiologyStudiesTable.id, studyId))
      .limit(1);
    await auditArchiveRefusal(study?.accessionNumber ?? null, "ARCHIVE_IN_PROGRESS", {
      studyId,
      message: ARCHIVE_IN_PROGRESS_MESSAGE,
    });
    logger.warn({ studyId }, "[pacs-archive] Another archive holds this study's lock; nothing uploaded");
    return {
      success: false,
      refused: true,
      inProgress: true,
      reason: "ARCHIVE_IN_PROGRESS",
      message: ARCHIVE_IN_PROGRESS_MESSAGE,
      error: `ARCHIVE_IN_PROGRESS: ${ARCHIVE_IN_PROGRESS_MESSAGE}`,
    } satisfies ArchiveOutcome;
  });
}

async function runArchiveReportToPacs(
  studyId: number,
  opts: ArchiveReportOptions,
): Promise<ArchiveOutcome> {
  logger.info({ studyId }, "[pacs-archive] Starting report archival to Orthanc");

  // 1. Fetch study
  const [study] = await db
    .select()
    .from(radiologyStudiesTable)
    .where(eq(radiologyStudiesTable.id, studyId))
    .limit(1);

  if (!study) {
    logger.error({ studyId }, "[pacs-archive] Study not found");
    return { success: false, error: "Study not found" };
  }

  // Set status to pending
  await db
    .update(radiologyStudiesTable)
    .set({ pacsArchiveStatus: "pending", pacsArchiveResponse: null })
    .where(eq(radiologyStudiesTable.id, studyId));

  await db.insert(radiologyAuditLogTable).values({
    accessionNumber: study.accessionNumber,
    action: "PACS_ARCHIVE_PENDING",
    actor: "system",
    details: JSON.stringify({ message: "PACS archive triggered, rendering PDF" }),
  }).catch(() => undefined);

  // BEND-1 — which revision this run is archiving, visible to the catch
  // block so per-revision failures are attributable.
  let archivedRevision: { resolvedReportId: number; rootReportId: number; sequenceNumber: number } | null = null;
  // DECISION 6 — once Orthanc has answered, the catch block must not record this run as a plain
  // failure: an object exists in the archive, and `failed` is the status that invites a duplicate.
  let acceptedInstanceId: string | null = null;

  try {
    // 2. Fetch patient demographics
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.id, study.patientId))
      .limit(1);

    const patientName = patient ? `${patient.firstName} ${patient.lastName}`.trim() : "Patient";
    const patientIdStr = patient ? (patient.patientId || String(patient.id)) : String(study.patientId);
    
    let ageStr = "";
    if (patient?.dateOfBirth) {
      const dob = new Date(patient.dateOfBirth);
      if (!Number.isNaN(dob.getTime())) {
        const now = new Date();
        let years = now.getFullYear() - dob.getFullYear();
        const m = now.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) years--;
        ageStr = `${years}Y`;
      }
    }
    const sexStr = patient?.gender || "O";

    // 3. Resolve report HTML. D8: amendments share the parent's studyId, so
    // whichever row this pick lands on, buildReportArtifact resolves the chain
    // to the latest signed version (default) — the archived PDF can never
    // silently be a superseded report, and an explicitly historical archive
    // carries the superseded watermark baked into its HTML.
    let htmlContent = "";
    let artifact: ReportArtifact | null = null;
    const report = await resolveArchiveReportRow({
      id: studyId,
      patientId: study.patientId,
      testId: study.testId,
      billId: study.billId,
      orderId: study.orderId,
      orderTestId: study.orderTestId,
    });
    if (report) {
      artifact = await buildReportArtifact(report.id, { surface: "pacs", versionMode: opts.versionMode });
      htmlContent = artifact?.html || "";
    }

    // DECISIONS 1 and 2 — the clinic's own eligibility policy decides whether anything may be filed
    // for this study, and it is asked BEFORE a PDF is rasterised or a byte is posted. No report row, an
    // unsigned draft, a superseded revision, a missing StudyInstanceUID or a non-compliant obstetric
    // Form-F all refuse here, and the study ends in `refused` with the reason in the audit history.
    const eligibility = await evaluateArchiveEligibility({
      study,
      patientName,
      patientDisplayId: patientIdStr,
      reportRow: report,
      delivered: artifact
        ? {
            reportId: artifact.version.resolvedReportId,
            sequenceNumber: artifact.version.sequenceNumber,
            superseded: artifact.version.resolvedSuperseded,
            latestReportId: artifact.version.latestReportId,
          }
        : null,
    });
    if (!eligibility.eligible) {
      const refusal = {
        reason: "NO_ELIGIBLE_REPORT",
        blockReasons: eligibility.blockReasons,
        message: eligibility.reasons[0] ?? NO_ELIGIBLE_REPORT_MESSAGE,
        reasons: eligibility.reasons,
        at: new Date().toISOString(),
      };
      // `pacsInstanceId` is deliberately NOT cleared: an earlier accepted object still exists in PACS,
      // and a refusal must not destroy the pointer to it.
      await db
        .update(radiologyStudiesTable)
        .set({ pacsArchiveStatus: "refused", pacsArchiveResponse: JSON.stringify(refusal) })
        .where(eq(radiologyStudiesTable.id, studyId));
      await auditArchiveRefusal(study.accessionNumber, refusal.reason, { studyId, ...refusal });
      logger.warn({ studyId, blockReasons: eligibility.blockReasons }, "[pacs-archive] Refused — nothing uploaded");
      return {
        success: false,
        refused: true,
        reason: refusal.reason,
        message: refusal.message,
        blockReasons: eligibility.blockReasons,
        error: `PACS_ARCHIVE_REFUSED: ${refusal.message}`,
      } satisfies ArchiveOutcome;
    }

    if (!htmlContent) {
      // Legacy free-text-only study (`peerReview.finalizeReport` wrote final_report,
      // final_reported_by and status reported_final without ever promoting a patient_reports row).
      // Reaching this line at all means evaluateArchiveEligibility accepted it: attributed, finalized
      // and non-empty. The placeholder document this branch used to render when there was no text —
      // "No report body text entered." — no longer exists, and `prelim_report` is no longer accepted
      // either (DECISION 1: never an incomplete or working report).
      // R1.4: every field here is patient/study data, not markup, and MUST be escaped — it previously
      // was not.
      const esc = (v: unknown) => String(v ?? "")
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      const finalReportText = String(study.finalReport ?? "");
      htmlContent = `
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Radiology Report — ${esc(study.accessionNumber)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; padding: 20px; font-size: 13px; line-height: 1.6; }
            .header { border-bottom: 3px solid #4338ca; padding-bottom: 10px; margin-bottom: 15px; }
            .title { font-size: 20px; font-weight: 800; color: #1e1b4b; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 11px; margin-bottom: 20px; }
            .meta div span { color: #64748b; display: block; font-size: 9px; text-transform: uppercase; }
            .meta div strong { font-size: 12px; }
            .body { white-space: pre-wrap; margin-top: 20px; }
            .footer { margin-top: 40px; font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid #cbd5e1; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">Care Diagnostics — Radiology Report</div>
          </div>
          <div class="meta">
            <div><span>Patient Name</span><strong>${esc(patientName)}</strong></div>
            <div><span>Patient ID</span><strong>${esc(patientIdStr)}</strong></div>
            <div><span>Age / Sex</span><strong>${esc(ageStr)} / ${esc(sexStr)}</strong></div>
            <div><span>Accession Number</span><strong>${esc(study.accessionNumber)}</strong></div>
            <div><span>Study Date</span><strong>${esc(study.studyDate || "")}</strong></div>
            <div><span>Modality</span><strong>${esc(study.modality)}</strong></div>
            <div><span>Referring Doctor</span><strong>${esc(study.referringDoctor || "Self")}</strong></div>
          </div>
          <h2>Report Findings</h2>
          <div class="body">${esc(finalReportText)}</div>
          <div class="footer">Please correlate clinically. Generated by internal archive server.</div>
        </body>
        </html>
      `;
    }

    // DECISION 3 — ordinary Retry never uploads a second copy of a revision PACS already holds. The
    // check is keyed on the revision that is actually being served (the version resolver's own answer,
    // not the pick), which is what makes an amendment still archive: a new revision id has no success
    // record, so it proceeds. `opts.restore` is the only bypass, and it is reachable only from the
    // admin-gated repair action.
    //
    // Limitation, stated rather than hidden: the legacy free-text shape has no report row and therefore
    // no revision identity to key on (radiology_pacs_archive_revisions.report_id is a patient_reports
    // id). A re-archive of a legacy free-text study still uploads. It is refused, not faked, when the
    // text is missing, and re-finalizing that study does legitimately produce a new document.
    const deliveredReportId = artifact?.version.resolvedReportId ?? null;
    if (deliveredReportId != null && !opts.restore) {
      const [prior] = await db
        .select({
          status: radiologyPacsArchiveRevisionsTable.status,
          orthancInstanceId: radiologyPacsArchiveRevisionsTable.orthancInstanceId,
        })
        .from(radiologyPacsArchiveRevisionsTable)
        .where(eq(radiologyPacsArchiveRevisionsTable.reportId, deliveredReportId))
        .limit(1);
      if (prior?.status === "success" && prior.orthancInstanceId) {
        // The run opened by writing `pending`. A no-op must not leave the study sitting there: the
        // owner's rule is that database state, audit history, archive status and the job result all
        // describe the same object, and `pending` on a study whose report has been in PACS the whole
        // time invites exactly the duplicate Retry this guard exists to prevent. This write is also the
        // recovery from an accepted-but-unrecorded earlier run — the revision row holds the truth, so
        // the summary is rebuilt from it rather than re-uploaded.
        await db
          .update(radiologyStudiesTable)
          .set({
            pacsArchiveStatus: "success",
            pacsInstanceId: prior.orthancInstanceId,
            pacsArchiveResponse: JSON.stringify({
              idempotent: true,
              instanceId: prior.orthancInstanceId,
              reportId: deliveredReportId,
              message: "Already archived in PACS; no second copy uploaded.",
            }),
          })
          .where(eq(radiologyStudiesTable.id, studyId));
        await db
          .insert(radiologyAuditLogTable)
          .values({
            accessionNumber: study.accessionNumber,
            action: "PACS_ARCHIVE_IDEMPOTENT_NOOP",
            actor: "system",
            details: JSON.stringify({
              studyId,
              reportId: deliveredReportId,
              instanceId: prior.orthancInstanceId,
              message: "Already archived in PACS; no second copy uploaded.",
            }),
          })
          .catch(() => undefined);
        logger.info({ studyId, instanceId: prior.orthancInstanceId }, "[pacs-archive] Already archived — no duplicate uploaded");
        return {
          success: true,
          instanceId: prior.orthancInstanceId,
          idempotent: true,
          message: "This report version is already archived in PACS; no second copy was uploaded.",
        } satisfies ArchiveOutcome;
      }
    }

    // 4. Generate PDF using Playwright
    logger.info({ studyId }, "[pacs-archive] Rendering PDF with Playwright");
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle" });
      pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      });
    } finally {
      await browser.close();
    }

    // 5. Connect to Orthanc and post
    const { url, user, pass } = await getOrthancConfig();
    if (!url) {
      throw new Error("Orthanc PACS URL not configured in database or environment");
    }

    const studyInstanceUID = study.studyInstanceUid || "";
    const accessionNumber = study.accessionNumber || "";
    const studyDateRaw = study.studyDate ? String(study.studyDate).replace(/-/g, "") : "";
    const referringDoctor = study.referringDoctor || "";

    // D8 — the DICOM series states which revision was archived; a superseded
    // historical export is labeled as such (never presented as current).
    const v = artifact?.version;
    if (v) archivedRevision = { resolvedReportId: v.resolvedReportId, rootReportId: v.rootReportId, sequenceNumber: v.sequenceNumber };
    const versionLabel = v && v.totalVersions > 1
      ? ` v${v.sequenceNumber}/${v.totalVersions}${v.resolvedSuperseded ? " SUPERSEDED" : " (amended)"}`
      : "";
    const tags = {
      PatientName: patientName.replace(/\^/g, " "), // Clean caret character if any
      PatientID: patientIdStr,
      StudyInstanceUID: studyInstanceUID,
      AccessionNumber: accessionNumber,
      StudyDate: studyDateRaw,
      ReferringPhysicianName: referringDoctor,
      SOPClassUID: "1.2.840.10008.5.1.4.1.1.104.1", // Encapsulated PDF Storage
      Modality: "OT",
      SeriesDescription: `Radiology Report PDF${versionLabel}`.slice(0, 64),
    };

    logger.info({ studyId, url }, "[pacs-archive] Uploading encapsulated PDF DICOM to Orthanc");

    const response = await fetch(`${url}/tools/create-dicom`, {
      method: "POST",
      headers: orthancHeaders(user, pass),
      body: JSON.stringify({
        Tags: tags,
        Content: "data:application/pdf;base64," + pdfBuffer.toString("base64"),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orthanc server returned error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as { ID?: string; Path?: string };
    const instanceId = result.ID || "";
    acceptedInstanceId = instanceId;

    // DECISION 6 — write the per-REVISION record FIRST, and stop swallowing its errors.
    //
    // The order used to be study-summary → revision → audit, each of the last two ending in
    // `.catch(() => undefined)`. That ordering is what made a partial failure dangerous: an object PACS
    // had already accepted could leave the study row reading `failed` with no revision record at all,
    // and the duplicate guard reads the revision record. Now the revision row is the first thing made
    // durable, so any later failure still leaves the guard able to refuse a second copy. If the
    // revision row itself cannot be written, the study summary is deliberately NOT touched and the run
    // returns `accepted` — the last thing this path should do is publish a success the guard cannot
    // honour.
    if (v) {
      try {
        await db.insert(radiologyPacsArchiveRevisionsTable)
          .values({
            studyId,
            reportId: v.resolvedReportId,
            rootReportId: v.rootReportId,
            sequenceNumber: v.sequenceNumber,
            status: "success",
            orthancInstanceId: instanceId,
            detail: JSON.stringify({ path: result.Path ?? null, restore: opts.restore ?? null }),
            attemptedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: radiologyPacsArchiveRevisionsTable.reportId,
            set: { status: "success", orthancInstanceId: instanceId, attemptedAt: new Date(), updatedAt: new Date() },
          });
      } catch (err: unknown) {
        return acceptedButUnrecorded(study, studyId, instanceId, err, { reportId: v.resolvedReportId });
      }
      // BEND-1 — older archived revisions of this study are flagged superseded rather than silently
      // keeping a success status. Derived state: if only this write fails, the object is still correctly
      // recorded, so the failure is reported and not treated as a lost archive.
      try {
        await db.update(radiologyPacsArchiveRevisionsTable)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(and(
            eq(radiologyPacsArchiveRevisionsTable.studyId, studyId),
            ne(radiologyPacsArchiveRevisionsTable.reportId, v.resolvedReportId),
            eq(radiologyPacsArchiveRevisionsTable.status, "success"),
          ));
      } catch (err: unknown) {
        logger.error({ studyId, err }, "[pacs-archive] supersede sweep failed — archived object still recorded");
      }
    }

    // 6. Persist status success
    try {
      await db
        .update(radiologyStudiesTable)
        .set({
          pacsArchiveStatus: "success",
          pacsArchiveResponse: JSON.stringify(result),
          pacsInstanceId: instanceId,
        })
        .where(eq(radiologyStudiesTable.id, studyId));
    } catch (err: unknown) {
      return acceptedButUnrecorded(study, studyId, instanceId, err, { revisionRecorded: !!v });
    }

    if (opts.restore) {
      await db.insert(radiologyAuditLogTable).values({
        accessionNumber: study.accessionNumber,
        action: "PACS_ARCHIVE_RESTORE_FORCED",
        actor: opts.restore.actor,
        details: JSON.stringify({
          studyId,
          reportId: v?.resolvedReportId ?? null,
          instanceId,
          reason: opts.restore.reason,
          note: "Authorized re-upload of the current signed revision after confirmed Orthanc data loss.",
        }),
      }).catch(() => undefined);
    }

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_SUCCESS",
      actor: "system",
      details: JSON.stringify({
        instanceId,
        path: result.Path,
        // D8 — auditable requested-vs-delivered record for the PACS surface.
        ...(v ? {
          requestedReportId: v.requestedReportId,
          deliveredReportId: v.resolvedReportId,
          reportVersion: `${v.sequenceNumber}/${v.totalVersions}`,
          superseded: v.resolvedSuperseded,
          chainWarnings: v.warnings,
        } : {}),
      }),
    }).catch(() => undefined);

    logger.info({ studyId, instanceId }, "[pacs-archive] Report archived successfully");
    return { success: true, instanceId };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // DECISION 6 — Orthanc accepted the document and something after that threw. Recording `failed`
    // here would tell the queue and the staff that nothing was archived, and the next Retry would
    // upload a second copy of the same revision. Return the truth instead, and leave the records as
    // far as they got: the duplicate guard reads the revision row, which is written first.
    if (acceptedInstanceId) {
      return acceptedButUnrecorded(study, studyId, acceptedInstanceId, err, {
        revisionRecorded: !!archivedRevision,
      });
    }

    logger.error({ studyId, err }, "[pacs-archive] Report archival failed");

    // Persist status failure
    await db
      .update(radiologyStudiesTable)
      .set({
        pacsArchiveStatus: "failed",
        pacsArchiveResponse: JSON.stringify({ error: errorMsg }),
      })
      .where(eq(radiologyStudiesTable.id, studyId));

    // BEND-1 — per-revision failure record (only when the version resolved;
    // pre-resolution failures have no revision to attribute).
    if (archivedRevision) {
      await db.insert(radiologyPacsArchiveRevisionsTable)
        .values({
          studyId,
          reportId: archivedRevision.resolvedReportId,
          rootReportId: archivedRevision.rootReportId,
          sequenceNumber: archivedRevision.sequenceNumber,
          status: "failed",
          detail: JSON.stringify({ error: errorMsg.slice(0, 500) }),
          attemptedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: radiologyPacsArchiveRevisionsTable.reportId,
          set: { status: "failed", detail: JSON.stringify({ error: errorMsg.slice(0, 500) }), attemptedAt: new Date(), updatedAt: new Date() },
        })
        .catch(() => undefined);
    }

    await db.insert(radiologyAuditLogTable).values({
      accessionNumber: study.accessionNumber,
      action: "ORTHANC_UPLOAD_FAILURE",
      actor: "system",
      details: JSON.stringify({ error: errorMsg }),
    }).catch(() => undefined);

    return { success: false, error: errorMsg };
  }
}
