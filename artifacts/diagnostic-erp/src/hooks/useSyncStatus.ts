import { useState, useEffect, useCallback, useRef } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { api } from "@/lib/fetchApi";

type SyncState = {
  pendingCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  lastError: string | null;
};

const SYNC_STORAGE_KEY = "erp_sync_state";
const PENDING_KEY = "erp_pending_sync_count";

function readPersistedState(): SyncState {
  try {
    const raw = window.localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { pendingCount: 0, lastSyncedAt: null, isSyncing: false, lastError: null };
    return JSON.parse(raw) as SyncState;
  } catch {
    return { pendingCount: 0, lastSyncedAt: null, isSyncing: false, lastError: null };
  }
}

function writePersistedState(state: SyncState) {
  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded or private mode */ }
}

function updatePending(delta: number) {
  const raw = window.localStorage.getItem(PENDING_KEY);
  const current = raw ? Math.max(0, parseInt(raw, 10) || 0) : 0;
  const next = Math.max(0, current + delta);
  window.localStorage.setItem(PENDING_KEY, String(next));
  // Broadcast to other tabs
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: PENDING_KEY, newValue: String(next) }));
  } catch { /* ignore */ }
  return next;
}

/**
 * Mark a new local mutation that should eventually sync to the cloud.
 * Call this from billing, orders, and tests mutations when offline
 * (or always — the sync engine will skip already-synced rows).
 */
export function incrementPendingSyncCount(n = 1): number {
  return updatePending(n);
}

/**
 * Decrement after a successful sync batch.
 */
export function decrementPendingSyncCount(n = 1): number {
  return updatePending(-n);
}

/**
 * Hook that tracks sync status across the ERP UI.
 *
 * In the current web build it polls a lightweight endpoint
 * (`GET /api/sync/status`) and uses localStorage as the cross-tab
 * signal for pending changes. In the Electron/Windows build the
 * same hook is wired to IPC calls into the local sync engine.
 */
export function useSyncStatus() {
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<SyncState>(readPersistedState);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isOnline) return;
    try {
      const data = await api.get<{ pending?: number; lastSyncedAt?: string | null; error?: string | null }>(
        "/api/sync/status"
      );
      setState((prev) => {
        const next: SyncState = {
          pendingCount: data.pending ?? prev.pendingCount,
          lastSyncedAt: data.lastSyncedAt ?? prev.lastSyncedAt,
          isSyncing: prev.isSyncing,
          lastError: data.error ?? prev.lastError,
        };
        writePersistedState(next);
        return next;
      });
    } catch {
      // Network hiccup — keep previous state
    }
  }, [isOnline]);

  // Poll every 15 s when online
  useEffect(() => {
    if (!isOnline) return;
    fetchStatus();
    const id = setInterval(fetchStatus, 15000);
    return () => clearInterval(id);
  }, [isOnline, fetchStatus]);

  // Listen for localStorage changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === PENDING_KEY || e.key === SYNC_STORAGE_KEY) {
        setState(readPersistedState());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const triggerSync = useCallback(async () => {
    if (!isOnline || state.isSyncing) return;
    setState((prev) => ({ ...prev, isSyncing: true }));
    try {
      await api.post("/api/sync/trigger", {});
      await fetchStatus();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isSyncing: false,
        lastError: err instanceof Error ? err.message : "Sync request failed",
      }));
    }
  }, [isOnline, state.isSyncing, fetchStatus]);

  return { ...state, triggerSync };
}
