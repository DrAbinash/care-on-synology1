// ============================================================================
// Referral state machine. The brief requires a validated state machine that
// does NOT permit impossible transitions. Pure logic — unit-tested.
// ============================================================================
// Import the status constant from the pure schema subpath (no DB client), so
// this pure state-machine module stays free of any database dependency.
import { REFERRAL_STATUSES, type ReferralStatus } from "@workspace/db/schema";

// Allowed header transitions. Anything not listed is rejected.
const TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  PRESCRIBED: ["OFFERED_TO_CARE", "SENT_TO_CARE", "RECEIVED_BY_CARE", "CANCELLED", "EXPIRED"],
  OFFERED_TO_CARE: ["SENT_TO_CARE", "RECEIVED_BY_CARE", "PATIENT_DECLINED", "CANCELLED", "EXPIRED"],
  SENT_TO_CARE: ["RECEIVED_BY_CARE", "CANCELLED", "EXPIRED"],
  RECEIVED_BY_CARE: [
    "PATIENT_CONTACTED", "PATIENT_ACCEPTED", "PATIENT_DECLINED",
    "CARE_ORDER_CREATED", "PARTIALLY_BOOKED", "CANCELLED", "EXPIRED",
  ],
  PATIENT_CONTACTED: ["PATIENT_ACCEPTED", "PATIENT_DECLINED", "CARE_ORDER_CREATED", "CANCELLED", "EXPIRED"],
  PATIENT_ACCEPTED: ["CARE_ORDER_CREATED", "PARTIALLY_BOOKED", "CANCELLED"],
  // Real life: a patient who declined can change their mind before anything is billed.
  PATIENT_DECLINED: ["PATIENT_CONTACTED", "PATIENT_ACCEPTED", "CANCELLED", "EXPIRED"],
  CARE_ORDER_CREATED: ["PARTIALLY_BOOKED", "BILLED", "SAMPLE_COLLECTED", "STUDY_SCHEDULED", "CANCELLED"],
  PARTIALLY_BOOKED: ["CARE_ORDER_CREATED", "BILLED", "CANCELLED"],
  BILLED: ["PAID", "SAMPLE_COLLECTED", "STUDY_SCHEDULED", "IN_PROGRESS", "PARTIALLY_BOOKED", "CANCELLED"],
  PAID: ["SAMPLE_COLLECTED", "STUDY_SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  SAMPLE_COLLECTED: ["IN_PROGRESS", "COMPLETED", "REPORTED", "STUDY_SCHEDULED", "CANCELLED"],
  STUDY_SCHEDULED: ["IN_PROGRESS", "COMPLETED", "REPORTED", "SAMPLE_COLLECTED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "REPORTED", "CANCELLED"],
  COMPLETED: ["REPORTED", "DELIVERED"],
  REPORTED: ["DELIVERED", "COMPLETED"], // COMPLETED again = amendment in progress
  DELIVERED: ["REPORTED"], // amended report re-opens reporting
  CANCELLED: [],
  EXPIRED: [],
};

export const TERMINAL_STATUSES: ReadonlySet<ReferralStatus> = new Set(["CANCELLED", "EXPIRED"]);

export function isReferralStatus(s: string): s is ReferralStatus {
  return (REFERRAL_STATUSES as readonly string[]).includes(s);
}

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  if (from === to) return true; // idempotent no-op is always allowed
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Throws a descriptive Error if the transition is not permitted. */
export function assertTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!isReferralStatus(from)) throw new Error(`Unknown current referral status: ${from}`);
  if (!isReferralStatus(to)) throw new Error(`Unknown target referral status: ${to}`);
  if (!canTransition(from, to)) {
    throw new Error(`Illegal referral transition ${from} → ${to}`);
  }
}

export function nextStates(from: ReferralStatus): ReferralStatus[] {
  return TRANSITIONS[from] ?? [];
}

/**
 * Shortest legal path of transitions from `from` to `to` (BFS over the
 * transition graph), inclusive of `to`, or null if unreachable. Used by the
 * Phase-2 status reconciler to advance a referral through intermediate states
 * (e.g. CARE_ORDER_CREATED → SAMPLE_COLLECTED → IN_PROGRESS → REPORTED) without
 * ever taking an illegal jump. Returns [] when already at the target.
 */
export function shortestPath(from: ReferralStatus, to: ReferralStatus): ReferralStatus[] | null {
  if (from === to) return [];
  const queue: ReferralStatus[][] = [[from]];
  const seen = new Set<ReferralStatus>([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    for (const next of TRANSITIONS[last] ?? []) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === to) return extended.slice(1); // drop `from`
      seen.add(next);
      queue.push(extended);
    }
  }
  return null;
}

// ── Per-item status machine (looser; tracks the individual test journey) ─────
export const ITEM_STATUSES = [
  "prescribed", "mapped", "unmapped", "accepted", "declined", "unavailable",
  "added", "changed", "billed", "sample_collected", "study_scheduled",
  "in_progress", "completed", "reported", "delivered", "cancelled",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

const ITEM_TERMINAL: ReadonlySet<ItemStatus> = new Set(["declined", "unavailable", "cancelled", "delivered"]);

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  prescribed: ["mapped", "unmapped", "accepted", "declined", "unavailable", "cancelled"],
  mapped: ["accepted", "declined", "unavailable", "changed", "cancelled"],
  unmapped: ["mapped", "accepted", "declined", "unavailable", "cancelled"],
  accepted: ["billed", "changed", "declined", "unavailable", "cancelled", "sample_collected", "study_scheduled"],
  changed: ["accepted", "billed", "declined", "cancelled"],
  added: ["accepted", "billed", "cancelled"],
  declined: [],
  unavailable: ["mapped", "accepted"], // becomes available later
  billed: ["sample_collected", "study_scheduled", "in_progress", "cancelled"],
  sample_collected: ["in_progress", "completed", "cancelled"],
  study_scheduled: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "reported", "cancelled"],
  completed: ["reported", "delivered"],
  reported: ["delivered", "completed"],
  delivered: ["reported"],
  cancelled: [],
};

export function isItemStatus(s: string): s is ItemStatus {
  return (ITEM_STATUSES as readonly string[]).includes(s);
}

export function canItemTransition(from: ItemStatus, to: ItemStatus): boolean {
  if (from === to) return true;
  return (ITEM_TRANSITIONS[from] ?? []).includes(to);
}

export function isItemTerminal(s: ItemStatus): boolean {
  return ITEM_TERMINAL.has(s);
}
