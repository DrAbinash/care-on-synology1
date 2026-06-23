import { useState } from "react";
import {
  useGetRevenueReport,
  useGetPopularTests,
  useGetDashboardStats,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
// Module A (compliance): commission report query removed — moved to Super Admin Portal.
import PageHeader from "@/components/PageHeader";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TrendingUp, FlaskConical, Sparkles, RefreshCw, CalendarDays, ArrowUpDown, CreditCard, ChevronDown, ChevronUp, Download, Truck } from "lucide-react";

// Module A (compliance): Commission tab removed — moved to Super Admin Portal.
const TABS = [
  { id: "overview",         label: "Overview",        icon: TrendingUp },
  { id: "tests",            label: "Test Analysis",    icon: FlaskConical },
  { id: "daily",            label: "Daily Report",     icon: CalendarDays },
  { id: "income-expense",   label: "Income / Expense", icon: ArrowUpDown },
  { id: "payment-methods",  label: "Payment Methods",  icon: CreditCard },
  { id: "outsourced",       label: "Outsourced Labs",  icon: Truck },
  { id: "ai",               label: "AI Insights",      icon: Sparkles },
];

// ── Types for new report endpoints ────────────────────────────────────────────
type IncomeExpenseRow = {
  date: string;
  income: { date: string; cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number; total: number };
  expense: { date: string; amount: number; count: number };
  net: number;
};
type IncomeExpenseUserRow = {
  userName: string;
  count: number;
  total: number;
  cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number;
};
type IncomeExpenseData = {
  rows: IncomeExpenseRow[];
  totals: { income: number; expense: number; net: number; cash: number; upi: number; card: number; bank: number; insurance: number; cheque: number };
  byUser?: IncomeExpenseUserRow[];
};
type PaymentMethodData = {
  methods: { method: string; count: number; total: number; percentage: number; transactions: { id: number; date: string; time: string; amount: number; billNumber: string; patientName: string; reference: string }[] }[];
  grandTotal: number;
};
type DailyUserRow = {
  userName: string;
  billCount: number;
  billed: number;
  received: number;
  methods: Record<string, number>;
};
type DailySummaryData = {
  date: string;
  summary: { totalBilled: number; totalReceived: number; outstanding: number; billCount: number; orderCount: number };
  byMethod: Record<string, number>;
  billsByStatus: { paid: number; partial: number; pending: number; cancelled: number };
  byUser?: DailyUserRow[];
  totalExpense?: number;
  grandTotal?: number;
  bills: { id: number; billNumber: string; patientName: string; totalAmount: number; paidAmount: number; status: string; createdAt: string; createdByName?: string }[];
};

export default function Reports() {
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get("tab") || "daily");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [dailyDate, setDailyDate] = useState(() => searchParams.get("date") || new Date().toISOString().split("T")[0]);
  const [expandedMethod, setExpandedMethod] = useState<string | null>(null);
  const [outsourceDateFrom, setOutsourceDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [outsourceDateTo, setOutsourceDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: revenue } = useGetRevenueReport({ period });
  const { data: popular } = useGetPopularTests();
  const { data: stats } = useGetDashboardStats();

  const { data: incomeExpenseData, isLoading: loadingIE } = useQuery<IncomeExpenseData>({
    queryKey: ["income-expense", dateFrom, dateTo],
    queryFn: () => api.get(`/api/reports/income-expense?from=${dateFrom}&to=${dateTo}`),
    enabled: activeTab === "income-expense",
  });

  const { data: paymentMethodData, isLoading: loadingPM } = useQuery<PaymentMethodData>({
    queryKey: ["payment-methods", dateFrom, dateTo],
    queryFn: () => api.get(`/api/reports/payment-methods?from=${dateFrom}&to=${dateTo}`),
    enabled: activeTab === "payment-methods",
  });

  const { data: dailySummaryData, isLoading: loadingDaily } = useQuery<DailySummaryData>({
    queryKey: ["daily-summary", dailyDate],
    queryFn: () => api.get(`/api/reports/daily-summary?date=${dailyDate}`),
    enabled: activeTab === "daily",
  });
  const todayBills = dailySummaryData?.summary.billCount ?? 0;

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  const inr2 = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const METHOD_COLORS: Record<string, string> = {
    cash: "#16a34a", upi: "#2563eb", card: "#7c3aed",
    bank_transfer: "#0891b2", insurance: "#ea580c", cheque: "#d97706",
  };
  const methodLabel = (m: string) =>
    ({ cash: "Cash", upi: "UPI", card: "Card", bank_transfer: "Bank Transfer", insurance: "Insurance", cheque: "Cheque" })[m] ?? m.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const downloadDailyPdf = () => {
    window.open(`/api/reports/daily-summary/pdf?date=${dailyDate}`, "_blank");
  };

  return (
    <div className="pb-8">
      <PageHeader title="Reports & Analytics" subtitle="Financial and operational insights" />

      <div className="px-6">
        {/* Tab Nav */}
        <div className="flex gap-1 bg-muted p-1 rounded-xl mb-6 w-fit">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all
                  ${activeTab === tab.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Patients", value: stats?.totalPatients ?? 0, fmt: (n: number) => n.toLocaleString() },
                { label: "Completed Orders", value: stats?.completedTests ?? 0, fmt: (n: number) => n.toLocaleString() },
                { label: "Month Revenue", value: stats?.monthRevenue ?? 0, fmt: formatCurrency },
                { label: "Pending Payments", value: stats?.pendingPayments ?? 0, fmt: formatCurrency },
              ].map((card) => (
                <div key={card.label} className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{card.label}</p>
                  <p className="mt-1.5 text-xl font-bold text-foreground">{card.fmt(card.value)}</p>
                </div>
              ))}
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Revenue Trend</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Total: {formatCurrency(revenue?.totalRevenue ?? 0)} · {revenue?.totalOrders ?? 0} transactions
                  </p>
                </div>
                <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {revenue?.data && revenue.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={revenue.data} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(v: number, name: string) => [name === "revenue" ? formatCurrency(v) : v, name === "revenue" ? "Revenue" : "Orders"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Legend formatter={(v) => v === "revenue" ? "Revenue" : "Orders"} />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">No revenue data for this period</div>
              )}
            </div>
          </div>
        )}

        {/* Test Analysis Tab */}
        {activeTab === "tests" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-4">Top Tests by Orders</h3>
              {popular?.tests && popular.tests.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={popular.tests.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis dataKey="testCode" type="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={60} />
                    <Tooltip
                      formatter={(v: number) => [v, "Orders"]}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                    />
                    <Bar dataKey="orderCount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">No test data yet</div>
              )}
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-4">Test Revenue Breakdown</h3>
              {popular?.tests && popular.tests.length > 0 ? (
                <div className="overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="pb-2 font-medium">Test</th>
                        <th className="pb-2 font-medium text-center">Orders</th>
                        <th className="pb-2 font-medium text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {popular.tests.map((t) => (
                        <tr key={t.testId} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5">
                            <div className="font-medium text-foreground truncate max-w-[160px]">{t.testName}</div>
                            <div className="text-xs text-muted-foreground">{t.category}</div>
                          </td>
                          <td className="py-2.5 text-center font-medium">{t.orderCount}</td>
                          <td className="py-2.5 text-right font-semibold text-green-600 dark:text-green-400">{formatCurrency(t.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">No test data yet</div>
              )}
            </div>
          </div>
        )}

        {/* ── Daily Report Tab ─────────────────────────────────────────────── */}
        {activeTab === "daily" && (
          <div className="space-y-5">
            <div className="flex items-end gap-3">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)} className="mt-1 w-40" />
              </div>
              <Button variant="outline" onClick={downloadDailyPdf} className="h-9">
                <Download size={14} className="mr-1" /> PDF
              </Button>
            </div>
            {loadingDaily ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : !dailySummaryData ? (
              <div className="text-center py-12 text-muted-foreground">No data</div>
            ) : (
              <div className="space-y-5">

                {/* ── MAIN: User-wise breakdown — prominent, matches handwritten report ── */}
                <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Daily Report — {new Date(dailySummaryData.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Staff-wise collection breakdown</p>
                    </div>
                    <span className="text-xs text-muted-foreground">Bills: {todayBills}</span>
                  </div>
                  {dailySummaryData.byUser && dailySummaryData.byUser.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">#</th>
                            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Staff</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-blue-600">UPI</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-purple-600">Card</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-green-700">Cash</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-foreground border-l border-card-border">Total</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-orange-600">Expense</th>
                            <th className="text-right px-4 py-2.5 text-xs font-semibold text-green-600">Grand Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailySummaryData.byUser.map((u, i) => (
                            <tr key={u.userName} className="border-t border-card-border hover:bg-muted/20">
                              <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                              <td className="px-4 py-2.5 font-semibold">{u.userName}</td>
                              <td className="px-4 py-2.5 text-right text-blue-600">{inr2(u.methods.upi || 0)}</td>
                              <td className="px-4 py-2.5 text-right text-purple-600">{inr2((u.methods.card || 0) + (u.methods.credit_card || 0) + (u.methods.debit_card || 0))}</td>
                              <td className="px-4 py-2.5 text-right text-green-700">{inr2(u.methods.cash || 0)}</td>
                              <td className="px-4 py-2.5 text-right font-semibold border-l border-card-border">{inr2(u.received)}</td>
                              <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">—</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-green-600">{inr2(u.received)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-foreground/30 bg-muted/40">
                          <tr>
                            <td className="px-4 py-2.5 text-xs font-bold" colSpan={2}>TOTAL</td>
                            <td className="px-4 py-2.5 text-right font-bold text-blue-600">
                              {inr2(dailySummaryData.byUser.reduce((s, u) => s + (u.methods.upi || 0), 0))}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-purple-600">
                              {inr2(dailySummaryData.byUser.reduce((s, u) => s + (u.methods.card || 0) + (u.methods.credit_card || 0) + (u.methods.debit_card || 0), 0))}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-green-700">
                              {inr2(dailySummaryData.byUser.reduce((s, u) => s + (u.methods.cash || 0), 0))}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold border-l border-card-border">
                              {inr2(dailySummaryData.summary.totalReceived)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-orange-600">
                              {dailySummaryData.totalExpense != null ? inr2(dailySummaryData.totalExpense) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-green-600">
                              {dailySummaryData.grandTotal != null ? inr2(dailySummaryData.grandTotal) : inr2(dailySummaryData.summary.totalReceived)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">No bills recorded for this date</div>
                  )}
                </div>

                {/* KPI summary row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Billed", value: inr2(dailySummaryData.summary.totalBilled), color: "text-foreground" },
                    { label: "Collected", value: inr2(dailySummaryData.summary.totalReceived), color: "text-green-600" },
                    { label: "Outstanding", value: inr2(dailySummaryData.summary.outstanding), color: "text-red-500" },
                    { label: "Expense", value: dailySummaryData.totalExpense != null ? inr2(dailySummaryData.totalExpense) : "—", color: "text-orange-500" },
                  ].map(c => (
                    <div key={c.label} className="bg-card border border-card-border rounded-xl p-4">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Bills Table */}
                {dailySummaryData.bills.length > 0 && (
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-card-border">
                      <h3 className="text-sm font-semibold">Bill Ledger — {dailySummaryData.date}</h3>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">Bill #</th>
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">Patient</th>
                          <th className="text-right px-4 py-2 text-xs text-muted-foreground">Billed</th>
                          <th className="text-right px-4 py-2 text-xs text-muted-foreground">Paid</th>
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-2 text-xs text-muted-foreground">By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailySummaryData.bills.map(b => (
                          <tr key={b.id} className="border-t border-card-border hover:bg-muted/20">
                            <td className="px-4 py-2 font-mono text-xs">{b.billNumber}</td>
                            <td className="px-4 py-2">{b.patientName}</td>
                            <td className="px-4 py-2 text-right">{inr2(b.totalAmount)}</td>
                            <td className="px-4 py-2 text-right text-green-600">{inr2(b.paidAmount)}</td>
                            <td className="px-4 py-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                b.status === "paid" ? "bg-green-100 text-green-700" :
                                b.status === "partial" ? "bg-amber-100 text-amber-700" :
                                b.status === "pending" ? "bg-red-100 text-red-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>{b.status}</span>
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">{b.createdByName || "—"}</td>
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

        {/* ── Income / Expense Tab ──────────────────────────────────────────── */}
        {activeTab === "income-expense" && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-40" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-40" />
              </div>
            </div>

            {loadingIE ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : !incomeExpenseData ? null : (
              <div className="space-y-5">
                {/* Totals */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Total Income", value: inr2(incomeExpenseData.totals.income), color: "text-green-600" },
                    { label: "Total Expense", value: inr2(incomeExpenseData.totals.expense), color: "text-red-500" },
                    { label: "Net", value: inr2(incomeExpenseData.totals.net), color: incomeExpenseData.totals.net >= 0 ? "text-green-600" : "text-red-500" },
                    { label: "Days with Activity", value: String(incomeExpenseData.rows.length), color: "text-foreground" },
                  ].map(c => (
                    <div key={c.label} className="bg-card border border-card-border rounded-xl p-4">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Method breakdown */}
                <div className="bg-card border border-card-border rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3">Income by Payment Method</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {["cash","upi","card","bank","insurance","cheque"].map(method => (
                      <div key={method} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg text-sm">
                        <span className="capitalize text-muted-foreground">{methodLabel(method)}</span>
                        <span className="font-semibold">{inr2((incomeExpenseData.totals as Record<string,number>)[method] ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Chart */}
                {incomeExpenseData.rows.length > 0 && (
                  <div className="bg-card border border-card-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-3">Daily Income vs Expense</h3>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={incomeExpenseData.rows.map(r => ({ date: r.date, Income: r.income.total, Expense: r.expense.amount, Net: r.net }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v: number) => inr2(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }} />
                        <Legend />
                        <Bar dataKey="Income" fill="#16a34a" radius={[3,3,0,0]} />
                        <Bar dataKey="Expense" fill="#dc2626" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Daily Table */}
                <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-card-border">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Cash</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">UPI</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Card</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Bank</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-green-600">Total Income</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-red-500">Expense</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeExpenseData.rows.map(row => (
                        <tr key={row.date} className="border-b border-card-border hover:bg-muted/20">
                          <td className="px-4 py-2.5 font-medium">{row.date}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{inr2(row.income.cash)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{inr2(row.income.upi)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{inr2(row.income.card)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{inr2(row.income.bank)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-green-600">{inr2(row.income.total)}</td>
                          <td className="px-4 py-2.5 text-right text-red-500">{row.expense.amount > 0 ? inr2(row.expense.amount) : "—"}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${row.net >= 0 ? "text-foreground" : "text-red-500"}`}>{inr2(row.net)}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/30 font-bold text-sm">
                        <td className="px-4 py-3">Total</td>
                        <td className="px-4 py-3 text-right">{inr2(incomeExpenseData.totals.cash)}</td>
                        <td className="px-4 py-3 text-right">{inr2(incomeExpenseData.totals.upi)}</td>
                        <td className="px-4 py-3 text-right">{inr2(incomeExpenseData.totals.card)}</td>
                        <td className="px-4 py-3 text-right">{inr2(incomeExpenseData.totals.bank)}</td>
                        <td className="px-4 py-3 text-right text-green-600">{inr2(incomeExpenseData.totals.income)}</td>
                        <td className="px-4 py-3 text-right text-red-500">{inr2(incomeExpenseData.totals.expense)}</td>
                        <td className={`px-4 py-3 text-right ${incomeExpenseData.totals.net >= 0 ? "" : "text-red-500"}`}>{inr2(incomeExpenseData.totals.net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* User-wise income breakdown — who collected how much */}
                {incomeExpenseData.byUser && incomeExpenseData.byUser.length > 0 && (
                  <div className="bg-card border border-card-border rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-card-border">
                      <h3 className="text-sm font-semibold">Income by User</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Payments collected by each staff member in this date range</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b border-card-border">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">User</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Txns</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Cash</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">UPI</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Card</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Bank</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-green-600">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incomeExpenseData.byUser.map(u => (
                          <tr key={u.userName} className="border-b border-card-border hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-medium">{u.userName}</td>
                            <td className="px-4 py-2.5 text-right">{u.count}</td>
                            <td className="px-4 py-2.5 text-right text-xs">{inr2(u.cash)}</td>
                            <td className="px-4 py-2.5 text-right text-xs">{inr2(u.upi)}</td>
                            <td className="px-4 py-2.5 text-right text-xs">{inr2(u.card)}</td>
                            <td className="px-4 py-2.5 text-right text-xs">{inr2(u.bank)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-green-600">{inr2(u.total)}</td>
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

        {/* ── Payment Methods Tab ───────────────────────────────────────────── */}
        {activeTab === "payment-methods" && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="mt-1 w-40" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="mt-1 w-40" />
              </div>
            </div>

            {loadingPM ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-xl" />)}</div>
            ) : !paymentMethodData ? null : (
              <div className="space-y-5">
                {/* Pie + summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="bg-card border border-card-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-3">Collection Mix</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={paymentMethodData.methods}
                          dataKey="total"
                          nameKey="method"
                          cx="50%" cy="50%"
                          outerRadius={90}
                          label={({ method, percentage }: { method: string; percentage: number }) => `${methodLabel(method)} ${percentage}%`}
                          labelLine={false}
                        >
                          {paymentMethodData.methods.map((m) => (
                            <Cell key={m.method} fill={METHOD_COLORS[m.method] ?? "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => inr2(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-card border border-card-border rounded-xl p-5">
                    <h3 className="text-sm font-semibold mb-3">By Method Summary</h3>
                    <div className="space-y-3">
                      {paymentMethodData.methods.map(m => (
                        <div key={m.method} className="flex items-center gap-3">
                          <div className="w-2 h-8 rounded-full" style={{ background: METHOD_COLORS[m.method] ?? "#94a3b8" }} />
                          <div className="flex-1">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{methodLabel(m.method)}</span>
                              <span className="font-bold">{inr2(m.total)}</span>
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                              <span>{m.count} transactions</span>
                              <span>{m.percentage}% of total</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-card-border flex justify-between font-bold">
                        <span>Grand Total</span>
                        <span>{inr2(paymentMethodData.grandTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Method-wise transaction tables */}
                <div className="space-y-3">
                  {paymentMethodData.methods.map(m => (
                    <div key={m.method} className="bg-card border border-card-border rounded-xl overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                        onClick={() => setExpandedMethod(expandedMethod === m.method ? null : m.method)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ background: METHOD_COLORS[m.method] ?? "#94a3b8" }} />
                          <span className="font-semibold text-sm">{methodLabel(m.method)}</span>
                          <span className="text-xs text-muted-foreground">{m.count} transactions</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-bold">{inr2(m.total)}</span>
                          {expandedMethod === m.method ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                      </button>
                      {expandedMethod === m.method && m.transactions.length > 0 && (
                        <div className="border-t border-card-border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left px-4 py-2 text-muted-foreground">Date</th>
                                <th className="text-left px-4 py-2 text-muted-foreground">Bill #</th>
                                <th className="text-left px-4 py-2 text-muted-foreground">Patient</th>
                                <th className="text-left px-4 py-2 text-muted-foreground">Ref</th>
                                <th className="text-right px-4 py-2 text-muted-foreground">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.transactions.slice(0, 50).map(t => (
                                <tr key={t.id} className="border-t border-card-border hover:bg-muted/10">
                                  <td className="px-4 py-1.5">{t.date} {t.time}</td>
                                  <td className="px-4 py-1.5 font-mono">{t.billNumber}</td>
                                  <td className="px-4 py-1.5">{t.patientName}</td>
                                  <td className="px-4 py-1.5 text-muted-foreground">{t.reference || "—"}</td>
                                  <td className="px-4 py-1.5 text-right font-medium">{inr2(t.amount)}</td>
                                </tr>
                              ))}
                              {m.transactions.length > 50 && (
                                <tr><td colSpan={5} className="px-4 py-2 text-center text-muted-foreground text-xs">+ {m.transactions.length - 50} more transactions</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Outsourced Labs Tab */}
        {activeTab === "outsourced" && (
          <OutsourcedReportTab dateFrom={outsourceDateFrom} dateTo={outsourceDateTo} setDateFrom={setOutsourceDateFrom} setDateTo={setOutsourceDateTo} />
        )}

        {/* AI Insights Tab */}
        {activeTab === "ai" && (
          <AIInsightsTab dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
        )}
      </div>
    </div>
  );
}

type OutsourcedSampleRow = {
  id: number; barcode: string; sampleType: string; status: string;
  outsourceLab: string | null; outsourceSentAt: string | null;
  outsourceExpectedAt: string | null; outsourceReceivedAt: string | null;
  outsourceTrackingId: string | null;
  patientName: string; orderNumber: string;
  tests: Array<{ testName: string; testCode: string }>;
};
type OutsourcedReportData = {
  rows: OutsourcedSampleRow[];
  byLab: Record<string, { sent: number; received: number; pending: number }>;
};

function OutsourcedReportTab({ dateFrom, dateTo, setDateFrom, setDateTo }: {
  dateFrom: string; dateTo: string;
  setDateFrom: (v: string) => void; setDateTo: (v: string) => void;
}) {
  const { data, isLoading } = useQuery<OutsourcedReportData>({
    queryKey: ["outsourced-report", dateFrom, dateTo],
    queryFn: () => api.get(`/api/reports/outsourced?from=${dateFrom}&to=${dateTo}`),
  });
  const rows = data?.rows ?? [];
  const byLab = data?.byLab ?? {};
  const sent = rows.filter((r) => r.outsourceSentAt).length;
  const received = rows.filter((r) => r.outsourceReceivedAt).length;
  const pending = sent - received;

  return (
    <div className="space-y-5">
      <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm">Outsourced Sample Report</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Track samples sent to external labs and their return status</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div><p className="text-xs text-muted-foreground mb-1">From</p><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-8 text-xs" /></div>
            <div><p className="text-xs text-muted-foreground mb-1">To</p><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-8 text-xs" /></div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-blue-800 dark:text-blue-300">{sent}</p>
            <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wide">Sent</p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300">{received}</p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Received</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-amber-800 dark:text-amber-300">{pending}</p>
            <p className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wide">Pending</p>
          </div>
        </div>
        {Object.keys(byLab).length > 0 && (
          <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(byLab).map(([lab, counts]) => (
              <div key={lab} className="bg-muted/40 rounded-md px-3 py-2 text-xs">
                <p className="font-semibold truncate">{lab}</p>
                <p className="text-muted-foreground mt-0.5">Sent {counts.sent} · Recv {counts.received} · Pend {counts.pending}</p>
              </div>
            ))}
          </div>
        )}
        {isLoading ? (
          <div className="animate-pulse space-y-2"><div className="h-8 bg-muted rounded" /><div className="h-8 bg-muted rounded" /><div className="h-8 bg-muted rounded" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No outsourced samples in this date range</div>
        ) : (
          <div className="border border-card-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60"><tr>
                <th className="text-left px-3 py-2 font-semibold">Barcode</th>
                <th className="text-left px-3 py-2 font-semibold">Patient</th>
                <th className="text-left px-3 py-2 font-semibold">Lab</th>
                <th className="text-left px-3 py-2 font-semibold">Sent</th>
                <th className="text-left px-3 py-2 font-semibold">Expected</th>
                <th className="text-left px-3 py-2 font-semibold">Received</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
              </tr></thead>
              <tbody className="divide-y divide-card-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono font-bold">{r.barcode}</td>
                    <td className="px-3 py-2">{r.patientName}</td>
                    <td className="px-3 py-2">{r.outsourceLab ?? "—"}</td>
                    <td className="px-3 py-2">{r.outsourceSentAt ? new Date(r.outsourceSentAt).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-3 py-2">{r.outsourceExpectedAt ?? "—"}</td>
                    <td className="px-3 py-2">{r.outsourceReceivedAt ? new Date(r.outsourceReceivedAt).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-3 py-2">
                      {r.outsourceReceivedAt ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-extrabold text-[10px]">RECEIVED</span>
                      ) : r.outsourceSentAt ? (
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-extrabold text-[10px]">PENDING</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400 font-extrabold text-[10px]">NOT SENT</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AIInsightsTab({ dateFrom, dateTo, setDateFrom, setDateTo }: {
  dateFrom: string; dateTo: string;
  setDateFrom: (v: string) => void; setDateTo: (v: string) => void;
}) {
  const [insights, setInsights] = useState("");
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const generate = async () => {
    setLoading(true);
    setInsights("");
    try {
      const res = await fetch("/api/ai/billing-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: dateTo }),
      });
      const data = await res.json();
      setInsights(data.insights ?? "");
      setGenerated(true);
    } catch {
      setInsights("Failed to generate insights. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20 border border-violet-200 dark:border-violet-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-violet-600" />
          <h3 className="font-semibold text-violet-800 dark:text-violet-300">AI Billing Insights</h3>
        </div>
        <p className="text-sm text-violet-700 dark:text-violet-400 mb-4">
          Powered by Gemini AI — analyzes your billing data and generates actionable business insights.
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground mb-1">From</p>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">To</p>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
          </div>
          <Button onClick={generate} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
            {loading ? <><RefreshCw size={14} className="mr-1.5 animate-spin" />Analyzing…</> : <><Sparkles size={14} className="mr-1.5" />Generate Insights</>}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="bg-card border border-card-border rounded-xl p-6 space-y-3">
          <div className="animate-pulse space-y-2">
            {[100, 90, 80, 70, 85].map((w, i) => (
              <div key={i} className="h-4 bg-muted rounded" style={{ width: `${w}%` }} />
            ))}
          </div>
          <p className="text-xs text-center text-muted-foreground">Gemini AI is analyzing your billing data…</p>
        </div>
      )}

      {!loading && insights && (
        <div className="bg-card border border-card-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold flex items-center gap-2"><Sparkles size={15} className="text-violet-500" />AI Analysis Results</h4>
            <Button size="sm" variant="outline" onClick={generate}><RefreshCw size={13} className="mr-1.5" />Refresh</Button>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{insights}</div>
        </div>
      )}

      {!loading && !generated && (
        <div className="bg-card border border-card-border rounded-xl p-12 text-center">
          <Sparkles size={36} className="text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="font-medium text-muted-foreground">Click "Generate Insights" to get AI-powered billing analysis</p>
          <p className="text-xs text-muted-foreground mt-1">Analysis includes collection rate, revenue trends, discount patterns, and recommendations</p>
        </div>
      )}
    </div>
  );
}
