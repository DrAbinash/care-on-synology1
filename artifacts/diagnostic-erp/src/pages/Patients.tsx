import { useState, useRef } from "react";
import { Link } from "wouter";
import {
  useListPatients,
  useCreatePatient,
  getListPatientsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { buildCsv, downloadCsv, parseCsv } from "@/lib/csv";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, ChevronRight, Upload, X, User, Pencil, Download, Users } from "lucide-react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { readStaffSession, FULL_ACCESS_ROLES, hasSubPermission } from "@/lib/staffSession";
import UnifiedScanCapture from "@/components/UnifiedScanCapture";
import { useDocumentScan } from "@/hooks/useDocumentScan";

type PatientForm = {
  firstName: string;
  lastName: string;
  ageValue: number;
  ageUnit: "years" | "months" | "days";
  gender: "male" | "female" | "other";
  phone: string;
  email?: string;
  address?: string;
  bloodGroup?: string;
};

type ClinicSettingsLite = { patientPhotoEnabled?: boolean; patientPhoneRequired?: boolean };

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export default function Patients() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const patientScan = useDocumentScan();
  const [editPatient, setEditPatient] = useState<{ id: number; firstName: string; lastName: string; dateOfBirth: string; ageValue?: number | null; ageUnit?: string | null; gender: string; phone: string; email: string | null; address: string | null; bloodGroup: string | null } | null>(null);
  const queryClient = useQueryClient();

  const session = readStaffSession();
  const canEdit = !session || hasSubPermission(session, "/patients", "edit");
  const canCreate = !session || hasSubPermission(session, "/patients", "create");

  const { data: clinicSettings } = useQuery<ClinicSettingsLite>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
  });
  const photoEnabled = !!clinicSettings?.patientPhotoEnabled;
  const phoneRequired = clinicSettings?.patientPhoneRequired ?? true;

  // Debounce the search term before it reaches the server query — typing
  // still feels instant (this.search updates every keystroke for the input
  // value), but the API is only hit ~350ms after the user pauses instead of
  // once per keystroke.
  const debouncedSearch = useDebouncedValue(search, 350);
  const { data, isLoading } = useListPatients({ search: debouncedSearch || undefined, page, limit: 20 });
  const createPatient = useCreatePatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        setOpen(false);
        setPhotoDataUrl(null);
        setPhotoErr("");
        reset();
      },
    },
  });

  const { register, handleSubmit, reset, setValue, watch } = useForm<PatientForm>({
    defaultValues: { gender: "male" },
  });

  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Export the entire patient roster to CSV. Photos and portal-PIN data are
  // NOT included — those are sensitive and have separate UI flows.
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get<{ patients: Array<{
        patientId: string; firstName: string; lastName: string;
        dateOfBirth: string; gender: string; phone: string;
        email?: string | null; address?: string | null; bloodGroup?: string | null;
      }> }>("/api/patients?limit=10000");
      const rows = (res?.patients ?? []).map((p) => ({
        patientId: p.patientId,
        firstName: p.firstName,
        lastName: p.lastName,
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
        phone: p.phone,
        email: p.email ?? "",
        address: p.address ?? "",
        bloodGroup: p.bloodGroup ?? "",
      }));
      const csv = buildCsv(
        ["patientId","firstName","lastName","dateOfBirth","gender","phone","email","address","bloodGroup"],
        rows,
      );
      downloadCsv(csv, `patients-${new Date().toISOString().slice(0, 10)}.csv`);
      toast({ title: "Export ready", description: `${rows.length} patients downloaded.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message || "Could not export patients.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  // Import a CSV. Patients are upserted by patientId (preferred) or by
  // phone + name (fallback) so re-importing the same file is safe.
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
        "/api/patients/import", { rows },
      );
      queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
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

  const onPhotoChange = (file: File | null) => {
    setPhotoErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoErr("Please upload an image file"); return; }
    if (file.size > 1_500_000) { setPhotoErr("Image too large (max 1.5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const onSubmit = (data: PatientForm) => {
    const now = new Date();
    let dateOfBirth = "";
    if (data.ageUnit === "years") {
      dateOfBirth = `${now.getFullYear() - data.ageValue}-01-01`;
    } else if (data.ageUnit === "months") {
      const d = new Date();
      d.setMonth(d.getMonth() - data.ageValue);
      dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - data.ageValue);
      dateOfBirth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    const payload: Record<string, unknown> = {
      firstName: data.firstName,
      lastName: data.lastName,
      gender: data.gender,
      phone: data.phone,
      dateOfBirth,
      ageValue: data.ageValue,
      ageUnit: data.ageUnit,
      email: data.email || null,
      address: data.address || null,
      bloodGroup: data.bloodGroup || null,
    };
    if (photoEnabled && photoDataUrl) payload.photoDataUrl = photoDataUrl;
    createPatient.mutate({ data: payload as unknown as Parameters<typeof createPatient.mutate>[0]["data"] });
  };

  const bloodGroups = BLOOD_GROUPS;

  return (
    <div className="pb-8 bg-slate-50 dark:bg-slate-900/20 min-h-full">
      <PageHeader
        title="Patients"
        subtitle={`${data?.total ?? 0} registered patients`}
        actions={
          <div className="flex gap-2">
            <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFileChosen} />
            {canCreate && (
              <Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={importing} title="Upload a CSV to add or update patients in bulk">
                <Upload size={14} className="mr-1" /> {importing ? "Importing…" : "Import CSV"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={exporting} title="Download the full patient roster as CSV">
              <Download size={14} className="mr-1" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            {canCreate && (
              <Button
                size="sm"
                onClick={() => setOpen(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md"
              >
                <Plus size={14} className="mr-1" /> New Patient
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6 space-y-4">
        {/* Patients card */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-cyan-50 to-transparent border-l-4 border-l-cyan-500">
            <div className="flex items-center gap-2">
              <Users size={15} className="text-cyan-600" />
              <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Patient Registry</span>
            </div>
            <div className="relative max-w-xs w-full">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, ID, or phone..."
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-muted/30">
                  {photoEnabled && <th className="px-4 py-3 font-medium w-12"></th>}
                  <th className="px-4 py-3 font-medium">Patient ID</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                  <th className="px-4 py-3 font-medium">Gender</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Blood Group</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="border-b border-border/50 animate-pulse">
                      {[...Array(photoEnabled ? 8 : 7)].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded w-24" /></td>)}
                    </tr>
                  ))
                ) : data?.patients?.length === 0 ? (
                  <tr><td colSpan={photoEnabled ? 8 : 7} className="px-4 py-12 text-center text-muted-foreground">No patients found</td></tr>
                ) : (
                  data?.patients?.map((p) => {
                    const ageStr = (() => {
                      if (p.ageValue != null && p.ageUnit) {
                        if (p.ageUnit === "years") return p.ageValue > 0 ? `${p.ageValue} Yrs` : "—";
                        if (p.ageUnit === "months") return `${p.ageValue} Mo`;
                        if (p.ageUnit === "days") return `${p.ageValue} D`;
                      }
                      if (!p.dateOfBirth) return "—";
                      const y = new Date().getFullYear() - new Date(p.dateOfBirth).getFullYear();
                      return y > 0 ? `${y} Yrs` : "—";
                    })();
                    const photo = (p as { photoDataUrl?: string | null }).photoDataUrl;
                    return (
                      <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                        {photoEnabled && (
                          <td className="px-4 py-2">
                            {photo ? (
                              <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover border border-border" />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                <User size={14} />
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{p.patientId}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{p.firstName} {p.lastName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ageStr}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">{p.gender}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.phone}</td>
                        <td className="px-4 py-3">
                          {p.bloodGroup ? (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs font-medium">{p.bloodGroup}</span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditPatient({
                                    id: p.id,
                                    firstName: p.firstName,
                                    lastName: p.lastName,
                                    dateOfBirth: p.dateOfBirth,
                                    ageValue: p.ageValue,
                                    ageUnit: p.ageUnit,
                                    gender: p.gender,
                                    phone: p.phone,
                                    email: p.email ?? null,
                                    address: p.address ?? null,
                                    bloodGroup: p.bloodGroup ?? null,
                                  });
                                }}
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary"
                                title="Edit patient"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            <Link href={`/patients/${p.id}`} className="text-muted-foreground hover:text-foreground inline-flex p-1.5 rounded hover:bg-muted">
                              <ChevronRight size={16} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.total > 20 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register New Patient</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input {...register("firstName", { required: true })} className="mt-1" />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input {...register("lastName", { required: true })} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Age *</Label>
                <div className="flex gap-1 mt-1">
                  <Input
                    type="number"
                    min={0}
                    max={watch("ageUnit") === "years" ? 150 : 365}
                    placeholder="e.g. 35"
                    {...register("ageValue", { required: true, min: 0, max: 365, valueAsNumber: true })}
                    className="flex-1"
                  />
                  <Select value={watch("ageUnit")} onValueChange={(v) => setValue("ageUnit", v as "years" | "months" | "days")}>
                    <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="years">Yrs</SelectItem>
                      <SelectItem value="months">Mo</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Gender *</Label>
                <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v as "male" | "female" | "other")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phone {phoneRequired && "*"}</Label>
                <Input {...register("phone", { required: phoneRequired })} className="mt-1" />
              </div>
              <div>
                <Label>Blood Group</Label>
                <Select onValueChange={(v) => setValue("bloodGroup", v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {bloodGroups.map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" {...register("email")} className="mt-1" />
            </div>
            <div>
              <Label>Address</Label>
              <Input {...register("address")} className="mt-1" />
            </div>
            {photoEnabled && (
              <div>
                <Label>Patient Photo</Label>
                <div className="mt-1 flex items-center gap-3">
                  <div className="w-16 h-16 rounded-lg border border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
                    {photoDataUrl ? (
                      <img src={photoDataUrl} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <User size={22} className="text-muted-foreground/60" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        capture="user"
                        id="patient-photo-input"
                        className="hidden"
                        onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => document.getElementById("patient-photo-input")?.click()}
                      >
                        <Upload size={13} className="mr-1.5" />
                        {photoDataUrl ? "Change" : "Upload Photo"}
                      </Button>
                      <UnifiedScanCapture
                        module="patients"
                        docType="photo"
                        triggerLabel="Scan / Capture"
                        className="h-8 px-3 text-xs"
                        onCapture={async (result) => {
                          const scanned = await patientScan.handleCapture(result);
                          setPhotoErr("");
                          setPhotoDataUrl(scanned.dataUrl);
                        }}
                        onError={(msg) => setPhotoErr(msg)}
                      />
                      {photoDataUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => { setPhotoDataUrl(null); setPhotoErr(""); }}
                        >
                          <X size={13} className="mr-1" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">JPG/PNG, &lt; 1.5 MB. Optional.</p>
                    {photoErr && <p className="text-xs text-destructive">{photoErr}</p>}
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPatient.isPending}>
                {createPatient.isPending ? "Saving..." : "Register Patient"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {editPatient && (
        <EditPatientDialog
          patient={editPatient}
          phoneRequired={phoneRequired}
          onClose={() => setEditPatient(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
            setEditPatient(null);
          }}
        />
      )}
    </div>
  );
}

type EditForm = {
  firstName: string;
  lastName: string;
  ageValue: number;
  ageUnit: "years" | "months" | "days";
  gender: "male" | "female" | "other";
  phone: string;
  email?: string;
  address?: string;
  bloodGroup?: string;
};

function EditPatientDialog({
  patient, phoneRequired, onClose, onSaved,
}: {
  patient: { id: number; firstName: string; lastName: string; ageValue?: number | null; ageUnit?: string | null; dateOfBirth: string; gender: string; phone: string; email: string | null; address: string | null; bloodGroup: string | null };
  phoneRequired: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Derive ageValue/ageUnit defaults from the patient record
  const initialAgeVal = patient.ageValue ?? (() => {
    const dob = new Date(patient.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const years = new Date().getFullYear() - dob.getFullYear();
      return years > 0 ? years : 0;
    }
    return 0;
  })();
  const initialAgeUnit = patient.ageUnit ?? "years";

  const { register, handleSubmit, setValue, watch } = useForm<EditForm>({
    defaultValues: {
      firstName: patient.firstName,
      lastName: patient.lastName,
      ageValue: initialAgeVal,
      ageUnit: initialAgeUnit as EditForm["ageUnit"],
      gender: (patient.gender as EditForm["gender"]) || "male",
      phone: patient.phone,
      email: patient.email ?? "",
      address: patient.address ?? "",
      bloodGroup: patient.bloodGroup ?? "",
    },
  });
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (data: EditForm) => {
      // Recompute dateOfBirth from ageValue + ageUnit
      const now = new Date();
      let dobStr = patient.dateOfBirth;
      if (data.ageUnit === "years") {
        dobStr = `${now.getFullYear() - data.ageValue}-01-01`;
      } else if (data.ageUnit === "months") {
        const d = new Date();
        d.setMonth(d.getMonth() - data.ageValue);
        dobStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      } else if (data.ageUnit === "days") {
        const d = new Date();
        d.setDate(d.getDate() - data.ageValue);
        dobStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      return api.put(`/api/patients/${patient.id}`, {
        firstName: data.firstName,
        lastName: data.lastName,
        gender: data.gender,
        phone: data.phone,
        email: data.email || null,
        address: data.address || null,
        bloodGroup: data.bloodGroup || null,
        dateOfBirth: dobStr,
        ageValue: data.ageValue,
        ageUnit: data.ageUnit,
      });
    },
    onSuccess: onSaved,
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Dialog open={true} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Patient — {patient.firstName} {patient.lastName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>First Name *</Label><Input {...register("firstName", { required: true })} className="mt-1" /></div>
            <div><Label>Last Name *</Label><Input {...register("lastName", { required: true })} className="mt-1" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Age *</Label>
              <div className="flex gap-1 mt-1">
                <Input type="number" min={0} max={watch("ageUnit") === "years" ? 150 : 365} {...register("ageValue", { required: true, min: 0, max: 365, valueAsNumber: true })} className="flex-1" />
                <Select value={watch("ageUnit")} onValueChange={(v) => setValue("ageUnit", v as EditForm["ageUnit"])}>
                  <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="years">Yrs</SelectItem>
                    <SelectItem value="months">Mo</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Gender *</Label>
              <Select value={watch("gender")} onValueChange={(v) => setValue("gender", v as EditForm["gender"])}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Phone {phoneRequired && "*"}</Label><Input {...register("phone", { required: phoneRequired })} className="mt-1" /></div>
            <div>
              <Label>Blood Group</Label>
              <Select value={watch("bloodGroup") || undefined} onValueChange={(v) => setValue("bloodGroup", v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Email</Label><Input type="email" {...register("email")} className="mt-1" /></div>
          <div><Label>Address</Label><Input {...register("address")} className="mt-1" /></div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
