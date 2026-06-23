import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowDown, IndianRupee, Truck, PackageCheck, FlaskConical } from "lucide-react";

type ReportRow = {
  sampleId: number;
  barcode: string;
  status: string;
  outsourceLab: string | null;
  outsourceSentAt: string | null;
  outsourceReceivedAt: string | null;
  outsourceCostAmount: number | string | null;
  outsourceCostOverride: number | string | null;
  outsourcePatientBill: number | string | null;
  outsourceMargin: number | string | null;
  tests: Array<{ name: string; code: string }>;
};

export default function OutsourcedCostReport() {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [labFilter, setLabFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data: labsList = [] } = useQuery<Array<{ id: number; name: string; isActive: boolean }>>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get("/api/outsourced-labs"),
  });

  const { data, isLoading } = useQuery<{ rows: ReportRow[] }>({
    queryKey: ["outsourced-cost-report", dateFrom, dateTo, labFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (labFilter) params.set("lab", labFilter);
      if (statusFilter) params.set("status", statusFilter);
      return api.get(`/api/reports/outsourced-cost?${params.toString()}`);
    },
  });

  const rows = data?.rows ?? [];
  const labs = labsList.filter((l) => l.isActive !== false);

  const totals = useMemo(() => {
    let cost = 0;
    let bill = 0;
    let margin = 0;
    for (const r of rows) {
      const oc = r.outsourceCostOverride != null ? Number(r.outsourceCostOverride) : Number(r.outsourceCostAmount ?? 0);
      cost += oc;
      bill += Number(r.outsourcePatientBill ?? 0);
      margin += Number(r.outsourceMargin ?? 0);
    }
    return { cost, bill, margin };
  }, [rows]);

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Cost Report"
        subtitle="Cost tracking and margin analysis for externally-sent samples"
        actions={
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <IndianRupee size={14} className="mr-1" /> Print
          </Button>
        }
      />

      <div className="px-6 space-y-4">
        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-40" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-40" />
          </div>
          <div>
            <Label className="text-xs">Lab</Label>
            <Select value={labFilter || "all"} onValueChange={(v) => setLabFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1 w-44"><SelectValue placeholder="All labs" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Labs</SelectItem>
                {labs.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="mt-1 w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="received">Received</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Outsource Cost</div>
            <div className="text-xl font-bold text-foreground mt-1">₹{totals.cost.toFixed(2)}</div>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4 shadow-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Patient Bill</div>
            <div className="text-xl font-bold text-foreground mt-1">₹{totals.bill.toFixed(2)}</div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 shadow-sm">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Net Margin</div>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">₹{totals.margin.toFixed(2)}</div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Barcode</th>
                  <th className="px-4 py-3 font-medium">Lab</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Tests</th>
                  <th className="px-4 py-3 font-medium text-right">Computed Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Final Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Patient Bill</th>
                  <th className="px-4 py-3 font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(8)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-16" /></td>)}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Truck size={28} className="mx-auto mb-2 opacity-30" />
                    No outsourced samples in this date range
                  </td></tr>
                ) : (
                  rows.map((r) => {
                    const finalCost = r.outsourceCostOverride != null ? Number(r.outsourceCostOverride) : Number(r.outsourceCostAmount ?? 0);
                    return (
                      <tr key={r.sampleId} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs font-bold">{r.barcode}</td>
                        <td className="px-4 py-3">{r.outsourceLab ?? "—"}</td>
                        <td className="px-4 py-3">
                          {r.outsourceReceivedAt ? (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs font-medium">Received</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs font-medium">Sent</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <FlaskConical size={12} className="text-muted-foreground" />
                            <span className="text-xs">{r.tests.length} test{r.tests.length === 1 ? "" : "s"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">₹{Number(r.outsourceCostAmount ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-foreground">₹{finalCost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-foreground">₹{Number(r.outsourcePatientBill ?? 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300">₹{Number(r.outsourceMargin ?? 0).toFixed(2)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
