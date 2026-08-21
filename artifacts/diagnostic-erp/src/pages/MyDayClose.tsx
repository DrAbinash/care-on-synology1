import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { FINANCIAL_QUERY_OPTIONS } from "@/lib/queryConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Lock, RefreshCw, CheckCircle2, AlertTriangle, TrendingUp, Wallet,
  ChevronDown, ChevronUp, Calculator, IndianRupee, Printer,
} from "lucide-react";
import { Link } from "wouter";
import { readStaffSession } from "@/lib/staffSession";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  autoPrintStaffDayClose,
  openStaffDayClosePrint,
  type StaffPrintActivity,
  type StaffSlipClinic,
} from "@/lib/staffDayCloseSlip";

type MethodTotals = {
  cash: number; upi: number; card: number; cheque: number; other: number;
  total: number; count: number;
};

type MyPreview = {
  userName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expected: MethodTotals;
  billsCount: number;
  paymentsCount: number;
  totalBilled: number;
  totalDue: number;
};

type MyClose = {
  id: number;
  userName?: string;
  closureDate: string;
  closedAt: string;
  coveredFromTs: string | null;
  coveredToTs?: string | null;
  expectedCash: string; expectedUpi: string; expectedCard: string;
  expectedCheque: string; expectedOther: string;
  totalExpected: string;
  totalBilled: string;
  totalDue: string;
  billsCount: number;
  paymentsCount: number;
  actualCash: string; actualUpi: string; actualCard: string;
  actualCheque: string; actualOther: string;
  totalActual: string;
  variance: string;
  varianceNote: string;
  notes: string;
  drawerStatus: string;
  denominations: null | {
    d500: number; d200: number; d100: number;
    d50: number; d20: number; d10: number; coins: number;
  };
  denominationTotal: string | null;
  printActivity?: StaffPrintActivity | null;
};

const DENOMS = [
  { key: "d500" as const, label: "₹500", value: 500 },
  { key: "d200" as const, label: "₹200", value: 200 },
  { key: "d100" as const, label: "₹100", value: 100 },
  { key: "d50"  as const, label: "₹50",  value: 50  },
  { key: "d20"  as const, label: "₹20",  value: 20  },
  { key: "d10"  as const, label: "₹10",  value: 10  },
  { key: "coins" as const, label: "Coins / <₹10", value: 1 },
] as const;

type DenomKey = typeof DENOMS[number]["key"];
type DenomCounts = Record<DenomKey, string>;

const EMPTY_DENOMS: DenomCounts = {
  d500: "", d200: "", d100: "", d50: "", d20: "", d10: "", coins: "",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const fmtIst = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : "Beginning of records";

function nv(v: string | number | undefined | null): number {
  return Number(v ?? 0) || 0;
}

function calcDenomTotal(d: DenomCounts): number {
  return DENOMS.reduce((sum, { key, value }) => sum + nv(d[key]) * value, 0);
}

export default function MyDayClose() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const myName = session?.user?.name ?? "Staff";

  const previewQ = useQuery<MyPreview>({
    queryKey: ["my-day-close-preview"],
    queryFn: () => api.get<MyPreview>("/api/day-close/my-preview"),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const historyQ = useQuery<MyClose[]>({
    queryKey: ["my-day-close-list"],
    queryFn: () => api.get<MyClose[]>("/api/day-close/my-list"),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const clinicQ = useQuery<StaffSlipClinic>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get<StaffSlipClinic>("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  // Post-closure activity — only fetched after a successful close to show the
  // "chocolate box" callout.
  type PostClosureActivity = {
    closedAt: string | null;
    bills: { id: number; billNumber: string; totalAmount: number; paidAmount: number; status: string; createdAt: string }[];
    payments: { id: number; billId: number; amount: number; method: string; createdAt: string }[];
    billTotal: number;
    paymentTotal: number;
  };
  const postClosureQ = useQuery<PostClosureActivity>({
    queryKey: ["my-post-closure-activity"],
    queryFn: () => api.get<PostClosureActivity>("/api/day-close/my-post-closure-activity"),
    ...FINANCIAL_QUERY_OPTIONS,
  });

  const [actuals, setActuals] = useState({ cash: "", upi: "", card: "", cheque: "", other: "" });
  const [varianceNote, setVarianceNote] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<MyClose | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

  // Denomination counting
  const [denomOpen, setDenomOpen] = useState(false);
  const [denomCounts, setDenomCounts] = useState<DenomCounts>(EMPTY_DENOMS);
  const [denomOverrideReason, setDenomOverrideReason] = useState("");

  const denomTotal = useMemo(() => calcDenomTotal(denomCounts), [denomCounts]);
  const anyDenomEntered = DENOMS.some(({ key }) => nv(denomCounts[key]) > 0);

  // When denom section is open and has entries, sync cash actual to denom total
  // (user can still manually override but must provide a reason).
  const cashFromDenom = denomOpen && anyDenomEntered ? denomTotal : null;
  const cashActualNum = nv(actuals.cash);
  const denomMismatch = cashFromDenom !== null && Math.abs(cashActualNum - cashFromDenom) > 0.01;

  useEffect(() => {
    if (!previewQ.data) return;
    setActuals({
      cash:   String(previewQ.data.expected.cash   || ""),
      upi:    String(previewQ.data.expected.upi    || ""),
      card:   String(previewQ.data.expected.card   || ""),
      cheque: String(previewQ.data.expected.cheque || ""),
      other:  String(previewQ.data.expected.other  || ""),
    });
  }, [previewQ.data]);

  // Auto-fill cash from denomination total when denom section is used.
  useEffect(() => {
    if (denomOpen && anyDenomEntered) {
      setActuals((a) => ({ ...a, cash: String(denomTotal || "") }));
    }
  }, [denomTotal, denomOpen, anyDenomEntered]);

  const totalActual = useMemo(
    () => nv(actuals.cash) + nv(actuals.upi) + nv(actuals.card) + nv(actuals.cheque) + nv(actuals.other),
    [actuals],
  );
  const totalExpected = previewQ.data?.expected.total ?? 0;
  const variance = totalActual - totalExpected;

  const expectedDigital = (previewQ.data?.expected.upi ?? 0) + (previewQ.data?.expected.card ?? 0)
    + (previewQ.data?.expected.cheque ?? 0) + (previewQ.data?.expected.other ?? 0);
  const actualDigital = nv(actuals.upi) + nv(actuals.card) + nv(actuals.cheque) + nv(actuals.other);
  const digitalVariance = actualDigital - expectedDigital;

  const canClose = !previewQ.isLoading
    && (variance === 0 || varianceNote.trim().length >= 3)
    && (!denomMismatch || denomOverrideReason.trim().length >= 3);

  const closeMut = useMutation<MyClose>({
    mutationFn: () => {
      const denomsPayload = (denomOpen && anyDenomEntered)
        ? Object.fromEntries(DENOMS.map(({ key }) => [key, nv(denomCounts[key])])) as Record<DenomKey, number>
        : undefined;
      return api.post<MyClose>("/api/day-close/my-close", {
        actuals: {
          cash:   nv(actuals.cash),
          upi:    nv(actuals.upi),
          card:   nv(actuals.card),
          cheque: nv(actuals.cheque),
          other:  nv(actuals.other),
        },
        varianceNote: [varianceNote, denomMismatch && denomOverrideReason ? `Denom override: ${denomOverrideReason}` : ""].filter(Boolean).join(" | "),
        notes,
        denominations: denomsPayload,
      });
    },
    onSuccess: (closure) => {
      toast({ title: "Your day is closed", description: "New bills from this point count towards tomorrow." });
      setConfirmOpen(false);
      setVarianceNote("");
      setNotes("");
      setDenomCounts(EMPTY_DENOMS);
      setDenomOverrideReason("");
      qc.invalidateQueries({ queryKey: ["my-day-close-preview"] });
      qc.invalidateQueries({ queryKey: ["my-day-close-list"] });
      qc.invalidateQueries({ queryKey: ["day-close-staff-status"] });
      qc.invalidateQueries({ queryKey: ["my-drawer-status"] });
      if (clinicQ.data?.dayCloseAutoPrint !== false) {
        autoPrintStaffDayClose(
          { ...closure, userName: closure.userName ?? myName },
          clinicQ.data ?? {},
          myName,
        );
      }
      // Defer reload so the print window can open before the page unloads.
      setTimeout(() => window.location.reload(), 600);
    },
    onError: (e: Error) => toast({ title: "Close failed", description: e.message, variant: "destructive" }),
  });

  const printClosure = async (c: MyClose) => {
    setPrintingId(c.id);
    try {
      const full = c.printActivity
        ? c
        : await api.get<MyClose>(`/api/day-close/my-closures/${c.id}/print-summary`);
      openStaffDayClosePrint(
        { ...full, userName: full.userName ?? myName },
        clinicQ.data ?? {},
        myName,
      );
    } catch (e) {
      toast({
        title: "Print failed",
        description: e instanceof Error ? e.message : "Could not load print summary",
        variant: "destructive",
      });
    } finally {
      setPrintingId(null);
    }
  };

  const expected = previewQ.data?.expected;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock size={20} /> My Day Close
          </h1>
          <p className="text-sm text-muted-foreground">
            Close your shift — <strong>{myName}</strong>.
            Bills you create after closing are accounted from tomorrow.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => previewQ.refetch()} disabled={previewQ.isFetching}>
          <RefreshCw size={14} className={`mr-2 ${previewQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Post-Closure Activity Chocolate Box ── */}
      {postClosureQ.data?.closedAt && (postClosureQ.data.bills.length > 0 || postClosureQ.data.payments.length > 0) && (() => {
        const d = postClosureQ.data!;
        const hasBills    = d.bills.length > 0;
        const hasPayments = d.payments.length > 0;
        return (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 dark:border-amber-600 rounded-xl overflow-hidden shadow-md">
            <div className="px-4 py-3 bg-amber-400/20 dark:bg-amber-900/40 flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500 text-white flex-shrink-0">
                <AlertTriangle size={14} />
              </div>
              <div>
                <p className="text-sm font-extrabold text-amber-900 dark:text-amber-200">Post-Closure Activity Detected</p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Billing continued after drawer closed at {fmtIst(d.closedAt)} ·{" "}
                  {hasBills && `${d.bills.length} bill${d.bills.length !== 1 ? "s" : ""} (${inr(d.billTotal)})`}
                  {hasBills && hasPayments && " · "}
                  {hasPayments && `${d.payments.length} payment${d.payments.length !== 1 ? "s" : ""} (${inr(d.paymentTotal)})`}
                </p>
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase mt-0.5">
                  These will be counted in the next reconciliation window
                </p>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {hasBills && (
                <div>
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase mb-1.5 flex items-center gap-1.5">
                    <IndianRupee size={11} /> Bills Created Post-Closure
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-amber-300 dark:border-amber-700">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100 dark:bg-amber-900/40">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-900 dark:text-amber-200">Bill #</th>
                          <th className="px-3 py-1.5 text-right font-semibold text-amber-900 dark:text-amber-200">Amount</th>
                          <th className="px-3 py-1.5 text-right font-semibold text-amber-900 dark:text-amber-200">Paid</th>
                          <th className="px-3 py-1.5 text-left font-semibold text-amber-900 dark:text-amber-200">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                        {d.bills.map((b) => (
                          <tr key={b.id} className="hover:bg-amber-100/60 dark:hover:bg-amber-900/20">
                            <td className="px-3 py-1.5 font-semibold">
                              <Link href={`/billing/${b.id}`} className="text-primary hover:underline">{b.billNumber}</Link>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{inr(b.totalAmount)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-green-700 dark:text-green-400">{inr(b.paidAmount)}</td>
                            <td className="px-3 py-1.5 capitalize">{b.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {hasPayments && (
                <div>
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase mb-1.5 flex items-center gap-1.5">
                    <Wallet size={11} /> Payments Collected Post-Closure
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-amber-300 dark:border-amber-700">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100 dark:bg-amber-900/40">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Bill #</th>
                          <th className="px-3 py-2 text-right font-semibold text-amber-900 dark:text-amber-200">Amount</th>
                          <th className="px-3 py-2 text-left font-semibold text-amber-900 dark:text-amber-200">Method</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-200 dark:divide-amber-800">
                        {d.payments.map((p) => (
                          <tr key={p.id} className="hover:bg-amber-100/60 dark:hover:bg-amber-900/20">
                            <td className="px-3 py-1.5 font-semibold">
                              <Link href={`/billing/${p.billId}`} className="text-primary hover:underline">Bill #{p.billId}</Link>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-green-700 dark:text-green-400">{inr(p.amount)}</td>
                            <td className="px-3 py-1.5 capitalize text-amber-700 dark:text-amber-400">{p.method}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 rounded-lg px-3 py-2">
                Billing is never blocked after drawer close. This activity will be included in your <strong>next reconciliation window</strong>.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Open window summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp size={16} /> My Open Window
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Since last close</div>
              <div className="font-medium">{fmtIst(previewQ.data?.coveredFromTs ?? null)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Now (IST)</div>
              <div className="font-medium">{fmtIst(previewQ.data?.coveredToTs ?? null)}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Bills Created</div>
              <div className="font-bold text-xl">{previewQ.data?.billsCount ?? 0}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Payments Recorded</div>
              <div className="font-bold text-xl">{previewQ.data?.paymentsCount ?? 0}</div>
            </div>
          </div>
          {(previewQ.data?.totalBilled ?? 0) > 0 && (
            <div className="grid grid-cols-2 gap-4 mt-4 p-3 bg-muted/30 rounded-lg text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Total Billed</div>
                <div className="font-bold">{inr(previewQ.data?.totalBilled ?? 0)}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Pending Dues</div>
                <div className={`font-bold ${(previewQ.data?.totalDue ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}>
                  {inr(previewQ.data?.totalDue ?? 0)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reconcile form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet size={16} /> My Collections &amp; Close
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Cash field with denom toggle */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Cash</Label>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={() => setDenomOpen((o) => !o)}
              >
                <Calculator size={12} />
                {denomOpen ? "Hide" : "Count"} denominations
                {denomOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {/* Denomination section */}
            {denomOpen && (
              <div className="mb-3 border border-gray-200 dark:border-card-border rounded-lg p-3 bg-gray-50 dark:bg-muted/10 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Denomination Count</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DENOMS.map(({ key, label, value }) => {
                    const count = nv(denomCounts[key]);
                    const subtotal = count * value;
                    return (
                      <div key={key}>
                        <div className="text-[10px] font-semibold text-gray-500 mb-0.5">{label}</div>
                        <Input
                          type="number" min="0" step="1"
                          placeholder="0"
                          value={denomCounts[key]}
                          onChange={(e) => setDenomCounts((d) => ({ ...d, [key]: e.target.value }))}
                          className="h-8 text-sm"
                        />
                        {count > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">= {inr(subtotal)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-gray-200 dark:border-card-border">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Denomination Total</span>
                  <span className="text-base font-extrabold tabular-nums text-blue-700 dark:text-blue-300">
                    {inr(denomTotal)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                type="number" step="0.01" min="0"
                value={actuals.cash}
                onChange={(e) => setActuals((a) => ({ ...a, cash: e.target.value }))}
                className={denomMismatch ? "border-amber-500" : ""}
              />
              {cashFromDenom !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-xs"
                  onClick={() => setActuals((a) => ({ ...a, cash: String(denomTotal) }))}
                >
                  Use {inr(denomTotal)}
                </Button>
              )}
            </div>
            <div className="text-xs mt-1 flex items-center justify-between flex-wrap gap-x-2">
              <span className="text-muted-foreground">Expected: {inr(expected?.cash ?? 0)}</span>
              {(() => {
                const diff = cashActualNum - (expected?.cash ?? 0);
                return diff !== 0 ? (
                  <span className={diff < 0 ? "text-red-600" : "text-amber-600"}>
                    {diff < 0 ? "−" : "+"}{inr(Math.abs(diff))}
                  </span>
                ) : null;
              })()}
            </div>
            {denomMismatch && (
              <div className="mt-2">
                <Label className="text-amber-600 text-xs">
                  Cash entered ({inr(cashActualNum)}) differs from denomination total ({inr(denomTotal)}).
                  Reason required:
                </Label>
                <Input
                  className="mt-1 text-sm border-amber-400"
                  placeholder="Explain the difference…"
                  value={denomOverrideReason}
                  onChange={(e) => setDenomOverrideReason(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Digital fields */}
          <div className="grid gap-4 md:grid-cols-4">
            {(["upi", "card", "cheque", "other"] as const).map((m) => {
              const exp = expected ? expected[m] : 0;
              const act = nv(actuals[m]);
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
                  <div className="text-xs mt-1 flex justify-between">
                    <span className="text-muted-foreground">Exp: {inr(exp)}</span>
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

          {/* Summary table */}
          <div className="rounded-lg border border-gray-200 dark:border-card-border overflow-x-auto">
            <table className="w-full text-sm min-w-[28rem]">
              <thead className="bg-gray-50 dark:bg-muted/30">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Category</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Expected</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Counted</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Variance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">Cash</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(expected?.cash ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(cashActualNum)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    cashActualNum - (expected?.cash ?? 0) < 0 ? "text-red-600"
                    : cashActualNum - (expected?.cash ?? 0) > 0 ? "text-amber-600"
                    : "text-green-600"
                  }`}>
                    {cashActualNum - (expected?.cash ?? 0) === 0 ? "✓" : `${cashActualNum - (expected?.cash ?? 0) < 0 ? "−" : "+"}${inr(Math.abs(cashActualNum - (expected?.cash ?? 0)))}`}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="px-3 py-2 font-medium">Digital (UPI/Card/Other)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(expectedDigital)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(actualDigital)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    digitalVariance < 0 ? "text-red-600" : digitalVariance > 0 ? "text-amber-600" : "text-green-600"
                  }`}>
                    {digitalVariance === 0 ? "✓" : `${digitalVariance < 0 ? "−" : "+"}${inr(Math.abs(digitalVariance))}`}
                  </td>
                </tr>
                <tr className="border-t bg-gray-50 dark:bg-muted/20 font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-lg">{inr(totalExpected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-lg">{inr(totalActual)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums text-lg ${
                    variance === 0 ? "text-green-600" : variance < 0 ? "text-red-600" : "text-amber-600"
                  }`}>
                    {variance === 0 ? "Balanced ✓" : `${variance < 0 ? "−" : "+"}${inr(Math.abs(variance))}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Variance note (mandatory when mismatch) */}
          {variance !== 0 && (
            <div>
              <Label>
                Variance Note <span className="text-red-600">*</span>
                <span className="text-muted-foreground text-xs ml-1">(required before you can close)</span>
              </Label>
              {variance < 0 && (
                <div className="flex items-center gap-2 mt-1 mb-1 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-300">
                  <AlertTriangle size={12} className="shrink-0" />
                  Cash short by {inr(Math.abs(variance))} — explain below.
                </div>
              )}
              <Textarea
                value={varianceNote}
                onChange={(e) => setVarianceNote(e.target.value)}
                placeholder="Explain the difference — e.g. ₹200 short, change given without entry."
                className="mt-1"
                rows={2}
              />
            </div>
          )}

          <div>
            <Label>
              Handover Notes{" "}
              <span className="text-muted-foreground text-xs">(optional — visible to admin)</span>
            </Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pending tasks, special instructions for the next shift…"
              className="mt-1"
              rows={2}
            />
          </div>

          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={() => setConfirmOpen(true)}
              disabled={!canClose}
              className="bg-blue-700 hover:bg-blue-800"
            >
              <Lock size={16} className="mr-2" />
              Close My Day
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader><CardTitle className="text-base">My Past Closures</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[40rem]">
              <thead className="text-left text-xs text-muted-foreground uppercase border-b">
                <tr>
                  <th className="py-2 whitespace-nowrap">Date</th>
                  <th className="whitespace-nowrap">Closed At</th>
                  <th className="whitespace-nowrap">Bills</th>
                  <th className="whitespace-nowrap">Expected</th>
                  <th className="whitespace-nowrap">Actual</th>
                  <th className="whitespace-nowrap">Variance</th>
                  <th className="whitespace-nowrap">Status</th>
                  <th className="text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
              {(historyQ.data ?? []).map((c) => {
                const v = nv(c.variance);
                const statusColors: Record<string, string> = {
                  balanced: "text-green-600 bg-green-50 dark:bg-green-950/30",
                  mismatch: "text-red-600 bg-red-50 dark:bg-red-950/30",
                  approved: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
                  closed: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30",
                  reopened: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
                };
                const sc = statusColors[c.drawerStatus] ?? "text-gray-600";
                return (
                  <tr key={c.id} className="border-b last:border-b-0">
                    <td className="py-2 font-medium whitespace-nowrap">{c.closureDate}</td>
                    <td className="whitespace-nowrap">{fmtIst(c.closedAt)}</td>
                    <td className="whitespace-nowrap">{c.billsCount}</td>
                    <td className="whitespace-nowrap tabular-nums">{inr(nv(c.totalExpected))}</td>
                    <td className="whitespace-nowrap tabular-nums">{inr(nv(c.totalActual))}</td>
                    <td className={`whitespace-nowrap tabular-nums ${v === 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-amber-600"}`}>
                      {v === 0 ? "—" : `${v < 0 ? "−" : "+"}${inr(Math.abs(v))}`}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${sc}`}>
                        {c.drawerStatus}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setDetailOpen(c)}>View</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={printingId === c.id}
                        onClick={() => printClosure(c)}
                        title="Print day-close slip"
                      >
                        <Printer size={14} className="mr-1" />
                        {printingId === c.id ? "…" : "Print"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!historyQ.isLoading && (historyQ.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted-foreground">
                    No closures yet — close your first day above.
                  </td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {variance === 0
                ? <CheckCircle2 className="text-green-600" />
                : <AlertTriangle className="text-amber-600" />}
              Confirm Close — {myName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Bills Created</span><strong>{previewQ.data?.billsCount ?? 0}</strong></div>
            <div className="flex justify-between"><span>Total Billed</span><strong>{inr(previewQ.data?.totalBilled ?? 0)}</strong></div>
            <div className="flex justify-between"><span>Expected Collected</span><strong>{inr(totalExpected)}</strong></div>
            <div className="flex justify-between"><span>Actual Counted</span><strong>{inr(totalActual)}</strong></div>
            <div className="flex justify-between">
              <span>Variance</span>
              <strong className={
                variance === 0 ? "text-green-600" : variance < 0 ? "text-red-600" : "text-amber-600"
              }>
                {variance === 0 ? "Balanced ✓" : `${variance < 0 ? "−" : "+"}${inr(Math.abs(variance))}`}
              </strong>
            </div>
            {anyDenomEntered && (
              <div className="flex justify-between text-muted-foreground">
                <span>Denomination Count</span><strong>{inr(denomTotal)}</strong>
              </div>
            )}
            {varianceNote && (
              <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border rounded text-xs">
                {varianceNote}
              </div>
            )}
            {notes && (
              <div className="p-2 bg-muted/30 border rounded text-xs">
                <strong>Handover:</strong> {notes}
              </div>
            )}
            <p className="text-muted-foreground text-xs pt-1">
              Bills created after this close will be counted from tomorrow onwards.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => closeMut.mutate()}
              disabled={closeMut.isPending}
              className="bg-blue-700 hover:bg-blue-800"
            >
              {closeMut.isPending ? "Closing…" : "Confirm & Close My Day"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailOpen} onOpenChange={(o) => !o && setDetailOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>My Closure #{detailOpen?.id} — {detailOpen?.closureDate}</DialogTitle>
          </DialogHeader>
          {detailOpen && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-muted-foreground text-xs">Closed At</div><div>{fmtIst(detailOpen.closedAt)}</div></div>
                <div><div className="text-muted-foreground text-xs">Bills</div><div>{detailOpen.billsCount}</div></div>
                <div><div className="text-muted-foreground text-xs">Total Billed</div><div>{inr(nv(detailOpen.totalBilled))}</div></div>
                <div><div className="text-muted-foreground text-xs">Pending Dues</div><div>{inr(nv(detailOpen.totalDue))}</div></div>
              </div>
              <table className="w-full text-xs border-t">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left py-1">Method</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {(["Cash", "Upi", "Card", "Cheque", "Other"] as const).map((m) => {
                    const e = nv(detailOpen[`expected${m}` as keyof MyClose] as string);
                    const a = nv(detailOpen[`actual${m}` as keyof MyClose] as string);
                    const v = a - e;
                    return (
                      <tr key={m} className="border-t">
                        <td className="py-1">{m}</td>
                        <td className="text-right">{inr(e)}</td>
                        <td className="text-right">{inr(a)}</td>
                        <td className={`text-right ${v < 0 ? "text-red-600" : v > 0 ? "text-amber-600" : ""}`}>
                          {v === 0 ? "—" : inr(v)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {detailOpen.denominations && (
                <div className="p-2 bg-muted/20 border rounded text-xs">
                  <strong>Denomination Count:</strong>{" "}
                  {DENOMS.filter(({ key }) => detailOpen.denominations![key] > 0)
                    .map(({ key, label }) => `${label}×${detailOpen.denominations![key]}`)
                    .join(", ")}
                  {" → "}
                  <strong>{inr(nv(detailOpen.denominationTotal))}</strong>
                </div>
              )}
              {detailOpen.varianceNote && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border rounded text-xs">
                  <strong>Variance Note:</strong> {detailOpen.varianceNote}
                </div>
              )}
              {detailOpen.notes && (
                <div className="p-2 bg-muted/30 border rounded text-xs">
                  <strong>Handover Notes:</strong> {detailOpen.notes}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!detailOpen || printingId === detailOpen.id}
              onClick={() => detailOpen && printClosure(detailOpen)}
            >
              <Printer size={14} className="mr-2" />
              {detailOpen && printingId === detailOpen.id ? "Loading…" : "Print"}
            </Button>
            <Button onClick={() => setDetailOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
