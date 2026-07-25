import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Stethoscope, Star, Percent, Search, Download, Upload, Clock, Building2, ShieldAlert } from "lucide-react";
import {
  useListCommissionRules,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
  type CommissionRule,
  type CommissionRuleType,
  type CommissionRuleScope,
} from "@workspace/api-client-react";
import { saAuthHeaders } from "@/lib/saApi";

type SaDoctor = {
  id: number;
  name: string;
  specialization: string;
  ledgerId: number | null;
  defaultCommission: string | null;
  defaultCommissionType: string;
};
type SaTest = { id: number; name: string; category: string | null };

const SA_DOCTORS_KEY = ["/api/super-admin/doctors-list"] as const;
const SA_TESTS_KEY = ["/api/super-admin/tests-list"] as const;
const SA_COMMISSION_SETTINGS_KEY = ["/api/super-admin/commission-settings"] as const;

const CATEGORIES = ["hematology", "biochemistry", "microbiology", "serology", "radiology", "cardiology", "urine analysis", "other"];
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type DiscountMode = "none" | "deduct" | "deduct_rollover";

const DISCOUNT_MODE_OPTIONS: { value: DiscountMode; label: string; description: string }[] = [
  { value: "none", label: "No Deduction", description: "Bill discounts do not affect commission payouts (default behaviour)." },
  { value: "deduct", label: "Deduct from Commission", description: "Bill discount is subtracted from the doctor's commission. Commission is floored at \u20b90 — no negative payouts." },
  { value: "deduct_rollover", label: "Deduct with Rollover", description: "Bill discount is subtracted from commission. If discount exceeds commission the balance goes negative and is carried over (deducted from future payouts)." },
];

type EligibilityPolicy =
  | "bill_created" | "report_finalized" | "report_delivered"
  | "min_amount_collected" | "full_payment_collected" | "collected_ge_commission";

const ELIGIBILITY_OPTIONS: { value: EligibilityPolicy; label: string; description: string; recommended?: boolean }[] = [
  { value: "bill_created", label: "Bill Created", description: "Payable as soon as billed (legacy behaviour)." },
  { value: "report_finalized", label: "Report Finalized", description: "Payable once every test's report is verified / finalized." },
  { value: "report_delivered", label: "Report Delivered", description: "Payable once every test's report is delivered to the patient." },
  { value: "min_amount_collected", label: "Minimum Amount Collected", description: "Payable once collections on the bill reach the minimum amount set below." },
  { value: "full_payment_collected", label: "Full Payment Collected", description: "Payable only once the bill is fully paid (no outstanding dues).", recommended: true },
  { value: "collected_ge_commission", label: "Collected ≥ Commission", description: "Payable once collections on the bill cover at least the commission amount." },
];

type OutsourcedBasis = "price" | "margin";

const OUTSOURCED_BASIS_OPTIONS: { value: OutsourcedBasis; label: string; description: string }[] = [
  { value: "price", label: "Full Price", description: "The rate applies to the whole test price, exactly as it does for in-house work (current behaviour)." },
  { value: "margin", label: "Margin (price − lab cost)", description: "The rate applies only to what the clinic keeps after paying the external lab, and the payout is capped at that margin — so even a fixed-amount slab can never pay out more than the clinic earned. A loss-making line pays nothing rather than a negative amount." },
];

function TestPicker({
  tests,
  selectedIds,
  onChange,
}: {
  tests: SaTest[];
  selectedIds: string;
  onChange: (ids: string) => void;
}) {
  const [q, setQ] = useState("");
  const selected = selectedIds.split(",").filter(Boolean).map(Number);
  const filtered = q.trim()
    ? tests.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    : tests;
  const selectedTests = tests.filter((t) => selected.includes(t.id));
  const unselectedTests = filtered.filter((t) => !selected.includes(t.id));
  return (
    <div>
      <Label>Tests</Label>
      <div className="mt-1 relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tests..."
          className="pl-8"
        />
      </div>
      <div className="mt-2 border border-input rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
        {/* Selected tests first */}
        {selectedTests.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked
              onChange={() => onChange(selected.filter((id) => id !== t.id).join(","))}
              className="rounded"
            />
            <span className="font-semibold text-primary">{t.name}</span>
          </label>
        ))}
        {selectedTests.length > 0 && unselectedTests.length > 0 && (
          <div className="border-t border-dashed border-input my-1" />
        )}
        {unselectedTests.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              onChange={() => onChange([...selected, t.id].join(","))}
              className="rounded"
            />
            {t.name}
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">No tests match "{q}"</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{selected.length} selected</p>
    </div>
  );
}

export default function CommissionRules({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editRule, setEditRule] = useState<CommissionRule | null>(null);
  const [discountModeSaving, setDiscountModeSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: doctorsData } = useQuery({
    queryKey: SA_DOCTORS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/doctors-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load doctors");
      return res.json() as Promise<{ doctors: SaDoctor[] }>;
    },
  });
  const doctors: SaDoctor[] = doctorsData?.doctors ?? [];

  const { data: testsData } = useQuery({
    queryKey: SA_TESTS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/tests-list", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load tests");
      return res.json() as Promise<{ tests: SaTest[] }>;
    },
  });
  const tests: SaTest[] = testsData?.tests ?? [];

  const { data: commissionSettingsData } = useQuery({
    queryKey: SA_COMMISSION_SETTINGS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/commission-settings", { headers: saAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load commission settings");
      return res.json() as Promise<{ commissionDiscountMode: DiscountMode; commissionEligibilityPolicy: EligibilityPolicy; commissionEligibilityMinAmount: number; commissionOutsourcedBasis: OutsourcedBasis; commissionMaxPercent: number; commissionDriftAlertPoints: number }>;
    },
  });
  const currentDiscountMode: DiscountMode = commissionSettingsData?.commissionDiscountMode ?? "none";
  const currentEligibilityPolicy: EligibilityPolicy = commissionSettingsData?.commissionEligibilityPolicy ?? "full_payment_collected";
  const currentEligibilityMinAmount: number = commissionSettingsData?.commissionEligibilityMinAmount ?? 0;
  const currentOutsourcedBasis: OutsourcedBasis = commissionSettingsData?.commissionOutsourcedBasis ?? "price";
  const currentMaxPercent: number = commissionSettingsData?.commissionMaxPercent ?? 0;
  const currentDriftPoints: number = commissionSettingsData?.commissionDriftAlertPoints ?? 0;
  const [maxPercentInput, setMaxPercentInput] = useState<string>("");
  const [driftInput, setDriftInput] = useState<string>("");
  useEffect(() => { setMaxPercentInput(String(currentMaxPercent)); }, [currentMaxPercent]);
  useEffect(() => { setDriftInput(String(currentDriftPoints)); }, [currentDriftPoints]);
  const [minAmountInput, setMinAmountInput] = useState<string>("");
  useEffect(() => { setMinAmountInput(String(currentEligibilityMinAmount)); }, [currentEligibilityMinAmount]);

  const patchCommissionSettings = async (body: Record<string, unknown>, successMsg: string) => {
    setDiscountModeSaving(true);
    try {
      const res = await fetch("/api/super-admin/commission-settings", {
        method: "PATCH",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? "Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: SA_COMMISSION_SETTINGS_KEY });
      toast({ title: successMsg });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setDiscountModeSaving(false);
    }
  };
  const saveDiscountMode = (mode: DiscountMode) => patchCommissionSettings({ commissionDiscountMode: mode }, "Commission discount setting saved");
  const saveEligibilityPolicy = (policy: EligibilityPolicy) => patchCommissionSettings({ commissionEligibilityPolicy: policy }, "Commission eligibility policy saved");
  const saveOutsourcedBasis = (basis: OutsourcedBasis) => patchCommissionSettings({ commissionOutsourcedBasis: basis }, "Outsourced commission basis saved");
  const saveGuardRails = () => {
    const max = Number(maxPercentInput), drift = Number(driftInput);
    if (!Number.isFinite(max) || max < 0 || max > 100) { toast({ title: "Maximum must be between 0 and 100", variant: "destructive" }); return; }
    if (!Number.isFinite(drift) || drift < 0 || drift > 100) { toast({ title: "Drift threshold must be between 0 and 100", variant: "destructive" }); return; }
    patchCommissionSettings({ commissionMaxPercent: max, commissionDriftAlertPoints: drift }, "Guard rails saved");
  };
  const saveEligibilityMinAmount = () => {
    const n = Number(minAmountInput);
    if (!Number.isFinite(n) || n < 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    patchCommissionSettings({ commissionEligibilityMinAmount: n }, "Minimum amount saved");
  };

  const { data: rulesData, queryKey: rulesQueryKey, error: rulesError } = useListCommissionRules(
    selectedDoctorId !== null ? { doctorId: selectedDoctorId } : undefined,
  );

  useEffect(() => {
    if (rulesError) {
      toast({ title: "Failed to load rules", description: String(rulesError), variant: "destructive" });
    }
  }, [rulesError, toast]);

  const rules: CommissionRule[] = Array.isArray(rulesData) ? rulesData : [];

  const deleteMutation = useDeleteCommissionRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule deleted" });
        queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      },
      onError: (e: unknown) => {
        toast({ title: "Delete failed", description: String(e), variant: "destructive" });
      },
    },
  });

  const createMutation = useCreateCommissionRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule created" });
        queryClient.invalidateQueries({ queryKey: rulesQueryKey });
        setRuleOpen(false);
        reset();
      },
      onError: (e: unknown) => {
        toast({ title: "Save failed", description: String(e), variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateCommissionRule({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rule updated" });
        queryClient.invalidateQueries({ queryKey: rulesQueryKey });
        setRuleOpen(false);
        setEditRule(null);
        reset();
      },
      onError: (e: unknown) => {
        toast({ title: "Save failed", description: String(e), variant: "destructive" });
      },
    },
  });

  const { register, handleSubmit, reset, watch, setValue } = useForm<{
    name: string; type: string; value: string; scope: string;
    categories: string; testIds: string; isExclusive: string; appliesTo: string;
  }>();
  const scope = watch("scope", "all");
  const ruleType = watch("type", "percentage");
  const appliesTo = watch("appliesTo", "all");

  const openEdit = (rule: CommissionRule) => {
    setEditRule(rule);
    reset({
      name: rule.name, type: rule.type, value: String(rule.value), scope: rule.scope,
      categories: rule.categories.join(","), testIds: rule.testIds.join(","),
      isExclusive: rule.isExclusive ? "true" : "false",
      appliesTo: (rule as CommissionRule & { appliesTo?: string }).appliesTo ?? "all",
    });
    setRuleOpen(true);
  };

  const onDelete = (id: number) => {
    if (!confirm("Delete this commission rule?")) return;
    deleteMutation.mutate({ id });
  };

  const onSave = handleSubmit((d) => {
    const body = {
      doctorId: selectedDoctorId,
      name: d.name,
      type: d.type as "percentage" | "fixed",
      value: Number(d.value),
      scope: d.scope as "all" | "category" | "test",
      isExclusive: d.isExclusive === "true",
      categories: d.scope === "category"
        ? d.categories.split(",").map(s => s.trim()).filter(Boolean)
        : [],
      testIds: d.scope === "test"
        ? d.testIds.split(",").map(n => Number(n)).filter(Boolean)
        : [],
      // Not part of the generated OpenAPI body type; the server reads it off the
      // raw body and allow-lists it (same as isActive).
      appliesTo: d.appliesTo || "all",
    } as Parameters<typeof createMutation.mutate>[0]["data"];
    if (editRule) {
      updateMutation.mutate({ id: editRule.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── CSV export ──────────────────────────────────────────────────────────────
  // Uses a raw fetch (not a generated hook) because the endpoint streams a
  // text/csv file. The unified export covers ALL doctors with commission info —
  // explicit rules AND doctors who only carry a profile default commission.
  // Passing doctorId scopes it to the currently selected doctor; "All Doctors"
  // exports everyone.
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedDoctorId != null) params.set("doctorId", String(selectedDoctorId));
      const qs = params.toString();
      const res = await fetch(`/api/commission/rules/export${qs ? `?${qs}` : ""}`, { headers: saAuthHeaders() });
      if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const who = selectedDoctorId != null
        ? (doctors.find((d) => d.id === selectedDoctorId)?.name.replace(/[^a-z0-9]+/gi, "_") ?? "doctor")
        : "all";
      a.download = `commission_rules_${who}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Export failed", description: String(e), variant: "destructive" });
    }
  };

  // ── CSV import ──────────────────────────────────────────────────────────────
  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const res = await fetch("/api/commission/rules/import", {
        method: "POST",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const body = await res.json().catch(() => ({} as Record<string, unknown>));
      const b = body as { created?: number; updated?: number; unchanged?: number; profileDefaultsUpdated?: number };
      const created = Number(b.created ?? 0);
      const updated = Number(b.updated ?? 0);
      const unchanged = Number(b.unchanged ?? 0);
      const profileUpd = Number(b.profileDefaultsUpdated ?? 0);
      const skipped = Number((body as { skipped?: number }).skipped ?? 0);
      if (!res.ok && created === 0) {
        throw new Error((body as { error?: string }).error ?? `Import failed: ${res.status}`);
      }
      const errs = ((body as { errors?: { line: number; error: string }[] }).errors ?? []);
      toast({
        // Re-importing an exported file now amends rules rather than duplicating
        // them, so say which happened.
        title: [
          created ? `${created} created` : "",
          updated ? `${updated} updated` : "",
          profileUpd ? `${profileUpd} profile default${profileUpd === 1 ? "" : "s"}` : "",
          unchanged ? `${unchanged} unchanged` : "",
        ].filter(Boolean).join(" · ") || "Nothing to import",
        description: skipped
          ? `${skipped} row${skipped === 1 ? "" : "s"} skipped — ${errs.slice(0, 3).map((e) => `line ${e.line}: ${e.error}`).join("; ")}${errs.length > 3 ? " …" : ""}`
          : "All rows imported successfully.",
        variant: skipped ? "destructive" : undefined,
      });
      queryClient.invalidateQueries({ queryKey: rulesQueryKey });
      queryClient.invalidateQueries({ queryKey: SA_DOCTORS_KEY });
    } catch (e) {
      toast({ title: "Import failed", description: String(e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
              <ArrowLeft size={14} className="mr-1" /> Back
            </Button>
            <h1 className="text-2xl font-bold">Commission Rules</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Per-doctor commission overrides for tests and categories
            </p>
          </div>
        </div>

        {/* Commission discount deduction setting */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Percent size={15} className="text-amber-600" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">Bill Discount &amp; Commission</p>
              <p className="text-xs text-muted-foreground">Controls how bill discounts affect referral commission payouts</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DISCOUNT_MODE_OPTIONS.map((opt) => {
              const isActive = currentDiscountMode === opt.value;
              return (
                <button
                  key={opt.value}
                  disabled={discountModeSaving}
                  onClick={() => { if (!isActive) saveDiscountMode(opt.value); }}
                  className={[
                    "text-left rounded-lg border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/50",
                    discountModeSaving ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{opt.label}</span>
                    {isActive && <Badge className="text-[10px] px-1.5 py-0 h-4">Active</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Guard rails */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center flex-shrink-0">
              <ShieldAlert size={15} className="text-rose-600" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">Guard Rails</p>
              <p className="text-xs text-muted-foreground">
                Limits on what can be saved, and when to be told something has drifted. Set either to 0 to switch it off.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Maximum commission rate (%)</Label>
              <Input type="number" min="0" max="100" step="any" value={maxPercentInput}
                onChange={(e) => setMaxPercentInput(e.target.value)} className="mt-1 w-40" />
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                No slab, CSV import or doctor profile default may be saved above this. Stops a slip of the
                keyboard turning 5% into 50%. Fixed-amount slabs are not percentages and are not checked.
              </p>
            </div>
            <div>
              <Label className="text-xs">Tell me when realised falls below configured by (%)</Label>
              <Input type="number" min="0" max="100" step="any" value={driftInput}
                onChange={(e) => setDriftInput(e.target.value)} className="mt-1 w-40" />
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                Rate Analysis shows a banner naming the doctors whose realised rate has fallen this far below
                their slab, and how much was surrendered. Usually discounts eating the band.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={discountModeSaving} onClick={saveGuardRails}>Save guard rails</Button>
            <p className="text-[11px] text-muted-foreground">
              Current: max {currentMaxPercent > 0 ? `${currentMaxPercent}%` : "off"} · alert at{" "}
              {currentDriftPoints > 0 ? `${currentDriftPoints}%` : "off"}
            </p>
          </div>
        </div>

        {/* Outsourced-lab commission basis */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center flex-shrink-0">
              <Building2 size={15} className="text-sky-600" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">Outsourced Lab Tests</p>
              <p className="text-xs text-muted-foreground">
                On work sent to an external lab the clinic only keeps the price minus the lab's cost.
                This decides what the commission rate is applied to.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OUTSOURCED_BASIS_OPTIONS.map((opt) => {
              const isActive = currentOutsourcedBasis === opt.value;
              return (
                <button
                  key={opt.value}
                  disabled={discountModeSaving}
                  onClick={() => { if (!isActive) saveOutsourcedBasis(opt.value); }}
                  className={[
                    "text-left rounded-lg border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/50",
                    discountModeSaving ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{opt.label}</span>
                    {isActive && <Badge className="text-[10px] px-1.5 py-0 h-4">Active</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.description}</p>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground leading-snug">
            Worked example — a &#8377;1,000 outsourced test the lab charges &#8377;700 for, at a 50% slab:
            on <strong>full price</strong> the doctor is paid &#8377;500 against a &#8377;300 margin, so the clinic loses &#8377;200.
            On <strong>margin</strong> the doctor is paid &#8377;150 and the clinic keeps &#8377;150.
            Either way you can also give outsourced work its own slab, using the rule form's
            &ldquo;Test kind&rdquo; setting.
          </p>
        </div>

        {/* Commission eligibility (payout hold) */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Clock size={15} className="text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">Commission Eligibility (Payout Hold)</p>
              <p className="text-xs text-muted-foreground">Decides when a calculated commission becomes payable. Until then it is held — kept out of Doctor Due — and auto-released once the condition is met. Cancelled bills are never payable.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ELIGIBILITY_OPTIONS.map((opt) => {
              const isActive = currentEligibilityPolicy === opt.value;
              return (
                <button
                  key={opt.value}
                  disabled={discountModeSaving}
                  onClick={() => { if (!isActive) saveEligibilityPolicy(opt.value); }}
                  className={[
                    "text-left rounded-lg border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-muted/50",
                    discountModeSaving ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-1 gap-1">
                    <span className="text-xs font-semibold">{opt.label}</span>
                    {isActive
                      ? <Badge className="text-[10px] px-1.5 py-0 h-4">Active</Badge>
                      : opt.recommended
                      ? <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700">Recommended</Badge>
                      : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{opt.description}</p>
                </button>
              );
            })}
          </div>

          {currentEligibilityPolicy === "min_amount_collected" && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div>
                <Label className="text-xs">Minimum amount collected (₹)</Label>
                <Input type="number" min="0" step="any" value={minAmountInput} onChange={(e) => setMinAmountInput(e.target.value)} className="mt-1 w-40" />
              </div>
              <Button size="sm" variant="outline" disabled={discountModeSaving} onClick={saveEligibilityMinAmount}>Save amount</Button>
              <p className="text-[11px] text-muted-foreground pb-2">Current: {inr(currentEligibilityMinAmount)}</p>
            </div>
          )}
        </div>

        {/* Doctor selector + add button */}
        <div className="flex flex-wrap gap-3 items-center justify-between bg-card border border-border rounded-xl p-4">
          <div className="w-72">
            <Label className="text-xs">Doctor</Label>
            <Select onValueChange={(v) => setSelectedDoctorId(v === "all" ? null : Number(v))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="All Doctors" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Doctors</SelectItem>
                {doctors.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); e.target.value = ""; }}
            />
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download size={14} /> Export CSV
            </Button>
            <Button variant="outline" size="sm" disabled={importing} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
              <Upload size={14} /> {importing ? "Importing…" : "Import CSV"}
            </Button>
            {selectedDoctorId && (
              <Button onClick={() => { setEditRule(null); reset({ type: "percentage", scope: "all", isExclusive: "false", appliesTo: "all" }); setRuleOpen(true); }}>
                <Plus size={14} className="mr-1" /> Add Rule
              </Button>
            )}
          </div>
        </div>

        {/* Doctor cards / rules table */}
        {!selectedDoctorId ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {doctors.map((d) => (
              <div
                key={d.id}
                className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedDoctorId(d.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Stethoscope size={16} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.specialization}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Star size={11} className="text-amber-500" />
                      Default: {Number(d.defaultCommission ?? 0) > 0
                        ? `${d.defaultCommissionType === "percentage" ? Number(d.defaultCommission) + "%" : inr(Number(d.defaultCommission))} per referral`
                        : "No default"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSelectedDoctorId(null)}>
              ← Back to all doctors
            </Button>
            {rules.filter(r => r.doctorId === selectedDoctorId).length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border rounded-xl">
                No custom rules. Uses default commission from doctor profile.
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Rule Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Value</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Scope</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Flags</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.filter(r => r.doctorId === selectedDoctorId).map((rule) => (
                      <tr key={rule.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium">{rule.name}</td>
                        <td className="px-4 py-3">{rule.type === "percentage" ? `${rule.value}%` : inr(rule.value)}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{rule.scope}</td>
                        <td className="px-4 py-3">
                          {rule.isExclusive && <Badge className="bg-purple-100 text-purple-700 text-xs mr-1">Exclusive</Badge>}
                          {(() => {
                            const kind = (rule as CommissionRule & { appliesTo?: string }).appliesTo ?? "all";
                            if (kind === "outsourced") return <Badge className="bg-sky-100 text-sky-700 text-xs mr-1">Outsourced only</Badge>;
                            if (kind === "inhouse") return <Badge className="bg-teal-100 text-teal-700 text-xs mr-1">In-house only</Badge>;
                            return null;
                          })()}
                          {!rule.isActive && <Badge className="bg-gray-100 text-gray-500 text-xs">Inactive</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(rule)}>Edit</Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 text-destructive hover:text-destructive"
                              onClick={() => onDelete(rule.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rule create / edit dialog */}
      <Dialog open={ruleOpen} onOpenChange={(o) => { setRuleOpen(o); if (!o) setEditRule(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editRule ? "Edit" : "Add"} Commission Rule</DialogTitle></DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <div>
              <Label>Rule Name *</Label>
              <Input {...register("name", { required: true })} className="mt-1" placeholder="e.g., Lab Tests 10%" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select onValueChange={(v) => setValue("type", v)} defaultValue={editRule?.type || "percentage"}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="fixed">Fixed (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{ruleType === "percentage" ? "Percentage" : "Amount (₹)"} *</Label>
                <Input type="number" step="any" {...register("value", { required: true })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Scope — which tests</Label>
              <Select onValueChange={(v) => setValue("scope", v)} defaultValue={editRule?.scope || "all"}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tests</SelectItem>
                  <SelectItem value="category">Specific Categories</SelectItem>
                  <SelectItem value="test">Specific Tests</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "category" && (
              <div>
                <Label>Categories (comma-separated)</Label>
                <Input {...register("categories")} className="mt-1" placeholder="hematology, biochemistry" />
                <p className="text-xs text-muted-foreground mt-1">Options: {CATEGORIES.join(", ")}</p>
              </div>
            )}
            {scope === "test" && (
              <TestPicker
                tests={tests}
                selectedIds={watch("testIds") || ""}
                onChange={(ids) => setValue("testIds", ids)}
              />
            )}
            <div>
              <Label>Test kind — in-house or outsourced</Label>
              <Select
                onValueChange={(v) => setValue("appliesTo", v)}
                defaultValue={(editRule as (CommissionRule & { appliesTo?: string }) | null)?.appliesTo ?? "all"}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Both (any test)</SelectItem>
                  <SelectItem value="inhouse">In-house tests only</SelectItem>
                  <SelectItem value="outsourced">Outsourced tests only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {appliesTo === "outsourced"
                  ? "Pays only on tests sent to an external lab — where the clinic keeps just the margin."
                  : appliesTo === "inhouse"
                  ? "Pays only on tests performed in-house. Outsourced work needs its own rule."
                  : "Pays on every test. Set a separate outsourced rule if that work has a thinner margin."}
              </p>
            </div>
            <div>
              <Label>Priority</Label>
              <Select onValueChange={(v) => setValue("isExclusive", v)} defaultValue={editRule ? (editRule.isExclusive ? "true" : "false") : "false"}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Normal (can stack)</SelectItem>
                  <SelectItem value="true">Exclusive (overrides default)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setRuleOpen(false); setEditRule(null); }}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? "Saving…" : editRule ? "Update" : "Add Rule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
