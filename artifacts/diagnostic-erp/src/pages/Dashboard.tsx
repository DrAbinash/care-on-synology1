import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calendar, AlertCircle, RefreshCw } from "lucide-react";
import { SummaryExportToolbar, formatExportAmount } from "@/components/SummaryExport";
import type { ExportConfig } from "@/components/SummaryExport";
import {
  useGetDashboardStats,
  useGetRevenueReport,
  useGetPopularTests,
} from "@workspace/api-client-react";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import {
  Users,
  ClipboardList,
  IndianRupee,
  FileText,
  AlertTriangle,
  TrendingUp,
  Plus,
  BarChart3,
  Package,
  ChevronRight,
  TrendingDown,
  Star,
  Activity,
  Wallet,
  Banknote,
  Smartphone,
  RotateCcw,
  XCircle,
  FileEdit,
  ShieldAlert,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type IncomeExpenseApiRow = {
  date: string;
  income: { total: number; cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number };
  expense: { amount: number; count: number };
  net: number;
};
type IncomeExpensePayload = {
  rows: IncomeExpenseApiRow[];
  totals: { income: number; expense: number; net: number; cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number };
};

type StaffComparisonRow = {
  staffName: string;
  billCount: number;
  totalBilling: number;
  totalReceived: number;
  cashCollection: number;
  digitalCollection: number;
  discountsGiven: number;
  refundAmount: number;
  cancellationCount: number;
  cancelledAmount: number;
  billEditCount: number;
  voucherEditCount: number;
  cashExpenses: number;
  netCashHandled: number;
};

type ModalityRow = {
  modality: string;
  testCount: number;
  grossBilling: number;
  discounts: number;
  netCollection: number;
  pendingDues: number;
  completedReports: number;
  pendingReports: number;
};

type DashboardAlert = {
  type: string;
  message: string;
  severity: "warning" | "info" | "critical";
  staffName?: string;
};

type OverallSummary = {
  grossBilling: number;
  outstanding: number;
  refundsAndCancellations: number;
  refundAmount: number;
  cancelledAmount: number;
  totalReceived: number;
  digitalCollection: number;
  cashCollection: number;
  totalExpenses: number;
  discountsGiven: number;
  netCollection: number;
  physicalCashInHand: number;
  pendingReports: number;
};

type DailySummaryBillEdit = {
  id: number;
  billId: number;
  billNumber: string;
  editedBy: string;
  reason: string;
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

type DailySummaryData = {
  date: string;
  summary: {
    totalBilling: number; outstanding: number; refundsAndCancellations: number;
    expenses: number; netCollection: number; digitalCollection: number;
    physicalCashInHand: number; discountsGiven: number; billCount: number; orderCount: number;
  };
  byMethod: Record<string, number>;
  bills: {
    id: number; billNumber: string; patientName: string; totalAmount: number;
    paidAmount: number; balanceAmount: number; discount: number; status: string;
    createdAt: string; createdByName: string;
  }[];
  billEdits: DailySummaryBillEdit[];
  voucherEdits: { id: number; editedBy: string; reason: string; createdAt: string }[];
  refunds: { id: number; billId: number; amount: number; method: string; createdAt: string; recordedByName: string }[];
  cancelledBillsDetail: { id: number; billNumber: string; patientName: string; totalAmount: number; createdByName: string; cancelledAt: string }[];
};

type AdvancedSummary = {
  from: string;
  to: string;
  overallSummary: OverallSummary;
  staffComparison: StaffComparisonRow[];
  modalitySummary: ModalityRow[];
  alerts: DashboardAlert[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function fmtK(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n.toFixed(0)}`;
}

const MODALITY_COLORS: Record<string, string> = {
  MRI: "#7c3aed",
  CT: "#2563eb",
  "X-Ray": "#0891b2",
  USG: "#0d9488",
  Pathology: "#16a34a",
  ECG: "#ca8a04",
  Mammography: "#db2777",
  Cardiology: "#dc2626",
  Endoscopy: "#9333ea",
  Other: "#64748b",
};
function modalityColor(m: string) {
  return MODALITY_COLORS[m] ?? "#64748b";
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }); }
  catch { return ""; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  trend,
  cardClass,
  accentBorder,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  iconBg: string;
  trend?: { label: string; positive: boolean };
  cardClass?: string;
  accentBorder?: string;
}) {
  return (
    <div className={`bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow border-l-4 ${accentBorder ?? "border-l-primary"} ${cardClass ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-gray-900 dark:text-foreground leading-none">{value}</p>
          {sub && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{sub}</p>}
          {trend && (
            <p className={`mt-1 text-xs font-semibold ${trend.positive ? "text-green-600" : "text-red-500"}`}>
              {trend.positive ? "↑" : "↓"} {trend.label}
            </p>
          )}
        </div>
        <div className={`p-2.5 rounded-xl flex-shrink-0 ${iconBg}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function QuickActionCard({
  icon: Icon, label, description, href, color,
}: { icon: React.ElementType; label: string; description: string; href: string; color: string }) {
  return (
    <Link href={href} className="group block">
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-3.5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color} group-hover:scale-105 transition-transform`}>
            <Icon size={15} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-foreground">{label}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">{description}</p>
          </div>
          <ChevronRight size={13} className="text-gray-400 ml-auto flex-shrink-0 group-hover:text-primary transition-colors" />
        </div>
      </div>
    </Link>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">{children}</h3>
      {action}
    </div>
  );
}

function SpotlightCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className="opacity-70" />
        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</span>
      </div>
      <p className="text-base font-bold leading-tight">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

// ─── Modality Section ─────────────────────────────────────────────────────────

function ModalitySection({ rows }: { rows: ModalityRow[] }) {
  const [showTable, setShowTable] = useState(false);
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-6 text-center text-sm text-gray-500">
        No test data for this period.
      </div>
    );
  }
  const totalTests = rows.reduce((s, r) => s + r.testCount, 0);
  const totalBilling = rows.reduce((s, r) => s + r.grossBilling, 0);

  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
          <Activity size={14} className="text-violet-600" /> Modality-wise Business Summary
        </h3>
        <span className="text-xs text-gray-500">{totalTests} tests · {fmt(totalBilling)}</span>
      </div>

      {/* Compact cards */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {rows.map((r) => (
          <div key={r.modality} className="rounded-lg border border-gray-100 dark:border-card-border bg-gray-50 dark:bg-muted/20 p-3 hover:shadow-sm transition-shadow">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: modalityColor(r.modality) }} />
              <span className="text-xs font-bold text-gray-800 dark:text-foreground truncate">{r.modality}</span>
            </div>
            <p className="text-lg font-bold text-gray-900 dark:text-foreground leading-none">{fmtK(r.grossBilling)}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{r.testCount} test{r.testCount === 1 ? "" : "s"}</p>
            <div className="mt-1.5 flex gap-2 text-[10px]">
              <span className="text-green-700 dark:text-green-400">✓ {r.completedReports}</span>
              {r.pendingReports > 0 && <span className="text-amber-600 dark:text-amber-400">⏳ {r.pendingReports}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Bar Chart */}
      <div className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={rows} margin={{ top: 0, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="modality" tick={{ fontSize: 11, fill: "#374151", fontWeight: 600 }} />
            <YAxis tick={{ fontSize: 10, fill: "#374151" }} tickFormatter={fmtK} />
            <Tooltip
              formatter={(v: number, name: string) => [fmt(v), name === "grossBilling" ? "Billing" : "Tests"]}
              contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", color: "#111827" }}
            />
            <Legend wrapperStyle={{ fontSize: "11px", color: "#374151" }} />
            <Bar dataKey="grossBilling" name="Billing" radius={[4, 4, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.modality} fill={modalityColor(r.modality)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table toggle */}
      <div className="border-t border-gray-100 dark:border-card-border">
        <button onClick={() => setShowTable((v) => !v)} className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-muted/30 transition-colors">
          <span>Detailed Table</span>
          {showTable ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showTable && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-muted/30">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-700 dark:text-gray-300">Modality</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Tests</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Gross Billing</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Completed</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-card-border">
                {rows.map((r) => (
                  <tr key={r.modality} className="hover:bg-gray-50 dark:hover:bg-muted/20">
                    <td className="px-3 py-2 font-semibold text-gray-800 dark:text-foreground flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: modalityColor(r.modality) }} />
                      {r.modality}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 tabular-nums">{r.testCount}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-foreground tabular-nums">{fmt(r.grossBilling)}</td>
                    <td className="px-3 py-2 text-right text-green-700 dark:text-green-400 tabular-nums">{r.completedReports}</td>
                    <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400 tabular-nums">{r.pendingReports}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-muted/30 border-t-2 border-gray-200 dark:border-card-border">
                <tr>
                  <td className="px-3 py-2 font-bold text-gray-800 dark:text-foreground">Total</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-foreground tabular-nums">{totalTests}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 dark:text-foreground tabular-nums">{fmt(totalBilling)}</td>
                  <td className="px-3 py-2 text-right font-bold text-green-700 tabular-nums">{rows.reduce((s, r) => s + r.completedReports, 0)}</td>
                  <td className="px-3 py-2 text-right font-bold text-amber-600 tabular-nums">{rows.reduce((s, r) => s + r.pendingReports, 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Staff Comparison Section ─────────────────────────────────────────────────

const SUSPICIOUS_DISCOUNT_PCT = 0.2;
const SUSPICIOUS_CANCELLATIONS = 3;
const SUSPICIOUS_EDITS = 4;

function StaffComparisonSection({ rows }: { rows: StaffComparisonRow[] }) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-6 text-center text-sm text-gray-500">
        No staff activity for this period.
      </div>
    );
  }

  const topBilling = rows.reduce((best, r) => r.totalBilling > best.totalBilling ? r : best, rows[0]);
  const topCash = rows.reduce((best, r) => r.cashCollection > best.cashCollection ? r : best, rows[0]);
  const topDiscount = rows.reduce((best, r) => r.discountsGiven > best.discountsGiven ? r : best, rows[0]);
  const topCancels = rows.reduce((best, r) => r.cancellationCount > best.cancellationCount ? r : best, rows[0]);
  const topEdits = rows.reduce((best, r) => (r.billEditCount + r.voucherEditCount) > (best.billEditCount + best.voucherEditCount) ? r : best, rows[0]);

  const visibleRows = showAll ? rows : rows.slice(0, 6);

  function rowFlags(r: StaffComparisonRow) {
    const flags: string[] = [];
    if (r.totalBilling > 0 && r.discountsGiven / r.totalBilling >= SUSPICIOUS_DISCOUNT_PCT)
      flags.push("high-discount");
    if (r.cancellationCount >= SUSPICIOUS_CANCELLATIONS)
      flags.push("cancellations");
    if (r.billEditCount + r.voucherEditCount >= SUSPICIOUS_EDITS)
      flags.push("edits");
    if (r.totalBilling > 1000 && r.totalReceived < r.totalBilling * 0.5)
      flags.push("low-collection");
    return flags;
  }

  function rowBg(flags: string[]) {
    if (flags.includes("high-discount") && flags.length >= 2)
      return "bg-orange-50 dark:bg-orange-950/20";
    if (flags.length > 0) return "bg-amber-50/50 dark:bg-amber-950/10";
    return "";
  }

  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border">
        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
          <Users size={14} className="text-blue-600" /> Staff Collection Comparison
        </h3>
      </div>

      {/* Spotlight cards */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <SpotlightCard label="Top Billing" value={topBilling.staffName} sub={fmt(topBilling.totalBilling)} icon={TrendingUp} color="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200" />
        <SpotlightCard label="Top Cash" value={topCash.staffName} sub={fmt(topCash.cashCollection)} icon={Banknote} color="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200" />
        <SpotlightCard label="Most Discounts" value={topDiscount.staffName} sub={`${fmt(topDiscount.discountsGiven)}${topDiscount.totalBilling > 0 ? ` (${((topDiscount.discountsGiven / topDiscount.totalBilling) * 100).toFixed(0)}%)` : ""}`} icon={TrendingDown} color="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200" />
        <SpotlightCard label="Most Cancellations" value={topCancels.cancellationCount > 0 ? topCancels.staffName : "—"} sub={topCancels.cancellationCount > 0 ? `${topCancels.cancellationCount} bill${topCancels.cancellationCount === 1 ? "" : "s"}` : "None today"} icon={XCircle} color="bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200" />
        <SpotlightCard label="Most Edits" value={(topEdits.billEditCount + topEdits.voucherEditCount) > 0 ? topEdits.staffName : "—"} sub={(topEdits.billEditCount + topEdits.voucherEditCount) > 0 ? `${topEdits.billEditCount + topEdits.voucherEditCount} edit${topEdits.billEditCount + topEdits.voucherEditCount === 1 ? "" : "s"}` : "None today"} icon={FileEdit} color="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-200" />
      </div>

      {/* Staff table */}
      <div className="overflow-x-auto border-t border-gray-100 dark:border-card-border">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-muted/30 sticky top-0">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Staff</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Bills</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Total Billing</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Total Received</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Cash</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Digital</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Discounts</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Refunds</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Cancels</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Edits</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">Net Cash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-card-border">
            {visibleRows.map((r) => {
              const flags = rowFlags(r);
              const discountPct = r.totalBilling > 0 ? (r.discountsGiven / r.totalBilling) * 100 : 0;
              const totalEdits = r.billEditCount + r.voucherEditCount;
              return (
                <tr key={r.staffName} className={`hover:bg-gray-50 dark:hover:bg-muted/20 ${rowBg(flags)}`}>
                  <td className="px-3 py-2 font-semibold text-gray-800 dark:text-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {r.staffName}
                      {flags.length > 0 && (
                        <span title={flags.join(", ")} className="text-amber-500">
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 tabular-nums">{r.billCount}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-foreground tabular-nums">{fmt(r.totalBilling)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400 tabular-nums">{fmt(r.totalReceived)}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 tabular-nums">{fmt(r.cashCollection)}</td>
                  <td className="px-3 py-2 text-right text-violet-700 dark:text-violet-400 tabular-nums">{fmt(r.digitalCollection)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${flags.includes("high-discount") ? "font-bold text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-300"}`}>
                    {fmt(r.discountsGiven)}
                    {discountPct >= 10 && <span className="ml-1 text-[10px] text-orange-500">({discountPct.toFixed(0)}%)</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400 tabular-nums">{r.refundAmount > 0 ? fmt(r.refundAmount) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${flags.includes("cancellations") ? "font-bold text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-300"}`}>
                    {r.cancellationCount > 0 ? r.cancellationCount : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${flags.includes("edits") ? "font-bold text-orange-600 dark:text-orange-400" : "text-gray-700 dark:text-gray-300"}`}>
                    {totalEdits > 0 ? (
                      <span title={`${r.billEditCount} bill + ${r.voucherEditCount} voucher`}>{totalEdits}</span>
                    ) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.netCashHandled < 0 ? "text-red-600 dark:text-red-400" : "text-blue-700 dark:text-blue-300"}`}>
                    {fmt(r.netCashHandled)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-muted/30 border-t-2 border-gray-200 dark:border-card-border">
              <tr>
                <td className="px-3 py-2 font-bold text-gray-800 dark:text-foreground">Total</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{rows.reduce((s, r) => s + r.billCount, 0)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(rows.reduce((s, r) => s + r.totalBilling, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-green-700">{fmt(rows.reduce((s, r) => s + r.totalReceived, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(rows.reduce((s, r) => s + r.cashCollection, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-violet-700">{fmt(rows.reduce((s, r) => s + r.digitalCollection, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{fmt(rows.reduce((s, r) => s + r.discountsGiven, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-rose-600">{fmt(rows.reduce((s, r) => s + r.refundAmount, 0))}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{rows.reduce((s, r) => s + r.cancellationCount, 0)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-foreground">{rows.reduce((s, r) => s + r.billEditCount + r.voucherEditCount, 0)}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-blue-700">{fmt(rows.reduce((s, r) => s + r.netCashHandled, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > 6 && (
        <div className="border-t border-gray-100 dark:border-card-border">
          <button onClick={() => setShowAll((v) => !v)} className="w-full py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-muted/30 transition-colors flex items-center justify-center gap-1">
            {showAll ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show all {rows.length} staff</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Alerts Strip ─────────────────────────────────────────────────────────────

function AlertsStrip({ alerts }: { alerts: DashboardAlert[] }) {
  const [open, setOpen] = useState(true);
  if (alerts.length === 0) return null;
  const criticals = alerts.filter((a) => a.severity === "critical").length;
  const warnings = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition-colors">
        <span className="flex items-center gap-2">
          <ShieldAlert size={14} />
          Control Alerts
          {criticals > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white">{criticals}</span>}
          {warnings > 0 && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">{warnings}</span>}
        </span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-amber-200 dark:border-amber-800/40 pt-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs ${
              a.severity === "critical"
                ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 text-red-800 dark:text-red-300"
                : a.severity === "warning"
                  ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300"
                  : "bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 text-blue-800 dark:text-blue-300"
            }`}>
              {a.severity === "critical" ? <ShieldAlert size={12} className="mt-0.5 flex-shrink-0" />
                : a.severity === "warning" ? <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                : <Info size={12} className="mt-0.5 flex-shrink-0" />}
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Financial Reconciliation ─────────────────────────────────────────────────

function RecRow({ label, value, type, note }: {
  label: string; value: number; type: "start" | "deduct" | "result" | "final"; note?: string;
}) {
  const isDeduct = type === "deduct";
  const isResult = type === "result" || type === "final";
  return (
    <div className={`flex items-center justify-between py-1.5 ${isResult ? "font-bold" : ""}`}>
      <span className={`text-sm ${isDeduct ? "text-red-600 dark:text-red-400 pl-4" : isResult ? "text-gray-900 dark:text-foreground" : "text-gray-800 dark:text-gray-200"}`}>
        {label}
        {note && <span className="text-xs font-normal text-gray-400 ml-1">({note})</span>}
      </span>
      <span className={`tabular-nums text-sm ${isDeduct ? "text-red-600 dark:text-red-400" : isResult ? type === "final" ? "text-blue-700 dark:text-blue-300 text-base" : "text-green-700 dark:text-green-400" : "text-gray-800 dark:text-gray-200"}`}>
        {isDeduct ? `−\u2009${fmt(value)}` : fmt(value)}
      </span>
    </div>
  );
}

function ReconciliationFlow({ s }: { s: OverallSummary }) {
  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
          <BarChart3 size={14} className="text-blue-600" /> Daily Financial Reconciliation
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Step-by-step cash flow verification</p>
      </div>
      <div className="p-4 space-y-0">
        <RecRow label="Gross Billing" value={s.grossBilling} type="start" />
        <RecRow label="− Outstanding / Dues" value={s.outstanding} type="deduct" />
        <RecRow label="− Refunds & Cancellations" value={s.refundsAndCancellations} type="deduct"
          note={`₹${s.refundAmount.toFixed(0)} refunds + ₹${s.cancelledAmount.toFixed(0)} cancelled`} />
        <RecRow label="− Cash Expenses" value={s.totalExpenses} type="deduct" />
        <div className="my-2 border-t-2 border-green-200 dark:border-green-800" />
        <RecRow label="= Net Collection" value={s.netCollection} type="result" />
        <div className="my-2 border-t border-dashed border-gray-200 dark:border-gray-700" />
        <RecRow label="− Digital Collection" value={s.digitalCollection} type="deduct" />
        <div className="my-2 border-t-2 border-blue-200 dark:border-blue-800" />
        <RecRow label="= Physical Cash in Hand" value={s.physicalCashInHand} type="final" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 p-2.5 text-center">
            <p className="text-xs text-violet-700 dark:text-violet-400 font-semibold uppercase tracking-wide">Digital</p>
            <p className="text-base font-bold text-violet-800 dark:text-violet-200">{fmt(s.digitalCollection)}</p>
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-2.5 text-center">
            <p className="text-xs text-blue-700 dark:text-blue-400 font-semibold uppercase tracking-wide">Physical Cash</p>
            <p className="text-base font-bold text-blue-800 dark:text-blue-200">{fmt(s.physicalCashInHand)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Control Logs ─────────────────────────────────────────────────────────────

type ControlLogTab = "bill-edits" | "cancellations" | "refunds";

function ControlLogs({ data }: { data: DailySummaryData | undefined }) {
  const [tab, setTab] = useState<ControlLogTab>("bill-edits");
  if (!data) return null;

  const billEdits = data.billEdits ?? [];
  const voucherEdits = data.voucherEdits ?? [];
  const allEdits = [
    ...billEdits.map((e) => ({ ...e, source: "Bill" as const })),
    ...voucherEdits.map((e) => ({ id: e.id, billId: 0, billNumber: "—", editedBy: e.editedBy, reason: e.reason, changeType: "", oldValue: null as null, newValue: null as null, createdAt: e.createdAt, source: "Voucher" as const })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const cancellations = data.cancelledBillsDetail ?? [];
  const refunds = data.refunds ?? [];
  const totalLogs = allEdits.length + cancellations.length + refunds.length;

  if (totalLogs === 0) return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-5 text-sm text-gray-500 text-center">
      No edits, cancellations, or refunds today.
    </div>
  );

  const tabs: { id: ControlLogTab; label: string; count: number }[] = [
    { id: "bill-edits", label: "Bill & Voucher Edits", count: allEdits.length },
    { id: "cancellations", label: "Cancellations", count: cancellations.length },
    { id: "refunds", label: "Refunds", count: refunds.length },
  ];

  return (
    <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-card-border">
        <h3 className="text-sm font-bold text-gray-900 dark:text-foreground flex items-center gap-2">
          <FileEdit size={14} className="text-purple-600" /> Control Logs
          <span className="text-xs font-normal text-gray-500 ml-1">— today's document activity</span>
        </h3>
      </div>
      <div className="flex border-b border-gray-100 dark:border-card-border">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-foreground"}`}>
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === t.id ? "bg-primary/10 text-primary" : "bg-gray-100 dark:bg-muted text-gray-600"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-card-border max-h-72 overflow-y-auto">
        {tab === "bill-edits" && (allEdits.length === 0
          ? <p className="px-4 py-6 text-sm text-gray-500 text-center">No edits today.</p>
          : allEdits.map((e, i) => (
            <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
              <FileEdit size={13} className="mt-0.5 text-purple-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${e.source === "Voucher" ? "bg-indigo-100 text-indigo-700" : "bg-purple-100 text-purple-700"}`}>{e.source}</span>
                  {e.billNumber && e.billNumber !== "—" && (
                    <Link href={`/billing/${e.billId}`} className="text-xs font-semibold text-primary hover:underline">{e.billNumber}</Link>
                  )}
                  <span className="text-xs text-gray-700 dark:text-gray-300 font-semibold">{e.editedBy}</span>
                  <span className="text-[10px] text-gray-500">{fmtTime(e.createdAt)}</span>
                </div>
                {e.reason && <p className="text-xs text-gray-500 mt-0.5 truncate">{e.reason}</p>}
              </div>
            </div>
          ))
        )}
        {tab === "cancellations" && (cancellations.length === 0
          ? <p className="px-4 py-6 text-sm text-gray-500 text-center">No cancellations today.</p>
          : cancellations.map((c, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
              <XCircle size={13} className="text-rose-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-800 dark:text-foreground">{c.patientName}</span>
                  <span className="text-xs text-gray-500">by {c.createdByName}</span>
                  <span className="text-[10px] text-gray-500">{fmtTime(c.cancelledAt)}</span>
                </div>
                <p className="text-xs text-rose-600 font-semibold">{fmt(c.totalAmount)}</p>
              </div>
            </div>
          ))
        )}
        {tab === "refunds" && (refunds.length === 0
          ? <p className="px-4 py-6 text-sm text-gray-500 text-center">No refunds today.</p>
          : refunds.map((r, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-muted/20">
              <RotateCcw size={13} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/billing/${r.billId}`} className="text-xs font-semibold text-primary hover:underline">Bill #{r.billId}</Link>
                  <span className="text-xs text-gray-500">by {r.recordedByName}</span>
                  <span className="text-[10px] text-gray-500">{fmtTime(r.createdAt)}</span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">{fmt(Math.abs(r.amount))} via {r.method}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats-raw"],
    queryFn: () => api.get("/api/reports/dashboard"),
  });
  const { data: revenue } = useGetRevenueReport({ period: "monthly" });
  const { data: _popular } = useGetPopularTests();

  const [from, setFrom] = useState<string>(daysAgoISO(6));
  const [to, setTo] = useState<string>(todayISO());

  const { data: rangeData, isFetching: rangeLoading } = useQuery<IncomeExpensePayload>({
    queryKey: ["dashboard-income-expense", from, to],
    queryFn: () => api.get(`/api/reports/income-expense?from=${from}&to=${to}`),
  });

  const { data: advanced, isFetching: advancedLoading, refetch: refetchAdv } = useQuery<AdvancedSummary>({
    queryKey: ["dashboard-advanced", from, to],
    queryFn: () => api.get(`/api/dashboard/advanced-summary?from=${from}&to=${to}`),
    placeholderData: (prev) => prev,
  });

  const { data: todayData } = useQuery<DailySummaryData>({
    queryKey: ["daily-summary-today-dash"],
    queryFn: () => api.get(`/api/daily-summary?date=${todayISO()}`),
    staleTime: 2 * 60_000,
  });

  const rangeTotals = useMemo(() => {
    if (!rangeData) return { income: 0, expense: 0, net: 0, days: 0 };
    const t = rangeData.totals ?? { income: 0, expense: 0, net: 0 };
    return {
      income: t.income ?? 0,
      expense: t.expense ?? 0,
      net: t.net ?? (t.income - t.expense),
      days: rangeData.rows?.length ?? 0,
    };
  }, [rangeData]);

  const chartRows = useMemo(
    () => (rangeData?.rows ?? []).map((r) => ({ date: r.date, income: r.income?.total ?? 0, expense: r.expense?.amount ?? 0 })),
    [rangeData],
  );

  const setPreset = (days: number) => {
    setFrom(daysAgoISO(days - 1));
    setTo(todayISO());
  };

  // Derived values — computed before any early return so hooks stay unconditional
  const staffRows = advanced?.staffComparison ?? [];
  const modalityRows = advanced?.modalitySummary ?? [];
  const alertRows = advanced?.alerts ?? [];
  const overallSummary = advanced?.overallSummary;

  const exportConfig = useMemo<ExportConfig | null>(() => {
    if (!overallSummary) return null;
    const inr = (n: number) =>
      new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    return {
      title: "Dashboard — Financial Report",
      subtitle: from === to ? from : `${from} to ${to}`,
      sections: [
        {
          title: "Financial Summary",
          metrics: [
            ["Gross Billing", inr(overallSummary.grossBilling)],
            ["Net Collection", inr(overallSummary.netCollection)],
            ["Physical Cash in Hand", inr(overallSummary.physicalCashInHand)],
            ["Digital Collection", inr(overallSummary.digitalCollection)],
            ["Outstanding / Dues", inr(overallSummary.outstanding)],
            ["Refunds & Cancellations", inr(overallSummary.refundsAndCancellations)],
            ["Cash Expenses", inr(overallSummary.totalExpenses)],
            ["Discounts Given", inr(overallSummary.discountsGiven)],
            ["Pending Reports", String(overallSummary.pendingReports)],
          ],
        },
      ],
      tables: [
        ...(staffRows.length > 0 ? [{
          title: "Staff Comparison",
          headers: ["Staff", "Bills", "Total Billing", "Received", "Cash", "Digital", "Discounts", "Cancels", "Net Cash"],
          rows: staffRows.map((r) => [r.staffName, r.billCount, inr(r.totalBilling), inr(r.totalReceived), inr(r.cashCollection), inr(r.digitalCollection), inr(r.discountsGiven), r.cancellationCount, inr(r.netCashHandled)]),
        }] : []),
        ...(modalityRows.length > 0 ? [{
          title: "Modality Summary",
          headers: ["Modality", "Tests", "Gross Billing", "Completed", "Pending"],
          rows: modalityRows.map((r) => [r.modality, r.testCount, inr(r.grossBilling), r.completedReports, r.pendingReports]),
        }] : []),
      ],
    };
  }, [overallSummary, staffRows, modalityRows, from, to]);

  if (statsLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
          </div>
          <div className="h-48 bg-muted rounded-xl" />
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="h-64 bg-muted rounded-xl" />
            <div className="h-64 bg-muted rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const recentBills = (stats as any)?.recentBills ?? [];
  const overdueAlerts = (stats as any)?.overdueAlerts ?? [];
  const totalBills = Number((stats as any)?.totalBills ?? 0);
  const pendingReports = Number((stats as any)?.pendingReports ?? 0);
  const todayBillCount = Number((stats as any)?.todayBills ?? 0);
  const allPendingDues = Number((stats as any)?.pendingPayments ?? 0);
  const monthRevenue = Number((stats as any)?.monthRevenue ?? 0);

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboard"
        subtitle="Care Diagnostics Overview"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <SummaryExportToolbar config={exportConfig} emailEndpoint="/api/dashboard/my-daily-summary/send-email" />
            <button
              onClick={() => { void refetchAdv(); }}
              className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        }
      />

      <div className="px-4 xl:px-6 space-y-5">

        {/* ── KPI cards (5 columns on xl) ─────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <KpiCard
            icon={IndianRupee}
            label="Today's Revenue"
            value={fmt((stats as any)?.todayRevenue ?? 0)}
            sub={`Month total: ${fmt(monthRevenue)}`}
            iconBg="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
            accentBorder="border-l-violet-500"
          />
          <KpiCard
            icon={TrendingUp}
            label="Monthly Revenue"
            value={fmt(monthRevenue)}
            sub={`${todayBillCount} bills today`}
            iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            accentBorder="border-l-emerald-500"
          />
          <KpiCard
            icon={FileText}
            label="Total Bills"
            value={totalBills}
            sub={`${todayBillCount} new today`}
            iconBg="bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400"
            accentBorder="border-l-cyan-500"
          />
          <KpiCard
            icon={AlertCircle}
            label="Pending Dues"
            value={fmt(allPendingDues)}
            sub="Outstanding balance"
            iconBg={
              Number(allPendingDues) > 0
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 animate-pulse"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            }
            accentBorder={Number(allPendingDues) > 0 ? "border-l-red-500" : "border-l-emerald-500"}
            cardClass={Number(allPendingDues) > 0 ? "ring-1 ring-red-300 dark:ring-red-900/60" : ""}
          />
          <KpiCard
            icon={ClipboardList}
            label="Pending Reports"
            value={pendingReports}
            sub="Awaiting completion"
            iconBg="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            accentBorder={pendingReports > 0 ? "border-l-amber-500" : "border-l-gray-300"}
          />
        </div>

        {/* ── Date range filter ───────────────────────────────────────────── */}
        <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2 mr-1">
              <Calendar size={15} className="text-primary" />
              <span className="font-bold text-sm text-gray-900 dark:text-foreground">Date Range</span>
            </div>
            <div>
              <Label className="text-xs text-gray-600">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-8 w-40 text-sm" />
            </div>
            <div>
              <Label className="text-xs text-gray-600">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-8 w-40 text-sm" />
            </div>
            <div className="flex gap-1 ml-auto">
              {[["Today", 1], ["7d", 7], ["30d", 30], ["90d", 90]].map(([label, days]) => (
                <Button key={label} size="sm" variant="outline" onClick={() => setPreset(Number(days))} className="h-8 text-xs px-3 font-semibold text-gray-700">{label}</Button>
              ))}
            </div>
            {advancedLoading && <span className="text-xs text-gray-500 animate-pulse ml-2">Updating…</span>}
          </div>

          {/* Financial summary totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-bold">Income</div>
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-200">{fmt(rangeTotals.income)}</div>
            </div>
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <div className="text-[11px] uppercase tracking-wider text-rose-700 dark:text-rose-300 font-bold">Expenses</div>
              <div className="text-xl font-bold text-rose-700 dark:text-rose-200">{fmt(rangeTotals.expense)}</div>
            </div>
            <div className={`p-3 rounded-lg border ${rangeTotals.net >= 0 ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"}`}>
              <div className={`text-[11px] uppercase tracking-wider font-bold ${rangeTotals.net >= 0 ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"}`}>Net</div>
              <div className={`text-xl font-bold ${rangeTotals.net >= 0 ? "text-blue-700 dark:text-blue-200" : "text-amber-700 dark:text-amber-200"}`}>{fmt(rangeTotals.net)}</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-muted/40 border border-gray-200 dark:border-card-border">
              <div className="text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-400 font-bold">Days</div>
              <div className="text-xl font-bold text-gray-900 dark:text-foreground">{rangeTotals.days}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{rangeLoading ? "Loading…" : `${from} → ${to}`}</div>
            </div>
          </div>

          {/* Income vs Expense bar chart */}
          {chartRows.length > 0 && (
            <div className="h-44 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows}>
                  <defs>
                    <linearGradient id="incomeBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(252 90% 62%)" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(230 80% 52%)" stopOpacity={0.82} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#374151", fontWeight: 500 }} />
                  <YAxis tick={{ fontSize: 10, fill: "#374151" }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number, n: string) => [fmt(v), n === "income" ? "Income" : "Expense"]} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", color: "#111827" }} />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "#374151" }} />
                  <Bar dataKey="income" fill="url(#incomeBarGrad)" name="Income" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expense" fill="#f43f5e" name="Expense" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Operational chips ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Patients", value: (stats as any)?.totalPatients ?? 0, icon: Users, color: "text-cyan-700 dark:text-cyan-400", accent: "border-l-cyan-400" },
            { label: "Today's Orders", value: (stats as any)?.todayOrders ?? 0, icon: ClipboardList, color: "text-violet-700 dark:text-violet-400", accent: "border-l-violet-400" },
            { label: "Completed Tests", value: (stats as any)?.completedTests ?? 0, icon: TrendingUp, color: "text-green-700 dark:text-green-400", accent: "border-l-green-400" },
            { label: "Pending Orders", value: (stats as any)?.pendingOrders ?? 0, icon: AlertTriangle, color: "text-amber-600 dark:text-amber-400", accent: "border-l-amber-400" },
          ].map(({ label, value, icon: Icon, color, accent }) => (
            <div key={label} className={`bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-lg px-4 py-2.5 flex items-center gap-3 shadow-sm border-l-4 ${accent}`}>
              <Icon size={15} className={color} />
              <div>
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">{label}</p>
                <p className="text-base font-bold text-gray-900 dark:text-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Quick actions + Monthly Revenue ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-2.5">
            <h3 className="text-sm font-bold text-gray-900 dark:text-foreground">Quick Actions</h3>
            <QuickActionCard icon={Plus} label="New Bill" description="Generate a bill for a completed order" href="/billing" color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
            <QuickActionCard icon={Users} label="Register Patient" description="Add a new patient to the system" href="/patients" color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
            <QuickActionCard icon={BarChart3} label="Daily Summary" description="View today's detailed financial report" href="/daily-summary" color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
            <QuickActionCard icon={Package} label="Test Catalog" description="Manage diagnostic test inventory" href="/tests" color="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" />
            <QuickActionCard icon={ShieldAlert} label="Reconciliation Center" description="All open financial & operational exceptions" href="/reconciliation" color="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" />
            {overdueAlerts.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-500" />
                  <span className="text-xs font-bold text-gray-800 dark:text-foreground">Outstanding Alerts</span>
                  <span className="ml-auto px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full text-[10px] font-bold">{overdueAlerts.length}</span>
                </div>
                {overdueAlerts.map((alert: { billNumber: string; balanceAmount: number }) => (
                  <div key={alert.billNumber} className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 truncate">{alert.billNumber}</span>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400 flex-shrink-0">{fmt(alert.balanceAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {overdueAlerts.length === 0 && (
              <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/40 rounded-lg px-3 py-2.5 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">No outstanding balance alerts</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 dark:text-foreground">Monthly Revenue</h3>
              {revenue && <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">{fmt(revenue.totalRevenue ?? 0)} total</span>}
            </div>
            {revenue?.data && revenue.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={revenue.data} margin={{ top: 0, right: 0, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueBarGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(252 90% 62%)" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(230 80% 52%)" stopOpacity={0.85} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#374151", fontWeight: 500 }} />
                  <YAxis tick={{ fontSize: 10, fill: "#374151" }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [fmt(v), "Revenue"]} contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", color: "#111827" }} />
                  <Bar dataKey="revenue" fill="url(#revenueBarGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[210px] flex items-center justify-center text-sm text-gray-500">No revenue data yet</div>
            )}
          </div>
        </div>

        {/* ── Financial Reconciliation + Control Logs ──────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {overallSummary ? (
            <ReconciliationFlow s={overallSummary} />
          ) : (
            <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl p-6 text-sm text-gray-400 text-center">
              Loading reconciliation…
            </div>
          )}
          <ControlLogs data={todayData} />
        </div>

        {/* ── Advanced analytics — 2-column on wide screens ───────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ModalitySection rows={modalityRows} />
          <StaffComparisonSection rows={staffRows} />
        </div>

        {/* ── Control alerts ───────────────────────────────────────────────── */}
        {alertRows.length > 0 && <AlertsStrip alerts={alertRows} />}

        {/* ── Recent Transactions ──────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-bold text-gray-900 dark:text-foreground">Recent Transactions</h3>
            <Link href="/billing" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
          </div>
          <div className="bg-white dark:bg-card border border-gray-200 dark:border-card-border rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs border-b border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/30">
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">Bill ID</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">Patient</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300 text-right">Amount</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300 text-right">Paid</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300 text-right">Balance</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">Date</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {recentBills.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">No bills generated yet</td>
                    </tr>
                  ) : (
                    recentBills.map((bill: {
                      id: number; billNumber: string; patientName: string; patientCode: string;
                      totalAmount: number; paidAmount: number; balanceAmount: number; status: string; createdAt: string;
                    }) => (
                      <tr key={bill.id} className="border-b border-gray-100 dark:border-border/50 last:border-0 hover:bg-gray-50 dark:hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-primary">{bill.billNumber}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-gray-900 dark:text-foreground">{bill.patientName}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{bill.patientCode}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-foreground tabular-nums">{fmt(bill.totalAmount)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-green-700 dark:text-green-400 tabular-nums">{fmt(bill.paidAmount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <span className={bill.balanceAmount > 0 ? "font-bold text-red-600 dark:text-red-400" : "text-gray-500"}>
                            {fmt(bill.balanceAmount)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                        <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">{new Date(bill.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/billing/bill/${bill.id}`} className="text-xs font-semibold text-primary hover:underline">Open</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
