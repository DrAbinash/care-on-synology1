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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Printer, AlertTriangle, Grid3x3, TrendingDown, Download, Search, Building2, Plus,
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
  isOutsourced: boolean;
  outsourceCost: number;
  margin: number;
  labId: number | null;
  labName: string;
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

type View = "gaps" | "matrix" | "variance" | "labs";

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

  // ── Fill a gap without leaving the report ─────────────────────────────────
  // The gap list used to be read-only: you saw the missing slab, then went to
  // Commission Rules and typed it in again from memory. This creates it in
  // place, prefilled with the doctor and test that produced the gap.
  const [slabFor, setSlabFor] = useState<null | {
    doctorId: number; doctorName: string; testId: number; testName: string; category: string;
  }>(null);
  const [slabType, setSlabType] = useState<"percentage" | "fixed">("percentage");
  const [slabValue, setSlabValue] = useState("");
  const [slabScope, setSlabScope] = useState<"test" | "category">("test");
  const [slabSaving, setSlabSaving] = useState(false);

  const createSlab = async () => {
    if (!slabFor) return;
    const value = Number(slabValue);
    if (!Number.isFinite(value) || value <= 0) {
      toast({ title: "Enter a rate", description: "The rate must be a positive number.", variant: "destructive" });
      return;
    }
    setSlabSaving(true);
    try {
      const res = await fetch("/api/commission/rules", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId: slabFor.doctorId,
          name: slabScope === "test" ? slabFor.testName : `${slabFor.category} slab`,
          type: slabType,
          value,
          scope: slabScope,
          testIds: slabScope === "test" ? [slabFor.testId] : [],
          categories: slabScope === "category" ? [slabFor.category] : [],
          isExclusive: false,
        }),
      });
      const body = await res.json().catch(() => ({}));
      // The server enforces the clinic's rate ceiling; surface its reason rather
      // than a generic failure.
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      toast({
        title: "Slab created",
        description: `${slabFor.doctorName} · ${slabScope === "test" ? slabFor.testName : slabFor.category} at ${
          slabType === "percentage" ? `${value}%` : inr(value)}. Reload the period to see it applied.`,
      });
      setSlabFor(null);
      setSlabValue("");
      await refetch();
    } catch (e) {
      toast({ title: "Could not create slab", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSlabSaving(false);
    }
  };

  // Drift threshold: how far a doctor's realised rate may fall below their
  // configured slab before it is worth being told about. Lives with the other
  // commission settings, so it stays behind the pen drive like the rates do.
  const { data: settingsData } = useQuery({
    queryKey: ["/api/super-admin/commission-settings", "rate-analysis"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/commission-settings", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load commission settings");
      return res.json() as Promise<{ commissionDriftAlertPoints: number }>;
    },
  });
  const driftPoints = Number(settingsData?.commissionDriftAlertPoints ?? 0);

  const { data, isLoading, error, refetch } = useQuery<ReportData>({
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

  // Doctors whose realised rate has fallen further below their configured slab
  // than the clinic's threshold allows. Almost always discounts eating the band.
  const drifted = useMemo(
    () => (driftPoints > 0 ? variance.filter(v => v.drop >= driftPoints) : []),
    [variance, driftPoints],
  );

  const term = search.trim().toLowerCase();
  const gapsFiltered = term
    ? gaps.filter(g => g.doctorName.toLowerCase().includes(term) || g.testName.toLowerCase().includes(term))
    : gaps;

  // ── Margin by outsourced lab ────────────────────────────────────────────────
  // The clinic keeps price − lab cost on outsourced work, then pays commission
  // out of that. This is the only place that answers "which lab is actually
  // worth using": two labs at the same headline discount can leave very
  // different amounts once the referral commission comes out.
  const labs = useMemo(() => {
    const byLab = new Map<string, {
      labId: number | null; labName: string; tests: number; doctors: Set<number>;
      revenue: number; cost: number; commission: number;
    }>();
    for (const e of report) {
      for (const r of e.rows) {
        if (!r.isOutsourced) continue;
        const key = r.labId == null ? "unassigned" : String(r.labId);
        let l = byLab.get(key);
        if (!l) {
          l = { labId: r.labId, labName: r.labName || "Unassigned lab", tests: 0, doctors: new Set(), revenue: 0, cost: 0, commission: 0 };
          byLab.set(key, l);
        }
        l.tests++;
        l.doctors.add(e.doctor.id);
        l.revenue += r.price;
        l.cost += r.outsourceCost ?? 0;
        l.commission += r.commission;
      }
    }
    return [...byLab.values()]
      .map(l => {
        const margin = l.revenue - l.cost;
        const net = margin - l.commission;
        return {
          ...l,
          doctorCount: l.doctors.size,
          margin,
          marginPct: l.revenue > 0 ? (margin / l.revenue) * 100 : 0,
          net,
          // What the clinic finally keeps, as a share of what the patient paid.
          netPct: l.revenue > 0 ? (net / l.revenue) * 100 : 0,
        };
      })
      .sort((a, b) => a.netPct - b.netPct);   // worst lab first — that is the one to act on
  }, [report]);

  const labTotals = useMemo(() => ({
    tests: labs.reduce((s, l) => s + l.tests, 0),
    revenue: labs.reduce((s, l) => s + l.revenue, 0),
    cost: labs.reduce((s, l) => s + l.cost, 0),
    commission: labs.reduce((s, l) => s + l.commission, 0),
    net: labs.reduce((s, l) => s + l.net, 0),
  }), [labs]);

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
    } else if (view === "labs") {
      name = "lab_margin";
      head = ["Lab", "Tests", "Doctors", "Revenue", "Lab cost", "Margin", "Margin %", "Commission paid", "Net to clinic", "Net %"];
      body = labs.map(l => [l.labName, String(l.tests), String(l.doctorCount), l.revenue.toFixed(2),
        l.cost.toFixed(2), l.margin.toFixed(2), l.marginPct.toFixed(1), l.commission.toFixed(2),
        l.net.toFixed(2), l.netPct.toFixed(1)]);
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
              { id: "labs", label: "Lab Margin", icon: Building2 },
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

        {drifted.length > 0 && (
          <button
            onClick={() => setView("variance")}
            className="w-full text-left rounded-xl border border-rose-900 bg-rose-950/30 px-4 py-3 flex items-start gap-2.5 hover:bg-rose-950/50 transition-colors"
          >
            <TrendingDown size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <span className="text-sm">
              <span className="font-semibold text-rose-300">
                {drifted.length} doctor{drifted.length === 1 ? "" : "s"} {drifted.length === 1 ? "is" : "are"} realising
                at least {driftPoints}% below their configured slab
              </span>
              <span className="block text-xs text-rose-400/90 mt-0.5">
                {drifted.slice(0, 3).map(v => `${v.doctorName} (−${pct(v.drop)})`).join(", ")}
                {drifted.length > 3 ? `, and ${drifted.length - 3} more` : ""}
                {" — "}{inr(drifted.reduce((s, v) => s + v.surrendered, 0))} surrendered to discounts. Open Configured vs Realised.
              </span>
            </span>
          </button>
        )}

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
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {gapsFiltered.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-xs">
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
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs gap-1"
                            onClick={() => {
                              setSlabFor({ doctorId: g.doctorId, doctorName: g.doctorName, testId: g.testId, testName: g.testName, category: g.category });
                              setSlabScope("test");
                              setSlabType("percentage");
                              setSlabValue("");
                            }}
                          >
                            <Plus size={12} /> Add slab
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : view === "labs" ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { l: "Outsourced tests", v: String(labTotals.tests) },
                { l: "Paid to labs", v: inr(labTotals.cost) },
                { l: "Commission on that work", v: inr(labTotals.commission) },
                { l: "Net to clinic", v: inr(labTotals.net), amber: true },
              ].map(c => (
                <div key={c.l} className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-muted-foreground">{c.l}</p>
                  <p className={`text-xl font-bold mt-1 ${c.amber ? "text-amber-500" : ""}`}>{c.v}</p>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
                On outsourced work you keep <b className="text-foreground">revenue − lab cost</b>, and the referral
                commission comes out of that. <b className="text-foreground">Net to clinic</b> is what is finally
                left. Worst lab first — two labs at the same headline discount can leave very different amounts
                once commission is paid.
              </div>
              {labs.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No outsourced tests in this period.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20 text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Lab</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-center">Tests</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-center">Doctors</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Revenue</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Lab cost</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Margin</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Commission</th>
                        <th className="px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground text-right">Net to clinic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labs.map((l, i) => (
                        <tr key={l.labId ?? "unassigned"} className={`border-b border-border/50 last:border-0 ${i % 2 ? "bg-muted/10" : ""}`}>
                          <td className="px-4 py-2.5 font-medium">{l.labName}</td>
                          <td className="px-4 py-2.5 text-center tabular-nums">{l.tests}</td>
                          <td className="px-4 py-2.5 text-center tabular-nums text-muted-foreground">{l.doctorCount}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{inr(l.revenue)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{inr(l.cost)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {inr(l.margin)}
                            <span className="text-[11px] text-muted-foreground ml-1.5">{pct(l.marginPct)}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-amber-500">{inr(l.commission)}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                            l.net < 0 ? "text-rose-400" : l.netPct < 10 ? "text-amber-400" : "text-emerald-400"}`}>
                            {inr(l.net)}
                            <span className="text-[11px] opacity-70 ml-1.5">{pct(l.netPct)}</span>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-amber-950/20 border-t-2 border-amber-900">
                        <td className="px-4 py-2.5 font-bold text-xs uppercase">Total</td>
                        <td className="px-4 py-2.5 text-center tabular-nums font-bold">{labTotals.tests}</td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{inr(labTotals.revenue)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{inr(labTotals.cost)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{inr(labTotals.revenue - labTotals.cost)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-amber-500">{inr(labTotals.commission)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{inr(labTotals.net)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
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
                    <tr key={v.doctorId} className={`border-b border-border/50 last:border-0 ${
                      driftPoints > 0 && v.drop >= driftPoints ? "bg-rose-950/20" : i % 2 ? "bg-muted/10" : ""}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">
                          {v.doctorName}
                          {driftPoints > 0 && v.drop >= driftPoints && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-rose-900/50 text-rose-300 align-middle">
                              over threshold
                            </span>
                          )}
                        </div>
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

      {/* Create the missing slab, prefilled from the gap row */}
      <Dialog open={!!slabFor} onOpenChange={(v) => { if (!v) setSlabFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add the missing slab</DialogTitle></DialogHeader>
          {slabFor && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
                <div><span className="text-muted-foreground">Doctor:</span> <b>{slabFor.doctorName}</b></div>
                <div className="mt-0.5"><span className="text-muted-foreground">Test:</span> <b>{slabFor.testName}</b>
                  <span className="text-muted-foreground"> · {slabFor.category}</span></div>
              </div>

              <div>
                <Label className="text-xs mb-1.5 block">Cover</Label>
                <Select value={slabScope} onValueChange={(v) => setSlabScope(v as "test" | "category")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">This test only</SelectItem>
                    <SelectItem value="category">Everything in {slabFor.category}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  A category slab closes every gap in {slabFor.category} for this doctor at once.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block">Type</Label>
                  <Select value={slabType} onValueChange={(v) => setSlabType(v as "percentage" | "fixed")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed (₹)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">{slabType === "percentage" ? "Percentage" : "Amount (₹)"}</Label>
                  <Input
                    type="number" step="any" min="0" autoFocus
                    value={slabValue}
                    onChange={(e) => setSlabValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !slabSaving) void createSlab(); }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setSlabFor(null)}>Cancel</Button>
                <Button disabled={slabSaving} onClick={() => void createSlab()}>
                  {slabSaving ? "Saving…" : "Create slab"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
