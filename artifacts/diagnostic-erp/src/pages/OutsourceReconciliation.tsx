import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { parseCsv } from "@/lib/csv";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Upload, CheckCircle2, ChevronRight, AlertCircle, ShieldAlert, ArrowRight, Table, Landmark
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Lab = {
  id: number;
  name: string;
  isActive: boolean;
  defaultTdsPercent: string | number;
  defaultPaymentMode: string;
};

type ReconResultItem = {
  patientName: string;
  labTestCode: string;
  labCost: string | number;
  reconciliationStatus: "matched" | "missing_erp" | "cost_mismatch";
  linkedOrderId: number | null;
  erpCost: number | null;
};

export default function OutsourceReconciliation() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [selectedLabId, setSelectedLabId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States for reconciliation
  const [parsing, setParsing] = useState(false);
  const [reconciledResults, setReconciledResults] = useState<ReconResultItem[] | null>(null);

  // Payout details state
  const [paymentMode, setPaymentMode] = useState<string>("bank_transfer");
  const [utrNumber, setUtrNumber] = useState<string>("");
  const [remarks, setRemarks] = useState<string>("");

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get<Lab[]>("/api/outsourced-labs"),
  });

  const activeLabs = labs.filter((l) => l.isActive);
  const selectedLab = labs.find((l) => String(l.id) === selectedLabId);

  const reconcileMutation = useMutation({
    mutationFn: (rows: any[]) =>
      api.post<{ results: ReconResultItem[] }>(`/api/outsourced-labs/${selectedLabId}/invoices/reconcile`, { rows }),
    onSuccess: (data) => {
      setReconciledResults(data.results);
      toast({ title: "Invoice processed successfully" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to reconcile invoice", description: e.message, variant: "destructive" });
    },
  });

  const settleMutation = useMutation({
    mutationFn: (body: any) =>
      api.post("/api/outsourced-labs/settlements/approve", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger", selectedLabId] });
      toast({ title: "Settlement posted to ledger successfully" });
      resetRecon();
    },
    onError: (e: Error) => {
      toast({ title: "Failed to post settlement", description: e.message, variant: "destructive" });
    },
  });

  const handleInvoiceChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsing(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No data could be read from this invoice CSV.", variant: "destructive" });
        setParsing(false);
        return;
      }

      // Map columns heuristically
      const normalized = rows.map((row) => {
        const patientName = row.patientName ?? row.patient ?? row.Name ?? row["Patient Name"] ?? row["patient_name"] ?? "";
        const labTestCode = row.code ?? row.testCode ?? row.test_code ?? row.Code ?? row["Test Code"] ?? row["labTestCode"] ?? "";
        const labCost = row.cost ?? row.Cost ?? row.labCost ?? row["Partner Cost"] ?? row["Lab Cost"] ?? row.net_cost ?? "0";

        return { patientName, labTestCode, labCost };
      }).filter((r) => r.patientName && r.labTestCode);

      if (normalized.length === 0) {
        toast({ title: "Mapping mismatch", description: "Could not auto-detect Patient Name, Test Code or Cost columns.", variant: "destructive" });
        setParsing(false);
        return;
      }

      reconcileMutation.mutate(normalized);
    } catch (err) {
      toast({ title: "Failed to parse CSV", description: (err as Error).message, variant: "destructive" });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resetRecon = () => {
    setReconciledResults(null);
    setUtrNumber("");
    setRemarks("");
  };

  const getStats = () => {
    if (!reconciledResults) return { matched: 0, costMismatch: 0, missingErp: 0, totalVendorCost: 0 };
    let matched = 0;
    let costMismatch = 0;
    let missingErp = 0;
    let totalVendorCost = 0;

    reconciledResults.forEach((r) => {
      totalVendorCost += Number(r.labCost);
      if (r.reconciliationStatus === "matched") matched++;
      else if (r.reconciliationStatus === "cost_mismatch") costMismatch++;
      else if (r.reconciliationStatus === "missing_erp") missingErp++;
    });

    return { matched, costMismatch, missingErp, totalVendorCost };
  };

  const stats = getStats();
  const tdsPercent = selectedLab ? Number(selectedLab.defaultTdsPercent ?? 10) : 10;
  const computedTds = (stats.totalVendorCost * tdsPercent) / 100;
  const netPayable = stats.totalVendorCost - computedTds;

  const handleSettleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLabId || stats.totalVendorCost <= 0) return;

    settleMutation.mutate({
      labId: Number(selectedLabId),
      amountPaid: netPayable.toFixed(2),
      tdsDeducted: computedTds.toFixed(2),
      paymentMode,
      utrChequeNumber: utrNumber,
      remarks: remarks || `Invoice Reconciliation Settlement for ${selectedLab?.name}`,
    });
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Reconciliation Studio"
        subtitle="Compare reference lab monthly bills with ERP entries to detect cost variances or missing orders"
      />

      <div className="px-6 space-y-6">
        {/* Selector & Uploader */}
        <div className="flex gap-4 items-end flex-wrap bg-card border border-border p-4 rounded-xl shadow-sm">
          <div className="w-64">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Reference Lab</Label>
            <Select value={selectedLabId} onValueChange={(v) => { setSelectedLabId(v); resetRecon(); }}>
              <SelectTrigger className="mt-1 bg-background">
                <SelectValue placeholder="Select a Reference Lab..." />
              </SelectTrigger>
              <SelectContent>
                {activeLabs.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedLabId && !reconciledResults && (
            <div>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleInvoiceChosen} />
              <Button size="sm" className="bg-primary text-white hover:bg-primary/90" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                <Upload size={14} className="mr-1.5" />
                {parsing ? "Parsing Invoice..." : "Upload Vendor Invoice CSV"}
              </Button>
            </div>
          )}

          {reconciledResults && (
            <Button size="sm" variant="outline" onClick={resetRecon}>
              Reset Reconciliation
            </Button>
          )}
        </div>

        {reconciledResults && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Reconciliation Audit Grid */}
            <div className="lg:col-span-3 space-y-4">
              {/* Stats Summary strip */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 p-4 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase">Matched Records</span>
                  <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-2">{stats.matched} items</span>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-150 p-4 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase">Cost Mismatches</span>
                  <span className="text-xl font-bold text-amber-700 dark:text-amber-400 mt-2">{stats.costMismatch} items</span>
                </div>
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-150 p-4 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-semibold text-red-800 dark:text-red-300 uppercase">Missing in ERP</span>
                  <span className="text-xl font-bold text-red-700 dark:text-red-400 mt-2">{stats.missingErp} items</span>
                </div>
              </div>

              {/* Mismatch table */}
              <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border/80 bg-muted/20">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Table size={15} />
                    Audit Logs & Warnings
                  </h3>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/15 sticky top-0">
                        <th className="px-4 py-2.5 font-medium">Patient Name</th>
                        <th className="px-4 py-2.5 font-medium">Test Code</th>
                        <th className="px-4 py-2.5 font-medium text-right">Invoice Cost</th>
                        <th className="px-4 py-2.5 font-medium text-right">ERP Card Rate</th>
                        <th className="px-4 py-2.5 font-medium text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciledResults.map((item, idx) => (
                        <tr key={idx} className={`border-b border-border/50 last:border-0 hover:bg-muted/10 ${
                          item.reconciliationStatus === "cost_mismatch"
                            ? "bg-amber-500/5"
                            : item.reconciliationStatus === "missing_erp"
                              ? "bg-red-500/5"
                              : ""
                        }`}>
                          <td className="px-4 py-2.5 font-medium text-foreground">{item.patientName}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{item.labTestCode}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-foreground">
                            ₹{Number(item.labCost).toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                            {item.erpCost != null ? `₹${item.erpCost.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.reconciliationStatus === "matched"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30"
                                : item.reconciliationStatus === "cost_mismatch"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30"
                                  : "bg-red-100 text-red-700 dark:bg-red-900/30"
                            }`}>
                              {item.reconciliationStatus.replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Payables Settlement card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4 self-start">
              <h3 className="font-bold text-foreground flex items-center gap-1.5">
                <Landmark size={16} className="text-primary" />
                Accounts Settlement
              </h3>
              <div className="space-y-3 border-b border-border pb-4 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Gross Invoice Cost:</span>
                  <span className="font-bold text-foreground">₹{stats.totalVendorCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>TDS Deductions ({tdsPercent}%):</span>
                  <span className="font-semibold text-red-500">- ₹{computedTds.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t border-border pt-2 text-foreground">
                  <span>Net Payable Amount:</span>
                  <span className="text-primary">₹{netPayable.toFixed(2)}</span>
                </div>
              </div>

              <form onSubmit={handleSettleSubmit} className="space-y-3 pt-2">
                <div>
                  <Label className="text-[11px] font-semibold text-foreground">Payment Mode</Label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value)}
                    className="mt-1 w-full text-xs border rounded-md px-2 py-2 bg-background border-input text-foreground"
                  >
                    <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
                    <option value="upi">UPI ID</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>

                <div>
                  <Label className="text-[11px] font-semibold text-foreground">UTR / Transaction / Cheque No *</Label>
                  <Input
                    value={utrNumber}
                    onChange={(e) => setUtrNumber(e.target.value)}
                    className="mt-1 bg-background text-xs"
                    placeholder="Enter payment reference"
                    required
                  />
                </div>

                <div>
                  <Label className="text-[11px] font-semibold text-foreground">Remarks</Label>
                  <Input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="mt-1 bg-background text-xs"
                    placeholder="E.g. Settled June bill"
                  />
                </div>

                <Button type="submit" className="w-full bg-emerald-600 text-white hover:bg-emerald-700 mt-2 text-xs h-9" disabled={settleMutation.isPending}>
                  {settleMutation.isPending ? "Settling Ledger..." : "Approve & Settle Payout"}
                </Button>
              </form>
            </div>
          </div>
        )}

        {!selectedLabId && (
          <div className="text-center py-20 bg-muted/10 border border-dashed rounded-2xl">
            <AlertCircle size={36} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <h3 className="font-semibold text-foreground text-sm">No Lab Selected</h3>
            <p className="text-xs text-muted-foreground mt-1">Select a reference lab above to audit vendor monthly bills</p>
          </div>
        )}
      </div>
    </div>
  );
}
