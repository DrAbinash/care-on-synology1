/**
 * Offline billing sync helpers — API reachability probes and sync notifications.
 * LAN/NAS clinics: navigator.onLine is unreliable; we probe the real API instead.
 */

import type { SyncedBillResult } from "./offlineBillingQueue";
import { probeErpOrigin } from "./erpConnectivity";

export const OFFLINE_BILLS_SYNCED_EVENT = "erp:offlineBillsSynced";

/** Poll interval while bills are waiting in the local queue. */
export const OFFLINE_QUEUE_POLL_MS = 5_000;

/** Poll interval when the queue is empty. */
export const OFFLINE_QUEUE_IDLE_POLL_MS = 15_000;

/** Lightweight probe — proves care-api is answering (not just DNS/LAN). */
export async function probeBillingApi(timeoutMs = 4_000): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return probeErpOrigin(window.location.origin, timeoutMs);
}

export function dispatchOfflineBillsSynced(synced: SyncedBillResult[]): void {
  if (synced.length === 0) return;
  window.dispatchEvent(new CustomEvent(OFFLINE_BILLS_SYNCED_EVENT, { detail: synced }));
}
