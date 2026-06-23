import { useState, useEffect } from "react";
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
import { ArrowLeft, Plus, Trash2, Stethoscope, Star, Percent, Search } from "lucide-react";
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
      return res.json() as Promise<{ commissionDiscountMode: DiscountMode }>;
    },
  });
  const currentDiscountMode: DiscountMode = commissionSettingsData?.commissionDiscountMode ?? "none";

  const saveDiscountMode = async (mode: DiscountMode) => {
    setDiscountModeSaving(true);
    try {
      const res = await fetch("/api/super-admin/commission-settings", {
        method: "PATCH",
        headers: { ...saAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ commissionDiscountMode: mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      queryClient.invalidateQueries({ queryKey: SA_COMMISSION_SETTINGS_KEY });
      toast({ title: "Commission discount setting saved" });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setDiscountModeSaving(false);
    }
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
    categories: string; testIds: string; isExclusive: string;
  }>();
  const scope = watch("scope", "all");
  const ruleType = watch("type", "percentage");

  const openEdit = (rule: CommissionRule) => {
    setEditRule(rule);
    reset({
      name: rule.name, type: rule.type, value: String(rule.value), scope: rule.scope,
      categories: rule.categories.join(","), testIds: rule.testIds.join(","),
      isExclusive: rule.isExclusive ? "true" : "false",
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
    };
    if (editRule) {
      updateMutation.mutate({ id: editRule.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

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
          {selectedDoctorId && (
            <Button onClick={() => { setEditRule(null); reset({ type: "percentage", scope: "all", isExclusive: "false" }); setRuleOpen(true); }}>
              <Plus size={14} className="mr-1" /> Add Rule
            </Button>
          )}
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
              <Label>Applies To</Label>
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
