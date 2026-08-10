import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Package, Plus } from "lucide-react";

type Item = {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  trackExpiry?: boolean;
};

type Batch = {
  id: number;
  lotNumber: string;
  expiryDate: string | null;
  qtyReceived: number;
  qtyRemaining: number;
  status: string;
};

type ExpiryReport = {
  days: number;
  expired: Array<{ id: number; itemName: string; lotNumber: string; expiryDate: string | null; qtyRemaining: number }>;
  nearExpiry: Array<{ id: number; itemName: string; lotNumber: string; expiryDate: string | null; qtyRemaining: number }>;
};

export default function InventoryBatchesPanel({ items }: { items: Item[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedItemId, setSelectedItemId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [qty, setQty] = useState("1");

  const itemId = selectedItemId ? Number(selectedItemId) : null;
  const selectedItem = items.find((i) => i.id === itemId);

  const { data: batches = [] } = useQuery<Batch[]>({
    queryKey: ["/api/inventory/batches", itemId],
    queryFn: () => api.get(`/api/inventory/batches?itemId=${itemId}`),
    enabled: !!itemId,
  });

  const { data: expiry } = useQuery<ExpiryReport>({
    queryKey: ["/api/inventory/expiry-report"],
    queryFn: () => api.get("/api/inventory/expiry-report?days=90"),
  });

  const receiveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/inventory/batches", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/inventory/batches"] });
      void qc.invalidateQueries({ queryKey: ["/api/inventory"] });
      void qc.invalidateQueries({ queryKey: ["/api/inventory/expiry-report"] });
      setLotNumber("");
      setExpiryDate("");
      setQty("1");
      toast({ title: "Lot received", description: "Stock updated with batch tracking." });
    },
    onError: (e: Error) => toast({ title: "Receive failed", description: e.message, variant: "destructive" }),
  });

  const trackMut = useMutation({
    mutationFn: ({ id, trackExpiry }: { id: number; trackExpiry: boolean }) =>
      api.patch(`/api/inventory/items/${id}/reorder-config`, { trackExpiry }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Expiry tracking updated" });
    },
  });

  return (
    <div className="space-y-4">
      {(expiry?.expired.length || expiry?.nearExpiry.length) ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
          <h3 className="text-sm font-bold flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={14} /> Expiry alerts (90 days)
          </h3>
          {expiry.expired.length > 0 && (
            <p className="text-xs text-red-700 dark:text-red-400">
              <strong>Expired:</strong> {expiry.expired.map((b) => `${b.itemName} lot ${b.lotNumber || "—"} (${b.qtyRemaining})`).join(" · ")}
            </p>
          )}
          {expiry.nearExpiry.length > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <strong>Expiring soon:</strong> {expiry.nearExpiry.slice(0, 6).map((b) => `${b.itemName} → ${b.expiryDate}`).join(" · ")}
              {expiry.nearExpiry.length > 6 ? ` · +${expiry.nearExpiry.length - 6} more` : ""}
            </p>
          )}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="border border-card-border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Plus size={14} /> Receive lot (FEFO)
          </h3>
          <div className="space-y-2">
            <Label className="text-xs">Item</Label>
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select reagent/consumable…" /></SelectTrigger>
              <SelectContent>
                {items.map((it) => (
                  <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedItem && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline">FEFO {selectedItem.trackExpiry ? "ON" : "OFF"}</Badge>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[10px]"
                onClick={() => trackMut.mutate({ id: selectedItem.id, trackExpiry: !selectedItem.trackExpiry })}
              >
                Turn {selectedItem.trackExpiry ? "off" : "on"} expiry tracking
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Lot #</Label>
              <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Expiry</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="h-8" />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!itemId || receiveMut.isPending}
            onClick={() => receiveMut.mutate({
              itemId,
              lotNumber,
              expiryDate: expiryDate || undefined,
              quantity: Number(qty),
            })}
          >
            Receive lot
          </Button>
        </div>

        <div className="border border-card-border rounded-xl p-4">
          <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
            <Package size={14} /> Active lots
            {selectedItem ? ` — ${selectedItem.name}` : ""}
          </h3>
          {!itemId ? (
            <p className="text-xs text-muted-foreground">Select an item to view batches.</p>
          ) : batches.length === 0 ? (
            <p className="text-xs text-muted-foreground">No lots on file.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1.5 pr-2">Lot</th>
                    <th className="py-1.5 pr-2">Expiry</th>
                    <th className="py-1.5 pr-2">Remaining</th>
                    <th className="py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-b border-card-border/50">
                      <td className="py-1.5 pr-2 font-mono">{b.lotNumber || "—"}</td>
                      <td className="py-1.5 pr-2">{b.expiryDate ?? "—"}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{b.qtyRemaining}</td>
                      <td className="py-1.5 capitalize">{b.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
