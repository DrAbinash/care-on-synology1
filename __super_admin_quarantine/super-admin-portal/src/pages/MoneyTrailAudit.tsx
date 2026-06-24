import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ShieldCheck, AlertTriangle, AlertOctagon, FileWarning,
  Printer, RefreshCw, Calendar, FileSpreadsheet, Save, History, Trash2, Eye,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";

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

type AuditRun = {
  id: number;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  completedAt: string | null;
  completedBy: string | null;
  source: "manual" | "cron";
  notes: string | null;
  anomalyCount: number;
  highCount: number;
  totalImpact: string;
  emailSentAt: string | null;
};

type SavedAudit = AuditRun & { snapshot: Report };

function todayISO() { return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function fmtINR(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n ?? 0));
}
function fmtNum(n: number | string | null | undefined) { return Number(n ?? 0).toLocaleString("en-IN"); }
function severityChip(sev: Anomaly["severity"]) {
  if (sev === "high") return { bg: "bg-red-100", text: "text-red-800", border: "border-red-300", icon: AlertOctagon, label: "High" };
  if (sev === "medium") return { bg: "bg-amber-100", text: "text-amber-800", border: "border-amber-300", icon: AlertTriangle, label: "Medium" };
  return { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-300", icon: FileWarning, label: "Low" };
}

export default function MoneyTrailAudit({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"run" | "history">("run");

  // Run-new state
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [previewKey, setPreviewKey] = useState<{ from: string; to: string } | null>(null);
  const [notes, setNotes] = useState("");

  // History state
  const [viewing, setViewing] = useState<SavedAudit | null>(null);

  // Live preview report
  const { data: preview, isFetching: previewFetching } = useQuery<Report>({
    queryKey: ["sa-books-sanity-preview", previewKey?.from, previewKey?.to],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/books-sanity-preview?from=${previewKey!.from}&to=${previewKey!.to}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!previewKey,
    staleTime: 60_000,
  });

  // History list
  const { data: historyData, isLoading: historyLoading } = useQuery<{ items: AuditRun[] }>({
    queryKey: ["sa-audit-runs"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/audit-runs", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load audit history");
      return res.json();
    },
  });

  // Save audit mutation
  const saveAudit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/super-admin/audit-runs", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, notes: notes.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as SavedAudit;
    },
    onSuccess: () => {
      toast({ title: "Audit saved", description: "Snapshot stored in history." });
      setNotes("");
      qc.invalidateQueries({ queryKey: ["sa-audit-runs"] });
      setTab("history");
    },
    onError: (err) => toast({ title: "Save failed", description: String(err), variant: "destructive" }),
  });

  // Delete mutation
  const delAudit = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/super-admin/audit-runs/${id}`, { method: "DELETE", headers: saAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Audit removed from history." });
      qc.invalidateQueries({ queryKey: ["sa-audit-runs"] });
      if (viewing) setViewing(null);
    },
  });

  // Open one historical audit
  async function openAudit(id: number) {
    const res = await fetch(`/api/super-admin/audit-runs/${id}`, { headers: saAuthHeaders() });
    if (!res.ok) { toast({ title: "Failed to open", variant: "destructive" }); return; }
    setViewing(await res.json());
  }

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6 mta-root">
      {/* Header — print-hidden */}
      <div className="print:hidden mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => (viewing ? setViewing(null) : onBack())}>
            <ArrowLeft size={16} className="mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldCheck className="text-primary" size={20} /> Money Trail Audit
            </h1>
            <p className="text-xs text-muted-foreground">
              Run, sign off and archive comprehensive money-trail audits. Auto-runs on the 1st of each month.
            </p>
          </div>
        </div>
        {!viewing && (
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            <Button size="sm" variant={tab === "run" ? "default" : "ghost"} onClick={() => setTab("run")}>
              Run New
            </Button>
            <Button size="sm" variant={tab === "history" ? "default" : "ghost"} onClick={() => setTab("history")}>
              <History size={14} className="mr-1" /> History {historyData ? `(${historyData.items.length})` : ""}
            </Button>
          </div>
        )}
      </div>

      {viewing && <SnapshotView audit={viewing} onDelete={() => delAudit.mutate(viewing.id)} />}

      {!viewing && tab === "run" && (
        <>
          <div className="bg-card border border-border rounded-xl p-4 print:hidden mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs flex items-center gap-1 mb-1"><Calendar size={11} /> From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1 mb-1"><Calendar size={11} /> To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={() => setPreviewKey({ from, to })} disabled={previewFetching}>
              <RefreshCw size={14} className={`mr-1.5 ${previewFetching ? "animate-spin" : ""}`} /> Run Audit
            </Button>
            <div className="flex-1 min-w-[16rem]">
              <Label className="text-xs mb-1">Reviewer notes (optional)</Label>
              <Input placeholder="e.g. reviewed with CA Sharma on 2 Jun" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button
              onClick={() => saveAudit.mutate()}
              disabled={!preview || saveAudit.isPending}
              variant="default"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Save size={14} className="mr-1.5" /> Mark Audit Complete
            </Button>
          </div>

          {!preview && !previewFetching && (
            <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
              Pick a date range and click <b>Run Audit</b> to generate the report. Click <b>Mark Audit Complete</b> to save it to history.
            </div>
          )}

          {preview && <ReportView report={preview} />}
        </>
      )}

      {!viewing && tab === "history" && (
        <HistoryList
          loading={historyLoading}
          items={historyData?.items ?? []}
          onOpen={openAudit}
          onDelete={(id) => delAudit.mutate(id)}
        />
      )}

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .mta-root { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

function HistoryList({
  loading, items, onOpen, onDelete,
}: { loading: boolean; items: AuditRun[]; onOpen: (id: number) => void; onDelete: (id: number) => void }) {
  if (loading) return <div className="p-12 text-center text-muted-foreground">Loading history…</div>;
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
        No audits saved yet. Run one from the <b>Run New</b> tab.
      </div>
    );
  }
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Period</th>
            <th className="px-3 py-2 text-left">Generated</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Signed off by</th>
            <th className="px-3 py-2 text-right">Anomalies</th>
            <th className="px-3 py-2 text-right">Impact</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((it) => (
            <tr key={it.id} className="hover:bg-muted/30">
              <td className="px-3 py-2 font-mono text-xs">#{it.id}</td>
              <td className="px-3 py-2">{it.periodFrom} → {it.periodTo}</td>
              <td className="px-3 py-2 text-xs">{new Date(it.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              <td className="px-3 py-2">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${it.source === "cron" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {it.source}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                {it.completedBy ?? <span className="text-muted-foreground italic">awaiting review</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <span className="font-semibold">{it.anomalyCount}</span>
                {it.highCount > 0 && <span className="text-red-600 ml-1 text-xs">({it.highCount} high)</span>}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtINR(it.totalImpact)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => onOpen(it.id)}><Eye size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete audit #${it.id}?`)) onDelete(it.id); }}>
                  <Trash2 size={14} className="text-red-600" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotView({ audit, onDelete }: { audit: SavedAudit; onDelete: () => void }) {
  return (
    <div>
      <div className="bg-card border border-border rounded-xl p-4 mb-4 print:hidden flex items-center gap-3">
        <div className="flex-1">
          <div className="font-bold">Audit #{audit.id} · {audit.periodFrom} → {audit.periodTo}</div>
          <div className="text-xs text-muted-foreground">
            Generated {new Date(audit.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            {audit.completedBy && ` · signed off by ${audit.completedBy}`}
            {audit.source === "cron" && " · auto-generated by monthly cron"}
          </div>
          {audit.notes && <div className="text-xs mt-1"><b>Notes:</b> {audit.notes}</div>}
        </div>
        <Button onClick={() => window.print()}><Printer size={14} className="mr-1.5" /> Print</Button>
        <Button variant="outline" onClick={onDelete} className="text-red-600 border-red-300">
          <Trash2 size={14} className="mr-1.5" /> Delete
        </Button>
      </div>
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold text-center">Money Trail Audit — Archived Snapshot</h1>
        <p className="text-center text-sm">
          Audit #{audit.id} · Period {audit.periodFrom} to {audit.periodTo} ·
          Generated {new Date(audit.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
          {audit.completedBy && ` · Signed off by ${audit.completedBy}`}
        </p>
        {audit.notes && <p className="text-center text-xs mt-1"><b>Notes:</b> {audit.notes}</p>}
        <hr className="mt-3" />
      </div>
      <ReportView report={audit.snapshot} forArchive={{ id: audit.id, completedBy: audit.completedBy ?? "" }} />
    </div>
  );
}

function ReportView({ report, forArchive }: { report: Report; forArchive?: { id: number; completedBy: string } }) {
  const t = report.periodTotals;
  const totalAnomalies = useMemo(() => report.anomalies.reduce((s, a) => s + a.count, 0), [report]);
  const highCount = report.anomalies.filter((a) => a.severity === "high").reduce((s, a) => s + a.count, 0);

  function exportCsv() {
    const lines: string[] = [];
    lines.push(`"Money-Trail Audit"`);
    lines.push(`"Period","${report.range.from}","to","${report.range.to}"`);
    lines.push(`"Generated at","${report.generatedAt}"`);
    lines.push("");
    for (const a of report.anomalies) {
      lines.push(`"${a.category}","Severity: ${a.severity}","Count: ${a.count}","Impact: ${fmtINR(a.totalAmount)}"`);
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
    a.download = `money-trail-audit_${report.range.from}_to_${report.range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 print:hidden">
          <h2 className="text-base font-bold">Period Summary</h2>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <FileSpreadsheet size={14} className="mr-1.5" /> Export CSV
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Bills" value={fmtNum(t.bill_count)} />
          <Stat label="Subtotal" value={fmtINR(t.subtotal_sum)} />
          <Stat label="Discount" value={fmtINR(t.discount_sum)} />
          <Stat label="Tax" value={fmtINR(t.tax_sum)} />
          <Stat label="Total Billed" value={fmtINR(t.total_sum)} bold />
          <Stat label="Paid" value={fmtINR(t.paid_sum)} />
          <Stat label="Refunded" value={fmtINR(t.refund_sum)} />
          <Stat label="Outstanding" value={fmtINR(t.balance_sum)} />
          <Stat label="Cancelled bills" value={fmtNum(t.cancelled_count)} />
          <Stat label="Cancelled amount" value={fmtINR(t.cancelled_amount)} />
        </div>
      </div>

      <div className={`rounded-xl p-4 border-l-4 ${highCount > 0 ? "bg-red-50 border-red-500" : totalAnomalies > 0 ? "bg-amber-50 border-amber-500" : "bg-emerald-50 border-emerald-500"}`}>
        <div className="flex items-center gap-3">
          {highCount > 0 ? <AlertOctagon className="text-red-600" /> : totalAnomalies > 0 ? <AlertTriangle className="text-amber-600" /> : <ShieldCheck className="text-emerald-600" />}
          <div className="font-bold text-gray-900">
            {highCount > 0
              ? `${highCount} HIGH-severity issue(s) found · ${totalAnomalies} total flagged rows`
              : totalAnomalies > 0
                ? `${totalAnomalies} item(s) flagged for review (no high-severity)`
                : "No anomalies. Books reconcile cleanly for the selected period."}
          </div>
        </div>
      </div>

      {report.anomalies.map((a, idx) => {
        const chip = severityChip(a.severity);
        const Icon = chip.icon;
        const cols = a.rows[0] ? Object.keys(a.rows[0]) : [];
        return (
          <div key={idx} className={`bg-card border ${chip.border} rounded-xl shadow-sm overflow-hidden print:rounded-none`}>
            <div className={`px-4 py-3 ${chip.bg} flex items-start gap-3 border-b ${chip.border}`}>
              <Icon className={chip.text} size={18} />
              <div className="flex-1">
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
                  <thead className="bg-muted/50">
                    <tr>{cols.map((c) => <th key={c} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{c}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {a.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {cols.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{String(r[c] ?? "—")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* CA sign-off block — for printed page */}
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
            <p className="font-bold mb-12">For Care Diagnostics (Super Admin):</p>
            <div className="border-t border-gray-400 pt-1">
              <p>{forArchive?.completedBy || "Authorised Signatory"}</p>
              <p className="text-xs text-gray-600 mt-2">{forArchive ? `Audit #${forArchive.id}` : ""}</p>
              <p className="text-xs text-gray-600">Date: ____________</p>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-500 mt-8 text-center">
          Generated automatically from the Care Diagnostics ERP. Snapshot stored permanently in audit_runs.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
      <div className={`tabular-nums ${bold ? "text-base font-extrabold" : "text-sm font-bold"}`}>{value}</div>
    </div>
  );
}
