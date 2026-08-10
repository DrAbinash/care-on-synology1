import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { OFFLINE_BILLS_SYNCED_EVENT } from "@/lib/offlineBillingSync";
import type { SyncedBillResult } from "@/lib/offlineBillingQueue";

/**
 * Global listener: when queued offline bills sync successfully, show a toast
 * with the real bill number (replacing the provisional OFF-… number).
 */
export function OfflineBillingSyncNotifier() {
  const { toast } = useToast();

  useEffect(() => {
    const onSynced = (event: Event) => {
      const detail = (event as CustomEvent<SyncedBillResult[] | { syncedBills: SyncedBillResult[] }>).detail;
      const bills = Array.isArray(detail) ? detail : (detail?.syncedBills ?? []);
      for (const bill of bills) {
        const was = bill.provisionalBillNumber;
        toast({
          title: "Offline bill synced",
          description: was
            ? `Bill ${bill.billNumber} (was ${was})`
            : `Bill ${bill.billNumber}`,
        });
      }
    };

    window.addEventListener(OFFLINE_BILLS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_BILLS_SYNCED_EVENT, onSynced);
  }, [toast]);

  return null;
}
