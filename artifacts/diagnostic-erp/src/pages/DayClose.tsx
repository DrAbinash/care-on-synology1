import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Lock, Unlock, RefreshCw, Printer, AlertTriangle, CheckCircle2, Users,
  Clock, ShieldCheck, Eye, ChevronDown, ChevronUp, Landmark, Info,
} from "lucide-react";
import { readStaffSession } from "@/lib/staffSession";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import StaffDayCloseDialog, { type StaffWindowBill } from "@/components/StaffDayCloseDialog";

type MethodTotals = { cash: number; upi: number; card: number; cheque: number; other: number; total: number; count: number };
type StaffRow = MethodTotals & { userId: number | null; userName: string };

type StaffUserStatus = {
  userId: number;
  userName: string;
  isClosed: boolean;
  closedAt: string | null;
  closureId: number | null;
  totalCollected: number;
  totalBilled: number;
  variance: number;
  drawerStatus: string;
  expectedCash: number;
  actualCash: number;
  cashVariance: number | null;
  expectedDigital: number | null;
  actualDigital: number | null;
  digitalVariance: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  handoverNote: string | null;
};
type StaffStatusResult = { users: StaffUserStatus[]; lastOverallClose: string | null };

type SuspenseItem = { id: number; amount: number; rawMethod: string; recordedByName: string | null };

type Preview = {
  coveredFromTs: string | null;
  coveredToTs: string;
  expected: MethodTotals;
  byStaff: StaffRow[];
  billsCount: number;
  paymentsCount: number;
  cashExpenses?: number;
  digitalExpenses?: number;
  suspenseTotal?: number;
  suspenseCount?: number;
  suspenseItems?: SuspenseItem[];
};

type RefundDetail = { id: number; billNumber: string; patientName: string; totalAmount: number; refundAmount: number };
type ExpenseDetail = { id: number; amount: number; category: string; description: string };
type TestSummary = { testId: number; testName: string; category: string; count: number; total: number };

type Closure = {
  id: number;
  closureDate: string;
  closedAt: string;
  closedByName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expectedCash: string; expectedUpi: string; expectedCard: string; expectedCheque: string; expectedOther: string;
  actualCash: string; actualUpi: string; actualCard: string; actualCheque: string; actualOther: string;
  variance: string; varianceNote: string;
  billsCount: number; paymentsCount: number;
  totalExpected: string; totalActual: string;
  staffBreakdown: StaffRow[];
  // Report enrichments
  totalBilled?: string;
  totalRefunds?: string;
  totalExpenses?: string;
  totalDue?: string;
  testSummary?: TestSummary[];
  expenseDetails?: ExpenseDetail[];
  refundDetails?: RefundDetail[];
  // Bills made inside this closure's window (added for the detail dialog).
  bills?: StaffWindowBill[];
  status: "closed" | "reopened";
  reopenedAt: string | null; reopenedByName: string; reopenReason: string;
};

type StaffCloseDetail = {
  id: number;
  userId: number | null;
  userName: string;
  closureDate: string;
  closedAt: string;
  expectedCash: string; expectedUpi: string; expectedCard: string; expectedCheque: string; expectedOther: string;
  actualCash: string; actualUpi: string; actualCard: string; actualCheque: string; actualOther: string;
  totalExpected: string; totalActual: string;
  variance: string; varianceNote: string;
  notes: string;
  drawerStatus: string;
  denominations: null | { d500: number; d200: number; d100: number; d50: number; d20: number; d10: number; coins: number };
  denominationTotal: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  // Bills the staff member made inside this closure's window.
  bills?: StaffWindowBill[];
};

type PostClosureActivity = {
  closedAt: string | null;
  closureId?: number;
  bills: { id: number; billNumber: string; totalAmount: number; paidAmount: number; status: string; createdAt: string }[];
  payments: { id: number; billId: number; amount: number; method: string; createdAt: string }[];
  billTotal: number;
  paymentTotal: number;
};

type ClinicLite = { name?: string; dayCloseAutoPrint?: boolean };

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const fmtIst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—";

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

function n(v: string | number | undefined | null): number {
  return Number(v ?? 0) || 0;
}

function buildSummarySlipHtml(c: Closure, clinic: ClinicLite): string {
  const esc = (s: string) => String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
  const variance = n(c.variance);
  const varianceLabel = variance === 0
    ? `<span style="color:#166534;font-weight:700">Balanced</span>`
    : variance < 0
      ? `<span style="color:#991b1b;font-weight:700">Short ${esc(inr(Math.abs(variance)))}</span>`
      : `<span style="color:#92400e;font-weight:700">Surplus ${esc(inr(variance))}</span>`;

  const totalBilled = n(c.totalBilled ?? c.totalExpected);
  const totalRefunds = n(c.totalRefunds);
  const totalExpenses = n(c.totalExpenses);
  const totalDue = n(c.totalDue);
  const netCollection = totalBilled - totalRefunds - totalExpenses;
  const digitalTotal = n(c.expectedUpi) + n(c.expectedCard) + n(c.expectedCheque) + n(c.expectedOther);
  const actualCash = n(c.actualCash);
  const actualDigital = n(c.actualUpi) + n(c.actualCard) + n(c.actualCheque) + n(c.actualOther);
  const expectedCash = n(c.expectedCash);

  const staffRows = (c.staffBreakdown ?? []).map((s) => {
    const sCash = n(s.cash);
    const sUpi = n(s.upi);
    const sCard = n(s.card);
    const sCheque = n(s.cheque);
    const sOther = n(s.other);
    const sDigital = sUpi + sCard + sCheque + sOther;
    return `<tr>
      <td style="padding:6px;border-bottom:1px solid #eee">${esc(s.userName)}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${esc(inr(sCash))}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${esc(inr(sDigital))}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${esc(inr(n(s.total)))}</td>
    </tr>`;
  }).join("");

  const refundRows = (c.refundDetails ?? []).map((r) => `<tr>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(r.billNumber)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(r.patientName)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${esc(inr(n(r.totalAmount)))}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${esc(inr(n(r.refundAmount)))}</td>
  </tr>`).join("");

  const expenseRows = (c.expenseDetails ?? []).map((e) => `<tr>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(e.category)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(e.description)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${esc(inr(n(e.amount)))}</td>
  </tr>`).join("");

  const testRows = (c.testSummary ?? []).map((t) => `<tr>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(t.testName)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee">${esc(t.category)}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right">${t.count}</td>
    <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${esc(inr(n(t.total)))}</td>
  </tr>`).join("");

  const cardBox = (label: string, value: string, accent: string) => `
    <div style="flex:1;min-width:120px;background:#fff;border-radius:6px;border:1px solid #e2e8f0;padding:10px;text-align:center">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;margin-bottom:4px">${esc(label)}</div>
      <div style="font-size:18px;font-weight:700;color:${accent}">${esc(value)}</div>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily Collection Report ${esc(c.closureDate)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: Arial, sans-serif; color:#1a1a2e; margin:0; padding:0; font-size:12px; }
    .header { text-align:center; padding:8px 0; border-bottom:3px solid #1e3a5f; margin-bottom:12px; }
    .header h1 { font-size:20px; margin:0; color:#1e3a5f; }
    .header .subtitle { font-size:12px; color:#64748b; margin-top:2px; }
    .section-title { background:#1e3a5f; color:#fff; font-size:12px; font-weight:700; padding:6px 10px; margin:16px 0 0; border-radius:4px 4px 0 0; }
    .table { width:100%; border-collapse:collapse; }
    .table th { background:#f1f5f9; padding:6px 8px; text-align:left; font-size:11px; font-weight:700; border-bottom:2px solid #e2e8f0; }
    .table td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }
    .table td:last-child, .table th:last-child { text-align:right; }
    .card-row { display:flex; gap:8px; margin:8px 0; flex-wrap:wrap; }
    .two-col { display:flex; gap:16px; margin-top:8px; }
    .col { flex:1; }
    .col-table { width:100%; border-collapse:collapse; }
    .col-table th { background:#f1f5f9; padding:5px 8px; text-align:left; font-size:11px; font-weight:700; border-bottom:2px solid #e2e8f0; }
    .col-table td { padding:5px 8px; border-bottom:1px solid #f1f5f9; }
    .col-table td:last-child { text-align:right; font-weight:600; }
    .grand-row td { border-top:2px solid #1e3a5f; padding-top:6px; font-weight:700; font-size:13px; }
    .note { margin-top:8px; padding:6px; background:#fef9e7; border:1px dashed #d97706; font-size:11px; border-radius:4px; }
    .footer { margin-top:12px; text-align:center; font-size:10px; color:#666; padding-top:8px; border-top:1px solid #eee; }
  </style></head><body>

  <div class="header">
    <h1>${esc(clinic?.name || "Diagnostic Centre")}</h1>
    <div class="subtitle">Daily Collection Reconciliation Report &middot; ${esc(c.closureDate)}</div>
    <div class="subtitle">Closed by ${esc(c.closedByName)} &middot; ${esc(fmtIst(c.coveredFromTs))} &rarr; ${esc(fmtIst(c.coveredToTs))}</div>
  </div>

  <!-- Summary Cards -->
  <div class="card-row">
    ${cardBox("Total Billed", inr(totalBilled), "#1e3a5f")}
    ${cardBox("Cash", inr(expectedCash), "#059669")}
    ${cardBox("UPI", inr(n(c.expectedUpi)), "#2563eb")}
    ${cardBox("Card", inr(n(c.expectedCard)), "#7c3aed")}
    ${cardBox("Refunds", inr(totalRefunds), "#991b1b")}
    ${cardBox("Expenses", inr(totalExpenses), "#991b1b")}
    ${cardBox("Net Collection", inr(netCollection), "#92400e")}
    ${cardBox("Physical Cash", inr(actualCash), "#059669")}
  </div>

  <!-- Reconciliation Summary + Cash Reconciliation -->
  <div class="two-col">
    <div class="col">
      <div class="section-title">Reconciliation Summary</div>
      <table class="col-table">
        <tbody>
          <tr><td>Total Billed</td><td>${esc(inr(totalBilled))}</td></tr>
          <tr><td>Total Collected</td><td>${esc(inr(n(c.totalActual)))}</td></tr>
          <tr><td>Total Refunds</td><td>${esc(inr(totalRefunds))}</td></tr>
          <tr><td>Total Expenses</td><td>${esc(inr(totalExpenses))}</td></tr>
          <tr><td>Total Outstanding</td><td>${esc(inr(totalDue))}</td></tr>
          <tr class="grand-row"><td>Net Collection</td><td>${esc(inr(netCollection))}</td></tr>
          <tr><td>Variance</td><td>${varianceLabel}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="col">
      <div class="section-title">Cash Reconciliation</div>
      <table class="col-table">
        <tbody>
          <tr><td>Net Collection</td><td>${esc(inr(netCollection))}</td></tr>
          <tr><td>Expected Cash</td><td>${esc(inr(expectedCash))}</td></tr>
          <tr><td>Actual Cash</td><td>${esc(inr(actualCash))}</td></tr>
          <tr><td>Cash Variance</td><td style="color:${actualCash - expectedCash === 0 ? "#166534" : "#991b1b"}">${esc(inr(actualCash - expectedCash))}</td></tr>
          <tr><td>Digital Total</td><td>${esc(inr(digitalTotal))}</td></tr>
          <tr><td>Actual Digital</td><td>${esc(inr(actualDigital))}</td></tr>
          <tr class="grand-row"><td>Total Collection</td><td>${esc(inr(n(c.totalActual)))}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- User Wise Collection -->
  <div class="section-title">User Wise Collection</div>
  <table class="table">
    <thead><tr><th>Staff</th><th style="text-align:right">Cash</th><th style="text-align:right">Digital</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>
      ${staffRows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:8px">No staff breakdown</td></tr>`}
      <tr class="grand-row"><td>Total</td><td style="text-align:right">${esc(inr(expectedCash))}</td><td style="text-align:right">${esc(inr(digitalTotal))}</td><td style="text-align:right">${esc(inr(n(c.totalActual)))}</td></tr>
    </tbody>
  </table>

  <!-- Refund Details -->
  <div class="section-title">Refund Details</div>
  <table class="table">
    <thead><tr><th>Bill #</th><th>Patient</th><th style="text-align:right">Bill Total</th><th style="text-align:right">Refund</th></tr></thead>
    <tbody>
      ${refundRows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:8px">No refunds</td></tr>`}
      ${refundRows ? `<tr class="grand-row"><td colspan="3">Total Refunds</td><td style="text-align:right">${esc(inr(totalRefunds))}</td></tr>` : ""}
    </tbody>
  </table>

  <!-- Expense Details -->
  <div class="section-title">Expense Details</div>
  <table class="table">
    <thead><tr><th>Category</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      ${expenseRows || `<tr><td colspan="3" style="text-align:center;color:#888;padding:8px">No expenses</td></tr>`}
      ${expenseRows ? `<tr class="grand-row"><td colspan="2">Total Expenses</td><td style="text-align:right">${esc(inr(totalExpenses))}</td></tr>` : ""}
    </tbody>
  </table>

  <!-- Outstanding / Dues -->
  <div class="section-title">Outstanding / Dues Details</div>
  <table class="table">
    <tbody>
      <tr><td>Total Outstanding</td><td style="text-align:right;font-weight:700">${esc(inr(totalDue))}</td></tr>
      <tr><td>Total Bills</td><td style="text-align:right;font-weight:700">${c.billsCount}</td></tr>
      <tr><td>Total Payments</td><td style="text-align:right;font-weight:700">${c.paymentsCount}</td></tr>
    </tbody>
  </table>

  <!-- Test Wise Collection Summary -->
  <div class="section-title">Test Wise Collection Summary</div>
  <table class="table">
    <thead><tr><th>Test</th><th>Category</th><th style="text-align:right">Count</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>
      ${testRows || `<tr><td colspan="4" style="text-align:center;color:#888;padding:8px">No tests recorded</td></tr>`}
      ${testRows ? `<tr class="grand-row"><td colspan="3">Grand Total</td><td style="text-align:right">${esc(inr((c.testSummary ?? []).reduce((s, t) => s + n(t.total), 0)))}</td></tr>` : ""}
    </tbody>
  </table>

  ${c.varianceNote ? `<div class="note"><strong>Variance Note:</strong> ${esc(c.varianceNote)}</div>` : ""}
  <div class="footer">Printed ${esc(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST &middot; Closure #${c.id}</div>
</body></html>`;
}

function openReportWindow(c: Closure, clinic: ClinicLite) {
  const html = buildSummarySlipHtml(c, clinic);
  const w = window.open("", "_blank", "width=900,height=800");
  if (!w) {
    alert("Pop-up blocked. Allow pop-ups to print the report.");
    return null;
  }
  w.document.open(); w.document.write(html); w.document.close();
  return w;
}

function autoPrintSlip(c: Closure, clinic: ClinicLite) {
  const w = openReportWindow(c, clinic);
  if (!w) return;
  w.onload = () => { w.focus(); w.print(); setTimeout(() => w.close(), 800); };
}

function downloadReportPdf(c: Closure, clinic: ClinicLite) {
  const w = openReportWindow(c, clinic);
  if (!w) return;
  w.onload = () => {
    w.focus();
    // Modern browsers offer "Save as PDF" in the print dialog
    w.print();
  };
}

// ── Status helpers ────────────────────────────────────────────────────────────

type DrawerStatusKey = "open" | "balanced" | "mismatch" | "approved" | "closed" | "reopened";

const STATUS_CONFIG: Record<DrawerStatusKey, { label: string; badge: string }> = {
  open:     { label: "Open",     badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  balanced: { label: "Balanced", badge: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  mismatch: { label: "Mismatch", badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  approved: { label: "Approved", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  closed:   { label: "Closed",   badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  reopened: { label: "Reopened", badge: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
};

function DrawerBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as DrawerStatusKey] ?? STATUS_CONFIG.open;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.badge}`}>
      {cfg.label}
    </span>
  );
}

export default function DayClose() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const isSuperAdmin = session?.user?.role === "super_admin";
  const isOwner = ["admin", "super_admin", "owner"].includes(session?.user?.role ?? "");

  const previewQ = useQuery<Preview>({
    queryKey: ["day-close-preview"],
    queryFn: () => api.get<Preview>("/api/day-close/preview"),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const closuresQ = useQuery<Closure[]>({
    queryKey: ["day-close-list"],
    queryFn: () => api.get<Closure[]>("/api/day-close"),
    ...FINANCIAL_QUERY_OPTIONS,
  });
  const clinicQ = useQuery<ClinicLite>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get<ClinicLite>("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });
  const staffStatusQ = useQuery<StaffStatusResult>({
    queryKey: ["day-close-staff-status"],
    queryFn: () => api.get<StaffStatusResult>("/api/day-close/staff-status"),
    ...FINANCIAL_QUERY_OPTIONS,
    enabled: isOwner,
  });

  const [actuals, setActuals] = useState({ cash: "", upi: "", card: "", cheque: "", other: "" });
  const [varianceNote, setVarianceNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<Closure | null>(null);
  const [reopenOpen, setReopenOpen] = useState<Closure | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  // Staff drawer actions
  const [staffDetailId, setStaffDetailId] = useState<number | null>(null);
  const [staffCloseUser, setStaffCloseUser] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState<StaffUserStatus | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [staffReopenOpen, setStaffReopenOpen] = useState<StaffUserStatus | null>(null);
  const [staffReopenReason, setStaffReopenReason] = useState("");
  const [staffTableExpanded, setStaffTableExpanded] = useState(true);

  // Banking day-close summary
  const [bankingOpen, setBankingOpen] = useState(false);
  const bankingDate = previewQ.data?.coveredToTs
    ? new Date(previewQ.data.coveredToTs).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  const bankingQ = useQuery({
    queryKey: ["day-close-banking", bankingDate],
    queryFn: () => api.get<{ date: string; summary: Array<{
      accountId: number; provider: string; bankName: string; nickname: string | null;
      balance: number | null; credits: number; debits: number; net: number; transactionCount: number;
      error?: string;
    }> }>(`/api/banking/day-close/${bankingDate}`),
    enabled: bankingOpen,
  });

  const staffDetailQ = useQuery<StaffCloseDetail>({
    queryKey: ["staff-close-detail", staffDetailId],
    queryFn: () => api.get<StaffCloseDetail>(`/api/day-close/staff-close-detail/${staffDetailId}`),
    enabled: staffDetailId !== null,
  });

  // Post-closure activity for the staff member whose closure detail is open —
  // bills/payments they made AFTER their latest drawer close. Only fetched
  // when the viewed closure is that user's latest (otherwise "latest close"
  // on the server refers to a different window).
  const detailIsLatestForUser = staffDetailQ.data
    ? staffStatusQ.data?.users.some((u) => u.userName === staffDetailQ.data!.userName && u.closureId === staffDetailQ.data!.id) === true
    : false;
  const staffPostClosureQ = useQuery<PostClosureActivity>({
    queryKey: ["staff-post-closure-activity", staffDetailQ.data?.userName],
    queryFn: () => api.get<PostClosureActivity>(`/api/day-close/staff-post-closure-activity/${encodeURIComponent(staffDetailQ.data!.userName)}`),
    enabled: detailIsLatestForUser,
  });

  // The overall-closure detail dialog needs the enriched row (with the window's
  // bills) — the list endpoint returns rows without them.
  const overallDetailQ = useQuery<Closure>({
    queryKey: ["day-close-detail", detailOpen?.id],
    queryFn: () => api.get<Closure>(`/api/day-close/${detailOpen!.id}`),
    enabled: detailOpen !== null,
  });

  useEffect(() => {
    if (!previewQ.data) return;
    setActuals({
      cash: String(previewQ.data.expected.cash || ""),
      upi: String(previewQ.data.expected.upi || ""),
      card: String(previewQ.data.expected.card || ""),
      cheque: String(previewQ.data.expected.cheque || ""),
      other: String(previewQ.data.expected.other || ""),
    });
  }, [previewQ.data]);

  const totalActual = useMemo(() =>
    n(actuals.cash) + n(actuals.upi) + n(actuals.card) + n(actuals.cheque) + n(actuals.other),
    [actuals]);
  const totalExpected = previewQ.data?.expected.total ?? 0;
  const variance = totalActual - totalExpected;

  const closeMut = useMutation<Closure>({
    mutationFn: () =>
      api.post<Closure>("/api/day-close", {
        actuals: {
          cash: n(actuals.cash), upi: n(actuals.upi), card: n(actuals.card),
          cheque: n(actuals.cheque), other: n(actuals.other),
        },
        varianceNote,
      }),
    onSuccess: (closure) => {
      toast({ title: "Day closed", description: `Variance: ${inr(n(closure.variance))}` });
      setConfirmOpen(false);
      setVarianceNote("");
      qc.invalidateQueries({ queryKey: ["day-close-preview"] });
      qc.invalidateQueries({ queryKey: ["day-close-list"] });
      if (clinicQ.data?.dayCloseAutoPrint !== false) {
        autoPrintSlip(closure, clinicQ.data ?? {});
      }
    },
    onError: (e: Error) => toast({ title: "Close failed", description: e.message, variant: "destructive" }),
  });

  const reopenMut = useMutation<Closure, Error, { id: number; reason: string }>({
    mutationFn: (vars) =>
      api.post<Closure>(`/api/day-close/${vars.id}/reopen`, { reason: vars.reason }),
    onSuccess: () => {
      toast({ title: "Day re-opened" });
      setReopenOpen(null);
      setReopenReason("");
      qc.invalidateQueries({ queryKey: ["day-close-preview"] });
      qc.invalidateQueries({ queryKey: ["day-close-list"] });
    },
    onError: (e: Error) => toast({ title: "Reopen failed", description: e.message, variant: "destructive" }),
  });

  const approveMut = useMutation<unknown, Error, { id: number; note: string }>({
    mutationFn: (vars) =>
      api.post(`/api/day-close/staff-close/${vars.id}/approve-mismatch`, { note: vars.note }),
    onSuccess: () => {
      toast({ title: "Mismatch approved" });
      setApproveOpen(null);
      setApproveNote("");
      qc.invalidateQueries({ queryKey: ["day-close-staff-status"] });
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const staffReopenMut = useMutation<unknown, Error, { id: number; reason: string }>({
    mutationFn: (vars) =>
      api.post(`/api/day-close/staff-close/${vars.id}/reopen`, { reason: vars.reason }),
    onSuccess: () => {
      toast({ title: "Staff drawer reopened" });
      setStaffReopenOpen(null);
      setStaffReopenReason("");
      qc.invalidateQueries({ queryKey: ["day-close-staff-status"] });
    },
    onError: (e: Error) => toast({ title: "Reopen failed", description: e.message, variant: "destructive" }),
  });

  const expected = previewQ.data?.expected;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Lock size={20} /> Day Close / Cash Drawer</h1>
          <p className="text-sm text-muted-foreground">Reconcile expected vs collected cash. Bills created after close belong to the next day.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => previewQ.refetch()} disabled={previewQ.isFetching}>
          <RefreshCw size={14} className={`mr-2 ${previewQ.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* ── Staff Drawer Close Reconciliation Table (owner/admin only) ─────── */}
      {isOwner && staffStatusQ.data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users size={16} /> Staff Drawer Close Status
              {(() => {
                const users = staffStatusQ.data.users;
                const closed = users.filter((u) => u.isClosed).length;
                const mismatched = users.filter((u) => u.drawerStatus === "mismatch").length;
                return (
                  <span className="ml-auto flex items-center gap-2 text-sm font-normal">
                    {mismatched > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 text-xs font-bold flex items-center gap-1">
                        <AlertTriangle size={10} /> {mismatched} mismatch
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      closed === users.length
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    }`}>
                      {closed}/{users.length} closed
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setStaffTableExpanded((e) => !e)}
                    >
                      {staffTableExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </span>
                );
              })()}
            </CardTitle>
          </CardHeader>
          {staffTableExpanded && (
            <CardContent>
              {staffStatusQ.data.users.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active staff accounts found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground uppercase border-b bg-muted/30">
                      <tr>
                        <th className="px-3 py-2">Staff</th>
                        <th className="px-3 py-2 text-right">Exp. Cash</th>
                        <th className="px-3 py-2 text-right">Counted Cash</th>
                        <th className="px-3 py-2 text-right">Cash Var.</th>
                        <th className="px-3 py-2 text-right">Exp. Digital</th>
                        <th className="px-3 py-2 text-right">Counted Dig.</th>
                        <th className="px-3 py-2 text-right">Dig. Var.</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Closed At</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffStatusQ.data.users.map((u) => {
                        const cashVar = u.cashVariance ?? 0;
                        const digVar = u.digitalVariance ?? 0;
                        return (
                          <tr key={u.userId} className={`border-b last:border-b-0 ${
                            u.drawerStatus === "mismatch"
                              ? "bg-red-50/40 dark:bg-red-950/10"
                              : u.drawerStatus === "balanced" || u.drawerStatus === "closed"
                                ? "bg-green-50/30 dark:bg-green-950/10"
                                : ""
                          }`}>
                            <td className="px-3 py-2 font-medium">
                              <div className="flex items-center gap-1.5">
                                {u.isClosed
                                  ? <CheckCircle2 size={12} className="text-green-600 shrink-0" />
                                  : <Clock size={12} className="text-amber-600 shrink-0" />}
                                {u.userName}
                              </div>
                              {u.handoverNote && (
                                <div className="text-[10px] text-muted-foreground italic mt-0.5 max-w-[120px] truncate">
                                  {u.handoverNote}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{inr(u.expectedCash)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {u.isClosed ? inr(u.actualCash) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                              !u.isClosed ? "text-muted-foreground"
                              : cashVar < 0 ? "text-red-600"
                              : cashVar > 0 ? "text-amber-600"
                              : "text-green-600"
                            }`}>
                              {u.isClosed ? (cashVar === 0 ? "✓" : `${cashVar < 0 ? "−" : "+"}${inr(Math.abs(cashVar))}`) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {u.expectedDigital !== null ? inr(u.expectedDigital) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {u.actualDigital !== null ? inr(u.actualDigital) : <span className="text-muted-foreground">—</span>}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                              !u.isClosed ? "text-muted-foreground"
                              : digVar < 0 ? "text-red-600"
                              : digVar > 0 ? "text-amber-600"
                              : "text-green-600"
                            }`}>
                              {u.isClosed && u.digitalVariance !== null
                                ? (digVar === 0 ? "✓" : `${digVar < 0 ? "−" : "+"}${inr(Math.abs(digVar))}`)
                                : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <DrawerBadge status={u.drawerStatus} />
                              {u.approvedByName && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">by {u.approvedByName}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                              {u.closedAt ? fmtTime(u.closedAt) : <span className="text-amber-600">Not closed</span>}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {(!u.isClosed || u.drawerStatus === "reopened") && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-700 hover:text-blue-800 dark:text-blue-400"
                                    title={`Close ${u.userName}'s day on their behalf (cash handover)`}
                                    onClick={() => setStaffCloseUser(u.userName)}>
                                    <Lock size={12} className="mr-1" /> Close
                                  </Button>
                                )}
                                {u.closureId && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                    onClick={() => setStaffDetailId(u.closureId)}>
                                    <Eye size={12} className="mr-1" /> View
                                  </Button>
                                )}
                                {u.drawerStatus === "mismatch" && u.closureId && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700"
                                    onClick={() => setApproveOpen(u)}>
                                    <ShieldCheck size={12} className="mr-1" /> Approve
                                  </Button>
                                )}
                                {isSuperAdmin && u.isClosed && u.drawerStatus !== "reopened" && u.closureId && (
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                    onClick={() => setStaffReopenOpen(u)}>
                                    <Unlock size={12} className="mr-1" /> Reopen
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {staffStatusQ.data.users.some((u) => !u.isClosed) && (
                <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Some staff have not closed their day. You can still close the overall day — their window will reset.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Open window summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open Window</CardTitle>
          <p className="text-xs text-muted-foreground font-normal mt-1">
            Rolling window since the last day-close — not the same as Daily Summary&apos;s calendar Today (IST).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-muted-foreground">Since last close</div><div className="font-medium">{fmtIst(previewQ.data?.coveredFromTs ?? null)}</div></div>
            <div><div className="text-muted-foreground">Now (IST)</div><div className="font-medium">{fmtIst(previewQ.data?.coveredToTs ?? null)}</div></div>
            <div><div className="text-muted-foreground">Bills</div><div className="font-medium">{previewQ.data?.billsCount ?? 0}</div></div>
            <div><div className="text-muted-foreground">Payments</div><div className="font-medium">{previewQ.data?.paymentsCount ?? 0}</div></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Suspense / Exception Bucket — payments in this window whose
            method could not be classified as cash or digital. Already
            excluded from Expected Cash/totals above; needs admin
            correction before closing. See
            DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.3. Only
            rendered when there is something to review. */}
      {(previewQ.data?.suspenseCount ?? 0) > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-400">
              <Info className="w-4 h-4" /> Needs review before closing — unrecognized payment method
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-700 dark:text-amber-500 mb-2">
              {previewQ.data?.suspenseCount} transaction(s) totalling {inr(previewQ.data?.suspenseTotal ?? 0)} have a
              payment method not recognized by this system. They are <strong>excluded from Expected Cash above</strong> —
              not assumed to be cash or digital — until corrected. Closing the day now will not include them in
              either total.
            </p>
            {previewQ.data?.suspenseItems && previewQ.data.suspenseItems.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100/60 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Amount</th>
                      <th className="text-left px-2 py-1 font-medium">Raw method</th>
                      <th className="text-left px-2 py-1 font-medium">Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewQ.data.suspenseItems.map((item) => (
                      <tr key={item.id} className="border-t border-amber-200 dark:border-amber-800/60">
                        <td className="px-2 py-1 tabular-nums">{inr(item.amount)}</td>
                        <td className="px-2 py-1 font-mono">{item.rawMethod || "(blank)"}</td>
                        <td className="px-2 py-1">{item.recordedByName || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Banking summary */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" /> Banking Summary</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setBankingOpen((v) => !v)}>
            {bankingOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </CardHeader>
        {bankingOpen && (
          <CardContent>
            {bankingQ.isLoading && <p className="text-sm text-muted-foreground">Loading bank data…</p>}
            {bankingQ.isError && <p className="text-sm text-red-600">Could not load banking summary.</p>}
            {bankingQ.data && (
              <div className="space-y-3">
                {bankingQ.data.summary.length === 0 && (
                  <p className="text-sm text-muted-foreground">No active bank accounts configured.</p>
                )}
                {bankingQ.data.summary.map((s) => (
                  <div key={s.accountId} className="flex items-center justify-between text-sm border-b last:border-b-0 py-2">
                    <div>
                      <div className="font-medium">{s.bankName} {s.nickname ? `(${s.nickname})` : ""}</div>
                      <div className="text-xs text-muted-foreground">{s.provider} · {s.transactionCount} txns</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">
                        {s.error ? <span className="text-red-600 text-xs">{s.error}</span>
                          : <span>{s.balance != null ? inr(s.balance) : "—"}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="text-green-600">↗ {inr(s.credits)}</span> · <span className="text-red-600">↘ {inr(s.debits)}</span> · Net {inr(s.net)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
        {!bankingOpen && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">Click to show live bank balance and transaction summary for today.</p>
          </CardContent>
        )}
      </Card>

      {/* Reconcile form */}
      <Card>
        <CardHeader><CardTitle className="text-base">Reconcile &amp; Close</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-5">
            {(["cash","upi","card","cheque","other"] as const).map((m) => {
              const exp = expected ? expected[m] : 0;
              const act = n(actuals[m]);
              const diff = act - exp;
              return (
                <div key={m}>
                  <Label className="capitalize">{m}</Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={actuals[m]}
                    onChange={(e) => setActuals((a) => ({ ...a, [m]: e.target.value }))}
                    className="mt-1"
                  />
                  <div className="text-xs mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Expected: {inr(exp)}</span>
                    {diff !== 0 && (
                      <span className={diff < 0 ? "text-red-600" : "text-amber-600"}>
                        {diff < 0 ? "−" : "+"}{inr(Math.abs(diff))}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-muted/30 rounded-lg">
            <div><div className="text-xs text-muted-foreground">Expected Total</div><div className="text-lg font-bold">{inr(totalExpected)}</div></div>
            <div><div className="text-xs text-muted-foreground">Actual Total</div><div className="text-lg font-bold">{inr(totalActual)}</div></div>
            <div>
              <div className="text-xs text-muted-foreground">Variance</div>
              <div className={`text-lg font-bold ${variance === 0 ? "text-green-600" : variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                {variance === 0 ? "Balanced" : `${variance < 0 ? "−" : "+"}${inr(Math.abs(variance))}`}
              </div>
            </div>
          </div>

          {variance !== 0 && (
            <div>
              <Label>Variance Note {variance !== 0 && <span className="text-red-600">*</span>}</Label>
              <Textarea
                value={varianceNote}
                onChange={(e) => setVarianceNote(e.target.value)}
                placeholder="Explain the variance — e.g. ₹500 short, possibly cash given as change without entry."
                className="mt-1"
                rows={2}
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={() => setConfirmOpen(true)}
              disabled={previewQ.isLoading || (variance !== 0 && varianceNote.trim().length < 3)}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <Lock size={16} className="mr-2" />
              Close Day
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Per-staff breakdown */}
      {(previewQ.data?.byStaff?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Per-Staff Collection (Open Window)</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase border-b">
                <tr><th className="py-2">Staff</th><th>Cash</th><th>UPI</th><th>Card</th><th>Cheque</th><th>Other</th><th>Count</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {previewQ.data!.byStaff.map((s) => (
                  <tr key={`${s.userId ?? "u"}-${s.userName}`} className="border-b last:border-b-0">
                    <td className="py-2 font-medium">{s.userName}</td>
                    <td>{inr(s.cash)}</td>
                    <td>{inr(s.upi)}</td>
                    <td>{inr(s.card)}</td>
                    <td>{inr(s.cheque)}</td>
                    <td>{inr(s.other)}</td>
                    <td>{s.count}</td>
                    <td className="text-right font-semibold">{inr(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Past closures */}
      <Card>
        <CardHeader><CardTitle className="text-base">Past Closures</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground uppercase border-b">
              <tr><th className="py-2">Date</th><th>Closed At</th><th>By</th><th>Bills</th><th>Total</th><th>Variance</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {(closuresQ.data ?? []).map((c) => {
                const v = n(c.variance);
                return (
                  <tr key={c.id} className="border-b last:border-b-0">
                    <td className="py-2 font-medium">{c.closureDate}</td>
                    <td>{fmtIst(c.closedAt)}</td>
                    <td>{c.closedByName}</td>
                    <td>{c.billsCount}</td>
                    <td>{inr(n(c.totalActual))}</td>
                    <td className={v === 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-amber-600"}>
                      {v === 0 ? "—" : `${v < 0 ? "−" : "+"}${inr(Math.abs(v))}`}
                    </td>
                    <td>
                      {c.status === "reopened"
                        ? <Badge variant="destructive">Re-opened</Badge>
                        : <Badge className="bg-green-600">Closed</Badge>}
                    </td>
                    <td className="text-right space-x-2">
                      <Button size="sm" variant="ghost" onClick={() => setDetailOpen(c)}>View</Button>
                      <Button size="sm" variant="ghost" onClick={() => autoPrintSlip(c, clinicQ.data ?? {})}><Printer size={14} /></Button>
                      {isSuperAdmin && c.status === "closed" && (
                        <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => setReopenOpen(c)}>
                          <Unlock size={14} className="mr-1" /> Reopen
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!closuresQ.isLoading && (closuresQ.data?.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No closures yet — close your first day above.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Confirm close */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {variance === 0 ? <CheckCircle2 className="text-green-600" /> : <AlertTriangle className="text-amber-600" />}
              Confirm Day Close
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Bills</span><strong>{previewQ.data?.billsCount ?? 0}</strong></div>
            <div className="flex justify-between"><span>Expected</span><strong>{inr(totalExpected)}</strong></div>
            <div className="flex justify-between"><span>Actual</span><strong>{inr(totalActual)}</strong></div>
            <div className="flex justify-between"><span>Variance</span>
              <strong className={variance === 0 ? "text-green-600" : variance < 0 ? "text-red-600" : "text-amber-600"}>
                {variance === 0 ? "Balanced" : `${variance < 0 ? "−" : "+"}${inr(Math.abs(variance))}`}
              </strong>
            </div>
            {varianceNote && <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border rounded text-xs">{varianceNote}</div>}
            {clinicQ.data?.dayCloseAutoPrint !== false && (
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Printer size={12} /> A summary slip will print automatically after close.</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => closeMut.mutate()} disabled={closeMut.isPending} className="bg-blue-700 hover:bg-blue-800">
              {closeMut.isPending ? "Closing..." : "Confirm & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overall closure detail */}
      <Dialog open={!!detailOpen} onOpenChange={(o) => !o && setDetailOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Closure #{detailOpen?.id} — {detailOpen?.closureDate}</DialogTitle></DialogHeader>
          {detailOpen && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-muted-foreground text-xs">Closed By</div><div>{detailOpen.closedByName}</div></div>
                <div><div className="text-muted-foreground text-xs">Closed At</div><div>{fmtIst(detailOpen.closedAt)}</div></div>
                <div><div className="text-muted-foreground text-xs">Window</div><div>{fmtIst(detailOpen.coveredFromTs)} &rarr; {fmtIst(detailOpen.coveredToTs)}</div></div>
                <div><div className="text-muted-foreground text-xs">Bills / Payments</div><div>{detailOpen.billsCount} / {detailOpen.paymentsCount}</div></div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-blue-50 dark:bg-blue-950/30 border rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Total Billed</div>
                  <div className="font-bold text-blue-700">{inr(n(detailOpen.totalBilled ?? detailOpen.totalExpected))}</div>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 border rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Refunds</div>
                  <div className="font-bold text-red-700">{inr(n(detailOpen.totalRefunds))}</div>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 border rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Expenses</div>
                  <div className="font-bold text-red-700">{inr(n(detailOpen.totalExpenses))}</div>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 border rounded p-2 text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Net</div>
                  <div className="font-bold text-green-700">
                    {inr(n(detailOpen.totalBilled ?? detailOpen.totalExpected) - n(detailOpen.totalRefunds) - n(detailOpen.totalExpenses))}
                  </div>
                </div>
              </div>

              {/* Cash Drawer */}
              <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">Cash Drawer</div>
              <table className="w-full text-xs border-t">
                <thead><tr className="text-muted-foreground"><th className="text-left py-1">Method</th><th className="text-right">Expected</th><th className="text-right">Actual</th><th className="text-right">Diff</th></tr></thead>
                <tbody>
                  {(["Cash","Upi","Card","Cheque","Other"] as const).map((m) => {
                    const e = n(detailOpen[`expected${m}` as keyof Closure] as string);
                    const a = n(detailOpen[`actual${m}` as keyof Closure] as string);
                    const v = a - e;
                    return (
                      <tr key={m} className="border-t"><td className="py-1">{m}</td><td className="text-right">{inr(e)}</td><td className="text-right">{inr(a)}</td><td className={`text-right ${v < 0 ? "text-red-600" : v > 0 ? "text-amber-600" : ""}`}>{v === 0 ? "—" : inr(v)}</td></tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Outstanding */}
              <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">Outstanding / Dues</div>
              <div className="flex justify-between text-xs px-1">
                <span>Total Outstanding</span>
                <span className="font-bold">{inr(n(detailOpen.totalDue))}</span>
              </div>

              {/* Test Summary */}
              {(detailOpen.testSummary ?? []).length > 0 && (
                <>
                  <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">Test Wise Summary</div>
                  <table className="w-full text-xs border-t">
                    <thead><tr className="text-muted-foreground"><th className="text-left py-1">Test</th><th className="text-right">Count</th><th className="text-right">Total</th></tr></thead>
                    <tbody>
                      {(detailOpen.testSummary ?? []).map((t) => (
                        <tr key={t.testId} className="border-t"><td className="py-1">{t.testName}</td><td className="text-right">{t.count}</td><td className="text-right">{inr(n(t.total))}</td></tr>
                      ))}
                      <tr className="border-t font-bold"><td>Total</td><td className="text-right">{(detailOpen.testSummary ?? []).reduce((s, t) => s + t.count, 0)}</td><td className="text-right">{inr((detailOpen.testSummary ?? []).reduce((s, t) => s + n(t.total), 0))}</td></tr>
                    </tbody>
                  </table>
                </>
              )}

              {/* Refund Details */}
              {(detailOpen.refundDetails ?? []).length > 0 && (
                <>
                  <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">Refund Details</div>
                  <table className="w-full text-xs border-t">
                    <thead><tr className="text-muted-foreground"><th className="text-left py-1">Bill #</th><th className="text-left">Patient</th><th className="text-right">Refund</th></tr></thead>
                    <tbody>
                      {(detailOpen.refundDetails ?? []).map((r) => (
                        <tr key={r.id} className="border-t"><td className="py-1">{r.billNumber}</td><td>{r.patientName}</td><td className="text-right">{inr(n(r.refundAmount))}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {/* Expense Details */}
              {(detailOpen.expenseDetails ?? []).length > 0 && (
                <>
                  <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">Expense Details</div>
                  <table className="w-full text-xs border-t">
                    <thead><tr className="text-muted-foreground"><th className="text-left py-1">Category</th><th className="text-left">Description</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {(detailOpen.expenseDetails ?? []).map((e) => (
                        <tr key={e.id} className="border-t"><td className="py-1">{e.category}</td><td>{e.description}</td><td className="text-right">{inr(n(e.amount))}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {detailOpen.varianceNote && <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border rounded text-xs"><strong>Note:</strong> {detailOpen.varianceNote}</div>}

              {/* Bills made inside this closure's window */}
              {overallDetailQ.data?.bills && overallDetailQ.data.bills.length > 0 && (
                <>
                  <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">
                    Bills Made ({overallDetailQ.data.bills.length})
                  </div>
                  <div className="overflow-y-auto max-h-56 rounded border border-card-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr className="text-muted-foreground">
                          <th className="text-left px-2 py-1 font-semibold">Bill #</th>
                          <th className="text-left px-2 py-1 font-semibold">Patient</th>
                          <th className="text-left px-2 py-1 font-semibold">By</th>
                          <th className="text-right px-2 py-1 font-semibold">Total</th>
                          <th className="text-right px-2 py-1 font-semibold">Paid</th>
                          <th className="text-left px-2 py-1 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-card-border">
                        {overallDetailQ.data.bills.map((b) => (
                          <tr key={b.id}>
                            <td className="px-2 py-1 font-semibold whitespace-nowrap">{b.billNumber}</td>
                            <td className="px-2 py-1 max-w-[120px] truncate">{b.patientName}</td>
                            <td className="px-2 py-1 text-muted-foreground">{b.createdByName || "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{inr(b.totalAmount)}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400">{inr(b.paidAmount)}</td>
                            <td className="px-2 py-1 capitalize">{b.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {detailOpen && overallDetailQ.isLoading && (
                <p className="text-xs text-muted-foreground">Loading bills made in this window…</p>
              )}
              {detailOpen.status === "reopened" && (
                <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-300 rounded text-xs">
                  <strong>Re-opened</strong> by {detailOpen.reopenedByName} on {fmtIst(detailOpen.reopenedAt)}<br/>
                  Reason: {detailOpen.reopenReason}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => detailOpen && autoPrintSlip(detailOpen, clinicQ.data ?? {})}><Printer size={14} className="mr-2" /> Print Report</Button>
            <Button variant="outline" onClick={() => detailOpen && downloadReportPdf(detailOpen, clinicQ.data ?? {})}><Printer size={14} className="mr-2" /> Download PDF</Button>
            <Button onClick={() => setDetailOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overall reopen (super-admin) */}
      <Dialog open={!!reopenOpen} onOpenChange={(o) => !o && setReopenOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Unlock className="text-amber-600" /> Re-open Closure #{reopenOpen?.id}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Re-opening marks this closure as "reopened". Transactions in the re-opened window will roll into the next close.</p>
            <Label>Reason (required, audited)</Label>
            <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. Cash counted again, found ₹200 missed earlier." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={reopenMut.isPending || reopenReason.trim().length < 3}
              onClick={() => reopenOpen && reopenMut.mutate({ id: reopenOpen.id, reason: reopenReason.trim() })}
            >
              {reopenMut.isPending ? "Re-opening..." : "Confirm Re-open"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staff closure detail */}
      <Dialog open={staffDetailId !== null} onOpenChange={(o) => !o && setStaffDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {staffDetailQ.data
                ? `${staffDetailQ.data.userName} — ${staffDetailQ.data.closureDate}`
                : "Staff Closure Detail"}
            </DialogTitle>
          </DialogHeader>
          {staffDetailQ.isLoading && <p className="text-sm text-muted-foreground p-2">Loading…</p>}
          {staffDetailQ.data && (() => {
            const d = staffDetailQ.data;
            return (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <DrawerBadge status={d.drawerStatus} />
                  <span className="text-xs text-muted-foreground">Closed at {fmtIst(d.closedAt)}</span>
                </div>
                <table className="w-full text-xs border-t">
                  <thead><tr className="text-muted-foreground"><th className="text-left py-1">Method</th><th className="text-right">Expected</th><th className="text-right">Actual</th><th className="text-right">Diff</th></tr></thead>
                  <tbody>
                    {(["Cash","Upi","Card","Cheque","Other"] as const).map((m) => {
                      const e = n(d[`expected${m}` as keyof StaffCloseDetail] as string);
                      const a = n(d[`actual${m}` as keyof StaffCloseDetail] as string);
                      const v = a - e;
                      return (
                        <tr key={m} className="border-t"><td className="py-1">{m}</td><td className="text-right">{inr(e)}</td><td className="text-right">{inr(a)}</td><td className={`text-right ${v < 0 ? "text-red-600" : v > 0 ? "text-amber-600" : ""}`}>{v === 0 ? "—" : inr(v)}</td></tr>
                      );
                    })}
                    <tr className="border-t font-bold bg-muted/20">
                      <td className="py-1">Total</td>
                      <td className="text-right">{inr(n(d.totalExpected))}</td>
                      <td className="text-right">{inr(n(d.totalActual))}</td>
                      <td className={`text-right ${n(d.variance) < 0 ? "text-red-600" : n(d.variance) > 0 ? "text-amber-600" : "text-green-600"}`}>
                        {n(d.variance) === 0 ? "✓" : `${n(d.variance) < 0 ? "−" : "+"}${inr(Math.abs(n(d.variance)))}`}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {d.denominations && (
                  <div className="p-2 bg-muted/20 border rounded text-xs">
                    <strong>Denominations:</strong>{" "}
                    {[
                      { k: "d500", l: "₹500" }, { k: "d200", l: "₹200" },
                      { k: "d100", l: "₹100" }, { k: "d50", l: "₹50" },
                      { k: "d20", l: "₹20" }, { k: "d10", l: "₹10" },
                      { k: "coins", l: "Coins" },
                    ]
                      .filter(({ k }) => (d.denominations as Record<string, number>)[k] > 0)
                      .map(({ k, l }) => `${l}×${(d.denominations as Record<string, number>)[k]}`)
                      .join(", ")}
                    {" → "}<strong>{inr(n(d.denominationTotal))}</strong>
                  </div>
                )}
                {d.varianceNote && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border rounded text-xs">
                    <strong>Variance Note:</strong> {d.varianceNote}
                  </div>
                )}
                {d.notes && (
                  <div className="p-2 bg-muted/30 border rounded text-xs">
                    <strong>Handover:</strong> {d.notes}
                  </div>
                )}

                {/* Bills made inside this closure's window */}
                {d.bills && d.bills.length > 0 && (
                  <div>
                    <div className="font-semibold text-xs text-muted-foreground uppercase border-b pb-1">
                      Bills Made ({d.bills.length})
                    </div>
                    <div className="overflow-y-auto max-h-48 rounded border border-card-border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1 font-semibold">Bill #</th>
                            <th className="text-left px-2 py-1 font-semibold">Patient</th>
                            <th className="text-right px-2 py-1 font-semibold">Total</th>
                            <th className="text-right px-2 py-1 font-semibold">Paid</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-card-border">
                          {d.bills.map((b) => (
                            <tr key={b.id}>
                              <td className="px-2 py-1 font-semibold">{b.billNumber}</td>
                              <td className="px-2 py-1 max-w-[130px] truncate">{b.patientName}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{inr(b.totalAmount)}</td>
                              <td className="px-2 py-1 text-right tabular-nums text-green-700 dark:text-green-400">{inr(b.paidAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Bills/payments made AFTER this close (only when viewing the latest closure) */}
                {detailIsLatestForUser && staffPostClosureQ.data && staffPostClosureQ.data.bills.length > 0 && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded text-xs space-y-1.5">
                    <p className="font-bold text-amber-800 dark:text-amber-300 uppercase flex items-center gap-1">
                      <AlertTriangle size={11} /> After this close — {staffPostClosureQ.data.bills.length} new bill
                      {staffPostClosureQ.data.bills.length !== 1 ? "s" : ""} ({inr(staffPostClosureQ.data.billTotal)})
                    </p>
                    <div className="divide-y divide-amber-200 dark:divide-amber-800">
                      {staffPostClosureQ.data.bills.map((b) => (
                        <div key={b.id} className="flex justify-between py-1">
                          <span className="font-semibold">{b.billNumber}</span>
                          <span className="tabular-nums">{inr(b.totalAmount)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                      These count toward the next window, not this closure.
                    </p>
                  </div>
                )}
                {d.approvedByName && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded text-xs">
                    <strong>Mismatch approved</strong> by {d.approvedByName} on {fmtIst(d.approvedAt)}<br/>
                    {d.approvalNote && <span>Note: {d.approvalNote}</span>}
                  </div>
                )}
                {d.reopenedByName && (
                  <div className="p-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 rounded text-xs">
                    <strong>Reopened</strong> by {d.reopenedByName} on {fmtIst(d.reopenedAt)}<br/>
                    Reason: {d.reopenReason}
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button onClick={() => setStaffDetailId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve mismatch dialog */}
      <Dialog open={!!approveOpen} onOpenChange={(o) => !o && setApproveOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="text-amber-600" /> Approve Mismatch — {approveOpen?.userName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {approveOpen && (
              <div className="p-3 bg-muted/30 rounded-lg text-xs space-y-1">
                <div className="flex justify-between"><span>Expected Total</span><strong>{inr(approveOpen.totalCollected + (approveOpen.variance ?? 0))}</strong></div>
                <div className="flex justify-between"><span>Counted Total</span><strong>{inr(approveOpen.totalCollected)}</strong></div>
                <div className="flex justify-between"><span>Variance</span>
                  <strong className={approveOpen.variance < 0 ? "text-red-600" : "text-amber-600"}>
                    {approveOpen.variance < 0 ? "−" : "+"}{inr(Math.abs(approveOpen.variance))}
                  </strong>
                </div>
              </div>
            )}
            <Label>Approval Note <span className="text-red-600">*</span></Label>
            <Textarea
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              placeholder="Reason for approving this mismatch — e.g. checked CCTV, confirmed change error."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveOpen(null)}>Cancel</Button>
            <Button
              disabled={approveMut.isPending || approveNote.trim().length < 3 || !approveOpen?.closureId}
              onClick={() => approveOpen?.closureId && approveMut.mutate({ id: approveOpen.closureId, note: approveNote.trim() })}
            >
              {approveMut.isPending ? "Approving…" : "Approve Mismatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin-initiated per-staff close (cash handover, one by one) */}
      <StaffDayCloseDialog
        userName={staffCloseUser}
        open={staffCloseUser !== null}
        onOpenChange={(o) => !o && setStaffCloseUser(null)}
      />

      {/* Staff drawer reopen (super-admin only) */}
      <Dialog open={!!staffReopenOpen} onOpenChange={(o) => !o && setStaffReopenOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="text-red-600" /> Reopen Drawer — {staffReopenOpen?.userName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              Reopening allows the staff member to re-close their drawer. The action is logged and audited.
              This does NOT affect the overall day close boundary.
            </p>
            <Label>Reason (required, audited) <span className="text-red-600">*</span></Label>
            <Textarea
              value={staffReopenReason}
              onChange={(e) => setStaffReopenReason(e.target.value)}
              placeholder="e.g. Staff re-counted, found discrepancy in UPI entries."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStaffReopenOpen(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={staffReopenMut.isPending || staffReopenReason.trim().length < 3 || !staffReopenOpen?.closureId}
              onClick={() => staffReopenOpen?.closureId && staffReopenMut.mutate({ id: staffReopenOpen.closureId, reason: staffReopenReason.trim() })}
            >
              {staffReopenMut.isPending ? "Reopening…" : "Confirm Reopen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
