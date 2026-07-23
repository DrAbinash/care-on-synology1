import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, AlertTriangle, AlertOctagon, FileWarning,
  Printer, RefreshCw, Calendar, FileSpreadsheet, Layers,
} from "lucide-react";

type Severity = "high" | "medium" | "low";

type ExceptionGroup = {
  key: string;
  source: string;
  category: string;
  severity: Severity;
  count: number;
  totalAmount: number;
  description: string;
  rows: Record<string, unknown>[];
};

type SourceStatus = { source: string; available: boolean; error?: string };

type Report = {
  generatedAt: string;
  range: { from: string; to: string };
  summary: {
    totalExceptions: number;
    groups: number;
    high: number;
    medium: number;
    low: number;
    totalAmountAtRisk: number;
  };
  sources: SourceStatus[];
  exceptions: ExceptionGroup[];
};

function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function fmtINR(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
}
function severityChip(sev: Severity) {
  if (sev === "high") return { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", icon: AlertOctagon, label: "High" };
  if (sev === "medium") return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", icon: AlertTriangle, label: "Medium" };
  return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", icon: FileWarning, label: "Low" };
}

export default function ReconciliationCenter() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());

  const { data, isLoading, refetch, isFetching } = useQuery<Report>({
    queryKey: ["reconciliation", from, to],
    queryFn: () => api.get<Report>(`/api/dashboard/reconciliation?from=${from}&to=${to}`),
    staleTime: 60_000,
  });

  const summary = data?.summary;
  const unavailable = useMemo(
    () => (data?.sources ?? []).filter((s) => !s.available),
    [data],
  );

  function preset(days: number) {
    setFrom(daysAgoISO(days));
    setTo(todayISO());
  }

  function exportCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`"Care Diagnostics — Reconciliation Center"`);
    lines.push(`"Period","${data.range.from}","to","${data.range.to}"`);
    lines.push(`"Generated at","${data.generatedAt}"`);
    lines.push(`"Total exceptions","${data.summary.totalExceptions}","Amount at risk","${fmtINR(data.summary.totalAmountAtRisk)}"`);
    lines.push("");
    for (const g of data.exceptions) {
      lines.push(`"${g.source}","${g.category}","Severity: ${g.severity}","Count: ${g.count}","Amount: ${fmtINR(g.totalAmount)}"`);
      if (g.rows.length > 0) {
        const cols = Object.keys(g.rows[0]);
        lines.push(cols.map((c) => `"${c}"`).join(","));
        for (const r of g.rows) {
          lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
        }
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 reconciliation-root">
      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">Reconciliation Center — Exceptions Report</h1>
        <p className="text-center text-sm text-gray-600">
          Period: {data?.range.from} to {data?.range.to} · Generated: {data ? new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}
        </p>
        <hr className="mt-3" />
      </div>

      <div className="print:hidden">
        <PageHeader
          title="Reconciliation Center"
          subtitle="Every open financial, operational and banking exception in one owner view — consolidated from Books Sanity, fraud detection, bank reconciliation and billing."
        />
      </div>

      {/* Filters / actions */}
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 print:hidden flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
            <Calendar size={11} /> From
          </label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
            <Calendar size={11} /> To
          </label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => preset(0)}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => preset(6)}>7d</Button>
          <Button variant="outline" size="sm" onClick={() => preset(29)}>30d</Button>
          <Button variant="outline" size="sm" onClick={() => preset(89)}>90d</Button>
        </div>
        <Button onClick={() => refetch()} variant="outline" disabled={isFetching}>
          <RefreshCw size={14} className={`mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="flex-1" />
        <Button onClick={exportCsv} variant="outline" disabled={!data}>
          <FileSpreadsheet size={14} className="mr-1.5" /> Export CSV
        </Button>
        <Button onClick={() => window.print()} disabled={!data}>
          <Printer size={14} className="mr-1.5" /> Print
        </Button>
      </div>

      {/* Summary tiles */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryTile label="Open exceptions" value={String(summary.totalExceptions)} tone={summary.totalExceptions > 0 ? "amber" : "green"} icon={Layers} />
          <SummaryTile label="High severity" value={String(summary.high)} tone={summary.high > 0 ? "red" : "green"} icon={AlertOctagon} />
          <SummaryTile label="Medium" value={String(summary.medium)} tone={summary.medium > 0 ? "amber" : "green"} icon={AlertTriangle} />
          <SummaryTile label="Low" value={String(summary.low)} tone="blue" icon={FileWarning} />
          <SummaryTile label="Amount at risk" value={fmtINR(summary.totalAmountAtRisk)} tone={summary.totalAmountAtRisk > 0 ? "amber" : "green"} icon={AlertTriangle} />
        </div>
      )}

      {/* Degraded-source notice */}
      {unavailable.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 print:hidden">
          Some detectors could not run: {unavailable.map((s) => s.source).join(", ")}. Their exceptions are not included below.
        </div>
      )}

      {isLoading && <div className="p-8 text-center text-gray-500">Loading reconciliation exceptions…</div>}

      {/* All clear */}
      {data && data.exceptions.length === 0 && !isLoading && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-8 text-center">
          <ShieldCheck className="mx-auto text-emerald-500 mb-3" size={48} />
          <div className="font-bold text-gray-900 dark:text-foreground">All reconciled</div>
          <div className="text-sm text-gray-500">No open exceptions across any detector for the selected period.</div>
        </div>
      )}

      {/* Exception groups */}
      {data?.exceptions.map((g) => {
        const chip = severityChip(g.severity);
        const Icon = chip.icon;
        const cols = g.rows[0] ? Object.keys(g.rows[0]) : [];
        return (
          <div key={g.key} className={`bg-white dark:bg-card border ${chip.border} rounded-xl shadow-sm overflow-hidden print:shadow-none print:rounded-none`}>
            <div className={`px-4 py-3 ${chip.bg} flex items-start gap-3 border-b ${chip.border}`}>
              <Icon className={chip.text} size={18} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-white/70 text-gray-700 border border-gray-300">{g.source}</span>
                    <h3 className="font-bold text-gray-900">{g.category}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${chip.bg} ${chip.text} border ${chip.border}`}>{chip.label}</span>
                    <span className="text-xs font-semibold text-gray-700">{g.count} item(s)</span>
                    {g.totalAmount > 0 && <span className="text-xs font-bold text-gray-900">{fmtINR(g.totalAmount)}</span>}
                  </div>
                </div>
                <p className="text-xs text-gray-700 mt-1">{g.description}</p>
              </div>
            </div>
            {g.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-muted/30">
                    <tr>
                      {cols.map((c) => (
                        <th key={c} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {cols.map((c) => (
                          <td key={c} className="px-3 py-1.5 whitespace-nowrap text-gray-800">
                            {String(r[c] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .reconciliation-root { padding: 0 !important; }
          aside, header, nav, .sidebar, [data-sidebar] { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function SummaryTile({
  label, value, tone, icon: Icon,
}: {
  label: string;
  value: string;
  tone: "red" | "amber" | "blue" | "green";
  icon: typeof Layers;
}) {
  const toneCls: Record<string, string> = {
    red: "bg-red-50 border-red-200 text-red-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    green: "bg-emerald-50 border-emerald-200 text-emerald-800",
  };
  return (
    <div className={`rounded-xl border p-3 ${toneCls[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold opacity-80">
        <Icon size={12} /> {label}
      </div>
      <div className="text-lg font-extrabold tabular-nums mt-1">{value}</div>
    </div>
  );
}
