import { useEffect, useState } from "react";
import { ExternalLink, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ERP_CONNECTIVITY_PROBE_DONE_EVENT,
  buildLanStaffLoginOptions,
  getLastWorkingLanHost,
  shouldOfferLanFailover,
} from "@/lib/erpConnectivity";

/**
 * Shown on staff login only when the ERP shell probe failed on caredeoghar.com.
 * Manual NAS links — never auto-redirects (that broke public logins).
 */
export function StaffLanLoginShortcuts() {
  const [show, setShow] = useState(shouldOfferLanFailover());

  useEffect(() => {
    const refresh = () => setShow(shouldOfferLanFailover());
    window.addEventListener(ERP_CONNECTIVITY_PROBE_DONE_EVENT, refresh);
    return () => window.removeEventListener(ERP_CONNECTIVITY_PROBE_DONE_EVENT, refresh);
  }, []);

  if (!show) return null;

  const options = buildLanStaffLoginOptions();
  const lastWorking = getLastWorkingLanHost();

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>
            <strong>Cannot reach caredeoghar.com from this computer.</strong>{" "}
            Open the clinic NAS login below (cash and UPI work; card payments need the public site).
          </p>
          {lastWorking && (
            <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
              Last working on this PC: <span className="font-mono">{lastWorking}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {options.map(({ host, url }) => (
              <Button
                key={host}
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 border-amber-400 bg-white/80 text-xs dark:bg-amber-950/60"
                onClick={() => {
                  window.location.href = url;
                }}
              >
                <ExternalLink size={12} />
                NAS {host}
                {host === lastWorking && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                    last worked
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
