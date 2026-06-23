import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Building2, Phone, Mail, MapPin, BadgePercent, Wallet, CalendarRange } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";

type Lab = {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive: boolean;
  costType: string;
  costPercent: string | number;
  costFixed: string | number;
  paymentCycle?: string | null;
  defaultTdsPercent?: string | number | null;
  defaultPaymentMode?: string | null;
};

type LabForm = {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  notes?: string;
  isActive: boolean;
  costType: string;
  costPercent: string;
  costFixed: string;
  paymentCycle: string;
  defaultTdsPercent: string;
  defaultPaymentMode: string;
};

const LABS_KEY = ["outsourced-labs"] as const;

export default function OutsourceSettings() {
  const { data: labs = [], isLoading } = useQuery<Lab[]>({
    queryKey: LABS_KEY,
    queryFn: () => api.get<Lab[]>("/api/outsourced-labs"),
  });

  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editLab, setEditLab] = useState<Lab | null>(null);

  const { register, handleSubmit, reset, formState, watch, setValue } = useForm<LabForm>({
    defaultValues: {
      isActive: true,
      costType: "percent_of_patient_bill",
      costPercent: "50",
      costFixed: "0",
      paymentCycle: "monthly",
      defaultTdsPercent: "10.00",
      defaultPaymentMode: "bank_transfer"
    },
  });

  const createLab = useMutation({
    mutationFn: (data: LabForm) => api.post<Lab>("/api/outsourced-labs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LABS_KEY });
      setOpen(false);
      reset();
      toast({ title: "Reference Lab added successfully" });
    },
    onError: (e: Error) => toast({ title: "Failed to add lab", description: e.message, variant: "destructive" }),
  });

  const updateLab = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<LabForm> }) =>
      api.put<Lab>(`/api/outsourced-labs/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LABS_KEY });
      setEditLab(null);
      setOpen(false);
      toast({ title: "Lab settings updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditLab(null);
    reset({
      isActive: true,
      costType: "percent_of_patient_bill",
      costPercent: "50",
      costFixed: "0",
      paymentCycle: "monthly",
      defaultTdsPercent: "10.00",
      defaultPaymentMode: "bank_transfer"
    });
    setOpen(true);
  };

  const openEdit = (lab: Lab) => {
    setEditLab(lab);
    reset({
      name: lab.name,
      contactPerson: lab.contactPerson ?? "",
      phone: lab.phone ?? "",
      email: lab.email ?? "",
      address: lab.address ?? "",
      gstin: lab.gstin ?? "",
      notes: lab.notes ?? "",
      isActive: lab.isActive,
      costType: lab.costType || "percent_of_patient_bill",
      costPercent: String(lab.costPercent ?? "50"),
      costFixed: String(lab.costFixed ?? "0"),
      paymentCycle: lab.paymentCycle || "monthly",
      defaultTdsPercent: String(lab.defaultTdsPercent ?? "10.00"),
      defaultPaymentMode: lab.defaultPaymentMode || "bank_transfer",
    });
    setOpen(true);
  };

  const onSubmit = (data: LabForm) => {
    const payload = {
      ...data,
      costPercent: Number(data.costPercent),
      costFixed: Number(data.costFixed),
      defaultTdsPercent: Number(data.defaultTdsPercent),
    };
    if (editLab) {
      updateLab.mutate({ id: editLab.id, data: payload as any });
    } else {
      createLab.mutate(payload as any);
    }
  };

  const activeLabs = labs.filter((l) => l.isActive);
  const inactiveLabs = labs.filter((l) => !l.isActive);

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsource Lab Settings"
        subtitle="Configure partner labs, tax compliance parameters, and billing frequencies"
        actions={
          <Button size="sm" onClick={openCreate} className="bg-primary text-white hover:bg-primary/90">
            <Plus size={14} className="mr-1" /> Add Reference Lab
          </Button>
        }
      />

      <div className="px-6 space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-48 bg-muted rounded-xl animate-pulse border border-border" />
            ))}
          </div>
        ) : labs.length === 0 ? (
          <div className="text-center py-16 bg-card border border-border rounded-xl">
            <Building2 size={40} className="mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="font-medium text-foreground">No reference labs configured</p>
            <p className="text-sm text-muted-foreground mt-1">Add labs to start managing referred tests and rate lists</p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeLabs.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Active Reference Labs ({activeLabs.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {activeLabs.map((lab) => (
                    <LabSettingCard key={lab.id} lab={lab} onEdit={openEdit} />
                  ))}
                </div>
              </div>
            )}

            {inactiveLabs.length > 0 && (
              <div className="pt-4 border-t border-border">
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                  Inactive Labs ({inactiveLabs.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-60">
                  {inactiveLabs.map((lab) => (
                    <LabSettingCard key={lab.id} lab={lab} onEdit={openEdit} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditLab(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              {editLab ? "Edit Partner Lab Settings" : "Configure New Reference Lab"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label className="text-xs font-semibold text-foreground">Lab Name *</Label>
                <Input {...register("name", { required: true })} className="mt-1 bg-background" placeholder="E.g. Lal PathLabs" />
              </div>

              <div>
                <Label className="text-xs font-semibold text-foreground">Contact Person</Label>
                <Input {...register("contactPerson")} className="mt-1 bg-background" placeholder="E.g. Dr. Roy" />
              </div>

              <div>
                <Label className="text-xs font-semibold text-foreground">Mobile / Phone</Label>
                <Input {...register("phone")} className="mt-1 bg-background" placeholder="E.g. +91 9876543210" />
              </div>

              <div>
                <Label className="text-xs font-semibold text-foreground">GSTIN</Label>
                <Input {...register("gstin")} className="mt-1 bg-background" placeholder="E.g. 19AAACC1206H1Z5" />
              </div>

              <div>
                <Label className="text-xs font-semibold text-foreground">Email</Label>
                <Input type="email" {...register("email")} className="mt-1 bg-background" placeholder="E.g. accounts@lab.com" />
              </div>

              <div className="col-span-2">
                <Label className="text-xs font-semibold text-foreground">Address</Label>
                <Input {...register("address")} className="mt-1 bg-background" placeholder="E.g. Sector V, Salt Lake City" />
              </div>
            </div>

            <div className="border-t border-border pt-4 mt-2">
              <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-3">Accounts & Taxation</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs font-semibold text-foreground">Payment Cycle</Label>
                  <select {...register("paymentCycle")} className="mt-1 w-full text-sm border rounded-md px-2.5 py-2 bg-background border-input text-foreground">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs font-semibold text-foreground">TDS Rate (%)</Label>
                  <Input type="number" step="0.01" {...register("defaultTdsPercent")} className="mt-1 bg-background" />
                </div>

                <div>
                  <Label className="text-xs font-semibold text-foreground">Payment Mode</Label>
                  <select {...register("defaultPaymentMode")} className="mt-1 w-full text-sm border rounded-md px-2.5 py-2 bg-background border-input text-foreground">
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4 mt-2">
              <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">Cost Computation Engine</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold text-foreground">Default Rate Profile</Label>
                  <select {...register("costType")} className="mt-1 w-full text-sm border rounded-md px-2.5 py-2 bg-background border-input text-foreground">
                    <option value="percent_of_patient_bill">Patient Bill % Share</option>
                    <option value="fixed_per_test">Flat Cost Per Test</option>
                    <option value="custom_per_test">Custom Rate Card Only</option>
                  </select>
                </div>

                {watch("costType") === "percent_of_patient_bill" && (
                  <div>
                    <Label className="text-xs font-semibold text-foreground">Partner Share (%)</Label>
                    <Input type="number" step="0.1" {...register("costPercent")} className="mt-1 bg-background" />
                  </div>
                )}

                {watch("costType") === "fixed_per_test" && (
                  <div>
                    <Label className="text-xs font-semibold text-foreground">Flat Amount (₹)</Label>
                    <Input type="number" step="1" {...register("costFixed")} className="mt-1 bg-background" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" id="isActive" {...register("isActive")} className="rounded accent-primary border-input" />
              <Label htmlFor="isActive" className="text-sm text-foreground">This lab is active and accepts references</Label>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-primary text-white hover:bg-primary/90">
                {createLab.isPending || updateLab.isPending ? "Saving..." : (editLab ? "Update Configuration" : "Save Configuration")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabSettingCard({ lab, onEdit }: { lab: Lab; onEdit: (l: Lab) => void }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-h-[190px]">
      <div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Building2 size={16} />
            </div>
            <h3 className="font-semibold text-foreground">{lab.name}</h3>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => onEdit(lab)}>
            <Pencil size={14} />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3 text-xs text-muted-foreground border-b border-border/50 pb-4">
          <div className="flex items-center gap-1.5">
            <CalendarRange size={13} className="text-muted-foreground" />
            <span>Cycle: <strong className="text-foreground capitalize">{lab.paymentCycle || "monthly"}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <BadgePercent size={13} className="text-muted-foreground" />
            <span>TDS: <strong className="text-foreground">{Number(lab.defaultTdsPercent ?? 10).toFixed(1)}%</strong></span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <Wallet size={13} className="text-muted-foreground" />
            <span>Mode: <strong className="text-foreground capitalize">{String(lab.defaultPaymentMode ?? "bank_transfer").replace("_", " ")}</strong></span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[11px] text-muted-foreground">
        {lab.phone && (
          <div className="flex items-center gap-2">
            <Phone size={12} className="text-muted-foreground" />
            <span>{lab.phone}</span>
          </div>
        )}
        {lab.email && (
          <div className="flex items-center gap-2">
            <Mail size={12} className="text-muted-foreground" />
            <span className="truncate">{lab.email}</span>
          </div>
        )}
      </div>
    </div>
  );
}
