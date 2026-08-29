import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2, AlertTriangle, Receipt, Wallet, Printer } from "lucide-react";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  autoPrintStaffDayClose,
  openStaffDayClosePrint,
  type StaffPrintActivity,
  type StaffSlipClinic,
  type StaffSlipClosure,
} from "@/lib/staffDayCloseSlip";

type MethodTotals = {
  cash: number; upi: number; card: number; cheque: number; other: number;
  total: number; count: number;
};

export type StaffWindowBill = {
  id: number;
  billNumber: string;
  patientName: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  createdByName: string;
  createdAt: string;
};

type StaffPreview = {
  userName: string;
  coveredFromTs: string | null;
  coveredToTs: string;
  expected: MethodTotals;
  billsCount: number;
  paymentsCount: number;
  totalBilled: number;
  totalDue: number;
  bills: StaffWindowBill[];
};

type StaffCloseResult = StaffSlipClosure & {
  bills: StaffWindowBill[];
  printActivity?: StaffPrintActivity | null;
  emailSent?: boolean;
  emailSkipReason?: string;
};

const inr = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);

const fmtIst = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })
    : "Beginning of records";

function nv(v: string | number | undefined | null): number {
  return Number(v ?? 0) || 0;
}

function BillsMadeTable({ bills }: { bills: StaffWindowBill[] }) {
  if (bills.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">No bills in this window.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-card-border max-h-56 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 sticky top-0">
          <tr>
            <th className="px-2.5 py-1.5 text-left font-semibold">Bill #</th>
            <th className="px-2.5 py-1.5 text-left font-semibold">Patient</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Total</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Paid</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Due</th>
            <th className="px-2.5 py-1.5 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {bills.map((b) => (
            <tr key={b.id} className="hover:bg-muted/20">
              <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                <Link href={`/billing/${b.id}`} className="text-primary hover:underline">{b.billNumber}</Link>
              </td>
              <td className="px-2.5 py-1.5 max-w-[140px] truncate">{b.patientName}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{inr(b.totalAmount)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums text-green-700 dark:text-green-400">{inr(b.paidAmount)}</td>
              <td className={`px-2.5 py-1.5 text-right tabular-nums ${b.balanceAmount > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>
                {b.balanceAmount > 0 ? inr(b.balanceAmount) : "—"}
              </td>
              <td className="px-2.5 py-1.5 capitalize">{b.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Owner/admin closes one staff member's day during the cash handover.
 * Shows the staff member's expected collections and the bills they made in
 * the open window, records the physically counted amounts, and on success
 * shows the bills that were just closed.
 */
export default function StaffDayCloseDialog({
  userName,
  open,
  onOpenChange,
}: {
  userName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const previewQ = useQuery<StaffPreview>({
    queryKey: ["staff-day-close-preview", userName],
    queryFn: () => api.get<StaffPreview>(`/api/day-close/staff-preview/${encodeURIComponent(userName!)}`),
    enabled: open && !!userName,
    staleTime: 0,
  });

  const clinicQ = useQuery<StaffSlipClinic>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get<StaffSlipClinic>("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });

  const [actuals, setActuals] = useState({ cash: "", upi: "", card: "", cheque: "", other: "" });
  const [varianceNote, setVarianceNote] = useState("");
  const [notes, setNotes] = useState("");
  const [justClosed, setJustClosed] = useState<StaffCloseResult | null>(null);

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

  const totalActual = useMemo(
    () => nv(actuals.cash) + nv(actuals.upi) + nv(actuals.card) + nv(actuals.cheque) + nv(actuals.other),
    [actuals],
  );
  const totalExpected = previewQ.data?.expected.total ?? 0;
  const variance = totalActual - totalExpected;
  const canClose = !previewQ.isLoading && (variance === 0 || varianceNote.trim().length >= 3);

  const closeMut = useMutation<StaffCloseResult>({
    mutationFn: () =>
      api.post<StaffCloseResult>("/api/day-close/staff-close", {
        userName,
        actuals: {
          cash: nv(actuals.cash),
          upi: nv(actuals.upi),
          card: nv(actuals.card),
          cheque: nv(actuals.cheque),
          other: nv(actuals.other),
        },
        varianceNote,
        notes,
      }),
    onSuccess: (row) => {
      const emailNote = row.emailSent === false
        ? ` Email was not sent: ${row.emailSkipReason || "check Email Settings."}`
        : "";
      toast({
        title: `${row.userName}'s day closed`,
        description: (nv(row.variance) === 0 ? "Balanced." : `Variance: ${inr(nv(row.variance))}`) + emailNote,
        variant: row.emailSent === false ? "destructive" : undefined,
      });
      setJustClosed(row);
      qc.invalidateQueries({ queryKey: ["day-close-staff-status"] });
      qc.invalidateQueries({ queryKey: ["day-close-preview"] });
      qc.invalidateQueries({ queryKey: ["day-close-list"] });
      qc.invalidateQueries({ queryKey: ["staff-day-close-preview", userName] });
      if (clinicQ.data?.dayCloseAutoPrint !== false) {
        autoPrintStaffDayClose(row, clinicQ.data ?? {}, row.userName);
      }
    },
    onError: (e: Error) => toast({ title: "Close failed", description: e.message, variant: "destructive" }),
  });

  const close = (o: boolean) => {
    if (!o) {
      setJustClosed(null);
      setVarianceNote("");
      setNotes("");
      setActuals({ cash: "", upi: "", card: "", cheque: "", other: "" });
    }
    onOpenChange(o);
  };

  const expected = previewQ.data?.expected;
  const expectedDigital = (expected?.upi ?? 0) + (expected?.card ?? 0) + (expected?.cheque ?? 0) + (expected?.other ?? 0);
  const actualDigital = nv(actuals.upi) + nv(actuals.card) + nv(actuals.cheque) + nv(actuals.other);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock size={16} />
            {justClosed ? `Closed — ${justClosed.userName}` : `Close Day — ${userName}`}
          </DialogTitle>
        </DialogHeader>

        {justClosed ? (
          <div className="space-y-4 text-sm">
            <div className={`p-3 rounded-lg border flex items-start gap-2 ${
              justClosed.drawerStatus === "balanced"
                ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800"
            }`}>
              {justClosed.drawerStatus === "balanced"
                ? <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
                : <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />}
              <div>
                <p className="font-bold">
                  {justClosed.drawerStatus === "balanced" ? "Balanced" : `Mismatch — variance ${inr(nv(justClosed.variance))}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Expected {inr(nv(justClosed.totalExpected))} · Counted {inr(nv(justClosed.totalActual))} ·{" "}
                  New bills by {justClosed.userName} now count toward the next window.
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Receipt size={12} /> Bills made in this close ({justClosed.bills.length})
              </p>
              <BillsMadeTable bills={justClosed.bills} />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => openStaffDayClosePrint(justClosed, clinicQ.data ?? {}, justClosed.userName)}>
                <Printer size={14} className="mr-2" /> Print
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {previewQ.isLoading && <p className="text-sm text-muted-foreground">Loading {userName}'s window…</p>}
            {previewQ.data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div><div className="text-muted-foreground">Window from</div><div className="font-medium">{fmtIst(previewQ.data.coveredFromTs)}</div></div>
                  <div><div className="text-muted-foreground">Window to</div><div className="font-medium">{fmtIst(previewQ.data.coveredToTs)}</div></div>
                  <div><div className="text-muted-foreground">Bills made</div><div className="font-bold text-base">{previewQ.data.billsCount}</div></div>
                  <div><div className="text-muted-foreground">Total billed</div><div className="font-bold text-base">{inr(previewQ.data.totalBilled)}</div></div>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Receipt size={12} /> Bills made ({previewQ.data.bills.length})
                  </p>
                  <BillsMadeTable bills={previewQ.data.bills} />
                </div>

                <div className="grid gap-3 md:grid-cols-5">
                  {(["cash", "upi", "card", "cheque", "other"] as const).map((m) => {
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
                        <div className="text-xs mt-1 flex items-center justify-between">
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

                <div className="grid grid-cols-3 gap-3 p-3 bg-muted/30 rounded-lg">
                  <div><div className="text-xs text-muted-foreground">Expected</div><div className="text-base font-bold">{inr(totalExpected)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Counted</div><div className="text-base font-bold">{inr(totalActual)}</div></div>
                  <div>
                    <div className="text-xs text-muted-foreground">Variance</div>
                    <div className={`text-base font-bold ${variance === 0 ? "text-green-600" : variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                      {variance === 0 ? "Balanced ✓" : `${variance < 0 ? "−" : "+"}${inr(Math.abs(variance))}`}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-2">
                  Cash expected {inr(expected?.cash ?? 0)} · Digital expected {inr(expectedDigital)} · Counted digital {inr(actualDigital)}
                </p>

                {variance !== 0 && (
                  <div>
                    <Label>
                      Variance Note <span className="text-red-600">*</span>
                    </Label>
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
                  <Label className="flex items-center gap-1"><Wallet size={12} /> Handover Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Cash handed over in person, UPI verified on clinic phone."
                    className="mt-1"
                    rows={2}
                  />
                </div>
              </>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button
                onClick={() => closeMut.mutate()}
                disabled={!canClose || closeMut.isPending}
                className="bg-blue-700 hover:bg-blue-800"
              >
                <Lock size={14} className="mr-1.5" />
                {closeMut.isPending ? "Closing…" : `Close ${userName}'s Day`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
