import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SummaryExportToolbar } from "@/components/SummaryExport";
import type { ExportConfig } from "@/components/SummaryExport";
import { ChevronRight, IndianRupee, AlertCircle, FileText, Calendar, Phone, Search, X } from "lucide-react";

type Bill = {
  id: number;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  createdAt: string;
  dueDate: string | null;
  createdByName: string | null;
  patient: { id: number; firstName: string; lastName: string; patientId: string; phone: string } | null;
  order: {
    orderNumber: string;
    doctor: { name: string; specialization?: string | null } | null;
    tests: Array<{ test: { name: string } | null }>;
  } | null;
};

type DuesResponse = {
  bills: Bill[];
  total: number;
  page: number;
  limit: number;
  totals: { totalAmount: number; paidAmount: number; balanceAmount: number; refundAmount: number };
};

const today = () => new Date().toISOString().slice(0, 10);

export default function Dues() {
  const [dateFrom, setDateFrom] = useState<string>(today());
  const [dateTo, setDateTo] = useState<string>(today());
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const limit = 50;

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({
      dueOnly: "1",
      page: String(page),
      limit: String(limit),
    });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p.toString();
  }, [dateFrom, dateTo, page]);

  const { data, isLoading, isFetching, error } = useQuery<DuesResponse>({
    queryKey: ["dues", dateFrom, dateTo, page],
    queryFn: () => api.get(`/api/bills?${queryParams}`),
    placeholderData: (prev) => prev,
  });

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

  const setQuickRange = (kind: "today" | "week" | "month" | "last-month" | "all-time") => {
    const now = new Date();
    setPage(1);
    if (kind === "today") {
      const t = today();
      setDateFrom(t);
      setDateTo(t);
    } else if (kind === "week") {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      setDateFrom(start.toISOString().slice(0, 10));
      setDateTo(today());
    } else if (kind === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(start.toISOString().slice(0, 10));
      setDateTo(today());
    } else if (kind === "last-month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(start.toISOString().slice(0, 10));
      setDateTo(end.toISOString().slice(0, 10));
    } else {
      setDateFrom("");
      setDateTo("");
    }
  };

  const allBills = data?.bills ?? [];
  const totals = data?.totals;
  const totalCount = data?.total ?? 0;

  const lc = searchTerm.trim().toLowerCase();
  const bills = useMemo(() => {
    if (!lc) return allBills;
    return allBills.filter((b) => {
      const name = b.patient ? `${b.patient.firstName} ${b.patient.lastName}`.toLowerCase() : "";
      return (
        b.billNumber.toLowerCase().includes(lc) ||
        name.includes(lc) ||
        (b.patient?.patientId ?? "").toLowerCase().includes(lc) ||
        (b.patient?.phone ?? "").includes(lc)
      );
    });
  }, [allBills, lc]);

  const exportConfig = useMemo<ExportConfig | null>(() => {
    if (!bills.length && !totals) return null;
    const inr = (n: number) =>
      new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
    const rangeLabel = dateFrom && dateTo
      ? dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`
      : "All time";

    return {
      title: "Due Payments Report",
      subtitle: `${rangeLabel} • Bill Date filter`,
      sections: [
        {
          title: "Summary",
          metrics: [
            ["Bills with Dues", totalCount.toLocaleString("en-IN")],
            ["Total Billed", inr(totals?.totalAmount ?? 0)],
            ["Total Outstanding", inr(totals?.balanceAmount ?? 0)],
            ["Total Collected", inr(totals?.paidAmount ?? 0)],
          ],
        },
      ],
      tables: [
        {
          title: "Outstanding Bills",
          headers: ["Bill #", "Patient", "Phone", "Referral Doctor", "Tests", "Bill Date", "Billed By", "Total", "Paid", "Balance", "Status"],
          rows: bills
            .filter((b) => b.status !== "cancelled")
            .map((b) => {
              const patientName = b.patient ? `${b.patient.firstName} ${b.patient.lastName}` : "—";
              const testNames = b.order?.tests
                .map((t) => t.test?.name ?? "")
                .filter(Boolean)
                .join(", ") ?? "—";
              const doctorName = b.order?.doctor?.name ?? "—";
              return [
                b.billNumber,
                patientName,
                b.patient?.phone ?? "—",
                doctorName,
                testNames || "—",
                new Date(b.createdAt).toLocaleDateString("en-IN"),
                b.createdByName ?? "—",
                inr(b.totalAmount),
                inr(b.paidAmount),
                inr(b.balanceAmount),
                b.status,
              ];
            }),
        },
      ],
    };
  }, [bills, totals, totalCount, dateFrom, dateTo]);

  const NUM_COLS = 10;

  return (
    <div className="pb-8">
      <PageHeader
        title="Due Payments"
        subtitle="Outstanding dues with date-range filter"
        actions={
          <SummaryExportToolbar config={exportConfig} emailEndpoint="/api/dashboard/my-daily-summary/send-email" />
        }
      />

      <div className="px-6 space-y-5">
        {/* Filter bar */}
        <div className="bg-card border border-card-border rounded-xl shadow-sm p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="mt-1 w-40"
              />
            </div>
            <div>
              <Label className="text-xs">To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="mt-1 w-40"
              />
            </div>
            <div className="flex flex-col">
              <Label className="text-xs">Quick Ranges</Label>
              <div className="flex gap-1 mt-1 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setQuickRange("today")}>Today</Button>
                <Button size="sm" variant="outline" onClick={() => setQuickRange("week")}>7 Days</Button>
                <Button size="sm" variant="outline" onClick={() => setQuickRange("month")}>This Month</Button>
                <Button size="sm" variant="outline" onClick={() => setQuickRange("last-month")}>Last Month</Button>
                <Button size="sm" variant="outline" onClick={() => setQuickRange("all-time")}>All</Button>
              </div>
            </div>
            <div className="flex-1 min-w-[220px]">
              <Label className="text-xs">Search</Label>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Patient name, ID, bill #, phone…"
                  className="w-full pl-8 pr-8 h-9 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
            {isFetching && (
              <div className="text-xs text-muted-foreground self-end pb-2">Refreshing…</div>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Bills with Dues"
            value={totalCount.toLocaleString("en-IN")}
            icon={<FileText size={20} />}
            tone="neutral"
          />
          <SummaryCard
            label="Total Billed"
            value={formatCurrency(totals?.totalAmount ?? 0)}
            icon={<IndianRupee size={20} />}
            tone="neutral"
          />
          <SummaryCard
            label="Total Outstanding"
            value={formatCurrency(totals?.balanceAmount ?? 0)}
            icon={<AlertCircle size={20} />}
            tone="danger"
          />
          <SummaryCard
            label="Total Refunded"
            value={formatCurrency(totals?.refundAmount ?? 0)}
            icon={<IndianRupee size={20} />}
            tone="warning"
          />
        </div>

        {/* Results */}
        <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-3 font-medium">Bill No.</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Referral Doctor</th>
                  <th className="px-4 py-3 font-medium">Tests</th>
                  <th className="px-4 py-3 font-medium">Bill Date</th>
                  <th className="px-4 py-3 font-medium">Billed By</th>
                  <th className="px-4 py-3 font-medium text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                  <th className="px-4 py-3 font-medium text-right">Due Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr><td colSpan={NUM_COLS} className="px-4 py-12 text-center text-red-600">{(error as Error).message}</td></tr>
                ) : isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(NUM_COLS)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>)}
                    </tr>
                  ))
                ) : bills.length === 0 ? (
                  <tr><td colSpan={NUM_COLS} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Calendar size={28} />
                      <p className="text-sm">No outstanding dues in this period</p>
                      <p className="text-xs">Try widening the date range or switching the date type.</p>
                    </div>
                  </td></tr>
                ) : (
                  bills.map((b) => {
                    const isCancelled = b.status === "cancelled";
                    const displayBalance = isCancelled ? 0 : b.balanceAmount;
                    const testNames = b.order?.tests
                      .map((t) => t.test?.name)
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs font-medium text-primary whitespace-nowrap">{b.billNumber}</td>
                        <td className="px-4 py-3">
                          {b.patient ? (
                            <div>
                              <div className="font-medium">{b.patient.firstName} {b.patient.lastName}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-2">
                                <span>{b.patient.patientId}</span>
                                {b.patient.phone && (
                                  <a href={`tel:${b.patient.phone}`} className="inline-flex items-center gap-0.5 hover:text-primary" title="Call">
                                    <Phone size={10} /> {b.patient.phone}
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {b.order?.doctor
                            ? <div>
                                <div className="font-medium">{b.order.doctor.name}</div>
                                {b.order.doctor.specialization && (
                                  <div className="text-muted-foreground">{b.order.doctor.specialization}</div>
                                )}
                              </div>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[200px]">
                          {testNames
                            ? <span title={testNames} className="line-clamp-2">{testNames}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(b.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <span className="font-medium">{b.createdByName ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">{formatCurrency(b.totalAmount)}</td>
                        <td className="px-4 py-3 text-right text-green-600 dark:text-green-400 font-medium whitespace-nowrap">{formatCurrency(b.paidAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{formatCurrency(displayBalance)}</td>
                        <td className="px-4 py-3">{isCancelled ? <span className="text-xs text-muted-foreground">—</span> : <StatusBadge status={b.status} />}</td>
                        <td className="px-4 py-3">
                          <Link href={`/billing/${b.id}`} className="text-muted-foreground hover:text-foreground inline-flex p-1 rounded hover:bg-muted" title="Open bill">
                            <ChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {bills.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold text-sm">
                    <td className="px-4 py-3" colSpan={5}>Page Subtotal ({bills.length} of {totalCount})</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(bills.reduce((s, b) => s + b.totalAmount, 0))}</td>
                    <td className="px-4 py-3 text-right text-green-600 dark:text-green-400">{formatCurrency(bills.reduce((s, b) => s + b.paidAmount, 0))}</td>
                    <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">{formatCurrency(bills.reduce((s, b) => s + (b.status === "cancelled" ? 0 : b.balanceAmount), 0))}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {totalCount > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, totalCount)} of {totalCount}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * limit >= totalCount} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, tone }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "neutral" | "danger" | "warning";
}) {
  const toneClasses =
    tone === "danger"
      ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
      : tone === "warning"
        ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
        : "bg-card border-card-border";
  return (
    <div className={`border rounded-xl p-5 shadow-sm ${toneClasses}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide font-medium opacity-70">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className="opacity-60">{icon}</div>
      </div>
    </div>
  );
}
