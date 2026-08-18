import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";
import { Search, UserPlus, CreditCard, Building2 } from "lucide-react";

type PatientHit = {
  id: number;
  patientId: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender?: string;
  ageValue?: number | null;
  ageUnit?: string | null;
  email?: string | null;
};

type CatalogTest = { id: number; code: string; name: string; category: string; price: string };
type CatalogPkg = { id: number; code: string; name: string; price: string };
type SlotOpt = {
  value: string;
  label: string;
  maxBookings?: number | null;
  modality?: string;
  booked?: number;
  remaining?: number | null;
  available?: boolean;
};

type Booking = {
  id: number;
  bookingRef: string;
  totalAmount: string;
  status: string;
};

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function slotKey(s: SlotOpt) {
  return s.modality ? `${s.modality}::${s.value}` : s.value;
}

export function NewOnlineBookingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (booking: Booking, paymentChoice: "link" | "pay_at_centre") => void;
}) {
  const { toast } = useToast();
  const session = readStaffSession();
  const isAdmin = FULL_ACCESS_ROLES.has(normalizeRole(session?.user?.role || ""));

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [newPt, setNewPt] = useState({ firstName: "", lastName: "", phone: "", gender: "male", ageValue: "30", ageUnit: "years" });

  const [source, setSource] = useState<"reception" | "phone">("phone");
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [slot, setSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [testQuery, setTestQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setPatient(null);
      setCreatingPatient(false);
      setSelTests(new Set());
      setSelPkgs(new Set());
      setSlot("");
      setNotes("");
      setOverrideCapacity(false);
      setOverrideReason("");
      setDate(todayISO());
    }
  }, [open]);

  const { data: hits } = useQuery<{ patients: PatientHit[] }>({
    queryKey: ["ob-patient-search", debounced],
    queryFn: () => api.get(`/api/patients?search=${encodeURIComponent(debounced)}&limit=8`),
    enabled: open && !patient && debounced.length >= 2,
  });

  const { data: catalog } = useQuery<{ tests: CatalogTest[]; packages: CatalogPkg[]; slots: SlotOpt[]; vipQueueEnabled: boolean }>({
    queryKey: ["online-bookings-catalog"],
    queryFn: () => api.get("/api/online-bookings/catalog"),
    enabled: open,
  });

  const testIdsCsv = [...selTests].join(",");
  const pkgIdsCsv = [...selPkgs].join(",");
  const { data: liveSlots } = useQuery<{ slots: SlotOpt[] }>({
    queryKey: ["online-bookings-slots", date, testIdsCsv, pkgIdsCsv],
    queryFn: () => api.get(`/api/online-bookings/slots?date=${encodeURIComponent(date)}&testIds=${testIdsCsv}&packageIds=${pkgIdsCsv}`),
    enabled: open && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });

  const slots = liveSlots?.slots ?? catalog?.slots ?? [];
  const tests = catalog?.tests ?? [];
  const pkgs = catalog?.packages ?? [];

  const filteredTests = tests.filter((t) => {
    if (!testQuery.trim()) return true;
    const q = testQuery.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  });

  const total = useMemo(() => {
    const t = tests.filter((x) => selTests.has(x.id)).reduce((s, x) => s + Number(x.price), 0);
    const p = pkgs.filter((x) => selPkgs.has(x.id)).reduce((s, x) => s + Number(x.price), 0);
    return t + p;
  }, [tests, pkgs, selTests, selPkgs]);

  const createPatient = useMutation({
    mutationFn: async () => {
      const age = Number(newPt.ageValue);
      const now = new Date();
      if (newPt.ageUnit === "months") now.setMonth(now.getMonth() - age);
      else if (newPt.ageUnit === "days") now.setDate(now.getDate() - age);
      else now.setFullYear(now.getFullYear() - age);
      const dateOfBirth = now.toISOString().slice(0, 10);
      return api.post<PatientHit>("/api/patients", {
        firstName: newPt.firstName.trim(),
        lastName: newPt.lastName.trim() || ".",
        phone: newPt.phone.trim(),
        gender: newPt.gender,
        ageValue: age,
        ageUnit: newPt.ageUnit,
        dateOfBirth,
      });
    },
    onSuccess: (p) => {
      setPatient(p);
      setCreatingPatient(false);
      toast({ title: "Patient created", description: `${p.firstName} ${p.lastName} · ${p.patientId}` });
    },
    onError: (e: Error) => toast({ title: "Could not create patient", description: e.message, variant: "destructive" }),
  });

  const createBooking = useMutation({
    mutationFn: async (paymentChoice: "link" | "pay_at_centre") => {
      const parsed = slot.includes("::")
        ? { slotModality: slot.split("::")[0], timeSlot: slot.split("::").slice(1).join("::") }
        : { slotModality: "", timeSlot: slot };
      const bookingRes = await api.post<{ booking: Booking }>("/api/online-bookings", {
        patientId: patient?.id,
        name: patient ? `${patient.firstName} ${patient.lastName}` : `${newPt.firstName} ${newPt.lastName}`,
        phone: patient?.phone || newPt.phone,
        gender: patient?.gender || newPt.gender,
        ageValue: patient?.ageValue ?? Number(newPt.ageValue),
        ageUnit: patient?.ageUnit || newPt.ageUnit,
        email: patient?.email || "",
        selectedDate: date,
        timeSlot: parsed.timeSlot,
        slotModality: parsed.slotModality,
        testIds: [...selTests],
        packageIds: [...selPkgs],
        totalAmount: total,
        notes,
        source,
        overrideCapacity,
        overrideReason,
      });
      return { booking: bookingRes.booking, paymentChoice };
    },
    onSuccess: ({ booking, paymentChoice }) => {
      onCreated(booking, paymentChoice);
    },
    onError: (e: Error) => toast({ title: "Could not create booking", description: e.message, variant: "destructive" }),
  });

  const canSave = Boolean((patient || (newPt.firstName.trim() && newPt.phone.trim())) && (selTests.size + selPkgs.size) > 0 && date && slot && total > 0);
  const selectedSlot = slots.find((s) => slotKey(s) === slot);
  const slotFull = selectedSlot?.available === false;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Online Booking</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as "reception" | "phone")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="reception">Reception</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input className="mt-1" type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); }} />
            </div>
          </div>

          {!patient ? (
            <div className="space-y-2">
              <Label>Search patient (mobile or name)</Label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search existing patient…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {debounced.length >= 2 && (
                <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                  {(hits?.patients ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted/40"
                      onClick={() => { setPatient(p); setCreatingPatient(false); }}
                    >
                      <div className="font-medium">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-muted-foreground">{p.patientId} · {p.phone}</div>
                    </button>
                  ))}
                  {(hits?.patients ?? []).length === 0 && (
                    <div className="px-3 py-2 text-muted-foreground">No patient found</div>
                  )}
                </div>
              )}
              {!creatingPatient ? (
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  setCreatingPatient(true);
                  const digits = search.replace(/\D/g, "");
                  if (digits.length === 10) setNewPt((p) => ({ ...p, phone: digits }));
                  else if (search.trim() && !/\d/.test(search)) {
                    const parts = search.trim().split(/\s+/);
                    setNewPt((p) => ({ ...p, firstName: parts[0] || "", lastName: parts.slice(1).join(" ") }));
                  }
                }}>
                  <UserPlus size={14} className="mr-1" /> Create New Patient
                </Button>
              ) : (
                <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                  <p className="text-xs font-semibold">Minimum demographics</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="First name" value={newPt.firstName} onChange={(e) => setNewPt({ ...newPt, firstName: e.target.value })} />
                    <Input placeholder="Last name" value={newPt.lastName} onChange={(e) => setNewPt({ ...newPt, lastName: e.target.value })} />
                    <Input placeholder="Mobile (10 digits)" value={newPt.phone} onChange={(e) => setNewPt({ ...newPt, phone: e.target.value })} />
                    <Select value={newPt.gender} onValueChange={(v) => setNewPt({ ...newPt, gender: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input type="number" min={0} placeholder="Age" value={newPt.ageValue} onChange={(e) => setNewPt({ ...newPt, ageValue: e.target.value })} />
                    <Select value={newPt.ageUnit} onValueChange={(v) => setNewPt({ ...newPt, ageUnit: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="years">Years</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="days">Days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" size="sm" onClick={() => createPatient.mutate()} disabled={createPatient.isPending || !newPt.firstName.trim() || newPt.phone.replace(/\D/g, "").length !== 10}>
                    {createPatient.isPending ? "Saving…" : "Save patient"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div>
                <div className="font-medium">{patient.firstName} {patient.lastName}</div>
                <div className="text-xs text-muted-foreground">{patient.patientId} · {patient.phone}</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPatient(null)}>Change</Button>
            </div>
          )}

          <div>
            <Label>Investigations</Label>
            <Input className="mt-1 mb-2" placeholder="Search tests…" value={testQuery} onChange={(e) => setTestQuery(e.target.value)} />
            <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
              {filteredTests.map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={selTests.has(t.id)}
                    onChange={() => {
                      const n = new Set(selTests);
                      if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                      setSelTests(n);
                    }}
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-muted-foreground">₹{Number(t.price).toLocaleString("en-IN")}</span>
                </label>
              ))}
              {pkgs.map((p) => (
                <label key={`pkg-${p.id}`} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={selPkgs.has(p.id)}
                    onChange={() => {
                      const n = new Set(selPkgs);
                      if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                      setSelPkgs(n);
                    }}
                  />
                  <span className="flex-1 truncate">Package · {p.name}</span>
                  <span className="text-xs text-muted-foreground">₹{Number(p.price).toLocaleString("en-IN")}</span>
                </label>
              ))}
              {tests.length === 0 && pkgs.length === 0 && (
                <p className="px-3 py-2 text-muted-foreground">No online-booking catalogue configured. Add tests in Settings → Online Booking.</p>
              )}
            </div>
          </div>

          <div>
            <Label>Time slot</Label>
            <Select value={slot} onValueChange={setSlot}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select an available slot" /></SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={slotKey(s)} value={slotKey(s)} disabled={s.available === false && !overrideCapacity}>
                    {s.label}{s.remaining != null ? ` · ${s.remaining} left` : ""}{s.available === false ? " (full)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {slotFull && (
              <p className="text-xs text-amber-700 mt-1">This slot is full. Choose another time, or an admin can override with a reason.</p>
            )}
          </div>

          {isAdmin && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overrideCapacity} onChange={(e) => setOverrideCapacity(e.target.checked)} />
                Admin override if slot is full
              </label>
              {overrideCapacity && (
                <Textarea placeholder="Reason for override (required)" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              )}
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Textarea className="mt-1" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="text-right font-semibold">
            Total ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline"
            disabled={!canSave || createBooking.isPending || (slotFull && !overrideCapacity)}
            onClick={() => createBooking.mutate("pay_at_centre")}
          >
            <Building2 size={14} className="mr-1" /> Pay at Centre
          </Button>
          <Button
            disabled={!canSave || createBooking.isPending || (slotFull && !overrideCapacity)}
            onClick={() => createBooking.mutate("link")}
          >
            <CreditCard size={14} className="mr-1" /> {createBooking.isPending ? "Saving…" : "Save & Share Payment Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
