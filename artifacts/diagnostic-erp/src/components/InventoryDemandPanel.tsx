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
import { ClipboardList, Plus, Check, X, PackageCheck } from "lucide-react";

type Item = { id: number; name: string; unit: string; currentStock: number };
type Demand = {
  id: number;
  itemId: number | null;
  itemName: string;
  quantity: number;
  unit: string;
  department: string | null;
  urgency: string;
  notes: string | null;
  status: string;
  requestedBy: string;
  currentStock: number | null;
  createdAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  issued: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

export default function InventoryDemandPanel({ items }: { items: Item[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [department, setDepartment] = useState("");
  const [urgency, setUrgency] = useState<"normal" | "urgent">("normal");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState("pending");

  const { data: demands = [], isLoading } = useQuery<Demand[]>({
    queryKey: ["/api/inventory/demands", filter],
    queryFn: () => api.get(`/api/inventory/demands${filter !== "all" ? `?status=${filter}` : ""}`),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/inventory/demands", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/inventory/demands"] });
      setQuantity("1");
      setNotes("");
      toast({ title: "Demand submitted", description: "Store will review and issue stock." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: string; reason?: string }) =>
      api.post(`/api/inventory/demands/${id}/${action}`, reason ? { reason } : {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/inventory/demands"] });
      void qc.invalidateQueries({ queryKey: ["/api/inventory"] });
      void qc.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const pendingCount = demands.filter((d) => d.status === "pending").length;

  function submitDemand() {
    const qty = Number(quantity);
    if (!itemId || !Number.isFinite(qty) || qty <= 0) {
      toast({ title: "Select item and quantity", variant: "destructive" });
      return;
    }
    createMut.mutate({
      itemId: Number(itemId),
      quantity: qty,
      department: department.trim() || undefined,
      urgency,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Plus size={14} /> New Staff Demand
          </h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs">Item</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select item…" /></SelectTrigger>
                <SelectContent>
                  {items.filter((i) => i.id).map((it) => (
                    <SelectItem key={it.id} value={String(it.id)}>
                      {it.name} ({it.currentStock} {it.unit} in stock)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min="0.01" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Department</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Lab, USG" className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgency</Label>
              <Select value={urgency} onValueChange={(v) => setUrgency(v as "normal" | "urgent")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why needed, patient context…" className="h-9" />
            </div>
          </div>
          <Button size="sm" onClick={submitDemand} disabled={createMut.isPending}>
            Submit demand
          </Button>
        </div>

        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-semibold mb-1">How it works</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Staff submit what they need from store.</li>
            <li>Store approves or rejects the request.</li>
            <li>Issue deducts stock automatically and logs the transaction.</li>
          </ol>
          {pendingCount > 0 && (
            <p className="mt-2 text-xs font-bold">{pendingCount} pending demand{pendingCount === 1 ? "" : "s"} awaiting action</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <ClipboardList size={14} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
        {["pending", "approved", "issued", "rejected", "all"].map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} className="h-7 text-xs capitalize" onClick={() => setFilter(s)}>
            {s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading demands…</p>
      ) : demands.length === 0 ? (
        <p className="text-sm text-muted-foreground">No demands in this filter.</p>
      ) : (
        <div className="overflow-x-auto border border-card-border rounded-xl">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-muted/40">
              <tr>
                {["Item", "Qty", "Dept", "Requested by", "Stock", "Status", "Actions"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {demands.map((d) => (
                <tr key={d.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">
                    {d.itemName}
                    {d.urgency === "urgent" && <Badge className="ml-1 bg-red-500 text-white text-[9px]">URGENT</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{d.quantity} {d.unit}</td>
                  <td className="px-3 py-2">{d.department ?? "—"}</td>
                  <td className="px-3 py-2">{d.requestedBy}</td>
                  <td className="px-3 py-2 tabular-nums">{d.currentStock != null ? d.currentStock : "—"}</td>
                  <td className="px-3 py-2">
                    <Badge className={`text-[10px] capitalize ${STATUS_STYLE[d.status] ?? ""}`}>{d.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {d.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => actionMut.mutate({ id: d.id, action: "approve" })}>
                          <Check size={12} className="mr-0.5" /> Approve
                        </Button>
                        <Button size="sm" className="h-7 text-[10px]" onClick={() => actionMut.mutate({ id: d.id, action: "issue" })} disabled={!d.itemId}>
                          <PackageCheck size={12} className="mr-0.5" /> Issue
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive" onClick={() => actionMut.mutate({ id: d.id, action: "reject", reason: "Not available" })}>
                          <X size={12} />
                        </Button>
                      </div>
                    )}
                    {d.status === "approved" && (
                      <Button size="sm" className="h-7 text-[10px]" onClick={() => actionMut.mutate({ id: d.id, action: "issue" })} disabled={!d.itemId}>
                        <PackageCheck size={12} className="mr-0.5" /> Issue stock
                      </Button>
                    )}
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
