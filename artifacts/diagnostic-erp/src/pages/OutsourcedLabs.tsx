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
import { Plus, Pencil, Trash2, Building2, Phone, Mail, MapPin } from "lucide-react";
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
  createdAt: string;
  costType?: string | null;
  costPercent?: number | string | null;
  costFixed?: number | string | null;
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
  costType?: string;
  costPercent?: string;
  costFixed?: string;
};

const LABS_KEY = ["outsourced-labs"] as const;

function useLabs() {
  return useQuery<Lab[]>({
    queryKey: LABS_KEY,
    queryFn: () => api.get<Lab[]>("/api/outsourced-labs"),
  });
}

export default function OutsourcedLabs() {
  const { data: labs = [], isLoading } = useLabs();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editLab, setEditLab] = useState<Lab | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Lab | null>(null);

  const { register, handleSubmit, reset, formState, watch } = useForm<LabForm>({
    defaultValues: { isActive: true, costType: "percent_of_patient_bill", costPercent: "50", costFixed: "" },
  });

  const createLab = useMutation({
    mutationFn: (data: LabForm) => api.post<Lab>("/api/outsourced-labs", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LABS_KEY });
      setOpen(false);
      reset({ isActive: true });
      toast({ title: "Lab added successfully" });
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
      toast({ title: "Lab updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteLab = useMutation({
    mutationFn: (id: number) => api.delete(`/api/outsourced-labs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LABS_KEY });
      setDeleteConfirm(null);
      toast({ title: "Lab deleted" });
    },
    onError: (e: Error) => {
      setDeleteConfirm(null);
      toast({ title: "Cannot delete", description: e.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditLab(null);
    reset({ isActive: true, costType: "percent_of_patient_bill", costPercent: "50", costFixed: "" });
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
      costType: (lab.costType as string) || "percent_of_patient_bill",
      costPercent: lab.costPercent != null ? String(lab.costPercent) : "50",
      costFixed: lab.costFixed != null ? String(lab.costFixed) : "",
    });
    setOpen(true);
  };

  const onSubmit = (data: LabForm) => {
    const payload = {
      ...data,
      contactPerson: data.contactPerson || undefined,
      phone: data.phone || undefined,
      email: data.email || undefined,
      address: data.address || undefined,
      gstin: data.gstin || undefined,
      notes: data.notes || undefined,
      costType: data.costType || undefined,
      costPercent: data.costPercent ? String(data.costPercent) : undefined,
      costFixed: data.costFixed ? String(data.costFixed) : undefined,
    };
    if (editLab) {
      updateLab.mutate({ id: editLab.id, data: payload });
    } else {
      createLab.mutate(payload);
    }
  };

  const activeLabs = labs.filter((l) => l.isActive);
  const inactiveLabs = labs.filter((l) => !l.isActive);

  return (
    <div className="pb-8">
      <PageHeader
        title="Outsourced Labs"
        subtitle={`${activeLabs.length} active outsourced lab${activeLabs.length !== 1 ? "s" : ""}`}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1" /> Add Lab
          </Button>
        }
      />

      <div className="px-6 space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-36 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : labs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No outsourced labs yet</p>
            <p className="text-sm mt-1">Add labs that you send tests to externally</p>
          </div>
        ) : (
          <>
            {activeLabs.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-3">Active Labs</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeLabs.map((lab) => <LabCard key={lab.id} lab={lab} onEdit={openEdit} onDelete={setDeleteConfirm} />)}
                </div>
              </div>
            )}
            {inactiveLabs.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-3">Inactive</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                  {inactiveLabs.map((lab) => <LabCard key={lab.id} lab={lab} onEdit={openEdit} onDelete={setDeleteConfirm} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditLab(null); reset({ isActive: true }); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editLab ? "Edit Lab" : "Add Outsourced Lab"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Lab Name *</Label>
              <Input {...register("name", { required: true })} className="mt-1" placeholder="XYZ Diagnostics Pvt. Ltd." />
              {formState.errors.name && <p className="text-xs text-destructive mt-1">Name is required</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Contact Person</Label>
                <Input {...register("contactPerson")} className="mt-1" placeholder="Dr. Sharma" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input {...register("phone")} className="mt-1" placeholder="9876543210" />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" {...register("email")} className="mt-1" placeholder="lab@example.com" />
            </div>
            <div>
              <Label>Address</Label>
              <Input {...register("address")} className="mt-1" placeholder="City, State" />
            </div>
            <div>
              <Label>GSTIN</Label>
              <Input {...register("gstin")} className="mt-1" placeholder="22AAAAA0000A1Z5" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input {...register("notes")} className="mt-1" placeholder="Turnaround time, pickup schedule, etc." />
            </div>
            <div className="border-t border-border pt-3">
              <Label className="text-xs uppercase text-muted-foreground tracking-wide">Default Cost Calculation</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <Label className="text-xs">Cost Mode</Label>
                  <select {...register("costType")} className="mt-1 w-full text-sm border rounded px-2 py-1.5 bg-background">
                    <option value="percent_of_patient_bill">% of Patient Bill</option>
                    <option value="fixed_per_test">Fixed per Test</option>
                    <option value="custom_per_test">Custom per Test</option>
                  </select>
                </div>
                {(watch("costType") ?? "percent_of_patient_bill") === "percent_of_patient_bill" ? (
                  <div>
                    <Label className="text-xs">Percent (%)</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
                      <Input type="number" min={0} max={100} step={0.01} {...register("costPercent")} className="pl-6" placeholder="50" />
                    </div>
                  </div>
                ) : (watch("costType") ?? "percent_of_patient_bill") === "fixed_per_test" ? (
                  <div>
                    <Label className="text-xs">Fixed Amount</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">₹</span>
                      <Input type="number" min={0} step={0.01} {...register("costFixed")} className="pl-6" placeholder="0.00" />
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground self-center">
                    Cost set per test in Test Catalog.
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="labActive" {...register("isActive")} className="rounded" />
              <Label htmlFor="labActive">Active</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createLab.isPending || updateLab.isPending}>
                {createLab.isPending || updateLab.isPending ? "Saving…" : (editLab ? "Save Changes" : "Add Lab")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Lab</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>?
            This cannot be undone. Labs linked to tests must be unlinked first.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteLab.isPending} onClick={() => deleteConfirm && deleteLab.mutate(deleteConfirm.id)}>
              {deleteLab.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabCard({ lab, onEdit, onDelete }: { lab: Lab; onEdit: (l: Lab) => void; onDelete: (l: Lab) => void }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-primary shrink-0" />
            <span className="font-semibold text-foreground">{lab.name}</span>
          </div>
          {lab.contactPerson && (
            <p className="text-xs text-muted-foreground mt-0.5 ml-[23px]">{lab.contactPerson}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => onEdit(lab)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(lab)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {lab.phone && (
          <div className="flex items-center gap-1.5">
            <Phone size={11} />
            <span>{lab.phone}</span>
          </div>
        )}
        {lab.email && (
          <div className="flex items-center gap-1.5">
            <Mail size={11} />
            <span>{lab.email}</span>
          </div>
        )}
        {lab.address && (
          <div className="flex items-center gap-1.5">
            <MapPin size={11} />
            <span>{lab.address}</span>
          </div>
        )}
        {lab.gstin && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium">GSTIN:</span>
            <span className="font-mono">{lab.gstin}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="font-medium">Default cost:</span>
          <span className="font-mono">
            {lab.costType === "fixed_per_test" ? `₹${Number(lab.costFixed ?? 0).toFixed(2)} per test`
              : lab.costType === "custom_per_test" ? "Custom per test"
                : `${lab.costPercent ?? 50}% of patient bill`}
          </span>
        </div>
        {lab.notes && (
          <p className="text-xs text-muted-foreground mt-1 border-t border-border/50 pt-1">{lab.notes}</p>
        )}
      </div>
    </div>
  );
}
