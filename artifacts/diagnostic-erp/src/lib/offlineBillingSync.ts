/**
 * Offline billing sync helpers — API reachability probes and sync notifications.
 * LAN/NAS clinics: navigator.onLine is unreliable; we probe the real API instead.
 */

import type { SyncedBillResult } from "./offlineBillingQueue";

export const OFFLINE_BILLS_SYNCED_EVENT = "erp:offlineBillsSynced";

/** Poll interval while bills are waiting in the local queue. */
export const OFFLINE_QUEUE_POLL_MS = 5_000;

/** Poll interval when the queue is empty. */
export const OFFLINE_QUEUE_IDLE_POLL_MS = 15_000;

/** Lightweight probe — proves care-api is answering (not just DNS/LAN). */
export async function probeBillingApi(timeoutMs = 4_000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const token = (() => {
      try {
        const raw = window.localStorage.getItem("erp_session");
        if (!raw) return null;
        return JSON.parse(raw)?.token ?? null;
      } catch {
        return null;
      }
    })();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch("/api/sync/status", {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    window.clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function dispatchOfflineBillsSynced(synced: SyncedBillResult[]): void {
  if (synced.length === 0) return;
  window.dispatchEvent(new CustomEvent(OFFLINE_BILLS_SYNCED_EVENT, { detail: synced }));
}
