import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import {
  TrendingUp,
  TrendingDown,
  Banknote,
  Smartphone,
  Globe,
  CreditCard,
  Receipt,
  ArrowDownCircle,
  Wallet,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  XCircle,
  RotateCcw,
  Info,
  History,
  FileEdit,
  ReceiptText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FULL_ACCESS_ROLES } from "@/lib/staffSession";

type DailySummaryData = {
  date: string;
  summary: {
    totalBilling: number;
    outstanding: number;
    refundsAndCancellations: number;
    expenses: number;
    netCollection: number;
    digitalCollection: number;
    physicalCashInHand: number;
    discountsGiven: number;
    billCount: number;
    orderCount: number;
  };
  byMethod: Record<string, number>;
  byRefundMethod: Record<string, number>;
  billsByStatus: Record<string, number>;
  byUser: Array<{
    userName: string;
    billCount: number;
    billed: number;
    received: number;
    methods: Record<string, number>;
  }>;
  totalExpense: number;
  grandTotal: number;
  bills: {
    id: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    discount: number;
    status: string;
    createdAt: string;
    createdByName: string;
  }[];
  payments: {
    id: number;
    billId: number;
    amount: number;
    method: string;
    referenceNumber: string | null;
    recordedByName: string | null;
    createdAt: string;
  }[];
  refunds: {
    id: number;
    billId: number;
    amount: number;
    method: string;
    notes: string | null;
    recordedByName: string | null;
    createdAt: string;
  }[];
  cancelledBillsDetail: {
    id: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    paidAmount: number;
    createdByName: string;
  }[];
  billEdits?: {
    id: number;
    billId: number;
    billNumber: string;
    patientName: string;
    editedBy: string;
    reason: string;
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }[];
  voucherEdits?: {
    id: number;
    voucherId: number;
    voucherNumber: string;
    editedBy: string;
    reason: string;
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }[];
};

type StaffOption = { name: string; billCount: number };

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodIcon(method: string) {
  const m = method.toLowerCase();
  if (m === "cash") return <Banknote size={14} className="text-green-600" />;
  if (m === "upi") return <Smartphone size={14} className="text-violet-600" />;
  if (m === "online") return <Globe size={14} className="text-blue-600" />;
  if (m === "card") return <CreditCard size={14} className="text-orange-500" />;
  return <Wallet size={14} className="text-muted-foreground" />;
}

function methodColor(method: string) {
  const m = method.toLowerCase();
  if (m === "cash") return "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800";
  if (m === "upi") return "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800";
  if (m === "online") return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
  if (m === "card") return "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800";
  return "bg-muted/30 border-card-border";
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  const cls =
    s === "paid" ? "bg-green-100 text-green-700" :
    s === "partial" ? "bg-blue-100 text-blue-700" :
    s === "pending" ? "bg-amber-100 text-amber-700" :
    s === "cancelled" ? "bg-red-100 text-red-700" :
    "bg-gray-100 text-gray-600";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{status.toUpperCase()}</span>;
}

function SummaryCard({ icon, label, value, sub, accent, tooltip }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  tooltip?: string;
}) {
  return (
    <div className={cn("rounded-xl border p-4 flex flex-col gap-1", accent ?? "bg-card border-card-border")}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
        {icon}
        <span>{label}</span>
        {tooltip ? <span title={tooltip}><Info size={12} /></span> : null}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold flex items-center gap-2 text-sm">{children}</h3>;
}

export default function DailySummary() {
  const session = readStaffSession();
  const isAdmin = session ? FULL_ACCESS_ROLES.has(session.user.role) : false;
  const myName = session?.user.name ?? "";

  const [date, setDate] = useState(todayIST());
  const [staffFilter, setStaffFilter] = useState("all");
  const [showBills, setShowBills] = useState(true);
  const [showPayments, setShowPayments] = useState(true);
  const [showRefunds, setShowRefunds] = useState(true);
  const [showEdits, setShowEdits] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery<DailySummaryData>({
    queryKey: ["daily-summary", date, staffFilter],
    queryFn: () =>
      api.get(`/api/daily-summary?date=${encodeURIComponent(date)}${staffFilter !== "all" ? `&staffName=${encodeURIComponent(staffFilter)}` : ""}`),
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const summary = data?.summary ?? {
    totalBilling: 0,
    outstanding: 0,
    refundsAndCancellations: 0,
    expenses: 0,
    netCollection: 0,
    digitalCollection: 0,
    physicalCashInHand: 0,
    discountsGiven: 0,
    billCount: 0,
    orderCount: 0,
  };
  const incomeMethods = Object.entries(data?.byMethod ?? {}).sort((a, b) => b[1] - a[1]);
  const refundMethods = Object.entries(data?.byRefundMethod ?? {}).sort((a, b) => b[1] - a[1]);
  const expenseTotal = data?.totalExpense ?? 0;
  const userRows = data?.byUser ?? [];
  const detailedRows = data?.payments ?? [];
  const refundRows = data?.refunds ?? [];
  const billRows = data?.bills ?? [];
  const cancelledRows = data?.cancelledBillsDetail ?? [];
  const billEdits = data?.billEdits ?? [];
  const voucherEdits = data?.voucherEdits ?? [];
  const totalEdits = billEdits.length + voucherEdits.length;
  const cancelledCount = data?.billsByStatus?.cancelled ?? 0;
  const cancelledAmount = cancelledRows.reduce((s, r) => s + Number(r.totalAmount), 0);
  const cancelledByUser = Object.values(
    cancelledRows.reduce<Record<string, { name: string; count: number; amount: number }>>((acc, r) => {
      const key = r.createdByName || "Unknown";
      if (!acc[key]) acc[key] = { name: key, count: 0, amount: 0 };
      acc[key].count++;
      acc[key].amount += Number(r.totalAmount);
      return acc;
    }, {})
  ).sort((a, b) => b.amount - a.amount);
  const digitalCollection = summary.digitalCollection;
  const netCollection = summary.netCollection;
  const physicalCash = summary.physicalCashInHand;
  const discountsGiven = summary.discountsGiven ?? 0;

  const staffOptions: StaffOption[] = [
    { name: "All Staff", billCount: summary.billCount },
    ...userRows.map((u) => ({ name: u.userName, billCount: u.billCount })),
  ];

  const consolidatedRows = [
    { label: "Total Received Today", value: netCollection },
    { label: "Digital Collection", value: digitalCollection },
    { label: "Physical Cash in Hand", value: physicalCash },
    { label: "Outstanding / Dues", value: summary.outstanding },
    { label: "Refunds / Cancellations", value: summary.refundsAndCancellations },
    { label: "Discounts Given", value: discountsGiven },
    { label: "Expenses", value: expenseTotal },
  ];

  const totalBillingFormula = `Total Billing = ${inr(summary.totalBilling)}`;
  const outstandingFormula = `Outstanding / Dues = ${inr(summary.outstanding)}`;
  const refundsFormula = `Refunds / Cancellations = ${inr(summary.refundsAndCancellations)}`;
  const expensesFormula = `Expenses = ${inr(expenseTotal)}`;
  const discountsFormula = `Discounts Given Today = ${inr(discountsGiven)}`;
  const totalReceivedFormula = `Total Received Today = ${inr(summary.totalBilling)} − ${inr(summary.outstanding)} − ${inr(summary.refundsAndCancellations)} − ${inr(expenseTotal)} = ${inr(netCollection)}`;
  const digitalFormula = `Digital Collection = UPI + Card + other bank/digital modes = ${inr(digitalCollection)}`;
  const physicalFormula = `Physical Cash in Hand = ${inr(netCollection)} − ${inr(digitalCollection)} = ${inr(physicalCash)}`;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Daily Summary"
        subtitle={`Collections & expenses for ${staffFilter === "all" ? "all staff" : staffFilter} on ${date}`}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" />
        </div>
        {isAdmin ? (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Staff name</label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="All Staff" /></SelectTrigger>
              <SelectContent>
                {staffOptions.map((s) => (
                  <SelectItem key={s.name} value={s.name === "All Staff" ? "all" : s.name}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Showing for</label>
            <div className="h-9 px-3 flex items-center border border-card-border rounded-md bg-muted/30 text-sm font-medium">{myName}</div>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9">
          <RefreshCw size={13} className={cn("mr-1.5", isFetching && "animate-spin")} />Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDate(todayIST())} className="h-9 text-xs">Today</Button>
      </div>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <SummaryCard icon={<TrendingUp size={14} className="text-green-600" />} label="Total Billing" value={inr(summary.totalBilling)} sub={totalBillingFormula} accent="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" />
            <SummaryCard icon={<Receipt size={14} className="text-amber-600" />} label="Outstanding / Dues" value={inr(summary.outstanding)} sub={outstandingFormula} accent="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" />
            <SummaryCard icon={<RotateCcw size={14} className="text-rose-600" />} label="Refunds / Cancellations" value={inr(summary.refundsAndCancellations)} sub={refundsFormula} accent="bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800" />
            <SummaryCard icon={<TrendingDown size={14} className="text-red-500" />} label="Expenses" value={inr(expenseTotal)} sub={expensesFormula} accent="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" />
            <SummaryCard icon={<Wallet size={14} className="text-blue-600" />} label="Total Received Today (Cash+Digital)" value={inr(netCollection)} sub={totalReceivedFormula} accent="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" tooltip="Total Billing − Dues − Refunds − Expenses" />
            <SummaryCard icon={<Smartphone size={14} className="text-violet-600" />} label="Digital Collection" value={inr(digitalCollection)} sub={digitalFormula} accent="bg-card border-card-border" />
            <SummaryCard icon={<Banknote size={14} className="text-green-700" />} label="Physical Cash in Hand" value={inr(physicalCash)} sub={physicalFormula} accent="bg-card border-card-border" />
            <SummaryCard icon={<ArrowDownCircle size={14} className="text-purple-600" />} label="Discounts Given Today" value={inr(discountsGiven)} sub={discountsFormula} accent="bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800" />
            <SummaryCard icon={<XCircle size={14} className="text-slate-600" />} label="Cancellations" value={cancelledCount > 0 ? inr(cancelledAmount) : "—"} sub={cancelledCount > 0 ? `${cancelledCount} bill${cancelledCount === 1 ? "" : "s"} cancelled` : "No cancellations today"} accent="bg-slate-50 dark:bg-slate-950/30 border-slate-200 dark:border-slate-800" />
          </div>

          {/* ── Bottom Line — clean styled table that matches the operator's
                handwritten template (Total Billing − Outstanding − Refunds −
                Expense = Total Received; Digital subtracted to give Physical
                Cash in Hand). ───────────────────────────────────────────── */}
          <div className="rounded-xl border-2 border-card-border bg-gradient-to-br from-card to-muted/30 overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gradient-to-r from-primary/10 to-primary/5 border-b-2 border-card-border flex items-center gap-2">
              <Wallet size={16} className="text-primary" />
              <span className="text-sm font-bold tracking-wide uppercase">Bottom Line</span>
              <span className="ml-auto text-[11px] text-muted-foreground font-medium">As on {date}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-card-border/60">
                  <td className="px-4 py-2 text-muted-foreground flex items-center gap-2"><TrendingUp size={13} className="text-green-600" /> Total Billing <span className="text-[10px] font-mono text-muted-foreground/70">(X)</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{inr(summary.totalBilling)}</td>
                </tr>
                <tr className="border-b border-card-border/60">
                  <td className="px-4 py-2 text-muted-foreground flex items-center gap-2"><Receipt size={13} className="text-amber-600" /> Outstanding / Dues <span className="text-[10px] font-mono text-muted-foreground/70">(− Y)</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-500">− {inr(summary.outstanding)}</td>
                </tr>
                <tr className="border-b border-card-border/60">
                  <td className="px-4 py-2 text-muted-foreground flex items-center gap-2"><RotateCcw size={13} className="text-rose-600" /> Refunds / Cancellations <span className="text-[10px] font-mono text-muted-foreground/70">(− Z)</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-rose-700 dark:text-rose-500">− {inr(summary.refundsAndCancellations)}</td>
                </tr>
                <tr className="border-b-2 border-foreground/40">
                  <td className="px-4 py-2 text-muted-foreground flex items-center gap-2"><TrendingDown size={13} className="text-red-500" /> Expenses <span className="text-[10px] font-mono text-muted-foreground/70">(− A)</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-red-700 dark:text-red-500">− {inr(expenseTotal)}</td>
                </tr>
                <tr className="bg-blue-50/70 dark:bg-blue-950/30 border-b-2 border-foreground/40">
                  <td className="px-4 py-2.5 font-bold flex items-center gap-2"><Wallet size={14} className="text-blue-700" /> Total Received Today <span className="text-[10px] font-mono text-blue-700/80 dark:text-blue-400/80">(B = X − Y − Z − A)</span></td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-blue-800 dark:text-blue-300 text-base">{inr(netCollection)}</td>
                </tr>
                <tr className="border-b-2 border-foreground/40">
                  <td className="px-4 py-2 text-muted-foreground flex items-center gap-2"><Smartphone size={13} className="text-violet-600" /> Digital Collection <span className="text-[10px] font-mono text-muted-foreground/70">(− C)</span></td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-violet-700 dark:text-violet-400">− {inr(digitalCollection)}</td>
                </tr>
                <tr className="bg-green-50/70 dark:bg-green-950/30">
                  <td className="px-4 py-3 font-bold flex items-center gap-2"><Banknote size={15} className="text-green-700" /> Physical Cash in Hand <span className="text-[10px] font-mono text-green-700/80 dark:text-green-400/80">(B − C)</span></td>
                  <td className="px-4 py-3 text-right font-extrabold tabular-nums text-green-800 dark:text-green-300 text-lg">{inr(physicalCash)}</td>
                </tr>
              </tbody>
            </table>
            <div className="px-4 py-2 bg-muted/30 border-t border-card-border text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>Discounts Given Today: <strong className="text-foreground">{inr(discountsGiven)}</strong></span>
              <span>Bills: <strong className="text-foreground">{summary.billCount}</strong></span>
              {totalEdits > 0 && <span>Edits Logged: <strong className="text-foreground">{totalEdits}</strong></span>}
            </div>
          </div>

          {/* ── Bills / Vouchers Edit Logs — collapsible section showing every
                bill or voucher modification made on this day, with old vs new
                values, reason, and editor. ──────────────────────────────── */}
          {totalEdits > 0 && (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <button onClick={() => setShowEdits((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors">
                <span className="flex items-center gap-2"><History size={14} className="text-indigo-600" /> Bills / Vouchers Edit Logs <Badge variant="secondary" className="text-xs">{totalEdits}</Badge></span>
                {showEdits ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showEdits && (
                <div className="border-t border-card-border divide-y divide-card-border">
                  {billEdits.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 dark:bg-indigo-950/20 flex items-center gap-2"><ReceiptText size={12} /> Bill Edits ({billEdits.length})</div>
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Time</th>
                            <th className="px-3 py-2 text-left font-semibold">Bill #</th>
                            <th className="px-3 py-2 text-left font-semibold">Patient</th>
                            <th className="px-3 py-2 text-left font-semibold">Field</th>
                            <th className="px-3 py-2 text-left font-semibold">Old → New</th>
                            <th className="px-3 py-2 text-left font-semibold">Reason</th>
                            <th className="px-3 py-2 text-left font-semibold">Edited By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-card-border">
                          {billEdits.map((e) => (
                            <tr key={e.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</td>
                              <td className="px-3 py-1.5 font-mono font-semibold">{String(e.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "")}</td>
                              <td className="px-3 py-1.5">{e.patientName}</td>
                              <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 uppercase">{e.changeType}</span></td>
                              <td className="px-3 py-1.5 font-mono text-[11px]">
                                <span className="text-rose-600 line-through">{e.oldValue ?? "—"}</span>
                                <span className="text-muted-foreground mx-1">→</span>
                                <span className="text-green-700 font-semibold">{e.newValue ?? "—"}</span>
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate" title={e.reason}>{e.reason || "—"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{e.editedBy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {voucherEdits.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="px-4 py-2 text-xs font-semibold text-purple-700 bg-purple-50 dark:bg-purple-950/20 flex items-center gap-2"><FileEdit size={12} /> Voucher Edits ({voucherEdits.length})</div>
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Time</th>
                            <th className="px-3 py-2 text-left font-semibold">Voucher #</th>
                            <th className="px-3 py-2 text-left font-semibold">Field</th>
                            <th className="px-3 py-2 text-left font-semibold">Old → New</th>
                            <th className="px-3 py-2 text-left font-semibold">Reason</th>
                            <th className="px-3 py-2 text-left font-semibold">Edited By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-card-border">
                          {voucherEdits.map((e) => (
                            <tr key={e.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{new Date(e.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</td>
                              <td className="px-3 py-1.5 font-mono font-semibold">{e.voucherNumber}</td>
                              <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 uppercase">{e.changeType}</span></td>
                              <td className="px-3 py-1.5 font-mono text-[11px]">
                                <span className="text-rose-600 line-through">{e.oldValue ?? "—"}</span>
                                <span className="text-muted-foreground mx-1">→</span>
                                <span className="text-green-700 font-semibold">{e.newValue ?? "—"}</span>
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate" title={e.reason}>{e.reason || "—"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{e.editedBy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(refundRows.length > 0 || cancelledRows.length > 0) && (
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <button onClick={() => setShowRefunds((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors">
                <span className="flex items-center gap-2"><RotateCcw size={14} className="text-rose-600" /> Refunds &amp; Cancellations <Badge variant="secondary" className="text-xs">{refundRows.length + cancelledRows.length}</Badge></span>
                {showRefunds ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showRefunds && (
                <div className="border-t border-card-border divide-y divide-card-border">
                  {refundRows.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 dark:bg-rose-950/20">Refunds ({refundRows.length})</div>
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40"><tr><th className="px-3 py-2 text-left font-semibold">Time</th><th className="px-3 py-2 text-left font-semibold">Bill ID</th><th className="px-3 py-2 text-left font-semibold">Method</th><th className="px-3 py-2 text-right font-semibold">Refunded</th><th className="px-3 py-2 text-left font-semibold">Notes</th><th className="px-3 py-2 text-left font-semibold">By</th></tr></thead>
                        <tbody className="divide-y divide-card-border">
                          {refundRows.map((r) => (<tr key={r.id} className="hover:bg-muted/20"><td className="px-3 py-1.5 text-muted-foreground">{new Date(r.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</td><td className="px-3 py-1.5 font-mono">#{r.billId}</td><td className="px-3 py-1.5 uppercase">{r.method}</td><td className="px-3 py-1.5 text-right font-semibold text-rose-600">−{inr(r.amount)}</td><td className="px-3 py-1.5 text-muted-foreground">{r.notes || "—"}</td><td className="px-3 py-1.5 text-muted-foreground">{r.recordedByName || "—"}</td></tr>))}
                        </tbody>
                        <tfoot className="bg-muted/30 border-t-2 border-card-border"><tr><td colSpan={3} className="px-3 py-2 font-semibold text-xs">Total Refunded</td><td className="px-3 py-2 text-right font-bold text-rose-600">−{inr(refundRows.reduce((s, r) => s + r.amount, 0))}</td><td colSpan={2} /></tr></tfoot>
                      </table>
                    </div>
                  )}
                  {cancelledRows.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-50 dark:bg-slate-950/20 flex items-center justify-between">
                        <span className="flex items-center gap-2"><XCircle size={12} /> Cancelled Bills ({cancelledRows.length})</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{inr(cancelledAmount)}</span>
                      </div>
                      {cancelledByUser.length > 1 && (
                        <div className="px-4 py-2 bg-muted/30 border-b border-card-border flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                          {cancelledByUser.map((u) => (
                            <span key={u.name} className="text-muted-foreground">
                              <span className="font-semibold text-foreground">{u.name}</span>
                              {" — "}
                              {u.count} bill{u.count === 1 ? "" : "s"}, <span className="font-semibold text-slate-700 dark:text-slate-300">{inr(u.amount)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold">Bill #</th>
                            <th className="px-3 py-2 text-left font-semibold">Patient</th>
                            <th className="px-3 py-2 text-right font-semibold">Bill Amount</th>
                            <th className="px-3 py-2 text-right font-semibold">Paid Before Cancel</th>
                            <th className="px-3 py-2 text-left font-semibold">By</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-card-border">
                          {cancelledRows.map((b) => (
                            <tr key={b.id} className="hover:bg-muted/20">
                              <td className="px-3 py-1.5 font-mono font-semibold">{String(b.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "")}</td>
                              <td className="px-3 py-1.5">{b.patientName}</td>
                              <td className="px-3 py-1.5 text-right">{inr(b.totalAmount)}</td>
                              <td className="px-3 py-1.5 text-right">{inr(b.paidAmount)}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{b.createdByName || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/30 border-t-2 border-card-border">
                          <tr>
                            <td colSpan={2} className="px-3 py-2 font-semibold text-xs">Total Cancelled</td>
                            <td className="px-3 py-2 text-right font-bold text-slate-700 dark:text-slate-300">{inr(cancelledAmount)}</td>
                            <td className="px-3 py-2 text-right font-bold text-rose-600">{inr(cancelledRows.reduce((s, r) => s + Number(r.paidAmount), 0))}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <SectionTitle><TrendingUp size={14} className="text-green-600" /> Detailed Collections</SectionTitle>
              <div className="space-y-2">
                {incomeMethods.length === 0 ? <p className="text-xs text-muted-foreground italic">No collections recorded yet.</p> : incomeMethods.map(([method, amount]) => (
                  <div key={method} className={cn("flex items-center justify-between rounded-lg border px-3 py-2", methodColor(method))}>
                    <div className="flex items-center gap-2 text-sm font-medium capitalize">{methodIcon(method)}{method.toUpperCase()}</div>
                    <div className="font-bold text-sm">{inr(amount)}</div>
                  </div>
                ))}
                <div className="border-t border-card-border pt-2 mt-1 text-sm font-bold flex items-center justify-between">
                  <span>Digital Collection</span>
                  <span>{inr(summary.digitalCollection)}</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <SectionTitle><Wallet size={14} className="text-primary" /> Formula Summary</SectionTitle>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div>{totalBillingFormula}</div>
                <div>{outstandingFormula}</div>
                <div>{refundsFormula}</div>
                <div>{expensesFormula}</div>
                <div>{discountsFormula}</div>
                <div className="font-medium text-foreground">{totalReceivedFormula}</div>
                <div>{digitalFormula}</div>
                <div>{physicalFormula}</div>
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <SectionTitle><TrendingUp size={14} className="text-green-600" /> User-wise Summary</SectionTitle>
              {userRows.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No staff activity recorded today.</p>
              ) : (
                <div className="space-y-2">
                  {userRows.map((row) => (
                    <div key={row.userName} className="rounded-lg border border-card-border bg-muted/20 px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between text-sm font-medium"><span>{row.userName}</span><span>{inr(row.received)}</span></div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs text-muted-foreground">
                        <span>Bills: {row.billCount}</span>
                        <span>Billed: {inr(row.billed)}</span>
                        <span>Cash: {inr(row.methods.cash ?? 0)}</span>
                        <span>UPI: {inr(row.methods.upi ?? 0)}</span>
                        <span>Dues: {inr(Math.max(0, row.billed - row.received))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <SectionTitle><Wallet size={14} className="text-primary" /> Bill Status Summary</SectionTitle>
              <div className="space-y-2">
                {[
                  { label: "Paid", count: data?.billsByStatus?.paid ?? 0, color: "text-green-700" },
                  { label: "Partial", count: data?.billsByStatus?.partial ?? 0, color: "text-blue-700" },
                  { label: "Pending", count: data?.billsByStatus?.pending ?? 0, color: "text-amber-700" },
                  { label: "Cancelled", count: data?.billsByStatus?.cancelled ?? 0, color: "text-red-700" },
                ].map((s) => (
                  <div key={s.label} className="flex items-center justify-between rounded-lg border border-card-border bg-muted/20 px-3 py-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className={cn("font-bold text-sm", s.color)}>{s.count}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-card-border pt-2 text-sm font-bold">
                  <span>Total Bill Count</span>
                  <span>{summary.billCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bills Created Today — moved to bottom ── */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <button onClick={() => setShowBills((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors">
              <span className="flex items-center gap-2"><Receipt size={14} className="text-primary" /> Bills Created Today <Badge variant="secondary" className="text-xs">{billRows.length}</Badge></span>
              {showBills ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showBills && (
              <div className="overflow-x-auto border-t border-card-border">
                {billRows.length === 0 ? <p className="text-xs text-muted-foreground italic p-4">No bills created for this date.</p> : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr><th className="px-3 py-2 text-left font-semibold">Time</th><th className="px-3 py-2 text-left font-semibold">Bill #</th><th className="px-3 py-2 text-left font-semibold">Patient</th><th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-3 py-2 text-right font-semibold">Paid</th><th className="px-3 py-2 text-right font-semibold">Balance</th><th className="px-3 py-2 text-left font-semibold">Status</th><th className="px-3 py-2 text-left font-semibold">By</th></tr></thead>
                    <tbody className="divide-y divide-card-border">
                      {billRows.map((b) => (
                        <tr key={b.id} className="hover:bg-muted/20"><td className="px-3 py-1.5 text-muted-foreground">{new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</td><td className="px-3 py-1.5 font-mono font-semibold">{String(b.billNumber).replace(/^BILL-?/i, "").replace(/-/g, "")}</td><td className="px-3 py-1.5">{b.patientName}</td><td className="px-3 py-1.5 text-right">{inr(b.totalAmount)}</td><td className="px-3 py-1.5 text-right text-green-700">{inr(b.paidAmount)}</td><td className={cn("px-3 py-1.5 text-right font-semibold", b.balanceAmount > 0 ? "text-red-600" : "text-green-600")}>{inr(b.balanceAmount)}</td><td className="px-3 py-1.5">{statusBadge(b.status)}</td><td className="px-3 py-1.5 text-muted-foreground">{b.createdByName || "—"}</td></tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t-2 border-card-border"><tr><td colSpan={3} className="px-3 py-2 font-semibold text-xs">Total ({billRows.filter(b => b.status !== "cancelled").length} active)</td><td className="px-3 py-2 text-right font-bold">{inr(billRows.filter(b => b.status !== "cancelled").reduce((s, b) => s + b.totalAmount, 0))}</td><td className="px-3 py-2 text-right font-bold text-green-700">{inr(billRows.filter(b => b.status !== "cancelled").reduce((s, b) => s + b.paidAmount, 0))}</td><td className="px-3 py-2 text-right font-bold text-red-600">{inr(summary.outstanding)}</td><td colSpan={2} /></tr></tfoot>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* ── Payment Entries — moved to bottom ── */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <button onClick={() => setShowPayments((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors">
              <span className="flex items-center gap-2"><CreditCard size={14} /> Payment Entries <Badge variant="secondary" className="text-xs">{detailedRows.length}</Badge></span>
              {showPayments ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showPayments && (
              <div className="overflow-x-auto border-t border-card-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 border-y border-card-border"><tr><th className="px-3 py-2 text-left font-semibold">Time</th><th className="px-3 py-2 text-left font-semibold">Method</th><th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-3 py-2 text-left font-semibold">Ref #</th><th className="px-3 py-2 text-left font-semibold">Recorded By</th></tr></thead>
                  <tbody className="divide-y divide-card-border">
                    {detailedRows.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/20"><td className="px-3 py-1.5 text-muted-foreground">{new Date(p.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</td><td className="px-3 py-1.5"><span className="flex items-center gap-1 capitalize">{methodIcon(p.method)} {p.method.toUpperCase()}</span></td><td className="px-3 py-1.5 text-right font-semibold text-green-700">{inr(p.amount)}</td><td className="px-3 py-1.5 font-mono text-muted-foreground">{p.referenceNumber || "—"}</td><td className="px-3 py-1.5 text-muted-foreground">{p.recordedByName || "—"}</td></tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t-2 border-card-border"><tr><td colSpan={2} className="px-3 py-2 font-semibold text-xs">Total</td><td className="px-3 py-2 text-right font-bold text-green-700">{inr(summary.digitalCollection)}</td><td colSpan={2} /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
