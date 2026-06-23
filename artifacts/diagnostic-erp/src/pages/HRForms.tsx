import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Plus, Search, Edit2, Printer, CheckCircle2, XCircle, Trash2, Eye, Download,
} from "lucide-react";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

// ── Boilerplate text constants (Hindi/English bilingual, kept in code) ───────
const INCENTIVE_TEXT = `आपकी performance के आधार पर आपको monthly performance incentive दिया जाएगा। / You will be paid a monthly performance incentive based on your performance.`;
const INCENTIVE_SLABS = [
  { label: "1st Month", pct: 15 }, { label: "2nd Month", pct: 15 },
  { label: "3rd Month", pct: 15 }, { label: "4th Month", pct: 15 },
  { label: "5th Month", pct: 15 }, { label: "6th Month", pct: 15 },
  { label: "From 7th Month onward", pct: 10 },
];
const DEDUCTION_TEXT = `Deductions on absence/late/policy violations will be applied as per the table below. / अनुपस्थित/देर से आने/नियम उल्लंघन पर निम्न दर से कटौती लागू होगी।`;
const DEDUCTION_SLABS = [
  { label: "Late by 1–3 days", pct: "3–5% of monthly salary" },
  { label: "Unauthorised absence (per day)", pct: "5–10% of monthly salary" },
  { label: "Repeated indiscipline / policy violation", pct: "10–20% of monthly salary" },
  { label: "Serious misconduct / abandonment", pct: "20–30% of monthly salary" },
];
const CONFIDENTIALITY_TEXT = `मैं घोषणा करता/करती हूँ कि कंपनी की सभी patient records, salary structures, business plans गोपनीय हैं और मैं इन्हें किसी third-party से साझा नहीं करूँगा/करूँगी। / I declare that all patient records, salary structures and business information of the company are confidential and I will not share them with any third party, during or after my employment.`;
const NOTICE_TEXT_GENERAL = `सामान्य कर्मचारी (Reception/Admin/Support) को resignation पर 30 दिन का notice देना होगा। / General staff must serve a 30-day notice on resignation.`;
const NOTICE_TEXT_CRITICAL = `Technical / Critical roles (Lab, Radiology, Doctor, Manager) को resignation पर 90 दिन का notice देना होगा। / Technical and critical-role staff must serve a 90-day notice on resignation.`;
const DECLARATION_TEXT = `मैं घोषणा करता/करती हूँ कि ऊपर दी गई सभी सूचनाएँ मेरी जानकारी के अनुसार सत्य हैं। / I declare that all information furnished above is true to the best of my knowledge.`;

const DOC_LABELS: { key: keyof DocChecklist; label: string }[] = [
  { key: "aadhaarCopy", label: "Aadhaar copy" },
  { key: "panCopy", label: "PAN copy" },
  { key: "educationCertificates", label: "Education certificates" },
  { key: "experienceCertificates", label: "Experience certificates" },
  { key: "passportPhoto", label: "Passport-size photographs" },
  { key: "cancelledCheque", label: "Cancelled cheque" },
  { key: "bankPassbook", label: "Bank passbook copy" },
  { key: "policeVerification", label: "Police verification" },
  { key: "medicalFitness", label: "Medical fitness certificate" },
  { key: "resignationFromPrevious", label: "Resignation acceptance (previous employer)" },
];

// ── Types ────────────────────────────────────────────────────────────────────
type DocChecklist = {
  aadhaarCopy?: boolean; panCopy?: boolean; educationCertificates?: boolean;
  experienceCertificates?: boolean; passportPhoto?: boolean; cancelledCheque?: boolean;
  bankPassbook?: boolean; policeVerification?: boolean; medicalFitness?: boolean;
  resignationFromPrevious?: boolean;
};
type FamilyDetails = {
  fatherName?: string; motherName?: string; spouseName?: string; anniversaryDate?: string;
  children?: { name: string; age?: string; school?: string }[];
  familyMembers?: { name: string; relation: string; age?: string }[];
};
type SalaryStructure = {
  basic?: number; hra?: number; conveyance?: number; medical?: number;
  special?: number; other?: number; gross?: number; fixed?: number; effectiveFrom?: string;
};
type HRForm = {
  id: number; staffId: number; formNumber: string;
  photoDataUrl: string | null; photoStorageKey: string | null; employeeName: string; fatherSpouseName: string | null;
  dateOfBirth: string | null; gender: string | null; bloodGroup: string | null;
  qualification: string | null; aadhaarNumber: string | null; panNumber: string | null;
  address: string | null; mobile: string | null; alternateMobile: string | null; email: string | null;
  designation: string | null; department: string | null;
  joiningDate: string | null; rejoiningDate: string | null;
  familyDetails: FamilyDetails | null;
  emergencyContactName: string | null; emergencyContactRelation: string | null; emergencyContactPhone: string | null;
  bankAccountHolder: string | null; bankName: string | null; bankAccountNumber: string | null; bankIfsc: string | null; bankBranch: string | null;
  salaryStructure: SalaryStructure | null; fixedSalary: number;
  incentiveAcknowledged: boolean; deductionAcknowledged: boolean;
  shiftType: string | null; reportingTime: string | null; dutyHours: string | null;
  confidentialityAcknowledged: boolean;
  noticePeriodDays: number; noticePolicyAcknowledged: boolean;
  documentChecklist: DocChecklist | null;
  employeeDeclarationDate: string | null; employeeSignatureDataUrl: string | null;
  remarks: string | null;
  managementStatus: "pending" | "approved" | "rejected";
  approvedByUserId: number | null; approvedByName: string | null; approvedAt: string | null;
  createdAt: string; updatedAt: string;
};
type Staff = {
  id: number; staffId: string; firstName: string; lastName: string;
  phone: string | null; email: string | null; role: string; department: string | null;
  joiningDate: string | null; baseSalary: number; address: string | null;
  emergencyContact: string | null; bankAccount: string | null; ifsc: string | null;
};

// ── PDF generation via jspdf + html2canvas (lazy-loaded) ────────────────────
async function downloadFormPdf(node: HTMLElement, filename: string) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  // Multi-page: paint the same image with a negative Y offset for each page slice.
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(imgData, "PNG", 0, position, imgW, imgH, undefined, "FAST");
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position = heightLeft - imgH;
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, position, imgW, imgH, undefined, "FAST");
    heightLeft -= pageH;
  }
  pdf.save(filename);
}

// ── Embeddable per-staff panel (used inside the Staff detail dialog) ─────────
export function StaffHRFormsPanel({ staffId }: { staffId: number }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const { data: forms = [], isLoading } = useQuery<HRForm[]>({
    queryKey: ["hr-forms-staff", staffId],
    queryFn: () => api.get<HRForm[]>(`/api/staff/${staffId}/hr-forms`),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">All re-joining / salary-revision forms for this employee.</div>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} className="mr-1" />New Form</Button>
      </div>
      <div className="rounded-lg border max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
            <th className="text-left px-3 py-2">Form #</th>
            <th className="text-left px-3 py-2">Created</th>
            <th className="text-right px-3 py-2">Fixed Salary</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 w-[1%]"></th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">Loading…</td></tr>}
            {!isLoading && forms.length === 0 && <tr><td colSpan={5} className="text-center py-4 text-muted-foreground">No HR forms yet</td></tr>}
            {forms.map((f) => (
              <tr key={f.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{f.formNumber}</td>
                <td className="px-3 py-2 text-xs">{new Date(f.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(Number(f.fixedSalary))}</td>
                <td className="px-3 py-2 text-center"><StatusBadge status={f.managementStatus} /></td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setViewingId(f.id)} title="Print preview"><Eye size={14} /></Button>
                  {f.managementStatus !== "approved" && (
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(f.id)} title="Edit"><Edit2 size={14} /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {createOpen && <FormEditorDialog mode="create" staffId={staffId} onClose={() => setCreateOpen(false)} />}
      {editingId !== null && <FormEditorDialog mode="edit" formId={editingId} onClose={() => setEditingId(null)} />}
      {viewingId !== null && <PrintPreviewDialog id={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HRFormsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createForStaffId, setCreateForStaffId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [pickStaffOpen, setPickStaffOpen] = useState(false);

  const { data: forms = [], isLoading } = useQuery<HRForm[]>({
    queryKey: ["hr-forms", { statusFilter }],
    queryFn: () =>
      api.get<HRForm[]>(`/api/hr-forms${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`),
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter((f) =>
      f.employeeName.toLowerCase().includes(q) ||
      f.formNumber.toLowerCase().includes(q) ||
      (f.designation ?? "").toLowerCase().includes(q) ||
      (f.department ?? "").toLowerCase().includes(q)
    );
  }, [forms, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR Re-Joining / Update Forms"
        subtitle="Multi-section employee re-joining and salary revision forms with management approval"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input className="pl-9" placeholder="Search name, form #, designation…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setPickStaffOpen(true)}><Plus size={14} className="mr-1.5" />New HR Form</Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2.5">Form #</th>
              <th className="text-left px-3 py-2.5">Employee</th>
              <th className="text-left px-3 py-2.5">Designation</th>
              <th className="text-right px-3 py-2.5">Fixed Salary</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th className="text-left px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5 w-[1%]"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (<tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</td></tr>)}
            {!isLoading && visible.length === 0 && (<tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No HR forms found</td></tr>)}
            {visible.map((f) => (
              <tr key={f.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{f.formNumber}</td>
                <td className="px-3 py-2 font-medium">{f.employeeName}</td>
                <td className="px-3 py-2">{f.designation ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(Number(f.fixedSalary))}</td>
                <td className="px-3 py-2"><StatusBadge status={f.managementStatus} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setViewingId(f.id)} title="Print preview"><Eye size={14} /></Button>
                  {f.managementStatus !== "approved" && (
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(f.id)} title="Edit"><Edit2 size={14} /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pickStaffOpen && (
        <PickStaffDialog
          onClose={() => setPickStaffOpen(false)}
          onPick={(s) => { setPickStaffOpen(false); setCreateForStaffId(s.id); }}
        />
      )}
      {createForStaffId !== null && (
        <FormEditorDialog
          mode="create"
          staffId={createForStaffId}
          onClose={() => setCreateForStaffId(null)}
        />
      )}
      {editingId !== null && (
        <FormEditorDialog
          mode="edit"
          formId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
      {viewingId !== null && (
        <PrintPreviewDialog id={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-rose-100 text-rose-700">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-700">Pending</Badge>;
}

// ── Pick staff dialog ────────────────────────────────────────────────────────
function PickStaffDialog({ onClose, onPick }: { onClose: () => void; onPick: (s: Staff) => void }) {
  const [search, setSearch] = useState("");
  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["staff-pick", { search }],
    queryFn: () => api.get<Staff[]>(`/api/staff?active=1${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Select Staff Member</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input className="pl-9" placeholder="Search name, code, role…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-80 overflow-auto border rounded-lg">
          {staff.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">No staff found</div>
          ) : (
            staff.map((s) => (
              <button key={s.id} onClick={() => onPick(s)}
                className="w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-muted/40 transition-colors">
                <div className="font-medium text-sm">{s.firstName} {s.lastName} <span className="font-mono text-xs text-muted-foreground">({s.staffId})</span></div>
                <div className="text-xs text-muted-foreground capitalize">{s.role.replace("-", " ")} {s.department ? `· ${s.department}` : ""}</div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Form editor dialog (create/edit) ─────────────────────────────────────────
type EditorProps =
  | { mode: "create"; staffId: number; onClose: () => void }
  | { mode: "edit"; formId: number; onClose: () => void };

const blankForm = (): Partial<HRForm> => ({
  employeeName: "", fatherSpouseName: "", dateOfBirth: "", gender: "", bloodGroup: "",
  qualification: "", aadhaarNumber: "", panNumber: "", address: "", mobile: "", alternateMobile: "", email: "",
  designation: "", department: "", joiningDate: "", rejoiningDate: new Date().toISOString().slice(0, 10),
  familyDetails: { children: [], familyMembers: [] },
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactPhone: "",
  bankAccountHolder: "", bankName: "", bankAccountNumber: "", bankIfsc: "", bankBranch: "",
  salaryStructure: { basic: 0, hra: 0, conveyance: 0, medical: 0, special: 0, other: 0, gross: 0, fixed: 0 },
  incentiveAcknowledged: false, deductionAcknowledged: false,
  shiftType: "general", reportingTime: "", dutyHours: "",
  confidentialityAcknowledged: false,
  noticePeriodDays: 30, noticePolicyAcknowledged: false,
  documentChecklist: {},
  employeeDeclarationDate: new Date().toISOString().slice(0, 10), remarks: "",
});

function prefillFromStaff(s: Staff): Partial<HRForm> {
  const isCritical = ["lab-technician", "radiologist", "doctor", "manager"].includes(s.role);
  return {
    ...blankForm(),
    employeeName: `${s.firstName} ${s.lastName}`.trim(),
    designation: s.role,
    department: s.department ?? "",
    joiningDate: s.joiningDate ?? "",
    mobile: s.phone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    emergencyContactPhone: s.emergencyContact ?? "",
    bankAccountNumber: s.bankAccount ?? "",
    bankIfsc: s.ifsc ?? "",
    bankAccountHolder: `${s.firstName} ${s.lastName}`.trim(),
    salaryStructure: { basic: s.baseSalary, hra: 0, conveyance: 0, medical: 0, special: 0, other: 0, gross: s.baseSalary, fixed: s.baseSalary },
    shiftType: isCritical ? "critical" : "general",
    noticePeriodDays: isCritical ? 90 : 30,
  };
}

function FormEditorDialog(props: EditorProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = props.mode === "edit";

  const { data: existingForm } = useQuery<HRForm>({
    queryKey: ["hr-form", isEdit ? props.formId : null],
    queryFn: () => api.get<HRForm>(`/api/hr-forms/${(props as { formId: number }).formId}`),
    enabled: isEdit,
  });
  const { data: staff } = useQuery<Staff>({
    queryKey: ["staff", !isEdit ? props.staffId : null],
    queryFn: () => api.get<Staff>(`/api/staff/${(props as { staffId: number }).staffId}`),
    enabled: !isEdit,
  });

  const [section, setSection] = useState(1);
  const [form, setForm] = useState<Partial<HRForm>>(blankForm());

  useEffect(() => {
    if (isEdit && existingForm) setForm(existingForm);
    if (!isEdit && staff) setForm(prefillFromStaff(staff));
  }, [isEdit, existingForm, staff]);

  const set = <K extends keyof HRForm>(k: K, v: Partial<HRForm>[K]) => setForm((f) => ({ ...f, [k]: v }));
  const sal = form.salaryStructure ?? {};
  const setSal = (k: keyof SalaryStructure, v: number | string) => {
    const next = { ...sal, [k]: typeof v === "string" ? v : Number(v) };
    if (k !== "gross" && k !== "fixed" && k !== "effectiveFrom") {
      next.gross = Number(next.basic ?? 0) + Number(next.hra ?? 0) + Number(next.conveyance ?? 0)
        + Number(next.medical ?? 0) + Number(next.special ?? 0) + Number(next.other ?? 0);
      if (next.fixed === undefined || next.fixed === 0) next.fixed = next.gross;
    }
    set("salaryStructure", next as SalaryStructure);
  };

  // Used so list views (global /hr-forms page AND per-staff panel inside the
  // Staff detail dialog) both refresh after mutations complete.
  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: ["hr-forms"] });
    const sid = isEdit ? form.staffId : (props as { staffId?: number }).staffId;
    if (sid) qc.invalidateQueries({ queryKey: ["hr-forms-staff", sid] });
  };

  const save = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return api.patch<HRForm>(`/api/hr-forms/${(props as { formId: number }).formId}`, form);
      }
      return api.post<HRForm>("/api/hr-forms", { ...form, staffId: (props as { staffId: number }).staffId });
    },
    onSuccess: () => {
      invalidateLists();
      toast({ title: isEdit ? "HR form updated" : "HR form created" });
      props.onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: () => api.post<HRForm>(`/api/hr-forms/${(props as { formId: number }).formId}/approve`, {}),
    onSuccess: () => {
      invalidateLists();
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast({ title: "Form approved", description: "Staff base salary updated." });
      props.onClose();
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const reject = useMutation({
    mutationFn: () => api.post<HRForm>(`/api/hr-forms/${(props as { formId: number }).formId}/reject`, {}),
    onSuccess: () => {
      invalidateLists();
      toast({ title: "Form rejected" });
      props.onClose();
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  const [photoUploading, setPhotoUploading] = useState(false);
  // Photo upload — two-step presigned URL flow against object storage:
  //   1) POST /api/storage/uploads/request-url → { uploadURL, objectPath }
  //   2) PUT the file bytes directly to uploadURL (GCS)
  // Only the objectPath ("/objects/<uuid>") is persisted on the form row;
  // the bytes never hit our API server.
  const onPhotoFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast({ title: "Photo too large", description: "Max 5 MB", variant: "destructive" });
      return;
    }
    setPhotoUploading(true);
    try {
      const { uploadURL, objectPath } = await api.post<{ uploadURL: string; objectPath: string }>(
        "/api/storage/uploads/request-url",
        { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      );
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      set("photoStorageKey", objectPath);
      set("photoDataUrl", null); // prefer the new storage-backed copy
      toast({ title: "Photo uploaded" });
    } catch (e) {
      toast({ title: "Photo upload failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setPhotoUploading(false);
    }
  };
  // Resolve the right <img src> regardless of whether the photo was uploaded
  // via the new object storage flow or stored inline (legacy rows).
  const photoSrc = form.photoStorageKey ? `/api/storage${form.photoStorageKey}` : form.photoDataUrl ?? null;

  const isApproved = form.managementStatus === "approved";
  const fam = form.familyDetails ?? {};
  const docs = form.documentChecklist ?? {};

  return (
    <Dialog open onOpenChange={props.onClose}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} />
            {isEdit ? `Edit ${form.formNumber ?? "HR Form"}` : "New HR Re-Joining Form"}
            {form.managementStatus && <StatusBadge status={form.managementStatus} />}
          </DialogTitle>
        </DialogHeader>

        {/* Section nav */}
        <div className="flex flex-wrap gap-1 border-b pb-2 text-xs">
          {[
            "1. Employee", "2. Family", "3. Emergency", "4. Bank", "5. Salary",
            "6. Incentive", "7. Deductions", "8. Duty/Shift", "9. Confidentiality",
            "10. Notice", "11. Documents", "12. Declaration",
          ].map((label, i) => (
            <button key={i} onClick={() => setSection(i + 1)}
              className={`px-2.5 py-1 rounded-md transition-colors ${section === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-muted"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {section === 1 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="row-span-3 flex flex-col items-center gap-2">
                <Label className="text-xs">Passport Photo</Label>
                {photoSrc
                  ? <img src={photoSrc} alt="" className="w-32 h-40 object-cover border rounded" />
                  : <div className="w-32 h-40 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">No photo</div>}
                <Input type="file" accept="image/*" disabled={isApproved || photoUploading} onChange={(e) => onPhotoFile(e.target.files?.[0] ?? null)} className="text-xs" />
                {photoUploading && <div className="text-xs text-muted-foreground">Uploading…</div>}
              </div>
              <Field label="Employee Name *"><Input value={form.employeeName ?? ""} onChange={(e) => set("employeeName", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Father / Spouse Name"><Input value={form.fatherSpouseName ?? ""} onChange={(e) => set("fatherSpouseName", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Date of Birth"><Input type="date" value={form.dateOfBirth ?? ""} onChange={(e) => set("dateOfBirth", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Gender">
                <Select value={form.gender ?? ""} onValueChange={(v) => set("gender", v)} disabled={isApproved}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Blood Group"><Input value={form.bloodGroup ?? ""} onChange={(e) => set("bloodGroup", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Qualification"><Input value={form.qualification ?? ""} onChange={(e) => set("qualification", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Aadhaar Number"><Input value={form.aadhaarNumber ?? ""} onChange={(e) => set("aadhaarNumber", e.target.value)} disabled={isApproved} /></Field>
              <Field label="PAN Number"><Input value={form.panNumber ?? ""} onChange={(e) => set("panNumber", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Mobile"><Input value={form.mobile ?? ""} onChange={(e) => set("mobile", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Alternate Mobile"><Input value={form.alternateMobile ?? ""} onChange={(e) => set("alternateMobile", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Email"><Input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Designation"><Input value={form.designation ?? ""} onChange={(e) => set("designation", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Department"><Input value={form.department ?? ""} onChange={(e) => set("department", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Joining Date"><Input type="date" value={form.joiningDate ?? ""} onChange={(e) => set("joiningDate", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Re-Joining Date"><Input type="date" value={form.rejoiningDate ?? ""} onChange={(e) => set("rejoiningDate", e.target.value)} disabled={isApproved} /></Field>
              <div className="col-span-3"><Field label="Address"><Textarea rows={2} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} disabled={isApproved} /></Field></div>
            </div>
          )}

          {section === 2 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Father's Name"><Input value={fam.fatherName ?? ""} onChange={(e) => set("familyDetails", { ...fam, fatherName: e.target.value })} disabled={isApproved} /></Field>
                <Field label="Mother's Name"><Input value={fam.motherName ?? ""} onChange={(e) => set("familyDetails", { ...fam, motherName: e.target.value })} disabled={isApproved} /></Field>
                <Field label="Spouse's Name"><Input value={fam.spouseName ?? ""} onChange={(e) => set("familyDetails", { ...fam, spouseName: e.target.value })} disabled={isApproved} /></Field>
                <Field label="Anniversary"><Input type="date" value={fam.anniversaryDate ?? ""} onChange={(e) => set("familyDetails", { ...fam, anniversaryDate: e.target.value })} disabled={isApproved} /></Field>
              </div>
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Children</Label>
                  <Button size="sm" variant="outline" disabled={isApproved} onClick={() => set("familyDetails", { ...fam, children: [...(fam.children ?? []), { name: "", age: "", school: "" }] })}>
                    <Plus size={12} className="mr-1" />Add Child
                  </Button>
                </div>
                {(fam.children ?? []).map((c, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input className="col-span-5" placeholder="Name" value={c.name} onChange={(e) => {
                      const list = [...(fam.children ?? [])]; list[idx] = { ...c, name: e.target.value };
                      set("familyDetails", { ...fam, children: list });
                    }} disabled={isApproved} />
                    <Input className="col-span-2" placeholder="Age" value={c.age ?? ""} onChange={(e) => {
                      const list = [...(fam.children ?? [])]; list[idx] = { ...c, age: e.target.value };
                      set("familyDetails", { ...fam, children: list });
                    }} disabled={isApproved} />
                    <Input className="col-span-4" placeholder="School / class" value={c.school ?? ""} onChange={(e) => {
                      const list = [...(fam.children ?? [])]; list[idx] = { ...c, school: e.target.value };
                      set("familyDetails", { ...fam, children: list });
                    }} disabled={isApproved} />
                    <Button size="sm" variant="ghost" disabled={isApproved} onClick={() => {
                      const list = [...(fam.children ?? [])]; list.splice(idx, 1);
                      set("familyDetails", { ...fam, children: list });
                    }}><Trash2 size={13} /></Button>
                  </div>
                ))}
              </div>
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Other Family Members</Label>
                  <Button size="sm" variant="outline" disabled={isApproved} onClick={() => set("familyDetails", { ...fam, familyMembers: [...(fam.familyMembers ?? []), { name: "", relation: "", age: "" }] })}>
                    <Plus size={12} className="mr-1" />Add
                  </Button>
                </div>
                {(fam.familyMembers ?? []).map((m, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input className="col-span-5" placeholder="Name" value={m.name} onChange={(e) => {
                      const list = [...(fam.familyMembers ?? [])]; list[idx] = { ...m, name: e.target.value };
                      set("familyDetails", { ...fam, familyMembers: list });
                    }} disabled={isApproved} />
                    <Input className="col-span-4" placeholder="Relation" value={m.relation} onChange={(e) => {
                      const list = [...(fam.familyMembers ?? [])]; list[idx] = { ...m, relation: e.target.value };
                      set("familyDetails", { ...fam, familyMembers: list });
                    }} disabled={isApproved} />
                    <Input className="col-span-2" placeholder="Age" value={m.age ?? ""} onChange={(e) => {
                      const list = [...(fam.familyMembers ?? [])]; list[idx] = { ...m, age: e.target.value };
                      set("familyDetails", { ...fam, familyMembers: list });
                    }} disabled={isApproved} />
                    <Button size="sm" variant="ghost" disabled={isApproved} onClick={() => {
                      const list = [...(fam.familyMembers ?? [])]; list.splice(idx, 1);
                      set("familyDetails", { ...fam, familyMembers: list });
                    }}><Trash2 size={13} /></Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 3 && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Emergency Contact Name"><Input value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Relation"><Input value={form.emergencyContactRelation ?? ""} onChange={(e) => set("emergencyContactRelation", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Phone"><Input value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} disabled={isApproved} /></Field>
            </div>
          )}

          {section === 4 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account Holder Name"><Input value={form.bankAccountHolder ?? ""} onChange={(e) => set("bankAccountHolder", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Bank Name"><Input value={form.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Account Number"><Input value={form.bankAccountNumber ?? ""} onChange={(e) => set("bankAccountNumber", e.target.value)} disabled={isApproved} /></Field>
              <Field label="IFSC"><Input value={form.bankIfsc ?? ""} onChange={(e) => set("bankIfsc", e.target.value)} disabled={isApproved} /></Field>
              <Field label="Branch"><Input value={form.bankBranch ?? ""} onChange={(e) => set("bankBranch", e.target.value)} disabled={isApproved} /></Field>
            </div>
          )}

          {section === 5 && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">Enter component-wise breakdown. Gross is auto-summed; you can override the final Fixed Salary that will be written to staff record on approval.</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Basic"><Input type="number" value={sal.basic ?? 0} onChange={(e) => setSal("basic", e.target.value)} disabled={isApproved} /></Field>
                <Field label="HRA"><Input type="number" value={sal.hra ?? 0} onChange={(e) => setSal("hra", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Conveyance"><Input type="number" value={sal.conveyance ?? 0} onChange={(e) => setSal("conveyance", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Medical"><Input type="number" value={sal.medical ?? 0} onChange={(e) => setSal("medical", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Special"><Input type="number" value={sal.special ?? 0} onChange={(e) => setSal("special", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Other"><Input type="number" value={sal.other ?? 0} onChange={(e) => setSal("other", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Gross (auto)"><Input type="number" value={sal.gross ?? 0} disabled /></Field>
                <Field label="Fixed Monthly Salary *"><Input type="number" value={sal.fixed ?? 0} onChange={(e) => setSal("fixed", e.target.value)} disabled={isApproved} /></Field>
                <Field label="Effective From"><Input type="date" value={sal.effectiveFrom ?? ""} onChange={(e) => setSal("effectiveFrom", e.target.value)} disabled={isApproved} /></Field>
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Net Fixed:</span> {inr(Number(sal.fixed ?? 0))} per month — applied to Staff record on approval.
              </div>
            </div>
          )}

          {section === 6 && (
            <div className="space-y-3">
              <div className="text-sm whitespace-pre-line p-3 rounded-lg bg-muted/40 border">{INCENTIVE_TEXT}</div>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead className="bg-muted/40 text-xs"><tr><th className="text-left px-3 py-2">Period</th><th className="text-right px-3 py-2">% of Eligible Revenue</th></tr></thead>
                <tbody>{INCENTIVE_SLABS.map((s, i) => (<tr key={i} className="border-t"><td className="px-3 py-2">{s.label}</td><td className="px-3 py-2 text-right tabular-nums">{s.pct}%</td></tr>))}</tbody>
              </table>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.incentiveAcknowledged} disabled={isApproved}
                  onCheckedChange={(v) => set("incentiveAcknowledged", !!v)} />
                I (the employee) have read and accepted the performance incentive structure above.
              </label>
            </div>
          )}

          {section === 7 && (
            <div className="space-y-3">
              <div className="text-sm whitespace-pre-line p-3 rounded-lg bg-muted/40 border">{DEDUCTION_TEXT}</div>
              <table className="w-full text-sm border rounded-lg overflow-hidden">
                <thead className="bg-muted/40 text-xs"><tr><th className="text-left px-3 py-2">Condition</th><th className="text-left px-3 py-2">Deduction</th></tr></thead>
                <tbody>{DEDUCTION_SLABS.map((s, i) => (<tr key={i} className="border-t"><td className="px-3 py-2">{s.label}</td><td className="px-3 py-2">{s.pct}</td></tr>))}</tbody>
              </table>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.deductionAcknowledged} disabled={isApproved}
                  onCheckedChange={(v) => set("deductionAcknowledged", !!v)} />
                I have read and accepted the deduction conditions above.
              </label>
            </div>
          )}

          {section === 8 && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Shift Type">
                <Select value={form.shiftType ?? "general"} onValueChange={(v) => {
                  set("shiftType", v);
                  set("noticePeriodDays", v === "critical" ? 90 : 30);
                }} disabled={isApproved}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="critical">Technical / Critical</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reporting Time"><Input value={form.reportingTime ?? ""} onChange={(e) => set("reportingTime", e.target.value)} disabled={isApproved} placeholder="e.g. 09:00" /></Field>
              <Field label="Duty Hours"><Input value={form.dutyHours ?? ""} onChange={(e) => set("dutyHours", e.target.value)} disabled={isApproved} placeholder="e.g. 9 hrs / day" /></Field>
            </div>
          )}

          {section === 9 && (
            <div className="space-y-3">
              <div className="text-sm whitespace-pre-line p-3 rounded-lg bg-muted/40 border">{CONFIDENTIALITY_TEXT}</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.confidentialityAcknowledged} disabled={isApproved}
                  onCheckedChange={(v) => set("confidentialityAcknowledged", !!v)} />
                I accept the confidentiality declaration above.
              </label>
            </div>
          )}

          {section === 10 && (
            <div className="space-y-3">
              <div className="text-sm whitespace-pre-line p-3 rounded-lg bg-muted/40 border">
                {form.shiftType === "critical" ? NOTICE_TEXT_CRITICAL : NOTICE_TEXT_GENERAL}
              </div>
              <Field label="Notice Period (Days)">
                <Select value={String(form.noticePeriodDays ?? 30)} onValueChange={(v) => set("noticePeriodDays", Number(v))} disabled={isApproved}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.noticePolicyAcknowledged} disabled={isApproved}
                  onCheckedChange={(v) => set("noticePolicyAcknowledged", !!v)} />
                I accept the leave / resignation notice policy above.
              </label>
            </div>
          )}

          {section === 11 && (
            <div className="grid grid-cols-2 gap-2">
              {DOC_LABELS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
                  <Checkbox checked={!!docs[key]} disabled={isApproved}
                    onCheckedChange={(v) => set("documentChecklist", { ...docs, [key]: !!v })} />
                  {label}
                </label>
              ))}
            </div>
          )}

          {section === 12 && (
            <div className="space-y-3">
              <div className="text-sm whitespace-pre-line p-3 rounded-lg bg-muted/40 border">{DECLARATION_TEXT}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Declaration Date"><Input type="date" value={form.employeeDeclarationDate ?? ""} onChange={(e) => set("employeeDeclarationDate", e.target.value)} disabled={isApproved} /></Field>
                <div className="col-span-2"><Field label="Remarks"><Textarea rows={2} value={form.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} disabled={isApproved} /></Field></div>
              </div>
              {isEdit && form.managementStatus === "approved" && (
                <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm">
                  Approved by <span className="font-semibold">{form.approvedByName ?? `User #${form.approvedByUserId}`}</span>
                  {form.approvedAt && <> on {new Date(form.approvedAt).toLocaleString("en-IN")}</>}.
                </div>
              )}
              {isEdit && form.managementStatus === "rejected" && (
                <div className="rounded-lg border-l-4 border-rose-500 bg-rose-50 p-3 text-sm">
                  Rejected by <span className="font-semibold">{form.approvedByName ?? `User #${form.approvedByUserId}`}</span>
                  {form.approvedAt && <> on {new Date(form.approvedAt).toLocaleString("en-IN")}</>}.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={props.onClose}>Close</Button>
          <div className="flex-1" />
          {isEdit && form.managementStatus === "pending" && (
            <>
              <Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending}>
                <XCircle size={14} className="mr-1.5" />Reject
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmApproveOpen(true)} disabled={approve.isPending}>
                <CheckCircle2 size={14} className="mr-1.5" />Approve & Update Salary
              </Button>
            </>
          )}
          <Dialog open={confirmApproveOpen} onOpenChange={setConfirmApproveOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Approve and update salary?</DialogTitle>
              </DialogHeader>
              <div className="text-sm space-y-2">
                <p>
                  This will mark form <span className="font-mono">{form.formNumber}</span> as <b>approved</b> and
                  immediately overwrite <b>{form.employeeName}</b>'s base salary to <b>{inr(Number(form.fixedSalary || 0))}</b>.
                </p>
                <p className="text-muted-foreground">Approved forms cannot be edited or deleted afterwards.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmApproveOpen(false)}>Cancel</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={approve.isPending}
                  onClick={() => { setConfirmApproveOpen(false); approve.mutate(); }}
                >
                  <CheckCircle2 size={14} className="mr-1.5" />Confirm Approval
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {!isApproved && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Form"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}

// ── Print preview dialog ─────────────────────────────────────────────────────
function PrintPreviewDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: form } = useQuery<HRForm>({
    queryKey: ["hr-form", id],
    queryFn: () => api.get<HRForm>(`/api/hr-forms/${id}`),
  });
  const { data: clinic } = useQuery<{ name?: string; tagline?: string; address?: string; phone?: string }>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 60_000,
  });
  const printAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  if (!form) return null;
  const sal = form.salaryStructure ?? {};
  const fam = form.familyDetails ?? {};
  const docs = form.documentChecklist ?? {};

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><FileText size={18} />HR Form {form.formNumber} — Print Preview</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => window.print()}><Printer size={14} className="mr-1.5" />Print</Button>
              <Button
                size="sm"
                disabled={downloading}
                onClick={async () => {
                  if (!printAreaRef.current) return;
                  setDownloading(true);
                  try {
                    await downloadFormPdf(printAreaRef.current, `${form.formNumber}-${form.employeeName.replace(/\s+/g, "_")}.pdf`);
                    toast({ title: "PDF downloaded" });
                  } catch (e) {
                    toast({ title: "PDF generation failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
                  } finally {
                    setDownloading(false);
                  }
                }}
              >
                <Download size={14} className="mr-1.5" />{downloading ? "Generating…" : "Download PDF"}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto bg-muted/30 p-4">
          <div id="hr-print-area" ref={printAreaRef} className="bg-white text-black mx-auto shadow-md" style={{ width: "210mm", minHeight: "297mm", padding: "12mm" }}>
            {/* Header */}
            <div className="flex items-start gap-4 border-b-2 border-black pb-3">
              <div className="flex-1">
                <div className="text-xl font-bold">{clinic?.name ?? "CARE DIAGNOSTICS / HOPE NEUROTRAUMA"}</div>
                <div className="text-xs">{clinic?.tagline ?? ""}</div>
                <div className="text-xs">{clinic?.address ?? ""}{clinic?.phone ? ` · Tel: ${clinic.phone}` : ""}</div>
                <div className="mt-2 text-base font-bold uppercase">Employee Re-Joining / Update Form</div>
              </div>
              {(form.photoStorageKey || form.photoDataUrl) && (
                <img
                  src={form.photoStorageKey ? `/api/storage${form.photoStorageKey}` : form.photoDataUrl!}
                  alt=""
                  className="w-24 h-32 object-cover border border-black"
                  crossOrigin="anonymous"
                />
              )}
            </div>
            <div className="flex justify-between text-xs mt-2">
              <div>Form #: <span className="font-mono font-semibold">{form.formNumber}</span></div>
              <div>Status: <span className="uppercase font-semibold">{form.managementStatus}</span></div>
            </div>

            {/* 1. Employee */}
            <SectionTitle n={1} title="Employee Details" />
            <Grid2>
              <KV k="Name" v={form.employeeName} />
              <KV k="Father / Spouse" v={form.fatherSpouseName} />
              <KV k="DOB" v={form.dateOfBirth} />
              <KV k="Gender" v={form.gender} />
              <KV k="Blood Group" v={form.bloodGroup} />
              <KV k="Qualification" v={form.qualification} />
              <KV k="Aadhaar" v={form.aadhaarNumber} />
              <KV k="PAN" v={form.panNumber} />
              <KV k="Mobile" v={form.mobile} />
              <KV k="Alternate Mobile" v={form.alternateMobile} />
              <KV k="Email" v={form.email} />
              <KV k="Designation" v={form.designation} />
              <KV k="Department" v={form.department} />
              <KV k="Joining Date" v={form.joiningDate} />
              <KV k="Re-Joining Date" v={form.rejoiningDate} />
            </Grid2>
            <KV k="Address" v={form.address} block />

            {/* 2. Family */}
            <SectionTitle n={2} title="Family Details" />
            <Grid2>
              <KV k="Father" v={fam.fatherName} />
              <KV k="Mother" v={fam.motherName} />
              <KV k="Spouse" v={fam.spouseName} />
              <KV k="Anniversary" v={fam.anniversaryDate} />
            </Grid2>
            {(fam.children ?? []).length > 0 && (
              <PrintTable
                head={["Child Name", "Age", "School / Class"]}
                rows={(fam.children ?? []).map((c) => [c.name, c.age ?? "", c.school ?? ""])}
              />
            )}
            {(fam.familyMembers ?? []).length > 0 && (
              <PrintTable
                head={["Member Name", "Relation", "Age"]}
                rows={(fam.familyMembers ?? []).map((m) => [m.name, m.relation, m.age ?? ""])}
              />
            )}

            {/* 3. Emergency */}
            <SectionTitle n={3} title="Emergency Contact" />
            <Grid2>
              <KV k="Name" v={form.emergencyContactName} />
              <KV k="Relation" v={form.emergencyContactRelation} />
              <KV k="Phone" v={form.emergencyContactPhone} />
            </Grid2>

            {/* 4. Bank */}
            <SectionTitle n={4} title="Bank Details" />
            <Grid2>
              <KV k="Account Holder" v={form.bankAccountHolder} />
              <KV k="Bank" v={form.bankName} />
              <KV k="A/C No." v={form.bankAccountNumber} />
              <KV k="IFSC" v={form.bankIfsc} />
              <KV k="Branch" v={form.bankBranch} />
            </Grid2>

            {/* 5. Salary */}
            <SectionTitle n={5} title="Revised Salary Structure" />
            <PrintTable
              head={["Component", "Amount (₹)"]}
              rows={[
                ["Basic", String(sal.basic ?? 0)],
                ["HRA", String(sal.hra ?? 0)],
                ["Conveyance", String(sal.conveyance ?? 0)],
                ["Medical", String(sal.medical ?? 0)],
                ["Special", String(sal.special ?? 0)],
                ["Other", String(sal.other ?? 0)],
                ["Gross", String(sal.gross ?? 0)],
                ["Fixed Monthly Salary", String(sal.fixed ?? form.fixedSalary)],
              ]}
            />
            {sal.effectiveFrom && <div className="text-xs mt-1">Effective from: <strong>{sal.effectiveFrom}</strong></div>}

            {/* 6. Incentive */}
            <SectionTitle n={6} title="Performance Incentive" />
            <p className="text-xs whitespace-pre-line">{INCENTIVE_TEXT}</p>
            <PrintTable
              head={["Period", "%"]}
              rows={INCENTIVE_SLABS.map((s) => [s.label, `${s.pct}%`])}
            />
            <Ack ok={form.incentiveAcknowledged} text="Employee accepted incentive structure" />

            {/* 7. Deductions */}
            <SectionTitle n={7} title="Deduction Conditions" />
            <p className="text-xs whitespace-pre-line">{DEDUCTION_TEXT}</p>
            <PrintTable head={["Condition", "Deduction"]} rows={DEDUCTION_SLABS.map((s) => [s.label, s.pct])} />
            <Ack ok={form.deductionAcknowledged} text="Employee accepted deduction conditions" />

            {/* 8. Duty / Shift */}
            <SectionTitle n={8} title="Duty / Shift Policy" />
            <Grid2>
              <KV k="Shift Type" v={form.shiftType} />
              <KV k="Reporting Time" v={form.reportingTime} />
              <KV k="Duty Hours" v={form.dutyHours} />
            </Grid2>

            {/* 9. Confidentiality */}
            <SectionTitle n={9} title="Confidentiality Declaration" />
            <p className="text-xs whitespace-pre-line">{CONFIDENTIALITY_TEXT}</p>
            <Ack ok={form.confidentialityAcknowledged} text="Employee accepted confidentiality declaration" />

            {/* 10. Notice */}
            <SectionTitle n={10} title="Leave / Resignation Policy" />
            <p className="text-xs whitespace-pre-line">{form.shiftType === "critical" ? NOTICE_TEXT_CRITICAL : NOTICE_TEXT_GENERAL}</p>
            <KV k="Notice Period" v={`${form.noticePeriodDays} days`} />
            <Ack ok={form.noticePolicyAcknowledged} text="Employee accepted notice policy" />

            {/* 11. Documents */}
            <SectionTitle n={11} title="Document Checklist" />
            <div className="grid grid-cols-2 gap-y-1 text-xs">
              {DOC_LABELS.map(({ key, label }) => (
                <div key={key}>{docs[key] ? "☑" : "☐"} {label}</div>
              ))}
            </div>

            {/* 12. Declaration */}
            <SectionTitle n={12} title="Declaration & Approval" />
            <p className="text-xs whitespace-pre-line">{DECLARATION_TEXT}</p>
            <div className="grid grid-cols-2 gap-8 mt-10">
              <div className="border-t border-black pt-1 text-xs text-center">
                Employee Signature & Date
                {form.employeeDeclarationDate && <div>{form.employeeDeclarationDate}</div>}
              </div>
              <div className="border-t border-black pt-1 text-xs text-center">
                Management Approval
                {form.managementStatus === "approved"
                  ? <div>Approved by {form.approvedByName ?? ""}{form.approvedAt ? ` · ${new Date(form.approvedAt).toLocaleDateString("en-IN")}` : ""}</div>
                  : <div className="uppercase">{form.managementStatus}</div>}
              </div>
            </div>
            {form.remarks && <div className="mt-3 text-xs"><strong>Remarks:</strong> {form.remarks}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mt-4 mb-1 bg-gray-200 px-2 py-1 text-sm font-bold border border-gray-400 break-after-avoid">
      Section {n}. {title}
    </div>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">{children}</div>;
}
function KV({ k, v, block }: { k: string; v?: string | number | null; block?: boolean }) {
  return (
    <div className={`flex ${block ? "flex-col" : "items-baseline gap-2"} border-b border-dotted border-gray-400 py-0.5`}>
      <span className="text-gray-600 min-w-[110px]">{k}:</span>
      <span className="font-medium">{v ? String(v) : "—"}</span>
    </div>
  );
}
function PrintTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full text-xs border border-black mt-1">
      <thead className="bg-gray-200"><tr>{head.map((h, i) => <th key={i} className="border border-black px-2 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-black px-2 py-1">{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
function Ack({ ok, text }: { ok: boolean; text: string }) {
  return <div className="text-xs mt-1">{ok ? "☑" : "☐"} {text}</div>;
}
