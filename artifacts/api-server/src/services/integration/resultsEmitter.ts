// ============================================================================
// Results-back reconciler (brief §12, §13, §16). Decoupled: it does NOT modify
// patient-reports.ts, samples.ts or radiology.ts. It scans referral-linked
// orders for finalised reports (patient_reports.status verified/delivered) and:
//   • records an external_result_link (idempotent),
//   • enqueues diagnostic_report.finalised (+ diagnostic_result.critical),
//   • advances the referral item + header toward REPORTED/DELIVERED.
// Running it on a timer (or manually) means result-return survives whichever
// code path finalised the report, and re-running never double-emits.
// ============================================================================
import { and, eq, inArray, notInArray, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  diagnosticReferralsTable,
  diagnosticReferralItemsTable,
  externalResultLinksTable,
  patientReportsTable,
  patientReportAmendmentsTable,
} from "@workspace/db";
import { writeReferralEvent } from "./audit";
import { enqueueOutboxEvent } from "./outbox";
import { assertTransition, isReferralStatus, canTransition } from "./referralStateMachine";
import type { ReferralStatus } from "@workspace/db";
import { sendWhatsAppNow } from "../whatsapp/WhatsAppOutbox";

function carePublicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || process.env.SITE_URL || "")
    .replace(/\/+$/, "");
}

export async function reconcileResults(opts: { limit?: number } = {}): Promise<{ scanned: number; emitted: number; critical: number }> {
  const limit = opts.limit ?? 50;
  const refs = await db
    .select()
    .from(diagnosticReferralsTable)
    .where(and(
      isNotNull(diagnosticReferralsTable.careOrderId),
      notInArray(diagnosticReferralsTable.status, ["CANCELLED", "EXPIRED", "DELIVERED"]),
    ))
    .limit(limit);

  let emitted = 0, critical = 0;
  for (const ref of refs) {
    if (!ref.careOrderId) continue;
    const reports = await db
      .select()
      .from(patientReportsTable)
      .where(and(eq(patientReportsTable.orderId, ref.careOrderId), inArray(patientReportsTable.status, ["pending_verification", "verified", "delivered"])));
    if (reports.length === 0) continue;

    const items = await db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, ref.id));
    const itemByOrderTest = new Map<number, number>();
    for (const it of items) if (it.careOrderTestId) itemByOrderTest.set(it.careOrderTestId, it.id);

    for (const rep of reports) {
      const [linked] = await db.select({ id: externalResultLinksTable.id }).from(externalResultLinksTable).where(and(eq(externalResultLinksTable.referralId, ref.id), eq(externalResultLinksTable.careReportId, rep.id))).limit(1);
      if (linked) continue;

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

      // Mint public token so HOPE can download the PDF (dynamic import avoids cycles).
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
          finalisedAt: rep.verifiedAt ?? rep.updatedAt,
          finalisingDoctor: rep.verifiedByName ?? rep.signedByName ?? null,
          reportRef: rep.reportNumber,
        }).returning({ id: externalResultLinksTable.id }).catch(() => [undefined as unknown as { id: number }]);
        if (!link) return;

        const finalisedEvent = await enqueueOutboxEvent(tx, {
          eventType: amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised",
          idempotencyKey: `${amendment ? "diagnostic_report.amended" : "diagnostic_report.finalised"}:${ref.referralUuid}:${rep.id}`,
          correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
          payload: {
            referralUuid: ref.referralUuid, careOrderId: ref.careOrderId, careReportId: rep.id,
            reportNumber: rep.reportNumber, resultType: rep.type, reportStatus: amendment ? "amended" : rep.status,
            isCritical: rep.isCritical, finalisedAt: rep.verifiedAt ?? rep.updatedAt, finalisingDoctor: rep.verifiedByName ?? rep.signedByName ?? null,
            title: rep.title, impression: rep.impression ?? null,
            reportRef: rep.reportNumber, reportToken,
            pdfUrl, reportUrl: reportPageUrl,
            ...(amendment ? {
              amended: true,
              supersedesReportNumber: originalReportNumber,
              amendmentReason: amendment.reason,
              amendmentSequence: amendment.sequenceNumber,
              amendedByName: amendment.amendedByName,
            } : {}),
          },
        });
        await tx.update(externalResultLinksTable).set({ emittedOutboxId: finalisedEvent.id }).where(eq(externalResultLinksTable.id, link.id));

        if (rep.isCritical) {
          await enqueueOutboxEvent(tx, {
            eventType: "diagnostic_result.critical",
            idempotencyKey: `diagnostic_result.critical:${ref.referralUuid}:${rep.id}`,
            correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
            payload: {
              referralUuid: ref.referralUuid, careReportId: rep.id, reportNumber: rep.reportNumber,
              criticalNote: rep.criticalNote ?? null, resultLinkId: link.id,
              finalisingDoctor: rep.verifiedByName ?? null,
              pdfUrl, reportUrl: reportPageUrl, reportToken,
            },
          });
          await writeReferralEvent(tx, { referralId: ref.id, itemId: referralItemId, eventType: "result.critical", actorType: "system", organisation: "CARE", reason: rep.criticalNote ?? "critical_result" });
        }

        if (referralItemId) {
          await tx.update(diagnosticReferralItemsTable).set({ itemStatus: "reported" }).where(eq(diagnosticReferralItemsTable.id, referralItemId));
        }
        await writeReferralEvent(tx, {
          referralId: ref.id, itemId: referralItemId,
          eventType: amendment ? "report.amended" : "report.finalised",
          actorType: "system", organisation: "CARE",
          payload: {
            careReportId: rep.id, reportNumber: rep.reportNumber, isCritical: rep.isCritical, pdfUrl,
            ...(amendment ? { supersedesReportNumber: originalReportNumber, amendmentSequence: amendment.sequenceNumber } : {}),
          },
        });
      });

      // Care-attributed WhatsApp only (Care Meta / Care books — never Hope Hospital or Medicals).
      if (ref.patientPhone && !amendment) {
        const link = reportPageUrl || pdfUrl;
        const text = [
          `Care Diagnostics: your report${rep.title ? ` (${rep.title})` : ""} is ready.`,
          link ? `View/download: ${link}` : null,
          "This message is from Care Diagnostics (separate from Hope Hospital).",
        ].filter(Boolean).join("\n");
        try {
          await sendWhatsAppNow({
            recipientPhone: ref.patientPhone,
            messagePurpose: "report_ready",
            text,
            patientId: ref.carePatientId ?? null,
            reportId: rep.id,
            idempotencyKey: `hope-referral-report-ready:${ref.referralUuid}:${rep.id}`,
            createdBy: "hope-care-integration",
          });
        } catch (waErr) {
          console.warn("[integration] report_ready WhatsApp failed:", (waErr as Error)?.message);
        }
      }

      emitted++;
      if (rep.isCritical) critical++;
    }

    if (isReferralStatus(ref.status)) {
      const target: ReferralStatus = "REPORTED";
      if (canTransition(ref.status as ReferralStatus, target) && ref.status !== target) {
        await db.transaction(async (tx) => {
          try {
            assertTransition(ref.status as ReferralStatus, target);
            await tx.update(diagnosticReferralsTable).set({ status: target }).where(eq(diagnosticReferralsTable.id, ref.id));
            await writeReferralEvent(tx, { referralId: ref.id, eventType: "referral.reported", fromStatus: ref.status, toStatus: target, actorType: "system", organisation: "CARE" });
          } catch { /* leave status as-is if not a legal jump */ }
        });
      }
    }
  }

  return { scanned: refs.length, emitted, critical };
}
