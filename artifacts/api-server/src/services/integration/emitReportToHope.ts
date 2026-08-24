// ============================================================================
// Emit one finalised CARE patient_report to Hope (outbox + optional immediate
// dispatch). Used by:
//   • Reporting Workspace "Send to Hope" button
//   • Post-finalize auto-push when the study is linked to a Hope referral
//
// Relies on the same envelope shape as resultsEmitter.reconcileResults so Hope
// landReport() accepts it unchanged. Idempotent on outbox idempotency_key and
// external_result_links uniqueness.
// ============================================================================
import { and, desc, eq, inArray } from "drizzle-orm";
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

async function resolveReportId(opts: {
  reportId?: number | null;
  worklistId?: number | null;
}): Promise<number | null> {
  if (opts.reportId != null && Number.isFinite(opts.reportId) && opts.reportId > 0) {
    return Math.trunc(opts.reportId);
  }
  if (opts.worklistId != null && Number.isFinite(opts.worklistId) && opts.worklistId > 0) {
    const [wl] = await db
      .select({ reportId: radiologyWorklistTable.reportId, studyId: radiologyWorklistTable.studyId })
      .from(radiologyWorklistTable)
      .where(eq(radiologyWorklistTable.id, Math.trunc(opts.worklistId)))
      .limit(1);
    if (wl?.reportId) return wl.reportId;
    const worklistId = Math.trunc(opts.worklistId);
    const [byWorklistId] = await db
      .select({ id: patientReportsTable.id })
      .from(patientReportsTable)
      .where(and(
        eq(patientReportsTable.studyId, worklistId),
        inArray(patientReportsTable.status, ["pending_verification", "verified", "delivered"]),
      ))
      .orderBy(desc(patientReportsTable.id))
      .limit(1);
    if (byWorklistId) return byWorklistId.id;
    if (wl?.studyId) {
      const [rep] = await db
        .select({ id: patientReportsTable.id })
        .from(patientReportsTable)
        .where(and(
          eq(patientReportsTable.studyId, wl.studyId),
          inArray(patientReportsTable.status, ["pending_verification", "verified", "delivered"]),
        ))
        .orderBy(desc(patientReportsTable.id))
        .limit(1);
      if (rep) return rep.id;
    }
  }
  return null;
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
  const reportId = await resolveReportId(opts);
  if (reportId == null) {
    return { ok: false, error: "Report not found for this study", code: "NOT_FOUND" };
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

  const [linked] = await db
    .select({ id: externalResultLinksTable.id })
    .from(externalResultLinksTable)
    .where(and(eq(externalResultLinksTable.referralId, ref.id), eq(externalResultLinksTable.careReportId, rep.id)))
    .limit(1);
  if (linked) {
    let dispatched: { sent: number; failed: number } | undefined;
    if (opts.dispatchNow !== false) {
      const d = await dispatchPendingOutbox({ limit: 20 });
      dispatched = { sent: d.sent, failed: d.failed };
    }
    return { ok: true, emitted: false, alreadySent: true, referralUuid: ref.referralUuid, reportId: rep.id, dispatched };
  }

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

  try {
    await db.transaction(async (tx) => {
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
      if (!link) return;

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
    });
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || "Failed to enqueue Hope callback", code: "EMIT_FAILED" };
  }

  let dispatched: { sent: number; failed: number } | undefined;
  if (opts.dispatchNow !== false) {
    const d = await dispatchPendingOutbox({ limit: 20 });
    dispatched = { sent: d.sent, failed: d.failed };
  }

  return { ok: true, emitted: true, alreadySent: false, referralUuid: ref.referralUuid, reportId: rep.id, dispatched };
}
