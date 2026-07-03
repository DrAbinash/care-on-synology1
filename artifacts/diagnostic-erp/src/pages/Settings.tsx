import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fetchApi } from "@/lib/fetchApi";
import { useSuperAdmin, getSuperAdminToken } from "@/hooks/useSuperAdmin";
import PageHeader from "@/components/PageHeader";
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
import {
  Plus, Trash2, Pencil, User2, Shield, CheckSquare, Square, Mail,
  Users, Download, FileText, BookOpen, ClipboardList, CreditCard,
  FlaskConical, Boxes, ShieldCheck, FileDown, KeyRound, Eye, EyeOff,
  Tag, Building2, Image as ImageIcon, Upload, MessageCircle, Printer,
  Search, Globe, Copy, ExternalLink, Check, Network, MapPin, Database,
  RefreshCcw, FileCode, Send, QrCode, Palette, Bot, Inbox, ChevronRight,
  ArrowLeft, Phone, Layers, AlertTriangle, ScanLine, Receipt, Keyboard, Brain,
  Sparkles, Construction, GraduationCap,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type AppUser = {
  id: number; name: string; email: string; role: string;
  permissions: string | null;
  // Server returns a boolean instead of the hashed PIN string
  pin?: string | null;
  hasPin?: boolean;
  isActive: boolean;
  maxDiscount: number | null;
  username?: string | null;
  photoDataUrl?: string | null;
  mustChangePin?: boolean;
  defaultStartPage?: string | null;
};

type EmailSettings = {
  id?: number;
  smtpHost: string; smtpPort: string; smtpUser: string; smtpPassword: string;
  smtpSecure: boolean; fromAddress: string; fromName: string;
  adminEmail: string; extraRecipients: string;
  billEditEnabled: boolean; dailySummaryEnabled: boolean; dailySummaryTime: string;
};

type ManualSection = {
  title: string;
  icon: typeof FileText;
  points: string[];
};

type ChangePasswordForm = {
  userId: string;
  currentPin: string;
  newPin: string;
  confirmPin: string;
};

const ROLES = ["super_admin", "admin", "manager", "accountant", "billing", "lab", "receptionist"];
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-rose-100 text-rose-800 font-bold",
  admin: "bg-red-100 text-red-700",
  manager: "bg-purple-100 text-purple-700",
  accountant: "bg-indigo-100 text-indigo-700",
  billing: "bg-blue-100 text-blue-700",
  lab: "bg-green-100 text-green-700",
  receptionist: "bg-amber-100 text-amber-700",
};
const ALL_MODULES = [
  { path: "/", label: "Billing Desk" },
  { path: "/patients", label: "Patients" },
  { path: "/register", label: "Quick Register" },
  { path: "/orders", label: "Orders" },
  { path: "/tests", label: "Test Catalog" },
  { path: "/billing", label: "Billing" },
  { path: "/payments", label: "Payments" },
  { path: "/doctors", label: "Doctors" },
  { path: "/reports", label: "Reports" },
  { path: "/report-generator", label: "Report Generator" },
  { path: "/inventory", label: "Inventory" },
  { path: "/referrals", label: "Referrals" },
  { path: "/accounting", label: "Accounting" },
  { path: "/discounts", label: "Discounts" },
  { path: "/settings", label: "Settings" },
  { path: "/form-f", label: "Form F (PCPNDT)" },
  { path: "/queue", label: "Queue Tokens" },
];
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_MODULES.map(m => m.path),
  admin: ALL_MODULES.map(m => m.path),
  manager: ["/", "/patients", "/billing", "/payments", "/doctors", "/reports", "/referrals", "/accounting", "/register", "/discounts"],
  accountant: ["/", "/accounting", "/reports", "/billing", "/payments"],
  billing: ["/", "/patients", "/billing", "/payments", "/register", "/discounts"],
  lab: ["/orders", "/tests", "/report-generator", "/inventory"],
  receptionist: ["/", "/patients", "/orders", "/register"],
};

const MODULE_SUB_PERMISSIONS: Record<string, { id: string; label: string }[]> = {
  "/settings": [
    { id: "clinic", label: "Clinic Info" },
    { id: "users", label: "Users Management" },
    { id: "security", label: "Security & FIDO2" },
    { id: "backup", label: "Backup & Replication" },
    { id: "radiology", label: "Radiology Config" },
    { id: "appearance", label: "Appearance & Themes" },
    { id: "notifications", label: "Email & WhatsApp" },
    { id: "billing", label: "Billing Settings" },
    { id: "devices", label: "Printers & Scanner" },
    { id: "infrastructure", label: "Departments, Locations, Branches, Templates" },
    { id: "portals", label: "Patient Portal & Kiosk" },
  ],
  "/patients": [
    { id: "view", label: "View" },
    { id: "create", label: "Create" },
    { id: "edit", label: "Edit" },
    { id: "delete", label: "Delete" },
  ],
  "/billing": [
    { id: "view", label: "View" },
    { id: "create", label: "Create" },
    { id: "edit", label: "Edit" },
    { id: "delete", label: "Delete" },
    { id: "refund", label: "Refund" },
    { id: "reprint", label: "Reprint" },
    { id: "discount", label: "Discount" },
  ],
  "/reports": [
    { id: "view", label: "View" },
    { id: "create", label: "Create" },
    { id: "edit", label: "Edit" },
    { id: "print", label: "Print" },
    { id: "approve", label: "Approve" },
    { id: "finalize", label: "Finalize" },
  ],
  "/accounting": [
    { id: "view", label: "View" },
    { id: "create", label: "Create" },
    { id: "edit", label: "Edit" },
    { id: "delete", label: "Delete" },
  ],
};

const TABS = [
  { id: "clinic", label: "Clinic Info", icon: Building2 },
  { id: "about", label: "About / Version", icon: Tag },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "users", label: "Users", icon: Users },
  { id: "departments", label: "Departments", icon: Network },
  { id: "locations", label: "Locations", icon: Layers },
  { id: "branches", label: "Branches", icon: MapPin },
  { id: "report-templates", label: "Report Templates", icon: FileCode },
  { id: "portal", label: "Patient Portal", icon: Globe },
  { id: "online-booking", label: "Online Booking", icon: CreditCard },
  { id: "kiosk", label: "Self-Reg Kiosk", icon: QrCode },
  { id: "queue-settings", label: "Queue Settings", icon: ClipboardList },
  { id: "form-f", label: "Form F Tests", icon: FileText },
  { id: "scanner", label: "Scanner", icon: ScanLine },
  { id: "email", label: "Email Notifications", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "printers", label: "Printers", icon: Printer },
  { id: "billing-print", label: "Billing Print", icon: FileText },
  { id: "receipt-messages", label: "Receipt Messages", icon: MessageCircle },
  { id: "footer-services", label: "Footer Services", icon: Layers },
  { id: "promotional-footer", label: "Promotional Footer", icon: Tag },
  { id: "discount-reasons", label: "Discount Reasons", icon: Tag },
  { id: "backup", label: "Backup", icon: Database },
  { id: "radiology", label: "Radiology", icon: ScanLine },
  { id: "manual", label: "User Manual", icon: FileDown },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "password", label: "Change Password", icon: KeyRound },
];

const MANUAL_SECTIONS: ManualSection[] = [
  { title: "Getting Started", icon: BookOpen, points: ["Use the Dashboard to review daily counts, revenue, and pending work.", "Register patients first, then create test orders, then generate bills.", "Use the Billing module to record payments and monitor balances."] },
  { title: "Core Workflow", icon: ClipboardList, points: ["Patients → Orders → Bills → Payments → Reports.", "Lab staff can process tests and publish report results.", "Accounting can review vouchers, ledgers, and summaries."] },
  { title: "Billing & Payments", icon: CreditCard, points: ["Bills auto-calculate subtotal, discount, tax, paid amount, and balance.", "Partial payments update bill status automatically.", "Super Admin can edit bill totals or delete bills with audit tracking."] },
  { title: "Inventory & Lab", icon: Boxes, points: ["Track stock movements, purchase entries, and low-stock warnings.", "Use the test catalog to maintain pricing and categories.", "Generate and manage diagnostic reports from the report generator."] },
  { title: "Referrals & Doctors", icon: FlaskConical, points: ["Manage referring doctors and commission-linked records.", "Doctor name changes automatically reflect in commission-linked modules.", "Use doctor profiles to review referral performance."] },
  { title: "Administration", icon: ShieldCheck, points: ["Settings controls users, roles, permissions, and notification preferences.", "Super Admin Portal is a separate session-based app for irreversible actions.", "All critical actions are audited for traceability."] },
];

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildManualText() {
  return [
    "Care Diagnostics Billing ERP User Manual",
    "",
    "1. Getting Started",
    "- Use the Dashboard to review daily counts, revenue, and pending work.",
    "- Register patients first, then create test orders, then generate bills.",
    "- Use the Billing module to record payments and monitor balances.",
    "",
    "2. Core Workflow",
    "- Patients → Orders → Bills → Payments → Reports.",
    "- Lab staff can process tests and publish report results.",
    "- Accounting can review vouchers, ledgers, and summaries.",
    "",
    "3. Billing & Payments",
    "- Bills auto-calculate subtotal, discount, tax, paid amount, and balance.",
    "- Partial payments update bill status automatically.",
    "- Super Admin can edit bill totals or delete bills with audit tracking.",
    "",
    "4. Inventory & Lab",
    "- Track stock movements, purchase entries, and low-stock warnings.",
    "- Use the test catalog to maintain pricing and categories.",
    "- Generate and manage diagnostic reports from the report generator.",
    "",
    "5. Referrals & Doctors",
    "- Manage referring doctors and commission-linked records.",
    "- Doctor name changes automatically reflect in commission-linked modules.",
    "- Use doctor profiles to review referral performance.",
    "",
    "6. Administration",
    "- Settings controls users, roles, permissions, and notification preferences.",
    "- Super Admin Portal is a separate session-based app for irreversible actions.",
    "- All critical actions are audited for traceability.",
  ].join("\n");
}

export default function Settings() {
  const qc = useQueryClient();
  const session = useMemo(() => readStaffSession(), []);

  const allowedTabs = useMemo(() => {
    if (!session) return TABS;
    return TABS.filter(t => {
      if (t.id === "password" || t.id === "manual") return true;
      let action = t.id;
      if (t.id === "email" || t.id === "whatsapp") action = "notifications";
      else if (t.id === "billing-print" || t.id === "discount-reasons" || t.id === "receipt-messages" || t.id === "footer-services" || t.id === "promotional-footer") action = "billing";
      else if (t.id === "printers" || t.id === "scanner") action = "devices";
      else if (t.id === "departments" || t.id === "locations" || t.id === "branches" || t.id === "report-templates") action = "infrastructure";
      else if (t.id === "portal" || t.id === "online-booking" || t.id === "kiosk") action = "portals";
      
      return hasSubPermission(session, "/settings", action);
    });
  }, [session]);

  const [tab, setTab] = useState<string>(() => {
    const initialSession = readStaffSession();
    if (!initialSession) return "users";
    const initialAllowed = TABS.filter(t => {
      if (t.id === "password" || t.id === "manual") return true;
      let action = t.id;
      if (t.id === "email" || t.id === "whatsapp") action = "notifications";
      else if (t.id === "billing-print" || t.id === "discount-reasons" || t.id === "receipt-messages" || t.id === "footer-services" || t.id === "promotional-footer") action = "billing";
      else if (t.id === "printers" || t.id === "scanner") action = "devices";
      else if (t.id === "departments" || t.id === "locations" || t.id === "branches" || t.id === "report-templates") action = "infrastructure";
      else if (t.id === "portal" || t.id === "online-booking" || t.id === "kiosk" || t.id === "queue-settings") action = "portals";
      
      return hasSubPermission(initialSession, "/settings", action);
    });
    return initialAllowed[0]?.id ?? "password";
  });

  return (
    <div className="pb-8">
      <PageHeader title="Settings" subtitle="User management, system configuration, and software documentation" />
      <div className="px-6">
        <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl mb-6 w-fit">
          {allowedTabs.map(t => {
            const Icon = t.icon;
            return <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon size={14} />{t.label}</button>;
          })}
        </div>
        {tab === "clinic" && <ClinicInfoTab />}
        {tab === "appearance" && <AppearanceTab />}
        {tab === "users" && <UsersTab qc={qc} />}
        {tab === "departments" && <DepartmentsTab />}
        {tab === "locations" && <LocationsTab />}
        {tab === "branches" && <BranchesTab />}
        {tab === "report-templates" && <ReportTemplatesTab />}
        {tab === "portal" && <PatientPortalTab />}
        {tab === "online-booking" && <OnlineBookingTab />}
        {tab === "kiosk" && <KioskSettingsTab />}
        {tab === "queue-settings" && <QueueSettingsTab />}
        {tab === "form-f" && <FormFTestsTab />}
        {tab === "scanner" && <ScannerSettingsTab />}
        {tab === "email" && <EmailTab />}
        {tab === "whatsapp" && <WhatsappTab />}
        {tab === "printers" && <PrinterTab />}
        {tab === "billing-print" && <BillingPrintTab />}
        {tab === "receipt-messages" && <ReceiptMessagesTab />}
        {tab === "footer-services" && <FooterServicesTab />}
        {tab === "promotional-footer" && <PromotionalFooterTab />}
        {tab === "discount-reasons" && <DiscountReasonsTab />}
        {tab === "backup" && <BackupTab />}
        {tab === "radiology" && <RadiologySettingsTab />}
        {tab === "manual" && <ManualTab />}
        {tab === "about" && <AboutTab />}
        {tab === "security" && <SecurityTab />}
        {tab === "password" && <ChangePasswordTab />}
      </div>
    </div>
  );
}

function UsersTab({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [selectedPerms, setSelectedPerms] = useState<string[]>([]);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const { data: users = [], isLoading } = useQuery<AppUser[]>({ queryKey: ["users"], queryFn: () => api.get("/api/users") });
  const saveUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => editUser ? api.patch(`/api/users/${editUser.id}`, body) : api.post("/api/users", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setOpen(false); setEditUser(null); setPhotoDataUrl(null); setSaveErr(""); reset(); },
    onError: (e: Error) => setSaveErr(e.message || "Could not save user"),
  });
  const toggleActive = useMutation({ mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => api.patch(`/api/users/${id}`, { isActive }), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  const deleteUser = useMutation({ mutationFn: (id: number) => api.delete(`/api/users/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }) });
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<{ name: string; email: string; username: string; role: string; pin: string; maxDiscount: string; defaultStartPage: string; }>();

  const openAdd = () => {
    setEditUser(null);
    setSelectedPerms(DEFAULT_PERMISSIONS["receptionist"]);
    setPhotoDataUrl(null);
    setPhotoErr(""); setSaveErr("");
    reset({ name: "", email: "", username: "", role: "receptionist", pin: "", maxDiscount: "", defaultStartPage: "" });
    setOpen(true);
  };
  const openEdit = (u: AppUser) => {
    setEditUser(u);
    setSelectedPerms(u.permissions ? JSON.parse(u.permissions) : DEFAULT_PERMISSIONS[u.role] ?? []);
    setPhotoDataUrl(u.photoDataUrl ?? null);
    setPhotoErr(""); setSaveErr("");
    // PIN field stays blank on edit — leaving it blank means "don't change".
    // Typing a new value resets it (and forces a change on next login).
    reset({ name: u.name, email: u.email, username: u.username ?? "", role: u.role, pin: "", maxDiscount: u.maxDiscount != null ? String(u.maxDiscount) : "", defaultStartPage: u.defaultStartPage ?? "" });
    setOpen(true);
  };
  const togglePerm = (path: string) => {
    setSelectedPerms(prev => {
      if (prev.includes(path)) {
        return prev.filter(p => p !== path && !p.startsWith(path + ":"));
      } else {
        return [...prev, path];
      }
    });
  };

  const toggleSubPerm = (modulePath: string, action: string) => {
    const subPerm = `${modulePath}:${action}`;
    setSelectedPerms(prev => {
      if (prev.includes(subPerm)) {
        return prev.filter(p => p !== subPerm);
      } else {
        return [...prev, subPerm];
      }
    });
  };

  const onPhotoChange = (file: File | null) => {
    setPhotoErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoErr("Please pick an image file"); return; }
    if (file.size > 800_000) { setPhotoErr("Photo too large — please pick an image under 800 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const onSave = handleSubmit((d) => {
    setSaveErr("");
    const body: Record<string, unknown> = {
      name: d.name?.trim(),
      email: d.email?.trim(),
      // Lowercase + trim — matches what the server stores for case-insensitive
      // login. Empty string sent so the server clears legacy values when needed.
      username: (d.username ?? "").trim().toLowerCase(),
      role: d.role,
      permissions: selectedPerms,
      maxDiscount: d.maxDiscount !== "" ? Number(d.maxDiscount) : null,
      photoDataUrl: photoDataUrl,
      defaultStartPage: d.defaultStartPage || null,
    };
    // Only include PIN when admin actually typed one — blank means "leave it"
    if (d.pin && d.pin.trim().length > 0) body.pin = d.pin.trim();
    saveUser.mutate(body);
  });

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Manage user accounts, roles, and module access</p>
        <Button size="sm" onClick={openAdd}><Plus size={14} className="mr-1" /> Add User</Button>
      </div>
      <div className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground"><User2 size={36} className="mx-auto mb-3 opacity-30" /><p>No users yet. Add your first user to get started.</p></div>
        ) : (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-card-border">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Username</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Modules</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const perms: string[] = u.permissions ? JSON.parse(u.permissions) : [];
                  const hasPin = !!(u.hasPin ?? u.pin);
                  return (
                    <tr key={u.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {u.photoDataUrl ? (
                            <img src={u.photoDataUrl} alt="" className="w-7 h-7 rounded-full object-cover border" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{u.name.charAt(0).toUpperCase()}</div>
                          )}
                          <span className="font-medium">{u.name}</span>
                          {hasPin && <Shield size={11} className="text-muted-foreground" />}
                          {u.mustChangePin && <span title="Must change PIN on next login" className="text-[10px] text-amber-600 font-medium">PIN reset</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.username || <span className="opacity-40">—</span>}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3"><Badge className={`${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-700"} text-xs capitalize`}>{u.role}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {perms.slice(0, 4).map(p => { const mod = ALL_MODULES.find(m => m.path === p); return mod ? <span key={p} className="text-xs bg-muted px-1.5 py-0.5 rounded">{mod.label}</span> : null; })}
                          {perms.length > 4 && <span className="text-xs text-muted-foreground">+{perms.length - 4} more</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })} className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{u.isActive ? "Active" : "Inactive"}</button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(u)}><Pencil size={13} /></Button>
                          <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete user "${u.name}"?`)) deleteUser.mutate(u.id); }}><Trash2 size={13} /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="bg-muted/30 border border-card-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">Role Descriptions</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {[
              { role: "super_admin", desc: "All permissions + delete/super-edit bills" },
              { role: "admin", desc: "Full access to all modules" },
              { role: "manager", desc: "Reports, billing, referrals, accounting, discounts" },
              { role: "accountant", desc: "Accounting, reports, billing & payments view" },
              { role: "billing", desc: "Patients, billing, payments, quick register, discounts" },
              { role: "lab", desc: "Orders, test catalog, report generator, inventory" },
              { role: "receptionist", desc: "Patients, orders, quick register" },
            ].map(r => (
              <div key={r.role} className="flex items-start gap-2">
                <Badge className={`${ROLE_COLORS[r.role]} text-xs capitalize flex-shrink-0 mt-0.5`}>{r.role}</Badge>
                <span className="text-muted-foreground">{r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editUser ? "Edit User" : "Add User"}</DialogTitle></DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            {/* Photo at the top so admins can recognize the staff member at a glance */}
            <div className="flex items-center gap-4">
              {photoDataUrl ? (
                <img src={photoDataUrl} alt="Staff" className="w-20 h-20 rounded-full object-cover border-2 border-card-border" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-muted border-2 border-dashed border-card-border flex items-center justify-center text-muted-foreground"><User2 size={28} /></div>
              )}
              <div className="space-y-2">
                <input id="staff-photo-input" type="file" accept="image/*" className="hidden" onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("staff-photo-input")?.click()}>
                    <Upload size={13} className="mr-1.5" /> {photoDataUrl ? "Change Photo" : "Add Photo"}
                  </Button>
                  {photoDataUrl && (
                    <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setPhotoDataUrl(null)}><Trash2 size={13} className="mr-1.5" /> Remove</Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Optional. Square image works best. Max 800 KB.</p>
                {photoErr && <p className="text-xs text-destructive">{photoErr}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name *</Label>
                <Input {...register("name", { required: "Name is required" })} className="mt-1" placeholder="Dr. Asha Verma" />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message || "Name is required"}</p>}
              </div>
              <div>
                <Label>Username *</Label>
                <Input {...register("username", { required: "Username is required" })} className="mt-1" autoComplete="off" placeholder="asha" />
                <p className="text-[11px] text-muted-foreground mt-1">Used for staff sign-in. Letters, numbers, dot/underscore.</p>
                {errors.username && <p className="text-xs text-destructive mt-1">{errors.username.message || "Username is required"}</p>}
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" {...register("email", { required: "Email is required" })} className="mt-1" />
                {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message || "Email is required"}</p>}
              </div>
              <div>
                <Label>Role *</Label>
                <Select value={watch("role")} onValueChange={(v) => setValue("role", v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{editUser ? "Reset PIN (leave blank to keep)" : "PIN *"}</Label>
                <Input type="password" inputMode="numeric" autoComplete="new-password" {...register("pin", editUser ? { minLength: { value: 4, message: "PIN must be at least 4 characters" } } : { required: "PIN is required", minLength: { value: 4, message: "PIN must be at least 4 characters" } })} className="mt-1" placeholder={editUser ? "•••••• (unchanged)" : "At least 4 characters"} />
                <p className="text-[11px] text-muted-foreground mt-1">User will be forced to set their own PIN on next sign-in.</p>
                {errors.pin && <p className="text-xs text-destructive mt-1">{errors.pin.message || "PIN is required"}</p>}
              </div>
              <div>
                <Label>Max Discount %</Label>
                <Input type="number" min="0" max="100" {...register("maxDiscount")} className="mt-1" placeholder="e.g. 20" />
                <p className="text-[11px] text-muted-foreground mt-1">Leave blank or 0 to disallow discounts. Set 100 to allow any discount. Admins are never restricted.</p>
              </div>
              <div>
                <Label>Default Start Page</Label>
                <Select value={watch("defaultStartPage") || ""} onValueChange={(v) => setValue("defaultStartPage", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Default Dashboard" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Default Dashboard</SelectItem>
                    {ALL_MODULES.map(m => (
                      <SelectItem key={m.path} value={m.path}>{m.label}</SelectItem>
                    ))}
                    <SelectItem value="/report-delivery">Report Delivery</SelectItem>
                    <SelectItem value="/scan-station">Scan Station</SelectItem>
                    <SelectItem value="/samples">Samples</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Select the default page the user lands on after login.</p>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-3">Module Permissions</p>
              <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
                {ALL_MODULES.map(m => {
                  const subPerms = MODULE_SUB_PERMISSIONS[m.path];
                  const hasFull = selectedPerms.includes(m.path);
                  return (
                    <div key={m.path} className="border border-card-border rounded-xl p-3 bg-muted/10">
                      <div className="flex items-center justify-between">
                        <button type="button" onClick={() => togglePerm(m.path)} className="flex items-center gap-2 text-sm font-semibold hover:text-primary text-left">
                          {hasFull ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                          <span>{m.label}</span>
                        </button>
                        {hasFull && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">Full Access</span>}
                      </div>
                      {subPerms && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pl-6 border-l border-dashed border-card-border">
                          {subPerms.map(sub => {
                            const isChecked = hasFull || selectedPerms.includes(`${m.path}:${sub.id}`);
                            return (
                              <button
                                key={sub.id}
                                type="button"
                                disabled={hasFull}
                                onClick={() => toggleSubPerm(m.path, sub.id)}
                                className={`flex items-center gap-2 text-xs p-2 rounded-lg border transition-all text-left ${isChecked ? "bg-primary/5 border-primary/20" : "border-border hover:bg-muted/50"} ${hasFull ? "opacity-60 cursor-not-allowed" : ""}`}
                              >
                                {isChecked ? <CheckSquare size={12} className={hasFull ? "text-muted-foreground" : "text-primary"} /> : <Square size={12} />}
                                <span className={isChecked ? "font-semibold text-foreground" : "text-muted-foreground"}>{sub.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {saveErr && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">{saveErr}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saveUser.isPending}>{saveUser.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ClinicSettings = {
  id?: number;
  name: string; tagline: string; address: string; registeredAddress: string; email: string; phone: string;
  website: string; gstin: string; logoDataUrl: string | null; footerNote: string;
  patientPhotoEnabled?: boolean;
  showTatOnBill?: boolean;
  billPrintCopies?: number;
  qrOnBillEnabled?: boolean;
  sidebarTheme?: string;
  billDefaultPaperSize?: string;
  billShowCode?: boolean;
  billShowCategory?: boolean;
  dayCloseAutoPrint?: boolean;
  // V3: Receipt messages
  receiptThankYouMessage?: string;
  receiptCollectionMessage?: string;
  receiptQrMessage?: string;
  receiptPromotionalMessage?: string;
  // V3: Service footer
  serviceFooter?: string;
  // V3: Follow-up
  showFollowUpMessage?: boolean;
  followUpMessage?: string;
  // V3: Promotional
  showPromotionalFooter?: boolean;
  promotionalTitle?: string;
  promotionalDescription?: string;
  // V3: Identity & security
  showPatientSince?: boolean;
  showVerifiedBadge?: boolean;
  // V3: Print audit
  showAuditInfoOnPatientCopy?: boolean;
  // V3: Additional footer messages
  showWorkingHours?: boolean;
  workingHoursMessage?: string;
  showHomeCollection?: boolean;
  homeCollectionMessage?: string;
  showEmergency?: boolean;
  emergencyMessage?: string;
  showReferralProgram?: boolean;
  referralProgramMessage?: string;
  showHealthPackages?: boolean;
  healthPackagesMessage?: string;
  showAccreditation?: boolean;
  accreditationMessage?: string;
  showWhatsAppBooking?: boolean;
  whatsAppBookingMessage?: string;
  showCustomFooterMessage?: boolean;
  customFooterMessage?: string;
};

import { SIDEBAR_THEMES as SIDEBAR_THEME_PRESETS, parseCustomHex, buildCustomTheme } from "@/lib/sidebarThemes";
import { useUserTheme } from "@/lib/userTheme";
import { readStaffSession, isFeatureEnabled, setFeatureFlag, hasSubPermission } from "@/lib/staffSession";
import { getBillPrintLayout, setBillPrintLayout, BILL_LAYOUTS, type BillLayout } from "@/lib/billPrintLayout";

function ThemeGrid({
  themes,
  activeId,
  onSelect,
}: {
  themes: typeof SIDEBAR_THEME_PRESETS;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {themes.map((preset) => {
        const isActive = activeId === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset.id)}
            className={`relative rounded-xl overflow-hidden border-2 transition-all focus:outline-none ${isActive ? "border-primary shadow-md scale-[1.03]" : "border-transparent hover:border-muted-foreground/40"}`}
            aria-pressed={isActive}
            title={preset.label}
          >
            <div
              className="h-20 w-full flex flex-col justify-end p-2.5"
              style={{ background: preset.gradient }}
            >
              <div className="flex gap-1 mb-1">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-1.5 rounded-full bg-white/30" style={{ width: i === 0 ? "55%" : i === 1 ? "35%" : "25%" }} />
                ))}
              </div>
              <div className="h-1.5 rounded-full bg-white/50 w-2/3" />
            </div>
            <div className="flex items-center justify-between px-2.5 py-2 bg-card">
              <span className="text-xs font-medium truncate">{preset.label}</span>
              {isActive && <Check size={13} className="text-primary shrink-0" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CustomColorPicker({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const customHex = parseCustomHex(activeId);
  const isActive = customHex !== null;
  const previewHex = customHex ?? "#7b2d2d";
  const previewTheme = buildCustomTheme(previewHex);

  return (
    <div className="mt-1">
      <p className="text-xs font-medium text-muted-foreground mb-2">Or pick a custom color</p>
      <div
        className={`flex items-center gap-3 rounded-xl border-2 p-3 transition-all ${
          isActive ? "border-primary shadow-md" : "border-transparent hover:border-muted-foreground/30"
        } bg-card`}
      >
        <div
          className="h-14 w-14 shrink-0 rounded-lg overflow-hidden"
          style={{ background: previewTheme.gradient }}
        >
          <div className="h-full w-full flex flex-col justify-end p-1.5">
            <div className="flex gap-0.5 mb-0.5">
              {[55, 35, 25].map((w, i) => (
                <div key={i} className="h-1 rounded-full bg-white/30" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="h-1 rounded-full bg-white/50 w-2/3" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Custom Color</label>
            {isActive && <Check size={13} className="text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Pick any brand color for the sidebar</p>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="color"
              value={previewHex}
              onChange={(e) => onSelect(`custom:${e.target.value}`)}
              className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-0.5"
              title="Pick a custom sidebar color"
            />
            <span className="text-xs font-mono text-muted-foreground">{previewHex}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarBehaviourCard() {
  const [autoMinimise, setAutoMinimise] = useState(() => localStorage.getItem("sidebarAutoMinimise") === "1");
  const toggle = () => {
    const next = !autoMinimise;
    setAutoMinimise(next);
    if (next) localStorage.setItem("sidebarAutoMinimise", "1");
    else localStorage.removeItem("sidebarAutoMinimise");
  };
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
      <div>
        <h2 className="font-bold text-lg flex items-center gap-2">🗂 Sidebar Behaviour</h2>
        <p className="text-sm text-muted-foreground">Personal preference for this device — not synced across staff accounts.</p>
      </div>
      <div>
        <p className="text-sm font-medium mb-1">Auto-minimise sidebar on navigation</p>
        <button
          type="button"
          onClick={toggle}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${autoMinimise ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
        >
          <span className="text-sm font-medium">{autoMinimise ? "Enabled" : "Disabled"}</span>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoMinimise ? "bg-green-500" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${autoMinimise ? "translate-x-5" : "translate-x-1"}`} />
          </span>
        </button>
        <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          When enabled, the sidebar collapses to an icon rail after you click any menu item, giving more screen space for your work. Click the <strong>arrow button</strong> at the top of the sidebar to expand it again at any time.
        </p>
      </div>
    </div>
  );
}

type BillingLayout = "unified" | "stepped" | "compact" | "classic" | "modern-pro";

function BillingDeskLayoutCard() {
  const [layout, setLayout] = useState<BillingLayout>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("billingDeskLayout") : null;
    return (stored as BillingLayout) || "unified";
  });
  const [autoAdvance, setAutoAdvance] = useState(() => isFeatureEnabled("billingDeskAutoAdvance"));
  const [showQuickTests, setShowQuickTests] = useState(() => isFeatureEnabled("billingDeskQuickTests") !== false);
  const [showPackages, setShowPackages] = useState(() => isFeatureEnabled("billingDeskShowPackages") !== false);
  const [stickyBillSummary, setStickyBillSummary] = useState(() => isFeatureEnabled("billingDeskStickyBillSummary") !== false);
  const [stickyPayment, setStickyPayment] = useState(() => isFeatureEnabled("billingDeskStickyPayment") !== false);
  const [denseTestList, setDenseTestList] = useState(() => isFeatureEnabled("billingDeskDenseTestList"));
  const [largeFont, setLargeFont] = useState(() => isFeatureEnabled("billingDeskLargeFont"));
  const [showOptionalFields, setShowOptionalFields] = useState(() => isFeatureEnabled("billingDeskShowOptionalFields"));
  const [keyboardNav, setKeyboardNav] = useState(() => isFeatureEnabled("billingDeskKeyboardNav") !== false);
  const [autoFocusNext, setAutoFocusNext] = useState(() => isFeatureEnabled("billingDeskAutoFocus") !== false);

  // All toggle helpers follow the same pattern: update local state + write to
  // localStorage via setFeatureFlag (which now dispatches featureFlagsChanged,
  // making BillingDesk re-read all flags immediately without a page refresh).
  const toggle = (flag: string, cur: boolean, setter: (v: boolean) => void) => {
    const next = !cur;
    setter(next);
    setFeatureFlag(flag, next);
  };

  const saveLayout = (next: BillingLayout) => {
    setLayout(next);
    localStorage.setItem("billingDeskLayout", next);
    setFeatureFlag("billingDeskStepped", next === "stepped");
    // billingDeskLayoutChanged: wakes up BillingDesk's layoutMode state
    // featureFlagsChanged: dispatched automatically by setFeatureFlag above
    window.dispatchEvent(new Event("billingDeskLayoutChanged"));
  };

  const toggleAutoAdvance   = () => toggle("billingDeskAutoAdvance",      autoAdvance,       setAutoAdvance);
  const toggleQuickTests    = () => toggle("billingDeskQuickTests",        showQuickTests,    setShowQuickTests);
  const toggleShowPackages  = () => toggle("billingDeskShowPackages",      showPackages,      setShowPackages);

  const layouts: { id: BillingLayout; label: string; desc: string }[] = [
    { id: "unified", label: "Unified Single Page", desc: "Everything on one screen — patient, tests, doctor, payment, and print. Best for fast billing." },
    { id: "stepped", label: "Stepped Wizard", desc: "4 sequential steps (Patient → Doctor → Tests & Packages → Summary). Best for training new staff." },
    { id: "compact", label: "Compact", desc: "Dense layout with minimal spacing. Best for small screens." },
    { id: "classic", label: "Classic", desc: "Original traditional billing desk layout. Best for familiar workflow." },
    { id: "modern-pro", label: "Modern Pro (New)", desc: "Bright, modern design with vibrant colors and streamlined workflow. Best for contemporary, fast-paced clinics." },
  ];

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-bold text-lg flex items-center gap-2"><Receipt size={16} /> Billing Desk Layout</h2>
        <p className="text-sm text-muted-foreground">Personal preference for this device — not synced across staff accounts.</p>
      </div>

      {/* Layout selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Layout Style</p>
        <div className="space-y-2">
          {layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => saveLayout(l.id)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors flex items-start gap-3 ${
                layout === l.id
                  ? "bg-primary/5 border-primary/30 dark:bg-primary/10 dark:border-primary/20"
                  : "bg-muted/30 border-card-border hover:bg-muted/50"
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                layout === l.id ? "border-primary" : "border-muted-foreground/40"
              }`}>
                {layout === l.id && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <div>
                <div className="text-sm font-bold">{l.label}</div>
                <div className="text-[11px] text-muted-foreground">{l.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Flow options — only relevant when stepped wizard is active */}
      {layout === "stepped" && (
        <div className="space-y-2 pt-2 border-t border-card-border">
          <p className="text-sm font-medium">Wizard Options</p>
          <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
            <span className="text-sm">Auto-advance to next step</span>
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoAdvance ? "bg-primary" : "bg-muted-foreground/40"}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${autoAdvance ? "translate-x-5" : "translate-x-1"}`} />
            </span>
            <input type="checkbox" className="sr-only" checked={autoAdvance} onChange={toggleAutoAdvance} />
          </label>
        </div>
      )}

      {/* Universal options — Sections */}
      <div className="space-y-2 pt-2 border-t border-card-border">
        <p className="text-sm font-medium">Show / Hide Sections</p>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <span className="text-sm">Quick Test Slots</span>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showQuickTests ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showQuickTests ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={showQuickTests} onChange={toggleQuickTests} />
        </label>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <span className="text-sm">Package Section</span>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showPackages ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showPackages ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={showPackages} onChange={toggleShowPackages} />
        </label>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Always Show Optional Fields</span>
            <div className="text-[11px] text-muted-foreground">DOB, blood group, address always visible without expanding</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showOptionalFields ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${showOptionalFields ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={showOptionalFields} onChange={() => toggle("billingDeskShowOptionalFields", showOptionalFields, setShowOptionalFields)} />
        </label>
      </div>

      {/* Density & Font */}
      <div className="space-y-2 pt-2 border-t border-card-border">
        <p className="text-sm font-medium">Density &amp; Typography</p>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Dense Test List</span>
            <div className="text-[11px] text-muted-foreground">Reduce row height in test catalog — show more tests without scrolling</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${denseTestList ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${denseTestList ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={denseTestList} onChange={() => toggle("billingDeskDenseTestList", denseTestList, setDenseTestList)} />
        </label>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Large Font Mode</span>
            <div className="text-[11px] text-muted-foreground">Increase font size — useful for large monitors or accessibility</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${largeFont ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${largeFont ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={largeFont} onChange={() => toggle("billingDeskLargeFont", largeFont, setLargeFont)} />
        </label>
      </div>

      {/* Layout stickiness */}
      <div className="space-y-2 pt-2 border-t border-card-border">
        <p className="text-sm font-medium">Sticky Panels</p>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Sticky Bill Summary</span>
            <div className="text-[11px] text-muted-foreground">Bill total, discount, and due always visible — never hidden by scrolling</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${stickyBillSummary ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${stickyBillSummary ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={stickyBillSummary} onChange={() => toggle("billingDeskStickyBillSummary", stickyBillSummary, setStickyBillSummary)} />
        </label>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Sticky Payment Panel</span>
            <div className="text-[11px] text-muted-foreground">Payment method options always in view</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${stickyPayment ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${stickyPayment ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={stickyPayment} onChange={() => toggle("billingDeskStickyPayment", stickyPayment, setStickyPayment)} />
        </label>
      </div>

      {/* Keyboard & workflow */}
      <div className="space-y-2 pt-2 border-t border-card-border">
        <p className="text-sm font-medium">Keyboard &amp; Workflow</p>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Keyboard Shortcuts</span>
            <div className="text-[11px] text-muted-foreground">Ctrl+P Print, Ctrl+S Save, F2 Patient, F4 Payment</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${keyboardNav ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${keyboardNav ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={keyboardNav} onChange={() => toggle("billingDeskKeyboardNav", keyboardNav, setKeyboardNav)} />
        </label>
        <label className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
          <div>
            <span className="text-sm">Auto-focus Next Field</span>
            <div className="text-[11px] text-muted-foreground">After selecting a patient, focus jumps to test search automatically</div>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoFocusNext ? "bg-primary" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${autoFocusNext ? "translate-x-5" : "translate-x-1"}`} />
          </span>
          <input type="checkbox" className="sr-only" checked={autoFocusNext} onChange={() => toggle("billingDeskAutoFocus", autoFocusNext, setAutoFocusNext)} />
        </label>
      </div>

      <p className="text-[11px] text-muted-foreground pt-1">
        ✦ All settings apply immediately — no page refresh needed. Stored locally on this device only.
      </p>
    </div>
  );
}

function AppearanceTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = readStaffSession();
  const isAdmin = session?.user.role === "admin" || session?.user.role === "super_admin";

  // Clinic-wide default — available to all users (same cache Layout reads).
  const { data: clinicPublic } = useQuery<{ sidebarTheme?: string }>({
    queryKey: ["clinic-settings-public"],
    queryFn: () => api.get("/api/clinic-settings"),
    staleTime: 60_000,
  });
  const clinicDefaultTheme = clinicPublic?.sidebarTheme ?? "navy";

  // ── Per-user theme (localStorage cache + DB source-of-truth) ───────────
  // Pass session.user.sidebarTheme so the hook seeds localStorage on a fresh device.
  // After seeding, userTheme reflects the correct value reactively.
  const { userTheme, setTheme: saveUserTheme, clearTheme } = useUserTheme(session?.user.id, session?.user.sidebarTheme);
  const [myActiveTheme, setMyActiveTheme] = useState<string>(userTheme ?? clinicDefaultTheme);

  useEffect(() => {
    setMyActiveTheme(userTheme ?? clinicDefaultTheme);
  }, [userTheme, clinicDefaultTheme]);

  const applyMyTheme = (id: string) => {
    setMyActiveTheme(id);
    saveUserTheme(id);
    toast({ title: "Your sidebar theme updated" });
  };

  const resetToClinicDefault = () => {
    clearTheme();
    setMyActiveTheme("navy");
    toast({ title: "Reset to clinic default" });
  };

  // ── Clinic-wide theme (API, admin only) ────────────────────────────────
  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
    enabled: isAdmin,
  });

  const persistedTheme = settings?.sidebarTheme ?? "navy";
  const [activeClinicTheme, setActiveClinicTheme] = useState<string>(persistedTheme);
  const [unsaved, setUnsaved] = useState(false);

  useEffect(() => {
    setActiveClinicTheme(persistedTheme);
    setUnsaved(false);
  }, [persistedTheme]);

  useEffect(() => {
    return () => {
      qc.setQueryData(["clinic-settings-public"], (old: Record<string, unknown> | undefined) =>
        old ? { ...old, sidebarTheme: persistedTheme } : { sidebarTheme: persistedTheme },
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedTheme]);

  const applyClinicPreview = (themeId: string) => {
    setActiveClinicTheme(themeId);
    setUnsaved(themeId !== persistedTheme);
    qc.setQueryData(["clinic-settings-public"], (old: Record<string, unknown> | undefined) =>
      old ? { ...old, sidebarTheme: themeId } : { sidebarTheme: themeId },
    );
  };

  const saveClinic = useMutation({
    mutationFn: (sidebarTheme: string) => api.put("/api/clinic-settings", { sidebarTheme }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      qc.invalidateQueries({ queryKey: ["clinic-settings-public"] });
      setUnsaved(false);
      toast({ title: "Clinic default theme saved" });
    },
    onError: (e: Error) => {
      qc.setQueryData(["clinic-settings-public"], (old: Record<string, unknown> | undefined) =>
        old ? { ...old, sidebarTheme: persistedTheme } : { sidebarTheme: persistedTheme },
      );
      setActiveClinicTheme(persistedTheme);
      setUnsaved(false);
      toast({ variant: "destructive", title: "Error", description: e.message });
    },
  });

  return (
    <div className="max-w-2xl space-y-6">
      {/* My personal theme */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Palette size={16} /> My Sidebar Theme</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a color just for you — this only affects your own session on this device and overrides the clinic default.
            You can also change it any time with the <span className="inline-flex items-center gap-1 font-medium"><Palette size={12} /></span> button at the bottom of the sidebar.
          </p>
        </div>

        <ThemeGrid themes={SIDEBAR_THEME_PRESETS} activeId={myActiveTheme} onSelect={applyMyTheme} />

        {/* Custom color picker */}
        <CustomColorPicker
          activeId={myActiveTheme}
          onSelect={applyMyTheme}
        />

        {userTheme && (
          <div className="flex items-center justify-between pt-2 border-t border-card-border">
            <span className="text-xs text-muted-foreground">You have a personal preference set.</span>
            <Button variant="outline" size="sm" type="button" onClick={resetToClinicDefault}>
              Reset to clinic default
            </Button>
          </div>
        )}
      </div>

      {/* Sidebar behaviour (localStorage, per-device) */}
      <SidebarBehaviourCard />

      {/* Billing desk layout toggle */}
      <BillingDeskLayoutCard />

      {/* Clinic-wide default (admin only) */}
      {isAdmin && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2"><Palette size={16} /> Clinic Default Theme</h2>
            <p className="text-sm text-muted-foreground mt-1">Sets the default for all staff who have not chosen their own theme. Requires Admin or Super Admin role.</p>
          </div>

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <ThemeGrid themes={SIDEBAR_THEME_PRESETS} activeId={activeClinicTheme} onSelect={applyClinicPreview} />
              <CustomColorPicker
                activeId={activeClinicTheme}
                onSelect={applyClinicPreview}
              />
            </>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-card-border">
            {unsaved && (
              <span className="text-xs text-muted-foreground">Unsaved preview — click Save to keep this theme.</span>
            )}
            <div className="ml-auto flex gap-2">
              {unsaved && (
                <Button variant="outline" type="button" onClick={() => applyClinicPreview(persistedTheme)} disabled={saveClinic.isPending}>
                  Discard
                </Button>
              )}
              <Button
                onClick={() => saveClinic.mutate(activeClinicTheme)}
                disabled={saveClinic.isPending || !unsaved}
              >
                {saveClinic.isPending ? "Saving…" : "Save Clinic Default"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClinicInfoTab() {
  const qc = useQueryClient();
  const { data: settings, isLoading, error } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<ClinicSettings | null>(null);
  const [uploadErr, setUploadErr] = useState("");
  const [billLayout, setBillLayoutLocal] = useState<BillLayout>(() => getBillPrintLayout());

  const current = form ?? settings ?? null;

  const { toast } = useToast();
  const save = useMutation({
    mutationFn: (body: ClinicSettings) => {
      // Strip billing-desk-owned JSON fields so the Clinic Info tab doesn't
      // accidentally clobber quick-test or Form-F test assignments saved by
      // other specialised tabs / the Billing Desk.
      const { quickTestIds, formFTestIds, ...rest } = body as Record<string, unknown>;
      return api.put("/api/clinic-settings", rest);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      setForm(saved as ClinicSettings);
      toast({ title: "Saved", description: "Clinic settings updated successfully." });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading clinic info…</div>;
  }
  if (error) {
    return (
      <div className="bg-card border border-red-200 dark:border-red-800 rounded-xl p-8 text-center">
        <AlertTriangle className="mx-auto mb-2 text-red-500" size={28} />
        <p className="text-red-700 dark:text-red-300 font-semibold">Failed to load clinic settings</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-1">{error instanceof Error ? error.message : "Network error"}</p>
        <Button variant="outline" className="mt-3" onClick={() => qc.invalidateQueries({ queryKey: ["clinic-settings"] })}>Retry</Button>
      </div>
    );
  }

  const onLogoChange = (file: File | null) => {
    setUploadErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadErr("Please upload an image file"); return; }
    if (file.size > 1_500_000) { setUploadErr("Image too large (max 1.5 MB). Use a smaller logo."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setForm({ ...(current as ClinicSettings), logoDataUrl: String(reader.result) });
    };
    reader.readAsDataURL(file);
  };

  if (!current) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">No clinic info available. Please save settings first.</div>;
  }

  const update = (k: keyof ClinicSettings, v: string) => setForm({ ...current, [k]: v });

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg">Hospital / Diagnostic Center Details</h2>
          <p className="text-sm text-muted-foreground">These details appear on every printed bill and report.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Center Name *</Label>
            <Input value={current.name} onChange={(e) => update("name", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Tagline / Sub-title</Label>
            <Input value={current.tagline} onChange={(e) => update("tagline", e.target.value)} className="mt-1" placeholder="e.g. Diagnostic & Pathology Services" />
          </div>
          <div className="md:col-span-2">
            <Label>Address (Work / Operational)</Label>
            <Input value={current.address} onChange={(e) => update("address", e.target.value)} className="mt-1" placeholder="Full work address" />
          </div>
          <div className="md:col-span-2">
            <Label>Registered Address (Legal / Compliance)</Label>
            <Input value={current.registeredAddress} onChange={(e) => update("registeredAddress", e.target.value)} className="mt-1" placeholder="Full registered address for legal documents" />
          </div>
          <div>
            <Label>Mobile / Phone Number</Label>
            <Input value={current.phone} onChange={(e) => update("phone", e.target.value)} className="mt-1" placeholder="+91 ..." />
          </div>
          <div>
            <Label>Email Id</Label>
            <Input type="email" value={current.email} onChange={(e) => update("email", e.target.value)} className="mt-1" placeholder="info@example.com" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={current.website} onChange={(e) => update("website", e.target.value)} className="mt-1" placeholder="www.example.com" />
          </div>
          <div>
            <Label>GSTIN / Tax No.</Label>
            <Input value={current.gstin} onChange={(e) => update("gstin", e.target.value)} className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label>Bill Footer Note</Label>
            <Input value={current.footerNote} onChange={(e) => update("footerNote", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Auto-print Day-Close summary slip</Label>
            <button
              type="button"
              onClick={() => setForm({ ...current, dayCloseAutoPrint: !(current.dayCloseAutoPrint ?? true) })}
              className={`mt-1 w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${(current.dayCloseAutoPrint ?? true) ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">{(current.dayCloseAutoPrint ?? true) ? "Enabled" : "Disabled"}</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(current.dayCloseAutoPrint ?? true) ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${(current.dayCloseAutoPrint ?? true) ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
            <p className="text-xs text-muted-foreground mt-1">When enabled, closing the day prints a summary slip on the bill printer right after save.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button variant="outline" type="button" onClick={() => setForm(settings ?? null)}>Reset</Button>
          <Button onClick={() => save.mutate(current)} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2"><User2 size={16} /> Patient Photo Capture</h2>
            <p className="text-sm text-muted-foreground">Allow uploading a photograph for each patient (stored in DB, &lt; 1.5 MB each).</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...current, patientPhotoEnabled: !current.patientPhotoEnabled })}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.patientPhotoEnabled ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
          >
            <span className="text-sm font-medium">{current.patientPhotoEnabled ? "Enabled" : "Disabled"}</span>
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.patientPhotoEnabled ? "bg-green-500" : "bg-muted-foreground/40"}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.patientPhotoEnabled ? "translate-x-5" : "translate-x-1"}`} />
            </span>
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            When enabled, the New Patient form shows a photo upload field and the patient profile displays the photograph. Click <strong>Save Changes</strong> to apply.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">🖨️ Bill Print Copies</h2>
            <p className="text-sm text-muted-foreground">How many copies of each bill to print per print job. Use 2 if you keep one for the patient and one for the clinic file.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2].map((n) => {
              const active = (current.billPrintCopies ?? 1) === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm({ ...current, billPrintCopies: n })}
                  className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${active ? "bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300" : "bg-muted/30 border-card-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {n} {n === 1 ? "Copy" : "Copies"}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Click <strong>Save Changes</strong> after choosing to apply.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">⏱️ Show TAT on Bill</h2>
            <p className="text-sm text-muted-foreground">When enabled, the printed bill shows a "TAT" (turnaround time) column with each test's expected duration.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...current, showTatOnBill: !current.showTatOnBill })}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.showTatOnBill ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
          >
            <span className="text-sm font-medium">{current.showTatOnBill ? "Enabled" : "Disabled"}</span>
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.showTatOnBill ? "bg-green-500" : "bg-muted-foreground/40"}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.showTatOnBill ? "translate-x-5" : "translate-x-1"}`} />
            </span>
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Click <strong>Save Changes</strong> after toggling to apply.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">📄 Bill Print Format</h2>
            <p className="text-sm text-muted-foreground">Control what appears on the printed bill receipt — paper size, columns, and layout.</p>
          </div>
          {/* Default paper size */}
          <div>
            <p className="text-sm font-medium mb-2">Default Paper Size</p>
            <div className="grid grid-cols-2 gap-3">
              {(["A5", "A4"] as const).map((sz) => {
                const active = (current.billDefaultPaperSize ?? "A5") === sz;
                return (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setForm({ ...current, billDefaultPaperSize: sz })}
                    className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${active ? "bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300" : "bg-muted/30 border-card-border text-muted-foreground hover:bg-muted/50"}`}
                  >
                    {sz} {sz === "A5" ? "(recommended)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Show test code */}
          <div>
            <p className="text-sm font-medium mb-1">Show Test Code Column</p>
            <button
              type="button"
              onClick={() => setForm({ ...current, billShowCode: !(current.billShowCode ?? true) })}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${(current.billShowCode ?? true) ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">{(current.billShowCode ?? true) ? "Shown" : "Hidden"}</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(current.billShowCode ?? true) ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${(current.billShowCode ?? true) ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          {/* Show category */}
          <div>
            <p className="text-sm font-medium mb-1">Show Category Column</p>
            <button
              type="button"
              onClick={() => setForm({ ...current, billShowCategory: !(current.billShowCategory ?? true) })}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${(current.billShowCategory ?? true) ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">{(current.billShowCategory ?? true) ? "Shown" : "Hidden"}</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(current.billShowCategory ?? true) ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${(current.billShowCategory ?? true) ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          {/* Receipt Layout Style */}
          <div>
            <p className="text-sm font-medium mb-1">Receipt Layout Style</p>
            <p className="text-xs text-muted-foreground mb-3">Choose how the printed bill looks. Saved instantly on this device — no Save required.</p>
            <div className="grid grid-cols-3 gap-3">
              {BILL_LAYOUTS.map((preset) => {
                const active = billLayout === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => { setBillLayoutLocal(preset.id); setBillPrintLayout(preset.id); }}
                    className={`rounded-lg border p-2 text-left transition-all ${active ? "border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900" : "border-card-border hover:border-muted-foreground/40"}`}
                  >
                    {/* Mini dummy bill preview */}
                    <div className="w-full rounded overflow-hidden border border-border mb-2" style={{ background: "#fff", fontFamily: "Arial, sans-serif", fontSize: "4px", lineHeight: 1.4, color: "#222" }}>
                      {/* Header bar */}
                      <div style={{
                        borderBottom: preset.id === "classic" ? "2px solid #1e40af" : preset.id === "compact" ? "2px solid #111" : "1px solid #888",
                        padding: "4px 5px 3px",
                        display: "flex", alignItems: "flex-start", gap: 3, justifyContent: "space-between",
                      }}>
                        <div>
                          <div style={{ fontSize: "6px", fontWeight: 800, color: preset.id === "classic" ? "#1e40af" : "#111" }}>CARE DIAGNOSTICS</div>
                          <div style={{ fontSize: "4px", color: "#666" }}>Subhash Chowk, Castair's Town, Near Bajla Mahila College</div>
                          <div style={{ fontSize: "4px", color: "#666" }}>Ph: 9973497200</div>
                        </div>
                        <div style={{ width: 12, height: 12, background: "#f0f0f0", border: "1px solid #ccc", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 3, color: "#999" }}>QR</div>
                      </div>
                      {/* Bill title + patient */}
                      <div style={{ padding: "2px 5px", borderBottom: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: "5px", fontWeight: 700, letterSpacing: "0.5px" }}>INVOICE / RECEIPT</div>
                        <div style={{ fontSize: "4px", color: "#444" }}>AJMAL KHAN · 38 YRS / M</div>
                        <div style={{ fontSize: "4px", color: "#666" }}>Ref: Self / Walk-in · Bill: 2026050206</div>
                      </div>
                      {/* Tests table */}
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "4px" }}>
                        <thead>
                          <tr style={{
                            background: preset.id === "classic" ? "#1e40af" : preset.id === "compact" ? "#f0f0f0" : "transparent",
                            color: preset.id === "classic" ? "#fff" : "#111",
                            borderBottom: preset.id === "minimal" ? "1px solid #888" : "none",
                          }}>
                            <th style={{ padding: "2px 4px", textAlign: "left", fontWeight: 600 }}>#</th>
                            <th style={{ padding: "2px 4px", textAlign: "left", fontWeight: 600 }}>Test Name</th>
                            <th style={{ padding: "2px 4px", textAlign: "right", fontWeight: 600 }}>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {["USG WHOLE ABDOMEN", "BLOOD COUNT"].map((name, i) => (
                            <tr key={name} style={{
                              background: preset.id === "classic" ? (i % 2 === 0 ? "#f8fafc" : "#fff") : "#fff",
                              borderBottom: preset.id === "minimal" ? "1px solid #eee" : preset.id === "compact" ? "1px solid #bbb" : "1px solid #e2e8f0",
                            }}>
                              <td style={{ padding: "1.5px 4px" }}>{i + 1}</td>
                              <td style={{ padding: "1.5px 4px", fontWeight: 600 }}>{name}</td>
                              <td style={{ padding: "1.5px 4px", textAlign: "right" }}>₹{i === 0 ? "1,500" : "350"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Total row */}
                      <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 4px" }}>
                        <table style={{ fontSize: "4px", borderCollapse: "collapse" }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: "1px 4px", color: "#666" }}>Subtotal</td>
                              <td style={{ padding: "1px 4px", textAlign: "right" }}>₹1,850.00</td>
                            </tr>
                            <tr style={{
                              background: preset.id === "classic" ? "#1e40af" : preset.id === "compact" ? "#e8e8e8" : "transparent",
                              color: preset.id === "classic" ? "#fff" : "#111",
                              fontWeight: 700,
                              borderTop: preset.id === "minimal" ? "1.5px solid #555" : preset.id === "compact" ? "1px solid #999" : "none",
                            }}>
                              <td style={{ padding: "2px 4px" }}>Total</td>
                              <td style={{ padding: "2px 4px", textAlign: "right" }}>₹1,850.00</td>
                            </tr>
                            <tr>
                              <td style={{ padding: "1px 4px", color: "#16a34a" }}>Paid</td>
                              <td style={{ padding: "1px 4px", textAlign: "right", color: "#16a34a" }}>₹1,850.00</td>
                            </tr>
                            <tr style={{ fontWeight: 700, color: "#16a34a", borderTop: "1px solid #ddd" }}>
                              <td style={{ padding: "1.5px 4px" }}>Balance</td>
                              <td style={{ padding: "1.5px 4px", textAlign: "right" }}>₹0.00</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {/* Footer */}
                      <div style={{ borderTop: "1px dashed #ccc", padding: "2px 4px", textAlign: "center", color: "#999", fontSize: "3.5px" }}>
                        Thank you for choosing our services. · Computer-generated invoice.
                      </div>
                    </div>
                    <div className={`text-xs font-semibold ${active ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}>{preset.label}</div>
                    <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">{preset.description}</div>
                    {active && <div className="mt-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400">✓ Active</div>}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Layout applies immediately to new prints. Click <strong>Save Changes</strong> after adjusting paper size / columns.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">🔳 Print QR on Bill</h2>
            <p className="text-sm text-muted-foreground">When enabled, every printed bill receipt embeds a small "Scan to verify" QR code linking to the bill verification page. This replaces the old separate "QR Bill" print button.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...current, qrOnBillEnabled: !(current.qrOnBillEnabled ?? true) })}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${(current.qrOnBillEnabled ?? true) ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
          >
            <span className="text-sm font-medium">{(current.qrOnBillEnabled ?? true) ? "Enabled" : "Disabled"}</span>
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${(current.qrOnBillEnabled ?? true) ? "bg-green-500" : "bg-muted-foreground/40"}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${(current.qrOnBillEnabled ?? true) ? "translate-x-5" : "translate-x-1"}`} />
            </span>
          </button>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Click <strong>Save Changes</strong> after toggling to apply.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2"><ImageIcon size={16} /> Logo</h2>
            <p className="text-sm text-muted-foreground">Recommended: square or wide PNG/JPG, &lt; 1.5 MB.</p>
          </div>
        <div className="border-2 border-dashed border-card-border rounded-lg p-4 flex items-center justify-center bg-muted/30 min-h-[180px]">
          {current.logoDataUrl ? (
            <img src={current.logoDataUrl} alt="Logo preview" className="max-h-40 max-w-full object-contain" />
          ) : (
            <div className="text-center text-muted-foreground text-sm">
              <ImageIcon size={36} className="mx-auto mb-2 opacity-30" />
              No logo uploaded
            </div>
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onLogoChange(e.target.files?.[0] ?? null)}
          className="hidden"
          id="clinic-logo-input"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => { document.getElementById("clinic-logo-input")?.click(); }}
          className="w-full"
        >
          <Upload size={14} className="mr-2" /> Choose Logo Image
        </Button>
        {current.logoDataUrl && (
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => setForm({ ...current, logoDataUrl: null })}
          >
            <Trash2 size={14} className="mr-2" /> Remove Logo
          </Button>
        )}
        {uploadErr && <p className="text-xs text-destructive">{uploadErr}</p>}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Click <strong>Save Changes</strong> after selecting a logo.
        </p>
        </div>
      </div>
    </div>
  );
}

type PortalConfig = {
  portalEnabled: boolean;
  portalHeading: string;
  portalWelcomeMessage: string;
  portalAllowAppointmentBooking: boolean;
  portalAllowProfileEdit: boolean;
  name: string;
};

function PatientPortalTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PortalConfig>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<PortalConfig | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<PortalConfig>) => api.put("/api/clinic-settings", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clinic-settings"] }),
  });

  if (isLoading || !form) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading…</div>;
  }

  const portalUrl = `${window.location.origin}${import.meta.env.BASE_URL || "/"}portal`.replace(/\/+/g, "/").replace(":/", "://");

  const Toggle = ({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint: string }) => (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full text-left flex items-start justify-between gap-3 px-4 py-3 rounded-lg border transition-colors ${value ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 shrink-0 ${value ? "bg-green-500" : "bg-muted-foreground/40"}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
            <Globe size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-lg">Public Patient Portal</h2>
            <p className="text-sm text-muted-foreground mt-1">
              A simple, mobile-friendly web page where your patients can sign in with their mobile number to view bills, lab reports, book appointments, and update their profile. Staff can also sign in to access the main system.
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: enable + URL */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div>
              <h3 className="font-bold">Status</h3>
              <p className="text-xs text-muted-foreground">Turn the public portal on or off.</p>
            </div>
            <Toggle
              value={form.portalEnabled}
              onChange={(v) => setForm({ ...form, portalEnabled: v })}
              label={form.portalEnabled ? "Portal is ON — visible to public" : "Portal is OFF — hidden"}
              hint={form.portalEnabled ? "Anyone with the link can access the portal" : "Visiting the link will show 'Portal Not Available'"}
            />
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div>
              <h3 className="font-bold">Share Link</h3>
              <p className="text-xs text-muted-foreground">Give this link to your patients (print on bills, send via SMS / WhatsApp).</p>
            </div>
            <div className="flex items-center gap-2 bg-muted/50 border border-card-border rounded-lg p-2">
              <code className="flex-1 text-xs truncate font-mono">{portalUrl}</code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => { navigator.clipboard.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                title="Copy link"
              >
                {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.open(portalUrl, "_blank")}
            >
              <ExternalLink size={14} className="mr-2" /> Open Portal in new tab
            </Button>
          </div>
        </div>

        {/* Right: customization */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-bold">Page Customization</h3>
              <p className="text-xs text-muted-foreground">What patients see when they open the portal.</p>
            </div>
            <div>
              <Label>Heading</Label>
              <Input
                value={form.portalHeading}
                onChange={(e) => setForm({ ...form, portalHeading: e.target.value })}
                placeholder={form.name || "e.g. CARE Diagnostics — Patient Portal"}
                className="mt-1"
                maxLength={120}
              />
              <p className="text-[11px] text-muted-foreground mt-1">If left blank, your clinic name will be used.</p>
            </div>
            <div>
              <Label>Welcome Message</Label>
              <textarea
                value={form.portalWelcomeMessage}
                onChange={(e) => setForm({ ...form, portalWelcomeMessage: e.target.value })}
                placeholder="e.g. Access your lab reports, bills and appointment bookings — anytime, anywhere."
                rows={3}
                maxLength={500}
                className="w-full mt-1 rounded-md border border-card-border bg-background px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">{form.portalWelcomeMessage.length}/500 characters. Shown below the heading.</p>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div>
              <h3 className="font-bold">Patient Permissions</h3>
              <p className="text-xs text-muted-foreground">Control what logged-in patients can do.</p>
            </div>
            <Toggle
              value={form.portalAllowAppointmentBooking}
              onChange={(v) => setForm({ ...form, portalAllowAppointmentBooking: v })}
              label="Allow appointment booking"
              hint="Patients can self-book new appointments online."
            />
            <Toggle
              value={form.portalAllowProfileEdit}
              onChange={(v) => setForm({ ...form, portalAllowProfileEdit: v })}
              label="Allow patients to edit their profile"
              hint="Patients can update name, mobile, email, address, blood group themselves."
            />
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Login methods</p>
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-disc pl-4">
              <li><strong>Patients</strong> sign in with their <strong>registered mobile number</strong> only — make sure each patient's phone in your records is correct.</li>
              <li><strong>Staff</strong> sign in with their <strong>work email + PIN</strong> (set under the Users tab). After login they're taken to the main system.</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => data && setForm(data)} disabled={save.isPending}>Reset</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Online Booking + Payment Gateway Settings ────────────────────────────────
type OnlineBookingSettings = {
  onlineBookingEnabled: boolean;
  vipQueueEnabled: boolean;
  razorpayKeyId: string;
  onlineBookingLedgerId: number;
  payuEnabled: boolean;
  payuMerchantKey: string;
  phonepeEnabled: boolean;
  phonepeMerchantId: string;
  bharatpeEnabled: boolean;
  bharatpeMerchantId: string;
  cashfreeEnabled: boolean;
  cashfreeAppId: string;
  iciciEnabled: boolean;
  iciciMerchantId: string;
  iciciAggregatorId: string;
  iciciSecretKey: string;
  upiQrEnabled: boolean;
  upiVpa: string;
  upiQrImageUrl: string;
  onlineBookingAllowedTestIds: string;
  onlineBookingAllowedPackageIds: string;
  // New fields added
  onlineBookingServices?: string;
  serviceImages?: string;
  serviceImagesEnabled?: boolean;
  vipPercentage?: string;
  disclaimerText?: string;
  disclaimerRefundPercentage?: number;
  disclaimerCancellationWindowHours?: number;
  disclaimerDisplayPosition?: string;
  disclaimerFontSize?: string;
  disclaimerEnabled?: boolean;
  queueVipMode?: string;
  queuePrivacyMode?: string;
  queueEstimatedWaitPerPatient?: number;
};

type OBTest = { id: number; name: string; code: string; category: string; isActive: boolean };
type OBPkg = { id: number; name: string; packageCode: string; price: number; isActive: boolean };

function OnlineBookingCatalogSelector({
  form,
  setForm,
  save,
}: {
  form: OnlineBookingSettings;
  setForm: React.Dispatch<React.SetStateAction<OnlineBookingSettings | null>>;
  save: ReturnType<typeof useMutation<unknown, Error, OnlineBookingSettings>>;
}) {
  const [testSearch, setTestSearch] = useState("");
  const [pkgSearch, setPkgSearch] = useState("");

  const { data: tests = [], isLoading: testsLoading } = useQuery<OBTest[]>({
    queryKey: ["tests-all-ob"],
    queryFn: () => api.get<{ tests: OBTest[] }>("/api/tests?limit=500").then((d) => d.tests ?? []),
  });
  const { data: pkgs = [], isLoading: pkgsLoading } = useQuery<OBPkg[]>({
    queryKey: ["packages-all-ob"],
    queryFn: () => api.get<OBPkg[]>("/api/packages"),
  });

  const allowedTestIds = useMemo(() => {
    try { return new Set<number>(JSON.parse(form.onlineBookingAllowedTestIds || "[]")); }
    catch { return new Set<number>(); }
  }, [form.onlineBookingAllowedTestIds]);

  const allowedPkgIds = useMemo(() => {
    try { return new Set<number>(JSON.parse(form.onlineBookingAllowedPackageIds || "[]")); }
    catch { return new Set<number>(); }
  }, [form.onlineBookingAllowedPackageIds]);

  const activeTests = tests.filter((t) => t.isActive !== false);
  const filteredTests = activeTests.filter((t) => {
    if (!testSearch.trim()) return true;
    const q = testSearch.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  });

  const activePkgs = pkgs.filter((p) => p.isActive !== false);
  const filteredPkgs = activePkgs.filter((p) => {
    if (!pkgSearch.trim()) return true;
    const q = pkgSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.packageCode ?? "").toLowerCase().includes(q);
  });

  const byCategory: Record<string, OBTest[]> = {};
  for (const t of filteredTests) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  const toggleTest = (id: number) => {
    const next = new Set(allowedTestIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setForm((prev) => prev && { ...prev, onlineBookingAllowedTestIds: JSON.stringify([...next]) });
  };

  const toggleAllTests = (selectAll: boolean) => {
    const next = new Set<number>();
    if (selectAll) {
      activeTests.forEach((t) => next.add(t.id));
    }
    setForm((prev) => prev && { ...prev, onlineBookingAllowedTestIds: JSON.stringify([...next]) });
  };

  const togglePkg = (id: number) => {
    const next = new Set(allowedPkgIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setForm((prev) => prev && { ...prev, onlineBookingAllowedPackageIds: JSON.stringify([...next]) });
  };

  const toggleAllPkgs = (selectAll: boolean) => {
    const next = new Set<number>();
    if (selectAll) {
      activePkgs.forEach((p) => next.add(p.id));
    }
    setForm((prev) => prev && { ...prev, onlineBookingAllowedPackageIds: JSON.stringify([...next]) });
  };

  if (testsLoading || pkgsLoading) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground animate-pulse">Loading catalog…</div>;
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <ClipboardList size={16} className="text-primary" />
            Online Booking Catalog
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pick which tests and packages patients can book online.
            When <strong>none are selected</strong>, all active tests/packages are shown on the website.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-primary">{allowedTestIds.size} test(s), {allowedPkgIds.size} package(s)</span>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} size="sm">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {save.isSuccess && (
        <div className="text-xs text-green-600 font-medium">✓ Catalog whitelist saved successfully.</div>
      )}

      {/* Tests */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <FlaskConical size={14} className="text-muted-foreground" />
            <span className="font-semibold text-sm">Tests</span>
            <span className="text-xs text-muted-foreground">({activeTests.length} active)</span>
          </div>
          {activeTests.length > 0 && (() => {
            const isIndeterminate = allowedTestIds.size > 0 && allowedTestIds.size < activeTests.length;
            const isChecked = allowedTestIds.size === activeTests.length && activeTests.length > 0;
            return (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-primary hover:underline">
                <input
                  ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={isChecked}
                  onChange={(e) => toggleAllTests(e.target.checked)}
                />
                Select All
              </label>
            );
          })()}
        </div>
        <div className="relative mb-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tests…"
            value={testSearch}
            onChange={(e) => setTestSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        {Object.keys(byCategory).length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tests found.</p>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{cat}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {items.map((t) => (
                    <label key={t.id} className="flex items-start gap-2 p-2 rounded-lg border border-card-border cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-primary w-4 h-4"
                        checked={allowedTestIds.has(t.id)}
                        onChange={() => toggleTest(t.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.code}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Packages */}
      {activePkgs.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <Boxes size={14} className="text-muted-foreground" />
              <span className="font-semibold text-sm">Packages</span>
              <span className="text-xs text-muted-foreground">({activePkgs.length} active)</span>
            </div>
            {activePkgs.length > 0 && (() => {
              const isIndeterminate = allowedPkgIds.size > 0 && allowedPkgIds.size < activePkgs.length;
              const isChecked = allowedPkgIds.size === activePkgs.length && activePkgs.length > 0;
              return (
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-primary hover:underline">
                  <input
                    ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                    type="checkbox"
                    className="w-4 h-4 accent-primary"
                    checked={isChecked}
                    onChange={(e) => toggleAllPkgs(e.target.checked)}
                  />
                  Select All
                </label>
              );
            })()}
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search packages…"
              value={pkgSearch}
              onChange={(e) => setPkgSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
            {filteredPkgs.map((p) => (
              <label key={p.id} className="flex items-start gap-2 p-2 rounded-lg border border-card-border cursor-pointer hover:bg-muted/40 transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary w-4 h-4"
                  checked={allowedPkgIds.has(p.id)}
                  onChange={() => togglePkg(p.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground">₹{Number(p.price).toLocaleString("en-IN")}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OnlineBookingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [logSearch, setLogSearch] = useState("");
  const [logStatusFilter, setLogStatusFilter] = useState("all");
  const { data: bookingsData, isLoading: isLoadingBookings } = useQuery<{ bookings: any[] }>({
    queryKey: ["online-bookings-logs"],
    queryFn: () => api.get("/api/online-bookings?limit=100"),
  });
  const { data, isLoading } = useQuery<OnlineBookingSettings & { ledgers?: { id: number; name: string }[]; whatsappNumber?: string }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const { data: ledgersData } = useQuery<{ ledgers: { id: number; name: string }[] }>({
    queryKey: ["ledgers"],
    queryFn: () => api.get("/api/ledgers"),
  });
  const [form, setForm] = useState<OnlineBookingSettings | null>(null);
  const bookingQrUrl = useMemo(() => {
    const number = (data?.whatsappNumber || "").replace(/[^0-9]/g, "");
    if (!number) return "";
    return `https://wa.me/${number}?text=${encodeURIComponent("Hi, I want to book an appointment.")}`;
  }, [data?.whatsappNumber]);
  useEffect(() => {
    if (data) setForm({
      onlineBookingEnabled: data.onlineBookingEnabled,
      vipQueueEnabled: data.vipQueueEnabled,
      razorpayKeyId: data.razorpayKeyId || "",
      onlineBookingLedgerId: data.onlineBookingLedgerId || 1,
      payuEnabled: data.payuEnabled ?? false,
      payuMerchantKey: data.payuMerchantKey || "",
      phonepeEnabled: data.phonepeEnabled ?? false,
      phonepeMerchantId: data.phonepeMerchantId || "",
      bharatpeEnabled: data.bharatpeEnabled ?? false,
      bharatpeMerchantId: data.bharatpeMerchantId || "",
      cashfreeEnabled: data.cashfreeEnabled ?? false,
      cashfreeAppId: data.cashfreeAppId || "",
      iciciEnabled: data.iciciEnabled ?? false,
      iciciMerchantId: data.iciciMerchantId || "",
      iciciAggregatorId: data.iciciAggregatorId || "",
      iciciSecretKey: data.iciciSecretKey || "",
      upiQrEnabled: data.upiQrEnabled ?? false,
      upiVpa: data.upiVpa || "",
      upiQrImageUrl: data.upiQrImageUrl || "",
      onlineBookingAllowedTestIds: data.onlineBookingAllowedTestIds || "[]",
      onlineBookingAllowedPackageIds: data.onlineBookingAllowedPackageIds || "[]",
      onlineBookingServices: data.onlineBookingServices || "{}",
      serviceImages: data.serviceImages || "{}",
      serviceImagesEnabled: data.serviceImagesEnabled ?? false,
      vipPercentage: data.vipPercentage || "50.00",
      disclaimerText: data.disclaimerText || "",
      disclaimerRefundPercentage: data.disclaimerRefundPercentage ?? 90,
      disclaimerCancellationWindowHours: data.disclaimerCancellationWindowHours ?? 24,
      disclaimerDisplayPosition: data.disclaimerDisplayPosition || "bottom",
      disclaimerFontSize: data.disclaimerFontSize || "sm",
      disclaimerEnabled: data.disclaimerEnabled ?? true,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: OnlineBookingSettings) => api.put("/api/clinic-settings", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clinic-settings"] }); toast({ title: "Online booking settings saved" }); },
    onError: (err: any) => toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (isLoading || !form) return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading…</div>;

  const Toggle = ({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint: string }) => (
    <button type="button" onClick={() => onChange(!value)} className={`w-full text-left flex items-start justify-between gap-3 px-4 py-3 rounded-lg border transition-colors ${value ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}>
      <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground mt-0.5">{hint}</p></div>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 shrink-0 ${value ? "bg-green-500" : "bg-muted-foreground/40"}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
      </span>
    </button>
  );

  const ledgers = ledgersData?.ledgers ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-200 dark:border-indigo-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <CreditCard size={20} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Online Booking & Payment Gateway</h2>
            <p className="text-sm text-muted-foreground mt-1">Allow patients to book tests and pay online via your clinic website. Configure Orange Pay (ICICI) below.</p>
          </div>
        </div>
      </div>

      {/* Toggles */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
        <h3 className="font-bold">Booking Features</h3>
        <Toggle value={form.onlineBookingEnabled} onChange={(v) => setForm({ ...form, onlineBookingEnabled: v })} label="Online Booking enabled" hint="Shows the Book Now form on your clinic website and activates payment collection." />
        <Toggle value={form.vipQueueEnabled} onChange={(v) => setForm({ ...form, vipQueueEnabled: v })} label="VIP Queue enabled" hint="Allows patients to pay a VIP surcharge for priority queue placement." />
      </div>

      {/* Phase 4: Granular Service Selection */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold">Service Visibility</h3>
        <p className="text-xs text-muted-foreground">Select which types of services are available for public online bookings.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(() => {
            let svcs: Record<string, boolean> = {};
            try {
              svcs = JSON.parse(form.onlineBookingServices || "{}");
            } catch {
              // fallback
            }
            const SERVICE_LABELS: Record<string, string> = {
              opd: "OPD Consultation",
              emergency: "Emergency Services",
              usg: "Ultrasound (USG)",
              xray: "Digital X-Ray",
              ct: "CT Scan",
              mri: "MRI Scan",
              pathology: "Pathology Tests",
              packages: "Health Packages",
              home_collection: "Home Collection",
              doctor: "Doctor Consultation",
            };
            return Object.entries(SERVICE_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm border p-3 rounded-lg hover:bg-muted/20 cursor-pointer">
                <input
                  type="checkbox"
                  checked={svcs[key] !== false}
                  onChange={(e) => {
                    const nextSvcs = { ...svcs, [key]: e.target.checked };
                    setForm({ ...form, onlineBookingServices: JSON.stringify(nextSvcs) });
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                />
                <span>{label}</span>
              </label>
            ));
          })()}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* Phase 5: Service Faded Background Images (Photo Tiles) */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold flex items-center gap-2"><ImageIcon size={16} /> Service Photo Tiles</h3>
        <Toggle
          value={!!form.serviceImagesEnabled}
          onChange={(v) => setForm({ ...form, serviceImagesEnabled: v })}
          label="Enable Service Photo Tiles"
          hint="When enabled, service selection cards will use the custom background images defined below instead of generic colors."
        />
        <div className="space-y-3 pt-2">
          {(() => {
            let imgs: Record<string, string> = {};
            try {
              imgs = JSON.parse(form.serviceImages || "{}");
            } catch {
              // fallback
            }
            const SERVICE_LABELS: Record<string, string> = {
              opd: "OPD Consultation",
              emergency: "Emergency",
              usg: "Ultrasound",
              xray: "X-Ray",
              ct: "CT Scan",
              mri: "MRI Scan",
              pathology: "Pathology",
              packages: "Health Packages",
              home_collection: "Home Collection",
              doctor: "Doctor Consultation",
            };
            return Object.entries(SERVICE_LABELS).map(([key, label]) => (
              <div key={key} className="grid grid-cols-3 gap-3 items-center">
                <span className="text-sm font-medium">{label} URL</span>
                <Input
                  className="col-span-2 text-xs font-mono"
                  placeholder="https://images.unsplash.com/... or local path"
                  value={imgs[key] || ""}
                  onChange={(e) => {
                    const nextImgs = { ...imgs, [key]: e.target.value };
                    setForm({ ...form, serviceImages: JSON.stringify(nextImgs) });
                  }}
                />
              </div>
            ));
          })()}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* Phase 6: VIP Percentage Surcharge */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold">VIP Priority Booking Premium</h3>
        <p className="text-xs text-muted-foreground">Specify the premium markup percentage added to the booking amount when a user selects VIP queue priority.</p>
        <div className="flex items-center gap-3 max-w-xs">
          <Input
            type="number"
            min="0"
            max="500"
            step="0.01"
            value={form.vipPercentage || "50.00"}
            onChange={(e) => setForm({ ...form, vipPercentage: e.target.value })}
            className="font-mono"
          />
          <span className="text-sm font-medium">%</span>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* Phase 7: Disclaimer Config */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold">Cancellation Policy & Booking Disclaimer</h3>
        <Toggle
          value={!!form.disclaimerEnabled}
          onChange={(v) => setForm({ ...form, disclaimerEnabled: v })}
          label="Enable Booking Disclaimer / Policy Block"
          hint="Displays standard regulatory and cancellation messages during checkout review."
        />
        {form.disclaimerEnabled && (
          <div className="space-y-4 pt-2">
            <div>
              <Label>Policy Disclaimer Text</Label>
              <Textarea
                rows={3}
                value={form.disclaimerText || ""}
                onChange={(e) => setForm({ ...form, disclaimerText: e.target.value })}
                className="mt-1 text-sm"
                placeholder="Enter cancellation policy details here..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Refund Percentage (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={form.disclaimerRefundPercentage ?? 90}
                  onChange={(e) => setForm({ ...form, disclaimerRefundPercentage: Number(e.target.value) })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Cancellation Window (Hours)</Label>
                <Input
                  type="number"
                  min="1"
                  max="720"
                  value={form.disclaimerCancellationWindowHours ?? 24}
                  onChange={(e) => setForm({ ...form, disclaimerCancellationWindowHours: Number(e.target.value) })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Display Position</Label>
                <Select
                  value={form.disclaimerDisplayPosition || "bottom"}
                  onValueChange={(v) => setForm({ ...form, disclaimerDisplayPosition: v })}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">Top (Before Selection)</SelectItem>
                    <SelectItem value="bottom">Bottom (Standard Review)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Font Size</Label>
                <Select
                  value={form.disclaimerFontSize || "sm"}
                  onValueChange={(v) => setForm({ ...form, disclaimerFontSize: v })}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="xs">Extra Small (xs)</SelectItem>
                    <SelectItem value="sm">Small (sm)</SelectItem>
                    <SelectItem value="base">Normal (base)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* Ledger */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold">Booking Ledger</h3>
        <div>
          <Label>Ledger</Label>
          <p className="text-xs text-muted-foreground mb-1">Bills created from online bookings will be tagged to this ledger.</p>
          <Select value={String(form.onlineBookingLedgerId)} onValueChange={(v) => setForm({ ...form, onlineBookingLedgerId: Number(v) })}>
            <SelectTrigger className="mt-1 max-w-xs"><SelectValue placeholder="Select ledger" /></SelectTrigger>
            <SelectContent>{ledgers.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <OnlineBookingCatalogSelector form={form} setForm={setForm} save={save} />

      {/* PayU India */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#002E6E] flex items-center justify-center shrink-0">
            <CreditCard size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">PayU India (Recommended)</h3>
            <p className="text-xs text-muted-foreground">Works with all Indian banks, UPI, credit/debit cards, netbanking, and wallets.</p>
          </div>
        </div>
        <Toggle
          value={form.payuEnabled}
          onChange={(v) => setForm({ ...form, payuEnabled: v })}
          label="Use PayU as active payment gateway"
          hint="When enabled, PayU takes priority over Orange Pay for online bookings."
        />
        <div>
          <Label>PayU Merchant Key</Label>
          <p className="text-xs text-muted-foreground mb-1">Your PayU Merchant Key from the PayU dashboard. Safe to store here — visible to browser.</p>
          <Input
            value={form.payuMerchantKey}
            onChange={(e) => setForm({ ...form, payuMerchantKey: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. JP****"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* PayU Salt — env var */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <KeyRound size={15} /> PayU Merchant Salt (Secret)
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          The Salt is used server-side only for SHA-512 hash generation and verification. It is <strong>never</strong> sent to the browser. Add it as an environment secret:
        </p>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          PAYU_MERCHANT_SALT=your_salt_here
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In Replit: open Secrets (the padlock icon on the left sidebar), add <code>PAYU_MERCHANT_SALT</code> with your PayU Salt. Then restart the API server. Your Merchant Key and Salt are both available in the PayU dashboard under <strong>My Account → Profile</strong>.
        </p>
      </div>

      {/* PhonePe */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#6739B7] flex items-center justify-center shrink-0">
            <CreditCard size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">PhonePe UPI</h3>
            <p className="text-xs text-muted-foreground">UPI-first checkout for Indian customers. Supports all UPI apps, cards, and wallets.</p>
          </div>
        </div>
        <Toggle
          value={form.phonepeEnabled}
          onChange={(v) => setForm({ ...form, phonepeEnabled: v })}
          label="Use PhonePe as active payment gateway"
          hint="When enabled, PhonePe takes priority over PayU and Orange Pay."
        />
        <div>
          <Label>PhonePe Merchant ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your PhonePe Merchant ID from the PhonePe dashboard. Safe to store here.</p>
          <Input
            value={form.phonepeMerchantId}
            onChange={(e) => setForm({ ...form, phonepeMerchantId: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. M1234567890"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <KeyRound size={15} /> PhonePe API Secret (SALT Key)
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          The SALT Key is used server-side for X-VERIFY signature generation. It is <strong>never</strong> sent to the browser. Add it as environment secrets:
        </p>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          PHONEPE_API_SECRET=your_salt_key_here
        </div>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          PHONEPE_SALT_INDEX=1
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In Replit: open Secrets, add <code>PHONEPE_API_SECRET</code> and <code>PHONEPE_SALT_INDEX</code>. Then restart the API server.
        </p>
      </div>

      {/* BharatPe */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#008CD2] flex items-center justify-center shrink-0">
            <CreditCard size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">BharatPe UPI</h3>
            <p className="text-xs text-muted-foreground">Popular merchant UPI checkout for Indian diagnostic centers.</p>
          </div>
        </div>
        <Toggle
          value={form.bharatpeEnabled}
          onChange={(v) => setForm({ ...form, bharatpeEnabled: v })}
          label="Use BharatPe as active payment gateway"
          hint="When enabled, BharatPe takes highest priority over PayU, PhonePe, and Orange Pay."
        />
        <div>
          <Label>BharatPe Merchant ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your BharatPe Merchant ID from the dashboard. Safe to store here.</p>
          <Input
            value={form.bharatpeMerchantId}
            onChange={(e) => setForm({ ...form, bharatpeMerchantId: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. BP1234567890"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <KeyRound size={15} /> BharatPe API Credentials
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          These are used server-side for BharatPe authentication. They are <strong>never</strong> sent to the browser. Add as environment secrets:
        </p>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          BHARATPE_API_KEY=your_api_key
        </div>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          BHARATPE_API_SECRET=your_api_secret
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In Replit: open Secrets, add <code>BHARATPE_API_KEY</code>, <code>BHARATPE_API_SECRET</code>, and <code>BHARATPE_MERCHANT_ID</code>. Then restart the API server.
        </p>
      </div>

      {/* ICICI Orange PG */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#C41E3A] flex items-center justify-center shrink-0">
            <CreditCard size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">ICICI Orange PG</h3>
            <p className="text-xs text-muted-foreground">ICICI Bank payment gateway for card, UPI, and net banking.</p>
          </div>
        </div>
        <Toggle
          value={form.iciciEnabled}
          onChange={(v) => setForm({ ...form, iciciEnabled: v })}
          label="Use ICICI as active payment gateway"
          hint="When enabled, ICICI takes highest priority over all other gateways."
        />
        <div>
          <Label>ICICI Merchant ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your ICICI Merchant ID (e.g. 100000000007164). Safe to store here.</p>
          <Input
            value={form.iciciMerchantId}
            onChange={(e) => setForm({ ...form, iciciMerchantId: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. 100000000007164"
          />
        </div>
        <div>
          <Label>ICICI Aggregator ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your ICICI Aggregator ID (e.g. A100000000007164). Safe to store here.</p>
          <Input
            value={form.iciciAggregatorId}
            onChange={(e) => setForm({ ...form, iciciAggregatorId: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. A100000000007164"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

        <div>
          <Label>ICICI Secret Key</Label>
          <p className="text-xs text-muted-foreground mb-1">Your ICICI secret key for HMAC signing. Stored securely server-side.</p>
          <Input
            type="password"
            value={form.iciciSecretKey}
            onChange={(e) => setForm({ ...form, iciciSecretKey: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="Enter your ICICI secret key"
          />
        </div>

      {/* UPI QR Fallback (dynamic amount) */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#FF6B00] flex items-center justify-center shrink-0">
            <QrCode size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">UPI QR Payment</h3>
            <p className="text-xs text-muted-foreground">Dynamic UPI QR code with exact bill amount for online bookings.</p>
          </div>
        </div>
        <Toggle
          value={form.upiQrEnabled}
          onChange={(v) => setForm({ ...form, upiQrEnabled: v })}
          label="Enable UPI QR payment option"
          hint="Shows a dynamic UPI QR code on the booking page. Patient scans and pays exact amount."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>UPI VPA / BharatPe ID</Label>
            <p className="text-xs text-muted-foreground mb-1">e.g. 9431913477@bharatpe or 9431913477@okicici</p>
            <Input
              value={form.upiVpa}
              onChange={(e) => setForm({ ...form, upiVpa: e.target.value })}
              className="mt-1 max-w-md font-mono text-sm"
              placeholder="your@upi"
            />
          </div>
          <div>
            <Label>Static QR Image URL (optional)</Label>
            <p className="text-xs text-muted-foreground mb-1">Upload your QR image to <code>public/</code> and paste the URL here (e.g. <code>/bharatpe-qr.jpg</code>).</p>
            <Input
              value={form.upiQrImageUrl}
              onChange={(e) => setForm({ ...form, upiQrImageUrl: e.target.value })}
              className="mt-1 max-w-md font-mono text-sm"
              placeholder="/bharatpe-qr.jpg"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
          <QrCode size={15} /> How Dynamic UPI QR Works
        </h3>
        <ul className="text-sm text-emerald-800 dark:text-emerald-300 space-y-1 list-disc pl-4">
          <li>The system builds a <code>upi://pay</code> intent URL with the <strong>exact amount</strong> and your VPA.</li>
          <li>Patient scans the QR code with any UPI app (PhonePe, GPay, Paytm, BharatPe).</li>
          <li>Amount is pre-filled — they just enter their UPI PIN to complete payment.</li>
          <li>If you also upload a static QR image, it's shown alongside the dynamic one as a backup.</li>
        </ul>
      </div>

      {/* Cashfree */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#1E3A8A] flex items-center justify-center shrink-0">
            <CreditCard size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold">Cashfree Payments</h3>
            <p className="text-xs text-muted-foreground">Full-stack payment gateway with UPI, cards, and netbanking.</p>
          </div>
        </div>
        <Toggle
          value={form.cashfreeEnabled}
          onChange={(v) => setForm({ ...form, cashfreeEnabled: v })}
          label="Use Cashfree as active payment gateway"
          hint="When enabled, Cashfree takes priority over other providers."
        />
        <div>
          <Label>Cashfree App ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your Cashfree App ID from the dashboard. Safe to store here.</p>
          <Input
            value={form.cashfreeAppId}
            onChange={(e) => setForm({ ...form, cashfreeAppId: e.target.value })}
            className="mt-1 max-w-md font-mono text-sm"
            placeholder="e.g. 1234567890abcdef"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <KeyRound size={15} /> Cashfree API Secret
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          The Secret Key is used server-side for signature generation. It is <strong>never</strong> sent to the browser. Add it as an environment secret:
        </p>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          CASHFREE_API_SECRET=your_secret_key_here
        </div>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          In Replit: open Secrets, add <code>CASHFREE_API_SECRET</code>. Then restart the API server.
        </p>
      </div>

      {/* Razorpay (legacy / fallback) */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">Razorpay (Fallback / Legacy)</h3>
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Used when BharatPe, PhonePe & PayU are disabled</span>
        </div>
        <div>
          <Label>Razorpay Key ID</Label>
          <p className="text-xs text-muted-foreground mb-1">Your Razorpay API Key ID (starts with <code>rzp_live_</code> or <code>rzp_test_</code>). Safe to expose to browser.</p>
          <Input value={form.razorpayKeyId} onChange={(e) => setForm({ ...form, razorpayKeyId: e.target.value })} className="mt-1 max-w-md font-mono text-sm" placeholder="rzp_live_XXXXXXXXXXXXXXXXXX" />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-2">
        <h3 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <KeyRound size={15} /> Razorpay Key Secret
        </h3>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Server-side only for HMAC signature verification. Set as environment secret:
        </p>
        <div className="font-mono text-sm bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded px-3 py-2 select-all">
          RAZORPAY_KEY_SECRET=your_secret_here
        </div>
      </div>

      {bookingQrUrl && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h3 className="font-bold">WhatsApp Booking QR (Fallback)</h3>
          <p className="text-sm text-muted-foreground">Print this QR code and place it on counters or posters as a booking fallback.</p>
          <div className="flex flex-col md:flex-row gap-4 md:items-center">
            <img
              alt="WhatsApp booking QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(bookingQrUrl)}`}
              className="w-[180px] h-[180px] rounded-xl border bg-white p-2"
            />
            <div className="space-y-2 text-sm">
              <div className="font-mono break-all text-xs bg-muted/40 border border-card-border rounded px-3 py-2">{bookingQrUrl}</div>
              <p className="text-muted-foreground">Use this as a temporary booking entry point while online payment is being configured.</p>
            </div>
          </div>
        </div>
      )}

      {/* Online Payment logs */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-card-border pb-3">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ClipboardList size={18} /> Online Payment Logs
            </h3>
            <p className="text-xs text-muted-foreground">
              Audit trail of recent online payment attempts, transaction IDs, and failure reasons.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["online-bookings-logs"] })}
            title="Refresh logs"
          >
            <RefreshCcw size={13} className="mr-1.5" /> Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by ref, name, or phone..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className="pl-8 text-sm"
            />
          </div>
          <Select value={logStatusFilter} onValueChange={setLogStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="success">Success / Confirmed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {isLoadingBookings ? (
          <div className="text-center py-8 text-muted-foreground animate-pulse">Loading logs...</div>
        ) : !bookingsData?.bookings || bookingsData.bookings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No online bookings or transactions found.</div>
        ) : (
          <div className="border border-card-border rounded-lg overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 border-b border-card-border">
                <tr>
                  <th className="p-3 font-semibold text-muted-foreground">Date & Time</th>
                  <th className="p-3 font-semibold text-muted-foreground">Booking Ref</th>
                  <th className="p-3 font-semibold text-muted-foreground">Patient Info</th>
                  <th className="p-3 font-semibold text-muted-foreground">Gateway</th>
                  <th className="p-3 font-semibold text-muted-foreground">Amount</th>
                  <th className="p-3 font-semibold text-muted-foreground">Status</th>
                  <th className="p-3 font-semibold text-muted-foreground">Reason / Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {(() => {
                  const filtered = (bookingsData.bookings || []).filter((b: any) => {
                    const matchesSearch =
                      (b.bookingRef || "").toLowerCase().includes(logSearch.toLowerCase()) ||
                      (b.name || "").toLowerCase().includes(logSearch.toLowerCase()) ||
                      (b.phone || "").includes(logSearch);
                    const matchesStatus =
                      logStatusFilter === "all" ||
                      (logStatusFilter === "success" && (b.status === "paid" || b.status === "confirmed")) ||
                      (logStatusFilter === "failed" && b.status === "payment_failed") ||
                      (logStatusFilter === "pending" && b.status === "pending_payment");
                    return matchesSearch && matchesStatus;
                  });

                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-muted-foreground">
                          No transactions match your search/filter criteria.
                        </td>
                      </tr>
                    );
                  }

                  return filtered.map((b: any) => {
                    const dateStr = new Date(b.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const gateway = b.razorpayOrderId
                      ? "Razorpay"
                      : b.payuTxnId
                      ? "PayU"
                      : b.phonepeTransactionId
                      ? "PhonePe"
                      : b.bharatpeTransactionId
                      ? "BharatPe"
                      : b.iciciTransactionId
                      ? "ICICI Orange"
                      : "UPI QR / Direct";

                    const isSuccess = b.status === "paid" || b.status === "confirmed";
                    const isFailed = b.status === "payment_failed";
                    const isPending = b.status === "pending_payment";

                    const providerRef = b.phonepeProviderRefId || b.bharatpeProviderRefId || b.iciciProviderRefId || b.payuPaymentId || b.razorpayPaymentId || "";
                    const detailText = isFailed 
                      ? (b.failureReason || "Payment not completed")
                      : isSuccess 
                      ? (providerRef ? `Ref: ${providerRef}` : "Success")
                      : "Awaiting customer payment";

                    return (
                      <tr key={b.id} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-[10px] whitespace-nowrap">{dateStr}</td>
                        <td className="p-3 font-mono font-medium">{b.bookingRef}</td>
                        <td className="p-3">
                          <div className="font-medium">{b.name}</div>
                          <div className="text-[10px] text-muted-foreground">{b.phone}</div>
                        </td>
                        <td className="p-3">{gateway}</td>
                        <td className="p-3 font-mono font-medium">₹{Number(b.totalAmount).toFixed(2)}</td>
                        <td className="p-3">
                          {isSuccess && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400">
                              Success
                            </span>
                          )}
                          {isFailed && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400">
                              Failed
                            </span>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className={`p-3 max-w-[200px] truncate ${isFailed ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`} title={detailText}>
                          {detailText}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery<EmailSettings>({ queryKey: ["email-settings"], queryFn: () => api.get("/api/email-settings") });
  const { register, handleSubmit, reset } = useForm<EmailSettings>({ defaultValues: settings });
  useEffect(() => { if (settings) reset(settings); }, [settings, reset]);
  const save = useMutation({
    mutationFn: (body: EmailSettings) => api.post("/api/email-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-settings"] });
      toast({ title: "Saved", description: "Email settings updated successfully." });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="bg-card border border-card-border rounded-xl p-4">
        <p className="text-sm text-muted-foreground">Configure SMTP and email notifications.</p>
      </div>
      <form onSubmit={handleSubmit((d) => save.mutate(d))} className="space-y-4 bg-card border border-card-border rounded-xl p-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div><Label>SMTP Host</Label><Input {...register("smtpHost")} className="mt-1" /></div>
          <div><Label>SMTP Port</Label><Input {...register("smtpPort")} className="mt-1" /></div>
          <div><Label>SMTP User</Label><Input {...register("smtpUser")} className="mt-1" /></div>
          <div><Label>SMTP Password</Label><Input {...register("smtpPassword")} className="mt-1" type="password" /></div>
          <div><Label>From Address</Label><Input {...register("fromAddress")} className="mt-1" /></div>
          <div><Label>From Name</Label><Input {...register("fromName")} className="mt-1" /></div>
          <div><Label>Admin Email</Label><Input {...register("adminEmail")} className="mt-1" /></div>
          <div><Label>Extra Recipients</Label><Input {...register("extraRecipients")} className="mt-1" /></div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={() => reset(settings)} disabled={!settings}>Reset</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
        </div>
      </form>
    </div>
  );
}

function ManualTab() { const manualText = buildManualText(); return (<div className="space-y-4"><div className="bg-card border border-card-border rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"><div><p className="text-sm font-semibold uppercase text-muted-foreground mb-1">Downloadable Manual</p><h2 className="text-xl font-bold">User Manual & Software Functionality</h2><p className="text-sm text-muted-foreground mt-1">A printable guide covering daily workflow, billing, lab, inventory, referrals, and administration.</p></div><Button onClick={() => downloadTextFile("Diagnostic-Center-Billing-ERP-Manual.txt", manualText)}><Download size={14} className="mr-2" /> Download Manual</Button></div><div className="grid gap-4 md:grid-cols-2">{MANUAL_SECTIONS.map((section) => { const Icon = section.icon; return (<div key={section.title} className="bg-card border border-card-border rounded-xl p-5"><div className="flex items-center gap-2 mb-3"><Icon size={16} className="text-primary" /><h3 className="font-semibold">{section.title}</h3></div><ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">{section.points.map((point) => <li key={point}>{point}</li>)}</ul></div>); })}</div><div className="bg-muted/30 border border-card-border rounded-xl p-5"><div className="flex items-center gap-2 mb-3"><FileText size={16} className="text-primary" /><h3 className="font-semibold">Software Functionality Summary</h3></div><div className="grid gap-3 md:grid-cols-3 text-sm"><div className="bg-card border border-card-border rounded-lg p-3"><p className="font-medium mb-1">Patient Flow</p><p className="text-muted-foreground">Register, order tests, bill, collect payments, and track history.</p></div><div className="bg-card border border-card-border rounded-lg p-3"><p className="font-medium mb-1">Operations</p><p className="text-muted-foreground">Manage doctors, commissions, inventory, lab reports, and accounting.</p></div><div className="bg-card border border-card-border rounded-lg p-3"><p className="font-medium mb-1">Security</p><p className="text-muted-foreground">Role-based permissions, audit logs, email alerts, and super admin portal.</p></div></div></div></div>);
}

type DiscountReason = { id: number; label: string; isActive: boolean };

type WhatsappCfg = {
  id?: number; enabled: boolean;
  phoneNumberId: string; accessToken: string;
  templateName: string; templateLang: string;
  defaultCountryCode: string;
  autoSendOnVerify?: boolean;
  includeViewerLink?: boolean;
  reportMessageTemplate?: string;
  // Webhook + AI Assistant (new fields)
  wabaId?: string;
  webhookVerifyToken?: string;
  aiAssistantEnabled?: boolean;
  aiAssistantName?: string;
  aiSystemPrompt?: string;
  aiEscalationMessage?: string;
};
type WhatsappNumber = {
  id: number;
  name: string;
  phoneNumberId: string;
  displayNumber: string;
  accessToken: string;
  role: "general" | "form_f" | "reports";
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
};
type WaConversation = {
  id: number; phone: string; customerName: string;
  direction: string; messageBody: string; waMessageId: string;
  aiHandled: boolean; status: string; createdAt: string;
};
type PrinterCfg = { id?: number; billPrinter: string; billPrinterType: string; barcodePrinter: string; barcodeEnabled: string; tokenPrinter: string; tokenPrinterType: string; tokenEnabled: string };

const PRINTER_TABS: { key: keyof Omit<PrinterCfg, "id">; typeKey?: keyof Omit<PrinterCfg, "id">; label: string; description: string }[] = [
  { key: "billPrinter",    typeKey: "billPrinterType",   label: "Bill Printer",    description: "A4 / A5 receipts and invoice printouts." },
  { key: "barcodePrinter", label: "Barcode Printer", description: "Small label printer used for sample barcodes." },
  { key: "tokenPrinter",   typeKey: "tokenPrinterType",  label: "Token Printer",   description: "Queue token slip printer at the front desk." },
];

const KNOWN_PRINTERS_KEY = "diagnosticErp:knownPrinters";

function loadKnownPrinters(): string[] {
  try {
    const raw = localStorage.getItem(KNOWN_PRINTERS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function saveKnownPrinters(list: string[]) {
  try { localStorage.setItem(KNOWN_PRINTERS_KEY, JSON.stringify(list)); } catch { /* noop */ }
}

function testPrintPrinter(printerName: string, label: string) {
  const w = window.open("", "_blank", "width=420,height=600");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups so the print dialog can open.");
    return;
  }
  const safeName = printerName ? printerName.replace(/[<>&"']/g, "") : "(default)";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Test ${label}</title>
    <style>
      @page { size: A6; margin: 6mm; }
      body { font-family: Arial, sans-serif; padding: 12px; color:#000; }
      h1 { font-size: 16px; margin: 0 0 8px; }
      p { font-size: 12px; margin: 4px 0; }
      .box { border: 1px dashed #000; padding: 10px; margin-top: 10px; text-align:center; font-weight:700; }
    </style></head><body>
    <h1>${label} — Test Print</h1>
    <p>Configured printer name: <strong>${safeName}</strong></p>
    <p>Date: ${new Date().toLocaleString("en-IN")}</p>
    <div class="box">Choose <strong>${safeName}</strong> in the print dialog to confirm it works.</div>
  </body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = () => { w.focus(); w.print(); setTimeout(() => w.close(), 400); };
}

function PrinterTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery<PrinterCfg>({ queryKey: ["printer-settings"], queryFn: () => api.get("/api/printers/settings") });
  const [form, setForm] = useState<PrinterCfg | null>(null);
  const [activeTab, setActiveTab] = useState<keyof Omit<PrinterCfg, "id">>("billPrinter");
  const [knownPrinters, setKnownPrinters] = useState<string[]>(() => loadKnownPrinters());
  const [newPrinterName, setNewPrinterName] = useState("");
  const cur = form ?? cfg ?? null;
  const save = useMutation({
    mutationFn: (body: PrinterCfg) => api.put("/api/printers/settings", body),
    onSuccess: (saved) => { qc.invalidateQueries({ queryKey: ["printer-settings"] }); setForm(saved as PrinterCfg); },
  });
  if (!cur) return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading printer settings…</div>;

  const update = (k: keyof PrinterCfg, v: string) => setForm({ ...(cur as PrinterCfg), [k]: v });

  function addKnownPrinter() {
    const name = newPrinterName.trim();
    if (!name) return;
    if (knownPrinters.includes(name)) { setNewPrinterName(""); return; }
    const next = [...knownPrinters, name];
    setKnownPrinters(next);
    saveKnownPrinters(next);
    setNewPrinterName("");
  }

  function removeKnownPrinter(name: string) {
    const next = knownPrinters.filter((n) => n !== name);
    setKnownPrinters(next);
    saveKnownPrinters(next);
  }

  const activeMeta = PRINTER_TABS.find((t) => t.key === activeTab)!;
  const activeValue = cur[activeTab] ?? "";
  const activeTypeKey = activeMeta.typeKey;
  const activeTypeValue = activeTypeKey ? (cur[activeTypeKey] ?? "color") : null;

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-bold text-lg flex items-center gap-2"><Printer size={16} /> Printer Routing</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure each printer separately. Pick from the printer aliases saved on this workstation, or type the exact system printer name.</p>
      </div>

      {/* Sub-tabs for the three printers */}
      <div className="flex gap-1 border-b border-card-border">
        {PRINTER_TABS.map((t) => {
          const active = activeTab === t.key;
          const value = cur[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Printer size={13} />
              <span>{t.label}</span>
              {value
                ? <Badge variant="secondary" className="text-[10px] font-mono">{value}</Badge>
                : <Badge variant="outline" className="text-[10px]">unset</Badge>}
            </button>
          );
        })}
      </div>

      {/* Active printer panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">{activeMeta.label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{activeMeta.description}</p>
          </div>
          {(activeTab === "barcodePrinter" || activeTab === "tokenPrinter") && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={cur[activeTab === "barcodePrinter" ? "barcodeEnabled" : "tokenEnabled"] !== "false"}
                onChange={(e) => update(activeTab === "barcodePrinter" ? "barcodeEnabled" : "tokenEnabled", e.target.checked ? "true" : "false")}
              />
              <span className="text-xs font-medium">{cur[activeTab === "barcodePrinter" ? "barcodeEnabled" : "tokenEnabled"] !== "false" ? "Enabled" : "Disabled"}</span>
            </label>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Pick a saved printer</Label>
            <Select
              value={activeValue || "__none"}
              onValueChange={(v) => update(activeTab, v === "__none" ? "" : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={knownPrinters.length === 0 ? "No printer aliases saved yet" : "Select a printer"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None / use system default —</SelectItem>
                {knownPrinters.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Browsers cannot auto-list installed printers. Add aliases for this workstation in the panel below.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Or type the exact printer name</Label>
            <Input
              value={activeValue}
              onChange={(e) => update(activeTab, e.target.value)}
              placeholder="e.g. HP LaserJet 1020 / Zebra GK420"
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Use the name shown in your operating system's "Printers & scanners" list.
            </p>
          </div>
        </div>

        {activeTypeKey && (
          <div className="bg-muted/30 border border-card-border rounded-lg p-3 space-y-2">
            <Label className="text-xs font-semibold">Printer Type</Label>
            <p className="text-[11px] text-muted-foreground">
              Choose <strong>Black &amp; White</strong> to get a higher-contrast, crisper print optimised for B&amp;W laser printers (removes colour backgrounds, boosts contrast). Choose <strong>Colour</strong> for full-colour inkjet/laser output.
            </p>
            <div className="flex gap-3 mt-1">
              {[
                { value: "color", label: "Colour Printer", hint: "Blue headers, coloured text" },
                { value: "bw",    label: "Black & White Printer", hint: "High-contrast, no colour backgrounds" },
              ].map((opt) => {
                const checked = activeTypeValue === opt.value;
                return (
                  <label key={opt.value} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer flex-1 transition-colors ${checked ? "border-primary bg-primary/5" : "border-card-border hover:bg-muted/30"}`}>
                    <input
                      type="radio"
                      name={`printerType-${activeTypeKey}`}
                      value={opt.value}
                      checked={checked}
                      onChange={() => update(activeTypeKey, opt.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Manage workstation printer list */}
        <div className="bg-muted/30 border border-card-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">Printers installed on this computer</h4>
              <p className="text-[11px] text-muted-foreground">Saved locally in this browser. Add the printers physically installed on this workstation so they appear in the dropdown.</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={newPrinterName}
              onChange={(e) => setNewPrinterName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKnownPrinter(); } }}
              placeholder="Add a printer name (as shown in OS)"
              className="h-9"
            />
            <Button type="button" variant="outline" onClick={addKnownPrinter} disabled={!newPrinterName.trim()}>
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          {knownPrinters.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No printers saved yet on this computer.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {knownPrinters.map((p) => {
                const inUse = p === activeValue;
                return (
                  <div
                    key={p}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${
                      inUse ? "border-primary bg-primary/5 text-primary" : "border-card-border bg-card"
                    }`}
                  >
                    <Printer size={11} />
                    <span className="font-mono">{p}</span>
                    {!inUse && (
                      <button
                        type="button"
                        onClick={() => update(activeTab, p)}
                        className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
                      >
                        Use
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeKnownPrinter(p)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${p}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => testPrintPrinter(activeValue, activeMeta.label)}
          >
            <Printer size={14} className="mr-1.5" /> Test Print
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => setForm(cfg ?? null)}>Reset</Button>
            <Button onClick={() => save.mutate(cur)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-label={label ?? "toggle"}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function BillingPrintTab() {
  const [settings, setSettings] = useState<import("@/lib/billPrintSettings").BillPrintSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    import("@/lib/billPrintSettings").then((m) => {
      setSettings(m.loadBillPrintSettings());
      setLoading(false);
    });
  }, []);

  const update = useCallback((patch: Partial<import("@/lib/billPrintSettings").BillPrintSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }, []);

  const save = () => {
    if (!settings) return;
    import("@/lib/billPrintSettings").then((m) => {
      m.saveBillPrintSettings(settings);
      toast({ title: "Saved", description: "Billing print settings saved." });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const reset = () => {
    import("@/lib/billPrintSettings").then((m) => {
      setSettings(m.loadBillPrintSettings());
      toast({ title: "Reset", description: "Billing print settings reset to defaults." });
      setSaved(false);
    });
  };

  if (loading || !settings) return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading billing print settings…</div>;

  const SectionCard = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-bold text-lg flex items-center gap-2">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );

  const SelectCard = ({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <p className="text-sm font-medium mb-2">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${active ? "bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300" : "bg-muted/30 border-card-border text-muted-foreground hover:bg-muted/50"}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const ToggleRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${value ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${value ? "bg-green-500" : "bg-muted-foreground/40"}`}>
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? "translate-x-5" : "translate-x-1"}`} />
      </span>
    </button>
  );

  const billFormats: { id: string; label: string }[] = [
    { id: "classic",     label: "Classic Format (Existing)" },
    { id: "premium-a5", label: "Premium Format V1 (Existing)" },
    { id: "designer-a", label: "Designer Layout A — Minimal Premium" },
    { id: "designer-b", label: "Designer Layout B — Modern Diagnostic" },
    { id: "designer-c", label: "Designer Layout C — Corporate Healthcare" },
  ];
  const billPaperSizes: { id: string; label: string }[] = [
    { id: "A5-portrait", label: "A5 Portrait" },
    { id: "A5-landscape", label: "A5 Landscape" },
    { id: "half-a4", label: "Half A4" },
    { id: "A4", label: "A4" },
  ];
  const billCopyTypes: { id: string; label: string }[] = [
    { id: "patient", label: "Patient Copy" },
    { id: "office", label: "Office Copy" },
    { id: "both", label: "Both Copies" },
  ];
  const printActions: { id: string; label: string }[] = [
    { id: "save-print", label: "Save & Print" },
    { id: "save-preview", label: "Save & Preview" },
    { id: "save-only", label: "Save Only" },
  ];

  return (
    <div className="space-y-4">
      <SectionCard title="Bill Format" subtitle="Choose the default bill layout and enable/disable formats.">
        <SelectCard
          label="Default Bill Format"
          options={billFormats}
          value={settings.defaultFormat}
          onChange={(v) => update({ defaultFormat: v as any })}
        />
        <div className="grid grid-cols-2 gap-3">
          <ToggleRow label="Enable Classic Format" value={settings.classicEnabled} onChange={(v) => update({ classicEnabled: v })} />
          <ToggleRow label="Enable Premium A5 Format" value={settings.premiumA5Enabled} onChange={(v) => update({ premiumA5Enabled: v })} />
          <ToggleRow label="Enable Designer Layout A" value={(settings as any).designerAEnabled !== false} onChange={(v) => update({ designerAEnabled: v } as any)} />
          <ToggleRow label="Enable Designer Layout B" value={(settings as any).designerBEnabled !== false} onChange={(v) => update({ designerBEnabled: v } as any)} />
          <ToggleRow label="Enable Designer Layout C" value={(settings as any).designerCEnabled !== false} onChange={(v) => update({ designerCEnabled: v } as any)} />
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-600 block mb-1">Auto switch to A4 when tests exceed</label>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={20}
              value={(settings as any).autoA4Threshold ?? 5}
              onChange={(e) => update({ autoA4Threshold: Math.max(1, Math.min(20, Number(e.target.value))) } as any)}
              className="w-16 h-7 text-xs border border-gray-300 rounded px-2"
            />
            <span className="text-xs text-slate-500">investigations (default: 5)</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Paper & Copy" subtitle="Configure default paper size and copy type.">
        <SelectCard
          label="Default Paper Size"
          options={billPaperSizes}
          value={settings.defaultPaperSize}
          onChange={(v) => update({ defaultPaperSize: v as any })}
        />
        <SelectCard
          label="Default Copy Type"
          options={billCopyTypes}
          value={settings.defaultCopyType}
          onChange={(v) => update({ defaultCopyType: v as any })}
        />
      </SectionCard>

      <SectionCard title="Bill Display" subtitle="Control what appears on the printed bill.">
        <div className="grid grid-cols-2 gap-3">
          <ToggleRow label="Show QR Code" value={settings.showQrCode} onChange={(v) => update({ showQrCode: v })} />
          <ToggleRow label="Show Amount in Words" value={settings.showAmountInWords} onChange={(v) => update({ showAmountInWords: v })} />
          <ToggleRow label="Show Signature Line" value={settings.showSignatureLine} onChange={(v) => update({ showSignatureLine: v })} />
          <ToggleRow label="Show Computer Generated Note" value={settings.showComputerGenerated} onChange={(v) => update({ showComputerGenerated: v })} />
          <ToggleRow label="Show Report Collection Message" value={settings.showReportMessage} onChange={(v) => update({ showReportMessage: v })} />
          <ToggleRow label="Show Service Footer" value={settings.showServiceFooter} onChange={(v) => update({ showServiceFooter: v })} />
          <ToggleRow label="Show Branding Footer" value={settings.showBrandingFooter} onChange={(v) => update({ showBrandingFooter: v })} />
          <ToggleRow label="Show Receipt Barcode" value={settings.showBarcode} onChange={(v) => update({ showBarcode: v })} />
          <ToggleRow label="Show Watermark" value={settings.showWatermark} onChange={(v) => update({ showWatermark: v })} />
          <ToggleRow label="Show Patient Instructions" value={settings.showPatientInstructions} onChange={(v) => update({ showPatientInstructions: v })} />
          <ToggleRow label="Show System Information" value={settings.showSystemInfo} onChange={(v) => update({ showSystemInfo: v })} />
        </div>
      </SectionCard>

      <SectionCard title="Print Action" subtitle="Default action when saving a bill.">
        <SelectCard
          label="Default Print Button Action"
          options={printActions}
          value={settings.defaultPrintAction}
          onChange={(v) => update({ defaultPrintAction: v as any })}
        />
      </SectionCard>

      <SectionCard title="Preview & Speed" subtitle="Configure how fast the billing workflow should be.">
        <div className="grid grid-cols-2 gap-3">
          <ToggleRow label="Enable Print Preview" value={settings.enablePreview} onChange={(v) => update({ enablePreview: v })} />
          <ToggleRow label="Direct Print After Save" value={settings.directPrintAfterSave} onChange={(v) => update({ directPrintAfterSave: v })} />
          <ToggleRow label="Auto Open Print Dialog" value={settings.autoOpenPrintDialog} onChange={(v) => update({ autoOpenPrintDialog: v })} />
          <ToggleRow label="Ask Before Printing" value={settings.askBeforePrint} onChange={(v) => update({ askBeforePrint: v })} />
          <ToggleRow label="Auto Download PDF" value={settings.autoDownloadPdf} onChange={(v) => update({ autoDownloadPdf: v })} />
          <ToggleRow label="Fast Billing Mode" value={settings.fastBillingMode} onChange={(v) => update({ fastBillingMode: v })} />
        </div>
      </SectionCard>

      <SectionCard title="Admin Lock" subtitle="When ON, users cannot override these settings.">
        <ToggleRow label="Admin Can Force Global Print Settings" value={settings.adminLock} onChange={(v) => update({ adminLock: v })} />
      </SectionCard>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={reset}>Reset</Button>
        <Button onClick={save} className={saved ? "bg-green-600 hover:bg-green-700" : ""}>
          {saved ? (
            <span className="flex items-center gap-1.5"><Check size={16} /> Saved</span>
          ) : (
            "Save Settings"
          )}
        </Button>
      </div>
    </div>
  );
}

function WhatsappNumbersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: numbers = [], isLoading } = useQuery<WhatsappNumber[]>({ queryKey: ["whatsapp-numbers"], queryFn: () => api.get("/api/whatsapp/numbers") });
  const [open, setOpen] = useState(false);
  const [editNum, setEditNum] = useState<WhatsappNumber | null>(null);
  const [formErr, setFormErr] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ok:boolean;error?:string;messageId?:string}|null>(null);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<{
    name: string; phoneNumberId: string; displayNumber: string; accessToken: string;
    role: "general" | "form_f" | "reports";
    enabled: boolean; isDefault: boolean;
  }>();

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (editNum) return api.put(`/api/whatsapp/numbers/${editNum.id}`, body);
      return api.post("/api/whatsapp/numbers", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["whatsapp-numbers"] }); setOpen(false); setEditNum(null); setFormErr(""); },
    onError: (e: Error) => setFormErr(e.message || "Save failed"),
  });
  const deleteNum = useMutation({
    mutationFn: (id: number) => api.delete(`/api/whatsapp/numbers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-numbers"] }),
  });
  const test = useMutation({
    mutationFn: ({ id, phone }: { id: number; phone: string }) => api.post<{ ok: boolean; error?: string; messageId?: string }>(`/api/whatsapp/numbers/${id}/test`, { phone }),
    onSuccess: (data) => { setTestResult(data); setTestingId(null); },
    onError: (e: Error) => { setTestResult({ ok: false, error: e.message || "Test failed" }); setTestingId(null); },
  });

  const openAdd = () => {
    setEditNum(null); setFormErr(""); setShowToken(false); setTestResult(null);
    reset({ name: "", phoneNumberId: "", displayNumber: "", accessToken: "", role: "general", enabled: true, isDefault: false });
    setOpen(true);
  };
  const openEdit = (n: WhatsappNumber) => {
    setEditNum(n); setFormErr(""); setShowToken(false); setTestResult(null);
    reset({
      name: n.name, phoneNumberId: n.phoneNumberId, displayNumber: n.displayNumber,
      accessToken: n.accessToken === "••••••••" ? "" : n.accessToken,
      role: n.role as "general" | "form_f" | "reports",
      enabled: n.enabled, isDefault: n.isDefault,
    });
    setOpen(true);
  };

  const onSubmit = handleSubmit((d) => {
    setFormErr("");
    if (!d.name.trim() || !d.phoneNumberId.trim()) { setFormErr("Name and Phone Number ID are required."); return; }
    save.mutate({
      name: d.name.trim(),
      phoneNumberId: d.phoneNumberId.trim(),
      displayNumber: d.displayNumber.trim(),
      accessToken: d.accessToken.trim(),
      role: d.role,
      enabled: d.enabled,
      isDefault: d.isDefault,
    });
  });

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      general: "bg-blue-100 text-blue-700",
      form_f: "bg-purple-100 text-purple-700",
      reports: "bg-amber-100 text-amber-700",
    };
    const labels: Record<string, string> = { general: "General", form_f: "Form F", reports: "Reports" };
    return <Badge className={`${colors[role] ?? "bg-gray-100 text-gray-700"} text-xs`}>{labels[role] ?? role}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2"><Phone size={16} /> WhatsApp Numbers</h2>
            <p className="text-sm text-muted-foreground mt-1">Add multiple Meta Cloud API numbers with different roles. The default number handles all general billing, report delivery, and AI chatbot. Form F and Reports numbers can be dedicated to those workflows.</p>
          </div>
          <Button size="sm" onClick={openAdd}><Plus size={14} className="mr-1" /> Add Number</Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>
        ) : numbers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageCircle size={36} className="mx-auto mb-3 opacity-30" />
            <p>No WhatsApp numbers configured yet.</p>
            <p className="text-xs mt-1">Add a number to start using Meta Cloud API messaging.</p>
          </div>
        ) : (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-card-border">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Display</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Phone Number ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {numbers.map((n) => (
                  <tr key={n.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{n.name}</span>
                        {n.isDefault && <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5">Default</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{roleBadge(n.role)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{n.displayNumber || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{n.phoneNumberId}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${n.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{n.enabled ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => openEdit(n)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="ghost" className="h-7 text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete "${n.name}"? This cannot be undone.`)) deleteNum.mutate(n.id); }}><Trash2 size={13} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Test all numbers block */}
      {numbers.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Send size={14} /> Quick Test</h3>
          <p className="text-xs text-muted-foreground">Send a test message from any configured number to verify credentials and Meta approval.</p>
          <div className="flex gap-2">
            <Select value={testingId != null ? String(testingId) : ""} onValueChange={(v) => setTestingId(Number(v))}>
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Pick a number to test" />
              </SelectTrigger>
              <SelectContent>
                {numbers.map((n) => (
                  <SelectItem key={n.id} value={String(n.id)}>
                    <span className="flex items-center gap-2">
                      <span className="text-xs">{n.name}</span>
                      <span className="text-[10px] text-muted-foreground">({n.role})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Phone number with country code" className="flex-1" />
            <Button type="button" disabled={!testPhone || !testingId || test.isPending} onClick={() => { setTestResult(null); test.mutate({ id: testingId!, phone: testPhone }); }}>
              {test.isPending ? "Sending…" : "Test"}
            </Button>
          </div>
          {testResult && (
            <p className={`text-xs ${testResult.ok ? "text-green-600" : "text-destructive"}`}>
              {testResult.ok ? `Sent ✓ (msg id: ${testResult.messageId ?? "—"})` : `Failed: ${testResult.error}`}
            </p>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editNum ? "Edit Number" : "Add WhatsApp Number"}</DialogTitle></DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {formErr && <p className="text-xs text-destructive">{formErr}</p>}
            <div>
              <Label>Display Name *</Label>
              <Input {...register("name", { required: "Name is required" })} className="mt-1" placeholder="e.g. Main Clinic" />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phone Number ID *</Label>
                <Input {...register("phoneNumberId", { required: "Phone Number ID is required" })} className="mt-1" placeholder="e.g. 105296888774421" />
                <p className="text-[11px] text-muted-foreground mt-1">From Meta Business → WhatsApp Manager → API Setup.</p>
              </div>
              <div>
                <Label>Display Number (optional)</Label>
                <Input {...register("displayNumber")} className="mt-1" placeholder="+91 98765 43210" />
                <p className="text-[11px] text-muted-foreground mt-1">Shown in UI only. Patients still message the registered number.</p>
              </div>
            </div>
            <div>
              <Label>Permanent Access Token {editNum && "(leave blank to keep current)"}</Label>
              <div className="relative">
                <Input type={showToken ? "text" : "password"} {...register("accessToken")} className="mt-1 pr-10" placeholder="EAAJk..." />
                <button type="button" onClick={() => setShowToken((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Show/hide token">
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Meta Business Account → System Users → Generate Token with whatsapp_messaging permission.</p>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={watch("role")} onValueChange={(v) => setValue("role", v as "general" | "form_f" | "reports")}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General — billing, reports, AI chatbot</SelectItem>
                  <SelectItem value="form_f">Form F — ID card uploads, Form F messages</SelectItem>
                  <SelectItem value="reports">Reports — report delivery only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Incoming messages on a Form F number auto-process ID cards. General numbers get the AI chatbot.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Toggle checked={!!watch("enabled")} onChange={(v) => setValue("enabled", v)} label="Enable" />
                <span className="text-sm">Enabled</span>
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={!!watch("isDefault")} onChange={(v) => setValue("isDefault", v)} label="Default" />
                <span className="text-sm">Default number</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : (editNum ? "Update" : "Add Number")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WhatsappTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery<WhatsappCfg>({ queryKey: ["whatsapp-settings"], queryFn: () => api.get("/api/whatsapp/settings") });
  const [form, setForm] = useState<WhatsappCfg | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waSubTab, setWaSubTab] = useState<"numbers" | "config" | "webhook" | "ai" | "inbox">("numbers");
  const cur = form ?? cfg ?? null;

  const save = useMutation({
    mutationFn: (body: WhatsappCfg) => api.put("/api/whatsapp/settings", body),
    onSuccess: (saved) => { qc.invalidateQueries({ queryKey: ["whatsapp-settings"] }); setForm(saved as WhatsappCfg); },
  });
  const test = useMutation({
    mutationFn: (phone: string) => api.post<{ ok: boolean; error?: string; messageId?: string }>("/api/whatsapp/test", { phone }),
  });

  if (!cur) return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading WhatsApp settings…</div>;
  const update = (k: keyof WhatsappCfg, v: string | boolean) => setForm({ ...(cur as WhatsappCfg), [k]: v });

  const webhookUrl = `${window.location.origin}/api/whatsapp/webhook`;

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const WA_SUB_TABS = [
    { id: "numbers", label: "Numbers",        icon: Phone },
    { id: "config",  label: "Cloud API",      icon: MessageCircle },
    { id: "webhook", label: "Webhook Setup",   icon: Globe },
    { id: "ai",      label: "AI Assistant",    icon: Bot },
    { id: "inbox",   label: "Inbox",           icon: Inbox },
  ] as const;

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {WA_SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setWaSubTab(t.id)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${waSubTab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={13} />{t.label}
            </button>
          );
        })}
      </div>

      {/* ── WhatsApp Numbers ── */}
      {waSubTab === "numbers" && <WhatsappNumbersTab />}

      {/* ── Cloud API Config ── */}
      {waSubTab === "config" && (
        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2"><MessageCircle size={16} /> WhatsApp Cloud API</h2>
                <p className="text-sm text-muted-foreground mt-1">When enabled, every new bill auto-sends a WhatsApp template message to the patient with bill number, amount, and queue token.</p>
              </div>
              <Toggle checked={cur.enabled} onChange={(v) => update("enabled", v)} label="Toggle WhatsApp" />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Phone Number ID *</Label>
                <Input value={cur.phoneNumberId} onChange={(e) => update("phoneNumberId", e.target.value)} className="mt-1" placeholder="e.g. 105296888774421" />
                <p className="text-[11px] text-muted-foreground mt-1">From Meta Business → WhatsApp Manager → API Setup.</p>
              </div>
              <div>
                <Label>Permanent Access Token *</Label>
                <div className="relative">
                  <Input type={showToken ? "text" : "password"} value={cur.accessToken} onChange={(e) => update("accessToken", e.target.value)} className="mt-1 pr-10" placeholder="EAAJk..." />
                  <button type="button" onClick={() => setShowToken(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Show/hide token">
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <Label>Template Name *</Label>
                <Input value={cur.templateName} onChange={(e) => update("templateName", e.target.value)} className="mt-1" placeholder="e.g. bill_notification" />
                <p className="text-[11px] text-muted-foreground mt-1">Template body must accept 4 variables: {"{{1}}"} name, {"{{2}}"} bill no, {"{{3}}"} amount, {"{{4}}"} token.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Template Language</Label>
                  <Input value={cur.templateLang} onChange={(e) => update("templateLang", e.target.value)} className="mt-1" placeholder="en" />
                </div>
                <div>
                  <Label>Default Country Code</Label>
                  <Input value={cur.defaultCountryCode} onChange={(e) => update("defaultCountryCode", e.target.value)} className="mt-1" placeholder="91" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
              <Button variant="outline" type="button" onClick={() => setForm(cfg ?? null)}>Reset</Button>
              <Button onClick={() => save.mutate(cur as WhatsappCfg)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5 space-y-3">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><MessageCircle size={14} /> WhatsApp Booking Link</h3>
              <p className="text-xs text-muted-foreground mt-1">Use this link on the website, Facebook ads, QR posters, and share buttons.</p>
            </div>
            <div className="grid md:grid-cols-[1fr_auto] gap-2">
              <Input value={bookingPhone} onChange={(e) => setBookingPhone(e.target.value)} placeholder="Clinic WhatsApp number (with country code)" />
              <Button type="button" variant="outline" disabled={!bookingPhone.trim()} onClick={() => {
                const num = bookingPhone.replace(/[^0-9]/g, "");
                const msg = encodeURIComponent("Hi, I want to book a test.");
                window.open(`https://wa.me/${num}?text=${msg}`, "_blank", "noopener,noreferrer");
              }}>Open Link</Button>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><Send size={14} /> Patient Report Auto-Delivery</h3>
              <p className="text-xs text-muted-foreground mt-1">When a verifier finalises a patient report, automatically send the patient a WhatsApp message with the PDF download link.</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="font-medium">Auto-send on verify</Label>
                <p className="text-[11px] text-muted-foreground">Off by default — turn on once your delivery template is approved.</p>
              </div>
              <Toggle checked={!!cur.autoSendOnVerify} onChange={(v) => update("autoSendOnVerify", v)} label="Toggle auto-send" />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="font-medium">Include image-viewer link (radiology)</Label>
                <p className="text-[11px] text-muted-foreground">Adds a tokenised tele-radiology viewer URL (7-day expiry) for radiology reports.</p>
              </div>
              <Toggle checked={cur.includeViewerLink !== false} onChange={(v) => update("includeViewerLink", v)} label="Toggle viewer link" />
            </div>
            <div>
              <Label>Custom delivery message (optional)</Label>
              <Textarea
                value={cur.reportMessageTemplate ?? ""}
                onChange={(e) => update("reportMessageTemplate", e.target.value)}
                rows={4}
                className="mt-1 font-mono text-xs"
                placeholder={`Leave empty to use the default. Placeholders:\n  {{name}} {{reportNumber}} {{testName}} {{reportUrl}} {{viewerUrl}}`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
              <Button variant="outline" type="button" onClick={() => setForm(cfg ?? null)}>Reset</Button>
              <Button onClick={() => save.mutate(cur as WhatsappCfg)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5">
            <h3 className="font-semibold mb-2">Send Test Message</h3>
            <p className="text-xs text-muted-foreground mb-3">Sends the configured template using placeholder values to verify your credentials and template approval.</p>
            <div className="flex gap-2">
              <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="10-digit phone (or full intl. format)" className="flex-1" />
              <Button type="button" disabled={!testPhone || test.isPending || !cur.enabled} onClick={() => test.mutate(testPhone)}>
                {test.isPending ? "Sending…" : "Send Test"}
              </Button>
            </div>
            {test.data && (
              <p className={`text-xs mt-3 ${test.data.ok ? "text-green-600" : "text-destructive"}`}>
                {test.data.ok ? `Sent ✓  (msg id: ${test.data.messageId ?? "—"})` : `Failed: ${test.data.error}`}
              </p>
            )}
            {!cur.enabled && <p className="text-xs text-muted-foreground mt-3">Enable WhatsApp above to send test messages.</p>}
          </div>
        </div>
      )}

      {/* ── Webhook Setup ── */}
      {waSubTab === "webhook" && (
        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2"><Globe size={16} /> Webhook Setup</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Configure a webhook in Meta Business Manager so the ERP receives incoming WhatsApp messages from patients in real time.
                This is also required for the AI Business Assistant to reply automatically.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-1 text-sm">
              <p className="font-semibold text-blue-900">How to set up in Meta Business Manager:</p>
              <ol className="list-decimal list-inside text-blue-800 space-y-1 text-xs mt-2">
                <li>Go to <strong>developers.facebook.com</strong> → Your App → WhatsApp → Configuration</li>
                <li>Click <strong>Edit</strong> on the Webhook section</li>
                <li>Paste the Callback URL below into the <strong>Callback URL</strong> field</li>
                <li>Paste your Verify Token below into the <strong>Verify token</strong> field</li>
                <li>Click <strong>Verify and Save</strong></li>
                <li>Subscribe to the <strong>messages</strong> webhook field</li>
              </ol>
            </div>

            <div>
              <Label>Webhook Callback URL (copy this into Meta)</Label>
              <div className="flex gap-2 mt-1">
                <Input value={webhookUrl} readOnly className="font-mono text-xs bg-muted" />
                <Button type="button" variant="outline" size="sm" onClick={copyWebhook}>
                  {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">This URL must be publicly reachable. In production (Replit deployed), it already is.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>WhatsApp Business Account ID (WABA ID)</Label>
                <Input value={cur.wabaId ?? ""} onChange={(e) => update("wabaId", e.target.value)} className="mt-1" placeholder="e.g. 102390128739012" />
                <p className="text-[11px] text-muted-foreground mt-1">From Meta Business Manager → WhatsApp accounts.</p>
              </div>
              <div>
                <Label>Webhook Verify Token *</Label>
                <Input
                  value={cur.webhookVerifyToken ?? ""}
                  onChange={(e) => update("webhookVerifyToken", e.target.value)}
                  className="mt-1 font-mono"
                  placeholder="e.g. care_diagnostics_wh_secret_2026"
                />
                <p className="text-[11px] text-muted-foreground mt-1">A secret string you choose — must match exactly in Meta's webhook config.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
              <Button variant="outline" type="button" onClick={() => setForm(cfg ?? null)}>Reset</Button>
              <Button onClick={() => save.mutate(cur as WhatsappCfg)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Meta AI Business Assistant ── */}
      {waSubTab === "ai" && (
        <div className="space-y-4">
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2"><Bot size={16} /> Meta AI Business Assistant</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  When enabled, incoming WhatsApp messages from patients are automatically answered by an AI assistant powered by Gemini.
                  The assistant is given context about your clinic and answers questions about tests, appointments, and timings.
                  Requires the Webhook to be set up first.
                </p>
              </div>
              <Toggle checked={!!cur.aiAssistantEnabled} onChange={(v) => update("aiAssistantEnabled", v)} label="Toggle AI assistant" />
            </div>

            {!cur.webhookVerifyToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                Webhook is not configured yet. Go to the <button type="button" onClick={() => setWaSubTab("webhook")} className="underline font-semibold">Webhook Setup</button> tab first so incoming messages reach the ERP.
              </div>
            )}

            <div>
              <Label>Assistant Name</Label>
              <Input
                value={cur.aiAssistantName ?? ""}
                onChange={(e) => update("aiAssistantName", e.target.value)}
                className="mt-1"
                placeholder="e.g. Care Diagnostics Assistant"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Shown to patients as the sender name in the AI's greeting context.</p>
            </div>

            <div>
              <Label>Custom System Prompt (optional)</Label>
              <Textarea
                value={cur.aiSystemPrompt ?? ""}
                onChange={(e) => update("aiSystemPrompt", e.target.value)}
                rows={8}
                className="mt-1 font-mono text-xs"
                placeholder={`Leave empty to use the auto-generated default. The default includes:\n- Your clinic name, address, phone, and email\n- Instructions to handle appointment booking, test info, report queries\n- A directive to keep replies concise and professional\n\nExample custom additions:\n  We are open Monday–Saturday 7am–8pm and Sunday 8am–2pm.\n  Pathology results are ready in 4–6 hours. Radiology same day.\n  For emergencies, please call +91-XXXXXXXXXX.`}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                If you fill this in, it completely replaces the default prompt. Include all relevant clinic info here.
                Clinic name and address are automatically included when left blank.
              </p>
            </div>

            <div>
              <Label>Escalation / Hand-off Message</Label>
              <Textarea
                value={cur.aiEscalationMessage ?? ""}
                onChange={(e) => update("aiEscalationMessage", e.target.value)}
                rows={3}
                className="mt-1 text-xs"
                placeholder="I'm not sure about that one — let me connect you with our team. For urgent matters, please call us directly."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Shown to a patient when the AI can't answer from your Knowledge Base, or chooses "Talk to Staff" from the menu — instead of guessing, it hands off and shows this message. Leave empty to use the default shown above. "Reply MENU for the main menu" is added automatically.
              </p>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-xs text-green-800 space-y-1">
              <p className="font-semibold">What the AI can handle automatically:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li>Test availability and general pricing questions</li>
                <li>Appointment booking guidance (directs to call/visit)</li>
                <li>Report readiness and collection times</li>
                <li>Clinic hours, location, and contact info</li>
                <li>General FAQs about the diagnostic center</li>
              </ul>
              <p className="mt-2 text-green-700">The AI will never share specific patient data, diagnosis details, or make medical decisions.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
              <Button variant="outline" type="button" onClick={() => setForm(cfg ?? null)}>Reset</Button>
              <Button onClick={() => save.mutate(cur as WhatsappCfg)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inbox ── */}
      {waSubTab === "inbox" && <WhatsappInbox />}
    </div>
  );
}

function WhatsappInbox() {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyErr, setReplyErr] = useState("");

  const { data: convData, isLoading, refetch } = useQuery<{
    conversations: WaConversation[]; total: number; page: number;
  }>({
    queryKey: ["wa-conversations"],
    queryFn: () => api.get("/api/whatsapp/conversations"),
    refetchInterval: 30_000,
  });

  const { data: threadMsgs = [], refetch: refetchThread } = useQuery<WaConversation[]>({
    queryKey: ["wa-thread", selectedPhone],
    queryFn: () => api.get(`/api/whatsapp/conversations/${encodeURIComponent(selectedPhone!)}`),
    enabled: !!selectedPhone,
    refetchInterval: 15_000,
  });

  const reply = useMutation({
    mutationFn: ({ phone, message }: { phone: string; message: string }) =>
      api.post(`/api/whatsapp/conversations/${encodeURIComponent(phone)}/reply`, { message }),
    onSuccess: () => { setReplyText(""); setReplyErr(""); refetchThread(); },
    onError: (e: Error) => setReplyErr(e.message || "Failed to send reply"),
  });

  // Group conversations by phone (show latest message per phone)
  const threads = convData?.conversations
    ? Object.values(
        convData.conversations.reduce<Record<string, WaConversation>>((acc, m) => {
          if (!acc[m.phone] || new Date(m.createdAt) > new Date(acc[m.phone].createdAt)) {
            acc[m.phone] = m;
          }
          return acc;
        }, {})
      ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday
      ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  if (selectedPhone) {
    const threadName = threadMsgs[0]?.customerName || selectedPhone;
    return (
      <div className="bg-card border border-card-border rounded-xl overflow-hidden flex flex-col" style={{ minHeight: 500 }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border bg-muted/30">
          <button onClick={() => setSelectedPhone(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm">
            {(threadName[0] ?? "?").toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-sm">{threadName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone size={10} /> {selectedPhone}</p>
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => refetchThread()}>
            <RefreshCcw size={13} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: 380 }}>
          {[...threadMsgs].reverse().map((m) => (
            <div key={m.id} className={`flex ${m.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === "outgoing" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                <p>{m.messageBody}</p>
                <p className={`text-[10px] mt-0.5 ${m.direction === "outgoing" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {formatTime(m.createdAt)}
                  {m.aiHandled && " · AI"}
                </p>
              </div>
            </div>
          ))}
          {threadMsgs.length === 0 && <p className="text-center text-muted-foreground text-sm py-8">No messages</p>}
        </div>

        <div className="p-3 border-t border-card-border space-y-2">
          <div className="flex gap-2">
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type a reply…"
              className="flex-1"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && replyText.trim()) { e.preventDefault(); reply.mutate({ phone: selectedPhone, message: replyText.trim() }); } }}
            />
            <Button
              type="button"
              disabled={!replyText.trim() || reply.isPending}
              onClick={() => reply.mutate({ phone: selectedPhone, message: replyText.trim() })}
            >
              <Send size={14} />
            </Button>
          </div>
          {replyErr && <p className="text-xs text-destructive">{replyErr}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-card-border">
        <h3 className="font-semibold flex items-center gap-2"><Inbox size={15} /> Patient Inbox</h3>
        <Button size="sm" variant="ghost" onClick={() => refetch()}><RefreshCcw size={13} /></Button>
      </div>
      {isLoading ? (
        <div className="space-y-0">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted/30 border-b border-card-border animate-pulse" />)}
        </div>
      ) : threads.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <MessageCircle size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No conversations yet.</p>
          <p className="text-xs mt-1">Incoming messages will appear here once the webhook is configured.</p>
        </div>
      ) : (
        <div>
          {threads.map((m) => (
            <button
              key={m.phone}
              onClick={() => setSelectedPhone(m.phone)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-card-border hover:bg-muted/30 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                {(m.customerName?.[0] ?? m.phone[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm truncate">{m.customerName || m.phone}</p>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatTime(m.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{m.messageBody}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {m.direction === "incoming" && (
                  <span className="w-2 h-2 rounded-full bg-green-500" title="Incoming" />
                )}
                {m.aiHandled && (
                  <span title="AI handled"><Bot size={11} className="text-blue-500" /></span>
                )}
              </div>
              <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscountReasonsTab() {
  const qc = useQueryClient();
  const { data: reasons = [], isLoading } = useQuery<DiscountReason[]>({
    queryKey: ["discount-reasons"],
    queryFn: () => api.get("/api/discount-reasons"),
  });
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const addReason = useMutation({
    mutationFn: (label: string) => api.post("/api/discount-reasons", { label }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discount-reasons"] }); setNewLabel(""); },
  });
  const updateReason = useMutation({
    mutationFn: (body: { id: number; data: Partial<DiscountReason> }) => api.patch(`/api/discount-reasons/${body.id}`, body.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discount-reasons"] }); setEditId(null); },
  });
  const deleteReason = useMutation({
    mutationFn: (id: number) => api.delete(`/api/discount-reasons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discount-reasons"] }),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5">
        <p className="text-sm text-muted-foreground">
          Manage the list of preset reasons available in the Billing Desk discount field. Inactive reasons are hidden from billing but kept for historical bills.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (newLabel.trim()) addReason.mutate(newLabel.trim()); }}
        className="bg-card border border-card-border rounded-xl p-4 flex gap-2"
      >
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="New reason (e.g. Weekend Promo)"
          className="flex-1"
        />
        <Button type="submit" disabled={!newLabel.trim() || addReason.isPending}>
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </form>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : reasons.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">No reasons configured.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-card-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-12">#</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground">Label</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-muted-foreground w-28">Status</th>
                <th className="px-4 py-2.5 w-24" />
              </tr>
            </thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.id} className="border-b border-card-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.id}</td>
                  <td className="px-4 py-2">
                    {editId === r.id ? (
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateReason.mutate({ id: r.id, data: { label: editLabel } });
                          if (e.key === "Escape") setEditId(null);
                        }}
                        autoFocus
                        className="h-8"
                      />
                    ) : (
                      <span className="font-medium">{r.label}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => updateReason.mutate({ id: r.id, data: { isActive: !r.isActive } })}
                      className={`text-xs px-2 py-1 rounded font-medium ${r.isActive ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
                    >
                      {r.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {editId === r.id ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => updateReason.mutate({ id: r.id, data: { label: editLabel } })}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>✕</Button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditId(r.id); setEditLabel(r.label); }} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Pencil size={13} /></button>
                          <button
                            onClick={() => { if (confirm(`Delete reason "${r.label}"?`)) deleteReason.mutate(r.id); }}
                            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          ><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type DiagnosticTest = { id: number; code: string; name: string; category: string; isActive: boolean };

function FormFTestsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: tests = [], isLoading: testsLoading } = useQuery<DiagnosticTest[]>({
    queryKey: ["tests-all-formf"],
    queryFn: () => api.get<{ tests: DiagnosticTest[] }>("/api/tests?limit=500").then((d) => d.tests ?? []),
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<{
    formFTestIds?: string;
    formFBillingPrompt?: boolean;
    formFAddressRequired?: boolean;
    formFGuardianRequired?: boolean;
    serviceImages?: string;
  }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [billingPrompt, setBillingPrompt] = useState(false);
  const [addressRequired, setAddressRequired] = useState(true);
  const [guardianRequired, setGuardianRequired] = useState(true);
  const [includeBiometry, setIncludeBiometry] = useState(false);

  useEffect(() => {
    if (!settingsLoading && settings !== undefined) {
      try {
        const ids: number[] = JSON.parse(settings?.formFTestIds ?? "[]");
        setSelectedIds(new Set(ids));
      } catch { /* ignore */ }
      setBillingPrompt(!!settings?.formFBillingPrompt);
      setAddressRequired(settings?.formFAddressRequired !== false);
      setGuardianRequired(settings?.formFGuardianRequired !== false);
      try {
        const parsed = JSON.parse(settings?.serviceImages ?? "{}");
        setIncludeBiometry(!!parsed.formFIncludeBiometry);
      } catch { /* ignore */ }
    }
  }, [settings, settingsLoading]);

  const saveMut = useMutation({
    mutationFn: () => {
      let svcImgs = "{}";
      try {
        const parsed = JSON.parse(settings?.serviceImages ?? "{}");
        parsed.formFIncludeBiometry = includeBiometry;
        svcImgs = JSON.stringify(parsed);
      } catch { /* ignore */ }

      return api.put("/api/clinic-settings", {
        formFTestIds: JSON.stringify([...selectedIds]),
        formFBillingPrompt: billingPrompt,
        formFAddressRequired: addressRequired,
        formFGuardianRequired: guardianRequired,
        serviceImages: svcImgs,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
    },
  });

  const toggleTest = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const activeTests = tests.filter((t) => t.isActive !== false);
  const filteredTests = activeTests.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
  });

  const byCategory: Record<string, DiagnosticTest[]> = {};
  for (const t of filteredTests) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  if (testsLoading || settingsLoading) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground animate-pulse">Loading tests…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2">
              <FileText size={16} className="text-primary" /> PCPNDT Form F — Required Tests
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Mark which tests require PCPNDT Form F. When these tests are added in Billing Desk,
              Husband's Name and Address will be collected for Form F compliance.
            </p>
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  id="formFBillingPrompt"
                  type="checkbox"
                  checked={billingPrompt}
                  onChange={(e) => setBillingPrompt(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <label htmlFor="formFBillingPrompt" className="text-xs text-muted-foreground cursor-pointer">
                  <span className="font-semibold text-foreground">Show popup after bill creation</span>
                  — Instead of blocking the bill, show a modal to collect address + guardian name <em>after</em> the bill is saved.
                </label>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <input
                  id="formFGuardianRequired"
                  type="checkbox"
                  checked={guardianRequired}
                  onChange={(e) => setGuardianRequired(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <label htmlFor="formFGuardianRequired" className="text-xs text-muted-foreground cursor-pointer">
                  <span className="font-semibold text-foreground">Husband/Father name required</span> in popup and Form F
                </label>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <input
                  id="formFAddressRequired"
                  type="checkbox"
                  checked={addressRequired}
                  onChange={(e) => setAddressRequired(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <label htmlFor="formFAddressRequired" className="text-xs text-muted-foreground cursor-pointer">
                  <span className="font-semibold text-foreground">Full address required</span> in popup and Form F
                </label>
              </div>
              <div className="flex items-center gap-2 pl-6">
                <input
                  id="formFIncludeBiometry"
                  type="checkbox"
                  checked={includeBiometry}
                  onChange={(e) => setIncludeBiometry(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <label htmlFor="formFIncludeBiometry" className="text-xs text-muted-foreground cursor-pointer">
                  <span className="font-semibold text-foreground">Include USG biometry (BPD, FL, AC, HC, CRL) in Form F export</span>
                </label>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">{selectedIds.size} test(s) selected</span>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {saveMut.isSuccess && (
          <div className="mt-2 text-xs text-green-600 font-medium">✓ Form F test settings saved successfully.</div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tests by name, code or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Quick select USG category */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground self-center">Quick select:</span>
        {["Radiology", "Ultrasound", "USG", "Sonography"].map((cat) => {
          const catTests = activeTests.filter((t) => t.category.toLowerCase().includes(cat.toLowerCase()));
          if (catTests.length === 0) return null;
          return (
            <Button
              key={cat}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelectedIds((prev) => {
                const next = new Set(prev);
                catTests.forEach((t) => next.add(t.id));
                return next;
              })}
            >
              Select all {cat} ({catTests.length})
            </Button>
          );
        })}
        <Button variant="outline" size="sm" className="h-7 text-xs text-destructive" onClick={() => setSelectedIds(new Set())}>
          Clear all
        </Button>
      </div>

      {/* Test list by category */}
      {Object.entries(byCategory).map(([cat, catTests]) => (
        <div key={cat} className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-muted/40 border-b border-card-border flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</span>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => setSelectedIds((prev) => {
                const next = new Set(prev);
                const allSelected = catTests.every((t) => next.has(t.id));
                catTests.forEach((t) => allSelected ? next.delete(t.id) : next.add(t.id));
                return next;
              })}
            >
              {catTests.every((t) => selectedIds.has(t.id)) ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="divide-y divide-card-border">
            {catTests.map((t) => {
              const checked = selectedIds.has(t.id);
              return (
                <label key={t.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTest(t.id)}
                    className="w-4 h-4 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.code}</div>
                  </div>
                  {checked && (
                    <span className="text-[10px] bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
                      Form F Required
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      {filteredTests.length === 0 && (
        <div className="text-center py-10 text-muted-foreground text-sm">
          No tests found{search ? ` for "${search}"` : ""}. Add tests in the Test Catalog first.
        </div>
      )}
    </div>
  );
}

// ============================================================
// SECURITY TAB — LAN-only login restriction
// ============================================================
type WebAuthnCredential = {
  id: number;
  deviceName: string;
  credentialId: string;
  createdAt: string;
};

type SecuritySettings = {
  lanOnlyLogin: boolean;
  lanAllowedIps: string;
  fido2Enabled: boolean;
};

function SecurityTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = readStaffSession();
  const isAdmin = session?.user.role === "admin" || session?.user.role === "super_admin";
  const { data, isLoading } = useQuery<SecuritySettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [lanOnly, setLanOnly] = useState(false);
  const [extraIpsText, setExtraIpsText] = useState("");
  const [fido2Enabled, setFido2Enabled] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setLanOnly(data.lanOnlyLogin ?? false);
      setFido2Enabled(data.fido2Enabled ?? false);
      let arr: string[] = [];
      try { arr = JSON.parse(data.lanAllowedIps ?? "[]"); } catch { arr = []; }
      setExtraIpsText(arr.join("\n"));
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) => api.put("/api/clinic-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      setDirty(false);
      toast({ title: "Security settings saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const handleSave = () => {
    const ips = extraIpsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    save.mutate({ lanOnlyLogin: lanOnly, lanAllowedIps: JSON.stringify(ips), fido2Enabled });
  };

  if (isLoading || !data) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Network Access Control</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Restrict staff login to the hospital's local network. Admin accounts are always exempt and can log in from anywhere.
            </p>
          </div>
        </div>
      </div>

      {/* LAN toggle card */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Hospital LAN Only</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            When enabled, non-admin staff can only sign in from IP addresses starting with <code className="bg-muted px-1 rounded">192.168.</code>, <code className="bg-muted px-1 rounded">10.</code>, or <code className="bg-muted px-1 rounded">172.16–31.</code> (standard router ranges).
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setLanOnly(!lanOnly); setDirty(true); }}
          className={`w-full text-left flex items-start justify-between gap-3 px-4 py-3 rounded-lg border transition-colors ${
            lanOnly
              ? "bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
              : "bg-muted/30 border-card-border"
          }`}
        >
          <div>
            <p className="text-sm font-medium">
              {lanOnly ? "LAN restriction is ON — outside logins blocked" : "LAN restriction is OFF — login allowed from anywhere"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lanOnly
                ? "Staff must be on the hospital Wi-Fi or wired network to sign in."
                : "Staff can sign in from any network, including mobile data and home internet."}
            </p>
          </div>
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 shrink-0 ${lanOnly ? "bg-amber-500" : "bg-muted-foreground/40"}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${lanOnly ? "translate-x-5" : "translate-x-1"}`} />
          </span>
        </button>

        {lanOnly && (
          <div className="space-y-2">
            <div>
              <Label>Extra Allowed IPs <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">
                One IP address per line. Use this for a trusted external location (e.g. a specific doctor's office static IP). Leave blank if not needed.
              </p>
              <Textarea
                value={extraIpsText}
                onChange={(e) => { setExtraIpsText(e.target.value); setDirty(true); }}
                placeholder={"203.0.113.45\n198.51.100.10"}
                className="font-mono text-sm"
                rows={4}
              />
            </div>
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="bg-muted/40 border border-card-border rounded-xl p-4 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">How it works</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>The check happens at login — existing sessions are not terminated if the user walks outside.</li>
          <li>Admin accounts are <strong>always exempt</strong> regardless of this setting.</li>
          <li>The fingerprint kiosk login is not affected (it operates on-premise by design).</li>
          <li>If you turn this on accidentally and get locked out, an Admin can always log in to turn it off.</li>
        </ul>
      </div>

      {isAdmin && (
        <>
          {/* ── FIDO2 / Security Key Settings ───────────────────────────── */}
          <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
            <div>
              <h3 className="font-semibold">FIDO2 / Security Key Login</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Allow staff to register and use hardware security keys (YubiKey, Titan, Touch ID, Windows Hello) as a second authentication factor or standalone login method.
              </p>
            </div>

            <button
              type="button"
              onClick={() => { setFido2Enabled(!fido2Enabled); setDirty(true); }}
              className={`w-full text-left flex items-start justify-between gap-3 px-4 py-3 rounded-lg border transition-colors ${
                fido2Enabled
                  ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800"
                  : "bg-muted/30 border-card-border"
              }`}
            >
              <div>
                <p className="text-sm font-medium">
                  {fido2Enabled ? "FIDO2 is ON — security-key login offered" : "FIDO2 is OFF — PIN-only login"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fido2Enabled
                    ? "Staff can use security keys at login. Only admins can register new keys. PIN login still works for all users."
                    : "Staff must sign in with username and PIN only. No hardware key option is shown."}
                </p>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors mt-0.5 shrink-0 ${fido2Enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${fido2Enabled ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>

          {/* ── My Security Keys (admin only) ────────────────────────── */}
          <MySecurityKeys />
        </>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending || !dirty}>
          {save.isPending ? "Saving…" : "Save Security Settings"}
        </Button>
      </div>
    </div>
  );
}

function MySecurityKeys() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [registering, setRegistering] = useState(false);

  const { data: creds = [], isLoading } = useQuery<WebAuthnCredential[]>({
    queryKey: ["webauthn-credentials"],
    queryFn: () => api.get("/api/auth/webauthn/credentials"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/auth/webauthn/credentials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webauthn-credentials"] });
      toast({ title: "Security key removed" });
    },
    onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
  });

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const opts = await api.post<{
        challenge: string;
        rp: { name: string; id: string };
        user: { id: string; name: string; displayName: string };
        pubKeyCredParams: { type: string; alg: number }[];
        authenticatorSelection?: Record<string, unknown>;
        attestation?: string;
        timeout?: number;
        excludeCredentials?: { id: string; type: string; transports?: string[] }[];
      }>("/api/auth/webauthn/register/begin", {});
      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: base64UrlToBuffer(opts.challenge),
        rp: opts.rp,
        user: { ...opts.user, id: base64UrlToBuffer(opts.user.id) },
        pubKeyCredParams: opts.pubKeyCredParams.map((p) => ({ type: p.type as PublicKeyCredentialType, alg: p.alg })),
        authenticatorSelection: opts.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
        attestation: opts.attestation as AttestationConveyancePreference | undefined,
        timeout: opts.timeout,
        excludeCredentials: (opts.excludeCredentials || []).map((c) => ({
          id: base64UrlToBuffer(c.id),
          type: c.type as PublicKeyCredentialType,
          transports: (c.transports ?? []) as AuthenticatorTransport[],
        })),
      };
      if (!navigator.credentials) {
        throw new Error("Security Key registration (WebAuthn/FIDO2) requires a secure connection (HTTPS) when accessed remotely. Please configure HTTPS or access via localhost.");
      }
      const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
      if (!credential) throw new Error("Registration cancelled");

      const response = credential.response as AuthenticatorAttestationResponse;
      const clientDataJSON = bufferToBase64Url(response.clientDataJSON);
      const attestationObject = bufferToBase64Url(response.attestationObject);

      await api.post("/api/auth/webauthn/register/complete", {
        response: {
          id: credential.id,
          rawId: credential.id,
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
          response: { clientDataJSON, attestationObject, transports: response.getTransports?.() ?? [] },
        },
        expectedChallenge: opts.challenge,
        deviceName: "Security Key",
      });
      qc.invalidateQueries({ queryKey: ["webauthn-credentials"] });
      toast({ title: "Security key registered" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">My Security Keys</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage the hardware keys and biometric devices registered to your account.
          </p>
        </div>
        <Button onClick={handleRegister} disabled={registering || isLoading} size="sm">
          {registering ? "Registering…" : "Register New Key"}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {creds.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">
          No security keys registered yet. Click "Register New Key" to add one.
        </p>
      )}

      <div className="space-y-2">
        {creds.map((c) => (
          <div key={c.id} className="flex items-center justify-between bg-muted/40 border border-card-border rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-medium">{c.deviceName}</p>
                <p className="text-xs text-muted-foreground">Registered {new Date(c.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove.mutate(c.id)}
              className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
              title="Remove"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function base64UrlToBuffer(s: string): ArrayBuffer {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(b: ArrayBuffer): string {
  const bytes = new Uint8Array(b);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ChangePasswordTab() {
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["users"], queryFn: () => api.get("/api/users") });
  const [visible, setVisible] = useState(false);
  const changePassword = useMutation({ mutationFn: (body: { userId: number; currentPin: string; newPin: string }) => api.patch(`/api/users/${body.userId}/password`, { currentPin: body.currentPin, newPin: body.newPin }) });
  const { register, handleSubmit, watch, reset, setValue } = useForm<ChangePasswordForm>({ defaultValues: { userId: "", currentPin: "", newPin: "", confirmPin: "" } });
  const onSubmit = handleSubmit((d) => { if (!d.userId || d.newPin !== d.confirmPin) return; changePassword.mutate({ userId: Number(d.userId), currentPin: d.currentPin, newPin: d.newPin }, { onSuccess: () => reset({ userId: "", currentPin: "", newPin: "", confirmPin: "" }) }); });
  return (<div className="max-w-2xl space-y-4"><div className="bg-card border border-card-border rounded-xl p-5"><p className="text-sm text-muted-foreground">Change a user PIN/password for login and secure actions.</p></div><form onSubmit={onSubmit} className="space-y-4 bg-card border border-card-border rounded-xl p-5"><div><Label>User</Label><Select value={watch("userId")} onValueChange={(v) => setValue("userId", v)}><SelectTrigger className="mt-1"><SelectValue placeholder="Select user" /></SelectTrigger><SelectContent>{users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name} — {u.role}</SelectItem>)}</SelectContent></Select></div><div><Label>Current PIN</Label><Input {...register("currentPin", { required: true })} className="mt-1" type={visible ? "text" : "password"} /></div><div><Label>New PIN</Label><Input {...register("newPin", { required: true })} className="mt-1" type={visible ? "text" : "password"} /></div><div><Label>Confirm New PIN</Label><Input {...register("confirmPin", { required: true })} className="mt-1" type={visible ? "text" : "password"} /></div><div className="flex items-center justify-between"><button type="button" onClick={() => setVisible((v) => !v)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">{visible ? <EyeOff size={14} /> : <Eye size={14} />} Toggle visibility</button><Button type="submit" disabled={changePassword.isPending}>Update PIN</Button></div>{changePassword.isError && <p className="text-sm text-destructive">Failed to update PIN.</p>}</form></div>);
}

// ============================================================
// DEPARTMENTS TAB
// ============================================================
type Department = {
  id: number; name: string; code: string | null; description: string | null;
  headOfDepartment: string | null; contactPhone: string | null; contactEmail: string | null;
  isActive: boolean; testCount: number; staffCount: number; machineCount: number;
};

function DepartmentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => api.get("/api/departments"),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", headOfDepartment: "", contactPhone: "", contactEmail: "", isActive: true });

  const reset = () => { setEditing(null); setForm({ name: "", code: "", description: "", headOfDepartment: "", contactPhone: "", contactEmail: "", isActive: true }); };

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/api/departments", b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); reset(); toast({ title: "Department added" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: number; b: typeof form }) => api.patch(`/api/departments/${id}`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); setOpen(false); reset(); toast({ title: "Department updated" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/departments/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["departments"] }); toast({ title: "Department deleted" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const onEdit = (d: Department) => {
    setEditing(d);
    setForm({ name: d.name, code: d.code || "", description: d.description || "", headOfDepartment: d.headOfDepartment || "", contactPhone: d.contactPhone || "", contactEmail: d.contactEmail || "", isActive: d.isActive });
    setOpen(true);
  };
  const onSubmit = () => { if (!form.name.trim()) return; if (editing) update.mutate({ id: editing.id, b: form }); else create.mutate(form); };

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Network size={16} /> Departments</h3>
          <p className="text-xs text-muted-foreground mt-1">Lab departments referenced by tests, staff and machines.</p>
        </div>
        <Button onClick={() => { reset(); setOpen(true); }}><Plus size={14} className="mr-1" /> Add Department</Button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-xs">Name</th>
              <th className="px-3 py-2 font-medium text-xs">Code</th>
              <th className="px-3 py-2 font-medium text-xs">Head</th>
              <th className="px-3 py-2 font-medium text-xs">Contact</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Tests</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Staff</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Machines</th>
              <th className="px-3 py-2 font-medium text-xs">Status</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              : rows.length === 0
                ? <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-muted-foreground">No departments yet — add common ones like Pathology, Radiology, Cardiology</td></tr>
                : rows.map(d => (
                  <tr key={d.id} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2 text-xs font-mono">{d.code || "—"}</td>
                    <td className="px-3 py-2 text-xs">{d.headOfDepartment || "—"}</td>
                    <td className="px-3 py-2 text-xs">{d.contactPhone || d.contactEmail || "—"}</td>
                    <td className="px-3 py-2 text-xs text-right">{d.testCount}</td>
                    <td className="px-3 py-2 text-xs text-right">{d.staffCount}</td>
                    <td className="px-3 py-2 text-xs text-right">{d.machineCount}</td>
                    <td className="px-3 py-2"><Badge className={d.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}>{d.isActive ? "active" : "inactive"}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => onEdit(d)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete ${d.name}?`)) remove.mutate(d.id); }}><Trash2 size={13} className="text-rose-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Department" : "Add Department"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label className="text-xs">Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PATH" /></div>
            <div><Label className="text-xs">Head of Dept</Label><Input value={form.headOfDepartment} onChange={(e) => setForm({ ...form, headOfDepartment: e.target.value })} /></div>
            <div><Label className="text-xs">Contact Phone</Label><Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></div>
            <div><Label className="text-xs">Contact Email</Label><Input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
            <div className="col-span-2"><Label className="text-xs">Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 col-span-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={onSubmit} disabled={!form.name.trim()}>{editing ? "Save" : "Add"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// LOCATIONS TAB (Floors + Rooms + Modalities)
// ============================================================
type Floor = { id: number; name: string; code: string; description: string | null; isActive: boolean; sortOrder: number; roomCount: number };
type Room  = { id: number; name: string; code: string; floorId: number | null; floorName: string | null; description: string | null; isActive: boolean; sortOrder: number; testCount: number };
type Modality = { id: number; name: string; code: string; description: string | null; isActive: boolean; sortOrder: number; testCount: number };

function LocationsTab() {
  const [sub, setSub] = useState<"floors" | "rooms" | "modalities">("floors");
  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-1"><Layers size={16} /> Locations Master</h3>
        <p className="text-xs text-muted-foreground">Manage physical floors, rooms/counters, and imaging modalities. Assign them to tests in the Test Catalog — they appear on queue token slips.</p>
        <div className="flex gap-1 mt-3 bg-muted p-1 rounded-lg w-fit">
          {(["floors", "rooms", "modalities"] as const).map(s => (
            <button key={s} onClick={() => setSub(s)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${sub === s ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {s === "floors" ? "Floors" : s === "rooms" ? "Rooms / Counters" : "Modalities"}
            </button>
          ))}
        </div>
      </div>
      {sub === "floors" && <FloorsSubTab />}
      {sub === "rooms" && <RoomsSubTab />}
      {sub === "modalities" && <ModalitiesSubTab />}
    </div>
  );
}

function FloorsSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<Floor[]>({ queryKey: ["floors"], queryFn: () => api.get("/api/floors") });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Floor | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", sortOrder: 0, isActive: true });
  const reset = () => { setEditing(null); setForm({ name: "", code: "", description: "", sortOrder: 0, isActive: true }); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["floors"] });
  const create = useMutation({ mutationFn: (b: typeof form) => api.post("/api/floors", b), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Floor added" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const update = useMutation({ mutationFn: ({ id, b }: { id: number; b: typeof form }) => api.patch(`/api/floors/${id}`, b), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Floor updated" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/api/floors/${id}`), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["rooms"] }); toast({ title: "Floor deleted" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const onEdit = (d: Floor) => { setEditing(d); setForm({ name: d.name, code: d.code || "", description: d.description || "", sortOrder: d.sortOrder, isActive: d.isActive }); setOpen(true); };
  const onSubmit = () => { if (!form.name.trim()) return; if (editing) update.mutate({ id: editing.id, b: form }); else create.mutate(form); };
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">{rows.length} floor{rows.length !== 1 ? "s" : ""}</span>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}><Plus size={13} className="mr-1" /> Add Floor</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-left">
          <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th><th className="px-3 py-2 text-right">Rooms</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
        </thead>
        <tbody>
          {isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">No floors yet — e.g. Ground Floor, First Floor</td></tr>
            : rows.map(d => (
              <tr key={d.id} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{d.name}</td>
                <td className="px-3 py-2 text-xs font-mono">{d.code || "—"}</td>
                <td className="px-3 py-2 text-xs text-right">{d.roomCount}</td>
                <td className="px-3 py-2"><Badge className={d.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}>{d.isActive ? "active" : "inactive"}</Badge></td>
                <td className="px-3 py-2"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => onEdit(d)}><Pencil size={13} /></Button><Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete "${d.name}"?`)) remove.mutate(d.id); }}><Trash2 size={13} className="text-rose-500" /></Button></div></td>
              </tr>
            ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Floor" : "Add Floor"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ground Floor" /></div>
            <div><Label className="text-xs">Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="GF" /></div>
            <div><Label className="text-xs">Sort Order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
            <div className="col-span-2"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 col-span-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button><Button onClick={onSubmit} disabled={!form.name.trim()}>{editing ? "Save" : "Add"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoomsSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<Room[]>({ queryKey: ["rooms"], queryFn: () => api.get("/api/rooms") });
  const { data: floors = [] } = useQuery<Floor[]>({ queryKey: ["floors"], queryFn: () => api.get("/api/floors") });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Room | null>(null);
  const [form, setForm] = useState({ name: "", code: "", floorId: "" as string, description: "", sortOrder: 0, isActive: true });
  const reset = () => { setEditing(null); setForm({ name: "", code: "", floorId: "", description: "", sortOrder: 0, isActive: true }); };
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["rooms"] }); qc.invalidateQueries({ queryKey: ["floors"] }); };
  const toPayload = () => ({ ...form, floorId: form.floorId ? Number(form.floorId) : null });
  const create = useMutation({ mutationFn: () => api.post("/api/rooms", toPayload()), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Room added" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const update = useMutation({ mutationFn: ({ id }: { id: number }) => api.patch(`/api/rooms/${id}`, toPayload()), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Room updated" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/api/rooms/${id}`), onSuccess: () => { invalidate(); toast({ title: "Room deleted" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const onEdit = (d: Room) => { setEditing(d); setForm({ name: d.name, code: d.code || "", floorId: d.floorId ? String(d.floorId) : "", description: d.description || "", sortOrder: d.sortOrder, isActive: d.isActive }); setOpen(true); };
  const onSubmit = () => { if (!form.name.trim()) return; if (editing) update.mutate({ id: editing.id }); else create.mutate(); };
  const activeFloors = floors.filter(f => f.isActive);
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">{rows.length} room{rows.length !== 1 ? "s" : ""}</span>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}><Plus size={13} className="mr-1" /> Add Room</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-left">
          <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Floor</th><th className="px-3 py-2 text-right">Tests</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
        </thead>
        <tbody>
          {isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">No rooms yet — e.g. USG Room, Pathology Counter 1</td></tr>
            : rows.map(d => (
              <tr key={d.id} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{d.name}{d.code ? <span className="ml-1 text-xs font-mono text-muted-foreground">({d.code})</span> : null}</td>
                <td className="px-3 py-2 text-xs">{d.floorName ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-right">{d.testCount}</td>
                <td className="px-3 py-2"><Badge className={d.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}>{d.isActive ? "active" : "inactive"}</Badge></td>
                <td className="px-3 py-2"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => onEdit(d)}><Pencil size={13} /></Button><Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete "${d.name}"?`)) remove.mutate(d.id); }}><Trash2 size={13} className="text-rose-500" /></Button></div></td>
              </tr>
            ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Room" : "Add Room / Counter"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="USG Room 1" /></div>
            <div><Label className="text-xs">Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="USG-1" /></div>
            <div><Label className="text-xs">Floor</Label>
              <Select value={form.floorId || "__none__"} onValueChange={v => setForm({ ...form, floorId: v === "__none__" ? "" : v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No floor</SelectItem>
                  {activeFloors.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Sort Order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
            <div><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 col-span-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button><Button onClick={onSubmit} disabled={!form.name.trim()}>{editing ? "Save" : "Add"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModalitiesSubTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<Modality[]>({ queryKey: ["modalities"], queryFn: () => api.get("/api/modalities") });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Modality | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", sortOrder: 0, isActive: true });
  const reset = () => { setEditing(null); setForm({ name: "", code: "", description: "", sortOrder: 0, isActive: true }); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["modalities"] });
  const create = useMutation({ mutationFn: (b: typeof form) => api.post("/api/modalities", b), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Modality added" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const update = useMutation({ mutationFn: ({ id, b }: { id: number; b: typeof form }) => api.patch(`/api/modalities/${id}`, b), onSuccess: () => { invalidate(); setOpen(false); reset(); toast({ title: "Modality updated" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/api/modalities/${id}`), onSuccess: () => { invalidate(); toast({ title: "Modality deleted" }); }, onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }) });
  const onEdit = (d: Modality) => { setEditing(d); setForm({ name: d.name, code: d.code || "", description: d.description || "", sortOrder: d.sortOrder, isActive: d.isActive }); setOpen(true); };
  const onSubmit = () => { if (!form.name.trim()) return; if (editing) update.mutate({ id: editing.id, b: form }); else create.mutate(form); };
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium">{rows.length} modalit{rows.length !== 1 ? "ies" : "y"}</span>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}><Plus size={13} className="mr-1" /> Add Modality</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-left">
          <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th><th className="px-3 py-2 text-right">Tests</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
        </thead>
        <tbody>
          {isLoading ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">No modalities yet — e.g. X-Ray, USG, MRI, CT, ECG</td></tr>
            : rows.map(d => (
              <tr key={d.id} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium">{d.name}</td>
                <td className="px-3 py-2 text-xs font-mono">{d.code || "—"}</td>
                <td className="px-3 py-2 text-xs text-right">{d.testCount}</td>
                <td className="px-3 py-2"><Badge className={d.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}>{d.isActive ? "active" : "inactive"}</Badge></td>
                <td className="px-3 py-2"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => onEdit(d)}><Pencil size={13} /></Button><Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete "${d.name}"?`)) remove.mutate(d.id); }}><Trash2 size={13} className="text-rose-500" /></Button></div></td>
              </tr>
            ))}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Modality" : "Add Modality"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="USG" /></div>
            <div><Label className="text-xs">Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="USG" /></div>
            <div><Label className="text-xs">Sort Order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm({ ...form, sortOrder: Number(e.target.value) })} /></div>
            <div className="col-span-2"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 col-span-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button><Button onClick={onSubmit} disabled={!form.name.trim()}>{editing ? "Save" : "Add"}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// BRANCHES TAB
// ============================================================
type Branch = {
  id: number; code: string; name: string; address: string | null;
  city: string | null; state: string | null; pincode: string | null;
  phone: string | null; email: string | null; gstin: string | null;
  manager: string | null; isMain: boolean; isActive: boolean; notes: string | null;
};

function BranchesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: rows = [], isLoading } = useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: () => api.get("/api/branches"),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState({ code: "", name: "", address: "", city: "", state: "", pincode: "", phone: "", email: "", gstin: "", manager: "", isMain: false, isActive: true, notes: "" });

  const reset = () => { setEditing(null); setForm({ code: "", name: "", address: "", city: "", state: "", pincode: "", phone: "", email: "", gstin: "", manager: "", isMain: false, isActive: true, notes: "" }); };

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/api/branches", b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branches"] }); setOpen(false); reset(); toast({ title: "Branch added" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: number; b: typeof form }) => api.patch(`/api/branches/${id}`, b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branches"] }); setOpen(false); reset(); toast({ title: "Branch updated" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/branches/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["branches"] }); toast({ title: "Branch deleted" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const onEdit = (b: Branch) => {
    setEditing(b);
    setForm({ code: b.code, name: b.name, address: b.address || "", city: b.city || "", state: b.state || "", pincode: b.pincode || "", phone: b.phone || "", email: b.email || "", gstin: b.gstin || "", manager: b.manager || "", isMain: b.isMain, isActive: b.isActive, notes: b.notes || "" });
    setOpen(true);
  };
  const onSubmit = () => { if (!form.code.trim() || !form.name.trim()) return; if (editing) update.mutate({ id: editing.id, b: form }); else create.mutate(form); };

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><MapPin size={16} /> Branches</h3>
          <p className="text-xs text-muted-foreground mt-1">Multi-branch / multi-location setup. Mark one as the main branch.</p>
        </div>
        <Button onClick={() => { reset(); setOpen(true); }}><Plus size={14} className="mr-1" /> Add Branch</Button>
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-xs">Code</th>
              <th className="px-3 py-2 font-medium text-xs">Name</th>
              <th className="px-3 py-2 font-medium text-xs">Address</th>
              <th className="px-3 py-2 font-medium text-xs">Phone / Email</th>
              <th className="px-3 py-2 font-medium text-xs">GSTIN</th>
              <th className="px-3 py-2 font-medium text-xs">Manager</th>
              <th className="px-3 py-2 font-medium text-xs">Status</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              : rows.length === 0
                ? <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">No branches yet — add your main branch first</td></tr>
                : rows.map(b => (
                  <tr key={b.id} className="border-t border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">{b.code}</td>
                    <td className="px-3 py-2 font-medium">
                      {b.name}
                      {b.isMain && <Badge className="ml-2 bg-violet-100 text-violet-700">Main</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs">{[b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-xs">{b.phone || "—"}<div className="text-[10px] text-muted-foreground">{b.email || ""}</div></td>
                    <td className="px-3 py-2 text-xs font-mono">{b.gstin || "—"}</td>
                    <td className="px-3 py-2 text-xs">{b.manager || "—"}</td>
                    <td className="px-3 py-2"><Badge className={b.isActive ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}>{b.isActive ? "active" : "inactive"}</Badge></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => onEdit(b)}><Pencil size={13} /></Button>
                        <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete ${b.name}?`)) remove.mutate(b.id); }}><Trash2 size={13} className="text-rose-500" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit Branch" : "Add Branch"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Code *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} /></div>
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="col-span-2"><Label className="text-xs">Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label className="text-xs">City</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div><Label className="text-xs">State</Label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            <div><Label className="text-xs">Pincode</Label><Input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label className="text-xs">Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label className="text-xs">GSTIN</Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
            <div><Label className="text-xs">Manager</Label><Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} /></div>
            <div className="col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isMain} onChange={(e) => setForm({ ...form, isMain: e.target.checked })} />
              Main branch
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={onSubmit} disabled={!form.code.trim() || !form.name.trim()}>{editing ? "Save" : "Add"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// REPORT TEMPLATES TAB
// ============================================================
type ReportTemplate = {
  id: number; testId: number; name: string; format: string;
  content: string; isDefault: boolean; tags: string | null; modality: string | null;
};
type LiteTest = { id: number; code: string; name: string; category: string };

function ReportTemplatesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates = [], isLoading } = useQuery<ReportTemplate[]>({
    queryKey: ["report-templates"],
    queryFn: () => api.get("/api/report-templates"),
  });
  const { data: tests = [] } = useQuery<LiteTest[]>({
    queryKey: ["report-templates-tests"],
    queryFn: async () => {
      const r = await api.get<{ tests: LiteTest[]; total: number } | LiteTest[]>("/api/tests");
      return Array.isArray(r) ? r : (r?.tests ?? []);
    },
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReportTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [filterTest, setFilterTest] = useState<string>("");
  const [form, setForm] = useState({ testId: "", name: "", format: "text", content: "", isDefault: false, tags: "", modality: "" });

  const testMap = new Map(tests.map(t => [t.id, t]));

  const reset = () => { setEditing(null); setForm({ testId: "", name: "", format: "text", content: "", isDefault: false, tags: "", modality: "" }); };

  const create = useMutation({
    mutationFn: (b: typeof form) => api.post("/api/report-templates", { ...b, testId: Number(b.testId) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-templates"] }); setOpen(false); reset(); toast({ title: "Template created" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: number; b: typeof form }) => api.patch(`/api/report-templates/${id}`, { ...b, testId: Number(b.testId) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-templates"] }); setOpen(false); reset(); toast({ title: "Template updated" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/report-templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-templates"] }); toast({ title: "Template deleted" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const onEdit = (t: ReportTemplate) => {
    setEditing(t);
    setForm({ testId: String(t.testId), name: t.name, format: t.format, content: t.content, isDefault: t.isDefault, tags: t.tags || "", modality: t.modality || "" });
    setOpen(true);
  };
  const onSubmit = () => {
    if (!form.testId || !form.name.trim() || !form.content.trim()) {
      toast({ title: "Test, name and content are required", variant: "destructive" });
      return;
    }
    if (editing) update.mutate({ id: editing.id, b: form });
    else create.mutate(form);
  };

  const filtered = templates.filter(t => {
    if (filterTest && String(t.testId) !== filterTest) return false;
    if (search) {
      const q = search.toLowerCase();
      const test = testMap.get(t.testId);
      if (!t.name.toLowerCase().includes(q) && !(test?.name.toLowerCase().includes(q)) && !(t.tags || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><FileCode size={16} /> Report Templates</h3>
          <p className="text-xs text-muted-foreground mt-1">Per-test report templates used by Report Generator. Mark one default per test for auto-load.</p>
        </div>
        <Button onClick={() => { reset(); setOpen(true); }}><Plus size={14} className="mr-1" /> New Template</Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Template name, test or tag" className="h-9" />
        </div>
        <div className="min-w-[200px]">
          <Label className="text-xs">Filter by Test</Label>
          <Select value={filterTest || "__all__"} onValueChange={(v) => setFilterTest(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__all__">All tests</SelectItem>
              {tests.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.code} — {t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-xs">Test</th>
              <th className="px-3 py-2 font-medium text-xs">Template Name</th>
              <th className="px-3 py-2 font-medium text-xs">Format</th>
              <th className="px-3 py-2 font-medium text-xs">Modality</th>
              <th className="px-3 py-2 font-medium text-xs">Tags</th>
              <th className="px-3 py-2 font-medium text-xs text-center">Default</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0
                ? <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">No templates {templates.length > 0 ? "matching filters" : "yet — create your first template"}</td></tr>
                : filtered.map(t => {
                  const test = testMap.get(t.testId);
                  return (
                    <tr key={t.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs">{test ? <span><span className="font-mono">{test.code}</span> — {test.name}</span> : `Test #${t.testId}`}</td>
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{t.format}</Badge></td>
                      <td className="px-3 py-2 text-xs">{t.modality || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs truncate" title={t.tags || ""}>{t.tags || "—"}</td>
                      <td className="px-3 py-2 text-center">{t.isDefault ? <Badge className="bg-violet-100 text-violet-700">Default</Badge> : <span className="text-muted-foreground text-xs">—</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => onEdit(t)}><Pencil size={13} /></Button>
                          <Button size="sm" variant="outline" onClick={() => { if (confirm(`Delete "${t.name}"?`)) remove.mutate(t.id); }}><Trash2 size={13} className="text-rose-500" /></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Template" : "New Report Template"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Test *</Label>
              <Select value={form.testId} onValueChange={(v) => setForm({ ...form, testId: v })}>
                <SelectTrigger><SelectValue placeholder="Select test" /></SelectTrigger>
                <SelectContent className="max-h-72">{tests.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.code} — {t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard PA View" /></div>
            <div><Label className="text-xs">Format</Label>
              <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="text">text</SelectItem><SelectItem value="html">html</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Modality</Label><Input value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value })} placeholder="USG, CT, MRI, X-RAY, LAB, ECG…" /></div>
            <div><Label className="text-xs">Tags (comma-separated)</Label><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="fatty liver, hepatomegaly" /></div>
            <div className="col-span-2">
              <Label className="text-xs">Content (use [PLACEHOLDERS]) *</Label>
              <Textarea rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="font-mono text-xs" placeholder="Patient: [PATIENT_NAME]&#10;Age: [AGE]&#10;..." />
            </div>
            <label className="flex items-center gap-2 col-span-2 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Mark as default for this test (auto-loaded by Report Generator)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={onSubmit}>{editing ? "Save" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// OLLAMA SETTINGS CARD — Phase 10C Local Model Configuration
// ============================================================
const OLLAMA_MODELS_KEY = "ollama_known_models";

function OllamaSettingsCard() {
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("llama3");
  const [localOnly, setLocalOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(OLLAMA_MODELS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every((m) => typeof m === "string")) return parsed;
      }
    } catch { /* ignore */ }
    return [];
  });

  useEffect(() => {
    api.get<{ ollamaBaseUrl?: string | null; ollamaModel?: string | null; ollamaLocalOnly?: boolean; ollamaKnownModels?: string }>("/api/clinic-settings")
      .then((d) => {
        setBaseUrl(d.ollamaBaseUrl ?? "");
        setModel(d.ollamaModel ?? "qwen3:8b");
        setLocalOnly(d.ollamaLocalOnly ?? false);
        // Seed availableModels from DB so every workstation gets the dropdown
        // without needing to run "Test Connection" individually.
        if (d.ollamaKnownModels) {
          try {
            const parsed = JSON.parse(d.ollamaKnownModels);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((m) => typeof m === "string")) {
              setAvailableModels(parsed);
              try { localStorage.setItem(OLLAMA_MODELS_KEY, d.ollamaKnownModels); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/api/clinic-settings", {
        ollamaBaseUrl: baseUrl.trim() || null,
        ollamaModel: model.trim() || "qwen3:8b",
        ollamaLocalOnly: localOnly,
      });
      toast({ title: "Ollama settings saved" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!baseUrl.trim()) {
      toast({ title: "Enter a base URL first", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const resp = await api.post<{ ok: boolean; model: string; models?: string[]; modelFound?: boolean; latencyMs?: number; error?: string }>(
        "/api/radiology-ollama/test",
        { baseUrl: baseUrl.trim(), model: model.trim() || "llama3", allowLocal: localOnly }
      );
      if (resp.ok) {
        const pulledModels = resp.models ?? [];
        if (pulledModels.length > 0) {
          setAvailableModels(pulledModels);
          const modelsJson = JSON.stringify(pulledModels);
          try { localStorage.setItem(OLLAMA_MODELS_KEY, modelsJson); } catch { /* ignore */ }
          // Persist to DB so all other workstations see the dropdown immediately.
          api.put("/api/clinic-settings", { ollamaKnownModels: modelsJson }).catch(() => {});
        }
        const detail = [
          resp.modelFound ? `Model "${resp.model}" found` : `Model "${resp.model}" not in list (${pulledModels.slice(0, 3).join(", ")})`,
          resp.latencyMs != null ? `${resp.latencyMs}ms` : null,
        ].filter(Boolean).join(" · ");
        toast({ title: "Ollama connection OK", description: detail });
      } else {
        toast({ title: "Ollama connection failed", description: resp.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: "Test failed", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
      <div>
        <h2 className="font-bold text-lg flex items-center gap-2">
          🦙 Ollama Local Model Configuration (Phase 10C)
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Run privacy-preserving AI locally using Ollama. Requires the <strong>Ollama Local Models</strong> feature flag to be ON.
          All AI output is a draft and requires radiologist review.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <Label className="text-sm">Ollama Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434"
            className="mt-1"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Leave blank to disable. Use the machine's LAN IP if Ollama runs on a separate workstation.</p>
        </div>
        <div>
          <Label className="text-sm">Model Name</Label>
          {availableModels.length > 0 ? (
            <div className="mt-1 space-y-1">
              <select
                value={availableModels.includes(model) ? model : "__custom__"}
                onChange={(e) => { if (e.target.value !== "__custom__") setModel(e.target.value); }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!availableModels.includes(model) && (
                  <option value="__custom__">{model} (custom)</option>
                )}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Models pulled on the Ollama instance. To use a different model, type it below after pulling it with <code className="font-mono">ollama pull &lt;name&gt;</code>.
              </p>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="qwen3:8b"
                className="text-xs h-7"
              />
            </div>
          ) : (
            <>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Recommended for radiology: <code className="font-mono">qwen3:14b</code> (best quality) or <code className="font-mono">qwen3:8b</code> (faster). Pull on Windows PC: <code className="font-mono">ollama pull qwen3:8b</code>. Click "Test Connection" to see available models.</p>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} className="h-4 w-4" />
          <div>
            <span className="text-sm font-medium">Local-only mode</span>
            <p className="text-[11px] text-muted-foreground">Disable cloud AI fallback — use Ollama exclusively. Useful for strict data-residency environments.</p>
          </div>
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Ollama Settings"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} type="button">
          {testing ? "Testing..." : "Test Connection"}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// RADIOLOGY SETTINGS TAB — Productivity Tools
// ============================================================
function RadiologySettingsTab() {
  const [quickAdd, setQuickAdd] = useState(() => isFeatureEnabled("radiologyQuickAdd"));
  const [smartFormat, setSmartFormat] = useState(() => isFeatureEnabled("radiologySmartFormat"));
  const [previousReports, setPreviousReports] = useState(() => isFeatureEnabled("radiologyPreviousReports"));
  const [favorites, setFavorites] = useState(() => isFeatureEnabled("radiologyFavorites"));
  const [macros, setMacros] = useState(() => isFeatureEnabled("radiologyMacros"));
  const [measurements, setMeasurements] = useState(() => isFeatureEnabled("radiologyMeasurements"));
  const [aiAssistant, setAiAssistant] = useState(() => isFeatureEnabled("radiologyAiAssistant") !== false);

  // Phase 2D intelligence flags
  const [structuredFindings, setStructuredFindings] = useState(() => isFeatureEnabled("radiologyStructuredFindings"));
  const [impressionSync, setImpressionSync] = useState(() => isFeatureEnabled("radiologyImpressionSync"));
  const [conflictDetection, setConflictDetection] = useState(() => isFeatureEnabled("radiologyConflictDetection"));
  const [qualityChecker, setQualityChecker] = useState(() => isFeatureEnabled("radiologyQualityChecker"));
  const [smartImpression, setSmartImpression] = useState(() => isFeatureEnabled("radiologySmartImpression"));
  const [measurementLibrary, setMeasurementLibrary] = useState(() => isFeatureEnabled("radiologyMeasurementLibrary"));
  const [priorityEngine, setPriorityEngine] = useState(() => isFeatureEnabled("radiologyPriorityEngine"));
  const [comparison, setComparison] = useState(() => isFeatureEnabled("radiologyComparison"));
  const [favoritesPack, setFavoritesPack] = useState(() => isFeatureEnabled("radiologyFavoritesPack"));
  const [knowledgeBase, setKnowledgeBase] = useState(() => isFeatureEnabled("radiologyKnowledgeBase"));
  const [versionHistory, setVersionHistory] = useState(() => isFeatureEnabled("radiologyVersionHistory"));
  const [analytics, setAnalytics] = useState(() => isFeatureEnabled("radiologyAnalytics"));

  // Phase 3: Premium Radiology Workstation flags
  const [masterLibrary, setMasterLibrary] = useState(() => isFeatureEnabled("radiologyMasterLibrary"));
  const [oneClickReports, setOneClickReports] = useState(() => isFeatureEnabled("radiologyOneClickReports"));
  const [advancedMeasurements, setAdvancedMeasurements] = useState(() => isFeatureEnabled("radiologyAdvancedMeasurements"));
  const [aiHooks, setAiHooks] = useState(() => isFeatureEnabled("radiologyAiHooks"));
  // Chunk 2
  const [reportAssembler, setReportAssembler] = useState(() => isFeatureEnabled("radiologyReportAssembler"));
  const [qaGuard, setQAGuard] = useState(() => isFeatureEnabled("radiologyQAGuard"));
  const [finalizationDashboard, setFinalizationDashboard] = useState(() => isFeatureEnabled("radiologyFinalizationDashboard"));
  // Phase 4: Knowledge Platform
  const [knowledgePlatform, setKnowledgePlatform] = useState(() => isFeatureEnabled("radiologyKnowledgePlatform"));
  const [masterTemplates, setMasterTemplates] = useState(() => isFeatureEnabled("radiologyMasterTemplates"));
  const [personalLibrary, setPersonalLibrary] = useState(() => isFeatureEnabled("radiologyPersonalLibrary"));
  const [templatePacks, setTemplatePacks] = useState(() => isFeatureEnabled("radiologyTemplatePacks"));
  const [knowledgeBase_v2, setKnowledgeBase_v2] = useState(() => isFeatureEnabled("radiologyKnowledgeBase_v2"));
  const [signOffProfiles, setSignOffProfiles] = useState(() => isFeatureEnabled("radiologySignOffProfiles"));
  const [templateAnalytics, setTemplateAnalytics] = useState(() => isFeatureEnabled("radiologyTemplateAnalytics"));
  // Phase 5: Structured Smart Reporting Engine
  const [smartFindings_v2, setSmartFindings_v2] = useState(() => isFeatureEnabled("radiologySmartFindings_v2"));
  const [impressionRules, setImpressionRules] = useState(() => isFeatureEnabled("radiologyImpressionRules"));
  const [favoriteFindingSets, setFavoriteFindingSets] = useState(() => isFeatureEnabled("radiologyFavoriteFindingSets"));
  const [smartAnalytics, setSmartAnalytics] = useState(() => isFeatureEnabled("radiologySmartAnalytics"));
  // Phase 6: Multi-AI Copilot
  const [aiCopilot, setAiCopilot] = useState(() => isFeatureEnabled("radiologyAICopilot"));
  const [multiAI, setMultiAI] = useState(() => isFeatureEnabled("radiologyMultiAI"));
  const [imageReview, setImageReview] = useState(() => isFeatureEnabled("radiologyImageReview"));
  const [differentialDiagnosis, setDifferentialDiagnosis] = useState(() => isFeatureEnabled("radiologyDifferentialDiagnosis"));
  const [qualityCheck, setQualityCheck] = useState(() => isFeatureEnabled("radiologyQualityCheck"));
  const [comparePrevious, setComparePrevious] = useState(() => isFeatureEnabled("radiologyComparePrevious"));
  const [promptManager, setPromptManager] = useState(() => isFeatureEnabled("radiologyPromptManager"));
  const [followUp, setFollowUp] = useState(() => isFeatureEnabled("radiologyFollowUp"));
  const [languagePolish, setLanguagePolish] = useState(() => isFeatureEnabled("radiologyLanguagePolish"));

  // Phase 7A: Advanced Multi-AI Radiology Assistant
  const [promptManager_v2, setPromptManager_v2] = useState(() => isFeatureEnabled("radiologyPromptManager_v2"));
  const [imageReviewAssistant, setImageReviewAssistant] = useState(() => isFeatureEnabled("radiologyImageReviewAssistant"));
  const [aiComparison, setAiComparison] = useState(() => isFeatureEnabled("radiologyAIComparison"));
  const [missedFindingDetector, setMissedFindingDetector] = useState(() => isFeatureEnabled("radiologyMissedFindingDetector"));
  const [providerRouting, setProviderRouting] = useState(() => isFeatureEnabled("radiologyProviderRouting"));
  const [providerFallback, setProviderFallback] = useState(() => isFeatureEnabled("radiologyProviderFallback"));
  // Phase 8: DICOM-Aware Radiology Copilot + Teaching Files
  const [priorComparison, setPriorComparison] = useState(() => isFeatureEnabled("radiologyPriorComparison"));
  const [measurementTracker, setMeasurementTracker] = useState(() => isFeatureEnabled("radiologyMeasurementTracker"));
  const [smartImpression_v2, setSmartImpression_v2] = useState(() => isFeatureEnabled("radiologySmartImpression_v2"));
  const [consistencyChecker, setConsistencyChecker] = useState(() => isFeatureEnabled("radiologyConsistencyChecker"));
  const [followupAssistant, setFollowupAssistant] = useState(() => isFeatureEnabled("radiologyFollowupAssistant"));
  const [dicomMetadataAssistant, setDicomMetadataAssistant] = useState(() => isFeatureEnabled("radiologyDicomMetadataAssistant"));
  const [structuredReporting, setStructuredReporting] = useState(() => isFeatureEnabled("radiologyStructuredReporting"));
  const [teachingMode, setTeachingMode] = useState(() => isFeatureEnabled("radiologyTeachingMode"));
  const [teachingFiles, setTeachingFiles] = useState(() => isFeatureEnabled("radiologyTeachingFiles"));
  const [teachingAI, setTeachingAI] = useState(() => isFeatureEnabled("radiologyTeachingAI"));
  const [teachingCollections, setTeachingCollections] = useState(() => isFeatureEnabled("radiologyTeachingCollections"));
  const [teachingPresentation, setTeachingPresentation] = useState(() => isFeatureEnabled("radiologyTeachingPresentation"));
  const [teachingResearch, setTeachingResearch] = useState(() => isFeatureEnabled("radiologyTeachingResearch"));
  // Phase 10: DICOM Image Intelligence Platform
  const [dicomImageIntelligence, setDicomImageIntelligence] = useState(() => isFeatureEnabled("dicomImageIntelligence"));
  const [lesionTracking, setLesionTracking] = useState(() => isFeatureEnabled("lesionTracking"));
  const [changeDetection, setChangeDetection] = useState(() => isFeatureEnabled("changeDetection"));
  const [spineIntelligence, setSpineIntelligence] = useState(() => isFeatureEnabled("spineIntelligence"));
  const [brainIntelligence, setBrainIntelligence] = useState(() => isFeatureEnabled("brainIntelligence"));
  const [tumorFollowup, setTumorFollowup] = useState(() => isFeatureEnabled("tumorFollowup"));
  const [imageAnnotations, setImageAnnotations] = useState(() => isFeatureEnabled("imageAnnotations"));
  const [researchDatabase, setResearchDatabase] = useState(() => isFeatureEnabled("researchDatabase"));
  const [teachingGenerator, setTeachingGenerator] = useState(() => isFeatureEnabled("teachingGenerator"));
  const [multiAIImageReview, setMultiAIImageReview] = useState(() => isFeatureEnabled("multiAIImageReview"));
  const [measurementAssistantFlag, setMeasurementAssistantFlag] = useState(() => isFeatureEnabled("measurementAssistant"));
  const [confidenceVisualization, setConfidenceVisualization] = useState(() => isFeatureEnabled("confidenceVisualization"));
  const [ollamaSupport, setOllamaSupport] = useState(() => isFeatureEnabled("ollamaSupport"));
  const [caseOfMonth, setCaseOfMonth] = useState(() => isFeatureEnabled("caseOfMonth"));
  const [annotationLayer, setAnnotationLayer] = useState(() => isFeatureEnabled("annotationLayer"));

  // Phase 9: Radiology Memory + Context Engine
  const [memoryEngine, setMemoryEngine] = useState(() => isFeatureEnabled("radiologyMemoryEngine"));
  const [styleLearning, setStyleLearning] = useState(() => isFeatureEnabled("radiologyStyleLearning"));
  const [impressionMemory, setImpressionMemory] = useState(() => isFeatureEnabled("radiologyImpressionMemory"));
  const [measurementMemory, setMeasurementMemory] = useState(() => isFeatureEnabled("radiologyMeasurementMemory"));
  const [decisionMemory, setDecisionMemory] = useState(() => isFeatureEnabled("radiologyDecisionMemory"));
  const [feedbackLoop, setFeedbackLoop] = useState(() => isFeatureEnabled("radiologyFeedbackLoop"));
  const [caseMemory, setCaseMemory] = useState(() => isFeatureEnabled("radiologyCaseMemory"));
  const [analyticsMemory, setAnalyticsMemory] = useState(() => isFeatureEnabled("radiologyAnalyticsMemory"));
  const [macroEngine, setMacroEngine] = useState(() => isFeatureEnabled("radiologyMacroEngine"));

  const toggles = [
    { id: "radiologyQuickAdd", label: "Quick Add Buttons", desc: "Alt+1-6 shortcut buttons for instant insertion of common findings", value: quickAdd, set: setQuickAdd },
    { id: "radiologySmartFormat", label: "Smart Format Templates", desc: "Shift+Alt+1-5 shortcuts for full study templates", value: smartFormat, set: setSmartFormat },
    { id: "radiologyPreviousReports", label: "Previous Reports Lookup", desc: "Compare and reference prior patient imaging", value: previousReports, set: setPreviousReports },
    { id: "radiologyFavorites", label: "Favorites & Templates", desc: "Personal and shared saved findings", value: favorites, set: setFavorites },
    { id: "radiologyMacros", label: "Macro Engine", desc: "Type /fl1, /faz1, /disc etc. to expand into full text", value: macros, set: setMacros },
    { id: "radiologyMeasurements", label: "Measurements Panel", desc: "Visual measurement and annotation tools", value: measurements, set: setMeasurements },
    { id: "radiologyAiAssistant", label: "AI Draft Assistant", desc: "Gemini-powered impression generation (disabled for sensitive reporting)", value: aiAssistant, set: setAiAssistant },
  ];

  const intelligenceToggles = [
    { id: "radiologyStructuredFindings", label: "Structured Findings", desc: "Insert paired findings + impression blocks", value: structuredFindings, set: setStructuredFindings },
    { id: "radiologyImpressionSync", label: "Impression Auto-Sync", desc: "Auto-suggest impressions as you type findings", value: impressionSync, set: setImpressionSync },
    { id: "radiologyConflictDetection", label: "Conflict Detection", desc: "Warn when contradictory findings are present", value: conflictDetection, set: setConflictDetection },
    { id: "radiologyQualityChecker", label: "Quality Checker", desc: "Pre-finalize checks: placeholders, duplicates, missing impression", value: qualityChecker, set: setQualityChecker },
    { id: "radiologySmartImpression", label: "Smart Impression", desc: "Combine multiple findings into coherent impression", value: smartImpression, set: setSmartImpression },
    { id: "radiologyMeasurementLibrary", label: "Measurement Library", desc: "One-click measurement templates (canal, lesion, BPD, etc.)", value: measurementLibrary, set: setMeasurementLibrary },
    { id: "radiologyPriorityEngine", label: "Priority Engine", desc: "Auto-classify: NORMAL / MINOR / SIGNIFICANT / CRITICAL", value: priorityEngine, set: setPriorityEngine },
    { id: "radiologyComparison", label: "Previous Report Comparison", desc: "Auto-detect changes vs prior study", value: comparison, set: setComparison },
    { id: "radiologyFavoritesPack", label: "Favorites Report Packs", desc: "Save entire report (findings + impression) for reuse", value: favoritesPack, set: setFavoritesPack },
    { id: "radiologyKnowledgeBase", label: "Knowledge Base", desc: "Searchable teaching library with tags", value: knowledgeBase, set: setKnowledgeBase },
    { id: "radiologyVersionHistory", label: "Version History", desc: "Track edits, timestamps, and restore drafts", value: versionHistory, set: setVersionHistory },
    { id: "radiologyAnalytics", label: "Reporting Analytics", desc: "Per-radiologist stats and template usage", value: analytics, set: setAnalytics },
  ];

  const advancedToggles = [
    { id: "radiologyMasterLibrary", label: "Master Template Library", desc: "Locked Dr. Sugandha master templates with one-click variants", value: masterLibrary, set: setMasterLibrary },
    { id: "radiologyOneClickReports", label: "One-Click Complete Reports", desc: "Instant full report generation from master variants", value: oneClickReports, set: setOneClickReports },
    { id: "radiologyAdvancedMeasurements", label: "Advanced Measurement Library", desc: "One-click measurement templates with normal ranges", value: advancedMeasurements, set: setAdvancedMeasurements },
    { id: "radiologyAiHooks", label: "AI-Ready Infrastructure", desc: "Future hooks for voice dictation, AI drafting, and AI comparison", value: aiHooks, set: setAiHooks },
    { id: "radiologyReportAssembler", label: "Report Assembler", desc: "Multi-template selection with auto-combination and deduplication", value: reportAssembler, set: setReportAssembler },
    { id: "radiologyQAGuard", label: "QA Guard", desc: "Comprehensive pre-finalize checks with score and warnings", value: qaGuard, set: setQAGuard },
    { id: "radiologyFinalizationDashboard", label: "Finalization Dashboard", desc: "Final checkpoint before signing with quality score and alerts", value: finalizationDashboard, set: setFinalizationDashboard },
  ];

  const knowledgePlatformToggles = [
    { id: "radiologyKnowledgePlatform", label: "Knowledge Platform", desc: "Enable all Phase 4 knowledge features", value: knowledgePlatform, set: setKnowledgePlatform },
    { id: "radiologyMasterTemplates", label: "Master Templates", desc: "DB-backed master templates with version control (Dr. Sugandha / Dr. Abinash / Care / Hope)", value: masterTemplates, set: setMasterTemplates },
    { id: "radiologyPersonalLibrary", label: "Personal Template Library", desc: "Save, edit, and organize your own templates with folders", value: personalLibrary, set: setPersonalLibrary },
    { id: "radiologyTemplatePacks", label: "Template Packs", desc: "Create and apply reusable multi-template packs", value: templatePacks, set: setTemplatePacks },
    { id: "radiologyKnowledgeBase_v2", label: "Knowledge Base v2", desc: "Searchable DB-backed articles with classification systems", value: knowledgeBase_v2, set: setKnowledgeBase_v2 },
    { id: "radiologySignOffProfiles", label: "Sign-Off Profiles", desc: "Per-radiologist default settings and preferences", value: signOffProfiles, set: setSignOffProfiles },
    { id: "radiologyTemplateAnalytics", label: "Template Analytics", desc: "Usage tracking and per-radiologist template statistics", value: templateAnalytics, set: setTemplateAnalytics },
  ];

  const aiCopilotToggles = [
    { id: "radiologyAICopilot", label: "AI Copilot Panel", desc: "Unified AI copilot panel with draft generation, differential, follow-up, quality check", value: aiCopilot, set: setAiCopilot },
    { id: "radiologyMultiAI", label: "Multi-AI Provider Routing", desc: "Route different tasks to different AI providers (OpenAI, Gemini, Claude, Ollama, OpenRouter)", value: multiAI, set: setMultiAI },
    { id: "radiologyDifferentialDiagnosis", label: "Differential Diagnosis", desc: "Structured differential diagnosis suggestions with confidence levels", value: differentialDiagnosis, set: setDifferentialDiagnosis },
    { id: "radiologyFollowUp", label: "Follow-Up Recommendations", desc: "Condition-based follow-up and surveillance recommendations", value: followUp, set: setFollowUp },
    { id: "radiologyImageReview", label: "Image Review Assistant", desc: "Vision-capable AI secondary review and missed finding suggestions", value: imageReview, set: setImageReview },
    { id: "radiologyComparePrevious", label: "Previous Report Comparison", desc: "Side-by-side comparison with new findings and progression highlights", value: comparePrevious, set: setComparePrevious },
    { id: "radiologyQualityCheck", label: "AI Quality Checker", desc: "Detect missing impression, measurements, contradictions, and errors", value: qualityCheck, set: setQualityCheck },
    { id: "radiologyLanguagePolish", label: "Language Polish & Formatting", desc: "Refine report language, grammar, and formatting without changing medical content", value: languagePolish, set: setLanguagePolish },
    { id: "radiologyPromptManager", label: "Prompt Manager", desc: "Admin-editable prompt library with version history and testing", value: promptManager, set: setPromptManager },
  ];

  const phase7aToggles = [
    { id: "radiologyPromptManager_v2", label: "AI Prompt Manager v2", desc: "Enterprise prompt library with 9 prompt types per category, versioning, doctor-specific libraries, and JSON import/export", value: promptManager_v2, set: setPromptManager_v2 },
    { id: "radiologyImageReviewAssistant", label: "Image Review Assistant", desc: "Vision-capable AI secondary review with structured findings, differential, missed findings, and confidence scores", value: imageReviewAssistant, set: setImageReviewAssistant },
    { id: "radiologyAIComparison", label: "AI Comparison Workspace", desc: "Run same prompt against multiple providers side-by-side with performance stats", value: aiComparison, set: setAiComparison },
    { id: "radiologyMissedFindingDetector", label: "Missed Finding Detector", desc: "Critical finding detection for MRI Brain, Spine, CT, Chest, and Abdomen", value: missedFindingDetector, set: setMissedFindingDetector },
    { id: "radiologyProviderRouting", label: "AI Provider Routing", desc: "Assign different AI providers to different radiology tasks (image review → Gemini, findings → GPT, etc.)", value: providerRouting, set: setProviderRouting },
    { id: "radiologyProviderFallback", label: "Provider Fallback", desc: "Configurable fallback chain when primary provider fails (Gemini → GPT → Claude)", value: providerFallback, set: setProviderFallback },
  ];

  const smartReportingToggles = [
    { id: "radiologySmartFindings_v2", label: "Smart Findings v2", desc: "Structured, deterministic findings builder for MRI Brain, Cervical/Lumbar Spine, USG Abdomen", value: smartFindings_v2, set: setSmartFindings_v2 },
    { id: "radiologyImpressionRules", label: "Impression Rules", desc: "Admin-editable rule-based impression generator", value: impressionRules, set: setImpressionRules },
    { id: "radiologyFavoriteFindingSets", label: "Favorite Finding Sets", desc: "Save and reuse common structured findings per user", value: favoriteFindingSets, set: setFavoriteFindingSets },
    { id: "radiologySmartAnalytics", label: "Smart Reporting Analytics", desc: "Track smart findings usage, report time, and builder statistics", value: smartAnalytics, set: setSmartAnalytics },
  ];

  const phase8Toggles = [
    { id: "radiologyPriorComparison", label: "Prior Study Auto-Fetch", desc: "Automatically search and display prior studies for the same patient, modality, and body part", value: priorComparison, set: setPriorComparison },
    { id: "radiologyMeasurementTracker", label: "Measurement Tracker", desc: "Track measurement history across studies with trend display and change detection", value: measurementTracker, set: setMeasurementTracker },
    { id: "radiologySmartImpression_v2", label: "Smart Impression Builder", desc: "Generate impression directly from findings with editable output", value: smartImpression_v2, set: setSmartImpression_v2 },
    { id: "radiologyConsistencyChecker", label: "Consistency Checker", desc: "Detect mismatches between findings and impression (side, level, measurements)", value: consistencyChecker, set: setConsistencyChecker },
    { id: "radiologyFollowupAssistant", label: "Follow-up Intelligence", desc: "Guideline-based follow-up suggestions for BI-RADS, TI-RADS, PI-RADS, etc.", value: followupAssistant, set: setFollowupAssistant },
    { id: "radiologyDicomMetadataAssistant", label: "DICOM Metadata Assistant", desc: "Auto-read DICOM metadata and generate technique section", value: dicomMetadataAssistant, set: setDicomMetadataAssistant },
    { id: "radiologyStructuredReporting", label: "Structured Reporting Engine", desc: "One-click templates for all major studies with AI-fillable sections", value: structuredReporting, set: setStructuredReporting },
    { id: "radiologyTeachingMode", label: "Teaching Mode", desc: "Educational explanations with WHY button and learning references", value: teachingMode, set: setTeachingMode },
    { id: "radiologyTeachingFiles", label: "Teaching Files Platform", desc: "Save, search, and organize anonymized teaching cases", value: teachingFiles, set: setTeachingFiles },
    { id: "radiologyTeachingAI", label: "AI Teaching Assistant", desc: "Generate teaching summaries, learning points, and exam questions", value: teachingAI, set: setTeachingAI },
    { id: "radiologyTeachingCollections", label: "Teaching Collections", desc: "Create and share curated case collections", value: teachingCollections, set: setTeachingCollections },
    { id: "radiologyTeachingPresentation", label: "Presentation Mode", desc: "Generate teaching slides, quizzes, and unknown cases", value: teachingPresentation, set: setTeachingPresentation },
    { id: "radiologyTeachingResearch", label: "Research Mode", desc: "Track research candidates, publications, and conference submissions", value: teachingResearch, set: setTeachingResearch },
  ];

  const phase10Toggles = [
    { id: "dicomImageIntelligence", label: "DICOM Image Intelligence (Master Switch)", desc: "Enable the Phase 10 DICOM Image Intelligence Platform. All sub-features still require individual toggles.", value: dicomImageIntelligence, set: setDicomImageIntelligence },
    { id: "lesionTracking", label: "Lesion Tracker", desc: "Longitudinal lesion monitoring — track lesions across studies with size, signal, and status trends", value: lesionTracking, set: setLesionTracking },
    { id: "changeDetection", label: "Smart Change Detector", desc: "Automatically detect interval changes: new lesions, growth, regression, haemorrhage evolution, edema, hydrocephalus", value: changeDetection, set: setChangeDetection },
    { id: "measurementAssistant", label: "Structured Measurement Assistant", desc: "Guided measurement entry for MRI Brain, MRI Spine, Breast, Thyroid, Liver, Kidney, Lung, Pelvis with normal ranges", value: measurementAssistantFlag, set: setMeasurementAssistantFlag },
    { id: "spineIntelligence", label: "Spine Intelligence (Phase 10B)", desc: "Automated disc grading, canal stenosis classification, neural foraminal narrowing — all OFF until Phase 10B builds", value: spineIntelligence, set: setSpineIntelligence },
    { id: "brainIntelligence", label: "Brain Intelligence (Phase 10B)", desc: "Fazekas scoring, atrophy grading, lesion load, white matter classification — all OFF until Phase 10B builds", value: brainIntelligence, set: setBrainIntelligence },
    { id: "tumorFollowup", label: "Tumor Follow-up Engine (Phase 10B)", desc: "RECIST-guided measurement tracking, treatment response assessment, volumetric analysis — all OFF until Phase 10B", value: tumorFollowup, set: setTumorFollowup },
    { id: "imageAnnotations", label: "Image Annotation Layer (Phase 10B)", desc: "Text annotations on DICOM images with report linking — OFF until Phase 10B builds", value: imageAnnotations, set: setImageAnnotations },
    { id: "multiAIImageReview", label: "Multi-AI Image Review (Phase 10C)", desc: "Parallel AI review across multiple providers for secondary opinion — OFF until Phase 10C builds", value: multiAIImageReview, set: setMultiAIImageReview },
    { id: "teachingGenerator", label: "Teaching Case Generator (Phase 10C)", desc: "Auto-generate teaching summaries and exam questions from cases — OFF until Phase 10C builds", value: teachingGenerator, set: setTeachingGenerator },
    { id: "researchDatabase", label: "Research Database (Phase 10C)", desc: "Case tagging, cohort building, and anonymized research export — OFF until Phase 10C builds", value: researchDatabase, set: setResearchDatabase },
    { id: "caseOfMonth", label: "Case of the Month (Phase 10C)", desc: "Editorial workflow for selecting and publishing monthly teaching cases — OFF until Phase 10C builds", value: caseOfMonth, set: setCaseOfMonth },
    { id: "confidenceVisualization", label: "AI Confidence Visualization (Phase 10C)", desc: "Show confidence scores as colour-coded bars on every AI suggestion — OFF until Phase 10C builds", value: confidenceVisualization, set: setConfidenceVisualization },
    { id: "ollamaSupport", label: "Ollama Local Models (Phase 10C)", desc: "Run privacy-preserving AI locally via Ollama — OFF until Phase 10C builds", value: ollamaSupport, set: setOllamaSupport },
    { id: "annotationLayer", label: "Report Annotation Layer (Phase 10C)", desc: "Highlight text in reports and link annotations to image coordinates — OFF until Phase 10C builds", value: annotationLayer, set: setAnnotationLayer },
  ];

  const phase9Toggles = [
    { id: "radiologyMemoryEngine", label: "Radiology Memory Engine", desc: "Persistent memory that learns reporting preferences over time (styles, phrases, measurements)", value: memoryEngine, set: setMemoryEngine },
    { id: "radiologyStyleLearning", label: "Style Learning", desc: "Learn preferred wording, impression style, formatting, and terminology per radiologist", value: styleLearning, set: setStyleLearning },
    { id: "radiologyImpressionMemory", label: "Impression Memory", desc: "Store approved impressions and suggest them when similar findings appear", value: impressionMemory, set: setImpressionMemory },
    { id: "radiologyMeasurementMemory", label: "Measurement Memory", desc: "Track measurement history across studies with trend graphs", value: measurementMemory, set: setMeasurementMemory },
    { id: "radiologyDecisionMemory", label: "Decision Memory", desc: "Track accepted, rejected, and edited AI suggestions to learn preferences", value: decisionMemory, set: setDecisionMemory },
    { id: "radiologyFeedbackLoop", label: "AI Feedback Loop", desc: "Useful / Not Useful / Partially Useful buttons for all AI suggestions", value: feedbackLoop, set: setFeedbackLoop },
    { id: "radiologyCaseMemory", label: "Case Memory Linking", desc: "Connect current report to teaching files, research cases, and prior reports", value: caseMemory, set: setCaseMemory },
    { id: "radiologyAnalyticsMemory", label: "Personal Analytics", desc: "Dr Sugandha dashboard with most used templates, phrases, and time saved", value: analyticsMemory, set: setAnalyticsMemory },
    { id: "radiologyMacroEngine", label: "Personal Macro Engine", desc: "Shortcuts like /normalbrain, /l4l5disc, /fazekas2 for instant insertion", value: macroEngine, set: setMacroEngine },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><ScanLine size={16} /> Radiology Productivity Tools</h2>
          <p className="text-sm text-muted-foreground mt-1">Enable or disable productivity features in the Radiology Report workspace. All are local to this device and stored in browser preferences.</p>
        </div>
        <div className="space-y-2">
          {toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 3: Advanced Productivity */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Sparkles size={16} /> Advanced Productivity</h2>
          <p className="text-sm text-muted-foreground mt-1">Premium workstation features: master templates, one-click reports, advanced measurements, and AI-ready infrastructure.</p>
        </div>
        <div className="space-y-2">
          {advancedToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 4: Radiology Knowledge Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><BookOpen size={16} /> Radiology Knowledge Platform</h2>
          <p className="text-sm text-muted-foreground mt-1">Database-backed master templates, personal libraries, knowledge articles, version control, and analytics.</p>
        </div>
        <div className="space-y-2">
          {knowledgePlatformToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 6: AI Copilot Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Bot size={16} /> AI Copilot Platform</h2>
          <p className="text-sm text-muted-foreground mt-1">Multi-AI provider copilot for radiology. Supports OpenAI, Gemini, Claude, Ollama, OpenRouter. All AI outputs are editable and require radiologist review.</p>
        </div>
        <div className="space-y-2">
          {aiCopilotToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 7A: Advanced Multi-AI Radiology Assistant */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Advanced Multi-AI Radiology Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1">Enterprise-grade prompt management, multi-provider task routing, AI comparison workspace, image review, missed finding detection, and provider fallback. All OFF by default.</p>
        </div>
        <div className="space-y-2">
          {phase7aToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 8: DICOM-Aware Radiology Copilot + Teaching Files */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><GraduationCap size={16} /> DICOM Radiology Copilot + Teaching</h2>
          <p className="text-sm text-muted-foreground mt-1">Enterprise RIS/PACS-integrated copilot with prior study comparison, measurement tracking, structured reporting, teaching files, and research mode. All OFF by default.</p>
        </div>
        <div className="space-y-2">
          {phase8Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 10: DICOM Image Intelligence Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> DICOM Image Intelligence Platform (Phase 10)</h2>
          <p className="text-sm text-muted-foreground mt-1">Lesion Tracker, Change Detector, Measurement Assistant, Organ Intelligence, and AI Research Tools. All OFF by default. Phase 10B/C flags are placeholders — activate only when that phase ships. Radiologist is always final authority.</p>
        </div>
        <div className="space-y-2">
          {phase10Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 10C: Ollama Local Model Configuration */}
      <OllamaSettingsCard />

      {/* Phase 9: Radiology Memory + Context Engine */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Radiology Memory + Context Engine</h2>
          <p className="text-sm text-muted-foreground mt-1">Learns Dr Sugandha's reporting preferences over time. All features OFF by default. Radiologist is always final authority.</p>
        </div>
        <div className="space-y-2">
          {phase9Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 5: Structured Smart Reporting Engine */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Construction size={16} /> Structured Smart Reporting</h2>
          <p className="text-sm text-muted-foreground mt-1">Deterministic, rules-based text generation for MRI Brain, Cervical/Lumbar Spine, and USG Abdomen. All generated text is editable and auditable. No AI.</p>
        </div>
        <div className="space-y-2">
          {smartReportingToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 2D Intelligence Layer */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Radiology Intelligence Layer</h2>
          <p className="text-sm text-muted-foreground mt-1">Advanced client-side tools for quality, structure, and efficiency. All run locally with no external API calls.</p>
        </div>
        <div className="space-y-2">
          {intelligenceToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Keyboard shortcuts reference */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Keyboard size={16} /> Keyboard Shortcuts</h2>
          <p className="text-sm text-muted-foreground mt-1">Quick reference for the radiologist workspace.</p>
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Quick Add Buttons</span>
            <span className="font-mono text-xs text-muted-foreground">Alt + 1-6</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Smart Format Templates</span>
            <span className="font-mono text-xs text-muted-foreground">Shift + Alt + 1-5</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Macro Expansion</span>
            <span className="font-mono text-xs text-muted-foreground">/shortcut + Space</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Favorites Panel</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + F</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Previous Reports</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + P</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Measurements Panel</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + M</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BACKUP TAB
// ============================================================
type BackupLog = {
  id: number; backupType: string; status: string; format: string;
  rowCount: number | null; sizeBytes: number | null; errorMessage: string | null;
  performedBy: string | null; createdAt: string;
};

function BackupTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const superAdmin = useSuperAdmin();
  const saToken = getSuperAdminToken();

  const { data: logs = [] } = useQuery<BackupLog[]>({
    queryKey: ["backup-logs"],
    queryFn: () => fetchApi<BackupLog[]>("/api/backup/logs", {
      headers: saToken ? { "x-sa-token": saToken } : {}
    }),
    enabled: !!superAdmin.isActive && !!saToken,
    refetchInterval: 5000,
  });

  const { data: info } = useQuery<{ tables: string[] }>({
    queryKey: ["backup-info"],
    queryFn: () => fetchApi<{ tables: string[] }>("/api/backup/info", {
      headers: saToken ? { "x-sa-token": saToken } : {}
    }),
    enabled: !!superAdmin.isActive && !!saToken,
  });

  const [running, setRunning] = useState(false);

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(2)} MB`;
  };

  const runBackup = async () => {
    setRunning(true);
    try {
      const token = JSON.parse(localStorage.getItem("erp_session") || "{}").token as string | undefined;
      const res = await fetch("/api/backup/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(saToken ? { "x-sa-token": saToken } : {}),
        },
        body: JSON.stringify({ performedBy: "user" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Backup failed");
      }
      const blob = await res.blob();
      const filename = res.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1] || `care_diagnostics_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json.enc`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded", description: filename });
      qc.invalidateQueries({ queryKey: ["backup-logs"] });
    } catch (err) {
      toast({ title: "Backup failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  if (!superAdmin.isActive) {
    return (
      <div className="max-w-2xl space-y-4">
        <div className="border border-dashed border-rose-200 dark:border-rose-900/50 rounded-xl p-6 bg-rose-50/30 dark:bg-rose-950/10">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={18} className="text-rose-600 dark:text-rose-400" />
            <span className="text-sm font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400">Super Admin Actions Locked</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            To view backup logs or trigger a database backup, you must open the Super Admin Portal and generate a valid session token first.
          </p>
          <a
            href="/super-admin-portal/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button size="sm" variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/30 whitespace-nowrap">
              <ExternalLink size={13} className="mr-1.5" /> Open Super Admin Portal
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold flex items-center gap-2"><Database size={16} /> Master Data Backup</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Download a JSON snapshot of master data and configuration (settings, users, doctors, tests, templates, departments, branches, machines, AMC contracts, etc.).
          For full Postgres-level backups (including transactional data like patients/orders/bills), use <code className="bg-muted px-1 rounded">pg_dump</code> against your DATABASE_URL.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={runBackup} disabled={running}>
            {running ? <RefreshCcw size={14} className="mr-1 animate-spin" /> : <Download size={14} className="mr-1" />}
            {running ? "Generating…" : "Run Backup & Download"}
          </Button>
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["backup-logs"] })}>
            <RefreshCcw size={14} className="mr-1" /> Refresh log
          </Button>
        </div>
        {info && (
          <div className="mt-3 text-[11px] text-muted-foreground">
            <span className="font-medium">Included tables ({info.tables.length}):</span> {info.tables.join(" · ")}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h4 className="font-medium text-sm">Backup History</h4>
          <span className="text-[11px] text-muted-foreground">last 50 runs</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-xs">When</th>
              <th className="px-3 py-2 font-medium text-xs">Type</th>
              <th className="px-3 py-2 font-medium text-xs">Status</th>
              <th className="px-3 py-2 font-medium text-xs">By</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Rows</th>
              <th className="px-3 py-2 font-medium text-xs text-right">Size</th>
              <th className="px-3 py-2 font-medium text-xs">Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0
              ? <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">No backups yet — click "Run Backup" above</td></tr>
              : logs.map(l => (
                <tr key={l.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs"><Badge variant="outline">{l.backupType}</Badge></td>
                  <td className="px-3 py-2"><Badge className={l.status === "success" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}>{l.status}</Badge></td>
                  <td className="px-3 py-2 text-xs">{l.performedBy || "—"}</td>
                  <td className="px-3 py-2 text-xs text-right">{l.rowCount ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-right">{fmtSize(l.sizeBytes)}</td>
                  <td className="px-3 py-2 text-xs text-rose-600 max-w-xs truncate" title={l.errorMessage || ""}>{l.errorMessage || ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
function QueueSettingsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<OnlineBookingSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<OnlineBookingSettings | null>(null);

  useEffect(() => {
    if (data) setForm({
      ...data,
      queueVipMode: data.queueVipMode || "highlighted",
      queuePrivacyMode: data.queuePrivacyMode || "masked",
      queueEstimatedWaitPerPatient: data.queueEstimatedWaitPerPatient ?? 15,
    });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: OnlineBookingSettings) => api.put("/api/clinic-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({ title: "Queue settings saved successfully" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  if (isLoading || !form) return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-200 dark:border-indigo-900 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
            <ClipboardList size={20} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Queue & VIP Display Settings</h2>
            <p className="text-sm text-muted-foreground mt-1">Configure VIP handling, name privacy masking, and waiting time estimates for the public screens and queue dashboard.</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <h3 className="font-bold">VIP Queue Mode</h3>
        <p className="text-xs text-muted-foreground">Choose how VIP patients are highlighted or sorted on the queue management dashboard and TV screens.</p>
        <div className="max-w-xs">
          <Select
            value={form.queueVipMode || "highlighted"}
            onValueChange={(v) => setForm({ ...form, queueVipMode: v })}
          >
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="highlighted">Highlight (Clearly distinguish VIPs in main queue)</SelectItem>
              <SelectItem value="separate">Separate List (Show VIPs in a separate dedicated list)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <h3 className="font-bold pt-4 border-t border-card-border">Public Queue Name Privacy</h3>
        <p className="text-xs text-muted-foreground">Determine how patient names are displayed on public TV monitors outside rooms to preserve patient privacy.</p>
        <div className="max-w-xs">
          <Select
            value={form.queuePrivacyMode || "masked"}
            onValueChange={(v) => setForm({ ...form, queuePrivacyMode: v })}
          >
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Show Full Name (e.g. John Doe)</SelectItem>
              <SelectItem value="masked">Mask Name (e.g. J**n D*e)</SelectItem>
              <SelectItem value="token_only">Token Only (e.g. Token #102)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <h3 className="font-bold pt-4 border-t border-card-border">Estimated Wait Time (Per Patient)</h3>
        <p className="text-xs text-muted-foreground">Average examination time in minutes per patient. Used to calculate estimated queue wait times dynamically.</p>
        <div className="flex items-center gap-3 max-w-xs">
          <Input
            type="number"
            min="1"
            max="180"
            value={form.queueEstimatedWaitPerPatient ?? 15}
            onChange={(e) => setForm({ ...form, queueEstimatedWaitPerPatient: Number(e.target.value) })}
          />
          <span className="text-sm font-medium">mins</span>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-card-border">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save Settings"}</Button>
        </div>
      </div>
    </div>
  );
}

// KIOSK SETTINGS TAB
// ============================================================
type KioskSettings = {
  kioskEnabled: boolean;
  kioskUpiVpa: string;
  kioskUpiName: string;
  kioskWelcomeMessage: string;
  kioskAllowedTestIds: string;
  kioskPaymentGateway: string;
};

function KioskSettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery<KioskSettings & Record<string, unknown>>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  const [enabled, setEnabled] = useState(false);
  const [upiVpa, setUpiVpa] = useState("");
  const [upiName, setUpiName] = useState("");
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [kioskPaymentGateway, setKioskPaymentGateway] = useState<string>("upi");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.kioskEnabled ?? false);
    setUpiVpa(settings.kioskUpiVpa ?? "");
    setUpiName(settings.kioskUpiName ?? "");
    setWelcomeMsg(settings.kioskWelcomeMessage ?? "");
    setKioskPaymentGateway(settings.kioskPaymentGateway ?? "upi");
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put("/api/clinic-settings", {
        kioskEnabled: enabled,
        kioskUpiVpa: upiVpa.trim(),
        kioskUpiName: upiName.trim(),
        kioskWelcomeMessage: welcomeMsg.trim(),
        kioskPaymentGateway,
      });
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      toast({ title: "Kiosk settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const kioskUrl = `${window.location.origin}${import.meta.env.BASE_URL ?? "/erp/"}kiosk`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base">Self-Registration Kiosk</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              A touch-friendly screen where patients self-register, select tests, pay via their preferred gateway, and get a bill + queue token automatically.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm font-medium">{enabled ? "Enabled" : "Disabled"}</span>
            <div
              onClick={() => setEnabled(e => !e)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${enabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
            </div>
          </label>
        </div>

        {/* Kiosk URL */}
        <div className="bg-muted/40 rounded-lg p-3 flex items-center gap-3">
          <QrCode size={18} className="text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium mb-0.5">Kiosk URL — open this on the kiosk device</p>
            <p className="text-sm font-mono truncate">{kioskUrl}</p>
          </div>
          <a href={kioskUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink size={13} className="mr-1" />Open</Button>
          </a>
        </div>

        {/* Payment Gateway */}
        <div>
          <Label className="text-xs">Default Payment Gateway</Label>
          <select
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            value={kioskPaymentGateway}
            onChange={e => setKioskPaymentGateway(e.target.value)}
          >
            <option value="upi">UPI QR Code</option>
            <option value="icici">ICICI Orange Pay (Card / UPI / Net Banking)</option>
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which payment method appears first. Both are available if ICICI credentials are configured.
          </p>
        </div>

        {/* UPI Settings */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">UPI Payment</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">UPI VPA / ID *</Label>
              <Input
                className="mt-1"
                placeholder="e.g. clinic@paytm or 9876543210@upi"
                value={upiVpa}
                onChange={e => setUpiVpa(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">The UPI ID that patients will pay to. Leave blank to disable QR payments.</p>
            </div>
            <div>
              <Label className="text-xs">UPI Holder Name</Label>
              <Input
                className="mt-1"
                placeholder="e.g. Care Diagnostics"
                value={upiName}
                onChange={e => setUpiName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Name shown in the patient's UPI app.</p>
            </div>
          </div>
        </div>

        {/* Welcome message */}
        <div>
          <Label className="text-xs">Welcome Message (optional)</Label>
          <Textarea
            className="mt-1"
            rows={2}
            placeholder="e.g. Welcome! Please register yourself here and select the tests recommended by your doctor."
            value={welcomeMsg}
            onChange={e => setWelcomeMsg(e.target.value)}
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Kiosk Settings"}
        </Button>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-5 text-sm space-y-2">
        <h4 className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-2">
          <QrCode size={16} />How the Kiosk Works
        </h4>
        <ol className="list-decimal list-inside space-y-1 text-blue-800 dark:text-blue-300">
          <li>Patient opens the kiosk URL on a touchscreen and taps <strong>Start Self-Registration</strong>.</li>
          <li>They fill in their name, mobile number, and gender.</li>
          <li>They select the tests they need from the test catalogue.</li>
          <li>They choose a payment method (UPI QR or ICICI Orange Pay) and pay the total amount.</li>
          <li>The system automatically creates a patient record, order, bill, and queue token.</li>
          <li>A confirmation screen appears with their token number and an option to print the receipt.</li>
        </ol>
        <p className="text-blue-700 dark:text-blue-400 text-xs mt-2">
          <strong>Tip:</strong> Use a tablet or touchscreen in landscape mode for best experience. ICICI payments support Card, UPI, Net Banking, and Wallet.
        </p>
      </div>
    </div>
  );
}

function ReceiptMessagesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<ClinicSettings | null>(null);
  const current = form ?? settings ?? null;

  const save = useMutation({
    mutationFn: (body: ClinicSettings) => api.put("/api/clinic-settings", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      setForm(saved as ClinicSettings);
      toast({ title: "Saved", description: "Receipt messages updated successfully." });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  if (isLoading || !current) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading receipt message settings...</div>;
  }

  const update = (k: keyof ClinicSettings, v: string | boolean) => setForm({ ...current, [k]: v });

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><MessageCircle size={16} /> Receipt Messages</h2>
          <p className="text-sm text-muted-foreground">Customize the messages that appear on the printed bill footer. These show only when the Premium A5 format is selected and the corresponding toggle is enabled.</p>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Thank You Message</Label>
            <Input value={current.receiptThankYouMessage || ""} onChange={(e) => update("receiptThankYouMessage", e.target.value)} className="mt-1" placeholder="e.g. Thank you for choosing Care Diagnostics" />
            <p className="text-xs text-muted-foreground mt-1">Shown at the top of the footer when Show Thank You is enabled.</p>
          </div>
          <div>
            <Label>Report Collection Message</Label>
            <Input value={current.receiptCollectionMessage || ""} onChange={(e) => update("receiptCollectionMessage", e.target.value)} className="mt-1" placeholder="e.g. Please collect your reports within 7 days" />
            <p className="text-xs text-muted-foreground mt-1">Shown when Show Collection Message is enabled.</p>
          </div>
          <div>
            <Label>QR Code Message</Label>
            <Input value={current.receiptQrMessage || ""} onChange={(e) => update("receiptQrMessage", e.target.value)} className="mt-1" placeholder="e.g. Scan QR code to verify receipt and download reports" />
            <p className="text-xs text-muted-foreground mt-1">Shown near the QR code block when Show QR Message is enabled.</p>
          </div>
          <div>
            <Label>Promotional Tagline</Label>
            <Input value={current.receiptPromotionalMessage || ""} onChange={(e) => update("receiptPromotionalMessage", e.target.value)} className="mt-1" placeholder="e.g. Advanced Diagnostic & Imaging Centre" />
            <p className="text-xs text-muted-foreground mt-1">Short promotional text shown when Show Promotional Message is enabled.</p>
          </div>
          {/* V3 Additional Footer Messages */}
          <div className="pt-4 border-t border-card-border">
            <h3 className="font-semibold text-sm mb-3">Additional Footer Messages</h3>
            <p className="text-xs text-muted-foreground mb-3">Toggle on the messages you want to display on the bill footer. Each has an editable text field.</p>
            <div className="space-y-3">
              {/* Working Hours */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showWorkingHours", !current.showWorkingHours)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showWorkingHours ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showWorkingHours ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Working Hours</Label>
                  <Input value={current.workingHoursMessage || ""} onChange={(e) => update("workingHoursMessage", e.target.value)} className="mt-1" placeholder="Mon-Sat: 8 AM - 8 PM | Sun: 9 AM - 2 PM" />
                </div>
              </div>
              {/* Home Collection */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showHomeCollection", !current.showHomeCollection)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showHomeCollection ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showHomeCollection ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Home Collection</Label>
                  <Input value={current.homeCollectionMessage || ""} onChange={(e) => update("homeCollectionMessage", e.target.value)} className="mt-1" placeholder="Home Collection Available. Call us to book." />
                </div>
              </div>
              {/* Emergency */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showEmergency", !current.showEmergency)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showEmergency ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showEmergency ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Emergency Services</Label>
                  <Input value={current.emergencyMessage || ""} onChange={(e) => update("emergencyMessage", e.target.value)} className="mt-1" placeholder="24x7 Emergency Services Available" />
                </div>
              </div>
              {/* Referral Program */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showReferralProgram", !current.showReferralProgram)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showReferralProgram ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showReferralProgram ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Referral Program</Label>
                  <Input value={current.referralProgramMessage || ""} onChange={(e) => update("referralProgramMessage", e.target.value)} className="mt-1" placeholder="Refer a friend and get 10% off your next visit." />
                </div>
              </div>
              {/* Health Packages */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showHealthPackages", !current.showHealthPackages)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showHealthPackages ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showHealthPackages ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Health Packages</Label>
                  <Input value={current.healthPackagesMessage || ""} onChange={(e) => update("healthPackagesMessage", e.target.value)} className="mt-1" placeholder="Annual Health Checkup packages available at discounted rates." />
                </div>
              </div>
              {/* Accreditation */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showAccreditation", !current.showAccreditation)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showAccreditation ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showAccreditation ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Accreditation</Label>
                  <Input value={current.accreditationMessage || ""} onChange={(e) => update("accreditationMessage", e.target.value)} className="mt-1" placeholder="NABL Accredited / ISO 9001:2015 Certified" />
                </div>
              </div>
              {/* WhatsApp Booking */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showWhatsAppBooking", !current.showWhatsAppBooking)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showWhatsAppBooking ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showWhatsAppBooking ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">WhatsApp Booking</Label>
                  <Input value={current.whatsAppBookingMessage || ""} onChange={(e) => update("whatsAppBookingMessage", e.target.value)} className="mt-1" placeholder="Book appointments on WhatsApp: +91" />
                </div>
              </div>
              {/* Custom Message */}
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => update("showCustomFooterMessage", !current.showCustomFooterMessage)} className={`mt-1 shrink-0 w-10 h-5 rounded-full transition-colors ${current.showCustomFooterMessage ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                  <span className={`block w-3.5 h-3.5 rounded-full bg-white transition-transform ${current.showCustomFooterMessage ? "translate-x-5" : "translate-x-1"}`} />
                </button>
                <div className="flex-1">
                  <Label className="text-sm font-medium">Custom Message</Label>
                  <Textarea value={current.customFooterMessage || ""} onChange={(e) => update("customFooterMessage", e.target.value)} className="mt-1" rows={2} placeholder="Any custom message you want to display on the footer." />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button variant="outline" type="button" onClick={() => setForm(settings ?? null)}>Reset</Button>
          <Button onClick={() => save.mutate(current)} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FooterServicesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<ClinicSettings | null>(null);
  const current = form ?? settings ?? null;

  const save = useMutation({
    mutationFn: (body: ClinicSettings) => api.put("/api/clinic-settings", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      setForm(saved as ClinicSettings);
      toast({ title: "Saved", description: "Service footer updated successfully." });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  if (isLoading || !current) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading footer service settings...</div>;
  }

  let services: string[] = [];
  try {
    if (current.serviceFooter) services = JSON.parse(current.serviceFooter);
  } catch { /* ignore */ }

  const updateServices = (svcs: string[]) => {
    setForm({ ...current, serviceFooter: JSON.stringify(svcs) });
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Layers size={16} /> Footer Service List</h2>
          <p className="text-sm text-muted-foreground">These services are displayed in the footer of the Premium A5 bill. Stored as a JSON array.</p>
        </div>
        <div className="space-y-3">
          {services.length === 0 && <p className="text-sm text-muted-foreground">No services listed. Add services below.</p>}
          {services.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={s} onChange={(e) => {
                const next = [...services];
                next[i] = e.target.value;
                updateServices(next);
              }} className="flex-1" placeholder="Service name (e.g. MRI, CT Scan)" />
              <Button variant="outline" size="sm" onClick={() => {
                const next = services.filter((_, idx) => idx !== i);
                updateServices(next);
              }}><Trash2 size={14} /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => updateServices([...services, ""])}><Plus size={14} className="mr-1" /> Add Service</Button>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button variant="outline" type="button" onClick={() => setForm(settings ?? null)}>Reset</Button>
          <Button onClick={() => save.mutate(current)} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PromotionalFooterTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<ClinicSettings>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });
  const [form, setForm] = useState<ClinicSettings | null>(null);
  const current = form ?? settings ?? null;

  const save = useMutation({
    mutationFn: (body: ClinicSettings) => api.put("/api/clinic-settings", body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      setForm(saved as ClinicSettings);
      toast({ title: "Saved", description: "Promotional footer settings updated successfully." });
    },
    onError: (err: unknown) => {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  if (isLoading || !current) {
    return <div className="bg-card border border-card-border rounded-xl p-8 text-center text-muted-foreground">Loading promotional footer settings...</div>;
  }

  const update = (k: keyof ClinicSettings, v: string | boolean) => setForm({ ...current, [k]: v });

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Tag size={16} /> Promotional Footer</h2>
          <p className="text-sm text-muted-foreground">Display a promotional footer block on the Premium A5 bill. Useful for seasonal offers, health packages, or special announcements.</p>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Promotional Title</Label>
            <Input value={current.promotionalTitle || ""} onChange={(e) => update("promotionalTitle", e.target.value)} className="mt-1" placeholder="e.g. Health Checkup Packages Available" />
          </div>
          <div>
            <Label>Promotional Description</Label>
            <Textarea value={current.promotionalDescription || ""} onChange={(e) => update("promotionalDescription", e.target.value)} className="mt-1" rows={2} placeholder="e.g. Get 20% off on all preventive health packages this month." />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => update("showPromotionalFooter", !current.showPromotionalFooter)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.showPromotionalFooter ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">Show Promotional Footer</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.showPromotionalFooter ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.showPromotionalFooter ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => update("showFollowUpMessage", !current.showFollowUpMessage)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.showFollowUpMessage ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">Show Follow-Up Message</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.showFollowUpMessage ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.showFollowUpMessage ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => update("showPatientSince", !current.showPatientSince)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.showPatientSince ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">Show Patient Since Date</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.showPatientSince ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.showPatientSince ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => update("showVerifiedBadge", !current.showVerifiedBadge)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${current.showVerifiedBadge ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800" : "bg-muted/30 border-card-border"}`}
            >
              <span className="text-sm font-medium">Show Verified Receipt Badge</span>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${current.showVerifiedBadge ? "bg-green-500" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${current.showVerifiedBadge ? "translate-x-5" : "translate-x-1"}`} />
              </span>
            </button>
          </div>
          <div>
            <Label>Follow-Up Message</Label>
            <Input value={current.followUpMessage || ""} onChange={(e) => update("followUpMessage", e.target.value)} className="mt-1" placeholder="e.g. For future investigations, please quote your Patient ID" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button variant="outline" type="button" onClick={() => setForm(settings ?? null)}>Reset</Button>
          <Button onClick={() => save.mutate(current)} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SCANNER SETTINGS TAB
// ============================================================
type ScannerSettings = {
  autoCropIdScan: boolean;
  autoRotateScan: boolean;
  archiveImportedScans: boolean;
  cropPadding: number;
  jpegQuality: number;
  maxScanWidth: number;
  mobileScanEnabled: boolean;
  phonePairingEnabled: boolean;
  preferredScanner: string;
  requireDesktopConfirmation: boolean;
  autoDeleteTempScans: boolean;
  ocrEnabled: boolean;
  aadhaarQrEnabled: boolean;
  scannerGlobalEnabled?: boolean;
  scanStationKioskModeEnabled?: boolean;
  scanStationAutoClearEnabled?: boolean;
  scanStationResultDisplaySeconds?: number;
};

function ScannerSettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery<ScannerSettings & Record<string, unknown>>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings"),
  });

  const [autoCrop, setAutoCrop] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [archive, setArchive] = useState(true);
  const [padding, setPadding] = useState(12);
  const [quality, setQuality] = useState(85);
  const [maxWidth, setMaxWidth] = useState(1200);
  
  // Wireless settings
  const [mobileScan, setMobileScan] = useState(true);
  const [phonePairing, setPhonePairing] = useState(true);
  const [preferredScanner, setPreferredScanner] = useState("mobile");
  const [requireConfirmation, setRequireConfirmation] = useState(true);
  const [autoDeleteTemp, setAutoDeleteTemp] = useState(true);
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [aadhaarQr, setAadhaarQr] = useState(true);
  const [autoPopulateFormF, setAutoPopulateFormF] = useState(false);

  // Phase 2 Enhanced settings
  const [scannerGlobal, setScannerGlobal] = useState(false);
  const [kioskMode, setKioskMode] = useState(true);
  const [autoClear, setAutoClear] = useState(true);
  const [displaySeconds, setDisplaySeconds] = useState(10);
  
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setAutoCrop(settings.autoCropIdScan !== false);
    setAutoRotate(settings.autoRotateScan === true);
    setArchive(settings.archiveImportedScans !== false);
    setPadding(Number(settings.cropPadding ?? 12));
    setQuality(Number(settings.jpegQuality ?? 85));
    setMaxWidth(Number(settings.maxScanWidth ?? 1200));
    
    setMobileScan(settings.mobileScanEnabled !== false);
    setPhonePairing(settings.phonePairingEnabled !== false);
    setPreferredScanner(String(settings.preferredScanner ?? "mobile"));
    setRequireConfirmation(settings.requireDesktopConfirmation !== false);
    setAutoDeleteTemp(settings.autoDeleteTempScans !== false);
    setOcrEnabled(settings.ocrEnabled !== false);
    setAadhaarQr(settings.aadhaarQrEnabled !== false);
    setAutoPopulateFormF(settings.autoPopulateFormFFromObMeasurements === true);

    setScannerGlobal(settings.scannerGlobalEnabled === true);
    setKioskMode(settings.scanStationKioskModeEnabled !== false);
    setAutoClear(settings.scanStationAutoClearEnabled !== false);
    setDisplaySeconds(Number(settings.scanStationResultDisplaySeconds ?? 10));
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put("/api/clinic-settings", {
        autoCropIdScan: autoCrop,
        autoRotateScan: autoRotate,
        archiveImportedScans: archive,
        cropPadding: padding,
        jpegQuality: quality,
        maxScanWidth: maxWidth,
        mobileScanEnabled: mobileScan,
        phonePairingEnabled: phonePairing,
        preferredScanner: preferredScanner,
        requireDesktopConfirmation: requireConfirmation,
        autoDeleteTempScans: autoDeleteTemp,
        ocrEnabled: ocrEnabled,
        aadhaarQrEnabled: aadhaarQr,
        autoPopulateFormFFromObMeasurements: autoPopulateFormF,
        scannerGlobalEnabled: scannerGlobal,
        scanStationKioskModeEnabled: kioskMode,
        scanStationAutoClearEnabled: autoClear,
        scanStationResultDisplaySeconds: displaySeconds,
      });
      qc.invalidateQueries({ queryKey: ["clinic-settings"] });
      // Also invalidate public branding queries so Layout & hooks refresh instantly
      qc.invalidateQueries({ queryKey: ["clinic-settings-public"] });
      toast({ title: "Scanner settings saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Kiosk & Global Hospital Scanner Settings */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-base">Hospital Scanner settings</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Configure global barcode/QR scanners and Scan Station behaviors.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="scannerGlobal"
              type="checkbox"
              checked={scannerGlobal}
              onChange={(e) => setScannerGlobal(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="scannerGlobal" className="text-sm font-medium">
              Enable scanner on all ERP pages
              <p className="text-xs text-muted-foreground font-normal">When enabled, scanning a prefix (like PATIENT: or BILL:) on any page redirects the user to that page.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="kioskMode"
              type="checkbox"
              checked={kioskMode}
              onChange={(e) => setKioskMode(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="kioskMode" className="text-sm font-medium">
              Enable Scan Station kiosk mode
              <p className="text-xs text-muted-foreground font-normal">When scanning on the Scan Station page, display the result in the right-side panel without navigating away.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="autoClear"
              type="checkbox"
              checked={autoClear}
              onChange={(e) => setAutoClear(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="autoClear" className="text-sm font-medium">
              Auto clear Scan Station result
              <p className="text-xs text-muted-foreground font-normal">Automatically clear the scanned result after the configured duration.</p>
            </label>
          </div>

          <div className="space-y-1">
            <label htmlFor="displaySeconds" className="text-sm font-medium">Result display duration (seconds)</label>
            <Select value={String(displaySeconds)} onValueChange={(v) => setDisplaySeconds(Number(v))}>
              <SelectTrigger id="displaySeconds" className="h-9 bg-white dark:bg-background w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 seconds</SelectItem>
                <SelectItem value="10">10 seconds</SelectItem>
                <SelectItem value="15">15 seconds</SelectItem>
                <SelectItem value="20">20 seconds</SelectItem>
                <SelectItem value="30">30 seconds</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-base">ID Card Scanner Settings</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Configure how scans are imported and processed in Form F.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="autoCrop"
              type="checkbox"
              checked={autoCrop}
              onChange={(e) => setAutoCrop(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="autoCrop" className="text-sm font-medium">
              Auto-crop ID cards
              <p className="text-xs text-muted-foreground font-normal">Automatically detect and crop the card edges when importing scans.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="autoRotate"
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => setAutoRotate(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="autoRotate" className="text-sm font-medium">
              Auto-rotate scans
              <p className="text-xs text-muted-foreground font-normal">Attempt to correct orientation if the scanner saves rotated images.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="archive"
              type="checkbox"
              checked={archive}
              onChange={(e) => setArchive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="archive" className="text-sm font-medium">
              Archive imported scans
              <p className="text-xs text-muted-foreground font-normal">Move processed files to a processed folder after import.</p>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label htmlFor="padding" className="text-sm font-medium">Crop Padding (px)</label>
              <Input
                id="padding"
                type="number"
                min={0}
                max={100}
                value={padding}
                onChange={(e) => setPadding(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground">Extra space around detected card edges.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="quality" className="text-sm font-medium">JPEG Quality (%)</label>
              <Input
                id="quality"
                type="number"
                min={30}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Math.max(30, Math.min(100, Number(e.target.value))))}
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground">Higher = better quality, larger file.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="maxWidth" className="text-sm font-medium">Max Width (px)</label>
              <Input
                id="maxWidth"
                type="number"
                min={200}
                max={5000}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Math.max(200, Math.min(5000, Number(e.target.value))))}
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground">Resize if scanned image is wider than this.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-base">Wireless & Mobile Phone Scanning</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Allow reception and registration desks to trigger mobile phone cameras wirelessly.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="mobileScan"
              type="checkbox"
              checked={mobileScan}
              onChange={(e) => setMobileScan(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="mobileScan" className="text-sm font-medium">
              Enable Wireless Mobile Scanning
              <p className="text-xs text-muted-foreground font-normal">Show QR codes and paired phone scanning options on desktop pages.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="phonePairing"
              type="checkbox"
              checked={phonePairing}
              onChange={(e) => setPhonePairing(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="phonePairing" className="text-sm font-medium">
              Enable Device Pairing
              <p className="text-xs text-muted-foreground font-normal">Allow staff to pair their personal Android devices to bypass scanning QR codes every time.</p>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="preferredScanner" className="text-sm font-medium">Preferred Scanning Source</label>
              <Select value={preferredScanner} onValueChange={setPreferredScanner}>
                <SelectTrigger id="preferredScanner" className="h-9 bg-white dark:bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Wireless Mobile Scan</SelectItem>
                  <SelectItem value="bridge">Local Scanner / Scan Bridge</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Default selection when staff clicks "Scan ID" on desktop.</p>
            </div>
            
            <div className="flex items-center gap-3 pt-6">
              <input
                id="requireConfirmation"
                type="checkbox"
                checked={requireConfirmation}
                onChange={(e) => setRequireConfirmation(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="requireConfirmation" className="text-sm font-medium">
                Require Desktop Approval
                <p className="text-xs text-muted-foreground font-normal">Force user to verify and accept scanned images before attaching.</p>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="autoDeleteTemp"
              type="checkbox"
              checked={autoDeleteTemp}
              onChange={(e) => setAutoDeleteTemp(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="autoDeleteTemp" className="text-sm font-medium">
              Auto-delete Temporary Scans
              <p className="text-xs text-muted-foreground font-normal">Automatically purge scan session files once attached to a patient file.</p>
            </label>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-5">
        <div>
          <h3 className="font-semibold text-base">OCR & Data Extraction</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Control automated field extraction from scanned identity documents.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              id="ocrEnabled"
              type="checkbox"
              checked={ocrEnabled}
              onChange={(e) => setOcrEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="ocrEnabled" className="text-sm font-medium">
              Enable OCR Field Extraction
              <p className="text-xs text-muted-foreground font-normal">Use AI to automatically extract name, address, DOB, and ID numbers from scans.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="aadhaarQr"
              type="checkbox"
              checked={aadhaarQr}
              onChange={(e) => setAadhaarQr(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="aadhaarQr" className="text-sm font-medium">
              Enable Aadhaar QR Code Extraction
              <p className="text-xs text-muted-foreground font-normal">Decrypt secure QR codes printed on Aadhaar cards for 100% accurate demographic extraction.</p>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              id="autoPopulateFormF"
              type="checkbox"
              checked={autoPopulateFormF}
              onChange={(e) => setAutoPopulateFormF(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="autoPopulateFormF" className="text-sm font-medium">
              Auto-populate Form F from approved OB measurements
              <p className="text-xs text-muted-foreground font-normal">Automatically prefill gestational age and map biometric measurements (CRL, FHR, etc.) from USG scan.</p>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-card-border">
          <Button variant="outline" type="button" onClick={() => {
            if (!settings) return;
            setAutoCrop(settings.autoCropIdScan !== false);
            setAutoRotate(settings.autoRotateScan === true);
            setArchive(settings.archiveImportedScans !== false);
            setPadding(Number(settings.cropPadding ?? 12));
            setQuality(Number(settings.jpegQuality ?? 85));
            setMaxWidth(Number(settings.maxScanWidth ?? 1200));
            setMobileScan(settings.mobileScanEnabled !== false);
            setPhonePairing(settings.phonePairingEnabled !== false);
            setPreferredScanner(String(settings.preferredScanner ?? "mobile"));
            setRequireConfirmation(settings.requireDesktopConfirmation !== false);
            setAutoDeleteTemp(settings.autoDeleteTempScans !== false);
            setOcrEnabled(settings.ocrEnabled !== false);
            setAadhaarQr(settings.aadhaarQrEnabled !== false);
            setAutoPopulateFormF(settings.autoPopulateFormFFromObMeasurements === true);
            setScannerGlobal(settings.scannerGlobalEnabled === true);
            setKioskMode(settings.scanStationKioskModeEnabled !== false);
            setAutoClear(settings.scanStationAutoClearEnabled !== false);
            setDisplaySeconds(Number(settings.scanStationResultDisplaySeconds ?? 10));
          }}>Reset</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}



// ══ About / Version Tab ══════════════════════════════════════════════════════

function AboutTab() {
  const [info, setInfo] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/system/version")
      .then((r) => r.json())
      .then((d) => { setInfo(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
      Loading version information…
    </div>
  );
  if (error) return (
    <div className="text-red-500 text-sm p-4">Failed to load version info: {error}</div>
  );

  const Row = ({ label, value }: { label: string; value?: string | number }) =>
    value ? (
      <div className="flex items-baseline justify-between py-1.5 border-b border-card-border/50 last:border-0">
        <span className="text-xs text-muted-foreground w-44 flex-shrink-0">{label}</span>
        <span className="text-xs font-mono font-semibold text-foreground text-right break-all">{String(value)}</span>
      </div>
    ) : null;

  const Section = ({ title }: { title: string }) => (
    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-6 mb-2 first:mt-0">{title}</h3>
  );

  return (
    <div className="max-w-2xl space-y-4">
      {/* Version banner */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Tag size={18} className="text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Care Diagnostics ERP</h2>
            {info?.releaseName && (
              <p className="text-xs text-muted-foreground italic">{info.releaseName}</p>
            )}
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-extrabold text-primary tabular-nums">v{info?.version}</div>
            <div className="text-xs text-muted-foreground">Build {info?.build}</div>
          </div>
        </div>
        {/* Schema status badge */}
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
          info?.schemaVerifyStatus === "full_pass" || info?.schemaVerifyStatus === "sql_pass"
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            : info?.schemaVerifyStatus === "full_fail"
            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        }`}>
          {info?.schemaVerifyStatus === "full_pass" ? "✓ Schema Verified" :
           info?.schemaVerifyStatus === "sql_pass"  ? "✓ Schema OK (SQL pass)" :
           info?.schemaVerifyStatus === "full_fail" ? "✗ Schema Mismatch" :
           "⚠ Schema Unknown"}
        </div>
      </div>

      {/* Detail rows */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <Section title="Release" />
        <Row label="ERP Version"   value={info?.version} />
        <Row label="Build Number"  value={info?.build} />
        <Row label="Release Name"  value={info?.releaseName} />
        <Row label="Build Date"    value={info?.buildDate} />
        <Row label="Deployed At"   value={info?.deployedAt} />

        <Section title="Git Provenance" />
        <Row label="Git Commit"   value={info?.gitCommit} />
        <Row label="Git Branch"   value={info?.gitBranch} />
        <Row label="Git Tag"      value={info?.gitTag} />

        <Section title="Database & Schema" />
        <Row label="PostgreSQL"            value={info?.pgVersion} />
        <Row label="Drizzle Migrations"    value={info?.drizzleMigrations} />
        <Row label="Feature Migrations"    value={info?.featureMigrations} />
        <Row label="Schema Verify Status"  value={info?.schemaVerifyStatus} />
        <Row label="Schema Verified At"    value={info?.schemaVerifyAt} />
        <Row label="Live Tables"           value={info?.liveTableCount} />
        <Row label="Live Columns"          value={info?.liveColumnCount} />
        <Row label="DB Patch OK"           value={info?.dbPatchOk} />

        <Section title="Runtime" />
        <Row label="Node.js"      value={info?.nodeVersion} />
        <Row label="Environment"  value={info?.environment} />
        <Row label="Uptime"       value={info?.uptime != null ? `${Math.floor(Number(info.uptime) / 60)}m ${Number(info.uptime) % 60}s` : undefined} />

        {info?.releaseNotes && (
          <>
            <Section title="Release Notes" />
            <p className="text-xs text-muted-foreground leading-relaxed">{info.releaseNotes}</p>
          </>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        © {new Date().getFullYear()} Care Diagnostics · Deoghar, Jharkhand · Hospital ERP / RIS / PACS
      </p>
    </div>
  );
}