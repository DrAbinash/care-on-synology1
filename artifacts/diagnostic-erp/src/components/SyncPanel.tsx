import { useSyncStatus, incrementPendingSyncCount } from "@/hooks/useSyncStatus";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { RefreshCw, WifiOff, CloudOff, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useState } from "react";

export function SyncPanel() {
  const isOnline = useOnlineStatus();
  const { pendingCount, lastSyncedAt, isSyncing, lastError, triggerSync } = useSyncStatus();
  const [justTriggered, setJustTriggered] = useState(false);

  const handleSync = useCallback(() => {
    setJustTriggered(true);
    triggerSync();
    setTimeout(() => setJustTriggered(false), 2000);
  }, [triggerSync]);

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
          {pendingCount > 0 && !isOnline && (
            <span className="text-amber-300">({pendingCount} queued)</span>
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
