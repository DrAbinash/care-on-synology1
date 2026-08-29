import { useState, useEffect, useMemo } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Plus, Search, Edit2, Trash2, Fingerprint, Wallet,
  HandCoins, CalendarCheck, IndianRupee, X, LogIn, LogOut, ShieldAlert, FilePen,
} from "lucide-react";
import { StaffHRFormsPanel } from "@/pages/HRForms";

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const ROLES = ["receptionist", "lab-technician", "radiologist", "phlebotomist", "doctor", "nurse", "manager", "accountant", "cleaner", "security", "other"];
const PAYMENT_MODES = ["cash", "bank-transfer", "cheque", "upi", "card"];

type Staff = {
  id: number; staffId: string; firstName: string; lastName: string;
  phone: string | null; email: string | null; role: string; department: string | null;
  joiningDate: string | null; baseSalary: number; address: string | null;
  emergencyContact: string | null; bankAccount: string | null; ifsc: string | null;
  notes: string | null; isActive: boolean;
};

type Advance = { id: number; staffId: number; amount: number; advanceDate: string; paymentMode: string; reason: string | null; recoveredAmount: number; status: string };
type SalaryPayment = { id: number; monthYear: string; baseAmount: number; bonus: number; deductions: number; advanceDeducted: number; netAmount: number; paymentDate: string; paymentMode: string; daysPresent: number; daysAbsent: number };
type Attendance = { id: number; staffId: number; attendanceDate: string; punchIn: string | null; punchOut: string | null; source: string };
type BioCred = { id: number; credentialId: string; deviceName: string | null; enrolledAt: string; lastUsedAt: string | null };

// ── helpers for WebAuthn (base64url <-> ArrayBuffer) ──
const b64uToBuf = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
};
const bufToB64u = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export default function StaffPage() {
  const [tab, setTab] = useState("employees");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Management"
        subtitle="Employees, salary, advances and fingerprint attendance"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="employees"><Users size={14} className="mr-1.5" /> Employees</TabsTrigger>
          <TabsTrigger value="attendance"><CalendarCheck size={14} className="mr-1.5" /> Attendance</TabsTrigger>
          <TabsTrigger value="kiosk"><Fingerprint size={14} className="mr-1.5" /> Fingerprint Kiosk</TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="mt-4"><EmployeesTab /></TabsContent>
        <TabsContent value="attendance" className="mt-4"><AttendanceTab /></TabsContent>
        <TabsContent value="kiosk" className="mt-4"><KioskTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Employees Tab ──────────────────────────────────
function EmployeesTab() {
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("1");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: staff = [], isLoading } = useQuery<Staff[]>({
    queryKey: ["staff", { search, active }],
    queryFn: () => api.get<Staff[]>(`/api/staff?${active === "all" ? "" : `active=${active}`}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <Input className="pl-9" placeholder="Search name, code, phone, role…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Active</SelectItem>
            <SelectItem value="0">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setCreateOpen(true)}><Plus size={14} className="mr-1.5" />Add Staff</Button>
      </div>

      <div className="rounded-lg border bg-card min-w-0 max-w-full overflow-x-auto overscroll-x-contain touch-pan-x">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2.5">Code</th>
              <th className="text-left px-3 py-2.5">Name</th>
              <th className="text-left px-3 py-2.5">Role</th>
              <th className="text-left px-3 py-2.5">Phone</th>
              <th className="text-right px-3 py-2.5">Base Salary</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 w-[1%]"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (<tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</td></tr>)}
            {!isLoading && staff.length === 0 && (<tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No staff found</td></tr>)}
            {staff.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDetailId(s.id)}>
                <td className="px-3 py-2 font-mono text-xs">{s.staffId}</td>
                <td className="px-3 py-2 font-medium">{s.firstName} {s.lastName}</td>
                <td className="px-3 py-2 capitalize">{s.role.replace("-", " ")}</td>
                <td className="px-3 py-2">{s.phone ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(s.baseSalary)}</td>
                <td className="px-3 py-2">
                  {s.isActive ? <Badge className="bg-emerald-100 text-emerald-700">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(s); }}><Edit2 size={14} /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(createOpen || editing) && (
        <StaffFormDialog
          staff={editing}
          onClose={() => { setCreateOpen(false); setEditing(null); }}
        />
      )}
      {detailId !== null && (
        <StaffDetailDialog id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ─── Staff Create / Edit ────────────────────────────
function StaffFormDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    firstName: staff?.firstName ?? "",
    lastName: staff?.lastName ?? "",
    phone: staff?.phone ?? "",
    email: staff?.email ?? "",
    role: staff?.role ?? "receptionist",
    department: staff?.department ?? "",
    joiningDate: staff?.joiningDate ?? new Date().toISOString().slice(0, 10),
    baseSalary: String(staff?.baseSalary ?? 0),
    address: staff?.address ?? "",
    emergencyContact: staff?.emergencyContact ?? "",
    bankAccount: staff?.bankAccount ?? "",
    ifsc: staff?.ifsc ?? "",
    notes: staff?.notes ?? "",
    isActive: staff?.isActive ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, baseSalary: Number(form.baseSalary) };
      return staff ? api.patch<Staff>(`/api/staff/${staff.id}`, body) : api.post<Staff>("/api/staff", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast({ title: staff ? "Staff updated" : "Staff added" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{staff ? `Edit ${staff.firstName} ${staff.lastName}` : "Add Staff Member"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First Name *"><Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Last Name *"><Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Role *">
            <Select value={form.role} onValueChange={(v) => set("role", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r.replace("-", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Department"><Input value={form.department} onChange={(e) => set("department", e.target.value)} /></Field>
          <Field label="Joining Date"><Input type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} /></Field>
          <Field label="Base Salary (₹/month)"><Input type="number" value={form.baseSalary} onChange={(e) => set("baseSalary", e.target.value)} /></Field>
          <Field label="Emergency Contact"><Input value={form.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} /></Field>
          <Field label="Bank Account"><Input value={form.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
          <Field label="IFSC"><Input value={form.ifsc} onChange={(e) => set("ifsc", e.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.isActive ? "1" : "0"} onValueChange={(v) => set("isActive", v === "1")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Active</SelectItem>
                <SelectItem value="0">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="col-span-2"><Field label="Address"><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field></div>
          <div className="col-span-2"><Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs">{label}</Label>{children}</div>;
}

// ─── Staff Detail with tabs (Profile, Advances, Salary, Biometric) ─
function StaffDetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: staff } = useQuery<Staff>({ queryKey: ["staff", id], queryFn: () => api.get<Staff>(`/api/staff/${id}`) });
  const [tab, setTab] = useState("profile");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {staff ? `${staff.firstName} ${staff.lastName}` : "Loading…"}
            {staff && <span className="text-xs font-mono text-muted-foreground">({staff.staffId})</span>}
          </DialogTitle>
        </DialogHeader>
        {staff && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="advances"><HandCoins size={14} className="mr-1.5" />Advances</TabsTrigger>
              <TabsTrigger value="salary"><Wallet size={14} className="mr-1.5" />Salary</TabsTrigger>
              <TabsTrigger value="biometric"><Fingerprint size={14} className="mr-1.5" />Fingerprint</TabsTrigger>
              <TabsTrigger value="hr-forms"><FilePen size={14} className="mr-1.5" />HR Forms</TabsTrigger>
            </TabsList>
            <TabsContent value="profile" className="mt-3"><ProfilePanel staff={staff} /></TabsContent>
            <TabsContent value="advances" className="mt-3"><AdvancesPanel staffId={id} /></TabsContent>
            <TabsContent value="salary" className="mt-3"><SalaryPanel staff={staff} /></TabsContent>
            <TabsContent value="biometric" className="mt-3"><BiometricPanel staff={staff} /></TabsContent>
            <TabsContent value="hr-forms" className="mt-3"><StaffHRFormsPanel staffId={id} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfilePanel({ staff }: { staff: Staff }) {
  const rows: [string, string | null | number][] = [
    ["Code", staff.staffId], ["Role", staff.role], ["Department", staff.department],
    ["Phone", staff.phone], ["Email", staff.email], ["Joined", staff.joiningDate],
    ["Base Salary", inr(staff.baseSalary)], ["Emergency Contact", staff.emergencyContact],
    ["Bank Account", staff.bankAccount], ["IFSC", staff.ifsc], ["Address", staff.address], ["Notes", staff.notes],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b py-1.5">
          <span className="text-muted-foreground">{k}</span>
          <span className="font-medium text-right">{v || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function AdvancesPanel({ staffId }: { staffId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: advances = [] } = useQuery<Advance[]>({ queryKey: ["staff-advances", staffId], queryFn: () => api.get<Advance[]>(`/api/staff/${staffId}/advances`) });
  const { data: outstanding } = useQuery<{ outstanding: number }>({ queryKey: ["staff-advance-outstanding", staffId], queryFn: () => api.get<{ outstanding: number }>(`/api/staff/${staffId}/advances/outstanding`) });

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");

  const add = useMutation({
    mutationFn: () => api.post(`/api/staff/${staffId}/advances`, { amount: Number(amount), reason, paymentMode, advanceDate: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-advances", staffId] });
      qc.invalidateQueries({ queryKey: ["staff-advance-outstanding", staffId] });
      setAmount(""); setReason("");
      toast({ title: "Advance recorded" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (advId: number) => api.delete(`/api/staff/advances/${advId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-advances", staffId] });
      qc.invalidateQueries({ queryKey: ["staff-advance-outstanding", staffId] });
      toast({ title: "Advance removed" });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 rounded-lg bg-amber-50 border border-amber-200">
        <div className="text-sm text-amber-900">Outstanding Advance</div>
        <div className="text-xl font-bold text-amber-700">{inr(outstanding?.outstanding ?? 0)}</div>
      </div>

      <div className="grid grid-cols-4 gap-2 items-end p-3 border rounded-lg">
        <Field label="Amount"><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Mode">
          <Select value={paymentMode} onValueChange={setPaymentMode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="col-span-2"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        <div className="col-span-4">
          <Button size="sm" disabled={!amount || add.isPending} onClick={() => add.mutate()}><Plus size={14} className="mr-1" />Record Advance</Button>
        </div>
      </div>

      <div className="rounded-lg border max-h-64 min-w-0 overflow-auto overscroll-contain touch-pan-x">
        <table className="w-full text-sm min-w-[32rem]">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
            <th className="px-2 py-2 text-left">Date</th><th className="text-right px-2">Amount</th><th className="text-right px-2">Recovered</th><th className="px-2">Status</th><th className="px-2 text-left">Reason</th><th></th>
          </tr></thead>
          <tbody>
            {advances.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No advances</td></tr>}
            {advances.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-2 py-1.5">{a.advanceDate}</td>
                <td className="px-2 text-right tabular-nums">{inr(a.amount)}</td>
                <td className="px-2 text-right tabular-nums">{inr(a.recoveredAmount)}</td>
                <td className="px-2 text-center"><Badge variant={a.status === "cleared" ? "secondary" : "default"}>{a.status}</Badge></td>
                <td className="px-2">{a.reason ?? "—"}</td>
                <td className="px-2"><Button size="sm" variant="ghost" onClick={() => del.mutate(a.id)}><Trash2 size={13} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalaryPanel({ staff }: { staff: Staff }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: payments = [] } = useQuery<SalaryPayment[]>({ queryKey: ["staff-salary", staff.id], queryFn: () => api.get<SalaryPayment[]>(`/api/staff/${staff.id}/salary`) });
  const { data: outstanding } = useQuery<{ outstanding: number }>({ queryKey: ["staff-advance-outstanding", staff.id], queryFn: () => api.get<{ outstanding: number }>(`/api/staff/${staff.id}/advances/outstanding`) });
  const { data: attSummary } = useQuery<{ daysPresent: number }>({ queryKey: ["staff-att-summary", staff.id], queryFn: () => api.get(`/api/staff/${staff.id}/attendance/summary`) });

  const [form, setForm] = useState({
    monthYear: new Date().toISOString().slice(0, 7),
    baseAmount: String(staff.baseSalary),
    bonus: "0",
    deductions: "0",
    advanceDeducted: "0",
    daysPresent: String(attSummary?.daysPresent ?? 0),
    daysAbsent: "0",
    paymentMode: "bank-transfer",
    reference: "",
  });
  useEffect(() => { setForm((f) => ({ ...f, daysPresent: String(attSummary?.daysPresent ?? 0) })); }, [attSummary?.daysPresent]);
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const net = useMemo(() =>
    Number(form.baseAmount || 0) + Number(form.bonus || 0) - Number(form.deductions || 0) - Number(form.advanceDeducted || 0)
  , [form]);

  const pay = useMutation({
    mutationFn: () => api.post(`/api/staff/${staff.id}/salary`, {
      monthYear: form.monthYear,
      baseAmount: Number(form.baseAmount),
      bonus: Number(form.bonus),
      deductions: Number(form.deductions),
      advanceDeducted: Number(form.advanceDeducted),
      daysPresent: Number(form.daysPresent),
      daysAbsent: Number(form.daysAbsent),
      paymentMode: form.paymentMode,
      reference: form.reference,
      paymentDate: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-salary", staff.id] });
      qc.invalidateQueries({ queryKey: ["staff-advance-outstanding", staff.id] });
      toast({ title: "Salary paid", description: `Net ${inr(net)} recorded` });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 p-3 border rounded-lg">
        <div className="text-sm text-muted-foreground">Base Salary <span className="font-semibold text-foreground">{inr(staff.baseSalary)}</span></div>
        <div className="text-sm text-muted-foreground">Outstanding Advance <span className="font-semibold text-amber-700">{inr(outstanding?.outstanding ?? 0)}</span></div>
      </div>
      <div className="grid grid-cols-4 gap-2 items-end p-3 border rounded-lg">
        <Field label="Month"><Input type="month" value={form.monthYear} onChange={(e) => set("monthYear", e.target.value)} /></Field>
        <Field label="Base"><Input type="number" value={form.baseAmount} onChange={(e) => set("baseAmount", e.target.value)} /></Field>
        <Field label="Bonus"><Input type="number" value={form.bonus} onChange={(e) => set("bonus", e.target.value)} /></Field>
        <Field label="Deductions"><Input type="number" value={form.deductions} onChange={(e) => set("deductions", e.target.value)} /></Field>
        <Field label="Advance Deducted"><Input type="number" value={form.advanceDeducted} onChange={(e) => set("advanceDeducted", e.target.value)} /></Field>
        <Field label="Days Present"><Input type="number" value={form.daysPresent} onChange={(e) => set("daysPresent", e.target.value)} /></Field>
        <Field label="Days Absent"><Input type="number" value={form.daysAbsent} onChange={(e) => set("daysAbsent", e.target.value)} /></Field>
        <Field label="Mode">
          <Select value={form.paymentMode} onValueChange={(v) => set("paymentMode", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="col-span-2"><Field label="Reference / Txn ID"><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></Field></div>
        <div className="col-span-2 text-right">
          <div className="text-xs text-muted-foreground">Net Payable</div>
          <div className="text-xl font-bold text-emerald-700 flex items-center justify-end"><IndianRupee size={16} />{net.toLocaleString("en-IN")}</div>
        </div>
        <div className="col-span-4">
          <Button onClick={() => pay.mutate()} disabled={pay.isPending}><Wallet size={14} className="mr-1.5" />{pay.isPending ? "Saving…" : "Pay Salary"}</Button>
        </div>
      </div>

      <div className="rounded-lg border max-h-56 min-w-0 max-w-full overflow-x-auto overflow-y-auto overscroll-x-contain touch-pan-x">
        <table className="w-full text-sm min-w-[36rem]">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
            <th className="px-2 py-2 text-left">Month</th><th className="px-2 text-right">Base</th><th className="px-2 text-right">Bonus</th><th className="px-2 text-right">Ded.</th><th className="px-2 text-right">Adv.</th><th className="px-2 text-right">Net</th><th className="px-2">Date</th>
          </tr></thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No salary payments yet</td></tr>}
            {payments.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-2 py-1.5">{p.monthYear}</td>
                <td className="px-2 text-right tabular-nums">{inr(p.baseAmount)}</td>
                <td className="px-2 text-right tabular-nums">{inr(p.bonus)}</td>
                <td className="px-2 text-right tabular-nums">{inr(p.deductions)}</td>
                <td className="px-2 text-right tabular-nums">{inr(p.advanceDeducted)}</td>
                <td className="px-2 text-right tabular-nums font-semibold text-emerald-700">{inr(p.netAmount)}</td>
                <td className="px-2 text-center text-xs">{p.paymentDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BiometricPanel({ staff }: { staff: Staff }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: creds = [] } = useQuery<BioCred[]>({ queryKey: ["staff-bio", staff.id], queryFn: () => api.get<BioCred[]>(`/api/staff/${staff.id}/biometric`) });
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

  const enroll = useMutation({
    mutationFn: async () => {
      const opts = await api.post<any>(`/api/staff/${staff.id}/biometric/register/begin`, {});
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...opts,
        challenge: b64uToBuf(opts.challenge),
        user: { ...opts.user, id: b64uToBuf(opts.user.id) },
        excludeCredentials: (opts.excludeCredentials ?? []).map((c: any) => ({ ...c, id: b64uToBuf(c.id) })),
      };
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
      if (!cred) throw new Error("Cancelled");
      const att = cred.response as AuthenticatorAttestationResponse;
      const response = {
        id: cred.id,
        rawId: bufToB64u(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufToB64u(att.clientDataJSON),
          attestationObject: bufToB64u(att.attestationObject),
          transports: att.getTransports ? att.getTransports() : [],
        },
        clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
        authenticatorAttachment: (cred as any).authenticatorAttachment,
      };
      return api.post(`/api/staff/${staff.id}/biometric/register/complete`, {
        response,
        expectedChallenge: opts.challenge,
        deviceName: navigator.userAgent.slice(0, 60),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-bio", staff.id] });
      toast({ title: "Fingerprint enrolled" });
    },
    onError: (e: Error) => toast({ title: "Enrollment failed", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/staff/biometric/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-bio", staff.id] }),
  });

  return (
    <div className="space-y-3">
      {!supported && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5" />
          <div>This browser does not support fingerprint authentication. Use Chrome/Edge on a device with Windows Hello, Touch ID, or Android fingerprint.</div>
        </div>
      )}
      <div className="flex items-center justify-between p-3 border rounded-lg">
        <div>
          <div className="font-medium">Enroll a fingerprint</div>
          <div className="text-xs text-muted-foreground">Uses the device's built-in fingerprint sensor (Windows Hello / Touch ID / Android).</div>
        </div>
        <Button onClick={() => enroll.mutate()} disabled={!supported || enroll.isPending}>
          <Fingerprint size={14} className="mr-1.5" />{enroll.isPending ? "Scanning…" : "Enroll Now"}
        </Button>
      </div>
      <div className="rounded-lg border">
        <div className="w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
            <th className="px-2 py-2 text-left">Device</th><th className="px-2 text-left">Enrolled</th><th className="px-2 text-left">Last Used</th><th></th>
          </tr></thead>
          <tbody>
            {creds.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No fingerprints enrolled</td></tr>}
            {creds.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-2 py-1.5 truncate max-w-[260px]">{c.deviceName ?? "Sensor"}</td>
                <td className="px-2 text-xs">{new Date(c.enrolledAt).toLocaleDateString()}</td>
                <td className="px-2 text-xs">{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : "Never"}</td>
                <td className="px-2"><Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}><Trash2 size={13} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Tab (manual + log) ──────────────────
function AttendanceTab() {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  type Row = { id: number; staffId: number; attendanceDate: string; punchIn: string | null; punchOut: string | null; source: string; staffName: string; staffCode: string; role: string };
  const { data: rows = [] } = useQuery<Row[]>({ queryKey: ["staff-attendance-all", from, to], queryFn: () => api.get<Row[]>(`/api/staff/attendance/all?from=${from}&to=${to}`) });
  const { data: today_overview } = useQuery<{ list: Array<{ staff: { id: number; name: string; role: string; staffId: string }; attendance: { punchIn: string | null; punchOut: string | null } | null }> }>({
    queryKey: ["staff-attendance-today"],
    queryFn: () => api.get(`/api/staff/dashboard/today`),
  });

  const punch = useMutation({
    mutationFn: ({ staffId, action }: { staffId: number; action: "in" | "out" }) =>
      api.post(`/api/staff/${staffId}/attendance/punch`, { action, source: "manual" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-attendance-today"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance-all"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm font-semibold mb-3 flex items-center gap-1.5"><CalendarCheck size={14} />Today's Attendance — Quick Punch</div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {today_overview?.list.map((row) => (
            <div key={row.staff.id} className="flex items-center justify-between p-2.5 border rounded-lg">
              <div>
                <div className="text-sm font-medium">{row.staff.name}</div>
                <div className="text-xs text-muted-foreground capitalize">{row.staff.role.replace("-", " ")}</div>
                <div className="text-xs mt-1">
                  {row.attendance?.punchIn && <span className="text-emerald-700">In: {new Date(row.attendance.punchIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  {row.attendance?.punchOut && <span className="text-rose-700 ml-2">Out: {new Date(row.attendance.punchOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                  {!row.attendance?.punchIn && <span className="text-muted-foreground">Not punched in</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button size="sm" variant="outline" disabled={!!row.attendance?.punchIn} onClick={() => punch.mutate({ staffId: row.staff.id, action: "in" })}><LogIn size={12} className="mr-1" />In</Button>
                <Button size="sm" variant="outline" disabled={!row.attendance?.punchIn || !!row.attendance?.punchOut} onClick={() => punch.mutate({ staffId: row.staff.id, action: "out" })}><LogOut size={12} className="mr-1" />Out</Button>
              </div>
            </div>
          ))}
          {(!today_overview || today_overview.list.length === 0) && <div className="text-sm text-muted-foreground col-span-full text-center py-4">No active staff</div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">From</Label><Input className="w-[160px]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Label className="text-xs">To</Label><Input className="w-[160px]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className="rounded-lg border bg-card min-w-0 max-w-full overflow-x-auto overscroll-x-contain touch-pan-x">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left">Date</th><th className="px-3 text-left">Staff</th><th className="px-3 text-left">Role</th>
            <th className="px-3 text-left">Punch In</th><th className="px-3 text-left">Punch Out</th><th className="px-3 text-left">Source</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No records</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.attendanceDate}</td>
                <td className="px-3 py-2 font-medium">{r.staffName} <span className="text-xs font-mono text-muted-foreground ml-1">({r.staffCode})</span></td>
                <td className="px-3 py-2 capitalize">{r.role.replace("-", " ")}</td>
                <td className="px-3 py-2">{r.punchIn ? new Date(r.punchIn).toLocaleTimeString() : "—"}</td>
                <td className="px-3 py-2">{r.punchOut ? new Date(r.punchOut).toLocaleTimeString() : "—"}</td>
                <td className="px-3 py-2"><Badge variant="secondary" className="capitalize">{r.source}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Fingerprint Kiosk (anyone-can-punch) ───────────
function KioskTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ kind: "idle" | "scanning" | "ok" | "err"; message?: string; staff?: { firstName: string; lastName: string; staffId: string }; action?: string }>({ kind: "idle" });
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

  const punch = async (action: "in" | "out") => {
    setStatus({ kind: "scanning", message: "Place your finger on the sensor…" });
    try {
      const opts = await api.post<any>("/api/staff/biometric/punch/begin", {});
      if (!opts.allowCredentials || opts.allowCredentials.length === 0) throw new Error("No fingerprints enrolled yet");
      const publicKey: PublicKeyCredentialRequestOptions = {
        ...opts,
        challenge: b64uToBuf(opts.challenge),
        allowCredentials: opts.allowCredentials.map((c: any) => ({ ...c, id: b64uToBuf(c.id), type: "public-key" })),
      };
      const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
      if (!assertion) throw new Error("Cancelled");
      const ar = assertion.response as AuthenticatorAssertionResponse;
      const response = {
        id: assertion.id,
        rawId: bufToB64u(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: bufToB64u(ar.clientDataJSON),
          authenticatorData: bufToB64u(ar.authenticatorData),
          signature: bufToB64u(ar.signature),
          userHandle: ar.userHandle ? bufToB64u(ar.userHandle) : undefined,
        },
        clientExtensionResults: assertion.getClientExtensionResults?.() ?? {},
        authenticatorAttachment: (assertion as any).authenticatorAttachment,
      };
      const result = await api.post<any>("/api/staff/biometric/punch/complete", { response, expectedChallenge: opts.challenge, action });
      setStatus({ kind: "ok", staff: result.staff, action: result.action });
      qc.invalidateQueries({ queryKey: ["staff-attendance-today"] });
      qc.invalidateQueries({ queryKey: ["staff-attendance-all"] });
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed";
      setStatus({ kind: "err", message: msg });
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="rounded-2xl border bg-gradient-to-br from-violet-500/10 via-indigo-500/10 to-fuchsia-500/10 p-8 text-center space-y-4">
        <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/40">
          <Fingerprint size={48} className="text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold">Fingerprint Attendance Kiosk</div>
          <div className="text-xs text-muted-foreground">Touch the sensor to mark attendance</div>
        </div>
        {!supported && <div className="p-2 text-xs bg-amber-50 text-amber-900 rounded">Browser doesn't support fingerprint sign-in.</div>}
        <div className="flex gap-2 justify-center">
          <Button size="lg" disabled={!supported || status.kind === "scanning"} onClick={() => punch("in")}><LogIn size={16} className="mr-1.5" />Punch In</Button>
          <Button size="lg" variant="outline" disabled={!supported || status.kind === "scanning"} onClick={() => punch("out")}><LogOut size={16} className="mr-1.5" />Punch Out</Button>
        </div>
        <div className="min-h-[60px] flex items-center justify-center">
          {status.kind === "scanning" && <div className="text-sm text-muted-foreground animate-pulse">{status.message}</div>}
          {status.kind === "ok" && status.staff && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="text-emerald-900 font-semibold">Welcome, {status.staff.firstName} {status.staff.lastName}</div>
              <div className="text-xs text-emerald-700">Punched {status.action === "out" ? "out" : "in"} at {new Date().toLocaleTimeString()}</div>
            </div>
          )}
          {status.kind === "err" && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-sm">{status.message}</div>}
        </div>
      </div>
    </div>
  );
}
