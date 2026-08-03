import { WifiOff, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildLanFailoverOptions,
  shouldOfferLanFailover,
} from "@/lib/erpConnectivity";

/**
 * Shown on the login page when caredeoghar.com did not respond during
 * bootstrap. Staff pick the LAN URL manually — avoids a bad auto-redirect
 * when the probe fails or this PC is on a different clinic subnet.
 */
export function LanFailoverOffer() {
  if (!shouldOfferLanFailover()) return null;

  const options = buildLanFailoverOptions();

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>
            <strong>Cannot reach caredeoghar.com from this computer.</strong>{" "}
            If the clinic NAS is on, open the local network version below (cash and UPI work; card payments need the public site).
          </p>
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
                Open via {host}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
