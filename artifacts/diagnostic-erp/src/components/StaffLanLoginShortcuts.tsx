import { useEffect, useState } from "react";
import { ExternalLink, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ERP_CONNECTIVITY_PROBE_DONE_EVENT,
  ERP_PUBLIC_PROBE_FAILED_KEY,
  buildLanStaffLoginOptions,
  getLastWorkingLanHost,
  isOnPublicErpOrigin,
  shouldOfferLanFailover,
} from "@/lib/erpConnectivity";

/**
 * Always shown on the staff login form when opened via caredeoghar.com.
 * Clinic workstations often cannot reach the public domain from the LAN
 * (hairpin NAT) — direct NAS links must be visible without waiting for probes.
 */
export function StaffLanLoginShortcuts() {
  const [probeFailed, setProbeFailed] = useState(shouldOfferLanFailover());

  useEffect(() => {
    const refresh = () => setProbeFailed(shouldOfferLanFailover());
    window.addEventListener(ERP_CONNECTIVITY_PROBE_DONE_EVENT, refresh);
    return () => window.removeEventListener(ERP_CONNECTIVITY_PROBE_DONE_EVENT, refresh);
  }, []);

  if (!isOnPublicErpOrigin()) return null;

  const options = buildLanStaffLoginOptions();
  const lastWorking = getLastWorkingLanHost();
  const urgent = probeFailed;

  return (
    <div
      className={
        urgent
          ? "mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          : "mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100"
      }
    >
      <div className="flex items-start gap-2">
        <Wifi size={18} className="mt-0.5 shrink-0 opacity-80" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>
            {urgent ? (
              <>
                <strong>Cannot reach caredeoghar.com from this computer.</strong>{" "}
                Use the clinic NAS login below (cash and UPI work; card payments need the public site).
              </>
            ) : (
              <>
                <strong>On the clinic network?</strong>{" "}
                If this page is slow or won&apos;t load, use the local NAS login below.
              </>
            )}
          </p>
          {lastWorking && (
            <p className="text-xs opacity-90">
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
                className="h-8 gap-1 text-xs"
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
