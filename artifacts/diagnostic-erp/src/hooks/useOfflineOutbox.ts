import { useCallback, useEffect, useRef, useState } from "react";
import { useOnlineStatus } from "./useOnlineStatus";
import { fetchApi } from "@/lib/fetchApi";
import {
  createIndexedDbOutboxStore, submitWithOutbox, replayOutbox, pendingEntries,
  type OutboxStore, type OutboxEntry, type OutboxMethod, type SubmitResult,
} from "@/lib/offlineOutbox";

/**
 * useOfflineOutbox — offline-first submit + auto-replay for idempotent billing
 * mutations. Backed by IndexedDB (durable across reloads).
 *
 * Usage from the billing page (opt-in; existing flows are untouched):
 *
 *   const outbox = useOfflineOutbox();
 *   const r = await outbox.submit<{ id: number }>("/api/bills", payload, `Bill • ${name} • ₹${total}`);
 *   if (r.status === "queued") toast("Saved — will sync when back online");
 *   else navigate(`/bills/${r.data!.id}`);
 *
 * The outbox replays automatically when the browser comes back online and every
 * 20s while online. Because each mutation carries a stable clientRef, replaying
 * one the server already processed is a no-op on the server (idempotent) — bills
 * are never lost and never duplicated.
 */
export function useOfflineOutbox() {
  const isOnline = useOnlineStatus();
  const storeRef = useRef<OutboxStore | null>(null);
  if (storeRef.current === null) storeRef.current = createIndexedDbOutboxStore();
  const store = storeRef.current;

  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const all = await store.getAll();
    setEntries(all);
    setPending(all.filter((e) => e.status === "pending").length);
    setFailed(all.filter((e) => e.status === "failed").length);
  }, [store]);

  const replayNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsSyncing(true);
    try {
      await replayOutbox(store, async (entry) => {
        await fetchApi(entry.endpoint, { method: entry.method, body: JSON.stringify(entry.payload) });
      });
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      await refresh();
    }
  }, [store, refresh]);

  const submit = useCallback(async <T,>(endpoint: string, payload: unknown, label: string, method: OutboxMethod = "POST"): Promise<SubmitResult<T>> => {
    const result = await submitWithOutbox<T>({
      store, endpoint, method, payload, label,
      send: (ep, m, body) => fetchApi<T>(ep, { method: m, body: JSON.stringify(body) }),
    });
    await refresh();
    // If it went straight through but older items are still queued, try to drain them.
    if (result.status === "sent" && isOnline) void replayNow();
    return result;
  }, [store, refresh, replayNow, isOnline]);

  /** Discard a permanently-failed entry after an operator has dealt with it. */
  const discard = useCallback(async (id: string) => {
    await store.delete(id);
    await refresh();
  }, [store, refresh]);

  // Initial load + refresh on focus.
  useEffect(() => { void refresh(); }, [refresh]);

  // Replay when connectivity returns, and periodically while online.
  useEffect(() => {
    if (!isOnline) return;
    void replayNow();
    const id = window.setInterval(() => { void replayNow(); }, 20_000);
    return () => window.clearInterval(id);
  }, [isOnline, replayNow]);

  return { pending, failed, isSyncing, entries, submit, replayNow, discard, refresh, isOnline };
}

export async function outboxPending(store: OutboxStore): Promise<OutboxEntry[]> {
  return pendingEntries(store);
}
