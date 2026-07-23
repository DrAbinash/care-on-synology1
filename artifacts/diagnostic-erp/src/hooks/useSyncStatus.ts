import { useState, useEffect, useCallback } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { api } from "@/lib/fetchApi";
import { getQueuedBills, flushQueuedBills, OFFLINE_BILL_QUEUE_KEY } from "@/lib/offlineBillingQueue";

type SyncState = {
  pendingCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  lastError: string | null;
};

// Only lastSyncedAt/lastError persist here — pendingCount is derived fresh
// from the offline bill queue itself (see offlineBillingQueue.ts) every time,
// never cached, since that queue is the actual source of truth.
const SYNC_STORAGE_KEY = "erp_sync_state";

type PersistedFields = Pick<SyncState, "lastSyncedAt" | "lastError">;

function readPersisted(): PersistedFields {
  try {
    const raw = window.localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { lastSyncedAt: null, lastError: null };
    const parsed = JSON.parse(raw) as Partial<PersistedFields>;
    return { lastSyncedAt: parsed.lastSyncedAt ?? null, lastError: parsed.lastError ?? null };
  } catch {
    return { lastSyncedAt: null, lastError: null };
  }
}

function readState(): SyncState {
  return { ...readPersisted(), pendingCount: getQueuedBills().length, isSyncing: false };
}

function writePersisted(fields: PersistedFields) {
  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(fields));
  } catch { /* quota exceeded or private mode */ }
}

/**
 * Hook that tracks sync status across the ERP UI.
 *
 * "Pending" means bills created while the NAS was unreachable, queued
 * locally, and not yet replayed (see offlineBillingQueue.ts). A flush is
 * attempted opportunistically whenever we have real evidence the API is
 * reachable — a successful /api/sync/status poll, or the browser's "online"
 * event — and manually via triggerSync() (the sidebar's "Sync now" button).
 */
export function useSyncStatus() {
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<SyncState>(readState);

  const flushQueue = useCallback(async () => {
    if (getQueuedBills().length === 0) return;
    setState((prev) => ({ ...prev, isSyncing: true }));
    const { remaining, lastError } = await flushQueuedBills();
    const persisted: PersistedFields = {
      lastSyncedAt: remaining === 0 ? new Date().toISOString() : readPersisted().lastSyncedAt,
      lastError: remaining > 0 ? lastError : null,
    };
    writePersisted(persisted);
    setState({ ...persisted, pendingCount: remaining, isSyncing: false });
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!isOnline) return;
    try {
      await api.get("/api/sync/status");
      // A successful round-trip proves the API is reachable even when
      // navigator.onLine can't be trusted — LAN-only clinic PCs routinely
      // misreport "offline" with no internet uplink. That's what actually
      // gates a queue flush, not the browser's own online/offline events.
      await flushQueue();
    } catch {
      // Network hiccup — leave state as-is; the next poll or "online" event will retry.
    }
  }, [isOnline, flushQueue]);

  // Poll every 15 s when online.
  useEffect(() => {
    if (!isOnline) return;
    fetchStatus();
    const id = setInterval(fetchStatus, 15000);
    return () => clearInterval(id);
  }, [isOnline, fetchStatus]);

  // Also flush the instant the browser fires "online" — no need to wait for
  // the next 15s poll tick.
  useEffect(() => {
    const handler = () => { void flushQueue(); };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [flushQueue]);

  // Cross-tab: pick up queue/state changes made in another tab (or by
  // BillingDesk enqueueing in this same tab — see offlineBillingQueue.ts's
  // manual StorageEvent dispatch, since real "storage" events skip the
  // origin tab).
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === SYNC_STORAGE_KEY || e.key === OFFLINE_BILL_QUEUE_KEY) {
        setState(readState());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const triggerSync = useCallback(async () => {
    if (state.isSyncing) return;
    await flushQueue();
  }, [state.isSyncing, flushQueue]);

  return { ...state, triggerSync };
}
