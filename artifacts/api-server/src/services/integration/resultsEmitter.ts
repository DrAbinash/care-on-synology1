// ============================================================================
// Results-back reconciler (brief §12, §13, §16). Decoupled: it does NOT modify
// patient-reports.ts, samples.ts or radiology.ts. It scans referral-linked
// orders for finalised reports (patient_reports.status verified/delivered) and:
//   • records an external_result_link (idempotent),
//   • enqueues diagnostic_report.finalised (+ diagnostic_result.critical),
//   • advances the referral item + header toward REPORTED/DELIVERED.
// Running it on a timer (or manually) means result-return survives whichever
// code path finalised the report, and re-running never double-emits.
// The scan window is work-driven (eligible reports with no link yet, oldest
// referral first) so a growing reconciled history cannot starve new results —
// see reconcileFairProgress.db.test.ts.
// ============================================================================
import { and, eq, inArray, notInArray, isNotNull, sql } from "drizzle-orm";
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

export async function reconcileResults(opts: { limit?: number } = {}): Promise<{ scanned: number; emitted: number; critical: number; failed: number }> {
  const limit = opts.limit ?? 50;

  // Work, not history, defines the window. A reconciled referral stays inside the
  // old predicate — its header lands on REPORTED, which is not one of the three
  // excluded statuses, and nothing in the codebase writes DELIVERED — so once the
  // history grew past `limit` a pass spent its whole budget re-reading rows whose
  // reports were already linked and never reached the un-linked rows behind them.
  // That is starvation, not slowness: the rows it skipped could never be delivered.
  // Ordered, so "which `limit` rows" is a fact a test can pin rather than whatever
  // the heap scan happened to yield first.
  const refs = await db
    .select()
    .from(diagnosticReferralsTable)
    .where(and(
      isNotNull(diagnosticReferralsTable.careOrderId),
      notInArray(diagnosticReferralsTable.status, ["CANCELLED", "EXPIRED", "DELIVERED"]),
      // Mirrors the per-report filter below: a referral counts only if one of its
      // eligible reports has no external_result_links row yet.
      sql`EXISTS (
            SELECT 1 FROM "patient_reports" "pr"
             WHERE "pr"."order_id" = ${diagnosticReferralsTable.careOrderId}
               AND "pr"."status" IN ('pending_verification', 'verified', 'delivered')
               AND NOT EXISTS (
                    SELECT 1 FROM "external_result_links" "erl"
                     WHERE "erl"."referral_id" = ${diagnosticReferralsTable.id}
                       AND "erl"."care_report_id" = "pr"."id")
          )`,
    ))
    .orderBy(diagnosticReferralsTable.id)
    .limit(limit);

  let emitted = 0, critical = 0, failed = 0;
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
      // Cheap pre-filter only — the authoritative check runs inside the transaction,
      // where it is atomic against the insert.
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

      // A report that cannot be emitted must not abandon the referrals queued
      // behind it in the same pass — that is a second, independent way to stop
      // making progress. The link, the events and the audit rows are one
      // transaction, so a collision (e.g. a concurrent pass winning the outbox
      // idempotency key) rolls the whole unit back, the report stays un-linked,
      // and the next tick retries it.
      let emittedThisReport = true;
      await db.transaction(async (tx) => {
        // Pre-check above, insert here: not one atomic step. The only unique index
        // on the table is (referral_item_id, care_report_id), and PostgreSQL treats
        // NULLs as distinct, so a referral with no item row is not covered by it —
        // two passes racing on the same report both commit a link, and the loser
        // still finds the winner's outbox row by idempotency key, so nothing else
        // stops it either. One lock per (referral, report) pair, held to COMMIT,
        // makes this check and the insert below a single decision.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reconcile-result:${ref.id}:${rep.id}`}, 0))`);
        const [raced] = await tx
          .select({ id: externalResultLinksTable.id })
          .from(externalResultLinksTable)
          .where(and(eq(externalResultLinksTable.referralId, ref.id), eq(externalResultLinksTable.careReportId, rep.id)))
          .limit(1);
        if (raced) { emittedThisReport = false; return; }

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
        // The insert was refused — for an item-linked referral this is the
        // (referral_item_id, care_report_id) unique index saying someone else
        // already wrote this result. The unit wrote nothing, so it counts as work
        // deferred to the next pass, never as work done.
        if (!link) { emittedThisReport = false; failed++; return; }

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
      }).catch((err) => {
        emittedThisReport = false;
        failed++;
        console.warn(`[integration] report ${rep.id} not emitted for referral ${ref.referralUuid}:`, (err as Error)?.message);
      });
      if (!emittedThisReport) continue;

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

  return { scanned: refs.length, emitted, critical, failed };
}
