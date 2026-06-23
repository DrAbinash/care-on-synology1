import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { parseCsv } from "@/lib/csv";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, Upload, CheckCircle2, ChevronRight, AlertCircle, ArrowRight, Sparkles, RefreshCcw
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Lab = { id: number; name: string; isActive: boolean };
type RateCard = {
  id: number;
  labTestCode: string;
  testName: string;
  department?: string | null;
  mrp: string | number;
  partnerCost: string | number;
  commissionPercent: string | number;
};

type ImportPreview = {
  newItems: any[];
  costChanges: any[];
  duplicates: string[];
};

export default function OutsourceRateCards() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedLabId, setSelectedLabId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States for importing
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<any[] | null>(null);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get<Lab[]>("/api/outsourced-labs"),
  });

  const { data: rateCards = [], isLoading: loadingRates } = useQuery<RateCard[]>({
    queryKey: ["rate-cards", selectedLabId],
    queryFn: () => api.get<RateCard[]>(`/api/outsourced-labs/${selectedLabId}/rate-cards`),
    enabled: !!selectedLabId && !previewData,
  });

  const importPreviewMutation = useMutation({
    mutationFn: (rows: any[]) =>
      api.post<ImportPreview>(`/api/outsourced-labs/${selectedLabId}/rate-cards/import`, { rows }),
    onSuccess: (data) => {
      setPreviewData(data);
    },
    onError: (e: Error) => {
      toast({ title: "Import mapping failed", description: e.message, variant: "destructive" });
      setParsedRows(null);
    },
  });

  const commitMutation = useMutation({
    mutationFn: (rows: any[]) =>
      api.post(`/api/outsourced-labs/${selectedLabId}/rate-cards/save`, { rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rate-cards", selectedLabId] });
      toast({ title: "Rate card committed successfully" });
      resetImport();
    },
    onError: (e: Error) => {
      toast({ title: "Failed to commit rate card", description: e.message, variant: "destructive" });
    },
  });

  const activeLabs = labs.filter((l) => l.isActive);

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No rows could be parsed from this CSV.", variant: "destructive" });
        setImporting(false);
        return;
      }

      // Map columns heuristically
      const normalized = rows.map((row) => {
        const labTestCode = row.code ?? row.testCode ?? row.test_code ?? row.Code ?? row["Test Code"] ?? row["labTestCode"] ?? "";
        const testName = row.name ?? row.testName ?? row.test_name ?? row.Name ?? row["Test Name"] ?? row["testName"] ?? "";
        const mrp = row.mrp ?? row.MRP ?? row.price ?? row.Price ?? row.mrp_rate ?? "0";
        const partnerCost = row.cost ?? row.Cost ?? row.partnerCost ?? row.net_cost ?? row["Net Cost"] ?? row["Partner Cost"] ?? "0";
        const commissionPercent = row.commission ?? row.commissionPercent ?? row["Commission %"] ?? "0";
        const department = row.department ?? row.Department ?? "Pathology";

        return { labTestCode, testName, mrp, partnerCost, commissionPercent, department };
      }).filter((r) => r.labTestCode && r.testName);

      if (normalized.length === 0) {
        toast({ title: "Mapping mismatch", description: "Could not auto-detect Test Code or Test Name columns.", variant: "destructive" });
        setImporting(false);
        return;
      }

      setParsedRows(normalized);
      importPreviewMutation.mutate(normalized);
    } catch (err) {
      toast({ title: "Failed to read file", description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const resetImport = () => {
    setParsedRows(null);
    setPreviewData(null);
  };

  const handleCommit = () => {
    if (!parsedRows) return;
    commitMutation.mutate(parsedRows);
  };

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Rate Cards"
        subtitle="Manage investigation catalogs, revenue shares, and cost profiles per vendor"
      />

      <div className="px-6 space-y-6">
        {/* Lab selector & Actions */}
        <div className="flex gap-4 items-end flex-wrap bg-card border border-border p-4 rounded-xl shadow-sm">
          <div className="w-64">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Reference Lab</Label>
            <Select value={selectedLabId} onValueChange={(v) => { setSelectedLabId(v); resetImport(); }}>
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

          {selectedLabId && !previewData && (
            <div>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChosen} />
              <Button size="sm" className="bg-primary text-white hover:bg-primary/90" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                <Upload size={14} className="mr-1.5" />
                {importing ? "Processing..." : "Import Rate Card CSV"}
              </Button>
            </div>
          )}

          {previewData && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetImport}>
                Cancel Import
              </Button>
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleCommit} disabled={commitMutation.isPending}>
                <CheckCircle2 size={14} className="mr-1.5" />
                {commitMutation.isPending ? "Saving..." : "Commit Rate Card"}
              </Button>
            </div>
          )}
        </div>

        {/* Import Preview view */}
        {previewData && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold mb-3">
                <Sparkles size={16} />
                <span>New Investigations ({previewData.newItems.length})</span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {previewData.newItems.map((item, idx) => (
                  <div key={idx} className="bg-background/80 dark:bg-background/40 border border-emerald-100 dark:border-emerald-950 p-2.5 rounded-lg text-xs">
                    <div className="font-bold text-foreground">{item.testName}</div>
                    <div className="flex justify-between text-muted-foreground mt-1">
                      <span>Code: <strong className="font-mono text-foreground">{item.labTestCode}</strong></span>
                      <span>Cost: <strong className="text-emerald-600 dark:text-emerald-400">₹{Number(item.partnerCost).toFixed(2)}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold mb-3">
                <RefreshCcw size={16} />
                <span>Cost Updates ({previewData.costChanges.length})</span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {previewData.costChanges.map((item, idx) => (
                  <div key={idx} className="bg-background/80 dark:bg-background/40 border border-amber-100 dark:border-amber-950 p-2.5 rounded-lg text-xs">
                    <div className="font-bold text-foreground">{item.testName}</div>
                    <div className="flex justify-between items-center text-muted-foreground mt-1">
                      <span>Code: <strong className="font-mono text-foreground">{item.labTestCode}</strong></span>
                      <span className="flex items-center gap-1">
                        <span className="line-through text-red-500">₹{Number(item.oldCost).toFixed(0)}</span>
                        <ArrowRight size={10} />
                        <strong className="text-amber-600 dark:text-amber-400 font-bold">₹{Number(item.newCost).toFixed(0)}</strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2 text-muted-foreground font-bold mb-3">
                <AlertTriangle size={16} className="text-orange-500" />
                <span>Duplicates & Notes</span>
              </div>
              <div className="space-y-4 text-xs">
                {previewData.duplicates.length > 0 ? (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive p-3 rounded-lg flex gap-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold">Duplicate Codes Detected ({previewData.duplicates.length})</h4>
                      <p className="mt-0.5 leading-relaxed text-muted-foreground">The following codes appear multiple times in the sheet and will be deduplicated:</p>
                      <div className="mt-1.5 font-mono flex flex-wrap gap-1">
                        {previewData.duplicates.map((c) => (
                          <span key={c} className="px-1.5 py-0.5 bg-background border rounded text-foreground">{c}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 p-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    <span>All test codes are unique and valid.</span>
                  </div>
                )}
                <div className="bg-muted p-3.5 rounded-lg text-muted-foreground leading-relaxed">
                  <strong>Notice:</strong> Committing this rate card will deactivate older rates for the selected lab. Any pending referred invoices will still use the rate effective at the time of order creation.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Existing Rate Card list */}
        {selectedLabId && !previewData && (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/80 bg-muted/20 flex justify-between items-center">
              <h3 className="font-semibold text-foreground">Current Rate catalog</h3>
              <span className="text-xs text-muted-foreground">{rateCards.length} active investigations</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/15">
                    <th className="px-5 py-3 font-medium">Lab Code</th>
                    <th className="px-5 py-3 font-medium">Test Name</th>
                    <th className="px-5 py-3 font-medium">Department</th>
                    <th className="px-5 py-3 font-medium text-right">MRP (₹)</th>
                    <th className="px-5 py-3 font-medium text-right">Partner Net Cost (₹)</th>
                    <th className="px-5 py-3 font-medium text-right">Commission (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingRates ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="border-b border-border/50 animate-pulse">
                        {[...Array(6)].map((_, j) => (
                          <td key={j} className="px-5 py-3"><div className="h-4 bg-muted rounded w-20" /></td>
                        ))}
                      </tr>
                    ))
                  ) : rateCards.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
                        No rate cards loaded yet. Upload a CSV to configure rates.
                      </td>
                    </tr>
                  ) : (
                    rateCards.map((rc) => (
                      <tr key={rc.id} className="border-b border-border/50 hover:bg-muted/10 last:border-0">
                        <td className="px-5 py-3 font-mono text-xs font-bold text-primary">{rc.labTestCode}</td>
                        <td className="px-5 py-3 font-medium text-foreground">{rc.testName}</td>
                        <td className="px-5 py-3 text-muted-foreground text-xs">{rc.department || "Pathology"}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs">₹{Number(rc.mrp).toFixed(2)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs font-bold text-foreground">₹{Number(rc.partnerCost).toFixed(2)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">{Number(rc.commissionPercent).toFixed(1)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!selectedLabId && (
          <div className="text-center py-20 bg-muted/10 border border-dashed rounded-2xl">
            <AlertCircle size={36} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <h3 className="font-semibold text-foreground text-sm">No Lab Selected</h3>
            <p className="text-xs text-muted-foreground mt-1">Select a reference lab above to inspect or configure rate cards</p>
          </div>
        )}
      </div>
    </div>
  );
}
