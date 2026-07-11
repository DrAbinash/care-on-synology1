import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import PageHeader from "@/components/PageHeader";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BookOpen, Calendar, AlertCircle, TrendingDown, Landmark, BadgePercent
} from "lucide-react";

type Lab = { id: number; name: string; isActive: boolean };
type LedgerRow = {
  id: number;
  transactionType: string;
  referenceId?: string | null;
  debitAmount: string | number;
  creditAmount: string | number;
  tdsDeducted: string | number;
  runningBalance: string | number;
  remarks?: string | null;
  transactionDate: string;
};

export default function OutsourceLedger() {
  const [selectedLabId, setSelectedLabId] = useState<string>("");

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ["outsourced-labs"],
    queryFn: () => api.get<Lab[]>("/api/outsourced-labs"),
  });

  const { data: ledger = [], isLoading } = useQuery<LedgerRow[]>({
    queryKey: ["ledger", selectedLabId],
    queryFn: () => api.get<LedgerRow[]>(`/api/outsourced-labs/${selectedLabId}/ledger`),
    enabled: !!selectedLabId,
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const activeLabs = labs.filter((l) => l.isActive);

  // Compute stats
  const totals = (() => {
    let totalDebit = 0;
    let totalCredit = 0;
    let totalTds = 0;
    ledger.forEach((row) => {
      totalDebit += Number(row.debitAmount);
      totalCredit += Number(row.creditAmount);
      totalTds += Number(row.tdsDeducted ?? 0);
    });
    const outstanding = ledger[0] ? Number(ledger[0].runningBalance) : 0;
    return { totalDebit, totalCredit, totalTds, outstanding };
  })();

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Vendor Ledger"
        subtitle="Track ledger logs, payouts, TDS statements, and outstanding balances per partner lab"
      />

      <div className="px-6 space-y-6">
        {/* Lab selector */}
        <div className="w-64 bg-card border border-border p-4 rounded-xl shadow-sm">
          <Label className="text-xs font-semibold text-muted-foreground uppercase">Reference Lab</Label>
          <Select value={selectedLabId} onValueChange={setSelectedLabId}>
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

        {selectedLabId && (
          <>
            {/* Account Summary strip */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Total Invoiced (Credits)</span>
                <span className="text-xl font-bold text-foreground mt-2">₹{totals.totalCredit.toFixed(2)}</span>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Total Paid (Debits)</span>
                <span className="text-xl font-bold text-foreground mt-2">₹{totals.totalDebit.toFixed(2)}</span>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase">TDS Deducted</span>
                <span className="text-xl font-bold text-foreground mt-2">₹{totals.totalTds.toFixed(2)}</span>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-150 p-4 rounded-xl shadow-sm flex flex-col justify-between">
                <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 uppercase">Outstanding Balance</span>
                <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-2">₹{totals.outstanding.toFixed(2)}</span>
              </div>
            </div>

            {/* Ledger Table */}
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-border/80 bg-muted/20 flex justify-between items-center">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <BookOpen size={15} />
                  Ledger Statement
                </h3>
                <span className="text-xs text-muted-foreground">{ledger.length} transactions</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/15">
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Tx Type</th>
                      <th className="px-5 py-3 font-medium">Reference ID</th>
                      <th className="px-5 py-3 font-medium text-right">Debit (Paid)</th>
                      <th className="px-5 py-3 font-medium text-right">Credit (Billed)</th>
                      <th className="px-5 py-3 font-medium text-right">TDS Deducted</th>
                      <th className="px-5 py-3 font-medium text-right">Running Balance</th>
                      <th className="px-5 py-3 font-medium">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [...Array(4)].map((_, i) => (
                        <tr key={i} className="border-b border-border/50 animate-pulse">
                          {[...Array(8)].map((_, j) => (
                            <td key={j} className="px-5 py-3"><div className="h-4 bg-muted rounded w-16 mx-auto" /></td>
                          ))}
                        </tr>
                      ))
                    ) : ledger.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-muted-foreground">
                          No transactions recorded in the ledger yet.
                        </td>
                      </tr>
                    ) : (
                      ledger.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-muted/10 last:border-0">
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5">
                              <Calendar size={12} />
                              {new Date(row.transactionDate).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              row.transactionType === "payment"
                                ? "bg-green-150 text-green-700 dark:bg-green-900/30"
                                : row.transactionType === "bill"
                                  ? "bg-amber-150 text-amber-700 dark:bg-amber-900/30"
                                  : "bg-muted text-muted-foreground"
                            }`}>
                              {row.transactionType}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                            {row.referenceId || "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-red-600 dark:text-red-400">
                            {Number(row.debitAmount) > 0 ? `₹${Number(row.debitAmount).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400">
                            {Number(row.creditAmount) > 0 ? `₹${Number(row.creditAmount).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs text-muted-foreground">
                            {Number(row.tdsDeducted) > 0 ? `₹${Number(row.tdsDeducted).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-xs font-bold text-foreground">
                            ₹{Number(row.runningBalance).toFixed(2)}
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground max-w-xs truncate">
                            {row.remarks || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!selectedLabId && (
          <div className="text-center py-20 bg-muted/10 border border-dashed rounded-2xl">
            <AlertCircle size={36} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <h3 className="font-semibold text-foreground text-sm">No Lab Selected</h3>
            <p className="text-xs text-muted-foreground mt-1">Select a reference lab above to inspect ledger statements</p>
          </div>
        )}
      </div>
    </div>
  );
}
