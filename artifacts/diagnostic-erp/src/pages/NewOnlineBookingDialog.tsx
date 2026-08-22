import { useEffect, useMemo, useRef, useState } from "react";
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
import { detectGenderFromName } from "@/lib/nameGender";
import { Search, UserPlus, CreditCard, Building2, Stethoscope } from "lucide-react";

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
type Doctor = { id: number; name: string; degree?: string | null };

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

function parseIdSlots(raw: string | undefined, size: number): (number | null)[] {
  try {
    const arr = JSON.parse(raw ?? "[]");
    const out: (number | null)[] = Array.isArray(arr)
      ? arr.slice(0, size).map((v: unknown) => (typeof v === "number" ? v : null))
      : [];
    while (out.length < size) out.push(null);
    return out;
  } catch {
    return Array.from({ length: size }, () => null);
  }
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
  const [newPt, setNewPt] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    gender: "" as "male" | "female" | "",
    ageValue: "",
    ageUnit: "years" as "years" | "months" | "days",
  });
  const [nameText, setNameText] = useState("");
  const genderTouched = useRef(false);
  const newPtRef = useRef(newPt);
  newPtRef.current = newPt;

  const [source, setSource] = useState<"reception" | "phone">("phone");
  const [selTests, setSelTests] = useState<Set<number>>(new Set());
  const [selPkgs, setSelPkgs] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [slot, setSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [testQuery, setTestQuery] = useState("");
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [doctorSearch, setDoctorSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setPatient(null);
      setNewPt({ firstName: "", lastName: "", phone: "", gender: "", ageValue: "", ageUnit: "years" });
      setNameText("");
      genderTouched.current = false;
      setSelTests(new Set());
      setSelPkgs(new Set());
      setSlot("");
      setNotes("");
      setOverrideCapacity(false);
      setOverrideReason("");
      setDate(todayISO());
      setDoctorId(null);
      setDoctorSearch("");
      setTestQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (genderTouched.current) return;
    const trimmed = nameText.trim();
    if (!trimmed) return;
    const suggested = detectGenderFromName(trimmed);
    if (suggested && suggested !== newPtRef.current.gender) {
      setNewPt({ ...newPtRef.current, gender: suggested });
    }
  }, [nameText]);

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

  const { data: clinic } = useQuery<{ quickTestIds?: string; patientPhoneRequired?: boolean }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    enabled: open,
  });

  const { data: myQuick } = useQuery<{ quickDoctorIds?: string }>({
    queryKey: ["my-quick-doctors"],
    queryFn: () => api.get("/api/my/quick-doctors"),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const { data: doctorsPayload } = useQuery<{ doctors: Doctor[] }>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get("/api/doctors"),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const doctors = doctorsPayload?.doctors ?? [];
  const phoneRequired = clinic?.patientPhoneRequired ?? true;

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

  const quickTests = useMemo(() => {
    const ids = parseIdSlots(clinic?.quickTestIds, 8);
    const catalogIds = new Set(tests.map((t) => t.id));
    const out: CatalogTest[] = [];
    for (const id of ids) {
      if (id == null || !catalogIds.has(id)) continue;
      const t = tests.find((x) => x.id === id);
      if (t && !out.some((x) => x.id === t.id)) out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  }, [clinic?.quickTestIds, tests]);

  const quickDoctors = useMemo(() => {
    const ids = parseIdSlots(myQuick?.quickDoctorIds, 8);
    const out: Doctor[] = [];
    for (const id of ids) {
      if (id == null) continue;
      const d = doctors.find((x) => x.id === id);
      if (d && !out.some((x) => x.id === d.id)) out.push(d);
      if (out.length >= 5) break;
    }
    return out;
  }, [myQuick?.quickDoctorIds, doctors]);

  const filteredDoctors = useMemo(() => {
    const q = doctorSearch.trim().toLowerCase();
    if (!q) return [];
    return doctors.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 8);
  }, [doctors, doctorSearch]);

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
      toast({ title: "Patient created", description: `${p.firstName} ${p.lastName} · ${p.patientId}` });
    },
    onError: (e: Error) => toast({ title: "Could not create patient", description: e.message, variant: "destructive" }),
  });

  const createBooking = useMutation({
    mutationFn: async (paymentChoice: "link" | "pay_at_centre") => {
      const parsed = slot.includes("::")
        ? { slotModality: slot.split("::")[0], timeSlot: slot.split("::").slice(1).join("::") }
        : { slotModality: "", timeSlot: slot };
      const referring = doctorId != null ? doctors.find((d) => d.id === doctorId) : undefined;
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
        referringDoctorId: doctorId,
        referringDoctorName: referring?.name || "",
      });
      return { booking: bookingRes.booking, paymentChoice };
    },
    onSuccess: ({ booking, paymentChoice }) => {
      onCreated(booking, paymentChoice);
    },
    onError: (e: Error) => toast({ title: "Could not create booking", description: e.message, variant: "destructive" }),
  });

  const phoneDigits = newPt.phone.replace(/\D/g, "");
  const phoneOk = patient ? true : phoneRequired ? phoneDigits.length === 10 : phoneDigits.length === 0 || phoneDigits.length === 10;
  const newPatientReady = Boolean(newPt.firstName.trim() && newPt.gender && phoneOk && newPt.ageValue !== "" && Number.isFinite(Number(newPt.ageValue)));
  const canSave = Boolean((patient || newPatientReady) && (selTests.size + selPkgs.size) > 0 && date && slot && total > 0);
  const selectedSlot = slots.find((s) => slotKey(s) === slot);
  const slotFull = selectedSlot?.available === false;
  const selectedDoctor = doctorId != null ? doctors.find((d) => d.id === doctorId) : undefined;

  function applyName(raw: string) {
    setNameText(raw);
    const trimmed = raw.trim();
    const parts = trimmed.split(/\s+/);
    setNewPt({
      ...newPtRef.current,
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
    });
  }

  function toggleTest(id: number) {
    const n = new Set(selTests);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelTests(n);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl w-[min(95vw,64rem)] max-h-[90vh] overflow-y-auto">
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

          {patient ? (
            <div className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div>
                <div className="font-medium">{patient.firstName} {patient.lastName}</div>
                <div className="text-xs text-muted-foreground">{patient.patientId} · {patient.phone}</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPatient(null)}>Change</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Search existing patient (mobile or name)</Label>
                <div className="relative mt-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search existing patient…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                {debounced.length >= 2 && (
                  <div className="border rounded-lg divide-y max-h-40 overflow-y-auto mt-1">
                    {(hits?.patients ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted/40"
                        onClick={() => setPatient(p)}
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
              </div>

              <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                <p className="text-xs font-semibold text-primary flex items-center gap-1">
                  <UserPlus size={13} /> Register New Patient
                </p>
                <div>
                  <Label className="text-xs">Name *</Label>
                  <Input
                    className="mt-0.5 h-8"
                    placeholder="Full name (e.g. Rohit Kumar)"
                    value={nameText}
                    onChange={(e) => applyName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-[1fr_140px_90px] gap-2">
                  <div>
                    <Label className="text-xs">Mobile{phoneRequired ? " *" : ""}</Label>
                    <Input
                      className="mt-0.5 h-8"
                      placeholder={phoneRequired ? "10-digit mobile" : "Mobile (optional)"}
                      inputMode="tel"
                      value={newPt.phone}
                      onChange={(e) => setNewPt({ ...newPt, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Age</Label>
                    <div className="flex gap-1 mt-0.5">
                      <Input
                        className="h-8"
                        type="number"
                        min={0}
                        placeholder="0"
                        value={newPt.ageValue}
                        onChange={(e) => setNewPt({ ...newPt, ageValue: e.target.value })}
                      />
                      <Select value={newPt.ageUnit} onValueChange={(v) => setNewPt({ ...newPt, ageUnit: v as typeof newPt.ageUnit })}>
                        <SelectTrigger className="h-8 w-[72px] px-2"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="years">Years</SelectItem>
                          <SelectItem value="months">Months</SelectItem>
                          <SelectItem value="days">Days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Sex *</Label>
                    <Select
                      value={newPt.gender || undefined}
                      onValueChange={(v) => {
                        genderTouched.current = true;
                        setNewPt({ ...newPt, gender: v as "male" | "female" });
                      }}
                    >
                      <SelectTrigger className="mt-0.5 h-8 px-2"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => createPatient.mutate()}
                  disabled={createPatient.isPending || !newPatientReady}
                >
                  {createPatient.isPending ? "Saving…" : "Save patient"}
                </Button>
              </div>
            </div>
          )}

          <div>
            <Label className="flex items-center gap-1"><Stethoscope size={13} /> Referring doctor</Label>
            {quickDoctors.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mt-1.5">
                {quickDoctors.map((d) => {
                  const selected = doctorId === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      title={d.name}
                      onClick={() => setDoctorId(selected ? null : d.id)}
                      className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border truncate ${
                        selected
                          ? "bg-violet-600 text-white border-transparent"
                          : "bg-violet-50 border-violet-300 text-violet-700 hover:bg-violet-100"
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="relative mt-1.5">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8"
                placeholder={selectedDoctor ? selectedDoctor.name : "Search doctor…"}
                value={doctorSearch}
                onChange={(e) => setDoctorSearch(e.target.value)}
              />
            </div>
            {filteredDoctors.length > 0 && (
              <div className="border rounded-lg divide-y max-h-32 overflow-y-auto mt-1">
                {filteredDoctors.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-muted/40"
                    onClick={() => { setDoctorId(d.id); setDoctorSearch(""); }}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
            {selectedDoctor && (
              <p className="text-xs text-muted-foreground mt-1">
                Referral: <span className="font-medium text-foreground">{selectedDoctor.name}</span>
                {" · "}
                <button type="button" className="underline" onClick={() => setDoctorId(null)}>clear</button>
              </p>
            )}
          </div>

          <div>
            <Label>Investigations</Label>
            {quickTests.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mt-1.5 mb-2">
                {quickTests.map((t) => {
                  const selected = selTests.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      title={t.name}
                      onClick={() => toggleTest(t.id)}
                      className={`w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border truncate ${
                        selected
                          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                          : "bg-teal-50 border-teal-300 text-teal-700 hover:bg-teal-100"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Input className="mt-1 mb-2" placeholder="Search tests…" value={testQuery} onChange={(e) => setTestQuery(e.target.value)} />
            <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
              {filteredTests.map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={selTests.has(t.id)}
                    onChange={() => toggleTest(t.id)}
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
