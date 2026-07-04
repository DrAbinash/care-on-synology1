import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { SummaryExportToolbar } from "@/components/SummaryExport";
import type { ExportConfig, ExportSection, ExportTable } from "@/components/SummaryExport";
import { SummaryDrilldownModal, type DrilldownType } from "@/components/SummaryDrilldownModal";
import {
  IndianRupee, Wallet, Banknote, Smartphone, TrendingDown, RotateCcw,
  XCircle, FileEdit, Clock, Calendar, RefreshCw, Tag, CheckCircle2,
  ArrowRight, Users, Percent, Receipt, Lock, AlertTriangle, ShieldCheck,
  ChevronRight, ChevronDown, ChevronUp, Info, AlertCircle, Calculator, Save,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────


type MyDailySummarySummary = {
  grossBilling: number;
  grossBilledIncludingCancelled: number;
  cancelledOnMyBills: number;
  netCollectedOnMyBills: number;
  outstanding: number;
  refundsAndCancellations: number;
  refundAmount: number;
  cancelledAmount: number;
  cashExpenses: number;
  digitalExpenses: number;
  totalExpenses: number;
  totalReceived: number;
  digitalCollection: number;
  cashIn: number;
  digitalIn: number;
  cashRefunded: number;
  digitalRefunded: number;
  netDigital: number;
  cashCollection: number;
  physicalCashInHand: number;
  discountsGiven: number;
  duesCollectedTotal: number;
  duesBillsCount: number;
  cancellationCount: number;
  cancelledByOthersCount: number;
  cancelledBySelfCount: number;
  billCount: number;
  closingCashBalance: number;
  // Suspense/exception bucket — see DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.3
  suspensePaymentCount?: number;
  suspensePaymentAmount?: number;
  suspenseRefundCount?: number;
  suspenseRefundAmount?: number;
};

type MyDailySummaryData = {
  staffName: string;
  isFiltered: boolean;
  from: string;
  to: string;
  staffNames: string[];
  summary: MyDailySummarySummary;
  byMethod: Record<string, number>;
  bills: {
    id: number;
    billNumber: string;
    patientName: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    discount: number;
    status: string;
    referringDoctor: string | null;
    createdAt: string;
  }[];
  payments: {
    id: number;
    billId: number;
    amount: number;
    method: string;
    createdAt: string;
    billCreatedAt: string;
  }[];
  suspensePayments?: {
    id: number;
    billId: number;
    amount: number;
    rawMethod: string;
    recordedByName: string | null;
    createdAt: string;
  }[];
  billEdits: {
    id: number;
    billId: number;
    billNumber: string;
    editedBy: string;
    reason: string;
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }[];
  referralEdits: {
    id: number;
    billId: number;
    billNumber: string;
    editedBy: string;
    reason: string;
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }[];
  duesBills: {
    billId: number;
    billNumber: string;
    patientName: string;
    referringDoctor: string | null;
    createdByName: string | null;
    totalAmount: number;
    duesCollected: number;
    remainingDues: number;
    billStatus: string;
  }[];
  outstandingBills: {
    billId: number;
    billNumber: string;
    patientName: string;
    referringDoctor: string | null;
    createdByName: string | null;
    totalAmount: number;
    paidAmount: number;
    outstanding: number;
    status: string;
  }[];
  voucherEdits: {
    id: number;
    voucherId: number;
    changeType: string;
    reason: string;
    oldValue: string | null;
    newValue: string | null;
    editedBy: string;
    createdAt: string;
  }[];
  refunds: {
    id: number;
    billId: number;
    amount: number;
    method: string;
    recordedBy: string | null;
    createdAt: string;
    billCreatedAt: string;
  }[];
  cancelledByMe: {
    id: number;
    billNumber: string;
    totalAmount: number;
    originalCreator: string;
    cancelledAt: string;
  }[];
  discountBills: {
    billId: number;
    billNumber: string;
    patientName: string;
    referringDoctor: string | null;
    createdByName: string | null;
    totalAmount: number;
    grossAmount: number;
    discountGiven: number;
    balanceAmount: number;
    discountReason: string | null;
    discountReasonNote: string | null;
    status: string;
  }[];
  byStaff?: {
    name: string;
    grossBilled: number;
    activeBilling: number;
    cancelled: number;
    outstanding: number;
    netCollected: number;
    billCount: number;
    cashIn: number;
    digitalIn: number;
    cashRefunded: number;
    digitalRefunded: number;
    netCash: number;
    netDigital: number;
    totalReceived: number;
    cashExpenses: number;
    digitalExpenses: number;
    totalExpenses: number;
    physicalCashInHand: number;
    duesCollected: number;
    discountsGiven: number;
    cancellationCount: number;
  }[];
};

type PostClosureActivity = {
  closedAt: string | null;
  closureId?: number;
  bills: { id: number; billNumber: string; totalAmount: number; paidAmount: number; status: string; createdAt: string }[];
  payments: { id: number; billId: number; amount: number; method: string; createdAt: string }[];
  billTotal: number;
  paymentTotal: number;
};

type DrawerStatus = {
  drawerStatus: "open" | "balanced" | "mismatch" | "approved" | "closed" | "reopened";
  userName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expectedCash: number;
  countedCash: number | null;
  cashVariance: number | null;
  expectedDigital: number;
  countedDigital: number | null;
  digitalVariance: number | null;
  expectedTotal: number;
  actualTotal: number | null;
  totalVariance: number | null;
  closedAt: string | null;
  closedBy: string | null;
  handoverNote: string | null;
  approvedByName: string | null;
  approvalNote: string | null;
  closureId?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }); }
  catch { return ""; }
}
function fmtIst(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

// ─── Drawer Status Config ─────────────────────────────────────────────────────

type DrawerStatusKey = "open" | "balanced" | "mismatch" | "approved" | "closed" | "reopened";

const DRAWER_STATUS_CONFIG: Record<DrawerStatusKey, {
  label: string;
  border: string;
  headerBg: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ElementType;
}> = {
  open: {
    label: "Open",
    border: "border-blue-300 dark:border-blue-700",
    headerBg: "bg-gradient-to-r from-blue-600 to-blue-700",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-700 dark:text-blue-300",
    icon: Clock,
  },
  balanced: {
    label: "Balanced",
    border: "border-green-300 dark:border-green-700",
    headerBg: "bg-gradient-to-r from-green-600 to-emerald-600",
    badgeBg: "bg-green-100 dark:bg-green-900/40",
    badgeText: "text-green-700 dark:text-green-300",
    icon: CheckCircle2,
  },
  mismatch: {
    label: "Mismatch",
    border: "border-red-300 dark:border-red-700",
    headerBg: "bg-gradient-to-r from-red-600 to-red-700",
    badgeBg: "bg-red-100 dark:bg-red-900/40",
    badgeText: "text-red-700 dark:text-red-300",
    icon: AlertTriangle,
  },
  approved: {
    label: "Approved",
    border: "border-amber-300 dark:border-amber-700",
    headerBg: "bg-gradient-to-r from-amber-600 to-orange-600",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-700 dark:text-amber-300",
    icon: ShieldCheck,
  },
  closed: {
    label: "Closed",
    border: "border-emerald-400 dark:border-emerald-600",
    headerBg: "bg-gradient-to-r from-emerald-700 to-green-800",
    badgeBg: "bg-emerald-100 dark:bg-emerald-900/40",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    icon: Lock,
  },
  reopened: {
    label: "Reopened",
    border: "border-orange-300 dark:border-orange-700",
    headerBg: "bg-gradient-to-r from-orange-500 to-amber-600",
    badgeBg: "bg-orange-100 dark:bg-orange-900/40",
    badgeText: "text-orange-700 dark:text-orange-300",
    icon: AlertTriangle,
  },
};

// ─── Drawer Status Card ───────────────────────────────────────────────────────

function DrawerStatusCard({ status }: { status: DrawerStatus }) {
  const cfg = DRAWER_STATUS_CONFIG[status.drawerStatus] ?? DRAWER_STATUS_CONFIG.open;
  const StatusIcon = cfg.icon;
  const isClosed = status.drawerStatus !== "open" && status.drawerStatus !== "reopened";
  const hasMismatch = status.drawerStatus === "mismatch";

  function VarCell({ label, expected, counted, variance }: {
    label: string; expected: number; counted: number | null; variance: number | null;
  }) {
    const v = variance ?? 0;
    const varColor = v === 0 ? "text-green-600 dark:text-green-400"
      : v < 0 ? "text-red-600 dark:text-red-400"
      : "text-amber-600 dark:text-amber-400";
    return (
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">{label}</div>
        <div className="grid grid-cols-3 gap-x-2 text-xs">
          <div>
            <div className="text-[10px] text-gray-400">Expected</div>
            <div className="font-bold tabular-nums text-gray-800 dark:text-gray-200">{fmt(expected)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">Counted</div>
            <div className="font-bold tabular-nums text-gray-800 dark:text-gray-200">
              {counted !== null ? fmt(counted) : <span className="text-gray-400">—</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">Variance</div>
            <div className={`font-bold tabular-nums ${counted !== null ? varColor : "text-gray-400"}`}>
              {counted !== null
                ? v === 0 ? "✓" : `${v < 0 ? "−" : "+"}${fmt(Math.abs(v))}`
                : "—"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white dark:bg-card border-2 ${cfg.border} rounded-xl shadow-md overflow-hidden`}>
      {/* Header */}
      <div className={`${cfg.headerBg} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <StatusIcon size={16} className="text-white" />
          <div>
            <h3 className="text-sm font-extrabold text-white">My Drawer Close Status</h3>
            <p className="text-[11px] text-white/80">Shift reconciliation snapshot</p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${cfg.badgeBg} ${cfg.badgeText}`}>
          {cfg.label}
        </span>
      </div>

      {/* Mismatch warning */}
      {hasMismatch && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800">
          <AlertTriangle size={13} className="text-red-600 shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-300 font-semibold">
            Cash mismatch detected — awaiting admin review.
          </p>
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Cash + Digital breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-gray-50 dark:bg-muted/20 rounded-lg border border-gray-100 dark:border-card-border">
          <VarCell
            label="Cash"
            expected={status.expectedCash}
            counted={status.countedCash}
            variance={status.cashVariance}
          />
          <VarCell
            label="Digital (UPI / Card / Other)"
            expected={status.expectedDigital}
            counted={status.countedDigital}
            variance={status.digitalVariance}
          />
        </div>

        {/* Total row */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-gray-900 dark:bg-gray-950 rounded-lg text-white">
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Expected</div>
            <div className="text-base font-extrabold tabular-nums">{fmt(status.expectedTotal)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Actual</div>
            <div className="text-base font-extrabold tabular-nums">
              {status.actualTotal !== null ? fmt(status.actualTotal) : <span className="text-gray-500">—</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Variance</div>
            <div className={`text-base font-extrabold tabular-nums ${
              status.totalVariance === null ? "text-gray-500"
              : status.totalVariance === 0 ? "text-green-400"
              : status.totalVariance < 0 ? "text-red-400"
              : "text-amber-400"
            }`}>
              {status.totalVariance === null
                ? "—"
                : status.totalVariance === 0
                  ? "Balanced"
                  : `${status.totalVariance < 0 ? "−" : "+"}${fmt(Math.abs(status.totalVariance))}`}
            </div>
          </div>
        </div>

        {/* Meta row */}
        {isClosed && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {status.closedAt && (
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Closed At</div>
                <div className="font-medium text-gray-700 dark:text-gray-300">{fmtIst(status.closedAt)}</div>
              </div>
            )}
            {status.approvedByName && (
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Approved By</div>
                <div className="font-medium text-gray-700 dark:text-gray-300">{status.approvedByName}</div>
              </div>
            )}
            {status.handoverNote && (
              <div className="col-span-2 p-2 bg-muted/30 border rounded text-[11px] text-gray-600 dark:text-gray-400">
                <span className="font-semibold">Handover note:</span> {status.handoverNote}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {!isClosed || status.drawerStatus === "reopened" ? (
            <Link href="/my-day-close">
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white text-xs flex items-center gap-1.5">
                <Lock size={12} /> Close My Drawer
              </Button>
            </Link>
          ) : (
            <Button size="sm" disabled className="text-xs flex items-center gap-1.5 opacity-60">
              <Lock size={12} /> Drawer Closed
            </Button>
          )}
          <Link href="/day-close">
            <Button size="sm" variant="outline" className="text-xs flex items-center gap-1.5">
              View Full Day Close <ChevronRight size={12} />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Small Components ─────────────────────────────────────────────────────────

// ─── Card color themes — soft, professional pastel backgrounds. Every card
// uses the exact same padding/radius/shadow; only the theme colors differ.
// Mapping (per spec): Cash/collected money -> green, Digital -> teal,
// Expenses -> red, Outstanding -> orange, Collectible -> blue,
// Discounts -> purple, Cancellations -> pink, everything else -> slate/indigo.
const KPI_THEMES = {
  green:  { bg: "bg-emerald-50 dark:bg-emerald-950/30",  ring: "ring-emerald-100 dark:ring-emerald-900/40",  icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300", value: "text-emerald-950 dark:text-emerald-100" },
  teal:   { bg: "bg-teal-50 dark:bg-teal-950/30",        ring: "ring-teal-100 dark:ring-teal-900/40",        icon: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",       value: "text-teal-950 dark:text-teal-100" },
  red:    { bg: "bg-rose-50 dark:bg-rose-950/30",        ring: "ring-rose-100 dark:ring-rose-900/40",        icon: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",       value: "text-rose-950 dark:text-rose-100" },
  orange: { bg: "bg-orange-50 dark:bg-orange-950/30",    ring: "ring-orange-100 dark:ring-orange-900/40",    icon: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300", value: "text-orange-950 dark:text-orange-100" },
  blue:   { bg: "bg-blue-50 dark:bg-blue-950/30",        ring: "ring-blue-100 dark:ring-blue-900/40",        icon: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",       value: "text-blue-950 dark:text-blue-100" },
  purple: { bg: "bg-purple-50 dark:bg-purple-950/30",    ring: "ring-purple-100 dark:ring-purple-900/40",    icon: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300", value: "text-purple-950 dark:text-purple-100" },
  pink:   { bg: "bg-pink-50 dark:bg-pink-950/30",        ring: "ring-pink-100 dark:ring-pink-900/40",        icon: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",       value: "text-pink-950 dark:text-pink-100" },
  slate:  { bg: "bg-slate-50 dark:bg-slate-800/40",      ring: "ring-slate-100 dark:ring-slate-700/40",      icon: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300",   value: "text-slate-950 dark:text-slate-100" },
  indigo: { bg: "bg-indigo-50 dark:bg-indigo-950/30",    ring: "ring-indigo-100 dark:ring-indigo-900/40",    icon: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300", value: "text-indigo-950 dark:text-indigo-100" },
} as const;
type KpiTheme = keyof typeof KPI_THEMES;

function MiniKpi({ icon: Icon, label, value, sub, theme, onClick }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  theme: KpiTheme; onClick?: () => void;
}) {
  const t = KPI_THEMES[theme];
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
      className={`h-full flex flex-col justify-between ${t.bg} ring-1 ${t.ring} rounded-xl p-4 shadow-sm transition-all ${
        onClick ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wider leading-tight">{label}</p>
          <p className={`mt-1.5 text-xl font-bold leading-none tabular-nums ${t.value}`}>{value}</p>
          {sub && <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{sub}</p>}
        </div>
        <div className={`p-2 rounded-lg flex-shrink-0 ${t.icon}`}>
          <Icon size={15} />
        </div>
      </div>
    </div>
  );
}

// ─── Solid-filled KPI — reserved for the numbers that matter most at a
// glance (Expected Physical Cash, Total Expenses, Net Digital Collection).
// Deliberately louder than MiniKpi so the eye lands here first, with the
// exact same padding/radius/shadow discipline as every other card. ────────
function MiniKpiFilled({ icon: Icon, label, value, sub, solid, onClick }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  solid: "green" | "red" | "teal"; onClick?: () => void;
}) {
  const styles = {
    green: "bg-gradient-to-br from-emerald-600 to-emerald-700",
    red:   "bg-gradient-to-br from-rose-600 to-rose-700",
    teal:  "bg-gradient-to-br from-teal-600 to-cyan-700",
  }[solid];
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
      className={`h-full flex flex-col justify-between ${styles} text-white rounded-xl p-4 shadow-md transition-all ${
        onClick ? "cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider leading-tight text-white/85">{label}</p>
          <p className="mt-1.5 text-2xl font-extrabold leading-none tabular-nums">{value}</p>
          {sub && <p className="mt-1.5 text-[11px] text-white/80 leading-snug">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg flex-shrink-0 bg-white/20">
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

// ─── Operator badge — bridges two KPI boxes that have a mathematical
// relationship (e.g. A − B = C), so the reconciliation flow reads left to
// right the same way the underlying formula works. ─────────────────────────
function FormulaOp({ op }: { op: "+" | "−" | "=" }) {
  const styles = op === "=" ? "bg-[#1a3a5c] text-white" : "bg-white text-[#1a3a5c] border-2 border-[#1a3a5c]";
  return (
    <div className="hidden sm:flex items-center justify-center flex-shrink-0 w-7">
      <span className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-extrabold shadow-sm ${styles}`}>
        {op}
      </span>
    </div>
  );
}

// ─── Compact paired row: Cash / Digital side-by-side ────────────────────

function CompactRow({ label, cash, digital, isDeduct }: {
  label: string; cash: number; digital: number; isDeduct?: boolean;
}) {
  const sign = isDeduct ? "−" : "";
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        <span className="block text-[11px] font-normal text-gray-400 dark:text-gray-500 mt-0.5 leading-none">
          Cash / Digital
        </span>
      </span>
      <div className="flex items-center gap-4 text-sm font-semibold tabular-nums">
        <span className={isDeduct ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-200"}>
          {sign}{fmt(cash)}
        </span>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className={isDeduct ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-200"}>
          {sign}{fmt(digital)}
        </span>
      </div>
    </div>
  );
}

// ─── Single-value accounting row ──────────────────────────────────────────

function RecRow({ label, value, type, note }: {
  label: string; value: number; type: "start" | "deduct" | "result" | "final"; note?: string;
}) {
  const isDeduct = type === "deduct";
  const isFinal = type === "final";
  const isResult = type === "result";
  return (
    <div className={`flex items-center justify-between ${isFinal ? "py-2.5" : isResult ? "py-2" : "py-1.5"}`}>
      <span className={
        isFinal ? "text-sm font-extrabold text-gray-900 dark:text-foreground" :
        isResult ? "text-sm font-bold text-gray-900 dark:text-foreground" :
        isDeduct ? "text-sm font-medium text-red-600 dark:text-red-400 pl-4" :
        "text-sm font-medium text-gray-700 dark:text-gray-300"
      }>
        {label}
        {note && <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500 ml-1.5">({note})</span>}
      </span>
      <span className={`tabular-nums font-bold ${
        isFinal ? "text-xl text-blue-800 dark:text-blue-300" :
        isResult ? "text-base text-green-700 dark:text-green-400" :
        isDeduct ? "text-sm text-red-600 dark:text-red-400" :
        "text-sm text-gray-800 dark:text-gray-200"
      }`}>
        {isDeduct ? `−\u2009${fmt(value)}` : fmt(value)}
      </span>
    </div>
  );
}

// ─── Major section divider ────────────────────────────────────────────────

function MajorDivider({ color }: { color: "emerald" | "blue" | "purple" | "violet" | "slate" }) {
  const map = {
    emerald: "border-t-[1.5px] border-emerald-400 dark:border-emerald-700 shadow-[0_1px_2px_rgba(16,185,129,0.12)]",
    blue:    "border-t-[1.5px] border-blue-500 dark:border-blue-700 shadow-[0_1px_2px_rgba(59,130,246,0.12)]",
    purple:  "border-t-[1.5px] border-purple-500 dark:border-purple-700 shadow-[0_1px_2px_rgba(168,85,247,0.12)]",
    violet:  "border-t-[1.5px] border-violet-400 dark:border-violet-700 shadow-[0_1px_2px_rgba(139,92,246,0.12)]",
    slate:   "border-t-[1.5px] border-slate-400 dark:border-slate-700 shadow-[0_1px_2px_rgba(100,116,139,0.12)]",
  };
  return <div className={`my-2 ${map[color]}`} />;
}

function MinorDivider() {
  return <div className="my-1 border-t border-dashed border-gray-300 dark:border-gray-600" />;
}

// ─── Formula helper ─────────────────────────────────────────────────────────

function FormulaHint({ text }: { text: string }) {
  return (
    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-tight tabular-nums">
      = {text}
    </p>
  );
}

// ─── Compact accounting row used inside UnifiedReconciliationPanel ────────────

function ARow({
  label, value, sign, bold, highlight, indent, note, dimmed,
}: {
  label: string;
  value: number;
  sign?: "+" | "−" | "=" | "  ";
  bold?: boolean;
  highlight?: "green" | "red" | "amber" | "blue" | "slate";
  indent?: boolean;
  note?: string;
  dimmed?: boolean;
}) {
  const hlVal: Record<string, string> = {
    green:  "text-emerald-700 dark:text-emerald-400",
    red:    "text-red-600 dark:text-red-400",
    amber:  "text-amber-600 dark:text-amber-400",
    blue:   "text-blue-700 dark:text-blue-300",
    slate:  "text-slate-500 dark:text-slate-400",
  };
  const hlRow: Record<string, string> = {
    green:  "bg-emerald-50/60 dark:bg-emerald-950/20",
    red:    "bg-red-50/40 dark:bg-red-950/20",
    amber:  "bg-amber-50/60 dark:bg-amber-950/20",
    blue:   "bg-blue-50/60 dark:bg-blue-950/20",
    slate:  "",
  };
  const valColor = highlight ? hlVal[highlight] : (dimmed ? "text-gray-400 dark:text-gray-500" : "text-gray-800 dark:text-gray-200");
  const rowBg = highlight ? hlRow[highlight] : "";
  const labelColor = dimmed
    ? "text-gray-400 dark:text-gray-500 italic"
    : bold
      ? "text-gray-900 dark:text-foreground font-semibold"
      : "text-gray-600 dark:text-gray-400";

  return (
    <div className={`flex items-baseline justify-between py-[3px] px-3 ${rowBg}`}>
      <span className={`text-[12px] leading-tight ${labelColor} ${indent ? "pl-4" : ""} min-w-0 flex-1 pr-4`}>
        {sign && (
          <span className="inline-block w-3 text-center text-gray-400 dark:text-gray-500 mr-1 shrink-0">
            {sign}
          </span>
        )}
        {label}
        {note && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1.5 font-normal not-italic">
            {note}
          </span>
        )}
      </span>
      <span className={`text-[13px] tabular-nums shrink-0 ${bold ? "font-bold" : "font-medium"} ${valColor}`}>
        {fmt(value)}
      </span>
    </div>
  );
}

function ASectionDivider({ color }: { color: "emerald" | "slate" | "red" | "blue" | "amber" }) {
  const cls: Record<string, string> = {
    emerald: "border-emerald-300 dark:border-emerald-700",
    slate:   "border-slate-200 dark:border-slate-700",
    red:     "border-red-300 dark:border-red-700",
    blue:    "border-blue-300 dark:border-blue-700",
    amber:   "border-amber-300 dark:border-amber-700",
  };
  return <div className={`border-t ${cls[color]} mx-3`} />;
}

// ─── Unified Daily Financial Reconciliation Panel (Bloomberg-density) ─────────
//
// Replaces: DailyFinancialReconciliation + "My Billing" card + "My Cashbox" card
//           + DailyReconciliationAndCashFlow table.
//
// FORMULA (verified algebraically):
//   Gross Bills Generated (post-discount)
//   + Old Dues Collected
//   = Total Revenue Activity
//   − Cancelled Bills
//   − Today's Refunds (cash + digital)
//   − Outstanding Dues
//   = Collectible Amount
//   − Digital Collection (net of digital refunds)   → went to bank
//   − Cash Expenses (approved by this staff)         → physically paid out
//   = Expected Physical Cash in Counter
//
//   Verification: expectedPhysicalCash ≡ physicalCashInHand = cashIn − cashRefunded − cashExpenses
//
// ATTRIBUTION RULE (confirmed correct in backend):
//   cashIn          = SUM(payments.amount > 0) WHERE recordedByName = thisStaff
//   cashRefunded    = SUM(abs(payments.amount < 0)) WHERE recordedByName = thisStaff
//   cashExpenses    = SUM(expenses.amount) WHERE approved_by = thisStaff
//   Staff B's refund on Staff A's bill → deducted from Staff B's expectedCash, NOT Staff A's.
//   This is the correct business rule and is already implemented in the backend.

function UnifiedReconciliationPanel({
  summary: s,
  byMethod,
  discountBills,
  isOwner,
  exportConfig,
}: {
  summary: MyDailySummarySummary;
  byMethod: Record<string, number>;
  discountBills: MyDailySummaryData["discountBills"];
  isOwner: boolean;
  exportConfig: ExportConfig | null;
}) {
  const [digitalExpanded, setDigitalExpanded] = useState(false);
  const [discountExpanded, setDiscountExpanded] = useState(false);

  // ── Formula (all arithmetic verified against backend physicalCashInHand) ──
  const totalRefunds   = s.cashRefunded + s.digitalRefunded;
  const collectible    = s.grossBilledIncludingCancelled
                        + s.duesCollectedTotal
                        - s.cancelledAmount
                        - totalRefunds
                        - s.outstanding;
  const netDigital     = s.digitalIn - s.digitalRefunded;
  const expectedCash   = collectible - netDigital - s.cashExpenses;
  // expectedCash ≡ s.physicalCashInHand = cashIn − cashRefunded − cashExpenses
  // The billing-side calculation and the payment-side calculation converge here.
  const mismatch       = expectedCash - s.physicalCashInHand;
  const balanced       = Math.abs(mismatch) <= 0.01;

  // ── Digital method split for the collapsible row ──────────────────────────
  const digitalMethods = Object.entries(byMethod)
    .filter(([m]) => !["cash"].includes(m.toLowerCase()))
    .sort(([, a], [, b]) => b - a);

  // ── Discount aggregates for the drill-down ────────────────────────────────
  const discountTotal = s.discountsGiven;
  const discountPct   = s.grossBilledIncludingCancelled > 0
    ? ((discountTotal / (s.grossBilledIncludingCancelled + discountTotal)) * 100).toFixed(1)
    : "0.0";

  // Per-staff discount (owner only)
  const byStaffDiscount = useMemo(() => {
    if (!isOwner || !discountBills.length) return [];
    const map = new Map<string, number>();
    for (const b of discountBills) {
      const k = b.createdByName ?? "Unknown";
      map.set(k, (map.get(k) ?? 0) + b.discountGiven);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [discountBills, isOwner]);

  // Per-doctor discount (owner only)
  const byDoctorDiscount = useMemo(() => {
    if (!isOwner || !discountBills.length) return [];
    const map = new Map<string, number>();
    for (const b of discountBills) {
      const k = b.referringDoctor ?? "No referral";
      map.set(k, (map.get(k) ?? 0) + b.discountGiven);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [discountBills, isOwner]);

  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calculator size={14} className="text-amber-400 shrink-0" />
          <span className="text-[13px] font-bold text-white tracking-wide uppercase">
            Daily Financial Reconciliation
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Export toolbar — compact variant for panel header */}
          <SummaryExportToolbar
            config={exportConfig}
            emailEndpoint="/api/dashboard/my-daily-summary/send-email"
            compact
          />
          {/* Balance status badge */}
          {balanced ? (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/25 text-emerald-300 text-[11px] font-bold shrink-0">
              <CheckCircle2 size={10} /> Balanced · ₹0
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/25 text-red-300 text-[11px] font-bold shrink-0">
              <AlertTriangle size={10} />
              {mismatch > 0 ? "Surplus" : "Short"} ₹{Math.abs(mismatch).toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* ── Mismatch alert strip ── */}
      {!balanced && (
        <div className="px-4 py-1.5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex items-center gap-2">
          <AlertTriangle size={12} className="text-red-600 dark:text-red-400 shrink-0" />
          <span className="text-[12px] font-semibold text-red-700 dark:text-red-300">
            Expected Cash ≠ Actual Cash — verify counter before close
          </span>
        </div>
      )}

      <div className="py-1">

        {/* ══ SECTION A: BILLING ══════════════════════════════════════════════ */}
        <div className="px-3 pt-1 pb-0.5">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Billing
          </span>
        </div>

        <ARow
          label="Gross Bills Generated"
          value={s.grossBilledIncludingCancelled}
          note="post-discount"
          bold
        />

        {/* Discounts — prominent amber KPI */}
        <div
          className="flex items-center justify-between py-[3px] px-3 bg-amber-50/80 dark:bg-amber-950/25 cursor-pointer group"
          onClick={() => isOwner && setDiscountExpanded((e) => !e)}
          title={isOwner ? "Click to expand discount drill-down" : undefined}
        >
          <span className="text-[12px] text-amber-700 dark:text-amber-400 font-semibold pl-4 flex items-center gap-1.5">
            <Tag size={10} className="shrink-0" />
            Discounts Given
            <span className="text-[10px] font-normal text-amber-500">
              ({discountPct}% of gross)
            </span>
            <span className="text-[10px] font-normal text-amber-500 ml-1">
              · informational only — already deducted in bill totals
            </span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[13px] tabular-nums font-bold text-amber-600 dark:text-amber-400">
              {fmt(discountTotal)}
            </span>
            {isOwner && (
              discountExpanded
                ? <ChevronUp size={11} className="text-amber-500" />
                : <ChevronDown size={11} className="text-amber-500" />
            )}
          </div>
        </div>

        {/* Discount drill-down — owner / admin only */}
        {isOwner && discountExpanded && discountBills.length > 0 && (
          <div className="mx-3 mb-1 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-amber-200 dark:divide-amber-800">
              {/* By staff */}
              <div className="p-2">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">By Staff</p>
                {byStaffDiscount.map(([name, amt]) => (
                  <div key={name} className="flex justify-between items-center py-0.5">
                    <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{name}</span>
                    <span className="text-[11px] tabular-nums font-semibold text-amber-600 dark:text-amber-400 ml-2 shrink-0">{fmt(amt)}</span>
                  </div>
                ))}
              </div>
              {/* By referral doctor */}
              <div className="p-2">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">By Referral Doctor</p>
                {byDoctorDiscount.map(([doc, amt]) => (
                  <div key={doc} className="flex justify-between items-center py-0.5">
                    <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{doc}</span>
                    <span className="text-[11px] tabular-nums font-semibold text-amber-600 dark:text-amber-400 ml-2 shrink-0">{fmt(amt)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-amber-200 dark:border-amber-800 px-2 py-1">
              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1">Individual Bills</p>
              <div className="max-h-36 overflow-y-auto space-y-0.5">
                {discountBills.map((b) => (
                  <div key={b.billId} className="flex items-center gap-2 text-[11px]">
                    <Link href={`/billing/${b.billId}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium shrink-0">
                      {b.billNumber}
                    </Link>
                    <span className="text-gray-600 dark:text-gray-400 truncate flex-1">{b.patientName}</span>
                    <span className="tabular-nums font-semibold text-amber-600 dark:text-amber-400 shrink-0">{fmt(b.discountGiven)}</span>
                    {b.discountReason && (
                      <span className="text-gray-400 dark:text-gray-500 shrink-0 hidden sm:inline">{b.discountReason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {!isOwner && discountBills.length > 0 && (
          <div className="px-3 py-0.5">
            <span className="text-[10px] text-amber-500 dark:text-amber-600 italic pl-4">
              Detailed breakdown visible to Owner / Admin only
            </span>
          </div>
        )}

        <ARow label="Old Dues Collected" value={s.duesCollectedTotal} sign="+" note="payments on prior-day bills" />

        <ASectionDivider color="emerald" />
        <ARow label="Total Revenue Activity" value={s.grossBilledIncludingCancelled + s.duesCollectedTotal} sign="=" bold highlight="green" />

        {/* ══ SECTION B: DEDUCTIONS ══════════════════════════════════════════ */}
        <div className="px-3 pt-2 pb-0.5">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Deductions
          </span>
        </div>

        <ARow label="Cancelled Bills" value={s.cancelledAmount} sign="−" indent highlight="red" />
        <ARow label="Refunds" value={totalRefunds} sign="−" indent highlight="red"
              note={`Cash ${fmt(s.cashRefunded)} · Digital ${fmt(s.digitalRefunded)}`} />
        <ARow label="Outstanding Dues" value={s.outstanding} sign="−" indent highlight="red" note="balance on today's bills" />

        <ASectionDivider color="blue" />
        <ARow label="Collectible Amount" value={collectible} sign="=" bold highlight="blue" />

        {/* ══ SECTION C: COLLECTION SPLIT ════════════════════════════════════ */}
        <div className="px-3 pt-2 pb-0.5">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            Collection
          </span>
        </div>

        {/* Digital Collection — single row with expand toggle */}
        <div
          className="flex items-center justify-between py-[3px] px-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-muted/10"
          onClick={() => setDigitalExpanded((e) => !e)}
        >
          <span className="text-[12px] text-gray-600 dark:text-gray-400 pl-4 flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-block w-3 text-center text-gray-400 mr-1">−</span>
            Digital Collection
            <span className="text-[10px] text-gray-400 ml-1">
              (net · UPI / Card / Online)
            </span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[13px] tabular-nums font-medium text-gray-800 dark:text-gray-200">
              {fmt(netDigital)}
            </span>
            {digitalExpanded
              ? <ChevronUp size={11} className="text-gray-400" />
              : <ChevronDown size={11} className="text-gray-400" />
            }
          </div>
        </div>

        {/* Digital split — only when expanded */}
        {digitalExpanded && (
          <div className="mx-3 mb-1 border border-gray-200 dark:border-card-border rounded-md overflow-hidden">
            {digitalMethods.filter(([, v]) => Math.abs(v) > 0).map(([method, value]) => (
              <div key={method} className="flex items-center justify-between px-3 py-0.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <span className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">{method}</span>
                <span className="text-[11px] tabular-nums font-medium text-gray-700 dark:text-gray-300">{fmt(value)}</span>
              </div>
            ))}
            {s.digitalRefunded > 0 && (
              <div className="flex items-center justify-between px-3 py-0.5 bg-red-50/40 dark:bg-red-950/10">
                <span className="text-[11px] text-red-500 dark:text-red-400">Digital Refunds</span>
                <span className="text-[11px] tabular-nums font-medium text-red-600 dark:text-red-400">−{fmt(s.digitalRefunded)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-0.5 bg-gray-50 dark:bg-muted/20 font-semibold">
              <span className="text-[11px] text-gray-700 dark:text-gray-300">Net Digital</span>
              <span className="text-[11px] tabular-nums text-gray-800 dark:text-gray-200">{fmt(netDigital)}</span>
            </div>
          </div>
        )}

        <ARow label="Cash Expenses" value={s.cashExpenses} sign="−" indent highlight="red"
              note="cash paid out by this staff" />

        {/* ══ FINAL: EXPECTED CASH ════════════════════════════════════════════ */}
        <ASectionDivider color="slate" />
        <div className={`flex items-center justify-between py-2 px-3 ${balanced ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-red-50 dark:bg-red-950/20"}`}>
          <span className="text-[13px] font-bold text-gray-900 dark:text-foreground">
            Expected Physical Cash in Counter
            <span className="block text-[10px] font-normal text-gray-500 dark:text-gray-400 mt-0.5">
              = Cash In − Cash Refunds − Cash Expenses
            </span>
          </span>
          <div className="text-right shrink-0">
            <span className={`text-[18px] font-extrabold tabular-nums ${balanced ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {fmt(expectedCash)}
            </span>
            {!balanced && (
              <span className="block text-[11px] tabular-nums font-semibold text-red-600 dark:text-red-400 mt-0.5">
                {mismatch > 0 ? "+" : "−"}₹{Math.abs(mismatch).toFixed(0)} vs payment records
              </span>
            )}
          </div>
        </div>

      </div>

      {/* ── Attribution footnote ── */}
      <div className="px-4 py-1.5 bg-slate-50 dark:bg-slate-900/20 border-t border-gray-100 dark:border-card-border">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
          Cash accountability: refunds and expenses are attributed to the staff member who <em>performed</em> them, not the original bill creator.
          Billing metrics follow the bill creator.
        </p>
      </div>
    </div>
  );
}


// ─── Daily Financial Reconciliation (REMOVED — replaced by UnifiedReconciliationPanel) ───────
// ─── DailyReconciliationAndCashFlow (REMOVED — merged into UnifiedReconciliationPanel) ──────
// ─── Warning Chips ────────────────────────────────────────────────────────────


// ─── Warning Chips ────────────────────────────────────────────────────────────

function DrawerChips({ status }: { status: DrawerStatus | undefined }) {
  if (!status) return null;

  const chips: { label: string; bg: string; text: string; icon: React.ElementType }[] = [];

  if (status.drawerStatus === "open") {
    chips.push({ label: "Drawer Open", bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-300", icon: Clock });
  }
  if (status.drawerStatus === "balanced") {
    chips.push({ label: "Drawer Balanced", bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300", icon: CheckCircle2 });
  }
  if (status.drawerStatus === "mismatch") {
    chips.push({ label: "Cash Mismatch", bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", icon: AlertTriangle });
  }
  if (status.cashVariance !== null && status.cashVariance !== 0 && status.drawerStatus !== "open") {
    chips.push({ label: "Cash Mismatch", bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", icon: AlertTriangle });
  }
  if (status.digitalVariance !== null && status.digitalVariance !== 0 && status.drawerStatus !== "open") {
    chips.push({ label: "Digital Mismatch", bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300", icon: AlertTriangle });
  }
  if (status.drawerStatus === "closed" || status.drawerStatus === "balanced") {
    chips.push({ label: "Day Closed", bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", icon: Lock });
  }
  if (status.drawerStatus === "open") {
    chips.push({ label: "Close Pending", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", icon: AlertTriangle });
  }
  if (status.drawerStatus === "approved") {
    chips.push({ label: "Mismatch Approved", bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", icon: ShieldCheck });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const unique = chips.filter((c) => { if (seen.has(c.label)) return false; seen.add(c.label); return true; });

  if (unique.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {unique.map((chip) => {
        const ChipIcon = chip.icon;
        return (
          <span key={chip.label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${chip.bg} ${chip.text}`}>
            <ChipIcon size={11} />
            {chip.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── Post-Closure Activity Chocolate Box ─────────────────────────────────────

function PostClosureActivityBox({ data }: { data: PostClosureActivity }) {
  const [expanded, setExpanded] = useState(false);
  if (!data.closedAt || (data.bills.length === 0 && data.payments.length === 0)) return null;

  const hasBills    = data.bills.length > 0;
  const hasPayments = data.payments.length > 0;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-xl shadow-md overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="w-full px-4 py-3 flex items-center justify-between gap-3 bg-amber-400/20 dark:bg-amber-900/40 hover:bg-amber-400/30 dark:hover:bg-amber-900/60 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500 text-white">
            <AlertTriangle size={14} />
          </div>
          <div className="text-left">
            <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">
              Post-Closure Activity Detected
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              Billing continued after drawer closed at {fmtIst(data.closedAt)} ·{" "}
              {hasBills && `${data.bills.length} bill${data.bills.length !== 1 ? "s" : ""} (${fmt(data.billTotal)})`}
              {hasBills && hasPayments && " · "}
              {hasPayments && `${data.payments.length} payment${data.payments.length !== 1 ? "s" : ""} (${fmt(data.paymentTotal)})`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase">
            These will be counted in the NEXT day's reconciliation
          </span>
          {expanded ? <ChevronRight size={14} className="text-amber-700 -rotate-90" /> : <ChevronRight size={14} className="text-amber-700 rotate-90" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* Bills table */}
          {hasBills && (
            <div>
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <IndianRupee size={11} /> Bills Created Post-Closure
              </p>
              <div className="overflow-x-auto rounded-lg border border-amber-300 dark:border-amber-700">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 dark:bg-amber-900/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Bill #</th>
                      <th className="px-3 py-2 text-right font-semibold text-amber-900 dark:text-amber-200">Amount</th>
                      <th className="px-3 py-2 text-right font-semibold text-amber-900 dark:text-amber-200">Paid</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                    {data.bills.map((b) => (
                      <tr key={b.id} className="hover:bg-amber-100/60 dark:hover:bg-amber-900/20">
                        <td className="px-3 py-1.5 font-semibold">
                          <Link href={`/billing/${b.id}`} className="text-primary hover:underline">{b.billNumber}</Link>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmt(b.totalAmount)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-green-700 dark:text-green-400">{fmt(b.paidAmount)}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold capitalize bg-white/60 dark:bg-black/20">{b.status}</span>
                        </td>
                        <td className="px-3 py-1.5 text-amber-700 dark:text-amber-400">{fmtTime(b.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-100 dark:bg-amber-900/40 border-t border-amber-300 dark:border-amber-700">
                    <tr>
                      <td className="px-3 py-1.5 font-bold text-amber-900 dark:text-amber-200">Total</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums text-amber-900 dark:text-amber-200">{fmt(data.billTotal)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Payments table */}
          {hasPayments && (
            <div>
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Wallet size={11} /> Payments Collected Post-Closure
              </p>
              <div className="overflow-x-auto rounded-lg border border-amber-300 dark:border-amber-700">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 dark:bg-amber-900/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Bill #</th>
                      <th className="px-3 py-2 text-right font-semibold text-amber-900 dark:text-amber-200">Amount</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Method</th>
                      <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                    {data.payments.map((p) => (
                      <tr key={p.id} className="hover:bg-amber-100/60 dark:hover:bg-amber-900/20">
                        <td className="px-3 py-1.5 font-semibold">
                          <Link href={`/billing/${p.billId}`} className="text-primary hover:underline">Bill #{p.billId}</Link>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">{fmt(p.amount)}</td>
                        <td className="px-3 py-1.5 capitalize text-amber-700 dark:text-amber-400">{p.method}</td>
                        <td className="px-3 py-1.5 text-amber-700 dark:text-amber-400">{fmtTime(p.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-100 dark:bg-amber-900/40 border-t border-amber-300 dark:border-amber-700">
                    <tr>
                      <td className="px-3 py-1.5 font-bold text-amber-900 dark:text-amber-200">Total</td>
                      <td className="px-3 py-1.5 text-right font-bold tabular-nums text-amber-900 dark:text-amber-200">{fmt(data.paymentTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 rounded-lg px-3 py-2">
            Billing is never blocked after drawer close. The above activity was recorded after your drawer was closed
            and will automatically be included in the <strong>next reconciliation window</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Unified Activity Log (replaces Control Logs + Bill Activity by Me) ───────

type ActivityTab = "bill-edits" | "referral-edits" | "voucher-edits" | "cancellations" | "refunds";

function MyActivityLog({ data }: { data: MyDailySummaryData | undefined }) {
  const [tab, setTab] = useState<ActivityTab>("bill-edits");
  if (!data) return null;

  const billEdits = data.billEdits ?? [];
  const referralEdits = data.referralEdits ?? [];
  const voucherEdits = data.voucherEdits ?? [];
  const cancellations = data.cancelledByMe ?? [];
  const refunds = data.refunds ?? [];
  const totalActivity = billEdits.length + referralEdits.length + voucherEdits.length + cancellations.length + refunds.length;

  if (totalActivity === 0) return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-5 text-sm text-gray-500 text-center">
      No bill edits, cancellations, or refunds in this period.
    </div>
  );

  const tabs: { id: ActivityTab; label: string; count: number }[] = [
    { id: "bill-edits", label: "Bill Edits", count: billEdits.length },
    { id: "referral-edits", label: "Referral Name edit", count: referralEdits.length },
    { id: "voucher-edits", label: "Voucher Edits", count: voucherEdits.length },
    { id: "cancellations", label: "Cancellations", count: cancellations.length },
    { id: "refunds", label: "Refunds", count: refunds.length },
  ];

  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
          <FileEdit size={14} className="text-purple-600" /> My Activity Log
          <span className="text-xs font-normal text-gray-500 ml-1">— document activity in this period</span>
        </h3>
        <span className="text-xs font-bold text-gray-500">{totalActivity} total</span>
      </div>
      <div className="flex border-b border-gray-100 dark:border-card-border overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? "border-primary text-primary" : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-foreground"}`}>
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.id ? "bg-primary/10 text-primary" : "bg-gray-100 dark:bg-muted text-gray-600"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {/* Bill Edits — rich table */}
        {tab === "bill-edits" && (
          billEdits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No bill edits in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-muted/30 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Bill #</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Type</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Old → New</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                  {billEdits.map((e) => (
                    <tr key={e.id} className="hover:bg-purple-50/50 dark:hover:bg-muted/20">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        <Link href={`/billing/${e.billId}`} className="text-primary hover:underline">{e.billNumber}</Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {e.changeType ? (
                          <span className={`px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                            e.changeType === "cancelled" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                            e.changeType === "reprint" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
                            e.changeType === "refund" ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300" :
                            e.changeType === "discount" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" :
                            "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                          }`}>
                            {e.changeType}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[140px]">
                        {(e.oldValue || e.newValue) ? (
                          <span className="flex items-center gap-1 flex-wrap">
                            {e.oldValue && <span className="line-through text-red-500">{e.oldValue}</span>}
                            {e.oldValue && e.newValue && <ArrowRight size={9} className="text-gray-400 flex-shrink-0" />}
                            {e.newValue && <span className="text-green-700 dark:text-green-400 font-semibold">{e.newValue}</span>}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[140px] truncate">{e.reason || "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(e.createdAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {/* Referral Name Edits — rich table */}
        {tab === "referral-edits" && (
          referralEdits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No referral name edits in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-muted/30 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Bill #</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Old → New</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300">Reason</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                  {referralEdits.map((e) => (
                    <tr key={e.id} className="hover:bg-teal-50/50 dark:hover:bg-teal-950/20">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">
                        <Link href={`/billing/${e.billId}`} className="text-primary hover:underline">{e.billNumber}</Link>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[200px]">
                        <span className="flex items-center gap-1 flex-wrap">
                          {e.oldValue && <span className="line-through text-red-500">{e.oldValue}</span>}
                          {e.oldValue && e.newValue && <ArrowRight size={9} className="text-gray-400 flex-shrink-0" />}
                          {e.newValue && <span className="text-teal-700 dark:text-teal-400 font-semibold">{e.newValue}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">{e.reason || "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        <span className="flex items-center gap-1"><Clock size={10} />{fmtTime(e.createdAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {/* Voucher Edits — list */}
        {tab === "voucher-edits" && (
          voucherEdits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No voucher edits in this period.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-card-border">
              {voucherEdits.map((e, i) => (
                <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
                  <FileEdit size={13} className="mt-0.5 text-indigo-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-indigo-100 text-indigo-700">Voucher</span>
                      <span className="text-xs font-semibold text-gray-800 dark:text-foreground">#{e.voucherId}</span>
                      <span className="text-xs text-gray-700 dark:text-gray-300 font-semibold">{e.editedBy}</span>
                      <span className="text-[10px] text-gray-500">{fmtTime(e.createdAt)}</span>
                    </div>
                    {e.reason && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {/* Cancellations — list */}
        {tab === "cancellations" && (
          cancellations.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No cancellations in this period.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-card-border">
              {cancellations.map((c, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
                  <XCircle size={13} className="text-rose-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800 dark:text-foreground">{c.billNumber}</span>
                      <span className="text-xs text-gray-500">created by {c.originalCreator}</span>
                      <span className="text-[10px] text-gray-500">{fmtTime(c.cancelledAt)}</span>
                    </div>
                    <p className="text-xs text-rose-600 font-semibold">{fmt(c.totalAmount)}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {/* Refunds — list */}
        {tab === "refunds" && (
          refunds.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No refunds in this period.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-card-border">
              {refunds.map((r, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
                  <RotateCcw size={13} className="text-amber-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/billing/${r.billId}`} className="text-xs font-semibold text-primary hover:underline">Bill #{r.billId}</Link>
                      <span className="text-xs text-gray-500">by {r.recordedBy ?? "Unknown"}</span>
                      <span className="text-[10px] text-gray-500">{fmtTime(r.createdAt)}</span>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">{fmt(Math.abs(r.amount))} via {r.method}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── My Daily Summary Page ────────────────────────────────────────────────────

const LS_STAFF_FILTER_KEY = "my_daily_summary_staff_filter";

export default function MyDailySummary() {
  const session = readStaffSession();
  const myName = session?.user.name ?? "";
  const isOwner = FULL_ACCESS_ROLES.has(normalizeRole(session?.user.role ?? ""));
  const isSuperAdmin = normalizeRole(session?.user.role ?? "") === "super_admin";

  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const savedFilter = typeof window !== "undefined" ? window.localStorage.getItem(LS_STAFF_FILTER_KEY) : null;
  const initialFilter = isSuperAdmin
    ? (savedFilter !== null ? savedFilter : "")
    : "";
  const [staffFilter, setStaffFilter] = useState(initialFilter);
  const [drilldownType, setDrilldownType] = useState<DrilldownType | null>(null);

  function saveStaffFilter(name: string) {
    setStaffFilter(name);
    try { window.localStorage.setItem(LS_STAFF_FILTER_KEY, name); } catch { /* ignore */ }
  }

  // All staff names: merge registered users + data-derived names so inactive staff
  // (or staff not yet in the users table) still appear in the filter.
  const { data: allUsers = [] } = useQuery<{ id: number; name: string; role: string; isActive: boolean }[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/api/users"),
    enabled: isOwner,
    staleTime: 5 * 60_000,
  });
  const activeStaff = allUsers.filter((u) => u.isActive).sort((a, b) => a.name.localeCompare(b.name));

  function setPreset(fromDaysAgo: number, toDaysAgo: number) {
    setFrom(daysAgoISO(fromDaysAgo));
    setTo(daysAgoISO(toDaysAgo));
  }

  const queryParams = new URLSearchParams({ from, to });
  if (isSuperAdmin && staffFilter.trim()) queryParams.set("staffName", staffFilter.trim());

  const { data, isLoading, refetch } = useQuery<MyDailySummaryData>({
    queryKey: ["my-daily-summary", from, to, staffFilter],
    queryFn: () => api.get(`/api/dashboard/my-daily-summary?${queryParams}`),
    staleTime: 2 * 60_000,
  });

  // All staff names from the registered users table — always visible regardless of date range.
  const staffFilterList = activeStaff.map((u) => u.name);

  // Drawer status — always fetches for the current logged-in user, not filtered staff.
  const drawerQ = useQuery<DrawerStatus>({
    queryKey: ["my-drawer-status"],
    queryFn: () => api.get<DrawerStatus>("/api/day-close/my-drawer-status"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Post-closure activity — always fetch so the admin can see yesterday's
  // post-closure bills even when today's drawer is open.
  const isDrawerClosed = drawerQ.data && drawerQ.data.drawerStatus !== "open" && drawerQ.data.drawerStatus !== "reopened";
  const postClosureQ = useQuery<PostClosureActivity>({
    queryKey: ["my-post-closure-activity"],
    queryFn: () => api.get<PostClosureActivity>("/api/day-close/my-post-closure-activity"),
    enabled: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Day Close open window preview — shows current open window count for the user
  const myPreviewQ = useQuery<{
    userName: string;
    coveredFromTs: string | null;
    coveredToTs: string;
    billsCount: number;
    paymentsCount: number;
    totalBilled: number;
    totalDue: number;
    expected: { cash: number; upi: number; card: number; cheque: number; other: number; total: number; count: number };
    bills: Array<{
      id: number;
      billNumber: string;
      patientName: string;
      totalAmount: number;
      paidAmount: number;
      balanceAmount: number;
      discount: number;
      status: string;
      referringDoctor: string | null;
      createdByName: string;
      createdAt: string;
    }>;
  }>({
    queryKey: ["my-day-close-preview"],
    queryFn: () => api.get("/api/day-close/my-preview"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const s = data?.summary;

  const statusColors: Record<string, string> = {
    paid: "#16a34a", partial: "#d97706", pending: "#dc2626", cancelled: "#94a3b8",
  };

  const methodLabels: Record<string, string> = {
    cash: "Cash", upi: "UPI", card: "Card", bank: "Bank Transfer",
    cheque: "Cheque", neft: "NEFT/RTGS", online: "Online",
  };

  const inr = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  const exportConfig = useMemo<ExportConfig | null>(() => {
    if (!s || !data) return null;

    // Use the SAME formula as UnifiedReconciliationPanel — must match exactly
    const totalRefunds     = s.cashRefunded + s.digitalRefunded;
    const collectible      = s.grossBilledIncludingCancelled
                           + s.duesCollectedTotal
                           - s.cancelledAmount
                           - totalRefunds
                           - s.outstanding;
    const netDigital       = s.digitalIn - s.digitalRefunded;
    const expectedCash     = collectible - netDigital - s.cashExpenses;
    const mismatch         = expectedCash - s.physicalCashInHand;
    const balanced         = Math.abs(mismatch) <= 0.01;
    const discountPct      = (s.grossBilledIncludingCancelled + s.discountsGiven) > 0
      ? ((s.discountsGiven / (s.grossBilledIncludingCancelled + s.discountsGiven)) * 100).toFixed(1) + "%"
      : "0.0%";

    const sections: ExportSection[] = [
      {
        title: "Reconciliation Summary",
        metrics: [
          ["Staff",                    data.staffName],
          ["Period",                   from === to ? from : `${from} to ${to}`],
          ["", ""],
          ["── BILLING ──────────────────────", ""],
          ["Gross Bills Generated",    inr(s.grossBilledIncludingCancelled)],
          ["Discounts Given (info)",   `${inr(s.discountsGiven)} (${discountPct} of gross) — already in bill totals`],
          ["Old Dues Collected",       inr(s.duesCollectedTotal)],
          ["Total Revenue Activity",   inr(s.grossBilledIncludingCancelled + s.duesCollectedTotal)],
          ["", ""],
          ["── DEDUCTIONS ───────────────────", ""],
          ["Cancelled Bills",          inr(s.cancelledAmount)],
          ["Refunds (Cash)",           inr(s.cashRefunded)],
          ["Refunds (Digital)",        inr(s.digitalRefunded)],
          ["Total Refunds",            inr(totalRefunds)],
          ["Outstanding Dues",         inr(s.outstanding)],
          ["", ""],
          ["── COLLECTION ───────────────────", ""],
          ["Collectible Amount",       inr(collectible)],
          ["Digital Collection (net)", inr(netDigital)],
          ["Cash Expenses",            inr(s.cashExpenses)],
          ["", ""],
          ["── CASH RECONCILIATION ──────────", ""],
          ["Expected Physical Cash",   inr(expectedCash)],
          ["Actual Cash (payment records)", inr(s.physicalCashInHand)],
          ["Variance",                 balanced ? "₹0 — Balanced ✓" : `${mismatch > 0 ? "+" : "−"}₹${Math.abs(mismatch).toFixed(0)} ${mismatch > 0 ? "(Surplus)" : "(Short)"}`],
          ["", ""],
          ["── ATTRIBUTION NOTE ─────────────", ""],
          ["Cash accountability",      "Refunds & expenses attributed to the staff who performed them, not the bill creator"],
        ],
      },
      {
        title: "Digital Payment Breakdown",
        metrics: [
          ...Object.entries(data.byMethod)
            .filter(([, v]) => Math.abs(v) > 0)
            .sort(([, a], [, b]) => b - a)
            .map(([method, value]) => [
              method.charAt(0).toUpperCase() + method.slice(1),
              inr(value),
            ] as [string, string]),
          ["Digital Refunds",      `−${inr(s.digitalRefunded)}`],
          ["Net Digital",          inr(netDigital)],
        ],
      },
    ];

    // Discount drill-down — owner only
    if (isOwner && data.discountBills.length > 0) {
      // Per-staff
      const byStaffMap = new Map<string, number>();
      const byDoctorMap = new Map<string, number>();
      for (const b of data.discountBills) {
        const staff = b.createdByName ?? "Unknown";
        byStaffMap.set(staff, (byStaffMap.get(staff) ?? 0) + b.discountGiven);
        const doc = b.referringDoctor ?? "No referral";
        byDoctorMap.set(doc, (byDoctorMap.get(doc) ?? 0) + b.discountGiven);
      }
      sections.push({
        title: `Discount Analysis — Total ${inr(s.discountsGiven)} (${discountPct})`,
        metrics: [
          ["", "BY STAFF"],
          ...Array.from(byStaffMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, amt]) => [name, inr(amt)] as [string, string]),
          ["", ""],
          ["", "BY REFERRAL DOCTOR"],
          ...Array.from(byDoctorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([doc, amt]) => [doc, inr(amt)] as [string, string]),
        ],
      });
    }

    const tables: ExportTable[] = [];

    // Discount bill list — owner only
    if (isOwner && data.discountBills.length > 0) {
      tables.push({
        title: "Discounted Bills Detail",
        headers: ["Bill #", "Patient", "Staff", "Referring Doctor", "Gross Amount", "Discount", "Net Amount", "Reason"],
        rows: data.discountBills.map((b) => [
          b.billNumber,
          b.patientName,
          b.createdByName ?? "—",
          b.referringDoctor ?? "—",
          inr(b.grossAmount),
          inr(b.discountGiven),
          inr(b.totalAmount),
          b.discountReason ?? "—",
        ]),
      });
    }

    // Per-staff breakdown
    if (data.byStaff && data.byStaff.length > 0) {
      tables.push({
        title: "Staff-wise Reconciliation",
        headers: ["Staff", "Gross Billed", "Cancelled", "Outstanding", "Cash In", "Refunds (Cash)", "Cash Exp", "Expected Cash", "Net Digital", "Dues Collected", "Discounts"],
        rows: data.byStaff.map((st) => [
          st.name,
          inr(st.grossBilled),
          inr(st.cancelled),
          inr(st.outstanding),
          inr(st.cashIn),
          inr(st.cashRefunded),
          inr(st.cashExpenses),
          inr(st.physicalCashInHand),
          inr(st.netDigital),
          inr(st.duesCollected),
          inr(st.discountsGiven),
        ]),
      });
    }

    return {
      title: "Daily Financial Reconciliation",
      subtitle: `${data.staffName} • ${from === to ? from : `${from} → ${to}`}`,
      sections,
      tables,
    };
  }, [s, data, from, to, isOwner]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Daily Summary"
        subtitle={data ? `${data.staffName} • ${from === to ? from : `${from} → ${to}`}` : "Personal financial summary"}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <SummaryExportToolbar
              config={exportConfig}
              emailEndpoint="/api/dashboard/my-daily-summary/send-email"
            />
            <button onClick={() => { void refetch(); }} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-primary transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        }
      />

      {/* ── Drawer Status Warning Chips ── */}
      {drawerQ.data && <DrawerChips status={drawerQ.data} />}

      {/* ── Day Close Open Window Quick View ── */}
      {myPreviewQ.data && (
        <div className="bg-white dark:bg-card border border-blue-200 dark:border-blue-800 rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Open Window (Live)</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {myPreviewQ.data.coveredFromTs
                ? `${new Date(myPreviewQ.data.coveredFromTs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })} — now`
                : "Since start — now"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Bills</div>
              <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{myPreviewQ.data.billsCount}</div>
              <div className="text-xs text-gray-400">₹{myPreviewQ.data.totalBilled.toFixed(0)} billed</div>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Payments</div>
              <div className="text-lg font-bold text-green-700 dark:text-green-300">{myPreviewQ.data.paymentsCount}</div>
              <div className="text-xs text-gray-400">₹{myPreviewQ.data.expected.total.toFixed(0)} collected</div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Due</div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-300">₹{myPreviewQ.data.totalDue.toFixed(0)}</div>
              <div className="text-xs text-gray-400">outstanding</div>
            </div>
            <div className="bg-violet-50 dark:bg-violet-950/30 rounded-lg p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Expected Cash</div>
              <div className="text-lg font-bold text-violet-700 dark:text-violet-300">₹{myPreviewQ.data.expected.cash.toFixed(0)}</div>
              <div className="text-xs text-gray-400">in hand</div>
            </div>
          </div>

          {/* ── Open Window Bills Table ── */}
          {myPreviewQ.data.bills && myPreviewQ.data.bills.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wide">Bills in Open Window</h4>
                <span className="text-xs text-gray-400">{myPreviewQ.data.bills.length} bill{myPreviewQ.data.bills.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="overflow-x-auto snap-x">
                <table className="w-full text-xs min-w-[800px]">
                  <thead className="bg-gray-50 dark:bg-muted/30">
                    <tr>
                      {["Bill #", "Patient", "Total", "Paid", "Balance", "Discount", "Status", "Referral Doctor", "Created By"].map((h) => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                    {myPreviewQ.data.bills.map((b) => (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-muted/20">
                        <td className="px-2 py-2 font-semibold">
                          <Link href={`/billing/${b.id}`} className="text-primary hover:underline">{b.billNumber}</Link>
                        </td>
                        <td className="px-2 py-2 text-gray-800 dark:text-foreground font-semibold">{b.patientName}</td>
                        <td className="px-2 py-2 font-semibold text-gray-900 dark:text-foreground tabular-nums">{fmt(b.totalAmount)}</td>
                        <td className="px-2 py-2 text-green-700 dark:text-green-400 tabular-nums">{fmt(b.paidAmount)}</td>
                        <td className="px-2 py-2 tabular-nums" style={{ color: b.balanceAmount > 0 ? "#dc2626" : "#16a34a" }}>{fmt(b.balanceAmount)}</td>
                        <td className="px-2 py-2 text-amber-600 tabular-nums">{b.discount > 0 ? fmt(b.discount) : "—"}</td>
                        <td className="px-2 py-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold capitalize"
                            style={{ background: `${statusColors[b.status] ?? "#94a3b8"}22`, color: statusColors[b.status] ?? "#94a3b8" }}>
                            {b.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {b.referringDoctor ? b.referringDoctor : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-2 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">{b.createdByName}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-muted/30 border-t-2 border-gray-200 dark:border-card-border">
                    <tr>
                      <td className="px-2 py-2 font-bold text-gray-800 dark:text-foreground" colSpan={2}>Total ({myPreviewQ.data.bills.length} bills)</td>
                      <td className="px-2 py-2 font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(myPreviewQ.data.bills.reduce((s, b) => s + b.totalAmount, 0))}</td>
                      <td className="px-2 py-2 font-bold tabular-nums text-green-700">{fmt(myPreviewQ.data.bills.reduce((s, b) => s + b.paidAmount, 0))}</td>
                      <td className="px-2 py-2 font-bold tabular-nums text-red-600">{fmt(myPreviewQ.data.bills.reduce((s, b) => s + b.balanceAmount, 0))}</td>
                      <td className="px-2 py-2 font-bold tabular-nums text-amber-600">{fmt(myPreviewQ.data.bills.reduce((s, b) => s + b.discount, 0))}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Date Range Picker ── */}
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            <Calendar size={14} className="text-gray-500 flex-shrink-0" />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-sm" />
            <span className="text-gray-500 text-sm">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 text-sm" />
            <div className="flex gap-1.5 flex-wrap ml-2">
              {[
                { label: "Today", fromAgo: 0, toAgo: 0 },
                { label: "Yesterday", fromAgo: 1, toAgo: 1 },
                { label: "Day Before", fromAgo: 2, toAgo: 2 },
                { label: "7 Days", fromAgo: 6, toAgo: 0 },
                { label: "1 Month", fromAgo: 29, toAgo: 0 },
              ].map((p) => (
                <Button key={p.label} variant="outline" size="sm" className="h-8 text-xs px-3" onClick={() => setPreset(p.fromAgo, p.toAgo)}>
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {isSuperAdmin && staffFilterList.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
              <Users size={12} /> Staff
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => saveStaffFilter("")}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                  staffFilter === ""
                    ? "bg-primary border-primary text-white shadow-sm"
                    : "border-gray-300 dark:border-card-border bg-white dark:bg-card text-gray-700 dark:text-gray-300 hover:border-primary hover:text-primary"
                }`}
              >
                All Staff / Total
              </button>
              {staffFilterList.map((name) => {
                const isSelected = staffFilter === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => saveStaffFilter(isSelected ? "" : name)}
                    className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                      isSelected
                        ? "bg-primary border-primary text-white shadow-sm"
                        : "border-gray-300 dark:border-card-border bg-white dark:bg-card text-gray-700 dark:text-gray-300 hover:border-primary hover:text-primary"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {data?.isFiltered && (
          <p className="text-xs text-blue-600 font-semibold">
            Showing data for: <span className="font-bold">{data.staffName}</span>
          </p>
        )}
      </div>

      {/* ── Loading State ── */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* ── KPI Cards — arranged as the actual reconciliation formula ──
            Bills + Dues − Cancellations − Outstanding = Collectible
            − Digital − Expenses = Expected Physical Cash
            (formula verified against UnifiedReconciliationPanel above) */}
      {s && (
        <>
          {(() => {
            const totalRefunds = s.cashRefunded + s.digitalRefunded;
            const collectible = s.grossBilledIncludingCancelled + s.duesCollectedTotal
              - s.cancelledAmount - totalRefunds - s.outstanding;
            const totalBillsCount = (s.billCount ?? 0) + (s.cancelledByOthersCount ?? 0) + (s.cancelledBySelfCount ?? 0);
            const avgBillValue = totalBillsCount > 0 ? s.grossBilledIncludingCancelled / totalBillsCount : 0;
            return (
              <>
                {/* Row 1 — the money flow, left to right, exactly as it's calculated.
                    CSS Grid with explicit 1fr columns for every card (equal width
                    guaranteed) and auto-width columns for the operator badges
                    between them — the row always fills 100% of the available
                    width with no leftover gaps, on any screen size. */}
                <div
                  className="grid gap-1.5 items-stretch"
                  style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr) auto) minmax(0, 1.3fr)" }}
                >
                  <MiniKpi icon={IndianRupee} label="Total Bills Generated" value={fmt(s.grossBilledIncludingCancelled)} sub={`${totalBillsCount} bills`} theme="indigo" onClick={() => setDrilldownType("totalBills")} />
                  <FormulaOp op="+" />
                  <MiniKpi icon={Receipt} label="Dues Collected" value={fmt(s.duesCollectedTotal)} sub={`${s.duesBillsCount} old bill${s.duesBillsCount !== 1 ? "s" : ""} settled`} theme="green" onClick={() => setDrilldownType("duesCollected")} />
                  <FormulaOp op="−" />
                  <MiniKpi icon={RotateCcw} label="Cancellations" value={fmt(s.cancelledAmount)} sub={`${s.cancellationCount} bill${s.cancellationCount !== 1 ? "s" : ""} cancelled`} theme="pink" onClick={() => setDrilldownType("cancellations")} />
                  <FormulaOp op="−" />
                  <MiniKpi icon={Wallet} label="Outstanding / Dues" value={fmt(s.outstanding)} sub="Unpaid balance" theme="orange" onClick={() => setDrilldownType("outstandingDues")} />
                  <FormulaOp op="=" />
                  <MiniKpi icon={Calculator} label="Collectible Amount" value={fmt(collectible)} sub="What should be in hand + bank" theme="blue" onClick={() => setDrilldownType("collectibleAmount")} />
                  <FormulaOp op="−" />
                  <MiniKpiFilled icon={Smartphone} label="Net Digital Collection" value={fmt(s.netDigital)} sub={`Gross ${fmt(s.digitalCollection)} − Refunded ${fmt(s.digitalRefunded)}`} solid="teal" onClick={() => setDrilldownType("netDigitalCollection")} />
                  <FormulaOp op="−" />
                  <MiniKpiFilled icon={TrendingDown} label="Total Expenses" value={fmt(s.totalExpenses)} sub={`Cash ${fmt(s.cashExpenses)} / Digital ${fmt(s.digitalExpenses)}`} solid="red" onClick={() => setDrilldownType("totalExpenses")} />
                  <FormulaOp op="=" />
                  <MiniKpiFilled icon={Banknote} label="Expected Physical Cash" value={fmt(s.physicalCashInHand)} sub={`Cash ${fmt(s.cashCollection)} − Cash Exp ${fmt(s.cashExpenses)}`} solid="green" onClick={() => setDrilldownType("expectedPhysicalCash")} />
                </div>

                {/* Row 2 — supplementary metrics, evenly filled, no empty cells.
                    CSS Grid with equal columns — same guarantee as Row 1. */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-stretch">
                  <MiniKpi icon={CheckCircle2} label="Total Received" value={fmt(s.totalReceived)} sub="All payments collected" theme="green" onClick={() => setDrilldownType("totalReceived")} />
                  <MiniKpi icon={Tag} label="Discounts Given" value={fmt(s.discountsGiven)} sub={s.grossBilling > 0 ? `${((s.discountsGiven / s.grossBilling) * 100).toFixed(1)}% of billing` : ""} theme="purple" onClick={() => setDrilldownType("discountsGiven")} />
                  <MiniKpi icon={XCircle} label="Cancellation Count" value={String(s.cancellationCount)} sub={s.cancellationCount > 0 ? `₹${s.cancelledAmount.toFixed(0)} written off` : "None"} theme="pink" onClick={() => setDrilldownType("cancellationCount")} />
                  <MiniKpi icon={IndianRupee} label="Average Bill Value" value={fmt(avgBillValue)} sub={`Across ${totalBillsCount} bill${totalBillsCount !== 1 ? "s" : ""}`} theme="slate" onClick={() => setDrilldownType("averageBillValue")} />
                </div>
              </>
            );
          })()}

          {/* ── Suspense / Exception Bucket — payments or refunds whose method
                could not be classified as cash or digital. Excluded from every
                figure above; needs admin correction. See
                DAILY_FINANCIAL_RECONCILIATION_SPECIFICATION.md §22.3. Only
                rendered when there is something to review. */}
          {((s.suspensePaymentCount ?? 0) > 0 || (s.suspenseRefundCount ?? 0) > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-400">
                <Info size={15} />
                Needs review — unrecognized payment method
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                {(s.suspensePaymentCount ?? 0) + (s.suspenseRefundCount ?? 0)} transaction(s) totalling{" "}
                {fmt((s.suspensePaymentAmount ?? 0) + (s.suspenseRefundAmount ?? 0))} have a payment method this dashboard
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
                          <td className="px-2 py-1 tabular-nums">{fmt(p.amount)}</td>
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

          {/* ══ DAILY FINANCIAL RECONCILIATION — Single Compact Panel ══════
              Replaces: DailyFinancialReconciliation (Panel 1)
                        "My Billing" card
                        "My Cashbox" card
                        DailyReconciliationAndCashFlow (Panel 2)
              Owner-approved decision: one panel, compact density, collapsed
              digital split, discounts prominent + role-gated drill-down.
          ════════════════════════════════════════════════════════════════ */}
          <UnifiedReconciliationPanel
            summary={s}
            byMethod={data.byMethod}
            discountBills={data.discountBills}
            isOwner={isOwner}
            exportConfig={exportConfig}
          />

          {/* ── Drawer Close Status Card ── */}
          {drawerQ.data && <DrawerStatusCard status={drawerQ.data} />}

          {/* ── Post-Closure Activity Box ── */}
          {postClosureQ.data && <PostClosureActivityBox data={postClosureQ.data} />}

          {/* ── Per-Staff Breakdown (All Staff / Total only) ── */}
          {data?.byStaff && data.byStaff.length > 0 && (
            <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border bg-gray-50 dark:bg-muted/30">
                <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
                  <Users size={14} className="text-emerald-600" /> Per-Staff Breakdown
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Billing + Cash details for each staff member (All Staff view)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-muted/30 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Staff</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Gross Billed</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Active</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Cancelled</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Outstanding</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Net Collected</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Bills</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Cash In</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Digital In</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Net Cash</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Net Digital</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Total Received</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Cash Exp</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Phys. Cash</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Dues</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Disc.</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Canc.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                    {data.byStaff.map((st) => (
                      <tr key={st.name} className="hover:bg-emerald-50/40 dark:hover:bg-muted/20">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap text-gray-800 dark:text-gray-200">{st.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmt(st.grossBilled)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{fmt(st.activeBilling)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{st.cancelled > 0 ? fmt(st.cancelled) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{st.outstanding > 0 ? fmt(st.outstanding) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{fmt(st.netCollected)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-500">{st.billCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-blue-700 dark:text-blue-400">{fmt(st.cashIn)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-violet-700 dark:text-violet-400">{fmt(st.digitalIn)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700 dark:text-blue-400">{fmt(st.netCash)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-violet-700 dark:text-violet-400">{fmt(st.netDigital)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">{fmt(st.totalReceived)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-orange-600 dark:text-orange-400">{st.cashExpenses > 0 ? fmt(st.cashExpenses) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-800 dark:text-blue-300">{fmt(st.physicalCashInHand)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-teal-600 dark:text-teal-400">{st.duesCollected > 0 ? fmt(st.duesCollected) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">{st.discountsGiven > 0 ? fmt(st.discountsGiven) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-500">{st.cancellationCount > 0 ? st.cancellationCount : "—"}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-gray-100 dark:bg-gray-900/40 font-bold border-t-2 border-gray-200 dark:border-gray-700">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-900 dark:text-gray-100">TOTAL</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.grossBilled, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.activeBilling, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.cancelled, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.outstanding, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(data.byStaff.reduce((a, st) => a + st.netCollected, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{data.byStaff.reduce((a, st) => a + st.billCount, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.cashIn, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.digitalIn, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.netCash, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.netDigital, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">{fmt(data.byStaff.reduce((a, st) => a + st.totalReceived, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.cashExpenses, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.physicalCashInHand, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.duesCollected, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.byStaff.reduce((a, st) => a + st.discountsGiven, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{data.byStaff.reduce((a, st) => a + st.cancellationCount, 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── My Activity Log (Bill Edits + Voucher Edits + Cancellations + Refunds) ── */}
          <MyActivityLog data={data} />
        </>
      )}

      {/* ── Dues Collected ── */}
      {data && data.duesBills.length > 0 && (
        <div className="bg-white dark:bg-card border border-teal-200 dark:border-teal-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-teal-100 dark:border-teal-800 flex items-center justify-between bg-teal-50 dark:bg-teal-900/20">
            <h3 className="text-sm font-bold text-teal-900 dark:text-teal-200 flex items-center gap-2">
              <Receipt size={14} className="text-teal-600" /> Dues Collected
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-200 dark:bg-teal-800 text-teal-800 dark:text-teal-200">
                {data.duesBills.length} bills
              </span>
            </h3>
            <span className="text-xs font-bold text-teal-700 dark:text-teal-300 tabular-nums">
              Total collected: {fmt(data.duesBills.reduce((s, b) => s + b.duesCollected, 0))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-teal-50 dark:bg-teal-900/10">
                <tr>
                  {["Bill #", "Patient Name", "Referral Doctor", "Created By", "Bill Total", "Dues Collected", "Still Pending"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-teal-800 dark:text-teal-300 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50 dark:divide-teal-900/20">
                {data.duesBills.map((b) => (
                  <tr key={b.billId} className="hover:bg-teal-50/60 dark:hover:bg-teal-900/10">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      <Link href={`/billing/${b.billId}`} className="text-primary hover:underline">{b.billNumber}</Link>
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-800 dark:text-foreground">{b.patientName}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {b.referringDoctor ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-[11px]">
                      {b.createdByName ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-900 dark:text-foreground font-semibold">{fmt(b.totalAmount)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-teal-700 dark:text-teal-400">{fmt(b.duesCollected)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {b.remainingDues > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                          {fmt(b.remainingDues)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-semibold">
                          Cleared ✓
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-teal-50 dark:bg-teal-900/10 border-t-2 border-teal-200 dark:border-teal-800">
                <tr>
                  <td className="px-3 py-2 font-bold text-teal-800 dark:text-teal-300" colSpan={5}>
                    Total ({data.duesBills.length} bills)
                  </td>
                  <td className="px-3 py-2 font-bold tabular-nums text-teal-700 dark:text-teal-300">
                    {fmt(data.duesBills.reduce((s, b) => s + b.duesCollected, 0))}
                  </td>
                  <td className="px-3 py-2 font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {data.duesBills.some((b) => b.remainingDues > 0)
                      ? fmt(data.duesBills.reduce((s, b) => s + b.remainingDues, 0))
                      : <span className="text-green-600 dark:text-green-400">All cleared</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Outstanding Bills ── */}
      {data && data.outstandingBills.length > 0 && (
        <div className="bg-white dark:bg-card border border-orange-200 dark:border-orange-800 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-orange-100 dark:border-orange-800 flex items-center justify-between bg-orange-50 dark:bg-orange-900/20">
            <h3 className="text-sm font-bold text-orange-900 dark:text-orange-200 flex items-center gap-2">
              <AlertCircle size={14} className="text-orange-600" /> Outstanding Bills
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200">
                {data.outstandingBills.length} bills
              </span>
            </h3>
            <span className="text-xs font-bold text-orange-700 dark:text-orange-300 tabular-nums">
              Total outstanding: {fmt(data.outstandingBills.reduce((s, b) => s + b.outstanding, 0))}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-orange-50 dark:bg-orange-900/10">
                <tr>
                  {["Bill #", "Patient Name", "Referral Doctor", "Created By", "Bill Total", "Paid Amount", "Outstanding"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-orange-800 dark:text-orange-300 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-orange-50 dark:divide-orange-900/20">
                {data.outstandingBills.map((b) => (
                  <tr key={b.billId} className="hover:bg-orange-50/60 dark:hover:bg-orange-900/10">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      <Link href={`/billing/${b.billId}`} className="text-primary hover:underline">{b.billNumber}</Link>
                    </td>
                    <td className="px-3 py-2 font-semibold text-gray-800 dark:text-foreground">{b.patientName}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {b.referringDoctor ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap text-[11px]">
                      {b.createdByName ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-gray-900 dark:text-foreground font-semibold">{fmt(b.totalAmount)}</td>
                    <td className="px-3 py-2 tabular-nums text-green-600 dark:text-green-400">{fmt(b.paidAmount)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-orange-700 dark:text-orange-400">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 font-semibold">
                        {fmt(b.outstanding)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-orange-50 dark:bg-orange-900/10 border-t-2 border-orange-200 dark:border-orange-800">
                <tr>
                  <td className="px-3 py-2 font-bold text-orange-800 dark:text-orange-300" colSpan={4}>
                    Total ({data.outstandingBills.length} bills)
                  </td>
                  <td className="px-3 py-2 font-bold tabular-nums text-gray-900 dark:text-foreground">
                    {fmt(data.outstandingBills.reduce((s, b) => s + b.totalAmount, 0))}
                  </td>
                  <td className="px-3 py-2 font-bold tabular-nums text-green-600 dark:text-green-400">
                    {fmt(data.outstandingBills.reduce((s, b) => s + b.paidAmount, 0))}
                  </td>
                  <td className="px-3 py-2 font-bold tabular-nums text-orange-700 dark:text-orange-300">
                    {fmt(data.outstandingBills.reduce((s, b) => s + b.outstanding, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Discounts Given — detailed table (Owner / Admin only) ── */}
      {isOwner && data && data.discountBills.length > 0 && (() => {
        const discBills = data.discountBills;
        const totalGross = discBills.reduce((s, b) => s + b.grossAmount, 0);
        const totalDiscount = discBills.reduce((s, b) => s + b.discountGiven, 0);
        const totalPending = discBills.reduce((s, b) => s + b.balanceAmount, 0);
        return (
          <div className="bg-white dark:bg-card border border-amber-200 dark:border-amber-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-800 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20">
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
                <Percent size={14} className="text-amber-600" /> Discounts Given
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200">
                  {discBills.length} bills
                </span>
              </h3>
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300 tabular-nums">
                Total discount: {fmt(totalDiscount)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-amber-50 dark:bg-amber-900/10">
                  <tr>
                    {["Bill #", "Patient Name", "Referral Doctor", "Bill Total", "Discount Given", "Reason", "Still Pending"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold text-amber-800 dark:text-amber-300 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-50 dark:divide-amber-900/20">
                  {discBills.map((b) => {
                    const pct = b.grossAmount > 0 ? ((b.discountGiven / b.grossAmount) * 100).toFixed(1) : "0.0";
                    return (
                      <tr key={b.billId} className="hover:bg-amber-50/60 dark:hover:bg-amber-900/10">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">
                          <Link href={`/billing/${b.billId}`} className="text-primary hover:underline">{b.billNumber}</Link>
                        </td>
                        <td className="px-3 py-2 font-semibold text-gray-800 dark:text-foreground">{b.patientName}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {b.referringDoctor ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-gray-900 dark:text-foreground font-semibold">{fmt(b.grossAmount)}</td>
                        <td className="px-3 py-2 tabular-nums font-bold text-amber-600 dark:text-amber-400">
                          {fmt(b.discountGiven)}
                          <span className="ml-1 text-[10px] font-normal text-amber-500 dark:text-amber-400">({pct}%)</span>
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[200px]">
                          <div className="flex flex-col gap-0.5">
                            <span>{b.discountReason ?? <span className="text-gray-400">—</span>}</span>
                            {b.discountReasonNote && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 italic truncate" title={b.discountReasonNote}>
                                Note: {b.discountReasonNote}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {b.balanceAmount > 0 ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold">
                              {fmt(b.balanceAmount)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 font-semibold">
                              Cleared ✓
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-amber-50 dark:bg-amber-900/10 border-t-2 border-amber-200 dark:border-amber-800">
                  <tr>
                    <td className="px-3 py-2 font-bold text-amber-800 dark:text-amber-300" colSpan={3}>
                      Total ({discBills.length} bills)
                    </td>
                    <td className="px-3 py-2 font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(totalGross)}</td>
                    <td className="px-3 py-2 font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(totalDiscount)}</td>
                    <td />
                    <td className="px-3 py-2 font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {totalPending > 0
                        ? fmt(totalPending)
                        : <span className="text-green-600 dark:text-green-400">All cleared</span>}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Recent Bills ── */}
      {data && data.bills.length > 0 && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
              <IndianRupee size={14} className="text-emerald-600" /> Bills Created by Me
            </h3>
            <Link href="/billing" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
              All bills <ArrowRight size={11} />
            </Link>
          </div>
          <div className="overflow-x-auto snap-x">
            <table className="w-full text-xs min-w-[800px]">
              <thead className="bg-gray-50 dark:bg-muted/30">
                <tr>
                  {["Bill #", "Patient", "Total", "Paid", "Balance", "Discount", "Status", "Referral Doctor"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                {data.bills.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-muted/20">
                    <td className="px-3 py-2 font-semibold">
                      <Link href={`/billing/${b.id}`} className="text-primary hover:underline">{b.billNumber}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-800 dark:text-foreground font-semibold">{b.patientName}</td>
                    <td className="px-3 py-2 font-semibold text-gray-900 dark:text-foreground tabular-nums">{fmt(b.totalAmount)}</td>
                    <td className="px-3 py-2 text-green-700 dark:text-green-400 tabular-nums">{fmt(b.paidAmount)}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: b.balanceAmount > 0 ? "#dc2626" : "#16a34a" }}>{fmt(b.balanceAmount)}</td>
                    <td className="px-3 py-2 text-amber-600 tabular-nums">{b.discount > 0 ? fmt(b.discount) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold capitalize"
                        style={{ background: `${statusColors[b.status] ?? "#94a3b8"}22`, color: statusColors[b.status] ?? "#94a3b8" }}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {b.referringDoctor ? b.referringDoctor : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-muted/30 border-t-2 border-gray-200 dark:border-card-border">
                <tr>
                  <td className="px-3 py-2 font-bold text-gray-800 dark:text-foreground" colSpan={2}>Total ({data.bills.length} bills)</td>
                  <td className="px-3 py-2 font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(data.bills.reduce((s, b) => s + b.totalAmount, 0))}</td>
                  <td className="px-3 py-2 font-bold tabular-nums text-green-700">{fmt(data.bills.reduce((s, b) => s + b.paidAmount, 0))}</td>
                  <td className="px-3 py-2 font-bold tabular-nums text-red-600">{fmt(data.bills.reduce((s, b) => s + b.balanceAmount, 0))}</td>
                  <td className="px-3 py-2 font-bold tabular-nums text-amber-600">{fmt(data.bills.reduce((s, b) => s + b.discount, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent Payments ── */}
      {data && data.payments.length > 0 && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border">
            <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
              <Wallet size={14} className="text-green-600" /> Payments Collected by Me
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-card-border">
            {data.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-muted/20">
                <div className="flex items-center gap-3">
                  <Banknote size={13} className="text-green-500 flex-shrink-0" />
                  <div>
                    <Link href={`/billing/${p.billId}`} className="text-xs font-semibold text-primary hover:underline">Bill #{p.billId}</Link>
                    <p className="text-[10px] text-gray-500">{fmtTime(p.createdAt)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-green-700 dark:text-green-400 tabular-nums">{fmt(p.amount)}</p>
                  <p className="text-[10px] text-gray-500 capitalize">{p.method}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.bills.length === 0 && data.payments.length === 0 && (
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-10 text-center">
          <IndianRupee size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-700 dark:text-gray-300">No activity found</p>
          <p className="text-sm text-gray-500 mt-1">No bills or payments for {data.staffName} in this period.</p>
        </div>
      )}

      {/* Drill-down modal — reuses this page's own date range + staff filter */}
      <SummaryDrilldownModal
        type={drilldownType}
        from={from}
        to={to}
        staffName={isSuperAdmin && staffFilter.trim() ? staffFilter.trim() : null}
        onClose={() => setDrilldownType(null)}
      />
    </div>
  );
}
