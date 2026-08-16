import { useCallback, useEffect, useState } from "react";
import { Wifi, WifiOff, ExternalLink, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildPublicErpUrl,
  getPublicErpOrigin,
  isOnLanErpOrigin,
  probeErpOrigin,
} from "@/lib/erpConnectivity";
import { useBillingOutageMode } from "@/hooks/useSyncStatus";

const PUBLIC_CHECK_MS = 60_000;

/**
 * Unified connectivity banner: LAN mode, offline billing queue, and billing
 * server reachability — one strip instead of separate page-level banners.
 */
export function ConnectivityStatusBanner() {
  const onLan = isOnLanErpOrigin();
  const { showOutageBanner, pendingCount, apiReachable, authPaused, isOnline } =
    useBillingOutageMode();
  const [publicReachable, setPublicReachable] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkPublic = useCallback(async () => {
    if (!onLan) return;
    setChecking(true);
    try {
      const ok = await probeErpOrigin(getPublicErpOrigin());
      setPublicReachable(ok);
    } finally {
      setChecking(false);
    }
  }, [onLan]);

  useEffect(() => {
    if (!onLan) return;
    void checkPublic();
    const id = window.setInterval(() => void checkPublic(), PUBLIC_CHECK_MS);
    return () => window.clearInterval(id);
  }, [onLan, checkPublic]);

  if (!onLan && !showOutageBanner) return null;

  return (
    <div className="border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm text-sky-900 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-2">
        {onLan ? (
          <>
            <Wifi size={16} className="shrink-0 text-sky-600 dark:text-sky-300" />
            <span>
              <strong>Connected via local network (NAS).</strong>{" "}
              Cash and UPI billing work normally. ICICI card payments need internet — use{" "}
              <span className="font-mono text-xs">caredeoghar.com/erp</span> when the public site is back.
            </span>
            {publicReachable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7 gap-1 text-xs"
                onClick={() => {
                  window.location.href = buildPublicErpUrl();
                }}
              >
                <ExternalLink size={12} />
                Open caredeoghar.com
              </Button>
            )}
            {!publicReachable && checking && (
              <span className="ml-auto flex items-center gap-1 text-xs text-sky-700/70 dark:text-sky-200/70">
                <WifiOff size={12} />
                Checking internet…
              </span>
            )}
          </>
        ) : null}

        {showOutageBanner && (
          <>
            {!onLan && <CloudOff size={16} className="shrink-0 text-amber-600" />}
            <span className={onLan ? "border-l border-sky-400/50 pl-2" : ""}>
              <strong className="text-amber-900 dark:text-amber-100">Billing sync</strong>
              {pendingCount > 0
                ? ` — ${pendingCount} bill(s) queued for sync.`
                : " — ERP server unreachable."}
              {pendingCount > 0 && authPaused
                ? " Sign in so queued bills can sync."
                : pendingCount > 0
                  ? " Provisional receipts (OFF-…) sync automatically when the server is back."
                  : null}
              {!isOnline && " (No network detected.)"}
              {isOnline && !apiReachable && !authPaused &&
                " (Network is up but the ERP server is not responding.)"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
