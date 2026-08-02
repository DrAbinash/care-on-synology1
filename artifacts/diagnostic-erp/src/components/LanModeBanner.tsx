import { useCallback, useEffect, useState } from "react";
import { Wifi, WifiOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildPublicErpUrl,
  getPublicErpOrigin,
  isOnLanErpOrigin,
  probeErpOrigin,
} from "@/lib/erpConnectivity";

const PUBLIC_CHECK_MS = 60_000;

/**
 * Shown when staff were auto-redirected to the LAN ERP URL because
 * caredeoghar.com was unreachable. Explains card-payment limitation and
 * offers a one-click return when the public site is back.
 */
export function LanModeBanner() {
  const onLan = isOnLanErpOrigin();
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

  if (!onLan) return null;

  return (
    <div className="border-b border-sky-500/40 bg-sky-500/10 px-4 py-2 text-sm text-sky-900 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-2">
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
      </div>
    </div>
  );
}
