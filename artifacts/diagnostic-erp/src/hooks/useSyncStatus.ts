import { useState, useEffect, useCallback, useRef } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { api, isAuthHttpError, getStaffToken } from "@/lib/fetchApi";
import {
  getQueuedBills,
  flushQueuedBills,
  OFFLINE_BILL_QUEUE_KEY,
} from "@/lib/offlineBillingQueue";
import {
  OFFLINE_QUEUE_IDLE_POLL_MS,
  OFFLINE_QUEUE_POLL_MS,
  probeBillingApi,
  shouldCallAuthenticatedSync,
  nextAuthPauseToken,
  isStaffSessionStorageKey,
  syncPollIntervalMs,
} from "@/lib/offlineBillingSync";

type SyncState = {
  pendingCount: number;
  lastSyncedAt: string | null;
  isSyncing: boolean;
  lastError: string | null;
  /** True when the last shell/API probe succeeded (server answered). */
  apiReachable: boolean;
  /**
   * True when authenticated sync is skipped: no staff token, or a prior
   * /api/sync call returned 401/403 for the current token. Not an outage.
   */
  authPaused: boolean;
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
    authPaused: false,
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
 *
 * Authenticated `/api/sync/status` + queue flush require a staff token. Missing
 * or rejected auth must NOT flip `apiReachable` to false (that caused a 401
 * storm + false "server unreachable" banners on LAN billing desks).
 */
export function useSyncStatus() {
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<SyncState>(readState);
  /** Token that last got 401/403 — skip until it changes. */
  const pausedForTokenRef = useRef<string | null>(null);

  const clearAuthPause = useCallback(() => {
    pausedForTokenRef.current = null;
    setState((prev) => (prev.authPaused ? { ...prev, authPaused: false } : prev));
  }, []);

  const flushQueue = useCallback(async () => {
    if (getQueuedBills().length === 0) return;
    const gate = shouldCallAuthenticatedSync(pausedForTokenRef.current);
    if (!gate.call) {
      setState((prev) => ({ ...prev, authPaused: true }));
      return;
    }
    setState((prev) => ({ ...prev, isSyncing: true }));
    const { remaining, lastError, authFailed } = await flushQueuedBills();
    if (authFailed) {
      const token = shouldCallAuthenticatedSync(null).token;
      if (token) pausedForTokenRef.current = token;
    }
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
      authPaused: authFailed || prev.authPaused,
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

    const gate = shouldCallAuthenticatedSync(pausedForTokenRef.current);
    if (!gate.call) {
      setState((prev) => ({ ...prev, authPaused: true }));
      return;
    }

    try {
      await api.get("/api/sync/status");
      pausedForTokenRef.current = null;
      setState((prev) => ({ ...prev, authPaused: false }));
      await flushQueue();
    } catch (err) {
      const pauseToken = nextAuthPauseToken(err, gate.token);
      if (pauseToken) {
        pausedForTokenRef.current = pauseToken;
        // Server answered 401/403 — reachable; stop authenticated spam.
        setState((prev) => ({ ...prev, apiReachable: true, authPaused: true }));
        return;
      }
      // Genuine reachability / server failure after a successful shell probe.
      if (!isAuthHttpError(err)) {
        setState((prev) => ({ ...prev, apiReachable: false }));
      }
    }
  }, [isOnline, flushQueue]);

  useEffect(() => {
    const pending = getQueuedBills().length;
    const intervalMs = syncPollIntervalMs({
      pendingCount: pending,
      authPaused: state.authPaused,
    });
    void fetchStatus();
    const id = window.setInterval(fetchStatus, intervalMs);
    return () => window.clearInterval(id);
  }, [fetchStatus, state.pendingCount, state.authPaused]);

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
        setState((prev) => ({
          ...readState(),
          apiReachable: prev.apiReachable,
          authPaused: prev.authPaused,
        }));
      }
      if (isStaffSessionStorageKey(e.key)) {
        clearAuthPause();
        void fetchStatus();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [clearAuthPause, fetchStatus]);

  // Same-tab login/logout: localStorage does not fire `storage` in this tab.
  // Re-check the token when the document becomes visible (post-login navigation).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const gate = shouldCallAuthenticatedSync(pausedForTokenRef.current);
      if (gate.call && state.authPaused) {
        clearAuthPause();
        void fetchStatus();
      } else if (!gate.token && !state.authPaused) {
        setState((prev) => ({ ...prev, authPaused: true }));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearAuthPause, fetchStatus, state.authPaused]);

  const triggerSync = useCallback(async () => {
    if (state.isSyncing) return;
    clearAuthPause();
    await flushQueue();
  }, [state.isSyncing, flushQueue, clearAuthPause]);

  return { ...state, triggerSync, isOnline };
}

/** Billing Desk banner: server down or bills waiting to sync (not auth pause alone). */
export function useBillingOutageMode() {
  const sync = useSyncStatus();
  return {
    ...sync,
    showOutageBanner:
      sync.pendingCount > 0 || (!sync.apiReachable && !sync.authPaused),
  };
}

// Re-export poll constants for tests / callers that previously imported them here.
export { OFFLINE_QUEUE_POLL_MS, OFFLINE_QUEUE_IDLE_POLL_MS };
