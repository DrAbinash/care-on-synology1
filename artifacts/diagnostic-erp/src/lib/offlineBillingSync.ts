/**
 * Offline billing sync helpers — API reachability probes and sync notifications.
 * LAN/NAS clinics: navigator.onLine is unreliable; we probe the real API instead.
 */

import type { SyncedBillResult } from "./offlineBillingQueue";
import { probeErpOrigin } from "./erpConnectivity";
import { getStaffToken, isAuthHttpError } from "./fetchApi";
import { ERP_SESSION_KEY } from "./staffSession";

export const OFFLINE_BILLS_SYNCED_EVENT = "erp:offlineBillsSynced";

/** Poll interval while bills are waiting in the local queue. */
export const OFFLINE_QUEUE_POLL_MS = 5_000;

/** Poll interval when the queue is empty. */
export const OFFLINE_QUEUE_IDLE_POLL_MS = 15_000;

/**
 * When staff auth is missing or a prior /api/sync/* call returned 401/403,
 * keep probing shell reachability but do not hammer authenticated sync routes.
 * Resume as soon as the staff token changes (login / refresh / logout).
 */
export const OFFLINE_QUEUE_AUTH_PAUSE_POLL_MS = 60_000;

/** Lightweight probe — proves care-api is answering (not just DNS/LAN). */
export async function probeBillingApi(timeoutMs = 4_000): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return probeErpOrigin(window.location.origin, timeoutMs);
}

export function dispatchOfflineBillsSynced(synced: SyncedBillResult[]): void {
  if (synced.length === 0) return;
  window.dispatchEvent(new CustomEvent(OFFLINE_BILLS_SYNCED_EVENT, { detail: synced }));
}

/**
 * Decide whether this tick should call authenticated sync endpoints
 * (`/api/sync/status`, queue flush). Pure aside from getStaffToken().
 *
 * `pausedForToken` is the token that previously got 401/403 — while it is
 * still the current token we skip (avoids a 401 storm every 5–15s). A new
 * token, or no pause, allows the call.
 */
export function shouldCallAuthenticatedSync(pausedForToken: string | null): {
  call: boolean;
  token: string | null;
  reason: "ok" | "no_token" | "paused_same_token";
} {
  const token = getStaffToken();
  if (!token) return { call: false, token: null, reason: "no_token" };
  if (pausedForToken !== null && pausedForToken === token) {
    return { call: false, token, reason: "paused_same_token" };
  }
  return { call: true, token, reason: "ok" };
}

/** After an authenticated sync failure: pause only on auth errors. */
export function nextAuthPauseToken(
  err: unknown,
  currentToken: string | null,
): string | null {
  if (isAuthHttpError(err) && currentToken) return currentToken;
  return null;
}

/** Clear auth pause when the session key changes (login/logout in this or another tab). */
export function isStaffSessionStorageKey(key: string | null): boolean {
  return key === ERP_SESSION_KEY;
}

export function syncPollIntervalMs(opts: {
  pendingCount: number;
  authPaused: boolean;
}): number {
  if (opts.authPaused) return OFFLINE_QUEUE_AUTH_PAUSE_POLL_MS;
  return opts.pendingCount > 0 ? OFFLINE_QUEUE_POLL_MS : OFFLINE_QUEUE_IDLE_POLL_MS;
}
