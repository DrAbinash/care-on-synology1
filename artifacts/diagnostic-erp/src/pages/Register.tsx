import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  useCreatePatient,
  useCreateOrder,
  useCreateBill,
  useListTests,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import {
  User2, FlaskConical, Receipt, CheckCircle2, Plus, X, ChevronRight,
  Search, IndianRupee, Tag, Zap,
} from "lucide-react";
import ScanIdButton from "@/components/ScanIdButton";
import { useToast } from "@/hooks/use-toast";

function convertDateFormat(dateStr: string): string {
  if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}


type Doctor = { id: number; name: string; specialization: string };
type SelectedTest = { testId: number; name: string; price: number; category: string };

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const PAYMENT_METHODS = ["cash", "card", "upi", "insurance", "cheque"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

type Step = 1 | 2 | 3;

export default function Register() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>(1);
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
  const [discountSuggestion, setDiscountSuggestion] = useState<{ discount: number; rule: { id: number; name: string; reason: string | null } | null } | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  const { data: testsData } = useListTests({});
  const { data: doctors = [] } = useQuery<Doctor[]>({
    queryKey: ["doctors-list"],
    queryFn: () => api.get("/api/doctors"),
  });

  const tests = testsData?.tests ?? [];
  const filteredTests = tests.filter(t =>
    t.name.toLowerCase().includes(testSearch.toLowerCase()) ||
    t.category.toLowerCase().includes(testSearch.toLowerCase()) ||
    t.code.toLowerCase().includes(testSearch.toLowerCase())
  );

  const createPatient = useCreatePatient({ mutation: {} });
  const createOrder = useCreateOrder({ mutation: {} });
  const createBill = useCreateBill({ mutation: {} });
  const addPayment = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/payments", body),
  });

  const { register, handleSubmit, setValue, watch } = useForm({
    defaultValues: { gender: "male", firstName: "", lastName: "", dateOfBirth: "", phone: "", email: "", address: "", bloodGroup: "" },
  });

  const subtotal = selectedTests.reduce((s, t) => s + t.price, 0);
  const total = Math.max(0, subtotal - discount);

  // Step 1: Patient Registration
  const onPatientSubmit = handleSubmit(async (d) => {
    const patient = await createPatient.mutateAsync({ data: d as Parameters<typeof createPatient.mutateAsync>[0]["data"] });
    setCreatedPatientId(patient.id);
    setStep(2);
  });

  // Step 2: Tests selection → Step 3
  const proceedToBilling = async () => {
    if (selectedTests.length === 0) return;
    setStep(3);
    // Fetch applicable discount suggestion
    setLoadingSuggestion(true);
    try {
      const result = await api.post<{ discount: number; rule: { id: number; name: string; reason: string | null } | null } | null>("/api/discounts/apply", {
        tests: selectedTests.map(t => ({ testId: t.testId, category: t.category, price: t.price })),
      });
      setDiscountSuggestion(result);
    } catch {
      setDiscountSuggestion(null);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  // Step 3: Create order + bill + payment
  const finalize = async () => {
    if (!createdPatientId || selectedTests.length === 0) return;

    try {
      // Create order
      const order = await createOrder.mutateAsync({
        data: {
          patientId: createdPatientId,
          doctorId: selectedDoctorId ?? null,
          notes: notes || null,
          testIds: selectedTests.map(t => t.testId),
        },
      });

      // Create bill
      const bill = await createBill.mutateAsync({
        data: {
          orderId: order.id,
          discount: discount > 0 ? discount : undefined,
          dueDate: undefined,
        },
      });

      // If paying now
      if (payNow && total > 0) {
        await addPayment.mutateAsync({
          billId: bill.id,
          amount: total,
          method: paymentMethod,
        });
      }

      setCreatedBillId(bill.id);
      setStep(3);
    } catch (e) {
      console.error(e);
    }
  };

  const addTest = (test: { id: number; name: string; price: string | number; category: string }) => {
    if (selectedTests.find(t => t.testId === test.id)) return;
    setSelectedTests(prev => [...prev, { testId: test.id, name: test.name, price: Number(test.price), category: test.category }]);
    setTestSearch("");
  };

  const removeTest = (testId: number) => {
    setSelectedTests(prev => prev.filter(t => t.testId !== testId));
  };

  const stepLabel = ["Patient Info", "Select Tests", "Billing & Payment"];

  return (
    <div className="pb-8">
      <PageHeader
        title="Quick Registration"
        subtitle="Register patient, select tests and collect payment in one flow"
      />

      <div className="px-6 max-w-3xl mx-auto">
        {/* Stepper */}
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

        {/* Step 1: Patient Info */}
        {step === 1 && !createdBillId && (
          <form onSubmit={onPatientSubmit} className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <User2 size={18} className="text-primary" />
                <h2 className="font-semibold text-base">Patient Information</h2>
              </div>
              <ScanIdButton
                buttonLabel="Scan ID to Autofill"
                onScanComplete={({ frontUrl, qrData, ocrResult }) => {
                  const data = qrData || ocrResult;
                  if (data) {
                    if (data.name) {
                      const parts = data.name.trim().split(" ");
                      setValue("firstName", parts[0] || "");
                      setValue("lastName", parts.slice(1).join(" ") || "");
                    }
                    if (data.dob) {
                      setValue("dateOfBirth", convertDateFormat(data.dob));
                    }
                    if (data.gender) {
                      setValue("gender", data.gender.toLowerCase() === "female" ? "female" : "male");
                    }
                    if (data.address) {
                      setValue("address", data.address);
                    }
                    toast({ title: "Autofilled from Scan", description: `Parsed details for ${data.name || "patient"}` });
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name *</Label>
                <Input {...register("firstName", { required: true })} className="mt-1" />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input {...register("lastName", { required: true })} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Date of Birth *</Label>
                <Input type="date" {...register("dateOfBirth", { required: true })} className="mt-1" />
              </div>
              <div>
                <Label>Gender *</Label>
                <Select defaultValue="male" onValueChange={(v) => setValue("gender", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Blood Group</Label>
                <Select onValueChange={(v) => setValue("bloodGroup", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {BLOOD_GROUPS.map(bg => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone *</Label>
                <Input {...register("phone", { required: true })} className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" {...register("email")} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input {...register("address")} className="mt-1" />
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={createPatient.isPending}>
                {createPatient.isPending ? "Saving…" : "Next: Select Tests"}
                <ChevronRight size={15} className="ml-1" />
              </Button>
            </div>
          </form>
        )}

        {/* Step 2: Tests Selection */}
        {step === 2 && !createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical size={18} className="text-primary" />
              <h2 className="font-semibold text-base">Select Diagnostic Tests</h2>
            </div>

            {/* Search & add */}
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
                  filteredTests.map(t => (
                    <button
                      key={t.id}
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

            {/* Selected tests */}
            {selectedTests.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Selected Tests</p>
                {selectedTests.map(t => (
                  <div key={t.testId} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.category}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">{inr(t.price)}</span>
                      <button onClick={() => removeTest(t.testId)} className="text-muted-foreground hover:text-destructive">
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

            {/* Referring doctor */}
            <div>
              <Label>Referring Doctor (optional)</Label>
              <Select onValueChange={(v) => setSelectedDoctorId(v === "none" ? undefined : Number(v))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {doctors.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name} · {d.specialization}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1" placeholder="Clinical notes or instructions" />
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

        {/* Step 3: Billing & Payment */}
        {step === 3 && !createdBillId && (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Receipt size={18} className="text-primary" />
              <h2 className="font-semibold text-base">Billing & Payment</h2>
            </div>

            <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
              {selectedTests.map(t => (
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

            {/* Discount Rule Suggestion */}
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
                    onClick={() => { setDiscount(discountSuggestion.discount); setDiscountReason(discountSuggestion.rule?.reason ?? ""); }}
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
                onChange={e => setDiscount(Number(e.target.value))}
                className="mt-1"
              />
            </div>
            {discount > 0 && (
              <div>
                <Label>Discount Reason</Label>
                <Input
                  value={discountReason}
                  onChange={e => setDiscountReason(e.target.value)}
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
                  onChange={e => setPayNow(e.target.checked)}
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
                      {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>← Back</Button>
              <Button onClick={finalize} disabled={createOrder.isPending || createBill.isPending || addPayment.isPending}>
                {createOrder.isPending || createBill.isPending ? "Creating…" : "Confirm & Generate Bill"}
              </Button>
            </div>
          </div>
        )}

        {/* Success State */}
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
              <Button
                onClick={() => {
                  setStep(1);
                  setCreatedPatientId(null);
                  setCreatedBillId(null);
                  setSelectedTests([]);
                  setDiscount(0);
                  setPayNow(true);
                }}
              >
                <Plus size={14} className="mr-1" /> Register Another
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
