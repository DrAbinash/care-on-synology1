import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Search, RefreshCw, Download, IndianRupee, AlertCircle,
  TrendingUp, Users, Wallet, Receipt, Trash2, Plus, X, BookOpen, Clock,
  RotateCcw, FileText, Printer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { saAuthHeaders } from "@/lib/saApi";
import { exportDoctorStatementPdf, type StatementDetail } from "@/lib/exportDoctorStatementPdf";
import {
  useGetDoctorLedgerSummary,
  useGetDoctorLedgerDetail,
  getGetDoctorLedgerDetailQueryKey,
  useCreateDoctorPayout,
  useDeleteDoctorPayout,
  type DoctorLedgerSummary,
  type DoctorLedgerDetail,
  type DoctorLedgerRow,
  type DoctorPayout,
} from "@workspace/api-client-react";

const inr = (n: number) =>
  `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayStr = () => new Date().toISOString().split("T")[0];
const monthStartStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

const PRESETS = [
  { label: "This Month", from: monthStartStr(), to: todayStr() },
  { label: "Last 30d", from: new Date(Date.now() - 30 * 86400e3).toISOString().split("T")[0], to: todayStr() },
  { label: "Last 90d", from: new Date(Date.now() - 90 * 86400e3).toISOString().split("T")[0], to: todayStr() },
  { label: "All time", from: "", to: "" },
];

export default function DoctorLedger({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [search, setSearch] = useState("");

  const [openDoctorId, setOpenDoctorId] = useState<number | null>(null);

  // When Pay is clicked from the summary table the detail may not be loaded yet.
  // pendingPayDialog defers opening the pay dialog until we have a doctorId.
  const [pendingPayDialog, setPendingPayDialog] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: "", paymentDate: todayStr(), paymentMethod: "cash",
    reference: "", notes: "", periodFrom: "", periodTo: "",
  });
  const [deletingPayout, setDeletingPayout] = useState<DoctorPayout | null>(null);

  const summaryParams = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const {
    data,
    isLoading,
    refetch: refetchSummary,
    error: summaryError,
    queryKey: summaryQueryKey,
  } = useGetDoctorLedgerSummary(summaryParams);

  useEffect(() => {
    if (summaryError) {
      toast({ title: "Failed to load doctor ledger", description: String(summaryError), variant: "destructive" });
    }
  }, [summaryError, toast]);

  const detailParams = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
    queryKey: detailQueryKey,
  } = useGetDoctorLedgerDetail(openDoctorId ?? 0, detailParams, {
    query: {
      enabled: openDoctorId !== null,
      queryKey: getGetDoctorLedgerDetailQueryKey(openDoctorId ?? 0, detailParams),
    },
  });

  useEffect(() => {
    if (detailError) {
      toast({ title: "Failed to load ledger", description: String(detailError), variant: "destructive" });
    }
  }, [detailError, toast]);

  // Once detail has loaded and we have a pending pay dialog, open it.
  useEffect(() => {
    if (pendingPayDialog && detail?.doctor.id) {
      setPendingPayDialog(false);
      setPayDialogOpen(true);
    }
  }, [pendingPayDialog, detail]);

  const createPayoutMutation = useCreateDoctorPayout({
    mutation: {
      onSuccess: () => {
        const amt = Number(payForm.amount);
        toast({ title: "Payment recorded", description: `${inr(amt)} paid to ${detail?.doctor.name ?? "doctor"}` });
        setPayDialogOpen(false);
        setPayForm({
          amount: "", paymentDate: todayStr(), paymentMethod: "cash",
          reference: "", notes: "", periodFrom: "", periodTo: "",
        });
        queryClient.invalidateQueries({ queryKey: detailQueryKey });
        queryClient.invalidateQueries({ queryKey: summaryQueryKey });
      },
      onError: (err: unknown) => {
        toast({ title: "Failed to record payment", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      },
    },
  });

  const deletePayoutMutation = useDeleteDoctorPayout({
    mutation: {
      onSuccess: () => {
        toast({ title: "Payout deleted" });
        setDeletingPayout(null);
        queryClient.invalidateQueries({ queryKey: detailQueryKey });
        queryClient.invalidateQueries({ queryKey: summaryQueryKey });
      },
      onError: (err: unknown) => {
        toast({ title: "Delete failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      },
    },
  });

  const filteredRows = useMemo((): DoctorLedgerRow[] => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data.rows;
    return data.rows.filter((r: DoctorLedgerRow) =>
      r.doctorName.toLowerCase().includes(term) ||
      (r.specialization || "").toLowerCase().includes(term),
    );
  }, [data, search]);

  const submitPayout = () => {
    if (openDoctorId === null) return;
    const amt = Number(payForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    createPayoutMutation.mutate({
      doctorId: openDoctorId,
      data: {
        amount: amt,
        paymentDate: payForm.paymentDate,
        paymentMethod: payForm.paymentMethod,
        reference: payForm.reference || null,
        notes: payForm.notes || null,
        periodFrom: payForm.periodFrom || null,
        periodTo: payForm.periodTo || null,
      },
    });
  };

  const confirmDeletePayout = () => {
    if (!deletingPayout) return;
    deletePayoutMutation.mutate({ id: deletingPayout.id });
  };

  // CSV export uses a raw fetch instead of a generated hook because the
  // endpoint returns a binary file (text/csv). A generated query hook would
  // parse the response as JSON, mangling the file. saAuthHeaders() injects the
  // USB key + SA token headers that the generated custom-fetch also uses.
  const exportCSV = async (currentDetail: DoctorLedgerDetail) => {
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = `/api/doctor-ledger/${currentDetail.doctor.id}/export?${params.toString()}`;
      const res = await fetch(url, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `doctor_ledger_${currentDetail.doctor.name.replace(/[^a-z0-9]+/gi, "_")}_${from || "all"}_${to || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const exportStatement = async (currentDetail: DoctorLedgerDetail) => {
    try {
      await exportDoctorStatementPdf(currentDetail as unknown as StatementDetail, {
        generatedAt: new Date().toLocaleString("en-IN"),
      });
    } catch (err) {
      toast({ title: "Statement export failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // Only eligible (non-held) commission is payable. dueWindow / outstanding are
  // already computed from payable-only totals server-side, so the "eligible due"
  // is simply the outstanding (falling back to the window figure).
  const eligibleDue = detail
    ? (detail.summary.outstanding > 0 ? detail.summary.outstanding : detail.summary.dueWindow)
    : 0;
  const heldNow = detail ? ((detail.summary as { totalHeld?: number }).totalHeld ?? 0) : 0;
  const payAmt = Number(payForm.amount) || 0;

  const prefillFullDue = () => {
    if (eligibleDue > 0) setPayForm(p => ({ ...p, amount: eligibleDue.toFixed(2) }));
  };

  const totals = data?.totals ?? { doctors: 0, earnedWindow: 0, paidWindow: 0, dueWindow: 0, outstanding: 0 };

  // ── Batch payout worksheet ────────────────────────────────────────────────
  // One sheet for a whole settlement run: every doctor's eligible due, what is
  // being held back and why it isn't payable, a column to write the amount
  // actually paid, and a signature column. Deliberately prints only the
  // PAYABLE figure — held commission is shown separately so nobody settles
  // against money that has not been collected.
  const printPayoutWorksheet = () => {
    const rows = filteredRows;
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const sum = (f: (r: DoctorLedgerRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const held = (r: DoctorLedgerRow) => (r as { heldWindow?: number }).heldWindow ?? 0;
    const period = `${from || "beginning"} to ${to || "today"}`;

    const body = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><strong>${esc(r.doctorName)}</strong>${r.specialization ? `<div class="sub">${esc(r.specialization)}</div>` : ""}</td>
      <td class="c">${r.orderCount ?? ""}</td>
      <td class="r">${inr(r.earnedWindow)}</td>
      <td class="r">${inr(r.paidWindow)}</td>
      <td class="r due"><strong>${inr(r.dueWindow)}</strong></td>
      <td class="r hold">${held(r) > 0.005 ? inr(held(r)) : "—"}</td>
      <td class="pay"></td>
      <td class="sign"></td>
    </tr>`).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payout Worksheet</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;padding:16px}
      h1{font-size:16px;text-align:center;text-transform:uppercase;letter-spacing:.06em}
      .meta{text-align:center;font-size:10px;color:#555;margin:4px 0 12px}
      table{width:100%;border-collapse:collapse}
      th{background:#f0f0f0;border:1px solid #bbb;padding:5px 6px;font-size:9px;text-transform:uppercase;color:#444}
      td{border:1px solid #ccc;padding:6px;vertical-align:middle}
      td.c,th.c{text-align:center}
      td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
      td.due{background:#fff8e6}
      td.hold{color:#b91c1c}
      td.pay{width:90px;background:#fafafa}
      td.sign{width:120px}
      .sub{font-size:9px;color:#666}
      tfoot td{font-weight:bold;background:#fef3c7;border-top:2px solid #92400e}
      .note{margin-top:10px;font-size:9px;color:#555;line-height:1.5}
      .sigrow{margin-top:26px;display:flex;justify-content:space-between;font-size:10px}
      .sigrow div{width:30%;border-top:1px solid #333;padding-top:4px;text-align:center}
      @media print{@page{size:A4 landscape;margin:10mm}body{padding:0}}
    </style></head><body>
      <h1>Doctor Commission — Payout Worksheet</h1>
      <div class="meta">Period: ${esc(period)} &nbsp;·&nbsp; ${rows.length} doctor${rows.length === 1 ? "" : "s"} &nbsp;·&nbsp; Generated ${new Date().toLocaleString("en-IN")}</div>
      <table>
        <thead><tr>
          <th class="c">#</th><th>Referring Doctor</th><th class="c">Referrals</th>
          <th class="r">Eligible Earned</th><th class="r">Already Paid</th><th class="r">Due Now</th>
          <th class="r">On Hold<br>(not payable)</th><th class="c">Amount Paid</th><th class="c">Signature</th>
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr>
          <td colspan="3" class="c">TOTAL</td>
          <td class="r">${inr(sum(r => r.earnedWindow))}</td>
          <td class="r">${inr(sum(r => r.paidWindow))}</td>
          <td class="r">${inr(sum(r => r.dueWindow))}</td>
          <td class="r">${inr(sum(held))}</td>
          <td></td><td></td>
        </tr></tfoot>
      </table>
      <div class="note">
        <strong>Due Now</strong> is eligible commission only — it excludes anything still On Hold.
        Held commission becomes payable automatically once its condition is met (usually the patient's
        bill being settled in full); it is listed here for visibility, not for payment.
      </div>
      <div class="sigrow"><div>Prepared by</div><div>Verified by</div><div>Authorised by</div></div>
    </body></html>`;

    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the worksheet.", variant: "destructive" });
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Doctor Due / Payment Ledger</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Commission earned, paid and outstanding per doctor
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <KpiCard icon={<Users size={16} />} label="Doctors" value={String(totals.doctors)} />
          <KpiCard icon={<TrendingUp size={16} />} label="Earned (window)" value={inr(totals.earnedWindow)} />
          <KpiCard icon={<Wallet size={16} />} label="Paid (window)" value={inr(totals.paidWindow)} />
          <KpiCard icon={<IndianRupee size={16} />} label="Due (window)" value={inr(totals.dueWindow)} tone={totals.dueWindow > 0 ? "warn" : "ok"} />
          <KpiCard icon={<AlertCircle size={16} />} label="Outstanding (lifetime)" value={inr(totals.outstanding)} tone={totals.outstanding > 0 ? "danger" : "ok"} />
          <KpiCard icon={<Clock size={16} />} label="On Hold (window)" value={inr((totals as { heldWindow?: number }).heldWindow ?? 0)} />
        </div>

        {/* Filters */}
        <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 text-muted-foreground" size={14} />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Doctor name or specialization"
                className="pl-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[150px]" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[150px]" />
          </div>
          <div className="flex gap-1">
            {PRESETS.map(p => (
              <Button
                key={p.label}
                size="sm"
                variant="outline"
                onClick={() => { setFrom(p.from); setTo(p.to); }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={printPayoutWorksheet} disabled={filteredRows.length === 0}>
            <Printer size={14} className="mr-1" /> Payout Worksheet
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetchSummary()}>
            <RefreshCw size={14} className="mr-1" /> Refresh
          </Button>
        </div>

        {/* Doctor table */}
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Doctor</th>
                  <th className="px-4 py-3 font-medium">Orders (window)</th>
                  <th className="px-4 py-3 font-medium text-right">Earned (window)</th>
                  <th className="px-4 py-3 font-medium text-right">Paid (window)</th>
                  <th className="px-4 py-3 font-medium text-right">Due (window)</th>
                  <th className="px-4 py-3 font-medium text-right">Outstanding (life)</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-24" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No doctors found</td></tr>
                ) : (
                  filteredRows.map(r => (
                    <tr key={r.doctorId} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.doctorName}</div>
                        <div className="text-xs text-muted-foreground">{r.specialization}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.orderCount}</td>
                      <td className="px-4 py-3 text-right font-mono">{inr(r.earnedWindow)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{inr(r.paidWindow)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${r.dueWindow > 0 ? "text-amber-600" : ""}`}>{inr(r.dueWindow)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${r.outstanding > 0 ? "text-rose-600" : "text-muted-foreground"}`}>{inr(r.outstanding)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setOpenDoctorId(r.doctorId)}>
                            <BookOpen size={14} className="mr-1" /> Ledger
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setOpenDoctorId(r.doctorId);
                              setPendingPayDialog(true);
                            }}
                          >
                            <Plus size={14} className="mr-1" /> Pay
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Per-doctor ledger drawer */}
      <Dialog open={openDoctorId !== null} onOpenChange={(v) => { if (!v) { setOpenDoctorId(null); setPendingPayDialog(false); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="flex items-center gap-2">
                <BookOpen size={18} />
                {detail?.doctor.name ?? "Loading…"}
                <span className="text-sm font-normal text-muted-foreground">
                  {detail?.doctor.specialization}
                </span>
              </DialogTitle>
            </div>
          </DialogHeader>

          {detailLoading ? (
            <div className="py-12 text-center text-muted-foreground">Loading ledger…</div>
          ) : !detail ? null : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <SummaryTile label="Earned (window)" value={inr(detail.summary.totalEarned)} />
                <SummaryTile label="Paid (window)" value={inr(detail.summary.totalPaid)} tone="ok" />
                <SummaryTile label="Due (window)" value={inr(detail.summary.dueWindow)} tone={detail.summary.dueWindow > 0 ? "warn" : "ok"} />
                <SummaryTile label="Outstanding (life)" value={inr(detail.summary.outstanding)} tone={detail.summary.outstanding > 0 ? "danger" : "ok"} />
                <SummaryTile label="On Hold (window)" value={inr((detail.summary as { totalHeld?: number }).totalHeld ?? 0)} />
              </div>

              {(() => {
                const heldOrders = (((detail as { earnedOrders?: ReadonlyArray<{ orderNumber: string; commission: number; held?: boolean; holdReason?: string | null }> }).earnedOrders) ?? []).filter(o => o.held);
                if (heldOrders.length === 0) return null;
                return (
                  <div className="rounded-xl border border-rose-900 bg-rose-950/30 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5 text-rose-700 dark:text-rose-400">
                      <Clock size={14} />
                      <p className="text-xs font-semibold">On Hold — not payable yet ({heldOrders.length} order{heldOrders.length === 1 ? "" : "s"})</p>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {heldOrders.map((o) => (
                        <div key={o.orderNumber} className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-mono text-muted-foreground truncate">{o.orderNumber}</span>
                          <span className="text-rose-600 dark:text-rose-400 truncate flex-1">{o.holdReason ?? "On hold"}</span>
                          <span className="font-mono tabular-nums">{inr(o.commission)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {(() => {
                // Clawbacks: commission that was previously eligible (payable) and has
                // since been reversed to On Hold — a bill cancelled/refunded after the
                // fact. Informational: it already dropped out of the due total, this
                // just explains why.
                const clawbacks = ((detail as { clawbacks?: ReadonlyArray<{ orderId: number; amount: number; reason: string; at: string }> }).clawbacks) ?? [];
                const totalClawback = (detail.summary as { totalClawback?: number }).totalClawback ?? 0;
                if (clawbacks.length === 0) return null;
                return (
                  <div className="rounded-xl border border-amber-900 bg-amber-950/30 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5 text-amber-400">
                      <div className="flex items-center gap-1.5">
                        <RotateCcw size={14} />
                        <p className="text-xs font-semibold">Reversed after eligibility ({clawbacks.length} order{clawbacks.length === 1 ? "" : "s"})</p>
                      </div>
                      <span className="text-xs font-mono tabular-nums">−{inr(totalClawback)}</span>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {clawbacks.map((c) => (
                        <div key={c.orderId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-mono text-muted-foreground truncate">#{c.orderId}</span>
                          <span className="text-amber-400 truncate flex-1">{c.reason}</span>
                          <span className="font-mono tabular-nums">{inr(c.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] text-amber-600/80 dark:text-amber-500/70">
                      Already excluded from Due / Outstanding. Shown for audit — if any amount was already paid out, recover it on the next payout.
                    </p>
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setPayDialogOpen(true)}>
                  <Plus size={14} className="mr-1" /> Record Payment
                </Button>
                <Button variant="outline" onClick={() => detail && exportCSV(detail)}>
                  <Download size={14} className="mr-1" /> Export CSV
                </Button>
                <Button variant="outline" onClick={() => detail && exportStatement(detail)}>
                  <FileText size={14} className="mr-1" /> Statement PDF
                </Button>
                <div className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  Window: {from || "all"} → {to || "all"}
                </span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 text-xs font-medium uppercase tracking-wide flex items-center gap-2">
                  <Receipt size={14} /> Ledger entries
                </div>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Particular</th>
                        <th className="px-3 py-2 text-right">Credit (Earned)</th>
                        <th className="px-3 py-2 text-right">Debit (Paid)</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                        <th className="px-3 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.ledger.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-xs">No entries in this window</td></tr>
                      ) : (
                        detail.ledger.map((e, i) => (
                          <tr key={`${e.kind}-${e.id ?? e.ref ?? "x"}-${e.date}-${i}`} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{e.date}</td>
                            <td className="px-3 py-2">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded mr-1 ${e.kind === "earned" ? "bg-blue-900/30 text-blue-400" : "bg-emerald-900/30 text-emerald-400"}`}>
                                {e.kind === "earned" ? "EARN" : "PAID"}
                              </span>
                              {e.particular}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-blue-600">{e.credit ? inr(e.credit) : ""}</td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-600">{e.debit ? inr(e.debit) : ""}</td>
                            <td className={`px-3 py-2 text-right font-mono font-semibold ${e.balance > 0 ? "text-rose-600" : e.balance < 0 ? "text-emerald-700" : ""}`}>{inr(e.balance)}</td>
                            <td className="px-3 py-2">
                              {e.kind === "paid" && e.id ? (
                                <button
                                  onClick={() => {
                                    const p = detail.payouts.find(po => po.id === e.id);
                                    if (p) setDeletingPayout(p);
                                  }}
                                  className="text-rose-500 hover:text-rose-700"
                                  title="Delete payout"
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {detail.ledger.length > 0 && (
                      <tfoot>
                        <tr className="bg-muted/40 border-t border-border font-semibold text-sm">
                          <td colSpan={2} className="px-3 py-2">Window totals</td>
                          <td className="px-3 py-2 text-right font-mono">{inr(detail.summary.totalEarned)}</td>
                          <td className="px-3 py-2 text-right font-mono">{inr(detail.summary.totalPaid)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${detail.summary.dueWindow > 0 ? "text-rose-600" : ""}`}>{inr(detail.summary.dueWindow)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDoctorId(null)}>
              <X size={14} className="mr-1" /> Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment to {detail?.doctor.name ?? "Doctor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Amount (₹) *</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payForm.amount}
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00"
                />
                <Button type="button" variant="outline" size="sm" onClick={prefillFullDue} disabled={!detail || eligibleDue <= 0}>
                  Pay eligible due
                </Button>
              </div>
              {detail && (
                <div className="text-xs text-muted-foreground mt-1">
                  Eligible due: <span className="font-mono font-semibold text-foreground">{inr(eligibleDue)}</span>
                  {" · "}Window: <span className="font-mono">{inr(detail.summary.dueWindow)}</span>
                  {heldNow > 0 && (
                    <>
                      {" · "}
                      <span className="text-rose-600 dark:text-rose-400">On hold (not payable): <span className="font-mono">{inr(heldNow)}</span></span>
                    </>
                  )}
                </div>
              )}
              {detail && payAmt > 0 && payAmt > eligibleDue + 0.005 && (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-900 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-400">
                  <AlertCircle size={13} className="mt-px shrink-0" />
                  <span>
                    This is <span className="font-mono font-semibold">{inr(payAmt - eligibleDue)}</span> more than the eligible due
                    {heldNow > 0 ? " — held commission is not payable until its condition is met." : "."} You can still record it if intentional (e.g. an advance).
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment Date *</Label>
                <Input type="date" value={payForm.paymentDate} onChange={e => setPayForm(p => ({ ...p, paymentDate: e.target.value }))} />
              </div>
              <div>
                <Label>Method *</Label>
                <Select value={payForm.paymentMethod} onValueChange={v => setPayForm(p => ({ ...p, paymentMethod: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Reference / Cheque No</Label>
              <Input value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period From</Label>
                <Input type="date" value={payForm.periodFrom} onChange={e => setPayForm(p => ({ ...p, periodFrom: e.target.value }))} />
              </div>
              <div>
                <Label>Period To</Label>
                <Input type="date" value={payForm.periodTo} onChange={e => setPayForm(p => ({ ...p, periodTo: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitPayout} disabled={createPayoutMutation.isPending}>
              {createPayoutMutation.isPending ? "Recording…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete payout confirmation */}
      <AlertDialog open={!!deletingPayout} onOpenChange={(v) => !v && setDeletingPayout(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payout?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingPayout && (
                <>
                  Remove the {inr(deletingPayout.amount)} payment on{" "}
                  {deletingPayout.paymentDate}? This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={confirmDeletePayout}
              disabled={deletePayoutMutation.isPending}
            >
              {deletePayoutMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: string; tone?: "warn" | "danger" | "ok";
}) {
  const color =
    tone === "warn" ? "text-amber-600" :
    tone === "danger" ? "text-rose-600" :
    "";
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}

function SummaryTile({
  label, value, tone,
}: {
  label: string; value: string; tone?: "warn" | "danger" | "ok";
}) {
  const color =
    tone === "warn" ? "text-amber-600" :
    tone === "danger" ? "text-rose-600" :
    tone === "ok" ? "text-emerald-600" :
    "";
  return (
    <div className="bg-muted/30 rounded-xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-base font-bold font-mono mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
