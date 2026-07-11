import { useState, useRef } from "react";
import {
  useListDoctors,
  useCreateDoctor,
  getListDoctorsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { buildCsv, downloadCsv, parseCsv } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, Stethoscope, Phone, Building2, Mail, Pencil, Trash2, Download, Upload, AlertTriangle } from "lucide-react";
import { useForm } from "react-hook-form";
import { useDeleteDoctor } from "@workspace/api-client-react";

// Module A (compliance): commission fields removed from staff-facing UI.
// Referral commission is configured exclusively in the Super Admin Portal.
type DoctorForm = {
  name: string;
  specialization: string;
  phone?: string;
  email?: string;
  hospitalAffiliation?: string;
  address?: string;
  area?: string;
  registrationNumber?: string;
};

type Doctor = {
  id: number;
  name: string;
  specialization: string;
  phone?: string | null;
  email?: string | null;
  hospitalAffiliation?: string | null;
  address?: string | null;
  area?: string | null;
  registrationNumber?: string | null;
};

export default function Doctors() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [deletingDoctor, setDeletingDoctor] = useState<Doctor | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useListDoctors({ search: search || undefined });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListDoctorsQueryKey() });

  const createDoctor = useCreateDoctor({
    mutation: { onSuccess: () => { invalidate(); setOpen(false); reset(); } },
  });

  const updateDoctor = useMutation({
    mutationFn: (body: DoctorForm & { id: number }) => {
      const { id, ...rest } = body;
      return api.patch(`/api/doctors/${id}`, rest);
    },
    onSuccess: () => { invalidate(); setEditingDoctor(null); },
  });

  const deleteDoctor = useMutation({
    mutationFn: (id: number) => api.delete(`/api/doctors/${id}`),
    onSuccess: () => { invalidate(); setDeletingDoctor(null); },
  });

  const { register, handleSubmit, reset } = useForm<DoctorForm>();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [dupOpen, setDupOpen] = useState(false);

  // Export the full doctor list as a CSV. Ignores the current search box
  // so the user always gets a complete backup with one click.
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get<{ doctors: Doctor[] }>("/api/doctors");
      const rows = (res?.doctors ?? []).map((d) => ({
        name: d.name,
        specialization: d.specialization,
        phone: d.phone ?? "",
        email: d.email ?? "",
        hospitalAffiliation: d.hospitalAffiliation ?? "",
        address: d.address ?? "",
        area: d.area ?? "",
        registrationNumber: d.registrationNumber ?? "",
      }));
      const csv = buildCsv(
        ["name","specialization","phone","email","hospitalAffiliation","address","area","registrationNumber"],
        rows,
      );
      downloadCsv(csv, `doctors-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: "Export ready", description: `${rows.length} doctors downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message || "Could not export the list.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // Import a CSV. Doctors are upserted server-side by registrationNumber
  // (most reliable), then by name + phone, then by name only — so safe
  // to re-import without creating duplicates.
  const onImportFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No data rows found in the CSV.", variant: "destructive" });
        return;
      }
      const result = await api.post<{ inserted: number; updated: number; skipped: number; errors: { row: number; reason: string }[] }>(
        "/api/doctors/import", { rows },
      );
      invalidate();
      const desc = `${result.inserted} added, ${result.updated} updated`
        + (result.skipped > 0 ? `, ${result.skipped} skipped` : "")
        + (result.errors[0] ? ` — first issue: row ${result.errors[0].row}: ${result.errors[0].reason}` : "");
      toast({
        title: result.skipped > 0 ? "Import finished with warnings" : "Import complete",
        description: desc,
        variant: result.skipped > 0 ? "destructive" : "default",
      });
    } catch (err) {
      toast({ title: "Import failed", description: (err as Error).message || "Could not import the file.", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const { register: regEdit, handleSubmit: handleEditSubmit, reset: resetEdit } = useForm<DoctorForm>();

  const onSubmit = (data: DoctorForm) => {
    createDoctor.mutate({
      data: data as Parameters<typeof createDoctor.mutate>[0]["data"],
    });
  };

  const openEdit = (doc: Doctor) => {
    setEditingDoctor(doc);
    resetEdit({
      name: doc.name,
      specialization: doc.specialization,
      phone: doc.phone ?? "",
      email: doc.email ?? "",
      hospitalAffiliation: doc.hospitalAffiliation ?? "",
      address: doc.address ?? "",
      area: doc.area ?? "",
      registrationNumber: doc.registrationNumber ?? "",
    });
  };

  const onEditSubmit = handleEditSubmit((d) => {
    if (!editingDoctor) return;
    updateDoctor.mutate({ id: editingDoctor.id, ...d });
  });

  return (
    <div className="pb-8">
      <PageHeader
        title="Referring Doctors"
        subtitle={`${data?.total ?? 0} doctors`}
        actions={
          <div className="flex gap-2">
            <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFileChosen} />
            <Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={importing} title="Upload a CSV to add or update doctors in bulk">
              <Upload size={14} className="mr-1" /> {importing ? "Importing…" : "Import CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting} title="Download the full doctor list as CSV">
              <Download size={14} className="mr-1" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDupOpen(true)} title="Find duplicate doctors">
              <AlertTriangle size={14} className="mr-1" /> Find Duplicates
            </Button>
            <Button size="sm" onClick={() => { setOpen(true); reset(); }}>
              <Plus size={14} className="mr-1" /> Add Doctor
            </Button>
          </div>
        }
      />

      <div className="px-6 space-y-4">
        <div className="relative max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search doctors..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-12 text-destructive space-y-2">
            <p>Couldn't load doctors — check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : data?.doctors?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No doctors found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.doctors?.map((d) => {
              const doc = d as unknown as Doctor;
              return (
                <div key={doc.id} className="bg-card border border-card-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Stethoscope size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">{doc.name}</p>
                      <p className="text-xs text-primary font-medium mt-0.5">{doc.specialization}</p>
                      {doc.phone && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                          <Phone size={11} /> {doc.phone}
                        </div>
                      )}
                      {doc.email && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          <Mail size={11} /> {doc.email}
                        </div>
                      )}
                      {doc.hospitalAffiliation && (
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                          <Building2 size={11} /> {doc.hospitalAffiliation}
                        </div>
                      )}
                      {doc.area && (
                        <div className="mt-1 text-[11px] text-primary/80 font-medium">Area: {doc.area}</div>
                      )}
                      {doc.address && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{doc.address}</div>
                      )}
                      {doc.registrationNumber && (
                        <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                          Reg. No: {doc.registrationNumber}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openEdit(doc)}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => setDeletingDoctor(doc)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Doctor Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Referring Doctor</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input {...register("name", { required: true })} className="mt-1" placeholder="Dr. Full Name" />
            </div>
            <div>
              <Label>Specialization *</Label>
              <Input {...register("specialization", { required: true })} className="mt-1" placeholder="e.g. Cardiologist" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input {...register("phone")} className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" {...register("email")} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Hospital / Clinic Affiliation</Label>
              <Input {...register("hospitalAffiliation")} className="mt-1" />
            </div>
            <div>
              <Label>Address</Label>
              <Input {...register("address")} className="mt-1" placeholder="Full clinic address" />
            </div>
            <div>
              <Label>Area / Locality</Label>
              <Input {...register("area")} className="mt-1" placeholder="e.g. Bilasi Town, Deoghar" />
            </div>
            <div>
              <Label>Medical Council Registration No.</Label>
              <Input {...register("registrationNumber")} className="mt-1" placeholder="e.g. MCI-12345 or BMC/2018/4567" />
              <p className="mt-1 text-[11px] text-muted-foreground">Required on PCPNDT Form F prints and audit records.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createDoctor.isPending}>
                {createDoctor.isPending ? "Saving..." : "Add Doctor"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Doctor Dialog */}
      <Dialog open={!!editingDoctor} onOpenChange={(v) => { if (!v) setEditingDoctor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Doctor — {editingDoctor?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input {...regEdit("name", { required: true })} className="mt-1" />
            </div>
            <div>
              <Label>Specialization *</Label>
              <Input {...regEdit("specialization", { required: true })} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Phone</Label>
                <Input {...regEdit("phone")} className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" {...regEdit("email")} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Hospital / Clinic Affiliation</Label>
              <Input {...regEdit("hospitalAffiliation")} className="mt-1" />
            </div>
            <div>
              <Label>Address</Label>
              <Input {...regEdit("address")} className="mt-1" placeholder="Full clinic address" />
            </div>
            <div>
              <Label>Area / Locality</Label>
              <Input {...regEdit("area")} className="mt-1" placeholder="e.g. Bilasi Town, Deoghar" />
            </div>
            <div>
              <Label>Medical Council Registration No.</Label>
              <Input {...regEdit("registrationNumber")} className="mt-1" placeholder="e.g. MCI-12345" />
            </div>
            {updateDoctor.isError && (
              <p className="text-xs text-red-600">{(updateDoctor.error as Error)?.message ?? "Failed to update"}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingDoctor(null)}>Cancel</Button>
              <Button type="submit" disabled={updateDoctor.isPending}>
                {updateDoctor.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingDoctor} onOpenChange={(v) => { if (!v) setDeletingDoctor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingDoctor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the doctor from the system. Existing orders and commission records linked to this doctor will retain their historical data but the doctor cannot be re-selected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deletingDoctor && deleteDoctor.mutate(deletingDoctor.id)}
            >
              {deleteDoctor.isPending ? "Deleting..." : "Delete Doctor"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DuplicatesDialog open={dupOpen} onOpenChange={setDupOpen} />
    </div>
  );
}

// ── Duplicate Doctor Finder ──────────────────────────────────────────────

type DupDoctor = {
  id: number;
  name: string;
  specialization: string;
  phone?: string | null;
  email?: string | null;
  hospitalAffiliation?: string | null;
  address?: string | null;
  area?: string | null;
  registrationNumber?: string | null;
};

type DuplicateDoctorGroup = {
  name: string;
  doctors: DupDoctor[];
};

function DuplicatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: rawRes, isLoading } = useQuery({
    queryKey: ["all-doctors-for-dups"],
    queryFn: () => api.get<{ doctors: DupDoctor[] }>("/api/doctors?limit=10000"),
    enabled: open,
  });
  const { toast } = useToast();
  const [dupSearch, setDupSearch] = useState("");

  const delDoc = useDeleteDoctor({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDoctorsQueryKey() });
        qc.invalidateQueries({ queryKey: ["all-doctors-for-dups"] });
        toast({ title: "Duplicate deleted" });
      },
      onError: (e: Error) => {
        toast({ title: "Delete failed", description: e.message, variant: "destructive" });
      },
    },
  });

  const doctors = (rawRes as { doctors?: DupDoctor[] } | undefined)?.doctors ?? [];
  const searchTerm = dupSearch.trim().toLowerCase();

  const groups: DuplicateDoctorGroup[] = (() => {
    const map = new Map<string, DupDoctor[]>();
    for (const d of doctors) {
      const key = (d.name ?? "").trim().toLowerCase();
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    const out: DuplicateDoctorGroup[] = [];
    for (const [name, list] of map) {
      if (list.length > 1) {
        if (!searchTerm || name.includes(searchTerm)) {
          out.push({ name, doctors: list });
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Duplicate Doctors</DialogTitle>
          <DialogDescription>
            Doctors with the same name are grouped below. Click the trash icon to delete the duplicate you don't want. Doctors linked to existing orders are protected from deletion.
          </DialogDescription>
        </DialogHeader>
        <div className="px-1 pt-2 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by partial name (e.g. 'neha' to find 'DR NEHA' and 'DR NEHA PRIYA')"
            value={dupSearch}
            onChange={(e) => setDupSearch(e.target.value)}
            className="text-sm pl-8"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading doctors…</div>
          ) : groups.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">No duplicate doctors found. All doctor names are unique.</div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g.name} className="border border-card-border rounded-lg overflow-hidden">
                  <div className="bg-muted/30 px-4 py-2 font-semibold text-sm border-b border-card-border flex items-center gap-2">
                    <AlertTriangle size={14} className="text-orange-500" />
                    {g.name}
                    <span className="text-muted-foreground font-normal text-xs">({g.doctors.length} entries with same name)</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted/20">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Specialization</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Phone</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Area</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Affiliation</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Reg. No</th>
                        <th className="px-4 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.doctors.map((d) => (
                        <tr key={d.id} className="border-b border-card-border/50 last:border-0 hover:bg-muted/10">
                          <td className="px-4 py-2 text-xs">{d.specialization}</td>
                          <td className="px-4 py-2 text-xs font-mono">{d.phone ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{d.email ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{d.area ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{d.hospitalAffiliation ?? "—"}</td>
                          <td className="px-4 py-2 text-xs font-mono">{d.registrationNumber ?? "—"}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              onClick={() => {
                                if (confirm(`Delete duplicate "${d.name}"?\n\nThis cannot be undone. If this doctor has been used in orders, the delete will be blocked.`)) {
                                  delDoc.mutate({ id: d.id });
                                }
                              }}
                              className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                              disabled={delDoc.isPending}
                              title="Delete this duplicate"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
