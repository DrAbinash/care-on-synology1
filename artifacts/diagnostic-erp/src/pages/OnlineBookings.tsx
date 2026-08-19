import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, RefreshCw, CheckCircle2, XCircle, Eye, Globe, Star,
  CreditCard, Phone, Calendar, FileText, User, Clock, Plus,
} from "lucide-react";
import { Link } from "wouter";
import { NewOnlineBookingDialog } from "./NewOnlineBookingDialog";

type OnlineBooking = {
  id: number;
  bookingRef: string;
  name: string;
  phone: string;
  email: string;
  selectedDate: string;
  timeSlot: string;
  testIds: string;
  packageIds: string;
  totalAmount: string;
  notes: string;
  isVip: boolean;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  status: string;
  patientId: number | null;
  billId: number | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  createdAt: string;
  source?: string;
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-yellow-100 text-yellow-800 border-yellow-300",
  paid:            "bg-blue-100 text-blue-800 border-blue-300",
  confirmed:       "bg-emerald-100 text-emerald-800 border-emerald-300",
  payment_failed: "bg-red-100 text-red-800 border-red-300",
  cancelled:       "bg-gray-100 text-gray-800 border-gray-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: "Pending Payment",
  paid:            "Paid – Awaiting Confirm",
  confirmed:       "Confirmed",
  cancelled:       "Cancelled",
  payment_failed:  "Payment Failed",
};

const SOURCE_LABELS: Record<string, string> = {
  website: "Website",
  kiosk: "Kiosk",
  reception: "Reception",
  phone: "Phone",
};

export default function OnlineBookingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OnlineBooking | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { data, isFetching, refetch } = useQuery<{ bookings: OnlineBooking[] }>({
    queryKey: ["online-bookings", status, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status !== "all") p.set("status", status);
      if (search.trim()) p.set("search", search.trim());
      return api.get(`/api/online-bookings?${p.toString()}`);
    },
    refetchInterval: 30_000,
  });

  const bookings = data?.bookings ?? [];

  const confirmMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/online-bookings/${id}/confirm`, {}),
    onSuccess: (res: { billId: number; dueAtCentre?: boolean }) => {
      qc.invalidateQueries({ queryKey: ["online-bookings"] });
      setConfirmOpen(false);
      toast({
        title: res.dueAtCentre ? "Booking confirmed — due at Billing Desk" : "Booking confirmed",
        description: res.dueAtCentre
          ? `Unpaid bill #${res.billId} created. Collect cash/UPI/card at Billing Desk — this does not post Online Collections.`
          : `Bill #${res.billId} created and tokens issued.`,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/online-bookings/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["online-bookings"] });
      setCancelOpen(false);
      toast({ title: "Booking cancelled" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const paidCount = bookings.filter((b) => b.status === "paid").length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader
        title="Online Bookings"
        subtitle={`Website, kiosk, phone and reception · ${paidCount > 0 ? `${paidCount} awaiting confirmation` : "All confirmed"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus size={13} className="mr-1" />
              New Booking
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} className={`mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="bg-card border border-card-border rounded-xl p-4 flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending_payment">Pending Payment</SelectItem>
            <SelectItem value="paid">Paid – Awaiting Confirm</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="payment_failed">Payment Failed</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, ref…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {bookings.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl py-20 text-center">
          <Globe size={32} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-base font-medium">No online bookings found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Bookings from the clinic website, kiosk, phone, and reception appear here.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">Ref</th>
                  <th className="px-4 py-3 text-left font-medium">Patient</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Booked</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-bold text-primary">{b.bookingRef}</div>
                      {b.isVip && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 mt-0.5">
                          <Star size={9} className="fill-amber-500" /> VIP
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone size={10} /> {b.phone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Calendar size={12} />
                        <span>{b.selectedDate}</span>
                      </div>
                      {b.timeSlot && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Clock size={10} /> {b.timeSlot}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      ₹{Number(b.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[b.status] ?? "bg-zinc-100 text-zinc-700 border-zinc-300"}`}>
                        {STATUS_LABELS[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {SOURCE_LABELS[b.source || "website"] || b.source || "Website"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(b.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => { setSelected(b); }}
                        >
                          <Eye size={12} className="mr-1" /> View
                        </Button>
                        {b.status === "paid" && (
                          <Button
                            size="sm" variant="default"
                            className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => { setSelected(b); setConfirmOpen(true); }}
                          >
                            <CheckCircle2 size={12} className="mr-1" /> Confirm
                          </Button>
                        )}
                        {b.status === "pending_payment" && (b.source === "reception" || b.source === "phone") && (
                          <Button
                            size="sm" variant="default"
                            className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => { setSelected(b); setConfirmOpen(true); }}
                          >
                            <CheckCircle2 size={12} className="mr-1" /> Confirm (Pay at Centre)
                          </Button>
                        )}
                        {(b.status === "paid" || b.status === "pending_payment") && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => { setSelected(b); setCancelOpen(true); }}
                          >
                            <XCircle size={12} className="mr-1" /> Cancel
                          </Button>
                        )}
                        {b.status === "pending_payment" && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={async () => {
                              try {
                                const r = await api.post<{ url: string; linkId: string }>(`/api/online-bookings/${b.id}/payment-link`, {});
                                if (r.url && navigator.clipboard) await navigator.clipboard.writeText(r.url);
                                toast({ title: "Payment link created", description: r.url ? "Link copied to clipboard. Share via WhatsApp or SMS." : "Link created but not copied." });
                              } catch (e: unknown) {
                                toast({ title: "Error", description: (e as { message?: string }).message || "Could not create link", variant: "destructive" });
                              }
                            }}
                          >
                            <CreditCard size={12} className="mr-1" /> Share Link
                          </Button>
                        )}
                        {b.status === "confirmed" && b.billId && (
                          <Link href={`/billing/${b.billId}`}>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                              <FileText size={12} className="mr-1" /> Bill
                            </Button>
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selected && !confirmOpen && !cancelOpen && (
        <Dialog open onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Booking {selected.bookingRef}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><span className="text-muted-foreground">Name</span><p className="font-medium">{selected.name}</p></div>
                <div><span className="text-muted-foreground">Phone</span><p className="font-medium">{selected.phone}</p></div>
                <div><span className="text-muted-foreground">Email</span><p className="font-medium">{selected.email || "—"}</p></div>
                <div><span className="text-muted-foreground">Date</span><p className="font-medium">{selected.selectedDate}</p>{selected.timeSlot && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Clock size={10} />{selected.timeSlot}</p>}</div>
                <div><span className="text-muted-foreground">Amount</span><p className="font-semibold text-primary">₹{Number(selected.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p></div>
                <div><span className="text-muted-foreground">VIP</span><p>{selected.isVip ? <span className="text-amber-600 font-semibold flex items-center gap-1"><Star size={12} className="fill-amber-500" />Yes</span> : "No"}</p></div>
              </div>
              {selected.notes && (
                <div><span className="text-muted-foreground block mb-1">Notes</span><p className="bg-muted/40 rounded p-2 text-sm">{selected.notes}</p></div>
              )}
              <div>
                <span className="text-muted-foreground block mb-1">Payment</span>
                <div className="bg-muted/40 rounded p-2 text-xs font-mono space-y-0.5">
                  <div>Order: {selected.razorpayOrderId || "—"}</div>
                  <div>Payment: {selected.razorpayPaymentId || "—"}</div>
                </div>
              </div>
              {selected.status === "confirmed" && (
                <div className="flex gap-2">
                  {selected.patientId && (
                    <Link href={`/patients/${selected.patientId}`}>
                      <Button size="sm" variant="outline"><User size={12} className="mr-1" /> Patient</Button>
                    </Link>
                  )}
                  {selected.billId && (
                    <Link href={`/billing/${selected.billId}`}>
                      <Button size="sm" variant="outline"><FileText size={12} className="mr-1" /> View Bill</Button>
                    </Link>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              {selected.status === "paid" && (
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmOpen(true)}>
                  <CheckCircle2 size={14} className="mr-1.5" /> Confirm & Issue Tokens
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Confirm dialog */}
      {selected && confirmOpen && (
        <Dialog open onOpenChange={() => setConfirmOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Online Booking</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Confirming <strong>{selected.bookingRef}</strong> for <strong>{selected.name}</strong> will:</p>
              {(selected.source === "reception" || selected.source === "phone") && selected.status === "pending_payment" ? (
                <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                  <li>Create or link the patient record</li>
                  <li>Create an order and an <strong className="text-foreground">unpaid bill</strong> (₹{Number(selected.totalAmount).toLocaleString("en-IN")} due)</li>
                  <li>Not record a payment and not post Online Collections / ICICI</li>
                  <li>Issue queue tokens {selected.isVip ? "(VIP priority)" : "(online queue)"}</li>
                  <li>Collect cash / UPI / card later at Billing Desk — that is what posts accounts</li>
                </ul>
              ) : (
                <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                  <li>Create or link the patient record</li>
                  <li>Create an order and a paid bill (₹{Number(selected.totalAmount).toLocaleString("en-IN")})</li>
                  <li>Issue queue tokens {selected.isVip ? "(VIP priority)" : "(online queue)"}</li>
                </ul>
              )}
              <p className="text-muted-foreground">Appointment date: <strong className="text-foreground">{selected.selectedDate}</strong>{selected.timeSlot && <> · <strong className="text-foreground">{selected.timeSlot}</strong></>}</p>
            </div>
            <DialogFooter>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => confirmMutation.mutate(selected.id)}
                disabled={confirmMutation.isPending}
              >
                <CheckCircle2 size={14} className="mr-1.5" />
                {confirmMutation.isPending ? "Confirming…" : "Confirm Booking"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Cancel dialog */}
      {selected && cancelOpen && (
        <Dialog open onOpenChange={() => setCancelOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel Booking?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Cancel <strong className="text-foreground">{selected.bookingRef}</strong> for {selected.name}?
              The patient will need to be notified separately about any refund.
            </p>
            <DialogFooter>
              <Button
                variant="destructive"
                onClick={() => cancelMutation.mutate(selected.id)}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "Cancelling…" : "Yes, Cancel Booking"}
              </Button>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep Booking</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <NewOnlineBookingDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={async (booking, paymentChoice) => {
          qc.invalidateQueries({ queryKey: ["online-bookings"] });
          setNewOpen(false);
          if (paymentChoice === "link") {
            try {
              const r = await api.post<{ url: string; linkId: string }>(`/api/online-bookings/${booking.id}/payment-link`, {});
              if (r.url && navigator.clipboard) await navigator.clipboard.writeText(r.url);
              toast({
                title: "Booking saved · payment link ready",
                description: r.url
                  ? `${booking.bookingRef} · Link copied to clipboard. Share via WhatsApp or SMS.`
                  : `${booking.bookingRef} created.`,
              });
            } catch (e: unknown) {
              toast({
                title: "Booking saved",
                description: `${booking.bookingRef} created, but the payment link could not be generated: ${(e as { message?: string }).message || "no gateway configured"}. Use Pay at Centre or Share Link from the list.`,
              });
            }
          } else {
            toast({
              title: "Booking saved — pay at centre",
              description: `${booking.bookingRef} is holding the slot. Confirm when the patient arrives to create an unpaid bill, then collect at Billing Desk.`,
            });
          }
        }}
      />
    </div>
  );
}
