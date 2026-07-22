import {
  diagnosticReferralEventsTable,
  externalPatientLinkEventsTable,
} from "@workspace/db";
import type { Executor } from "./db";

export interface ReferralEventInput {
  referralId: number;
  itemId?: number | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorType?: "partner" | "staff" | "system";
  actorId?: string | null;
  actorName?: string | null;
  organisation?: string | null;
  reason?: string | null;
  payload?: unknown;
}

/**
 * Append a referral audit event. Best-effort: audit logging must never crash
 * the workflow (matches the codebase's existing best-effort audit pattern),
 * but inside a transaction the caller passes the tx so the event commits
 * atomically with the state change.
 */
export async function writeReferralEvent(exec: Executor, e: ReferralEventInput): Promise<void> {
  try {
    await exec.insert(diagnosticReferralEventsTable).values({
      referralId: e.referralId,
      itemId: e.itemId ?? null,
      eventType: e.eventType,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorType: e.actorType ?? "system",
      actorId: e.actorId ?? null,
      actorName: e.actorName ?? null,
      organisation: e.organisation ?? "CARE",
      reason: e.reason ?? null,
      payload: (e.payload ?? null) as never,
    });
  } catch (err) {
    console.error("[integration] writeReferralEvent failed:", (err as Error)?.message);
  }
}

export interface LinkEventInput {
  linkId?: number | null;
  sourceSystem: string;
  sourcePatientId: string;
  carePatientId?: number | null;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  reason?: string | null;
  metadata?: unknown;
}

/** Append a patient-link audit event (link/unlink/merge/confirm/conflict). */
export async function writeLinkEvent(exec: Executor, e: LinkEventInput): Promise<void> {
  try {
    await exec.insert(externalPatientLinkEventsTable).values({
      linkId: e.linkId ?? null,
      sourceSystem: e.sourceSystem,
      sourcePatientId: e.sourcePatientId,
      carePatientId: e.carePatientId ?? null,
      eventType: e.eventType,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actor: e.actor ?? null,
      reason: e.reason ?? null,
      metadata: e.metadata != null ? JSON.stringify(e.metadata) : null,
    });
  } catch (err) {
    console.error("[integration] writeLinkEvent failed:", (err as Error)?.message);
  }
}
