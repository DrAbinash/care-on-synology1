// Relative (not the usual "@/lib/..." alias) so this module — including its
// pure, DOM-free functions below — stays importable under the repo's root
// vitest config, which has no "@/" alias resolution configured.
import { api } from "./fetchApi";
import type { ProvisionalBillPrintSnapshot } from "./provisionalBillReceipt";

/**
 * offlineBillingQueue.ts — durable local queue for bills that couldn't reach
 * the NAS (LAN drop, NAS reboot, switch failure — anything longer than the
 * few automatic retries fetchApi.ts already does for short blips).
 *
 * A queued entry replays through the exact same /api/orders and /api/bills
 * endpoints a normal online bill uses, carrying the same clientRef the
 * billing desk already generates — those two routes already dedupe on
 * clientRef specifically so a retried request is safe (see bills.ts/
 * orders.ts). Deliberately NOT routed through routes/sync.ts's generic
 * push/applyChangeToCloud engine: reimplementing bill creation (VIP
 * surcharge, token allocation, Form-F fields, discount rules...) generically
 * would duplicate a lot of delicate, already-idempotent business logic for
 * no benefit.
 *
 * Replay is strictly FIFO (oldest queuedAt first) and stops at the first
 * failure rather than skipping ahead: test_tokens.ts assigns token numbers
 * sequentially per department at creation time, so replaying out of order
 * would hand a later-arriving walk-in a lower token number than someone who
 * was actually served first during the outage.
 */

export type QueuedBillStage = "order" | "bill";

export type QueuedBill = {
  clientRef: string;
  queuedAt: string;
  /** Shown on provisional receipt until sync assigns a real bill number. */
  provisionalBillNumber?: string;
  stage: QueuedBillStage; // "order": nothing created yet. "bill": order already exists, only the bill remains.
  orderBody: Record<string, unknown>;
  billBody: Record<string, unknown>;
  orderId?: number;
  orderNumber?: string;
  attempts: number;
  lastError?: string | null;
};

export class QueuedForSyncError extends Error {
  readonly snapshot: ProvisionalBillPrintSnapshot;

  constructor(snapshot: ProvisionalBillPrintSnapshot) {
    super("No connection — bill saved locally and will sync automatically.");
    this.name = "QueuedForSyncError";
    this.snapshot = snapshot;
  }
}

// ─── Pure queue operations (unit-tested directly) ──────────────────────────

export function appendToQueue(queue: QueuedBill[], entry: QueuedBill): QueuedBill[] {
  return [...queue, entry];
}

export function removeFromQueue(queue: QueuedBill[], clientRef: string): QueuedBill[] {
  return queue.filter((q) => q.clientRef !== clientRef);
}

export function updateInQueue(queue: QueuedBill[], clientRef: string, patch: Partial<QueuedBill>): QueuedBill[] {
  return queue.map((q) => (q.clientRef === clientRef ? { ...q, ...patch } : q));
}

export function sortQueueForReplay(queue: QueuedBill[]): QueuedBill[] {
  return [...queue].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

// Generic enough for both api.post's real signature and a test double.
export type PostFn = <T>(path: string, body: unknown) => Promise<T>;

// Pure aside from the injected postFn — no localStorage/DOM access, so this
// is where all the real replay logic lives and gets tested.
export async function replayQueue(
  queue: QueuedBill[],
  postFn: PostFn,
): Promise<{ queue: QueuedBill[]; synced: number }> {
  const replayOrder = sortQueueForReplay(queue).map((entry) => entry.clientRef);
  let working = sortQueueForReplay(queue);
  let synced = 0;

  for (const clientRef of replayOrder) {
    const current = working.find((q) => q.clientRef === clientRef);
    if (!current) continue; // removed by an earlier iteration — shouldn't happen, but keep the loop honest.

    try {
      let orderId = current.orderId;
      let orderNumber = current.orderNumber;

      if (current.stage === "order") {
        const order = await postFn<{ id: number; orderNumber: string }>("/api/orders", {
          ...current.orderBody,
          clientRef: current.clientRef,
        });
        orderId = order.id;
        orderNumber = order.orderNumber;
        working = updateInQueue(working, current.clientRef, { stage: "bill", orderId, orderNumber });
      }

      await postFn("/api/bills", { ...current.billBody, orderId, clientRef: current.clientRef });
      working = removeFromQueue(working, current.clientRef);
      synced++;
    } catch (err) {
      working = updateInQueue(working, current.clientRef, {
        attempts: current.attempts + 1,
        lastError: err instanceof Error ? err.message : "Sync failed",
      });
      break; // Stop here — the outage likely isn't over; preserve FIFO order for the next attempt.
    }
  }

  return { queue: working, synced };
}

// ─── Impure localStorage-backed wrapper (used by the real app) ────────────

export const OFFLINE_BILL_QUEUE_KEY = "erp_offline_bill_queue";

function readQueue(): QueuedBill[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_BILL_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedBill[]): void {
  try {
    const serialized = JSON.stringify(queue);
    window.localStorage.setItem(OFFLINE_BILL_QUEUE_KEY, serialized);
    // Real "storage" events never fire in the tab that made the change —
    // dispatch one manually so this same tab's useSyncStatus() also updates
    // immediately instead of waiting for its next poll.
    window.dispatchEvent(new StorageEvent("storage", { key: OFFLINE_BILL_QUEUE_KEY, newValue: serialized }));
  } catch {
    /* quota exceeded or private mode — the bill still printed/queued in memory for this session */
  }
}

export function enqueueBill(opts: {
  clientRef: string;
  orderBody: Record<string, unknown>;
  billBody: Record<string, unknown>;
  stage?: QueuedBillStage;
  orderId?: number;
  orderNumber?: string;
  provisionalBillNumber?: string;
}): QueuedBill {
  const entry: QueuedBill = {
    clientRef: opts.clientRef,
    queuedAt: new Date().toISOString(),
    provisionalBillNumber: opts.provisionalBillNumber,
    stage: opts.stage ?? "order",
    orderBody: opts.orderBody,
    billBody: opts.billBody,
    orderId: opts.orderId,
    orderNumber: opts.orderNumber,
    attempts: 0,
    lastError: null,
  };
  writeQueue(appendToQueue(readQueue(), entry));
  return entry;
}

export function getQueuedBills(): QueuedBill[] {
  return sortQueueForReplay(readQueue());
}

// Manual escape hatch for an entry that can never succeed (e.g. the patient
// or test it references was deleted during the outage) — without this, one
// permanently-broken entry would block every bill queued after it forever,
// since replay stops at the first failure to preserve ordering.
export function discardQueuedBill(clientRef: string): void {
  writeQueue(removeFromQueue(readQueue(), clientRef));
}

let flushInFlight = false;

export async function flushQueuedBills(): Promise<{ synced: number; remaining: number; lastError: string | null }> {
  if (flushInFlight) return { synced: 0, remaining: readQueue().length, lastError: null };
  flushInFlight = true;
  try {
    const before = readQueue();
    if (before.length === 0) return { synced: 0, remaining: 0, lastError: null };
    const { queue: after, synced } = await replayQueue(before, api.post);
    writeQueue(after);
    return { synced, remaining: after.length, lastError: after[0]?.lastError ?? null };
  } finally {
    flushInFlight = false;
  }
}
