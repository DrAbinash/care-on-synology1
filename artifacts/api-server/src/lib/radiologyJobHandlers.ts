/**
 * radiologyJobHandlers.ts — Ticket BEND-1 Phase 3: the durable job handlers.
 *
 * Two external-effect handlers, both IDEMPOTENT and both re-checking their
 * subject's state before any external send — a worker restart or stale-claim
 * requeue can therefore never double-send:
 *
 *  - radiology_redelivery_send: sends one QUEUED re-delivery obligation over
 *    its original channel to the original recipient (resolved at send time
 *    from the source report_shares row — obligations never store raw
 *    addresses). Reuses the EXISTING WhatsApp/email providers; no new
 *    delivery mechanism.
 *  - radiology_pacs_rearchive: re-archives a study's latest signed revision
 *    through the EXISTING archiveReportToPacs pipeline (which now records
 *    per-revision state).
 *
 * Nothing enqueues these automatically unless the default-OFF auto-send
 * policy was explicitly enabled — the normal path is an operator queuing an
 * obligation from the ops surface.
 */

import { db } from "@workspace/db";
import {
  radiologyRedeliveryObligationsTable, radiologyPacsArchiveRevisionsTable,
  reportSharesTable, patientReportsTable, patientsTable, testsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { resolveReportVersion } from "./radiologyReportVersion";
import { recordObligationSendOutcome, completeObligationsForDelivery } from "./redeliveryObligations";
import type { RadiologyJobHandler, RadiologyJobRow } from "./radiologyJobs";
import { AI_SHADOW_PIPELINE_JOB, makeAiShadowPipelineHandler } from "./ai/shadowPipeline";
import { gatewayInferenceProvider } from "./ai/gatewayInferenceProvider";
import { MWL_WL_CLEANUP_JOB, mwlWlCleanupHandler } from "./pacs/mwlWlCleanup";
import { AI_REPORT_COMPOSE_JOB, processComposeJob } from "./reportComposer/jobService";

export { MWL_WL_CLEANUP_JOB };
export { AI_REPORT_COMPOSE_JOB };
export const REDELIVERY_SEND_JOB = "radiology_redelivery_send";
export const PACS_REARCHIVE_JOB = "radiology_pacs_rearchive";

/** Public base URL for report links in job-context sends (no HTTP request to
 *  derive it from). Uses the same public-URL notion the share route builds
 *  from request headers. */
function publicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

function isLastAttempt(job: RadiologyJobRow): boolean {
  return job.retryCount + 1 >= Math.max(1, job.maxRetries);
}

const redeliverySendHandler: RadiologyJobHandler = async (job) => {
  const payload = (job.payload ?? {}) as { obligationId?: number };
  const obligationId = Number(payload.obligationId);
  if (!Number.isInteger(obligationId) || obligationId <= 0) {
    return { ok: false, detail: "invalid payload: obligationId required" };
  }
  const [obligation] = await db
    .select()
    .from(radiologyRedeliveryObligationsTable)
    .where(eq(radiologyRedeliveryObligationsTable.id, obligationId));
  if (!obligation) return { ok: true, detail: "obligation no longer exists — no-op" };

  // DUPLICATE-SEND GUARD: only a QUEUED obligation is ever sent. A restart
  // that requeues this job after a successful send finds sent/completed and
  // no-ops; dismissed/completed likewise.
  if (obligation.status !== "queued") {
    return { ok: true, detail: `obligation is ${obligation.status} — nothing to send` };
  }

  // The obligation must still target the chain's LATEST revision — sending a
  // superseded revision is never allowed (a newer obligation covers it).
  const version = await resolveReportVersion(obligation.reportId, { mode: "specific" });
  if (!version) {
    await recordObligationSendOutcome(obligationId, { ok: false, reason: "report row no longer exists" });
    return { ok: true, detail: "report missing — obligation marked failed" };
  }
  if (version.latestReportId !== obligation.reportId) {
    await recordObligationSendOutcome(obligationId, {
      ok: false,
      reason: `revision superseded by report ${version.latestReportId} — queue the newer obligation instead`,
    });
    return { ok: true, detail: "obligation superseded — marked failed, no send" };
  }

  // Raw recipient lives ONLY in the source share row (existing policy).
  if (obligation.sourceShareId == null) {
    await recordObligationSendOutcome(obligationId, { ok: false, reason: "no source share to resolve the recipient from" });
    return { ok: true, detail: "no source share — obligation marked failed" };
  }
  const [sourceShare] = await db
    .select({ recipient: reportSharesTable.recipient })
    .from(reportSharesTable)
    .where(eq(reportSharesTable.id, obligation.sourceShareId));
  const recipient = sourceShare?.recipient ?? null;
  if (!recipient) {
    await recordObligationSendOutcome(obligationId, { ok: false, reason: "source share has no recipient" });
    return { ok: true, detail: "no recipient — obligation marked failed" };
  }

  const [row] = await db
    .select({
      r: patientReportsTable,
      patientFirstName: patientsTable.firstName,
      patientLastName: patientsTable.lastName,
      testName: testsTable.name,
    })
    .from(patientReportsTable)
    .leftJoin(patientsTable, eq(patientReportsTable.patientId, patientsTable.id))
    .leftJoin(testsTable, eq(patientReportsTable.testId, testsTable.id))
    .where(eq(patientReportsTable.id, obligation.reportId));
  if (!row) {
    await recordObligationSendOutcome(obligationId, { ok: false, reason: "report row unreadable" });
    return { ok: true, detail: "report unreadable — obligation marked failed" };
  }
  const patientName = [row.patientFirstName, row.patientLastName].filter(Boolean).join(" ");

  let sendOk = false;
  let sendError = "";
  if (obligation.channel === "whatsapp") {
    const base = publicBaseUrl();
    if (!base) {
      sendError = "PUBLIC_BASE_URL is not configured — cannot build the report link for WhatsApp";
    } else {
      const { sendReportWhatsapp } = await import("../routes/whatsapp");
      const result = await sendReportWhatsapp({
        phone: recipient,
        patientName,
        reportNumber: row.r.reportNumber,
        testName: row.testName ?? "Report (amended)",
        reportUrl: `${base}/api/patient-reports/${obligation.reportId}/pdf`,
      });
      sendOk = result.ok;
      sendError = result.ok ? "" : result.error ?? "WhatsApp send failed";
    }
  } else if (obligation.channel === "email") {
    const { buildReportArtifact } = await import("../routes/patient-reports");
    const { sendReportEmail } = await import("../email");
    const artifact = await buildReportArtifact(obligation.reportId, { surface: "email", versionMode: "specific" });
    const result = await sendReportEmail({
      to: recipient,
      subject: `Amended Report: ${row.r.reportNumber}`,
      html: artifact?.html ?? "",
      patientName,
      reportNumber: row.r.reportNumber,
    });
    sendOk = result.ok;
    sendError = result.ok ? "" : result.error ?? "Email send failed";
  } else {
    await recordObligationSendOutcome(obligationId, { ok: false, reason: `channel ${obligation.channel} has no automated sender` });
    return { ok: true, detail: "unsupported channel — obligation marked failed" };
  }

  if (!sendOk) {
    // Keep the obligation QUEUED while the bounded job retries continue; only
    // the FINAL attempt marks it failed for the operator to act on.
    if (isLastAttempt(job)) {
      await recordObligationSendOutcome(obligationId, { ok: false, reason: sendError });
    }
    return { ok: false, detail: sendError };
  }

  // Success: record the delivery in the SAME log the interactive share path
  // uses, stamp delivered like a first delivery, and complete the obligation.
  await db.insert(reportSharesTable).values({
    reportId: obligation.reportId,
    channel: obligation.channel,
    recipient,
    sharedBy: "redelivery-job",
    status: "sent",
    errorMessage: null,
  });
  const [reportNow] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, obligation.reportId));
  if (reportNow?.status === "verified") {
    await db.update(patientReportsTable).set({ status: "delivered", deliveredAt: new Date() }).where(eq(patientReportsTable.id, obligation.reportId));
  } else if (reportNow?.status === "delivered" && !reportNow.deliveredAt) {
    await db.update(patientReportsTable).set({ deliveredAt: new Date() }).where(eq(patientReportsTable.id, obligation.reportId));
  }
  await recordObligationSendOutcome(obligationId, { ok: true });
  await completeObligationsForDelivery({
    deliveredReportId: obligation.reportId,
    latestReportId: version.latestReportId,
    rootReportId: obligation.rootReportId,
    channel: obligation.channel,
    recipient,
  });
  return { ok: true, detail: `re-delivered ${obligation.channel} → ${obligation.recipientMasked}` };
};

const pacsRearchiveHandler: RadiologyJobHandler = async (job) => {
  const payload = (job.payload ?? {}) as { studyId?: number; reportId?: number };
  const studyId = Number(payload.studyId);
  if (!Number.isInteger(studyId) || studyId <= 0) {
    return { ok: false, detail: "invalid payload: studyId required" };
  }
  // DUPLICATE-EFFECT GUARD: if the target revision is already archived
  // successfully, do nothing (restart-safe).
  if (payload.reportId) {
    const [rev] = await db
      .select({ status: radiologyPacsArchiveRevisionsTable.status })
      .from(radiologyPacsArchiveRevisionsTable)
      .where(eq(radiologyPacsArchiveRevisionsTable.reportId, Number(payload.reportId)));
    if (rev?.status === "success") return { ok: true, detail: "revision already archived — no-op" };
  }
  const { archiveReportToPacs } = await import("./pacsArchive");
  const result = await archiveReportToPacs(studyId);
  return result.success
    ? { ok: true, detail: `archived (instance ${result.instanceId ?? "?"})` }
    : { ok: false, detail: result.error ?? "archive failed" };
};

export const USG_PACS_RETURN_JOB = "usg_pacs_return";

/** USG P6 — return a signed USG report to PACS. Re-evaluates the fail-closed
 *  eligibility policy at EXECUTION time (not just at enqueue), so a report that
 *  became superseded / lost Form-F compliance in the interim is never pushed.
 *  Then delegates to the canonical archiveReportToPacs. Duplicate-effect safe. */
const usgPacsReturnHandler: RadiologyJobHandler = async (job) => {
  const payload = (job.payload ?? {}) as { studyId?: number; reportId?: number };
  const studyId = Number(payload.studyId);
  if (!Number.isInteger(studyId) || studyId <= 0) return { ok: false, detail: "invalid payload: studyId required" };

  // Duplicate-effect guard: already archived successfully → no-op.
  if (payload.reportId) {
    const [rev] = await db
      .select({ status: radiologyPacsArchiveRevisionsTable.status })
      .from(radiologyPacsArchiveRevisionsTable)
      .where(eq(radiologyPacsArchiveRevisionsTable.reportId, Number(payload.reportId)));
    if (rev?.status === "success") return { ok: true, detail: "revision already archived — no-op" };
  }

  const { evaluateUsgPacsReturn } = await import("./usgPacsReturnService");
  const evaln = await evaluateUsgPacsReturn(studyId);
  if ("error" in evaln) return { ok: false, detail: evaln.error };
  if (!evaln.eligible) return { ok: false, detail: `ineligible: ${evaln.blockReasons.join(",")}` };

  const { archiveReportToPacs } = await import("./pacsArchive");
  const result = await archiveReportToPacs(studyId);
  return result.success
    ? { ok: true, detail: `usg report returned to PACS (instance ${result.instanceId ?? "?"})` }
    : { ok: false, detail: result.error ?? "archive failed" };
};

export const RESTORE_VERIFY_JOB = "radiology_restore_verify";

/** BEND-1 Phase 8 — restore-verification proof, run as a durable job (it is
 *  expensive; maxRetries=1 at enqueue means no automatic re-run). */
const restoreVerifyHandler: RadiologyJobHandler = async (job) => {
  const payload = (job.payload ?? {}) as { backupPath?: string | null; ranBy?: string };
  const { runRestoreVerification } = await import("./restoreVerification");
  const result = await runRestoreVerification({
    backupPath: payload.backupPath ?? undefined,
    ranBy: payload.ranBy ?? "job",
  });
  return result.ok
    ? { ok: true, detail: `restore proven in ${result.durationMs}ms (${result.steps.length} steps)` }
    : { ok: false, detail: result.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`).join("; ").slice(0, 400) };
};

/** The handler registry the cron tick + ops tick endpoint run with. */
export const RADIOLOGY_JOB_HANDLERS: Record<string, RadiologyJobHandler> = {
  [REDELIVERY_SEND_JOB]: redeliverySendHandler,
  [PACS_REARCHIVE_JOB]: pacsRearchiveHandler,
  [USG_PACS_RETURN_JOB]: usgPacsReturnHandler,
  [RESTORE_VERIFY_JOB]: restoreVerifyHandler,
  // Phase P1/P2 (shadow): the AI execution pipeline runs on this same engine —
  // no new scheduler, no new worker, no new queue. P2 injects the AI Gateway
  // (replacing the P1 stub) at the inference seam; still shadow-only.
  [AI_SHADOW_PIPELINE_JOB]: makeAiShadowPipelineHandler({ provider: gatewayInferenceProvider }),
  // MWL cancel cleanup — remove-only; never writeWorklistFile.
  [MWL_WL_CLEANUP_JOB]: mwlWlCleanupHandler,
  // Background text report composition — NEVER on overnight vision tick.
  [AI_REPORT_COMPOSE_JOB]: async (job) => {
    const payload = (job.payload ?? {}) as { composeJobId?: number };
    const composeJobId = Number(payload.composeJobId ?? job.entityId);
    if (!Number.isInteger(composeJobId) || composeJobId <= 0) {
      return { ok: false, detail: "invalid composeJobId" };
    }
    return processComposeJob(composeJobId);
  },
};
