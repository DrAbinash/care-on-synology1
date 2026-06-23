import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, FlaskConical, Printer } from "lucide-react";
import SampleLabel, { printLabels } from "./SampleLabel";

type Patient = { id: number; firstName: string; lastName: string; patientId: string; phone: string; gender: string; dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null };
type OrderTest = { id: number; orderId: number; testId: number; price: string | number; testName?: string; testCode?: string };
type Order = {
  id: number; orderNumber: string; patientId: number; status: string; createdAt: string;
  patient: Patient | null; tests: Array<OrderTest & { testName?: string; testCode?: string; category?: string }>;
};

type Options = {
  sampleTypes: string[]; containerTypes: string[]; collectionSites: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  staffName?: string;
};

export default function CollectSampleModal({ open, onOpenChange, staffName }: Props) {
  const qc = useQueryClient();

  const { data: opts } = useQuery<Options>({
    queryKey: ["sample-options"],
    queryFn: () => api.get("/api/samples/options"),
  });

  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [pickedTestIds, setPickedTestIds] = useState<Set<number>>(new Set());
  const [sampleType, setSampleType] = useState("Blood");
  const [containerType, setContainerType] = useState("EDTA (Purple)");
  const [collectionSite, setCollectionSite] = useState("Center");
  const [volume, setVolume] = useState("");
  const [collectedBy, setCollectedBy] = useState(staffName ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdSample, setCreatedSample] = useState<{
    barcode: string; patient: Patient; tests: Array<{ testName: string }>;
  } | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setSearch(""); setSelectedOrderId(null); setPickedTestIds(new Set());
      setSampleType("Blood"); setContainerType("EDTA (Purple)"); setCollectionSite("Center");
      setVolume(""); setCollectedBy(staffName ?? ""); setNotes(""); setError(null);
      setCreatedSample(null);
    }
  }, [open, staffName]);

  const { data: ordersResp, isLoading: loadingOrders } = useQuery<{ orders: Order[] }>({
    queryKey: ["recent-orders-for-sample"],
    queryFn: () => api.get("/api/orders?limit=100"),
    enabled: open,
  });
  const orders = ordersResp?.orders ?? [];

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = orders;
    if (q) {
      list = list.filter((o) => {
        const p = o.patient;
        return (
          o.orderNumber.toLowerCase().includes(q) ||
          (p && (`${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.patientId.toLowerCase().includes(q) || p.phone.includes(q)))
        );
      });
    }
    return list.slice(0, 30);
  }, [orders, search]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  // Auto-select all tests when order is picked.
  useEffect(() => {
    if (selectedOrder) setPickedTestIds(new Set(selectedOrder.tests.map((t) => t.id)));
    else setPickedTestIds(new Set());
  }, [selectedOrder]);

  const togglePickedTest = (id: number) => {
    setPickedTestIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!selectedOrder) throw new Error("Pick an order first");
      const body = {
        orderId: selectedOrder.id,
        patientId: selectedOrder.patientId,
        sampleType, containerType, collectionSite,
        volume: volume.trim(),
        collectedByName: collectedBy.trim(),
        notes: notes.trim(),
        status: "collected" as const,
        orderTestIds: [...pickedTestIds],
      };
      return await api.post<{ id: number; barcode: string; patient: Patient; tests: Array<{ testName: string }> }>(
        "/api/samples", body,
      );
    },
    onSuccess: (sample) => {
      qc.invalidateQueries({ queryKey: ["samples"] });
      setCreatedSample(sample);
    },
    onError: (err) => setError((err as Error).message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedOrder) { setError("Please select an order first."); return; }
    if (pickedTestIds.size === 0) { setError("Pick at least one test for this sample."); return; }
    createMut.mutate();
  };

  const handlePrint = () => {
    const els = document.querySelectorAll<HTMLElement>("[data-sample-label]");
    if (els.length) printLabels([...els]);
  };

  // ─── Success view (shows label + Print) ───
  if (createdSample) {
    const p = createdSample.patient;
    const fullName = p ? `${p.firstName} ${p.lastName}` : "—";
    const ageStr = p ? `${calcAge(p.dateOfBirth, p.ageValue, p.ageUnit)}${p.ageUnit === "years" ? "y" : p.ageUnit === "months" ? "m" : p.ageUnit === "days" ? "d" : "y"}` : "";
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sample Collected ✓</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            <SampleLabel
              barcode={createdSample.barcode}
              patientName={fullName}
              patientId={p?.patientId}
              age={ageStr}
              gender={p?.gender}
              sampleType={sampleType}
              containerType={containerType}
              collectedAt={new Date().toISOString()}
              collectedByName={collectedBy}
              testNames={createdSample.tests.map((t) => t.testName).filter(Boolean)}
            />
            <p className="text-xs text-muted-foreground">Barcode: <code className="font-mono">{createdSample.barcode}</code></p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={() => { setCreatedSample(null); }}>Collect Another</Button>
            <Button onClick={handlePrint}><Printer size={14} className="mr-1" /> Print Label</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ─── Form view ───
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Collect New Sample</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">

          {/* Order picker */}
          <div>
            <Label className="text-xs">1. Select Order *</Label>
            {selectedOrder ? (
              <div className="mt-1 flex items-center justify-between border border-primary/30 bg-primary/5 rounded-md p-2">
                <div className="text-sm">
                  <div className="font-semibold">{selectedOrder.orderNumber} — {selectedOrder.patient?.firstName} {selectedOrder.patient?.lastName}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedOrder.patient?.patientId} • {selectedOrder.patient?.phone} • {selectedOrder.tests.length} test(s)
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedOrderId(null)}>Change</Button>
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by order number, patient name, ID, or phone…"
                    className="pl-7"
                    autoFocus
                  />
                </div>
                <div className="mt-2 max-h-52 overflow-y-auto border border-border rounded-md divide-y divide-border">
                  {loadingOrders ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Loading…</div>
                  ) : filteredOrders.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No orders match.</div>
                  ) : (
                    filteredOrders.map((o) => (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => setSelectedOrderId(o.id)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {o.orderNumber} — {o.patient?.firstName} {o.patient?.lastName}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {o.patient?.patientId} • {o.tests.length} test(s) • {new Date(o.createdAt).toLocaleDateString("en-IN")}
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${o.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                          {o.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Test picker */}
          {selectedOrder && (
            <div>
              <Label className="text-xs">2. Tests on this sample *</Label>
              <p className="text-[11px] text-muted-foreground mb-1">One container can carry multiple tests. Untick tests that go in a separate tube.</p>
              <div className="border border-border rounded-md divide-y divide-border max-h-44 overflow-y-auto">
                {selectedOrder.tests.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">This order has no tests.</div>
                ) : selectedOrder.tests.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={pickedTestIds.has(t.id)}
                      onChange={() => togglePickedTest(t.id)}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <FlaskConical size={14} className="text-muted-foreground" />
                    <span className="text-sm flex-1 min-w-0 truncate">{t.testName ?? `Test #${t.testId}`}</span>
                    {t.testCode && <span className="font-mono text-[10px] text-muted-foreground">{t.testCode}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Sample details */}
          {selectedOrder && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">3. Sample Type *</Label>
                <Select value={sampleType} onValueChange={setSampleType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts?.sampleTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Container *</Label>
                <Select value={containerType} onValueChange={setContainerType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts?.containerTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Volume</Label>
                <Input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="e.g. 5 ml" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Collection Site</Label>
                <Select value={collectionSite} onValueChange={setCollectionSite}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {opts?.collectionSites.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Collected by</Label>
                <Input value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} placeholder="Phlebotomist name" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Fasting, hemolysed, special instructions…" className="mt-1 min-h-[60px]" />
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-2">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!selectedOrder || createMut.isPending || pickedTestIds.size === 0}>
              {createMut.isPending ? "Saving…" : "Collect & Generate Barcode"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function calcAge(dob: string, ageValue?: number | null, ageUnit?: string | null): string {
  if (ageValue != null && ageUnit) {
    if (ageUnit === "years") return ageValue > 0 ? `${ageValue}` : "";
    if (ageUnit === "months") return `${ageValue}`;
    if (ageUnit === "days") return `${ageValue}`;
  }
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  return String(Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)));
}
