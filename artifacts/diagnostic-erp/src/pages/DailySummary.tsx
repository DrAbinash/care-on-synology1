import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Link } from "wouter";
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
  FlaskConical,
  Calendar,
  Printer,
  Download,
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
import { FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";

type DailySummaryData = {
  date: string;
  summary: {
    totalBilling: number;
    outstanding: number;
    refundsAndCancellations: number;
    expenses: number;
    netCollection: number;
    digitalCollection: number;
    cashCollection?: number;
    physicalCashInHand: number;
    discountsGiven: number;
    billCount: number;
    orderCount: number;
    // Reconciliation fields
    newBillingCollected?: number;
    oldDuesCollected?: number;
    backdatedRefunds?: number;
    sameDayRefunds?: number;
    cashExpenses?: number;
    digitalExpenses?: number;
    netDigitalCollection?: number;
    cancelledBillsAmount?: number;
    totalRefunded?: number;
    // Suspense/exception bucket — see DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.3
    suspensePaymentCount?: number;
    suspensePaymentAmount?: number;
    suspenseRefundCount?: number;
    suspenseRefundAmount?: number;
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
  suspensePayments?: {
    id: number;
    billId: number | null;
    amount: number;
    rawMethod: string;
    recordedByName: string | null;
    createdAt: string;
  }[];
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

// ── Category & Test-Wise Summary types ─────────────────────────────────────
type TestCount = { testId: number; testName: string; count: number };
type CategoryCount = { categoryName: string; total: number; tests: TestCount[] };
type CategoryTestSummaryData = {
  from: string;
  to: string;
  total: number;
  categories: CategoryCount[];
};

// Date preset keys
type DatePreset = "today" | "yesterday" | "dby" | "week" | "month" | "custom";

function todayIST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function offsetIST(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function presetRange(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const today = todayIST();
  switch (preset) {
    case "today":     return { from: today,             to: today };
    case "yesterday": return { from: offsetIST(-1),     to: offsetIST(-1) };
    case "dby":       return { from: offsetIST(-2),     to: offsetIST(-2) };
    case "week":      return { from: offsetIST(-6),     to: today };
    case "month":     return { from: offsetIST(-29),    to: today };
    case "custom":    return { from: customFrom || today, to: customTo || today };
  }
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
  const isAdmin = session ? FULL_ACCESS_ROLES.has(normalizeRole(session.user.role)) : false;
  const myName = session?.user.name ?? "";

  const [date, setDate] = useState(todayIST());
  const [staffFilter, setStaffFilter] = useState("all");
  const [showBills, setShowBills] = useState(true);
  const [showPayments, setShowPayments] = useState(true);
  const [showRefunds, setShowRefunds] = useState(true);
  const [showEdits, setShowEdits] = useState(true);

  // ── Category & Test-Wise Summary state ─────────────────────────────────
  const [ctPreset, setCtPreset] = useState<DatePreset>("today");
  const [ctCustomFrom, setCtCustomFrom] = useState(todayIST());
  const [ctCustomTo,   setCtCustomTo]   = useState(todayIST());
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const ctRange = presetRange(ctPreset, ctCustomFrom, ctCustomTo);

  const toggleCat = (cat: string) =>
    setExpandedCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  const expandAll  = (cats: string[]) => setExpandedCats(new Set(cats));
  const collapseAll = ()              => setExpandedCats(new Set());

  const ctQ = useQuery<CategoryTestSummaryData>({
    queryKey: ["category-test-summary", ctRange.from, ctRange.to],
    queryFn: () =>
      api.get(`/api/daily-summary/category-test-summary?from=${ctRange.from}&to=${ctRange.to}`),
    staleTime: 60_000,
  });

  // ── Export helpers for Category & Test Wise Summary ─────────────────────
  function exportCategoryTestCSV() {
    const d = ctQ.data;
    if (!d) return;
    const label = ctRange.from === ctRange.to ? ctRange.from : `${ctRange.from}_to_${ctRange.to}`;
    const rows: string[][] = [
      ["Category", "Test Name", "Count"],
    ];
    for (const cat of d.categories) {
      for (const t of [...cat.tests].sort((a, b) => b.count - a.count)) {
        rows.push([cat.categoryName, t.testName, String(t.count)]);
      }
      rows.push([cat.categoryName, "CATEGORY TOTAL", String(cat.total)]);
      rows.push(["", "", ""]);
    }
    rows.push(["GRAND TOTAL", "", String(d.total)]);
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `category_test_summary_${label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printCategoryTestSummary() {
    const d = ctQ.data;
    if (!d) return;
    const label = ctRange.from === ctRange.to
      ? ctRange.from
      : `${ctRange.from} to ${ctRange.to}`;
    const rows = d.categories.map((cat) => {
      const tests = [...cat.tests]
        .sort((a, b) => b.count - a.count)
        .map((t) => `<tr><td style="padding:4px 8px 4px 24px;border:1px solid #e2e8f0;color:#64748b">— ${t.testName}</td><td style="padding:4px 12px;border:1px solid #e2e8f0;text-align:right">${t.count}</td></tr>`)
        .join("");
      return `<tr style="background:#f0fdfa">
        <td style="padding:7px 10px;border:1px solid #0d9488;font-weight:700;color:#134e4a">${cat.categoryName}</td>
        <td style="padding:7px 12px;border:1px solid #0d9488;text-align:right;font-weight:700;color:#0f766e">${cat.total}</td>
      </tr>${tests}`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><title>Category &amp; Test Wise Summary — ${label}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;font-size:13px}
    h2{margin:0 0 4px}p{margin:0 0 16px;color:#64748b}
    table{width:100%;border-collapse:collapse}
    @media print{button{display:none!important}}</style></head>
    <body>
    <h2>Category &amp; Test Wise Summary</h2>
    <p>Period: ${label} &nbsp;|&nbsp; Total tests: ${d.total}</p>
    <table>
      <thead><tr style="background:#0f766e;color:white">
        <th style="padding:8px 10px;text-align:left;border:1px solid #0f766e">Category / Test</th>
        <th style="padding:8px 12px;text-align:right;border:1px solid #0f766e">Count</th>
      </tr></thead>
      <tbody>${rows}
        <tr style="background:#134e4a;color:white">
          <td style="padding:9px 10px;font-weight:700;border:2px solid #134e4a">GRAND TOTAL</td>
          <td style="padding:9px 12px;text-align:right;font-weight:700;font-size:15px;border:2px solid #134e4a">${d.total}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin-top:14px;font-size:11px;color:#94a3b8">Cancelled bills excluded. Generated on ${new Date().toLocaleString("en-IN")}</p>
    </body></html>`;
    const win = window.open("", "_blank", "width=700,height=900");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

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
    cashCollection: 0,
    physicalCashInHand: 0,
    discountsGiven: 0,
    billCount: 0,
    orderCount: 0,
    newBillingCollected: undefined,
    oldDuesCollected: undefined,
    backdatedRefunds: undefined,
    sameDayRefunds: undefined,
    cashExpenses: undefined,
    digitalExpenses: undefined,
    netDigitalCollection: undefined,
    cancelledBillsAmount: undefined,
    totalRefunded: undefined,
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

  // ── Reconciliation module derived values ───────────────────────────────
  const rec = {
    newBillingCollected: summary.newBillingCollected ?? 0,
    oldDuesCollected:    summary.oldDuesCollected ?? 0,
    totalOperationalRevenue: (summary.newBillingCollected ?? 0) + (summary.oldDuesCollected ?? 0),
    cancelledBillsAmount: summary.cancelledBillsAmount ?? cancelledAmount,
    discountsGiven:      discountsGiven,
    // Refunds split: same-day bill refunds vs old-bill (backdated) refunds
    sameDayRefunds:      summary.sameDayRefunds ?? 0,
    backdatedRefunds:    summary.backdatedRefunds ?? 0,
    totalRefunded:       summary.totalRefunded ?? refundRows.reduce((s, r) => s + r.amount, 0),
    cashExpenses:        summary.cashExpenses ?? expenseTotal,
    digitalExpenses:     summary.digitalExpenses ?? 0,
    totalExpenses:       expenseTotal,
    cashCollection:      summary.cashCollection ?? (netCollection + expenseTotal + (summary.totalRefunded ?? 0) - summary.digitalCollection),
    digitalCollection:   digitalCollection,
    netDigitalCollection: summary.netDigitalCollection ?? digitalCollection,
    // Expected Physical Cash formula:
    // = operationalRevenue - deductions (cancelled+discounts+refunds) - expenses - netDigitalCollection
    // Note: backdatedRefunds are ALREADY inside totalRefunded — shown for info only, NOT subtracted twice
    get expectedPhysicalCash() {
      const operationalRevenue = this.newBillingCollected + this.oldDuesCollected;
      const totalDeductions = this.cancelledBillsAmount + this.discountsGiven + this.totalRefunded;
      return operationalRevenue - totalDeductions - this.totalExpenses - this.netDigitalCollection;
    },
  };

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
        actions={
          <Link href={`/reports?tab=daily&date=${date}`}>
            <Button variant="outline" size="sm" className="h-9">
              <ReceiptText size={14} className="mr-1.5" /> View Daily Report
            </Button>
          </Link>
        }
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

          {/* ── Suspense / Exception Bucket — payments or refunds whose method
                could not be classified as cash or digital. Excluded from every
                total above; needs admin correction. See
                DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.3. Only
                rendered when there is something to review. */}
          {((summary.suspensePaymentCount ?? 0) > 0 || (summary.suspenseRefundCount ?? 0) > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-400">
                <Info size={15} />
                Needs review — unrecognized payment method
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                {(summary.suspensePaymentCount ?? 0) + (summary.suspenseRefundCount ?? 0)} transaction(s) totalling{" "}
                {inr((summary.suspensePaymentAmount ?? 0) + (summary.suspenseRefundAmount ?? 0))} have a payment method this dashboard
                doesn't recognize. They are <strong>excluded from Cash and Digital Collection above</strong> — not
                assumed to be either — until corrected.
              </p>
              {data?.suspensePayments && data.suspensePayments.length > 0 && (
                <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-amber-100/60 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium">Bill</th>
                        <th className="text-left px-2 py-1 font-medium">Amount</th>
                        <th className="text-left px-2 py-1 font-medium">Raw method</th>
                        <th className="text-left px-2 py-1 font-medium">Recorded by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.suspensePayments.map((p) => (
                        <tr key={p.id} className="border-t border-amber-200 dark:border-amber-800/60">
                          <td className="px-2 py-1">
                            {p.billId ? <Link href={`/billing/${p.billId}`} className="underline">#{p.billId}</Link> : "—"}
                          </td>
                          <td className="px-2 py-1 tabular-nums">{inr(p.amount)}</td>
                          <td className="px-2 py-1 font-mono">{p.rawMethod || "(blank)"}</td>
                          <td className="px-2 py-1">{p.recordedByName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

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

          {/* ══════════════════════════════════════════════════════════════════
               DAILY RECONCILIATION & CASH FLOW MODULE
               Parallel testing module — existing modules above are unchanged.
               This module uses the same API data, enhanced with reconciliation
               fields. After verification, legacy modules can be removed.
          ══════════════════════════════════════════════════════════════════ */}
          <div style={{ border: "3px solid black", borderRadius: 8, overflow: "hidden", marginTop: 24 }}>
            {/* Header */}
            <div style={{ background: "#1e293b", color: "white", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
              <Wallet size={16} />
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Daily Reconciliation &amp; Cash Flow
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>As on {date}</span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ border: "1px solid black", padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>Category</th>
                    <th style={{ border: "1px solid black", padding: "8px 12px", textAlign: "left", fontWeight: 700 }}>Item</th>
                    <th style={{ border: "1px solid black", padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* ── OPERATIONAL REVENUE ── */}
                  <tr style={{ background: "#f0fdf4" }}>
                    <td rowSpan={3} style={{ border: "1px solid black", padding: "8px 12px", fontWeight: 700, verticalAlign: "top", color: "#166534" }}>Operational Revenue</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>New Billing Collected</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right" }}>{inr(rec.newBillingCollected)}</td>
                  </tr>
                  <tr style={{ background: "#f0fdf4" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Old Dues Collected</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right" }}>{inr(rec.oldDuesCollected)}</td>
                  </tr>
                  <tr style={{ background: "#dcfce7", fontWeight: 700 }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px", fontWeight: 700 }}>Total Operational Revenue</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", fontWeight: 700 }}>{inr(rec.totalOperationalRevenue)}</td>
                  </tr>

                  {/* ── OPERATIONAL DEDUCTIONS ── */}
                  <tr style={{ background: "#fef9f0" }}>
                    <td rowSpan={5} style={{ border: "1px solid black", padding: "8px 12px", fontWeight: 700, verticalAlign: "top", color: "#92400e" }}>Operational Deductions</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Cancelled Bills</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#dc2626" }}>{cancelledAmount > 0 ? `− ${inr(cancelledAmount)}` : inr(0)}</td>
                  </tr>
                  <tr style={{ background: "#fef9f0" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Discounts Given</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#7c3aed" }}>{discountsGiven > 0 ? `− ${inr(discountsGiven)}` : inr(0)}</td>
                  </tr>
                  <tr style={{ background: "#fef9f0" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Refunds Today (same-day bill)</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#dc2626" }}>{rec.sameDayRefunds > 0 ? `− ${inr(rec.sameDayRefunds)}` : inr(0)}</td>
                  </tr>
                  <tr style={{ background: "#fef3cd" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>
                      <span>Backdated Refund Adjustments </span>
                      <span style={{ fontSize: 10, background: "#fde68a", padding: "1px 5px", borderRadius: 3, marginLeft: 4, fontStyle: "italic" }}>old bill, refunded today</span>
                    </td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#b45309" }}>
                      {rec.backdatedRefunds > 0 ? `− ${inr(rec.backdatedRefunds)}` : inr(0)}
                    </td>
                  </tr>
                  <tr style={{ background: "#fee2e2", fontWeight: 700 }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px", fontSize: 11, color: "#6b7280", fontStyle: "italic", fontWeight: 400 }}>
                      ⚠ Backdated refunds are included within "Refunds Today" total — not subtracted twice
                    </td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", fontSize: 11, color: "#6b7280", fontStyle: "italic", fontWeight: 400 }}>
                      [informational only]
                    </td>
                  </tr>

                  {/* ── EXPENSES ── */}
                  <tr style={{ background: "#fef2f2" }}>
                    <td rowSpan={3} style={{ border: "1px solid black", padding: "8px 12px", fontWeight: 700, verticalAlign: "top", color: "#991b1b" }}>Expenses</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Cash Expenses</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#dc2626" }}>{rec.cashExpenses > 0 ? `− ${inr(rec.cashExpenses)}` : inr(0)}</td>
                  </tr>
                  <tr style={{ background: "#fef2f2" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Digital Expenses</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#dc2626" }}>{rec.digitalExpenses > 0 ? `− ${inr(rec.digitalExpenses)}` : inr(0)}</td>
                  </tr>
                  <tr style={{ background: "#fee2e2", fontWeight: 700 }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px", fontWeight: 700 }}>Total Expenses</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", fontWeight: 700, color: "#dc2626" }}>{rec.totalExpenses > 0 ? `− ${inr(rec.totalExpenses)}` : inr(0)}</td>
                  </tr>

                  {/* ── COLLECTIONS ── */}
                  <tr style={{ background: "#eff6ff" }}>
                    <td rowSpan={3} style={{ border: "1px solid black", padding: "8px 12px", fontWeight: 700, verticalAlign: "top", color: "#1d4ed8" }}>Collections</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Cash Collection</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#166534" }}>{inr(rec.cashCollection)}</td>
                  </tr>
                  <tr style={{ background: "#eff6ff" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>Digital Collection</td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#7c3aed" }}>{inr(rec.digitalCollection)}</td>
                  </tr>
                  <tr style={{ background: "#dbeafe" }}>
                    <td style={{ border: "1px solid black", padding: "6px 12px" }}>
                      Net Digital Collection
                      <span style={{ fontSize: 10, color: "#6b7280", marginLeft: 6 }}>(Digital − Digital Refunds)</span>
                    </td>
                    <td style={{ border: "1px solid black", padding: "6px 12px", textAlign: "right", color: "#1d4ed8" }}>{rec.netDigitalCollection > 0 ? `− ${inr(rec.netDigitalCollection)}` : inr(0)}</td>
                  </tr>

                  {/* ── FINAL ROW ── */}
                  <tr style={{ background: "#1e293b", color: "white", fontWeight: 700 }}>
                    <td colSpan={2} style={{ border: "3px solid black", padding: "10px 12px", fontWeight: 700, fontSize: 14 }}>
                      💵 Expected Physical Cash
                      <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
                        = Operational Revenue − Deductions − Expenses − Net Digital Collection
                      </div>
                    </td>
                    <td style={{ border: "3px solid black", padding: "10px 12px", textAlign: "right", fontWeight: 700, fontSize: 16 }}>
                      {inr(rec.expectedPhysicalCash)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Disclaimer footer */}
            <div style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1", padding: "8px 14px", fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
              <strong style={{ color: "#334155" }}>Backdated Refund Note:</strong>{" "}
              Backdated refunds (refunds processed today for bills created on prior dates) are shown as an explanatory row.
              They are already included inside "Refunds Today" total and are <em>NOT subtracted a second time</em> in the Expected Physical Cash formula.
              If you see a large backdated refund, it means an old-bill refund was processed today.
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════
               CATEGORY & TEST-WISE SUMMARY
               Counts valid (non-cancelled) billed tests by category + test.
               Uses stable testId from diagnostic_tests master — NOT the
               editable displayName on order_tests — so counts remain correct
               even if a test's display name was changed after billing.
          ══════════════════════════════════════════════════════════════════ */}
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            {/* Panel header */}
            <div className="px-4 py-3 bg-gradient-to-r from-teal-600/10 to-teal-600/5 border-b border-card-border flex items-center gap-2">
              <FlaskConical size={16} className="text-teal-600" />
              <span className="text-sm font-bold tracking-wide uppercase text-teal-900 dark:text-teal-200">
                Category &amp; Test Wise Summary
              </span>
              {ctQ.data && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {ctQ.data.total} tests
                </Badge>
              )}
              {/* Export / Print buttons — only enabled when data is loaded */}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  disabled={!ctQ.data || ctQ.data.categories.length === 0}
                  onClick={exportCategoryTestCSV}
                  title="Export as CSV"
                >
                  <Download size={12} /> CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  disabled={!ctQ.data || ctQ.data.categories.length === 0}
                  onClick={printCategoryTestSummary}
                  title="Print / Save as PDF"
                >
                  <Printer size={12} /> Print
                </Button>
              </div>
            </div>

            {/* Date preset buttons */}
            <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2 items-center border-b border-card-border bg-muted/20">
              <Calendar size={13} className="text-muted-foreground shrink-0" />
              {(
                [
                  { key: "today",     label: "Today" },
                  { key: "yesterday", label: "Yesterday" },
                  { key: "dby",       label: "Day Before" },
                  { key: "week",      label: "Last 7 Days" },
                  { key: "month",     label: "Last 30 Days" },
                  { key: "custom",    label: "Custom" },
                ] as { key: DatePreset; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setCtPreset(key)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md border font-medium transition-colors",
                    ctPreset === key
                      ? "bg-teal-600 text-white border-teal-600"
                      : "border-card-border bg-card hover:bg-muted/40 text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
              {ctPreset === "custom" && (
                <div className="flex items-center gap-2 ml-1">
                  <Input
                    type="date"
                    value={ctCustomFrom}
                    onChange={(e) => setCtCustomFrom(e.target.value)}
                    className="h-7 w-36 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={ctCustomTo}
                    onChange={(e) => setCtCustomTo(e.target.value)}
                    className="h-7 w-36 text-xs"
                  />
                </div>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground font-mono">
                {ctRange.from === ctRange.to ? ctRange.from : `${ctRange.from} → ${ctRange.to}`}
              </span>
            </div>

            {/* Content area */}
            <div className="p-4">
              {/* Loading */}
              {ctQ.isLoading && (
                <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                  <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
                </div>
              )}

              {/* Error */}
              {ctQ.isError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-400 flex items-center gap-2">
                  <XCircle size={14} />
                  Failed to load test counts.
                  <button
                    onClick={() => ctQ.refetch()}
                    className="underline text-xs ml-auto"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Empty */}
              {ctQ.isSuccess && ctQ.data.categories.length === 0 && (
                <div className="h-20 flex items-center justify-center text-muted-foreground text-sm italic">
                  No valid billed tests recorded for this period.
                </div>
              )}

              {/* Results */}
              {ctQ.isSuccess && ctQ.data.categories.length > 0 && (
                <>
                  {/* Expand / Collapse all */}
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground">
                      {ctQ.data.categories.length} categor{ctQ.data.categories.length === 1 ? "y" : "ies"} · {ctQ.data.total} tests total
                      <span className="ml-2 italic text-[11px]">(cancelled bills excluded)</span>
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => expandAll(ctQ.data.categories.map((c) => c.categoryName))}
                        className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline"
                      >
                        Expand all
                      </button>
                      <span className="text-muted-foreground text-[11px]">·</span>
                      <button
                        onClick={collapseAll}
                        className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline"
                      >
                        Collapse all
                      </button>
                    </div>
                  </div>

                  {/* Category rows */}
                  <div className="space-y-1.5">
                    {ctQ.data.categories.map((cat) => {
                      const isOpen = expandedCats.has(cat.categoryName);
                      return (
                        <div
                          key={cat.categoryName}
                          className="rounded-lg border border-card-border overflow-hidden"
                        >
                          {/* Category header row — clickable */}
                          <button
                            onClick={() => toggleCat(cat.categoryName)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-teal-50/60 dark:bg-teal-950/20 hover:bg-teal-100/60 dark:hover:bg-teal-900/20 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {isOpen
                                ? <ChevronUp size={13} className="text-teal-600 shrink-0" />
                                : <ChevronDown size={13} className="text-teal-600 shrink-0" />}
                              <span className="font-semibold text-sm text-teal-900 dark:text-teal-100 truncate">
                                {cat.categoryName}
                              </span>
                            </div>
                            <span className="font-bold text-sm text-teal-700 dark:text-teal-300 tabular-nums ml-4 shrink-0">
                              {cat.total}
                            </span>
                          </button>

                          {/* Test breakdown — visible when expanded */}
                          {isOpen && (
                            <div className="divide-y divide-card-border border-t border-card-border">
                              {cat.tests
                                .sort((a, b) => b.count - a.count)
                                .map((test) => (
                                  <div
                                    key={test.testId}
                                    className="flex items-center justify-between px-4 py-1.5 hover:bg-muted/20"
                                  >
                                    <span className="text-xs text-foreground">
                                      <span className="text-muted-foreground mr-1">—</span>
                                      {test.testName}
                                    </span>
                                    <span className="text-xs font-semibold tabular-nums text-foreground">
                                      {test.count}
                                    </span>
                                  </div>
                                ))}
                              {/* Category subtotal confirmation row */}
                              <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {cat.categoryName} total
                                </span>
                                <span className="text-xs font-bold tabular-nums text-teal-700 dark:text-teal-400">
                                  {cat.total}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Grand total row */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg border-2 border-teal-600/40 bg-teal-50/40 dark:bg-teal-950/20 mt-2">
                      <span className="text-sm font-bold text-teal-900 dark:text-teal-100">
                        Grand Total
                      </span>
                      <span className="text-sm font-bold tabular-nums text-teal-700 dark:text-teal-300">
                        {ctQ.data.total}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
