// Relative (not the usual "@/lib/..." alias) so this module — including its
// pure, DOM-free functions below — stays importable under the repo's root
// vitest config, which has no "@/" alias resolution configured.
import { api, isAuthHttpError } from "./fetchApi";
import type { ProvisionalBillPrintSnapshot } from "./provisionalBillReceipt";

export type SyncedBillResult = {
  clientRef: string;
  billId: number;
  billNumber: string;
  provisionalBillNumber?: string;
  orderNumber?: string;
};

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

/**
 * What the desk would tell the ledger about this bill, had it reached it.
 * Carried separately from `orderBody`/`billBody` because those hold the request
 * the server computes totals FROM, not the totals themselves — the grand total
 * lives in the desk's React state (subtotal − discount + VIP surcharge), so
 * deriving it from the bodies would produce a different number than the one
 * printed on the receipt.
 *
 * Only ever read by the witness announcement. Absent on entries queued by an
 * older build, which announce with what can be derived and no invented amount.
 */
export type QueuedBillWitness = {
  patientId?: number;
  testCount?: number;
  totalAmount?: number;
};

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
  /** Optional snapshot for reprinting the provisional receipt from the sync panel. */
  printSnapshot?: ProvisionalBillPrintSnapshot;
  witness?: QueuedBillWitness;
};

export class QueuedForSyncError extends Error {
  readonly snapshot: ProvisionalBillPrintSnapshot;

  constructor(snapshot: ProvisionalBillPrintSnapshot) {
    super("No connection — bill saved locally and will sync automatically.");
    this.name = "QueuedForSyncError";
    this.snapshot = snapshot;
  }
}

/**
 * The save failed AND the queue write failed, so nothing will ever replay this
 * bill. There is no safe print here: a provisional receipt over an unwritable
 * queue is paper the clinic cannot recover by any route except the patient's
 * copy. The desk must stop, and say why.
 *
 * This is deliberately NOT a QueuedForSyncError. That class is what tells
 * BillingDesk "the bill is safe locally, print it" — reusing it here would make
 * the worst of the two states look like the mildest.
 */
export class BillNotQueuedError extends Error {
  constructor() {
    super(
      "Could not reach the server AND this browser could not store the bill for retry " +
        "(its local storage is full or switched off). Nothing was queued, so nothing will sync. " +
        "Check this PC, then bill the patient again.",
    );
    this.name = "BillNotQueuedError";
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
): Promise<{
  queue: QueuedBill[];
  synced: number;
  syncedBills: SyncedBillResult[];
  authFailed: boolean;
}> {
  const replayOrder = sortQueueForReplay(queue).map((entry) => entry.clientRef);
  let working = sortQueueForReplay(queue);
  let synced = 0;
  const syncedBills: SyncedBillResult[] = [];

  for (const clientRef of replayOrder) {
    const current = working.find((q) => q.clientRef === clientRef);
    if (!current) continue; // removed by an earlier iteration — shouldn't happen, but keep the loop honest.

    try {
      let orderId = current.orderId;
      let orderNumber = current.orderNumber;

      if (current.stage === "order") {
        // Prefer one-shot save; fall back to legacy two-POST if the NAS is
        // on a build that does not yet expose /api/billing/save.
        try {
          const billRes = await postFn<{ id: number; billNumber: string; orderId?: number; orderNumber?: string }>(
            "/api/billing/save",
            {
              ...current.orderBody,
              ...current.billBody,
              clientRef: current.clientRef,
            },
          );
          syncedBills.push({
            clientRef: current.clientRef,
            billId: billRes.id,
            billNumber: billRes.billNumber,
            provisionalBillNumber: current.provisionalBillNumber,
            orderNumber: billRes.orderNumber ?? current.orderNumber,
          });
          working = removeFromQueue(working, current.clientRef);
          synced++;
          continue;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/404|Cannot POST|not found/i.test(msg)) throw err;
          // Legacy NAS: create order then bill separately.
        }

        const order = await postFn<{ id: number; orderNumber: string }>("/api/orders", {
          ...current.orderBody,
          clientRef: current.clientRef,
        });
        orderId = order.id;
        orderNumber = order.orderNumber;
        working = updateInQueue(working, current.clientRef, { stage: "bill", orderId, orderNumber });
      }

      const billRes = await postFn<{ id: number; billNumber: string }>("/api/bills?fast=1", {
        ...current.billBody,
        orderId,
        clientRef: current.clientRef,
      });
      syncedBills.push({
        clientRef: current.clientRef,
        billId: billRes.id,
        billNumber: billRes.billNumber,
        provisionalBillNumber: current.provisionalBillNumber,
        orderNumber,
      });
      working = removeFromQueue(working, current.clientRef);
      synced++;
    } catch (err) {
      working = updateInQueue(working, current.clientRef, {
        attempts: current.attempts + 1,
        lastError: err instanceof Error ? err.message : "Sync failed",
      });
      // Stop here — the outage likely isn't over; preserve FIFO order for the next attempt.
      // Auth failures are surfaced so the sync hook can pause instead of treating the API as down.
      return {
        queue: working,
        synced,
        syncedBills,
        authFailed: isAuthHttpError(err),
      };
    }
  }

  return { queue: working, synced, syncedBills, authFailed: false };
}

// ─── Impure localStorage-backed wrapper (used by the real app) ────────────

export const OFFLINE_BILL_QUEUE_KEY = "erp_offline_bill_queue";

/**
 * Prefix for a blob that parsed as garbage. `readQueue` used to answer `[]` and
 * the next `writeQueue` then overwrote the unreadable text with the new (empty)
 * queue, so an outage's worth of bills vanished with no trace at all — not even
 * a corrupt file to hand to someone who could read it. Quarantining keeps the
 * bytes.
 */
export const QUARANTINED_QUEUE_PREFIX = "erp_offline_bill_queue.corrupt-";

function quarantineCorruptBlob(raw: string | null): void {
  if (!raw) return;
  try {
    window.localStorage.setItem(`${QUARANTINED_QUEUE_PREFIX}${new Date().toISOString()}`, raw);
    // Removing it is what makes this happen ONCE. Left in place, every 5-second
    // sync tick would append another copy until the quota filled up.
    window.localStorage.removeItem(OFFLINE_BILL_QUEUE_KEY);
  } catch {
    /* Nothing further is possible — the text was already unreadable by us. */
  }
}

function readQueue(): QueuedBill[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(OFFLINE_BILL_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as QueuedBill[];
  } catch {
    /* fall through: this blob is not a queue, and overwriting it would lose it */
  }
  quarantineCorruptBlob(raw);
  return [];
}

/**
 * False means the queue is NOT durable. The old version swallowed this failure
 * and its comment claimed the bill was "still printed/queued in memory for this
 * session" — there is no in-memory queue, so that sentence described a
 * protection that does not exist, and the caller had no way to find out.
 */
function writeQueue(queue: QueuedBill[]): boolean {
  try {
    const serialized = JSON.stringify(queue);
    window.localStorage.setItem(OFFLINE_BILL_QUEUE_KEY, serialized);
    // Real "storage" events never fire in the tab that made the change —
    // dispatch one manually so this same tab's useSyncStatus() also updates
    // immediately instead of waiting for its next poll.
    window.dispatchEvent(new StorageEvent("storage", { key: OFFLINE_BILL_QUEUE_KEY, newValue: serialized }));
    return true;
  } catch {
    /* quota exceeded, private mode, or storage disabled for this origin */
    return false;
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
  printSnapshot?: ProvisionalBillPrintSnapshot;
  witness?: QueuedBillWitness;
}): QueuedBill & { stored: boolean } {
  const entry: QueuedBill = {
    clientRef: opts.clientRef,
    queuedAt: new Date().toISOString(),
    provisionalBillNumber: opts.provisionalBillNumber,
    printSnapshot: opts.printSnapshot,
    witness: opts.witness,
    stage: opts.stage ?? "order",
    orderBody: opts.orderBody,
    billBody: opts.billBody,
    orderId: opts.orderId,
    orderNumber: opts.orderNumber,
    attempts: 0,
    lastError: null,
  };
  const stored = writeQueue(appendToQueue(readQueue(), entry));
  return { ...entry, stored };
}

export function getQueuedBills(): QueuedBill[] {
  return sortQueueForReplay(readQueue());
}

// Manual escape hatch for an entry that can never succeed (e.g. the patient
// or test it references was deleted during the outage) — without this, one
// permanently-broken entry would block every bill queued after it forever,
// since replay stops at the first failure to preserve ordering.
export function discardQueuedBill(clientRef: string): void {
  const rest = removeFromQueue(readQueue(), clientRef);
  writeQueue(rest);
  // Withdraw the witness too, or the Daily Summary keeps alarming on a bill the
  // desk has deliberately thrown away. It has to name the discarded clientRef
  // itself — that entry is no longer in `rest`, so announcing the remaining
  // queue would leave the withdrawn one open forever. Fire-and-forget: the desk
  // just clicked Discard and must not wait on the network for it.
  void announceWithdrawnBills([clientRef]);
}

import { dispatchOfflineBillsSynced } from "./offlineBillingSync";

// ─── Witness announcement ──────────────────────────────────────────────────

const DESK_BILL_ANNOUNCE_PATH = "/api/desk-bills/announcements";

/**
 * One row of the announcement manifest. Shape matches the server's
 * `coerceAnnouncement`, which re-checks every field — this is a report about
 * the desk's own memory, so nothing here is trusted downstream.
 */
export type DeskBillAnnouncementItem = {
  clientRef: string;
  state: "pending" | "withdrawn";
  provisionalBillNumber: string | null;
  patientId: number | null;
  testCount: number;
  totalAmount: number;
  workstation: string | null;
  lastError: string | null;
};

function numberOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The manifest for a queue, as pure data so it is testable without a browser.
 *
 * Fields fall back to what the queued request bodies actually contain, and a
 * field with no honest source stays null rather than being inferred. `totalAmount`
 * is the weakest of them — it only exists for entries queued by a build that
 * passed `witness`, because the bill total is computed server-side and the
 * desk's own copy of it lives in React state, not in the replay payload.
 */
export function deskAnnouncementManifest(
  queue: QueuedBill[],
  workstation: string | null,
): DeskBillAnnouncementItem[] {
  return sortQueueForReplay(queue).map((entry) => {
    const tests = Array.isArray(entry.orderBody?.tests)
      ? entry.orderBody.tests.length
      : Array.isArray(entry.orderBody?.testIds)
        ? entry.orderBody.testIds.length
        : 0;
    return {
      clientRef: entry.clientRef,
      state: "pending" as const,
      provisionalBillNumber: entry.provisionalBillNumber ?? null,
      patientId: numberOf(entry.witness?.patientId) ?? numberOf(entry.orderBody?.patientId),
      testCount: numberOf(entry.witness?.testCount) ?? tests,
      totalAmount: numberOf(entry.witness?.totalAmount) ?? 0,
      workstation,
      lastError: entry.lastError ?? null,
    };
  });
}

/**
 * The desk's own machine name, which is how the Daily Summary alarm says which
 * PC to walk to. The ERP has no per-browser identity; hostname is the same
 * surrogate the radiology study locks use.
 */
function workstationName(): string {
  try {
    return window.location.hostname;
  } catch {
    return "";
  }
}

async function postAnnouncement(
  items: DeskBillAnnouncementItem[],
  postFn: PostFn,
): Promise<void> {
  if (items.length === 0) return;
  const workstation = workstationName() || null;
  try {
    await postFn(DESK_BILL_ANNOUNCE_PATH, { workstation, items });
  } catch {
    /* Telemetry must never break the workflow: an announcement that did not get
       through leaves the clinic in the pre-feature state, not in a worse one.
       The next sync tick retries, and the replay after this is the part that
       actually matters to the patient standing at the counter. */
  }
}

/**
 * Tell the server what this browser is holding, BEFORE trying to deliver it.
 *
 * The order matters. A queue that never replays — profile cleared, PC reimaged,
 * one poisoned entry stalling the FIFO behind it — is exactly the case this
 * exists for, and announcing after the replay would mean it is only ever
 * recorded on a tick that already failed.
 *
 * Delivery is never claimed here. The server closes a witness by finding a
 * non-cancelled bill with the same clientRef, so this call can only ever ADD an
 * alarm, never dismiss one.
 */
export async function announceQueuedBills(queue: QueuedBill[], postFn: PostFn = api.post): Promise<void> {
  await postAnnouncement(deskAnnouncementManifest(queue, workstationName() || null), postFn);
}

/**
 * The other direction: a bill the desk has thrown away, so its witness stops.
 * Only the clientRef is needed — a withdrawn row asserts nothing about amounts,
 * and the server ignores every other field once state is withdrawn.
 */
export async function announceWithdrawnBills(clientRefs: string[], postFn: PostFn = api.post): Promise<void> {
  await postAnnouncement(
    clientRefs.map((clientRef) => ({
      clientRef,
      state: "withdrawn" as const,
      provisionalBillNumber: null,
      patientId: null,
      testCount: 0,
      totalAmount: 0,
      // null so the envelope's workstation wins — this browser is the one
      // saying it, whoever the row was originally announced by.
      workstation: null,
      lastError: null,
    })),
    postFn,
  );
}

let flushInFlight = false;

export async function flushQueuedBills(
  postFn: PostFn = api.post,
): Promise<{
  synced: number;
  remaining: number;
  lastError: string | null;
  syncedBills: SyncedBillResult[];
  authFailed: boolean;
}> {
  if (flushInFlight) {
    return {
      synced: 0,
      remaining: readQueue().length,
      lastError: null,
      syncedBills: [],
      authFailed: false,
    };
  }
  flushInFlight = true;
  try {
    const before = readQueue();
    if (before.length === 0) {
      return { synced: 0, remaining: 0, lastError: null, syncedBills: [], authFailed: false };
    }
    // Awaited, and deliberately ahead of the replay: this is the only record
    // these bills will ever have if the replay is the one that fails.
    await announceQueuedBills(before, postFn);
    const { queue: after, synced, syncedBills, authFailed } = await replayQueue(before, postFn);
    writeQueue(after);
    if (syncedBills.length > 0) dispatchOfflineBillsSynced(syncedBills);
    return {
      synced,
      remaining: after.length,
      lastError: after[0]?.lastError ?? null,
      syncedBills,
      authFailed,
    };
  } finally {
    flushInFlight = false;
  }
}
