import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link2, Send, Search, ShieldAlert, CheckCircle2, Copy } from "lucide-react";

type BillLookup = { id: number; billNumber: string; status: string; totalAmount: number; paidAmount: number; balanceAmount: number; patient: { id: number; name: string; phone: string; email: string | null } | null };
type Derived = { paid: boolean; gatewaySucceeded: boolean; billBalance: number | null; billStatus: string | null };
type PayLink = { id: number; billId: number; amount: string; redirectUrl: string | null; status: string; sentTo: string | null; createdAt: string; derived?: Derived };

export default function PaymentLinks() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [billNumber, setBillNumber] = useState("");
  const [bill, setBill] = useState<BillLookup | null>(null);
  const [amount, setAmount] = useState("");
  const [gateOff, setGateOff] = useState(false);

  const lookupMut = useMutation({
    mutationFn: (bn: string) => api.get<BillLookup>(`/api/bill-payment-links/bill/${encodeURIComponent(bn)}`),
    onSuccess: (b) => { setBill(b); setAmount(String(b.balanceAmount || "")); },
    onError: (e) => {
      const msg = (e as Error).message || "";
      if (msg.includes("disabled") || msg.includes("503")) setGateOff(true);
      else { setBill(null); toast({ title: "Not found", description: msg, variant: "destructive" }); }
    },
  });

  const createMut = useMutation({
    mutationFn: () => api.post<PayLink>("/api/bill-payment-links/create", { billId: bill!.id, amount: Number(amount) }),
    onSuccess: () => { toast({ title: "Payment link created" }); qc.invalidateQueries({ queryKey: ["pay-links", bill?.id] }); },
    onError: (e) => toast({ title: "Create failed", description: (e as Error).message, variant: "destructive" }),
  });

  const linksQ = useQuery({
    queryKey: ["pay-links", bill?.id],
    queryFn: () => api.get<PayLink[]>(`/api/bill-payment-links/by-bill/${bill!.id}`),
    enabled: !!bill,
  });

  const sendMut = useMutation({
    mutationFn: (id: number) => api.post(`/api/bill-payment-links/${id}/send`, {}),
    onSuccess: () => { toast({ title: "Link sent on WhatsApp" }); qc.invalidateQueries({ queryKey: ["pay-links", bill?.id] }); },
    onError: (e) => toast({ title: "Send failed", description: (e as Error).message, variant: "destructive" }),
  });

  if (gateOff) {
    return (
      <div className="space-y-4">
        <PageHeader title="Payment Links" subtitle="Online payment links for bills" />
        <Card className="min-h-[280px] flex items-center justify-center">
          <div className="text-center text-muted-foreground max-w-sm px-6">
            <ShieldAlert className="h-9 w-9 mx-auto mb-2 opacity-60" />
            <p className="text-sm font-medium mb-1">Online payment links are in Shadow Mode</p>
            <p className="text-xs">Enable the ff_online_payment_links feature flag (owner sign-off) to generate payment links.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Payment Links" subtitle="Generate & send online payment links (full or partial) for a bill" />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4" /> Find a bill</CardTitle></CardHeader>
        <CardContent className="flex gap-2 items-end">
          <div className="flex-1 max-w-xs"><Label className="text-xs">Bill number</Label><Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="e.g. INV-2026-000123" onKeyDown={(e) => e.key === "Enter" && billNumber && lookupMut.mutate(billNumber)} /></div>
          <Button onClick={() => lookupMut.mutate(billNumber)} disabled={!billNumber || lookupMut.isPending}>Look up</Button>
        </CardContent>
      </Card>

      {bill && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Bill {bill.billNumber}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Patient</div>{bill.patient?.name || "—"}</div>
              <div><div className="text-xs text-muted-foreground">Total</div>₹{bill.totalAmount.toFixed(2)}</div>
              <div><div className="text-xs text-muted-foreground">Paid</div>₹{bill.paidAmount.toFixed(2)}</div>
              <div><div className="text-xs text-muted-foreground">Balance</div><span className="font-semibold">₹{bill.balanceAmount.toFixed(2)}</span></div>
            </div>
            {bill.balanceAmount > 0 ? (
              <div className="flex gap-2 items-end">
                <div className="max-w-[160px]"><Label className="text-xs">Amount (partial allowed)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} max={bill.balanceAmount} /></div>
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !amount || Number(amount) <= 0 || Number(amount) > bill.balanceAmount + 0.01}>
                  <Link2 className="h-4 w-4 mr-1.5" /> Create link
                </Button>
              </div>
            ) : (
              <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"><CheckCircle2 className="h-3 w-3 mr-1" /> Fully paid</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {bill && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Payment links for this bill</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(linksQ.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No links yet.</p> :
              (linksQ.data ?? []).map((l) => (
                <div key={l.id} className="flex items-center gap-3 rounded-md border p-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">₹{Number(l.amount).toFixed(2)}
                      {l.derived?.paid ? <Badge variant="outline" className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Paid</Badge>
                        : <Badge variant="outline" className="ml-2">{l.status}</Badge>}
                    </div>
                    {l.redirectUrl && <div className="text-xs text-muted-foreground truncate max-w-[420px]">{l.redirectUrl}</div>}
                  </div>
                  {l.redirectUrl && (
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(l.redirectUrl!); toast({ title: "Link copied" }); }}><Copy className="h-3.5 w-3.5" /></Button>
                  )}
                  {!l.derived?.paid && l.redirectUrl && (
                    <Button size="sm" variant="outline" onClick={() => sendMut.mutate(l.id)} disabled={sendMut.isPending}><Send className="h-3.5 w-3.5 mr-1" /> WhatsApp</Button>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
