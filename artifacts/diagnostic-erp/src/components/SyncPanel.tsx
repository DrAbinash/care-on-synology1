import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getQueuedBills, discardQueuedBill, type QueuedBill } from "@/lib/offlineBillingQueue";
import { RefreshCw, CloudOff, CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

export function SyncPanel() {
  const isOnline = useOnlineStatus();
  const { pendingCount, lastSyncedAt, isSyncing, lastError, triggerSync } = useSyncStatus();
  const [justTriggered, setJustTriggered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [queued, setQueued] = useState<QueuedBill[]>([]);

  // Re-read the queue's contents whenever its length changes (a bill got
  // queued or flushed) or the disclosure opens — pendingCount already tracks
  // that same localStorage-backed queue, so this stays in lockstep with it.
  useEffect(() => {
    setQueued(getQueuedBills());
  }, [pendingCount, expanded]);

  const handleSync = useCallback(() => {
    setJustTriggered(true);
    triggerSync();
    setTimeout(() => setJustTriggered(false), 2000);
  }, [triggerSync]);

  const handleDiscard = useCallback((clientRef: string) => {
    discardQueuedBill(clientRef);
    setQueued(getQueuedBills());
  }, []);

  const lastSyncText = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "Never";

  return (
    <div className="space-y-1 text-[11px]">
      {/* Row 1: status + sync button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isOnline ? (
            <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
          ) : (
            <CloudOff size={11} className="text-slate-400 shrink-0" />
          )}
          <span className={isOnline ? "text-emerald-300" : "text-slate-400"}>
            {isOnline ? "Cloud connected" : "Offline"}
          </span>
          {pendingCount > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-0.5 text-amber-300 hover:text-amber-200"
              title="Bills waiting to sync"
            >
              ({pendingCount} queued) {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={!isOnline || isSyncing || justTriggered}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
            !isOnline || isSyncing || justTriggered
              ? "bg-white/10 text-white/40 cursor-not-allowed"
              : "bg-white/15 text-white hover:bg-white/25 active:bg-white/20"
          )}
        >
          <RefreshCw size={10} className={cn(isSyncing && "animate-spin")} />
          {isSyncing ? "Syncing" : justTriggered ? "Requested" : "Sync now"}
        </button>
      </div>

      {/* Row 2: last sync + error */}
      <div className="flex items-center justify-between">
        <span className="text-white/40">
          Last sync: {lastSyncText}
        </span>
        {lastError && (
          <span className="text-red-300 truncate" title={lastError}>Sync failed</span>
        )}
      </div>

      {/* Row 3 (collapsible): each queued bill, with a discard escape hatch
          for one that can never succeed (e.g. its patient or test was
          deleted during the outage) — otherwise it would block every bill
          queued after it, since replay stops at the first failure to keep
          per-department token numbers in the order patients actually arrived. */}
      {expanded && queued.length > 0 && (
        <div className="mt-1 space-y-1 rounded bg-black/20 p-1.5">
          {queued.map((q) => (
            <div key={q.clientRef} className="flex items-center justify-between gap-2 text-white/70">
              <span className="truncate" title={q.lastError ?? undefined}>
                {q.provisionalBillNumber ? `${q.provisionalBillNumber} · ` : ""}
                {new Date(q.queuedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {q.lastError ? ` — ${q.lastError}` : " — waiting to sync"}
              </span>
              {q.lastError && (
                <button
                  onClick={() => handleDiscard(q.clientRef)}
                  className="shrink-0 text-white/40 hover:text-red-300"
                  title="Discard this queued bill — it will not be retried"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline badge showing pending sync count.
 */
export function SyncBadge() {
  const { pendingCount, isSyncing } = useSyncStatus();
  if (pendingCount === 0 && !isSyncing) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        isSyncing
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      )}
      title={isSyncing ? "Syncing…" : `${pendingCount} pending change${pendingCount === 1 ? "" : "s"}`}
    >
      <RefreshCw size={10} className={cn(isSyncing && "animate-spin")} />
      {isSyncing ? "Syncing" : pendingCount}
    </span>
  );
}
