import { useState } from "react";
import { Link } from "wouter";
import { useGetPatient, useGetPatientHistory, getGetPatientQueryKey } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, User, Phone, MapPin, Droplet, Sparkles,
  Copy, CheckCheck, MessageSquare, FileText, Upload, X, ShieldCheck, ShieldOff, ClipboardList,
} from "lucide-react";

type AIType = "clinical-note" | "patient-message";
type MessageType = "followup" | "results" | "payment";
type ClinicSettingsLite = { patientPhotoEnabled?: boolean };

export default function PatientDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const { data: patient, isLoading } = useGetPatient(id);
  const { data: history } = useGetPatientHistory(id);
  const { data: clinicSettings } = useQuery<ClinicSettingsLite>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
  });
  const photoEnabled = !!clinicSettings?.patientPhotoEnabled;
  const [aiOpen, setAiOpen] = useState(false);
  const [aiType, setAiType] = useState<AIType>("clinical-note");
  const [msgType, setMsgType] = useState<MessageType>("followup");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoErr, setPhotoErr] = useState("");

  // Portal access code management
  const [portalPinOpen, setPortalPinOpen] = useState(false);
  const [newPortalPin, setNewPortalPin] = useState("");
  const [portalPinMsg, setPortalPinMsg] = useState("");
  const [portalPinErr, setPortalPinErr] = useState("");

  const { data: portalStatus, refetch: refetchPortalStatus } = useQuery<{ hasPortalAccess: boolean }>({
    queryKey: ["portal-status", id],
    queryFn: () => api.get(`/api/portal/admin/patient-portal-status/${id}`),
    retry: false,
  });

  const setPortalPin = useMutation({
    mutationFn: (accessCode: string | null) =>
      api.post("/api/portal/admin/set-patient-portal-code", { patientId: id, accessCode }),
    onSuccess: () => {
      void refetchPortalStatus();
      setPortalPinMsg(newPortalPin ? "Portal access code set successfully." : "Portal access revoked.");
      setNewPortalPin("");
      setPortalPinErr("");
    },
    onError: (e: Error) => setPortalPinErr(e.message),
  });

  const savePhoto = async (dataUrl: string | null) => {
    setPhotoErr("");
    setPhotoSaving(true);
    try {
      await api.put(`/api/patients/${id}`, { photoDataUrl: dataUrl });
      qc.invalidateQueries({ queryKey: getGetPatientQueryKey(id) });
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : "Failed to save photo");
    } finally {
      setPhotoSaving(false);
    }
  };

  const onPhotoChange = (file: File | null) => {
    setPhotoErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setPhotoErr("Please upload an image file"); return; }
    if (file.size > 1_500_000) { setPhotoErr("Image too large (max 1.5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => { void savePhoto(String(reader.result)); };
    reader.readAsDataURL(file);
  };

  const generateAI = async (type: AIType, mtype?: MessageType) => {
    setAiType(type);
    setAiResult("");
    setAiOpen(true);
    setAiLoading(true);
    try {
      if (type === "clinical-note") {
        const res = await api.post<{ note: string }>("/api/ai/clinical-note", { patientId: id });
        setAiResult(res.note);
      } else {
        const res = await api.post<{ message: string }>("/api/ai/patient-message", { patientId: id, type: mtype ?? msgType });
        setAiResult(res.message);
      }
    } catch {
      setAiResult("Failed to generate. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const copyResult = () => {
    navigator.clipboard.writeText(aiResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-64" /></div>;
  }
  if (!patient) {
    return <div className="p-6 text-muted-foreground">Patient not found.</div>;
  }

  const ageStr = (() => {
    if (patient.ageValue != null && patient.ageUnit) {
      if (patient.ageUnit === "years") return patient.ageValue > 0 ? `${patient.ageValue} Yrs` : null;
      if (patient.ageUnit === "months") return `${patient.ageValue} Mo`;
      if (patient.ageUnit === "days") return `${patient.ageValue} D`;
    }
    const years = new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear();
    return years > 0 ? `${years} Yrs` : null;
  })();

  return (
    <div className="pb-8 bg-slate-50 dark:bg-slate-900/20 min-h-full">
      <div className="px-6 pt-4">
        <Link href="/patients" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} /> Back to Patients
        </Link>
      </div>

      <PageHeader
        title={`${patient.firstName} ${patient.lastName}`}
        subtitle={patient.patientId}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { setMsgType("followup"); generateAI("patient-message", "followup"); }}>
              <MessageSquare size={14} className="mr-1.5" />AI Message
            </Button>
            <Button size="sm" variant="outline" onClick={() => generateAI("clinical-note")}>
              <Sparkles size={14} className="mr-1.5" />Clinical Note
            </Button>
            <Link href={`/orders?patientId=${id}`} asChild>
              <Button
                size="sm"
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md"
              >
                New Order
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-6 space-y-5">
        {/* Patient info card */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-cyan-50 to-transparent border-l-4 border-l-cyan-500">
            <User size={14} className="text-cyan-600" />
            <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Patient Information</span>
          </div>
          <div className="p-5">
          <div className="flex flex-col md:flex-row gap-5">
            {photoEnabled && (
              <div className="flex flex-col items-center md:items-start gap-2 shrink-0">
                {(patient as { photoDataUrl?: string | null }).photoDataUrl ? (
                  <img
                    src={(patient as { photoDataUrl?: string | null }).photoDataUrl ?? ""}
                    alt={`${patient.firstName} ${patient.lastName}`}
                    className="w-28 h-28 rounded-xl object-cover border border-border shadow-sm"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-xl bg-muted flex items-center justify-center border border-border">
                    <User size={42} className="text-muted-foreground/50" />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  id="patient-detail-photo-input"
                  className="hidden"
                  onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
                />
                <div className="flex gap-1.5 w-28 justify-center md:justify-start">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2"
                    disabled={photoSaving}
                    onClick={() => document.getElementById("patient-detail-photo-input")?.click()}
                  >
                    <Upload size={11} className="mr-1" />
                    {(patient as { photoDataUrl?: string | null }).photoDataUrl ? "Change" : "Upload"}
                  </Button>
                  {(patient as { photoDataUrl?: string | null }).photoDataUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2 text-destructive hover:text-destructive"
                      disabled={photoSaving}
                      onClick={() => void savePhoto(null)}
                    >
                      <X size={11} />
                    </Button>
                  )}
                </div>
                {photoSaving && <p className="text-[10px] text-muted-foreground">Saving…</p>}
                {photoErr && <p className="text-[10px] text-destructive max-w-[112px] text-center">{photoErr}</p>}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 flex-1">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Date of Birth</p>
              <p className="mt-1 text-sm font-medium">{patient.dateOfBirth} <span className="text-muted-foreground">({ageStr ?? "—"})</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Gender</p>
              <p className="mt-1 text-sm font-medium capitalize">{patient.gender}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Phone size={11} /> Phone</p>
              <p className="mt-1 text-sm font-medium">{patient.phone}</p>
            </div>
            {patient.bloodGroup && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Droplet size={11} /> Blood Group</p>
                <p className="mt-1 text-sm font-bold text-red-600 dark:text-red-400">{patient.bloodGroup}</p>
              </div>
            )}
            {patient.email && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Email</p>
                <p className="mt-1 text-sm font-medium">{patient.email}</p>
              </div>
            )}
            {patient.address && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1"><MapPin size={11} /> Address</p>
                <p className="mt-1 text-sm font-medium">{patient.address}</p>
              </div>
            )}
            </div>
          </div>
          </div>
        </div>

        {/* Portal Access Management */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          <div className={`flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r border-l-4 ${portalStatus?.hasPortalAccess ? "from-emerald-50 to-transparent border-l-emerald-500" : "from-amber-50 to-transparent border-l-amber-400"}`}>
            {portalStatus?.hasPortalAccess ? (
              <ShieldCheck size={14} className="text-emerald-600" />
            ) : (
              <ShieldOff size={14} className="text-amber-500" />
            )}
            <span className="text-sm font-semibold text-slate-700 dark:text-foreground">
              Patient Portal Access:{" "}
              <span className={portalStatus?.hasPortalAccess ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                {portalStatus === undefined ? "Loading…" : portalStatus.hasPortalAccess ? "Active" : "Not activated"}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setPortalPinMsg(""); setPortalPinErr(""); setNewPortalPin(""); setPortalPinOpen(true); }}>
                {portalStatus?.hasPortalAccess ? "Reset Access Code" : "Set Access Code"}
              </Button>
              {portalStatus?.hasPortalAccess && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={setPortalPin.isPending}
                  onClick={() => { setPortalPinMsg(""); setPortalPinErr(""); setPortalPin.mutate(null); }}
                >
                  Revoke
                </Button>
              )}
            </div>
            {portalPinMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{portalPinMsg}</p>}
            {portalPinErr && <p className="text-xs text-destructive">{portalPinErr}</p>}
          </div>
        </div>

        {/* AI Message quick buttons */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-violet-50 to-transparent border-l-4 border-l-violet-500">
            <Sparkles size={14} className="text-violet-600" />
            <span className="text-sm font-semibold text-slate-700 dark:text-foreground">AI Patient Communication</span>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {([
              { type: "followup" as MessageType, label: "Follow-up Reminder" },
              { type: "results" as MessageType, label: "Results Ready" },
              { type: "payment" as MessageType, label: "Payment Reminder" },
            ]).map(({ type, label }) => (
              <Button key={type} size="sm" variant="outline"
                className="border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:text-violet-300"
                onClick={() => { setMsgType(type); generateAI("patient-message", type); }}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        {/* Order history */}
        <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-blue-50 to-transparent border-l-4 border-l-blue-500">
            <ClipboardList size={14} className="text-blue-600" />
            <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Test Order History</span>
          </div>
          <div>
            {!history?.orders?.length ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No orders yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-slate-200 dark:border-border bg-slate-50 dark:bg-muted/30">
                    <th className="px-4 py-3 font-medium">Order No.</th>
                    <th className="px-4 py-3 font-medium">Tests</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.orders.map((order) => (
                    <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{order.orderNumber}</td>
                      <td className="px-4 py-3 text-muted-foreground">{order.tests?.length ?? 0} test(s)</td>
                      <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                      <td className="px-4 py-3 text-right font-medium">₹{Number(order.totalAmount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <Link href={`/orders/${order.id}`} className="text-xs text-primary hover:underline">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Portal Access Code Dialog */}
      <Dialog open={portalPinOpen} onOpenChange={(open) => { setPortalPinOpen(open); if (!open) { setNewPortalPin(""); setPortalPinErr(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-blue-500" />
              Set Portal Access Code
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Set a portal access code for this patient. They will need this code, along with their mobile number and date of birth, to log in to the patient portal.
            </p>
            <div>
              <Label htmlFor="portal-pin-input">New Access Code (4–20 characters)</Label>
              <Input
                id="portal-pin-input"
                type="text"
                placeholder="e.g. Abc12345"
                value={newPortalPin}
                onChange={(e) => setNewPortalPin(e.target.value)}
                className="mt-1.5"
                autoFocus
                maxLength={20}
              />
            </div>
            {portalPinErr && <p className="text-sm text-destructive">{portalPinErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setPortalPinOpen(false)}>Cancel</Button>
              <Button
                disabled={newPortalPin.trim().length < 4 || setPortalPin.isPending}
                onClick={() => setPortalPin.mutate(newPortalPin.trim(), { onSuccess: () => setPortalPinOpen(false) })}
              >
                {setPortalPin.isPending ? "Saving…" : "Save Code"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Result Dialog */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-500" />
              {aiType === "clinical-note" ? "AI Clinical Note" : `AI Message — ${msgType.replace("-", " ").replace(/\b\w/g, c => c.toUpperCase())}`}
            </DialogTitle>
          </DialogHeader>
          {aiLoading ? (
            <div className="space-y-2 animate-pulse py-4">
              <div className="h-4 bg-muted rounded w-full" />
              <div className="h-4 bg-muted rounded w-5/6" />
              <div className="h-4 bg-muted rounded w-4/6" />
              <p className="text-xs text-center text-muted-foreground mt-3">Generating with AI…</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-muted/40 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap">{aiResult}</div>
              <div className="flex justify-between items-center">
                <Button size="sm" variant="outline" onClick={copyResult}>
                  {copied ? <><CheckCheck size={13} className="mr-1.5 text-green-600" />Copied!</> : <><Copy size={13} className="mr-1.5" />Copy</>}
                </Button>
                {aiType === "patient-message" && (
                  <div className="flex gap-1.5">
                    {(["followup", "results", "payment"] as MessageType[]).map(t => (
                      <Button key={t} size="sm" variant={msgType === t ? "default" : "outline"}
                        onClick={() => { setMsgType(t); generateAI("patient-message", t); }}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Button>
                    ))}
                  </div>
                )}
                {aiType === "clinical-note" && (
                  <Button size="sm" variant="outline" onClick={() => generateAI("clinical-note")}>Regenerate</Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
