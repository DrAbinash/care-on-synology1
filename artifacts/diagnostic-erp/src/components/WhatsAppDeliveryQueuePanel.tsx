/**
 * Front-desk WhatsApp Delivery Queue — pending Lane-1 sends (one-click wa.me).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, RefreshCw } from "lucide-react";
import { buildWaLink, maskPhoneForAudit } from "@/lib/whatsappDelivery";

type QueueRow = {
  id: number;
  kind: string;
  status: string;
  patientPhone: string;
  prefilledMessage: string;
  patientName: string;
  bookingRef: string;
  recordId: string;
  source: string;
  createdAt: string;
};

export function WhatsAppDeliveryQueuePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery<{
    rows: QueueRow[];
    clicktochatNumber?: string;
    clinicName?: string;
  }>({
    queryKey: ["wa-delivery-queue", "pending"],
    queryFn: () => api.get("/api/whatsapp-delivery/queue?status=pending"),
    refetchInterval: 30_000,
  });

  const sendMut = useMutation({
    mutationFn: async (row: QueueRow) => {
      const link = buildWaLink(row.patientPhone, row.prefilledMessage);
      if (!link) {
        throw new Error("Patient phone missing or invalid — cannot open WhatsApp");
      }
      window.open(link, "_blank", "noopener,noreferrer");
      return api.post(`/api/whatsapp-delivery/queue/${row.id}/send`, {});
    },
    onSuccess: () => {
      toast({ title: "Marked sent", description: "WhatsApp opened; queue row audited." });
      qc.invalidateQueries({ queryKey: ["wa-delivery-queue"] });
    },
    onError: (e: Error) => {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="wa-delivery-queue">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <MessageCircle size={16} /> WhatsApp Delivery Queue
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pending staff-click sends (booking / chatbot). Never auto-sends.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? "animate-spin mr-1" : "mr-1"} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground animate-pulse">Loading queue…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pending deliveries.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {row.patientName || "Patient"} · <span className="font-normal text-muted-foreground">{row.kind}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {row.bookingRef || row.recordId} · {maskPhoneForAudit(row.patientPhone)} · {row.source}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{row.prefilledMessage}</div>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                disabled={sendMut.isPending}
                onClick={() => sendMut.mutate(row)}
                data-testid={`wa-queue-send-${row.id}`}
              >
                Send
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default WhatsAppDeliveryQueuePanel;
