/**
 * offlineOutbox.ts — durable client-side outbox for offline-first billing.
 *
 * The ERP talks to a LAN NAS server. When the network blips (or the NAS is
 * momentarily down) a bill/order POST fails. `fetchApi` already retries a few
 * times, but a longer outage would lose the counter's work. This outbox closes
 * that gap: a failed idempotent mutation is persisted locally and replayed in
 * order when connectivity returns.
 *
 * Safety rests on the server's clientRef idempotency (see the comments on
 * orders.clientRef / bills.clientRef): every queued mutation carries a stable
 * clientRef, so replaying one that actually did reach the server returns the
 * existing record instead of creating a duplicate. Bills are never lost and
 * never doubled.
 *
 * The core (buildEntry / enqueue / replayOutbox / submitWithOutbox) is pure and
 * storage-agnostic — unit-tested with an in-memory store. The IndexedDB adapter
 * at the bottom is the browser storage; it only touches `indexedDB` lazily so
 * importing this module under Node (for tests) is side-effect-free.
 */
import { isTransientError } from "./reliability";

export type OutboxMethod = "POST" | "PUT" | "PATCH";
export type OutboxStatus = "pending" | "failed";

export interface OutboxEntry {
  /** clientRef — the idempotency key AND the store key. */
  id: string;
  endpoint: string;        // e.g. "/api/bills"
  method: OutboxMethod;
  payload: unknown;        // request body, with clientRef embedded
  label: string;           // human label, e.g. "Bill • Asha Rao • ₹300"
  createdAt: number;       // epoch ms — FIFO replay order
  attempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
  status: OutboxStatus;    // "failed" = permanent (4xx); needs manual attention
}

/** Async persistence contract. Order-independent; the core sorts by createdAt. */
export interface OutboxStore {
  put(entry: OutboxEntry): Promise<void>;
  getAll(): Promise<OutboxEntry[]>;
  delete(id: string): Promise<void>;
}

type Now = () => number;
type NewRef = () => string;

const defaultNow: Now = () => Date.now();
const defaultNewRef: NewRef = () => {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return `cr_${g.randomUUID()}`;
  return `cr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

/** Ensure a payload object carries a clientRef; returns [body, clientRef]. */
export function withClientRef(payload: unknown, newRef: NewRef = defaultNewRef): { body: Record<string, unknown>; clientRef: string } {
  const obj: Record<string, unknown> = (payload && typeof payload === "object") ? { ...(payload as Record<string, unknown>) } : { value: payload };
  const existing = typeof obj.clientRef === "string" && obj.clientRef ? obj.clientRef : null;
  const clientRef = existing ?? newRef();
  obj.clientRef = clientRef;
  return { body: obj, clientRef };
}

export function buildEntry(params: {
  endpoint: string;
  method?: OutboxMethod;
  payload: unknown;
  label: string;
  clientRef?: string;
  now?: Now;
  newRef?: NewRef;
}): OutboxEntry {
  const now = params.now ?? defaultNow;
  const { body, clientRef } = withClientRef(
    params.clientRef ? { ...(params.payload as Record<string, unknown>), clientRef: params.clientRef } : params.payload,
    params.newRef ?? defaultNewRef,
  );
  return {
    id: clientRef,
    endpoint: params.endpoint,
    method: params.method ?? "POST",
    payload: body,
    label: params.label,
    createdAt: now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    status: "pending",
  };
}

export async function enqueue(store: OutboxStore, entry: OutboxEntry): Promise<void> {
  await store.put(entry);
}

/** Pending entries in FIFO (createdAt) order. */
export async function pendingEntries(store: OutboxStore): Promise<OutboxEntry[]> {
  const all = await store.getAll();
  return all.filter((e) => e.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
}

export async function countPending(store: OutboxStore): Promise<number> {
  return (await store.getAll()).filter((e) => e.status === "pending").length;
}

/** Sends one entry to the server. Throws on failure (message drives classify). */
export type OutboxSender = (entry: OutboxEntry) => Promise<void>;

export interface ReplayResult {
  synced: number;
  failedPermanent: number;
  remaining: number;      // still pending after this pass
  stoppedTransient: boolean; // stopped because the network appears down
}

export interface ReplayOptions {
  classify?: (err: unknown) => boolean; // true = transient (default: isTransientError)
  now?: Now;
  /** Safety cap on entries processed in one pass (default 500). */
  max?: number;
}

/**
 * Replay pending entries FIFO. On success the entry is removed. A **transient**
 * failure stops the pass and leaves the rest queued (the network is down — the
 * others would fail too, and order must be preserved). A **permanent** (4xx)
 * failure marks that one entry `failed` and continues, so one bad bill can't
 * block every good one behind it.
 */
export async function replayOutbox(store: OutboxStore, send: OutboxSender, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const classify = opts.classify ?? isTransientError;
  const now = opts.now ?? defaultNow;
  const max = opts.max ?? 500;
  const entries = (await pendingEntries(store)).slice(0, max);

  let synced = 0;
  let failedPermanent = 0;
  let stoppedTransient = false;

  for (const e of entries) {
    try {
      await send(e);
      await store.delete(e.id);
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
      if (classify(err)) {
        await store.put({ ...e, attempts: e.attempts + 1, lastAttemptAt: now(), lastError: msg });
        stoppedTransient = true;
        break;
      }
      await store.put({ ...e, status: "failed", attempts: e.attempts + 1, lastAttemptAt: now(), lastError: msg });
      failedPermanent++;
    }
  }

  const remaining = await countPending(store);
  return { synced, failedPermanent, remaining, stoppedTransient };
}

export interface SubmitResult<T> {
  status: "sent" | "queued";
  data?: T;              // present when status === "sent"
  entry?: OutboxEntry;   // present when status === "queued"
  clientRef: string;
}

/**
 * Submit an idempotent mutation, falling back to the outbox when offline.
 *
 * Attempts the network once via `send`. On success → { status: "sent" }. On a
 * **transient** failure the mutation is queued for replay → { status: "queued" }
 * (the caller shows "saved — will sync"). A **permanent** failure (validation,
 * auth) is re-thrown so the caller surfaces it exactly as today. `send` receives
 * the body with a guaranteed clientRef so the eventual replay is idempotent.
 */
export async function submitWithOutbox<T>(params: {
  store: OutboxStore;
  endpoint: string;
  method?: OutboxMethod;
  payload: unknown;
  label: string;
  send: (endpoint: string, method: OutboxMethod, body: Record<string, unknown>) => Promise<T>;
  classify?: (err: unknown) => boolean;
  now?: Now;
  newRef?: NewRef;
}): Promise<SubmitResult<T>> {
  const classify = params.classify ?? isTransientError;
  const method = params.method ?? "POST";
  const { body, clientRef } = withClientRef(params.payload, params.newRef ?? defaultNewRef);
  try {
    const data = await params.send(params.endpoint, method, body);
    return { status: "sent", data, clientRef };
  } catch (err) {
    if (!classify(err)) throw err; // permanent — let the caller handle it
    const entry = buildEntry({ endpoint: params.endpoint, method, payload: body, label: params.label, clientRef, now: params.now });
    entry.lastError = err instanceof Error ? err.message : String(err ?? "");
    await params.store.put(entry);
    return { status: "queued", entry, clientRef };
  }
}

// ── IndexedDB adapter (browser only; lazy — safe to import under Node) ────────

const DB_NAME = "care_erp_outbox";
const STORE_NAME = "mutations";
const DB_VERSION = 1;

function hasIndexedDB(): boolean {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis && (globalThis as { indexedDB?: unknown }).indexedDB != null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

/**
 * IndexedDB-backed OutboxStore. Falls back to an in-memory store when
 * IndexedDB is unavailable (SSR, private-mode edge cases) so callers never
 * crash — durability just degrades to the tab's lifetime in that rare case.
 */
export function createIndexedDbOutboxStore(): OutboxStore {
  if (!hasIndexedDB()) return createMemoryOutboxStore();

  async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE_NAME, mode);
      const req = fn(t.objectStore(STORE_NAME));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
      t.oncomplete = () => db.close();
    });
  }

  return {
    put: (entry) => tx<void>("readwrite", (s) => s.put(entry)).then(() => undefined),
    getAll: () => tx<OutboxEntry[]>("readonly", (s) => s.getAll()),
    delete: (id) => tx<void>("readwrite", (s) => s.delete(id)).then(() => undefined),
  };
}

/** In-memory store — for tests and as the IndexedDB fallback. */
export function createMemoryOutboxStore(seed: OutboxEntry[] = []): OutboxStore {
  const map = new Map<string, OutboxEntry>(seed.map((e) => [e.id, e]));
  return {
    put: async (entry) => { map.set(entry.id, entry); },
    getAll: async () => Array.from(map.values()),
    delete: async (id) => { map.delete(id); },
  };
}
