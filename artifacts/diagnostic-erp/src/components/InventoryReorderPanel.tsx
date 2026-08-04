import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, ShoppingCart, Truck } from "lucide-react";

type ReorderRequest = {
  id: number;
  itemId: number;
  itemName: string;
  currentStock: number;
  reorderPoint: number | null;
  suggestedQty: number;
  status: string;
  source: string;
  vendorName: string | null;
  createdAt: string;
};

export default function InventoryReorderPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: requests = [], isLoading, refetch, isFetching } = useQuery<ReorderRequest[]>({
    queryKey: ["/api/inventory/reorder/requests"],
    queryFn: () => api.get("/api/inventory/reorder/requests?status=suggested"),
  });

  const scanMut = useMutation({
    mutationFn: () => api.post("/api/inventory/reorder/scan", {}),
    onSuccess: (r: { newSuggestions?: number; atOrBelowReorderPoint?: number }) => {
      void qc.invalidateQueries({ queryKey: ["/api/inventory/reorder/requests"] });
      toast({
        title: "Reorder scan complete",
        description: `${r.newSuggestions ?? 0} new suggestion(s) from ${r.atOrBelowReorderPoint ?? 0} low items.`,
      });
    },
    onError: (e: Error) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "order" | "cancel" }) =>
      api.post(`/api/inventory/reorder/requests/${id}/${action}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/inventory/reorder/requests"] }),
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <ShoppingCart size={14} /> Reorder suggestions
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scan items at/below reorder point, then mark ordered when PO is placed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? "animate-spin mr-1" : "mr-1"} /> Refresh
          </Button>
          <Button size="sm" onClick={() => scanMut.mutate()} disabled={scanMut.isPending}>
            Scan low stock
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="border border-dashed border-card-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          No open reorder suggestions. Run <strong>Scan low stock</strong> to generate them.
        </div>
      ) : (
        <div className="overflow-x-auto border border-card-border rounded-xl">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-muted/40">
              <tr>
                {["Item", "In stock", "Reorder pt", "Order qty", "Vendor", "Source", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{r.itemName}</td>
                  <td className="px-3 py-2 tabular-nums text-amber-700">{r.currentStock}</td>
                  <td className="px-3 py-2 tabular-nums">{r.reorderPoint ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold">{r.suggestedQty}</td>
                  <td className="px-3 py-2">{r.vendorName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px] capitalize">{r.source}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 text-[10px]" onClick={() => actionMut.mutate({ id: r.id, action: "order" })}>
                        <Truck size={12} className="mr-0.5" /> Mark ordered
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => actionMut.mutate({ id: r.id, action: "cancel" })}>
                        Cancel
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
