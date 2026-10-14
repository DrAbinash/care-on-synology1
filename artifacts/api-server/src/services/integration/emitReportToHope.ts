// ============================================================================
// Emit one finalised CARE patient_report to Hope (outbox + optional immediate
// dispatch). Used by:
//   • Reporting Workspace "Send to Hope" button
//   • Post-finalize auto-push when the study is linked to a Hope referral
//
// Relies on the same envelope shape as resultsEmitter.reconcileResults so Hope
// landReport() accepts it unchanged. Idempotent on the outbox idempotency_key,
// and on one result link per (referral, report) — which the database alone cannot
// guarantee: external_result_links has no unique index covering that pair (its
// only dedup index is (referral_item_id, care_report_id), and NULLs are distinct),
// so the pair is serialized with the same advisory lock the reconciler takes.
// ============================================================================
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  diagnosticReferralsTable,
  diagnosticReferralItemsTable,
  externalResultLinksTable,
  patientReportsTable,
  patientReportAmendmentsTable,
  radiologyWorklistTable,
  radiologyStudiesTable,
} from "@workspace/db";
import { enqueueOutboxEvent } from "./outbox";
import { dispatchPendingOutbox } from "./outbox";
import { writeReferralEvent } from "./audit";
import { assertTransition, canTransition, isReferralStatus } from "./referralStateMachine";
import type { ReferralStatus } from "@workspace/db";

export function pickExactHopeReferralOrderId(opts: {
  reportOrderId: number | null;
  billedStudyOrderId: number | null;
}): number | null {
  if (opts.reportOrderId && Number.isFinite(opts.reportOrderId) && opts.reportOrderId > 0) {
    return Math.trunc(opts.reportOrderId);
  }
  if (opts.billedStudyOrderId && Number.isFinite(opts.billedStudyOrderId) && opts.billedStudyOrderId > 0) {
    return Math.trunc(opts.billedStudyOrderId);
  }
  return null;
}

function carePublicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || process.env.SITE_URL || "")
    .replace(/\/+$/, "");
}

export type EmitReportToHopeResult =
  | { ok: true; emitted: boolean; alreadySent: boolean; referralUuid: string; reportId: number; dispatched?: { sent: number; failed: number } }
  | { ok: false; error: string; code: "NOT_FOUND" | "NOT_SIGNED" | "NO_REFERRAL" | "EMIT_FAILED" };

/**
 * What the delivery transaction actually did. Returned from the callback rather
 * than written to an outer variable, because TypeScript does not credit writes
 * made inside a nested function: `outcome === "already"` then compares a value it
 * still believes is `"emitted"`, and the guard would not compile.
 */
type EmitOutcome = "emitted" | "already" | "refused";

/**
 * Which report a Hope delivery names.
 *
 * `patient_reports.study_id` is a SHARED id space: the radiology finalize writers
 * store `radiology_worklist.id` in it, while older rows and other readers treat
 * it as `radiology_studies.id`, and the two serials overlap. Selecting
 * `ORDER BY id DESC` over that column with no patient check therefore hands Hope
 * whichever report happens to have the highest id — measured on a synthetic
 * fixture as another patient's signed report, which Hope then files under the
 * wrong referral. That is a cross-patient disclosure leaving the building.
 *
 * A candidate may speak for this worklist row only when its own `patient_id`
 * equals the worklist's. Null on either side is NOT a failure: `patient_id` is
 * nullable on the worklist ("null if unmatched"), and an identifier that was
 * never recorded must not block a delivery. Only a VERIFIED mismatch refuses,
 * and the caller names that refusal rather than reporting "not found".
 */
async function resolveReportId(opts: {
  reportId?: number | null;
  worklistId?: number | null;
}): Promise<{ reportId: number | null; refusal: string | null }> {
  const none = { reportId: null, refusal: null };
  if (opts.reportId != null && Number.isFinite(opts.reportId) && opts.reportId > 0) {
    return { reportId: Math.trunc(opts.reportId), refusal: null };
  }
  if (opts.worklistId == null || !Number.isFinite(opts.worklistId) || opts.worklistId <= 0) return none;

  const worklistId = Math.trunc(opts.worklistId);
  const [wl] = await db
    .select({
      reportId: radiologyWorklistTable.reportId,
      studyId: radiologyWorklistTable.studyId,
      patientId: radiologyWorklistTable.patientId,
    })
    .from(radiologyWorklistTable)
    .where(eq(radiologyWorklistTable.id, worklistId))
    .limit(1);
  if (!wl) return none;

  let crossPatient = 0;
  const samePatient = (candidatePatientId: number | null): boolean => {
    if (wl.patientId == null || candidatePatientId == null) return true;
    if (candidatePatientId === wl.patientId) return true;
    crossPatient += 1;
    return false;
  };

  if (wl.reportId) {
    const [pointed] = await db
      .select({ id: patientReportsTable.id, patientId: patientReportsTable.patientId })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, wl.reportId))
      .limit(1);
    if (pointed && samePatient(pointed.patientId)) return { reportId: pointed.id, refusal: null };
  }

  // Both spellings of `study_id`, in the order the previous implementation
  // tried them: this worklist row's own id first, then the billed study it links.
  for (const studyId of [worklistId, wl.studyId]) {
    if (studyId == null) continue;
    const rows = await db
      .select({ id: patientReportsTable.id, patientId: patientReportsTable.patientId })
      .from(patientReportsTable)
      .where(and(
        eq(patientReportsTable.studyId, studyId),
        inArray(patientReportsTable.status, ["pending_verification", "verified", "delivered"]),
      ))
      .orderBy(desc(patientReportsTable.id));
    const hit = rows.find((r) => samePatient(r.patientId));
    if (hit) return { reportId: hit.id, refusal: null };
  }

  if (crossPatient > 0) {
    return {
      reportId: null,
      refusal: `Refusing to send to Hope: the ${crossPatient === 1 ? "only report" : `${crossPatient} reports`} linked to this study ${crossPatient === 1 ? "belongs" : "belong"} to a different patient than worklist ${worklistId} (patient ${wl.patientId}). Resolve the study-to-report link before delivering.`,
    };
  }
  return none;
}

/**
 * Push one radiology (or pathology) report to Hope when a diagnostic_referral
 * is linked to the Care order/patient. Optionally flushes the outbox immediately.
 */
export async function emitReportToHope(opts: {
  reportId?: number | null;
  worklistId?: number | null;
  dispatchNow?: boolean;
}): Promise<EmitReportToHopeResult> {
  const resolved = await resolveReportId(opts);
  const reportId = resolved.reportId;
  if (reportId == null) {
    return { ok: false, error: resolved.refusal ?? "Report not found for this study", code: "NOT_FOUND" };
  }

  const [loaded] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, reportId)).limit(1);
  if (!loaded) return { ok: false, error: "Report not found", code: "NOT_FOUND" };
  let rep = loaded;
  for (let i = 0; i < 20; i++) {
    const [amd] = await db
      .select({ amendedReportId: patientReportAmendmentsTable.amendedReportId })
      .from(patientReportAmendmentsTable)
      .where(eq(patientReportAmendmentsTable.originalReportId, rep.id))
      .orderBy(desc(patientReportAmendmentsTable.sequenceNumber))
      .limit(1);
    if (!amd) break;
    const [next] = await db.select().from(patientReportsTable).where(eq(patientReportsTable.id, amd.amendedReportId)).limit(1);
    if (!next) break;
    rep = next;
  }

  // Signed primary report is enough for Hope (pending_verification / verified / delivered).
  const signedEnough =
    ["pending_verification", "verified", "delivered"].includes(rep.status) ||
    !!rep.signedAt;
  if (!signedEnough) {
    return { ok: false, error: "Finalize and sign the report before sending to Hope", code: "NOT_SIGNED" };
  }

  let billedOrderId: number | null = null;
  if (opts.worklistId) {
    const [wl] = await db
      .select({ studyId: radiologyWorklistTable.studyId })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, Math.trunc(opts.worklistId)))
      .limit(1);
    if (wl?.studyId) {
      const [study] = await db
        .select({ orderId: radiologyStudiesTable.orderId })
        .from(radiologyStudiesTable)
        .where(eq(radiologyStudiesTable.id, wl.studyId))
        .limit(1);
      billedOrderId = study?.orderId ?? null;
    }
  }
  const exactOrderId = pickExactHopeReferralOrderId({
    reportOrderId: rep.orderId ?? null,
    billedStudyOrderId: billedOrderId,
  });
  let ref: typeof diagnosticReferralsTable.$inferSelect | undefined;
  if (exactOrderId) {
    const orderRefs = await db
      .select()
      .from(diagnosticReferralsTable)
      .where(eq(diagnosticReferralsTable.careOrderId, exactOrderId))
      .orderBy(desc(diagnosticReferralsTable.id));
    ref = orderRefs[0];
  }

  if (!ref) {
    return {
      ok: false,
      error: "No Hope referral linked to this study/order. Prescribe the test from Hope OPD first (or accept the Hope referral in Care).",
      code: "NO_REFERRAL",
    };
  }

  const referral = ref;
  /**
   * This (referral, report) is already recorded as sent. Reported as already sent,
   * and the queue is still flushed, because the operator asked for delivery now and
   * an already-linked row can still have an event waiting in front of it.
   */
  const alreadySentResult = async (): Promise<EmitReportToHopeResult> => {
    let dispatched: { sent: number; failed: number } | undefined;
    if (opts.dispatchNow !== false) {
      const d = await dispatchPendingOutbox({ limit: 20 });
      dispatched = { sent: d.sent, failed: d.failed };
    }
    return { ok: true, emitted: false, alreadySent: true, referralUuid: referral.referralUuid, reportId: rep.id, dispatched };
  };

  const [linked] = await db
    .select({ id: externalResultLinksTable.id })
    .from(externalResultLinksTable)
    .where(and(eq(externalResultLinksTable.referralId, ref.id), eq(externalResultLinksTable.careReportId, rep.id)))
    .limit(1);
  if (linked) return alreadySentResult();

  const items = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, ref.id));
  const itemByOrderTest = new Map<number, number>();
  for (const it of items) if (it.careOrderTestId) itemByOrderTest.set(it.careOrderTestId, it.id);
  const referralItemId = rep.orderTestId ? itemByOrderTest.get(rep.orderTestId) ?? null : null;

  const [amendment] = await db
    .select()
    .from(patientReportAmendmentsTable)
    .where(eq(patientReportAmendmentsTable.amendedReportId, rep.id))
    .limit(1);
  let originalReportNumber: string | null = null;
  if (amendment) {
    const [orig] = await db
      .select({ reportNumber: patientReportsTable.reportNumber })
      .from(patientReportsTable)
      .where(eq(patientReportsTable.id, amendment.originalReportId))
      .limit(1);
    originalReportNumber = orig?.reportNumber ?? null;
  }

  let reportToken: string | null = rep.publicToken ?? null;
  try {
    const { ensurePublicToken } = await import("../../routes/patient-reports.js");
    reportToken = (await ensurePublicToken(rep.id)) ?? reportToken;
  } catch (err) {
    console.warn("[integration] ensurePublicToken failed:", (err as Error)?.message);
  }
  const base = carePublicBaseUrl();
  const pdfUrl = reportToken && base ? `${base}/api/p/r/${encodeURIComponent(reportToken)}/pdf` : null;
  const reportPageUrl = reportToken && base ? `${base}/p/r/${encodeURIComponent(reportToken)}` : null;

  // Three outcomes, and only one of them may tell the operator the report was
  // delivered by this call.
  let outcome: EmitOutcome = "emitted";
  try {
    outcome = await db.transaction(async (tx): Promise<EmitOutcome> => {
      // The pre-check above and this insert are not one atomic step. Take the same
      // lock the reconciler takes for this pair (resultsEmitter.ts:129) — a manual
      // send, the post-finalize auto-push and the 5-minute tick all write this row
      // shape — and re-check inside it. No unique index can be relied on here:
      // external_result_links_report_uidx is (referral_item_id, care_report_id) and
      // PostgreSQL treats NULLs as distinct, so an item-less referral is uncovered.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reconcile-result:${referral.id}:${rep.id}`}, 0))`);
      const [raced] = await tx
        .select({ id: externalResultLinksTable.id })
        .from(externalResultLinksTable)
        .where(and(eq(externalResultLinksTable.referralId, referral.id), eq(externalResultLinksTable.careReportId, rep.id)))
        .limit(1);
      if (raced) return "already";

      const [link] = await tx.insert(externalResultLinksTable).values({
        referralId: ref.id,
        referralItemId,
        careOrderId: ref.careOrderId,
        careReportId: rep.id,
        resultType: rep.type,
        sourceSystem: ref.sourceOrg,
        sourceOrderId: ref.sourcePrescriptionId ?? null,
        reportStatus: amendment ? "amended" : "final",
        isCritical: rep.isCritical,
        criticalAckStatus: rep.isCritical ? "pending" : null,
        finalisedAt: rep.verifiedAt ?? rep.signedAt ?? rep.updatedAt,
        finalisingDoctor: rep.verifiedByName ?? rep.signedByName ?? null,
        reportRef: rep.reportNumber,
      }).returning({ id: externalResultLinksTable.id }).catch(() => [undefined as unknown as { id: number }]);
      // The insert was refused. The error is swallowed, but PostgreSQL has already
      // put this transaction in aborted state, so the COMMIT that follows rolls the
      // whole unit back while the promise still resolves. Nothing was written, so
      // nothing here may be reported as delivered.
      if (!link) return "refused";

      const finalisedEvent = await enqueueOutboxEvent(tx, {
        eventType: amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised",
        idempotencyKey: `${amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised"}:${ref.referralUuid}:${rep.id}`,
        correlationId: ref.referralUuid,
        aggregateId: ref.referralUuid,
        partnerId: ref.createdByPartnerId ?? null,
        payload: {
          referralUuid: ref.referralUuid,
          careOrderId: ref.careOrderId,
          careReportId: rep.id,
          reportNumber: rep.reportNumber,
          resultType: rep.type,
          reportStatus: amendment ? "amended" : rep.status,
          isCritical: rep.isCritical,
          finalisedAt: rep.verifiedAt ?? rep.signedAt ?? rep.updatedAt,
          finalisingDoctor: rep.verifiedByName ?? rep.signedByName ?? null,
          title: rep.title,
          impression: rep.impression ?? null,
          reportRef: rep.reportNumber,
          reportToken,
          pdfUrl,
          reportUrl: reportPageUrl,
          ...(amendment
            ? {
                amended: true,
                supersedesReportNumber: originalReportNumber,
                amendmentReason: amendment.reason,
                amendmentSequence: amendment.sequenceNumber,
                amendedByName: amendment.amendedByName,
              }
            : {}),
        },
      });
      await tx.update(externalResultLinksTable).set({ emittedOutboxId: finalisedEvent.id }).where(eq(externalResultLinksTable.id, link.id));

      if (referralItemId) {
        await tx.update(diagnosticReferralItemsTable).set({ itemStatus: "reported" }).where(eq(diagnosticReferralItemsTable.id, referralItemId));
      }
      await writeReferralEvent(tx, {
        referralId: ref.id,
        itemId: referralItemId,
        eventType: amendment ? "report.amended" : "report.finalised",
        actorType: "system",
        organisation: "CARE",
        payload: { careReportId: rep.id, reportNumber: rep.reportNumber, isCritical: rep.isCritical, pdfUrl, source: "emitReportToHope" },
      });

      if (isReferralStatus(ref.status)) {
        const target: ReferralStatus = "REPORTED";
        if (canTransition(ref.status as ReferralStatus, target) && ref.status !== target) {
          try {
            assertTransition(ref.status as ReferralStatus, target);
            await tx.update(diagnosticReferralsTable).set({ status: target }).where(eq(diagnosticReferralsTable.id, ref.id));
          } catch { /* leave status */ }
        }
      }
      return "emitted";
    });
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || "Failed to enqueue Hope callback", code: "EMIT_FAILED" };
  }

  if (outcome === "already") return alreadySentResult();
  if (outcome === "refused") {
    // Settled outside the rolled-back transaction, because the only link this call
    // ever had is gone with it: "already sent" is true when someone else's
    // committed link exists, and a plain failure when it does not.
    const [nowLinked] = await db
      .select({ id: externalResultLinksTable.id })
      .from(externalResultLinksTable)
      .where(and(eq(externalResultLinksTable.referralId, referral.id), eq(externalResultLinksTable.careReportId, rep.id)))
      .limit(1);
    if (nowLinked) return alreadySentResult();
    return {
      ok: false,
      error: "Could not record the Hope delivery. The report itself is unchanged — send it again.",
      code: "EMIT_FAILED",
    };
  }

  let dispatched: { sent: number; failed: number } | undefined;
  if (opts.dispatchNow !== false) {
    const d = await dispatchPendingOutbox({ limit: 20 });
    dispatched = { sent: d.sent, failed: d.failed };
  }

  return { ok: true, emitted: true, alreadySent: false, referralUuid: ref.referralUuid, reportId: rep.id, dispatched };
}
