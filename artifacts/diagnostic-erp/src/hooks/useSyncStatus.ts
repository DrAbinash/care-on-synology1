import { useState, useEffect, useCallback } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { api } from "@/lib/fetchApi";
import {
  getQueuedBills,
  flushQueuedBills,
  OFFLINE_BILL_QUEUE_KEY,
} from "@/lib/offlineBillingQueue";
import {
  OFFLINE_QUEUE_IDLE_POLL_MS,
  OFFLINE_QUEUE_POLL_MS,
  probeBillingApi,
} from "@/lib/offlineBillingSync";

type SyncState = {
  pendingCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  lastError: string | null;
  /** True when /api/sync/status last probe succeeded. */
  apiReachable: boolean;
};

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
  return {
    ...readPersisted(),
    pendingCount: getQueuedBills().length,
    isSyncing: false,
    apiReachable: true,
  };
}

function writePersisted(fields: PersistedFields) {
  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(fields));
  } catch {
    /* ignore */
  }
}

/**
 * Tracks offline bill queue sync. When bills are queued, polls the API every
 * 5s (even if the browser reports offline) so NAS recovery on LAN is detected
 * without waiting for an internet uplink.
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
    setState((prev) => ({
      ...prev,
      ...persisted,
      pendingCount: remaining,
      isSyncing: false,
    }));
  }, []);

  const fetchStatus = useCallback(async () => {
    const pending = getQueuedBills().length;
    // Keep probing while bills are queued — LAN NAS may be up even when
    // navigator.onLine is false (no internet uplink).
    if (!isOnline && pending === 0) {
      setState((prev) => ({ ...prev, apiReachable: false }));
      return;
    }

    const reachable = await probeBillingApi();
    setState((prev) => ({ ...prev, apiReachable: reachable }));

    if (!reachable) return;

    try {
      await api.get("/api/sync/status");
      await flushQueue();
    } catch {
      setState((prev) => ({ ...prev, apiReachable: false }));
    }
  }, [isOnline, flushQueue]);

  useEffect(() => {
    const pending = getQueuedBills().length;
    const intervalMs = pending > 0 ? OFFLINE_QUEUE_POLL_MS : OFFLINE_QUEUE_IDLE_POLL_MS;
    void fetchStatus();
    const id = window.setInterval(fetchStatus, intervalMs);
    return () => window.clearInterval(id);
  }, [fetchStatus, state.pendingCount]);

  useEffect(() => {
    const handler = () => {
      void flushQueue();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [flushQueue]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === SYNC_STORAGE_KEY || e.key === OFFLINE_BILL_QUEUE_KEY) {
        setState((prev) => ({ ...readState(), apiReachable: prev.apiReachable }));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const triggerSync = useCallback(async () => {
    if (state.isSyncing) return;
    await flushQueue();
  }, [state.isSyncing, flushQueue]);

  return { ...state, triggerSync, isOnline };
}

/** Billing Desk banner: server down or bills waiting to sync. */
export function useBillingOutageMode() {
  const sync = useSyncStatus();
  return {
    ...sync,
    showOutageBanner: sync.pendingCount > 0 || !sync.apiReachable,
  };
}
