import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { genUUID } from "@/lib/utils";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  User2, FlaskConical, Receipt, CheckCircle2, Plus, X, ChevronRight,
  Search, Tag, Zap,
} from "lucide-react";
import ScanIdButton from "@/components/ScanIdButton";
import { RegisterPatientForm, type NewPatientData } from "@/components/RegisterPatientForm";
import { useToast } from "@/hooks/use-toast";

type Doctor = { id: number; name: string; specialization: string };
type CatalogTest = { id: number; name: string; price: string | number; category: string; code: string };
type SelectedTest = { testId: number; name: string; price: number; category: string };
type Patient = { id: number; patientId: string };

const PAYMENT_METHODS = ["cash", "card", "upi", "insurance", "cheque"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

type Step = 1 | 2 | 3;

const emptyPatient: NewPatientData = {
  firstName: "",
  lastName: "",
  phone: "",
  gender: "",
  ageValue: "",
  ageUnit: "years",
  email: "",
  address: "",
};

/**
 * Quick Register — same backend contract as Billing Desk:
 *   POST /api/patients → POST /api/orders → POST /api/bills (inline payments)
 * Uses RegisterPatientForm + age→DOB conversion identical to BillingDesk.
 */
export default function Register() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [newPatient, setNewPatient] = useState<NewPatientData>(emptyPatient);
  const [createdPatientId, setCreatedPatientId] = useState<number | null>(null);
  const [selectedTests, setSelectedTests] = useState<SelectedTest[]>([]);
  const [testSearch, setTestSearch] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>();
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [payNow, setPayNow] = useState(true);
  const [createdBillId, setCreatedBillId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [discountSuggestion, setDiscountSuggestion] = useState<{
    discount: number;
    rule: { id: number; name: string; reason: string | null } | null;
  } | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const { data: testsData } = useQuery<{ tests: CatalogTest[] }>({
    queryKey: ["tests-list-quick-register"],
    queryFn: () => api.get("/api/tests?limit=500&sort=popular"),
  });
  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get("/api/doctors"),
  });
  const { data: clinicBranding } = useQuery<{ patientPhoneRequired?: boolean }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });
  const patientPhoneRequired = clinicBranding?.patientPhoneRequired ?? true;

  const tests = testsData?.tests ?? [];
  const filteredTests = tests.filter((t) =>
    t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
    t.category.toLowerCase().includes(testSearch.toLowerCase()) ||
    t.code.toLowerCase().includes(testSearch.toLowerCase()),
  );

  // Same patient create path as BillingDesk.createPatientMut
  const createPatientMut = useMutation({
    mutationFn: (body: NewPatientData) => {
      if (!body.gender) {
        throw new Error("Please select sex before registering the patient.");
      }
      const rawAge = String(body.ageValue ?? "").trim();
      const ageVal = rawAge === "" ? NaN : Number(rawAge);
      const unit = body.ageUnit;
      let dateOfBirth = "";
      let ageValue: number | null = null;
      let ageUnit: string | null = null;
      if (!isNaN(ageVal) && ageVal > 0) {
        ageValue = Math.round(ageVal);
        ageUnit = unit;
        if (unit === "years") {
          dateOfBirth = `${new Date().getFullYear() - Math.round(ageVal)}-01-01`;
        } else if (unit === "months") {
          const d = new Date();
          d.setMonth(d.getMonth() - Math.round(ageVal));
          dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        } else {
          const d = new Date();
          d.setDate(d.getDate() - Math.round(ageVal));
          dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        }
      }
      return api.post<Patient>("/api/patients", {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        gender: body.gender,
        email: body.email || null,
        address: body.address || null,
        dateOfBirth,
        ageValue,
        ageUnit,
      });
    },
    onSuccess: (p) => {
      setCreatedPatientId(p.id);
      setStep(2);
      toast({ title: `Patient registered: ${p.patientId}` });
    },
    onError: (err: Error) => {
      const msg = err.message || "";
      if (msg.includes("409") || msg.includes("was just created") || msg.includes("duplicate")) {
        const match = msg.match(/\(P-\d+\)/);
        toast({
          title: `Duplicate patient${match ? ` ${match[0]}` : ""}`,
          description: "A patient with this name and phone already exists. Search for them on Billing Desk instead.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Failed to register patient", description: msg, variant: "destructive" });
      }
    },
  });

  const subtotal = selectedTests.reduce((s, t) => s + t.price, 0);
  const total = Math.max(0, subtotal - discount);

  const proceedToBilling = async () => {
    if (selectedTests.length === 0) return;
    setStep(3);
    setLoadingSuggestion(true);
    try {
      const result = await api.post<{
        discount: number;
        rule: { id: number; name: string; reason: string | null } | null;
      } | null>("/api/discounts/apply", {
        tests: selectedTests.map((t) => ({ testId: t.testId, category: t.category, price: t.price })),
      });
      setDiscountSuggestion(result);
    } catch {
      setDiscountSuggestion(null);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  // Same order → bill (+ inline payments) path as BillingDesk.generateMut
  const finalize = async () => {
    if (!createdPatientId || selectedTests.length === 0) return;
    if (discount > 0 && !discountReason.trim()) {
      toast({
        title: "Discount reason required",
        description: "Enter a reason when giving a discount (same rule as Billing Desk).",
        variant: "destructive",
      });
      return;
    }

    setFinalizing(true);
    const clientRef = genUUID();
    try {
      const order = await api.post<{ id: number; orderNumber: string }>("/api/orders", {
        patientId: createdPatientId,
        doctorId: selectedDoctorId ?? undefined,
        notes: notes || undefined,
        tests: selectedTests.map((t) => ({ testId: t.testId, price: t.price })),
        clientRef,
      });

      const paymentRows = payNow && total > 0
        ? [{ amount: total, method: paymentMethod }]
        : [];

      const bill = await api.post<{ id: number; billNumber: string }>("/api/bills", {
        orderId: order.id,
        clientRef,
        discount,
        discountReason: discount > 0 ? discountReason.trim() : null,
        payments: paymentRows,
      });

      setCreatedBillId(bill.id);
      toast({ title: `Bill ${bill.billNumber} created` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not create order/bill";
      toast({ title: "Billing failed", description: msg, variant: "destructive" });
      console.error(e);
    } finally {
      setFinalizing(false);
    }
  };

  const addTest = (test: CatalogTest) => {
    if (selectedTests.find((t) => t.testId === test.id)) return;
    setSelectedTests((prev) => [
      ...prev,
      { testId: test.id, name: test.name, price: Number(test.price), category: test.category },
    ]);
    setTestSearch("");
  };

  const removeTest = (testId: number) => {
    setSelectedTests((prev) => prev.filter((t) => t.testId !== testId));
  };

  const resetAll = () => {
    setStep(1);
    setCreatedPatientId(null);
    setCreatedBillId(null);
    setSelectedTests([]);
    setDiscount(0);
    setDiscountReason("");
    setPayNow(true);
    setNewPatient(emptyPatient);
    setNotes("");
    setSelectedDoctorId(undefined);
  };

  const stepLabel = ["Patient Info", "Select Tests", "Billing & Payment"];

  return (
    <div className="pb-8">
      <PageHeader
        title="Quick Registration"
        subtitle="Same patient → order → bill flow as Billing Desk, in three steps"
      />

      <div className="px-6 max-w-3xl mx-auto">
        {!createdBillId && (
          <div className="flex items-center mb-8">
            {stepLabel.map((label, i) => {
              const s = (i + 1) as Step;
              const done = step > s;
              const active = step === s;
              return (
                <div key={s} className="flex items-center flex-1 last:flex-none">
                  <div className={`flex items-center gap-2 ${active ? "text-primary" : done ? "text-green-600" : "text-muted-foreground"}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                      ${active ? "bg-primary text-white" : done ? "bg-green-500 text-white" : "bg-muted text-muted-foreground"}`}>
                      {done ? "✓" : s}
                    </div>
                    <span className={`text-sm font-medium hidden sm:block ${active ? "" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                  {i < stepLabel.length - 1 && (
                    <div className={`flex-1 h-px mx-3 ${step > s ? "bg-green-400" : "bg-muted"}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === 1 && !createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <User2 size={18} className="text-primary" />
                <h2 className="font-semibold text-base">Patient Information</h2>
              </div>
              <ScanIdButton
                buttonLabel="Scan ID to Autofill"
                onScanComplete={({ qrData, ocrResult }) => {
                  const data = qrData || ocrResult;
                  if (!data) return;
                  const next = { ...newPatient };
                  if (data.name) {
                    const parts = data.name.trim().split(/\s+/);
                    next.firstName = parts[0] || "";
                    next.lastName = parts.slice(1).join(" ") || "";
                  }
                  if (data.gender) {
                    next.gender = data.gender.toLowerCase() === "female" ? "female" : "male";
                  }
                  if (data.address) next.address = data.address;
                  if (data.dob && /^\d{4}-\d{2}-\d{2}$/.test(data.dob)) {
                    const birthYear = Number(data.dob.slice(0, 4));
                    const years = new Date().getFullYear() - birthYear;
                    if (years >= 0 && years < 130) {
                      next.ageValue = String(years);
                      next.ageUnit = "years";
                    }
                  }
                  setNewPatient(next);
                  toast({ title: "Autofilled from Scan", description: `Parsed details for ${data.name || "patient"}` });
                }}
              />
            </div>
            <RegisterPatientForm
              newPatient={newPatient}
              onPatientChange={setNewPatient}
              phoneRequired={patientPhoneRequired}
              onSubmit={() => {
                if (patientPhoneRequired && !String(newPatient.phone ?? "").trim()) {
                  toast({
                    title: "Phone number required",
                    description: "Turn off Patient Phone Requirement in Settings → Clinic Info to allow registration without a phone.",
                    variant: "destructive",
                  });
                  return;
                }
                createPatientMut.mutate(newPatient);
              }}
              isLoading={createPatientMut.isPending}
            />
            <p className="text-[11px] text-muted-foreground">
              Uses the same <code className="text-[10px]">POST /api/patients</code> path as Billing Desk.
            </p>
          </div>
        )}

        {step === 2 && !createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical size={18} className="text-primary" />
              <h2 className="font-semibold text-base">Select Diagnostic Tests</h2>
            </div>

            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search tests by name, category or code…"
                value={testSearch}
                onChange={(e) => setTestSearch(e.target.value)}
              />
            </div>

            {testSearch && (
              <div className="border border-input rounded-lg max-h-52 overflow-y-auto">
                {filteredTests.length === 0 ? (
                  <p className="text-center py-4 text-sm text-muted-foreground">No tests found</p>
                ) : (
                  filteredTests.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted flex items-center justify-between border-b border-card-border last:border-0"
                      onClick={() => addTest(t)}
                    >
                      <div>
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{t.code} · {t.category}</span>
                      </div>
                      <span className="font-semibold text-primary ml-4">{inr(Number(t.price))}</span>
                    </button>
                  ))
                )}
              </div>
            )}

            {selectedTests.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Selected Tests</p>
                {selectedTests.map((t) => (
                  <div key={t.testId} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.category}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">{inr(t.price)}</span>
                      <button type="button" onClick={() => removeTest(t.testId)} className="text-muted-foreground hover:text-destructive">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 px-1 text-sm font-semibold">
                  <span>Subtotal</span>
                  <span>{inr(subtotal)}</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Search and add tests above
              </div>
            )}

            <div>
              <Label>Referring Doctor (optional)</Label>
              <Select onValueChange={(v) => setSelectedDoctorId(v === "none" ? undefined : Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.specialization}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" placeholder="Clinical notes or instructions" />
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>← Back</Button>
              <Button onClick={proceedToBilling} disabled={selectedTests.length === 0}>
                Next: Billing
                <ChevronRight size={15} className="ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && !createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Receipt size={18} className="text-primary" />
              <h2 className="font-semibold text-base">Billing & Payment</h2>
            </div>

            <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
              {selectedTests.map((t) => (
                <div key={t.testId} className="flex justify-between">
                  <span className="text-muted-foreground">{t.name}</span>
                  <span>{inr(t.price)}</span>
                </div>
              ))}
              <div className="border-t border-card-border pt-2 flex justify-between font-medium">
                <span>Subtotal</span>
                <span>{inr(subtotal)}</span>
              </div>
            </div>

            {loadingSuggestion && (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm text-blue-700">
                <Zap size={14} className="animate-pulse" /> Checking applicable discount rules…
              </div>
            )}
            {!loadingSuggestion && discountSuggestion && discountSuggestion.discount > 0 && (
              <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 rounded-lg px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-green-800 dark:text-green-300 flex items-center gap-1.5">
                      <Tag size={14} /> Auto-suggested Discount
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                      {discountSuggestion.rule?.name}: Save {inr(discountSuggestion.discount)}
                      {discountSuggestion.rule?.reason && ` — ${discountSuggestion.rule.reason}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex-shrink-0"
                    onClick={() => {
                      setDiscount(discountSuggestion.discount);
                      setDiscountReason(discountSuggestion.rule?.reason ?? "");
                    }}
                  >
                    Apply {inr(discountSuggestion.discount)}
                  </button>
                </div>
              </div>
            )}

            <div>
              <Label>Discount (₹)</Label>
              <Input
                type="number"
                min="0"
                max={subtotal}
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            {discount > 0 && (
              <div>
                <Label>Discount Reason *</Label>
                <Input
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  className="mt-1"
                  placeholder="e.g., Senior citizen discount, Corporate tie-up"
                />
              </div>
            )}

            <div className="flex justify-between text-lg font-bold">
              <span>Total Payable</span>
              <span className="text-primary">{inr(total)}</span>
            </div>

            <div className="border border-dashed border-input rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="pay-now"
                  checked={payNow}
                  onChange={(e) => setPayNow(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="pay-now" className="text-sm font-medium cursor-pointer">Collect Payment Now</label>
              </div>
              {payNow && (
                <div>
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button onClick={finalize} disabled={finalizing}>
                {finalizing ? "Creating…" : "Confirm & Generate Bill"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Uses the same <code className="text-[10px]">POST /api/orders</code> + <code className="text-[10px]">POST /api/bills</code> (with <code className="text-[10px]">clientRef</code> + inline payments) as Billing Desk.
            </p>
          </div>
        )}

        {createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-8 text-center shadow-sm space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Registration Complete!</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Patient registered, order created, and bill generated successfully.
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={() => navigate(`/billing/${createdBillId}`)}>
                <Receipt size={14} className="mr-1" /> View Bill
              </Button>
              <Button onClick={() => navigate("/")}>
                Open Billing Desk
              </Button>
              <Button variant="secondary" onClick={resetAll}>
                <Plus size={14} className="mr-1" /> Register Another
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
