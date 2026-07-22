// ============================================================================
// Phase 3 — critical-result escalation (brief §13: "Escalate if not
// acknowledged. Record recipient, time, method and escalation attempts.").
//
// A finalised critical result (external_result_links.is_critical, ack pending)
// that HOPE has not acknowledged within the window is re-notified via a
// diagnostic_result.escalated event; each attempt is recorded, and after
// maxAttempts the link is marked 'escalated' (medico-legal trail preserved).
// Acknowledgement arrives via the inbound POST /diagnostic-referrals/:uuid/
// acknowledge endpoint, which sets critical_ack_status='acknowledged'.
// ============================================================================
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { externalResultLinksTable, diagnosticReferralsTable } from "@workspace/db";
import { enqueueOutboxEvent } from "./outbox";
import { writeReferralEvent } from "./audit";

const DEFAULT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_ATTEMPTS = 3;

export interface EscalationInput {
  criticalAckStatus: string | null; // pending | acknowledged | escalated
  finalisedAt: Date | null;
  lastEscalatedAt: Date | null;
  escalationAttempts: number;
  now: Date;
  windowMs?: number;
  maxAttempts?: number;
}

/** Pure decision: should this pending critical result be escalated now? */
export function shouldEscalate(i: EscalationInput): boolean {
  if (i.criticalAckStatus !== "pending") return false;
  if (i.escalationAttempts >= (i.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) return false;
  const anchor = i.lastEscalatedAt ?? i.finalisedAt;
  if (!anchor) return false;
  return i.now.getTime() - anchor.getTime() >= (i.windowMs ?? DEFAULT_WINDOW_MS);
}

export async function escalateCriticalResults(opts: { limit?: number; windowMs?: number; maxAttempts?: number; now?: Date } = {}): Promise<{ scanned: number; escalated: number }> {
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const links = await db
    .select()
    .from(externalResultLinksTable)
    .where(and(eq(externalResultLinksTable.isCritical, true), eq(externalResultLinksTable.criticalAckStatus, "pending")))
    .limit(limit);

  let escalated = 0;
  for (const link of links) {
    if (!shouldEscalate({
      criticalAckStatus: link.criticalAckStatus, finalisedAt: link.finalisedAt, lastEscalatedAt: link.lastEscalatedAt,
      escalationAttempts: link.escalationAttempts, now, windowMs: opts.windowMs, maxAttempts,
    })) continue;

    const [ref] = await db.select().from(diagnosticReferralsTable).where(eq(diagnosticReferralsTable.id, link.referralId)).limit(1);
    if (!ref) continue;
    const attemptNo = link.escalationAttempts + 1;
    const isFinal = attemptNo >= maxAttempts;

    await db.transaction(async (tx) => {
      await tx.update(externalResultLinksTable).set({
        escalationAttempts: attemptNo,
        lastEscalatedAt: now,
        criticalAckStatus: isFinal ? "escalated" : "pending",
      }).where(eq(externalResultLinksTable.id, link.id));

      await enqueueOutboxEvent(tx, {
        eventType: "diagnostic_result.escalated",
        idempotencyKey: `diagnostic_result.escalated:${ref.referralUuid}:${link.id}:${attemptNo}`,
        correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
        payload: {
          referralUuid: ref.referralUuid, resultLinkId: link.id, careReportId: link.careReportId,
          reportRef: link.reportRef, attempt: attemptNo, maxAttempts, final: isFinal,
          finalisingDoctor: link.finalisingDoctor, finalisedAt: link.finalisedAt,
        },
      });
      await writeReferralEvent(tx, {
        referralId: ref.id, eventType: "result.escalated", actorType: "system", organisation: "CARE",
        reason: `critical result unacknowledged — escalation attempt ${attemptNo}/${maxAttempts}${isFinal ? " (final)" : ""}`,
        payload: { resultLinkId: link.id, attempt: attemptNo },
      });
    });
    escalated++;
  }
  return { scanned: links.length, escalated };
}
