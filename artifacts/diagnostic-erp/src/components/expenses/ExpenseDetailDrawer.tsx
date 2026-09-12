import { useEffect, useState } from "react";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { FileImage, IndianRupee, Loader2, Ban, Wallet } from "lucide-react";
import { AccountingStatusBadge, PaymentStatusBadge } from "./ExpenseStatusBadges";
import {
  billOf,
  dueOf,
  paidOf,
  vendorLabel,
  type AccountOption,
  type ExpensePaymentRow,
  type ExpenseV2,
} from "./expenseTypes";

const PAYMENT_MODES = ["cash", "bank-transfer", "cheque", "upi", "card"];

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

type Props = {
  expense: ExpenseV2 | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  departments?: Array<{ id: number; name: string }>;
  onChanged: () => void;
  onViewReceipt: (exp: ExpenseV2) => void;
  /** Open the record-payment form when the drawer loads (e.g. from Payables). */
  initialShowPay?: boolean;
};

export default function ExpenseDetailDrawer({
  expense,
  open,
  onOpenChange,
  accounts,
  departments = [],
  onChanged,
  onViewReceipt,
  initialShowPay = false,
}: Props) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<ExpenseV2 | null>(null);
  const [payments, setPayments] = useState<ExpensePaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [payForm, setPayForm] = useState({
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMode: "cash",
    paidFromAccountId: "",
    referenceNumber: "",
    notes: "",
  });

  useEffect(() => {
    if (!open || !expense) {
      setDetail(null);
      setPayments([]);
      setShowPay(false);
      setShowVoid(false);
      setVoidReason("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setShowPay(false);
    setShowVoid(false);
    setVoidReason("");
    (async () => {
      try {
        const [full, pays] = await Promise.all([
          api.get<ExpenseV2>(`/api/expenses/${expense.id}`),
          api.get<ExpensePaymentRow[]>(`/api/expenses/${expense.id}/payments`),
        ]);
        if (cancelled) return;
        setDetail(full);
        setPayments(Array.isArray(pays) ? pays : []);
        const due = dueOf(full);
        setPayForm({
          amount: due > 0 ? String(due) : "",
          paymentDate: new Date().toISOString().slice(0, 10),
          paymentMode: full.paymentMode || "cash",
          paidFromAccountId: "",
          referenceNumber: "",
          notes: "",
        });
        const status = (full.paymentStatus || "").toUpperCase();
        if (initialShowPay && (status === "DUE" || status === "PART_PAID")) {
          setShowPay(true);
        }
      } catch {
        if (!cancelled) {
          setDetail(expense);
          toast({ title: "Could not load expense detail", variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, expense?.id, initialShowPay]);

  const exp = detail || expense;
  if (!exp) return null;

  const status = (exp.paymentStatus || "").toUpperCase();
  const canPay = status === "DUE" || status === "PART_PAID";
  const canVoid = status !== "VOID";

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid payment amount", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/expenses/${exp!.id}/payments`, {
        amount,
        paymentDate: payForm.paymentDate,
        paymentMode: payForm.paymentMode,
        paidFromAccountId: payForm.paidFromAccountId ? Number(payForm.paidFromAccountId) : null,
        referenceNumber: payForm.referenceNumber || null,
        notes: payForm.notes || null,
      });
      toast({ title: "Payment recorded" });
      setShowPay(false);
      onChanged();
      const [full, pays] = await Promise.all([
        api.get<ExpenseV2>(`/api/expenses/${exp!.id}`),
        api.get<ExpensePaymentRow[]>(`/api/expenses/${exp!.id}/payments`),
      ]);
      setDetail(full);
      setPayments(Array.isArray(pays) ? pays : []);
    } catch (err) {
      toast({
        title: "Payment failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitVoid(e: React.FormEvent) {
    e.preventDefault();
    const reason = voidReason.trim();
    if (reason.length < 3) {
      toast({ title: "Void reason required", description: "Enter at least 3 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/expenses/${exp!.id}/void`, { reason });
      toast({ title: "Expense voided" });
      setShowVoid(false);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Void failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const paidFromAccounts = accounts.filter((a) => a.isActive !== false && (a.type === "cash" || a.type === "bank"));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{exp.expenseId}</SheetTitle>
          <SheetDescription className="text-left">
            {exp.description}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <PaymentStatusBadge status={exp.paymentStatus} />
              <AccountingStatusBadge status={exp.accountingStatus} />
              {exp.hasReceipt || exp.receiptImageUrl ? (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onViewReceipt(exp)}>
                  <FileImage size={12} className="mr-1" /> Receipt
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-card-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Bill</p>
                <p className="text-sm font-bold mt-0.5">{inr(billOf(exp))}</p>
              </div>
              <div className="rounded-lg border border-card-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid</p>
                <p className="text-sm font-bold mt-0.5 text-green-700">{inr(paidOf(exp))}</p>
              </div>
              <div className="rounded-lg border border-card-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Due</p>
                <p className="text-sm font-bold mt-0.5 text-red-700">{inr(dueOf(exp))}</p>
              </div>
            </div>

            <div className="text-sm space-y-1.5">
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Vendor</span><span className="font-medium text-right">{vendorLabel(exp)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Date</span><span>{new Date(exp.expenseDate + "T00:00:00").toLocaleDateString("en-IN")}</span></div>
              <div className="flex justify-between gap-2"><span className="text-muted-foreground">Category</span><span className="capitalize">{exp.category}</span></div>
              {exp.departmentId ? (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Department</span>
                  <span>{departments.find((d) => d.id === exp.departmentId)?.name || `#${exp.departmentId}`}</span>
                </div>
              ) : null}
              {exp.invoiceNumber ? (
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Invoice #</span><span>{exp.invoiceNumber}</span></div>
              ) : null}
              {exp.invoiceDate ? (
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Invoice date</span><span>{exp.invoiceDate}</span></div>
              ) : null}
              {exp.approvedBy ? (
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Approved by</span><span>{exp.approvedBy}</span></div>
              ) : null}
              <div className="flex justify-between gap-2 gap-y-1 flex-wrap">
                <span className="text-muted-foreground">Linked vouchers</span>
                <span className="text-right text-xs font-mono">
                  {exp.voucherId ? `payment #${exp.voucherId}` : "payment —"}
                  {" · "}
                  {exp.accrualVoucherId ? `accrual #${exp.accrualVoucherId}` : "accrual —"}
                </span>
              </div>
              {exp.notes ? (
                <div className="pt-1 text-xs text-muted-foreground">{exp.notes}</div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Payment history</h3>
                {canPay && (
                  <Button size="sm" className="h-7 text-xs" onClick={() => { setShowPay(true); setShowVoid(false); }}>
                    <Wallet size={12} className="mr-1" /> Record Payment
                  </Button>
                )}
              </div>
              {payments.filter((p) => !p.reversedAt).length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No payments yet — balance is fully due.</p>
              ) : (
                <div className="border border-card-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 border-b border-card-border">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Date</th>
                        <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Mode</th>
                        <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className={`border-b border-card-border last:border-0 ${p.reversedAt ? "opacity-40 line-through" : ""}`}>
                          <td className="px-2 py-1.5">
                            <div>{new Date(p.paymentDate + "T00:00:00").toLocaleDateString("en-IN")}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{p.paymentPublicId}</div>
                            {p.voucherId ? (
                              <div className="font-mono text-[10px] text-muted-foreground">voucher #{p.voucherId}</div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 capitalize">{(p.paymentMode || "").replace("-", " ")}</td>
                          <td className="px-2 py-1.5 text-right font-semibold">{inr(Number(p.amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {showPay && canPay && (
              <form onSubmit={submitPayment} className="space-y-3 border border-card-border rounded-lg p-3 bg-muted/10">
                <h4 className="text-sm font-semibold">Record payment</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Amount *</Label>
                    <div className="relative">
                      <IndianRupee size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="pl-7 h-8 text-sm"
                        value={payForm.amount}
                        onChange={(ev) => setPayForm({ ...payForm, amount: ev.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Payment date *</Label>
                    <Input
                      type="date"
                      className="h-8 text-sm"
                      value={payForm.paymentDate}
                      onChange={(ev) => setPayForm({ ...payForm, paymentDate: ev.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mode *</Label>
                    <Select value={payForm.paymentMode} onValueChange={(v) => setPayForm({ ...payForm, paymentMode: v })}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_MODES.map((m) => (
                          <SelectItem key={m} value={m} className="capitalize">{m.replace("-", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Paid from</Label>
                    <Select
                      value={payForm.paidFromAccountId || "none"}
                      onValueChange={(v) => setPayForm({ ...payForm, paidFromAccountId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {paidFromAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Reference</Label>
                    <Input className="h-8 text-sm" value={payForm.referenceNumber} onChange={(ev) => setPayForm({ ...payForm, referenceNumber: ev.target.value })} placeholder="UTR / cheque no." />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Notes</Label>
                    <Input className="h-8 text-sm" value={payForm.notes} onChange={(ev) => setPayForm({ ...payForm, notes: ev.target.value })} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPay(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving…" : "Save payment"}</Button>
                </div>
              </form>
            )}

            {canVoid && (
              <div className="pt-2 border-t border-card-border">
                {!showVoid ? (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 text-xs" onClick={() => { setShowVoid(true); setShowPay(false); }}>
                    <Ban size={12} className="mr-1" /> Void expense
                  </Button>
                ) : (
                  <form onSubmit={submitVoid} className="space-y-2">
                    <Label className="text-xs">Void reason (min 3 characters) *</Label>
                    <Input
                      value={voidReason}
                      onChange={(ev) => setVoidReason(ev.target.value)}
                      placeholder="Why is this bill being voided?"
                      required
                      minLength={3}
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowVoid(false)}>Cancel</Button>
                      <Button type="submit" size="sm" variant="destructive" disabled={saving || voidReason.trim().length < 3}>
                        {saving ? "Voiding…" : "Confirm void"}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
