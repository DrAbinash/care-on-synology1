import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, AlertTriangle, AlertOctagon, FileWarning,
  Printer, RefreshCw, Calendar, FileSpreadsheet,
} from "lucide-react";

type Anomaly = {
  category: string;
  severity: "high" | "medium" | "low";
  count: number;
  totalAmount: number;
  description: string;
  rows: Record<string, unknown>[];
};

type Report = {
  range: { from: string; to: string };
  generatedAt: string;
  periodTotals: Record<string, string | number>;
  anomalies: Anomaly[];
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
function fmtNum(n: number | string | null | undefined) {
  return Number(n ?? 0).toLocaleString("en-IN");
}
function severityChip(sev: Anomaly["severity"]) {
  if (sev === "high") return { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", icon: AlertOctagon, label: "High" };
  if (sev === "medium") return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", icon: AlertTriangle, label: "Medium" };
  return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", icon: FileWarning, label: "Low" };
}

export default function BooksSanity() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());

  const { data, isLoading, refetch, isFetching } = useQuery<Report>({
    queryKey: ["books-sanity", from, to],
    queryFn: () => api.get<Report>(`/api/books-sanity?from=${from}&to=${to}`),
    staleTime: 60_000,
  });

  const totalsRow = data?.periodTotals ?? {};
  const totalAnomalies = useMemo(
    () => (data?.anomalies ?? []).reduce((s, a) => s + a.count, 0),
    [data],
  );
  const highCount = (data?.anomalies ?? []).filter((a) => a.severity === "high").reduce((s, a) => s + a.count, 0);

  function handlePrint() {
    window.print();
  }

  function exportCsv() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`"Care Diagnostics Books Sanity Report"`);
    lines.push(`"Period","${data.range.from}","to","${data.range.to}"`);
    lines.push(`"Generated at","${data.generatedAt}"`);
    lines.push("");
    for (const a of data.anomalies) {
      lines.push(`"${a.category}","Severity: ${a.severity}","Count: ${a.count}","Amount impact: ${fmtINR(a.totalAmount)}"`);
      if (a.rows.length > 0) {
        const cols = Object.keys(a.rows[0]);
        lines.push(cols.map((c) => `"${c}"`).join(","));
        for (const r of a.rows) {
          lines.push(cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
        }
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `books-sanity_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 books-sanity-root">
      {/* Print-only header — visible only on the printed page */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">Books Sanity Report — for CA Review</h1>
        <p className="text-center text-sm text-gray-600">
          Period: {data?.range.from} to {data?.range.to} · Generated: {data ? new Date(data.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : ""}
        </p>
        <hr className="mt-3" />
      </div>

      <div className="print:hidden">
        <PageHeader
          title="Books Sanity & CA Review"
          subtitle="Cross-checks the money trail end-to-end. Flags anything a Chartered Accountant should look at."
        />
      </div>

      {/* Filters / actions — hidden on print */}
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
        <Button onClick={() => refetch()} variant="outline" disabled={isFetching}>
          <RefreshCw size={14} className={`mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <div className="flex-1" />
        <Button onClick={exportCsv} variant="outline" disabled={!data}>
          <FileSpreadsheet size={14} className="mr-1.5" /> Export CSV
        </Button>
        <Button onClick={handlePrint} disabled={!data}>
          <Printer size={14} className="mr-1.5" /> Print for CA
        </Button>
      </div>

      {/* Period summary */}
      {data && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-5 print:border print:rounded-none">
          <h2 className="text-base font-bold text-gray-900 dark:text-foreground mb-3">Period Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat label="Bills" value={fmtNum(totalsRow.bill_count)} />
            <Stat label="Subtotal" value={fmtINR(totalsRow.subtotal_sum)} />
            <Stat label="Discount" value={fmtINR(totalsRow.discount_sum)} />
            <Stat label="Tax" value={fmtINR(totalsRow.tax_sum)} />
            <Stat label="Total Billed" value={fmtINR(totalsRow.total_sum)} bold />
            <Stat label="Paid" value={fmtINR(totalsRow.paid_sum)} />
            <Stat label="Refunded" value={fmtINR(totalsRow.refund_sum)} />
            <Stat label="Outstanding" value={fmtINR(totalsRow.balance_sum)} />
            <Stat label="Cancelled bills" value={fmtNum(totalsRow.cancelled_count)} />
            <Stat label="Cancelled amount" value={fmtINR(totalsRow.cancelled_amount)} />
          </div>
        </div>
      )}

      {/* Anomaly headline */}
      {data && (
        <div className={`rounded-xl p-4 border-l-4 ${highCount > 0 ? "bg-red-50 border-red-500" : totalAnomalies > 0 ? "bg-amber-50 border-amber-500" : "bg-emerald-50 border-emerald-500"}`}>
          <div className="flex items-center gap-3">
            {highCount > 0 ? <AlertOctagon className="text-red-600" /> : totalAnomalies > 0 ? <AlertTriangle className="text-amber-600" /> : <ShieldCheck className="text-emerald-600" />}
            <div>
              <div className="font-bold text-gray-900">
                {highCount > 0
                  ? `${highCount} HIGH-severity issue(s) found · ${totalAnomalies} total flagged rows`
                  : totalAnomalies > 0
                    ? `${totalAnomalies} item(s) flagged for review (no high-severity)`
                    : "No anomalies. Books reconcile cleanly for the selected period."}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                Print this page and hand it to your Chartered Accountant — every flagged row drills down to its source bill.
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading && <div className="p-8 text-center text-gray-500">Loading books sanity report…</div>}

      {/* Anomaly sections */}
      {data?.anomalies.length === 0 && !isLoading && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-8 text-center">
          <ShieldCheck className="mx-auto text-emerald-500 mb-3" size={48} />
          <div className="font-bold text-gray-900">All clear</div>
          <div className="text-sm text-gray-500">Every check passed for the selected period.</div>
        </div>
      )}

      {data?.anomalies.map((a, idx) => {
        const chip = severityChip(a.severity);
        const Icon = chip.icon;
        const cols = a.rows[0] ? Object.keys(a.rows[0]) : [];
        return (
          <div key={idx} className={`bg-white dark:bg-card border ${chip.border} rounded-xl shadow-sm overflow-hidden print:shadow-none print:rounded-none`}>
            <div className={`px-4 py-3 ${chip.bg} flex items-start gap-3 border-b ${chip.border}`}>
              <Icon className={chip.text} size={18} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-900">{a.category}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${chip.bg} ${chip.text} border ${chip.border}`}>{chip.label}</span>
                    <span className="text-xs font-semibold text-gray-700">{a.count} row(s)</span>
                    {a.totalAmount > 0 && <span className="text-xs font-bold text-gray-900">{fmtINR(a.totalAmount)}</span>}
                  </div>
                </div>
                <p className="text-xs text-gray-700 mt-1">{a.description}</p>
              </div>
            </div>
            {a.rows.length > 0 && (
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
                    {a.rows.map((r, i) => (
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

      {/* CA sign-off block — for the printed page */}
      {data && (
        <div className="hidden print:block mt-12 pt-8 border-t-2 border-gray-300 break-inside-avoid">
          <div className="grid grid-cols-2 gap-12 text-sm">
            <div>
              <p className="font-bold mb-12">Reviewed by (Chartered Accountant):</p>
              <div className="border-t border-gray-400 pt-1">
                <p>Name & Signature</p>
                <p className="text-xs text-gray-600 mt-2">Membership No.: ____________</p>
                <p className="text-xs text-gray-600">Date: ____________</p>
              </div>
            </div>
            <div>
              <p className="font-bold mb-12">For Care Diagnostics:</p>
              <div className="border-t border-gray-400 pt-1">
                <p>Authorised Signatory</p>
                <p className="text-xs text-gray-600 mt-2">Name: ____________</p>
                <p className="text-xs text-gray-600">Date: ____________</p>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-8 text-center">
            This report is generated automatically from the Care Diagnostics ERP. Every flagged row references the original bill in the system audit log.
          </p>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .books-sanity-root { padding: 0 !important; }
          aside, header, nav, .sidebar, [data-sidebar] { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</div>
      <div className={`tabular-nums ${bold ? "text-base font-extrabold text-gray-900" : "text-sm font-bold text-gray-800"}`}>{value}</div>
    </div>
  );
}
