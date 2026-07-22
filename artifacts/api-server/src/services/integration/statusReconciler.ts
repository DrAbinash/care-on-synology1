// ============================================================================
// Phase 2 — per-item status round-trips (brief rollout Phase 2: "Status updates
// back to HOPE"). Decoupled reconciler: scans referral-linked orders for sample
// collection (pathology) and study progress (radiology) and emits
//   • diagnostic_sample.collected
//   • diagnostic_study.completed
//   • diagnostic_order.item_status_changed
// advancing the referral header (via the state machine's shortestPath, never an
// illegal jump) and each item's status. Idempotent — each milestone emits once.
// Does NOT modify samples.ts / radiology.ts / patient-reports.ts.
// ============================================================================
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  diagnosticReferralsTable,
  diagnosticReferralItemsTable,
  samplesTable,
  radiologyStudiesTable,
} from "@workspace/db";
import type { ReferralStatus } from "@workspace/db";
import { enqueueOutboxEvent } from "./outbox";
import { writeReferralEvent } from "./audit";
import { assertTransition, isReferralStatus, shortestPath } from "./referralStateMachine";
import { classifyModality } from "./catalogueMapping";

// ── Pure milestone classifier (unit-tested) ─────────────────────────────────
const SAMPLE_COLLECTED_STATES = new Set(["collected", "received", "in_processing", "completed", "reported"]);
const SAMPLE_INPROGRESS_STATES = new Set(["in_processing", "completed", "reported"]);
const STUDY_SCHEDULED_STATES = new Set(["scheduled", "in_progress", "acquired", "reported_preliminary", "reported_final", "delivered"]);
const STUDY_PERFORMED_STATES = new Set(["in_progress", "acquired", "reported_preliminary", "reported_final", "delivered"]);

export type HeaderMilestone = "SAMPLE_COLLECTED" | "STUDY_SCHEDULED" | "IN_PROGRESS" | null;

export interface MilestoneResult {
  sampleCollected: boolean;
  studyScheduled: boolean;
  studyPerformed: boolean;
  headerTarget: HeaderMilestone;
}

export function deriveMilestone(sampleStatuses: string[], studyStatuses: string[]): MilestoneResult {
  const sampleCollected = sampleStatuses.some((s) => SAMPLE_COLLECTED_STATES.has(s));
  const sampleInProgress = sampleStatuses.some((s) => SAMPLE_INPROGRESS_STATES.has(s));
  const studyScheduled = studyStatuses.some((s) => STUDY_SCHEDULED_STATES.has(s));
  const studyPerformed = studyStatuses.some((s) => STUDY_PERFORMED_STATES.has(s));
  let headerTarget: HeaderMilestone = null;
  if (studyPerformed || sampleInProgress) headerTarget = "IN_PROGRESS";
  else if (sampleCollected) headerTarget = "SAMPLE_COLLECTED";
  else if (studyScheduled) headerTarget = "STUDY_SCHEDULED";
  return { sampleCollected, studyScheduled, studyPerformed, headerTarget };
}

// Forward-only rank so we never regress a more-advanced referral.
const RANK: Partial<Record<ReferralStatus, number>> = {
  RECEIVED_BY_CARE: 0, PATIENT_ACCEPTED: 0, CARE_ORDER_CREATED: 1, PARTIALLY_BOOKED: 1,
  BILLED: 2, PAID: 3, STUDY_SCHEDULED: 4, SAMPLE_COLLECTED: 4, IN_PROGRESS: 5,
  COMPLETED: 6, REPORTED: 7, DELIVERED: 8,
};

export async function reconcileStatuses(opts: { limit?: number } = {}): Promise<{ scanned: number; sampleEvents: number; studyEvents: number }> {
  const limit = opts.limit ?? 50;
  const refs = await db.select().from(diagnosticReferralsTable).where(and(
    isNotNull(diagnosticReferralsTable.careOrderId),
    notInArray(diagnosticReferralsTable.status, ["CANCELLED", "EXPIRED", "DELIVERED", "REPORTED", "COMPLETED"]),
  )).limit(limit);

  let sampleEvents = 0, studyEvents = 0;
  for (const ref of refs) {
    if (!ref.careOrderId) continue;
    const [samples, studies, items] = await Promise.all([
      db.select({ status: samplesTable.status }).from(samplesTable).where(eq(samplesTable.orderId, ref.careOrderId)),
      db.select({ status: radiologyStudiesTable.status }).from(radiologyStudiesTable).where(eq(radiologyStudiesTable.orderId, ref.careOrderId)),
      db.select().from(diagnosticReferralItemsTable).where(eq(diagnosticReferralItemsTable.referralId, ref.id)),
    ]);
    if (samples.length === 0 && studies.length === 0) continue;

    const m = deriveMilestone(samples.map((s) => s.status), studies.map((s) => s.status));
    if (!m.headerTarget) continue;

    await db.transaction(async (tx) => {
      // ── Emit HOPE-facing status events (idempotent: once per referral/type) ──
      if (m.sampleCollected) {
        const ev = await enqueueOutboxEvent(tx, {
          eventType: "diagnostic_sample.collected",
          idempotencyKey: `diagnostic_sample.collected:${ref.referralUuid}`,
          correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
          payload: { referralUuid: ref.referralUuid, careOrderId: ref.careOrderId, status: "SAMPLE_COLLECTED" },
        });
        if (ev) sampleEvents++;
      }
      if (m.studyPerformed) {
        const ev = await enqueueOutboxEvent(tx, {
          eventType: "diagnostic_study.completed",
          idempotencyKey: `diagnostic_study.completed:${ref.referralUuid}`,
          correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
          payload: { referralUuid: ref.referralUuid, careOrderId: ref.careOrderId, status: "STUDY_PERFORMED" },
        });
        if (ev) studyEvents++;
      }

      // ── Advance each accepted item's status by modality ─────────────────────
      for (const it of items) {
        if (!["accepted", "billed"].includes(it.itemStatus)) continue;
        const mod = classifyModality(it.department, it.modality);
        const next = mod === "pathology"
          ? (m.sampleCollected ? "sample_collected" : null)
          : (m.studyPerformed ? "in_progress" : m.studyScheduled ? "study_scheduled" : null);
        if (next) await tx.update(diagnosticReferralItemsTable).set({ itemStatus: next }).where(eq(diagnosticReferralItemsTable.id, it.id));
      }

      // ── Advance the referral header forward-only, via a legal path ───────────
      if (isReferralStatus(ref.status)) {
        const cur = ref.status as ReferralStatus;
        const curRank = RANK[cur] ?? -1;
        const tgtRank = RANK[m.headerTarget!] ?? -1;
        if (tgtRank > curRank) {
          const path = shortestPath(cur, m.headerTarget!);
          if (path && path.length > 0) {
            let from = cur;
            for (const step of path) {
              try { assertTransition(from, step); } catch { break; }
              await tx.update(diagnosticReferralsTable).set({ status: step }).where(eq(diagnosticReferralsTable.id, ref.id));
              from = step;
            }
            await writeReferralEvent(tx, { referralId: ref.id, eventType: "status.advanced", fromStatus: cur, toStatus: from, actorType: "system", organisation: "CARE" });
            await enqueueOutboxEvent(tx, {
              eventType: "diagnostic_order.item_status_changed",
              idempotencyKey: `diagnostic_order.item_status_changed:${ref.referralUuid}:${from}`,
              correlationId: ref.referralUuid, aggregateId: ref.referralUuid, partnerId: ref.createdByPartnerId ?? null,
              payload: { referralUuid: ref.referralUuid, careOrderId: ref.careOrderId, status: from },
            });
          }
        }
      }
    });
  }
  return { scanned: refs.length, sampleEvents, studyEvents };
}
