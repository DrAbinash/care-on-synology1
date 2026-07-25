/**
 * Rate Analysis — three slab-oriented views over the referral-commission data.
 *
 *   Slab gaps   which referrals had NO explicit test/category slab and fell
 *               through to the doctor's catch-all rule or profile default
 *   Rate matrix test (or category) x doctor, showing the configured rate and
 *               what it actually paid — slabs are only manageable side by side
 *   Variance    configured rate vs the rate actually realised after discounts
 *
 * All three are computed from GET /commission/report-by-patient — the same
 * response the Referral Report renders — so these views can never disagree
 * with it. Nothing here re-derives commission.
 */
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, AlertTriangle, Grid3x3, TrendingDown, Download, Search,
} from "lucide-react";
import { saAuthHeaders } from "@/lib/saApi";

// ── Types (mirror of the report-by-patient payload we consume) ───────────────
type RuleScope = "test" | "category" | "all" | "default" | "none";

type Row = {
  date: string;
  orderId: number;
  testId: number;
  testName: string;
  category: string;
  price: number;
  commission: number;       // actual, after the bill-discount deduction
  grossCommission: number;  // expected, before it
  commissionBase: number;   // price the rate was applied to (VIP stripped)
  ruleName: string;
  ruleType: string;
  ruleValue: number;
  ruleScope: RuleScope;
  held: boolean;
};

type DoctorEntry = {
  doctor: { id: number; name: string; specialization: string | null };
  rows: Row[];
  totalCommission: number;
  totalExpectedCommission: number;
  totalRevenue: number;
  orderCount: number;
  testCount: number;
};

type ReportData = { report: DoctorEntry[] };

type View = "gaps" | "matrix" | "variance";

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const fmtRate = (type: string, value: number) =>
  type === "percentage" ? `${value}%` : inr(value);

// A line is "unslabbed" when no test/category rule matched it — the rate came
// from the doctor's catch-all, their profile default, or nothing at all.
const isGap = (s: RuleScope) => s === "all" || s === "default" || s === "none";

const GAP_LABEL: Record<string, string> = {
  all: "Catch-all rule",
  default: "Profile default",
  none: "No rate at all",
};

export default function RateAnalysis({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();

  const today = () => new Date().toISOString().split("T")[0];
  const firstOfMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [view, setView] = useState<View>("gaps");
  const [groupBy, setGroupBy] = useState<"test" | "category">("test");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: ["/api/commission/report-by-patient", "rate-analysis", from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/commission/report-by-patient?${new URLSearchParams({ from, to })}`,
        { headers: saAuthHeaders() },
      );
      if (!res.ok) throw new Error("Failed to load commission data");
      return res.json();
    },
  });

  useEffect(() => {
    if (error) toast({ title: "Failed to load", description: String(error), variant: "destructive" });
  }, [error, toast]);

  const report = useMemo(() => data?.report ?? [], [data]);

  // ── #1 Slab gaps ──────────────────────────────────────────────────────────
  // Grouped by doctor + test, because "Dr. X's MRI referrals have no slab" is
  // the unit you act on, not an individual bill line.
  const gaps = useMemo(() => {
    const out: {
      doctorId: number; doctorName: string; testId: number; testName: string;
      category: string; scope: RuleScope; rateShown: string;
      count: number; revenue: number; commission: number;
    }[] = [];
    for (const d of report) {
      const byTest = new Map<number, (typeof out)[number]>();
      for (const r of d.rows) {
        if (!isGap(r.ruleScope)) continue;
        const cur = byTest.get(r.testId) ?? {
          doctorId: d.doctor.id, doctorName: d.doctor.name,
          testId: r.testId, testName: r.testName, category: r.category,
          scope: r.ruleScope, rateShown: fmtRate(r.ruleType, r.ruleValue),
          count: 0, revenue: 0, commission: 0,
        };
        cur.count += 1;
        cur.revenue += r.price;
        cur.commission += r.commission;
        byTest.set(r.testId, cur);
      }
      out.push(...byTest.values());
    }
    return out.sort((a, b) => b.commission - a.commission);
  }, [report]);

  const gapTotals = useMemo(() => ({
    lines: gaps.reduce((s, g) => s + g.count, 0),
    commission: gaps.reduce((s, g) => s + g.commission, 0),
    doctors: new Set(gaps.map(g => g.doctorId)).size,
    tests: new Set(gaps.map(g => g.testId)).size,
  }), [gaps]);

  // ── #2 Rate matrix ────────────────────────────────────────────────────────
  const matrix = useMemo(() => {
    const doctors = report.map(d => ({ id: d.doctor.id, name: d.doctor.name }));
    const rowMap = new Map<string, {
      key: string; label: string;
      cells: Map<number, { rate: string; scope: RuleScope; count: number; commission: number }>;
    }>();
    for (const d of report) {
      for (const r of d.rows) {
        const key = groupBy === "test" ? `t${r.testId}` : `c${r.category}`;
        const label = groupBy === "test" ? r.testName : r.category;
        const row = rowMap.get(key) ?? { key, label, cells: new Map() };
        const cell = row.cells.get(d.doctor.id) ?? {
          rate: fmtRate(r.ruleType, r.ruleValue), scope: r.ruleScope, count: 0, commission: 0,
        };
        cell.count += 1;
        cell.commission += r.commission;
        // A configured slab always wins the label over a fallback.
        if (!isGap(r.ruleScope)) { cell.rate = fmtRate(r.ruleType, r.ruleValue); cell.scope = r.ruleScope; }
        row.cells.set(d.doctor.id, cell);
        rowMap.set(key, row);
      }
    }
    return { doctors, rows: [...rowMap.values()].sort((a, b) => a.label.localeCompare(b.label)) };
  }, [report, groupBy]);

  // ── #3 Configured vs realised ─────────────────────────────────────────────
  // configured = expected commission / the base the rate was applied to
  // realised   = actual commission (after discount) / what the patient was billed
  const variance = useMemo(() => report.map(d => {
    const base = d.rows.reduce((s, r) => s + r.commissionBase, 0);
    const billed = d.rows.reduce((s, r) => s + r.price, 0);
    const configured = base > 0 ? (d.totalExpectedCommission / base) * 100 : 0;
    const realised = billed > 0 ? (d.totalCommission / billed) * 100 : 0;
    return {
      doctorId: d.doctor.id, doctorName: d.doctor.name,
      specialization: d.doctor.specialization ?? "",
      configured, realised, drop: configured - realised,
      expected: d.totalExpectedCommission, actual: d.totalCommission,
      surrendered: d.totalExpectedCommission - d.totalCommission,
      revenue: d.totalRevenue, tests: d.testCount,
    };
  }).sort((a, b) => b.drop - a.drop), [report]);

  const term = search.trim().toLowerCase();
  const gapsFiltered = term
    ? gaps.filter(g => g.doctorName.toLowerCase().includes(term) || g.testName.toLowerCase().includes(term))
    : gaps;

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    let name = "", head: string[] = [], body: string[][] = [];
    if (view === "gaps") {
      name = "slab_gaps";
      head = ["Doctor", "Test", "Category", "Rate came from", "Rate applied", "Referrals", "Revenue", "Commission"];
      body = gapsFiltered.map(g => [g.doctorName, g.testName, g.category,
        GAP_LABEL[g.scope] ?? g.scope, g.rateShown, String(g.count), g.revenue.toFixed(2), g.commission.toFixed(2)]);
    } else if (view === "variance") {
      name = "rate_variance";
      head = ["Doctor", "Speciality", "Configured %", "Realised %", "Drop %", "Expected", "Actual", "Surrendered"];
      body = variance.map(v => [v.doctorName, v.specialization, v.configured.toFixed(2), v.realised.toFixed(2),
        v.drop.toFixed(2), v.expected.toFixed(2), v.actual.toFixed(2), v.surrendered.toFixed(2)]);
    } else {
      name = "rate_matrix";
      head = [groupBy === "test" ? "Test" : "Category", ...matrix.doctors.map(d => d.name)];
      body = matrix.rows.map(r => [r.label, ...matrix.doctors.map(d => {
        const c = r.cells.get(d.id);
        return c ? `${c.rate}${isGap(c.scope) ? " (no slab)" : ""}` : "";
      })]);
    }
    const csv = [head.map(esc).join(","), ...body.map(r => r.map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-[1600px] mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            <ArrowLeft size={14} className="mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Rate Analysis</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Where your commission rates actually came from — and what they cost
          </p>
        </div>

        {/* Controls */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
            </div>
            <div className="flex-1" />
            <Button variant="outline" onClick={exportCsv}>
              <Download size={14} className="mr-1" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer size={14} className="mr-1" /> Print
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: "gaps", label: "Slab Gaps", icon: AlertTriangle },
              { id: "matrix", label: "Rate Matrix", icon: Grid3x3 },
              { id: "variance", label: "Configured vs Realised", icon: TrendingDown },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                  view === id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
            {view === "matrix" && (
              <Select value={groupBy} onValueChange={v => setGroupBy(v as "test" | "category")}>
                <SelectTrigger className="w-40 ml-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">By test</SelectItem>
                  <SelectItem value="category">By category</SelectItem>
                </SelectContent>
              </Select>
            )}
            {view === "gaps" && (
              <div className="relative ml-2">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filter doctor or test…"
                  className="pl-8 w-56 h-9"
                />
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : report.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm bg-card border border-border rounded-xl">
            No referral data for the selected period
          </div>
        ) : view === "gaps" ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { l: "Referrals with no slab", v: String(gapTotals.lines) },
                { l: "Doctors affected", v: String(gapTotals.doctors) },
                { l: "Tests affected", v: String(gapTotals.tests) },
                { l: "Paid at a fallback rate", v: inr(gapTotals.commission), amber: true },
              ].map(k => (
                <div key={k.l} className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-muted-foreground">{k.l}</p>
                  <p className={`text-xl font-bold ${k.amber ? "text-amber-500" : ""}`}>{k.v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-amber-900 bg-amber-950/30 p-3 text-xs text-amber-400">
              These referrals had no rule for that specific test or its category, so the rate came from the
              doctor's catch-all rule, their profile default, or nothing at all. With slab-based pricing that
              usually means a slab was never set — not that the rate was chosen.
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20 text-left">
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Doctor</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Test</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Category</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Rate came from</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-center">Rate</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-center">Referrals</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Revenue</th>
                      <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapsFiltered.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">
                        Every referral in this period matched an explicit slab.
                      </td></tr>
                    ) : gapsFiltered.map((g, i) => (
                      <tr key={`${g.doctorId}-${g.testId}`} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/10" : ""}`}>
                        <td className="px-4 py-2.5 font-medium">{g.doctorName}</td>
                        <td className="px-4 py-2.5">{g.testName}</td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{g.category}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[11px] px-2 py-0.5 rounded ${
                            g.scope === "none" ? "bg-rose-900/40 text-rose-300" : "bg-amber-900/40 text-amber-300"}`}>
                            {GAP_LABEL[g.scope] ?? g.scope}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{g.rateShown}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{g.count}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(g.revenue)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-500">{inr(g.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : view === "matrix" ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
              Configured rate per {groupBy}. Cells marked <span className="text-amber-400">(no slab)</span> fell
              through to a catch-all or the profile default. Blank = that doctor sent no such referral.
            </div>
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border bg-muted/20 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground sticky left-0 bg-card">
                      {groupBy === "test" ? "Test" : "Category"}
                    </th>
                    {matrix.doctors.map(d => (
                      <th key={d.id} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap text-center">
                        {d.name.replace(/^Dr\.?\s*/i, "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((r, i) => (
                    <tr key={r.key} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap sticky left-0 bg-card">{r.label}</td>
                      {matrix.doctors.map(d => {
                        const c = r.cells.get(d.id);
                        if (!c) return <td key={d.id} className="px-3 py-2.5 text-center text-muted-foreground/30">—</td>;
                        return (
                          <td key={d.id} className="px-3 py-2.5 text-center">
                            <div className={`text-sm tabular-nums ${isGap(c.scope) ? "text-amber-400" : "font-semibold"}`}>
                              {c.rate}
                            </div>
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {c.count}× · {inr(c.commission)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
              <b className="text-foreground">Configured</b> is the rate your slabs imply (expected commission ÷ the
              price the rate was applied to). <b className="text-foreground">Realised</b> is what you actually paid
              out of what the patient was billed. The gap is discount surrendered from commission.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/20 text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Doctor</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-center">Tests</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Configured</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Realised</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Drop</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Expected</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Actual</th>
                    <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Surrendered</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.map((v, i) => (
                    <tr key={v.doctorId} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{v.doctorName}</div>
                        <div className="text-[11px] text-muted-foreground">{v.specialization}</div>
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{v.tests}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pct(v.configured)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pct(v.realised)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                        v.drop > 0.05 ? "text-rose-400" : "text-muted-foreground"}`}>
                        {v.drop > 0.05 ? `−${pct(v.drop)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(v.expected)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-500">{inr(v.actual)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-400">
                        {v.surrendered > 0.005 ? `−${inr(v.surrendered)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
