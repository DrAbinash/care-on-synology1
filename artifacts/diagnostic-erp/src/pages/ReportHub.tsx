import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { useListPatients } from "@workspace/api-client-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  FileText, Plus, Printer, Download, Send, Mail, AlertTriangle, CheckCircle2,
  Trash2, Upload, ShieldCheck, Stamp, Search, RefreshCw, Eye, X as XIcon,
} from "lucide-react";

// ────────────────────────────────────────────────────────────────────────────
// Types (mirror server shapes)
// ────────────────────────────────────────────────────────────────────────────
type ReportRow = {
  id: number;
  reportNumber: string;
  type: string;
  patientId: number;
  testId: number;
  title: string;
  body: string;
  parameters: string | null;
  impression: string | null;
  status: "draft" | "pending_verification" | "verified" | "delivered";
  isCritical: boolean;
  criticalNote: string | null;
  criticalAcknowledgedAt: string | null;
  signatureId: number | null;
  signedByName: string | null;
  signedAt: string | null;
  verifiedBySignatureId: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verifierNotes: string | null;
  deliveredAt: string | null;
  templateId: number | null;
  createdAt: string;
  patientName?: string;
  patientCode?: string;
  patientPhone?: string | null;
  patientEmail?: string | null;
  testName?: string;
  testCode?: string;
  version?: ReportVersionMeta;
  lifecycle?: ReportLifecycleMeta;
  structuredJson?: { audit?: { signature?: { state?: string } } } | null;
};

// D9 — additive lifecycle metadata GET /:id returns.
type ReportLifecycleMeta = {
  state: string;
  structuredSigned: boolean;
  amendmentPendingVerification: boolean;
  pendingVerification: boolean;
  deliverable: boolean;
  superseded: boolean;
  latestVersion: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  recipientNotificationPending: boolean;
  priorDeliveries: Array<{ channel: string; recipient: string | null; reportId: number; at: string | null }>;
};

// D9 — a structured-signed row in draft status is awaiting COUNTERSIGN, not a
// legacy sign (the server refuses legacy sign for these rows). List rows
// carry structuredJson, so this is derivable without extra requests.
function isPendingStructuredVerify(r: ReportRow): boolean {
  return r.status === "draft" && r.structuredJson?.audit?.signature?.state === "final";
}

// D8 — amendment-chain metadata GET /:id returns additively.
type ReportVersionMeta = {
  requestedReportId: number;
  resolvedReportId: number;
  rootReportId: number;
  latestReportId: number;
  sequenceNumber: number;
  totalVersions: number;
  superseded: boolean;
  requestedSuperseded: boolean;
  amendmentReason: string | null;
  latestAmendmentReason: string | null;
  resolutionReason: string;
  warnings: string[];
  chain?: Array<{
    sequenceNumber: number;
    reportId: number;
    reportNumber: string | null;
    status: string | null;
    isLatest: boolean;
    amendedByName: string | null;
    amendedAt: string | null;
    reason: string | null;
  }>;
};

type ReportShare = {
  id: number;
  reportId: number;
  channel: string;
  recipient: string | null;
  sharedBy: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

type Signature = {
  id: number;
  name: string;
  role: string;
  qualification: string;
  registrationNo: string;
  imageDataUrl: string;
  isActive: boolean;
};

type Test = { id: number; code: string; name: string; department: string | null };
type Patient = { id: number; firstName: string; lastName: string; patientId: string; phone: string | null; email: string | null };

type Param = { name: string; result: string; unit: string; refRange: string; flag: "normal" | "low" | "high" | "critical" };

type Stats = { totalReports: number; criticalUnack: number; pendingVerification: number; drafts: number; deliveredToday: number };

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    draft: "bg-slate-200 text-slate-700",
    pending_verification: "bg-amber-100 text-amber-800",
    verified: "bg-blue-100 text-blue-800",
    delivered: "bg-emerald-100 text-emerald-800",
  };
  const label: Record<string, string> = {
    draft: "Draft", pending_verification: "Pending Verify", verified: "Verified", delivered: "Delivered",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls[status] ?? "bg-slate-200"}`}>{label[status] ?? status}</span>;
}

function emptyParam(): Param { return { name: "", result: "", unit: "", refRange: "", flag: "normal" }; }

// HL7-style AbnormalFlag ("N"/"L"/"H"/"LL"/"HH"/"A"/"AA"/"") from the
// pathology registry → this grid's 4-state flag. Categorical abnormal
// ("A"/"AA") and "unknown" (unresolvable analyte, non-numeric result,
// implausible value) have no clean low/high mapping — return null so the
// caller leaves the manual flag untouched rather than guessing.
function mapAbnormalFlag(flag: string): Param["flag"] | null {
  switch (flag) {
    case "N": return "normal";
    case "L": return "low";
    case "H": return "high";
    case "LL": return "critical";
    case "HH": return "critical";
    default: return null;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────
export default function ReportHub() {
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [stats, setStats] = useState<Stats>({ totalReports: 0, criticalUnack: 0, pendingVerification: 0, drafts: 0, deliveredToday: 0 });
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorReport, setEditorReport] = useState<ReportRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sigManagerOpen, setSigManagerOpen] = useState(false);
  const [selected, setSelected] = useState<ReportRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType !== "all") params.set("type", filterType);
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (tab === "critical") params.set("critical", "true");
      else if (tab === "pending") params.set("status", "pending_verification");
      else if (tab === "drafts") params.set("status", "draft");
      if (search.trim()) params.set("search", search.trim());
      const resp = await api.get<ReportRow[] | { items: ReportRow[]; total: number }>(`/api/patient-reports?${params.toString()}`);
      setReports(Array.isArray(resp) ? resp : (resp?.items ?? []));
      const s = await api.get<Stats>("/api/patient-reports/stats");
      setStats(s);
    } catch (err) {
      toast({ title: "Failed to load", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  async function refreshSignatures() {
    try {
      const list = await api.get<Signature[]>("/api/signatures");
      setSignatures(list);
    } catch { /* ignore */ }
  }

  useEffect(() => { refresh(); refreshSignatures(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, filterType, filterStatus]);
  useEffect(() => {
    const t = setTimeout(refresh, 300);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search]);

  function openEditor(r: ReportRow) { setEditorReport(r); setEditorOpen(true); }
  function openSign(r: ReportRow) { setSelected(r); setSignOpen(true); }
  function openVerify(r: ReportRow) { setSelected(r); setVerifyOpen(true); }
  function openShare(r: ReportRow) { setSelected(r); setShareOpen(true); }
  // R1.4 — these routes require the staff Bearer token (requireStaffAuth
  // only accepts it via the Authorization header, never a cookie); a raw
  // window.open() browser navigation never attaches it, so every click used
  // to open a blank tab showing the 401 JSON body instead of the report.
  // Fetch via api.get() (which attaches the token) and write the HTML into a
  // window opened SYNCHRONOUSLY first, before the await — the same
  // popup-blocker-safe pattern the canonical Workspace's Print button uses.
  async function openPrint(r: ReportRow) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    // R1.4 review finding: GET /:id/print unconditionally records a
    // share-log entry, flips a verified report to "delivered", and writes an
    // audit entry — checking `!w` AFTER the fetch let a blocked popup still
    // leave a false "delivered" record behind with nothing ever shown to the
    // user. Bail out before the authenticated fetch runs.
    if (!w) { toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" }); return; }
    try {
      const html = await api.get<string>(`/api/patient-reports/${r.id}/print`);
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch (err) {
      w.close();
      toast({ title: "Could not open print view", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTimeout(refresh, 1500);
    }
  }
  async function openPdf(r: ReportRow) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    // R1.4 review finding: same false-delivery-record risk as openPrint()
    // above — bail out before the authenticated fetch runs.
    if (!w) { toast({ title: "Popup blocked", description: "Allow popups for this site to download the PDF.", variant: "destructive" }); return; }
    try {
      // /pdf now returns a real application/pdf binary (not HTML) — fetched
      // as a Blob (api.get's res.text() would corrupt it) and navigated to
      // via an object URL so the browser's own PDF viewer renders it.
      const blob = await api.getBlob(`/api/patient-reports/${r.id}/pdf`);
      const url = URL.createObjectURL(blob);
      w.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      w.close();
      toast({ title: "Could not open PDF view", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTimeout(refresh, 1500);
    }
  }

  async function ackCritical(r: ReportRow) {
    const who = window.prompt("Acknowledged by (your name)?");
    if (!who) return;
    try {
      await api.post(`/api/patient-reports/${r.id}/acknowledge-critical`, { acknowledgedBy: who });
      toast({ title: "Acknowledged" });
      refresh();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto bg-slate-50 dark:bg-slate-900/20 min-h-full">
      <PageHeader title="Report Generation" subtitle="Pathology + radiology reports — sign, verify, mark critical, print, share." />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total" value={stats.totalReports} borderColor="border-l-slate-400" />
        <KpiCard label="Drafts" value={stats.drafts} borderColor="border-l-blue-400" />
        <KpiCard label="Pending Verify" value={stats.pendingVerification} borderColor="border-l-amber-500" />
        <KpiCard label="Delivered (24h)" value={stats.deliveredToday} borderColor="border-l-emerald-500" />
        <KpiCard label="Critical Alerts" value={stats.criticalUnack} borderColor="border-l-rose-500" highlight={stats.criticalUnack > 0} />
      </div>

      {/* Action bar card */}
      <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-border bg-gradient-to-r from-violet-50 to-transparent border-l-4 border-l-violet-500">
          <FileText className="h-4 w-4 text-violet-600" />
          <span className="text-sm font-semibold text-slate-700 dark:text-foreground">Reports</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by patient, report #, title…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="pathology">Pathology</SelectItem>
              <SelectItem value="radiology">Radiology</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_verification">Pending Verify</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
          <Button variant="outline" onClick={() => setSigManagerOpen(true)}><Stamp className="h-4 w-4 mr-1" /> Signatures</Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md"
          >
            <Plus className="h-4 w-4 mr-1" /> New Report
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All ({stats.totalReports})</TabsTrigger>
          <TabsTrigger value="critical" data-testid="tab-critical">Critical Alerts ({stats.criticalUnack})</TabsTrigger>
          <TabsTrigger value="pending">Pending Verification ({stats.pendingVerification})</TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({stats.drafts})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          <div className="rounded-xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-muted/50 border-b border-slate-200 dark:border-border">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Report #</th>
                  <th className="px-3 py-2 font-semibold">Patient</th>
                  <th className="px-3 py-2 font-semibold">Test</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Signed / Verified</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No reports yet. Click <strong>New Report</strong> to create one.</td></tr>
                ) : reports.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button onClick={() => openEditor(r)} className="font-mono text-xs text-primary underline-offset-2 hover:underline">{r.reportNumber}</button>
                      {r.isCritical && (
                        <span className="ml-1 inline-flex items-center text-rose-600" title={r.criticalNote ?? "Critical"}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.patientName || "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{r.patientCode ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.testName ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">{r.testCode ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 uppercase text-xs">{r.type}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} />
                      {isPendingStructuredVerify(r) && (
                        <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">Pending Verify</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] leading-tight">
                      {r.signedByName ? <div>✍ {r.signedByName}</div> : <span className="text-muted-foreground">—</span>}
                      {r.verifiedByName ? <div className="text-blue-700">✓ {r.verifiedByName}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => openEditor(r)} data-testid={`btn-edit-${r.id}`}><Eye className="h-3.5 w-3.5 mr-1" /> Open</Button>
                        {r.status === "draft" && !isPendingStructuredVerify(r) && <Button size="sm" onClick={() => openSign(r)}><ShieldCheck className="h-3.5 w-3.5 mr-1" /> Sign</Button>}
                        {(r.status === "pending_verification" || isPendingStructuredVerify(r)) && <Button size="sm" onClick={() => openVerify(r)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verify</Button>}
                        {(r.status === "verified" || r.status === "delivered") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openPrint(r)}><Printer className="h-3.5 w-3.5 mr-1" /> Print</Button>
                            <Button size="sm" variant="outline" onClick={() => openPdf(r)}><Download className="h-3.5 w-3.5 mr-1" /> PDF</Button>
                            <Button size="sm" variant="outline" onClick={() => openShare(r)}><Send className="h-3.5 w-3.5 mr-1" /> Share</Button>
                          </>
                        )}
                        {r.isCritical && !r.criticalAcknowledgedAt && (
                          <Button size="sm" variant="outline" className="text-rose-600 border-rose-300" onClick={() => ackCritical(r)} data-testid={`btn-ack-${r.id}`}>Ack</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {createOpen && <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(r) => { setCreateOpen(false); openEditor(r); refresh(); }} />}
      {editorOpen && editorReport && <EditorDialog open={editorOpen} onOpenChange={(v) => { setEditorOpen(v); if (!v) refresh(); }} reportId={editorReport.id} signatures={signatures} onSign={openSign} onVerify={openVerify} onShare={openShare} onPrint={openPrint} onPdf={openPdf} />}
      {signOpen && selected && <SignDialog open={signOpen} onOpenChange={setSignOpen} report={selected} signatures={signatures} onDone={() => { setSignOpen(false); refresh(); }} />}
      {verifyOpen && selected && <VerifyDialog open={verifyOpen} onOpenChange={setVerifyOpen} report={selected} signatures={signatures} onDone={() => { setVerifyOpen(false); refresh(); }} />}
      {shareOpen && selected && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} report={selected} onDone={() => { setShareOpen(false); refresh(); }} />}
      {sigManagerOpen && <SignatureManagerDialog open={sigManagerOpen} onOpenChange={setSigManagerOpen} signatures={signatures} onChanged={refreshSignatures} />}
    </div>
  );
}

function KpiCard({ label, value, borderColor, highlight }: { label: string; value: number; borderColor: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 dark:border-border bg-white dark:bg-card shadow-sm border-l-4 ${borderColor} p-3 ${highlight ? "ring-2 ring-rose-300 animate-pulse" : ""}`}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Create dialog — pick patient + test, create draft report
// ────────────────────────────────────────────────────────────────────────────
function CreateReportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (r: ReportRow) => void }) {
  const { toast } = useToast();
  const { data: patientsResp } = useListPatients({ limit: 200 }) as { data?: { patients?: Patient[] } };
  const patients = patientsResp?.patients ?? [];
  const [tests, setTests] = useState<Test[]>([]);
  const [patientId, setPatientId] = useState<string>("");
  const [testId, setTestId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"pathology" | "radiology">("pathology");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ tests: Test[] } | Test[]>("/api/tests?limit=500")
      .then((r) => setTests(Array.isArray(r) ? r : (r?.tests ?? [])))
      .catch(() => setTests([]));
  }, []);

  async function submit() {
    if (!patientId || !testId) {
      toast({ title: "Patient and test required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<ReportRow>("/api/patient-reports", {
        patientId: Number(patientId),
        testId: Number(testId),
        type,
        title: title.trim() || undefined,
      });
      toast({ title: "Report created", description: r.reportNumber });
      onCreated(r);
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Report</DialogTitle>
          <DialogDescription>Pick the patient and test. You'll fill in the body next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Patient</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger><SelectValue placeholder="Select patient…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {patients.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.firstName} {p.lastName} ({p.patientId})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Test</Label>
            <Select value={testId} onValueChange={setTestId}>
              <SelectTrigger><SelectValue placeholder="Select test…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {tests.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name} ({t.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "pathology" | "radiology")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pathology">Pathology</SelectItem>
                <SelectItem value="radiology">Radiology</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Title (optional)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CBC — fasting" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="btn-create-report">{busy ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// D8 — amendment-version safeguards: a superseded report never displays as if
// it is current; the latest amendment announces its version and reason.
// ────────────────────────────────────────────────────────────────────────────
function VersionBanner({ report, onOpenVersion }: {
  report: ReportRow;
  onOpenVersion: (id: number, historical: boolean) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const v = report.version;
  if (!v) return null;

  const warning = v.warnings.length > 0 ? (
    <div className="rounded-md border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2 text-xs font-semibold">
      ⚠ Amendment history warning — the version chain for this report could not be fully verified. Showing the requested version.
    </div>
  ) : null;

  if (v.totalVersions <= 1) return warning;

  const history = showHistory && v.chain && v.chain.length > 0 && (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
      {v.chain.map((c) => (
        <div key={c.reportId} className="flex items-center gap-2">
          <span className="font-semibold">V{c.sequenceNumber}</span>
          <span className="font-mono">{c.reportNumber ?? `#${c.reportId}`}</span>
          {c.isLatest && <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">LATEST</span>}
          {c.reason && <span className="text-muted-foreground truncate" title={c.reason}>— {c.reason}</span>}
          {c.amendedByName && <span className="text-muted-foreground">by {c.amendedByName}{c.amendedAt ? ` on ${new Date(c.amendedAt).toLocaleDateString("en-IN")}` : ""}</span>}
          {c.reportId !== report.id && (
            <Button size="sm" variant="ghost" className="h-5 px-2 text-[11px] ml-auto" onClick={() => onOpenVersion(c.reportId, !c.isLatest)}>Open</Button>
          )}
        </div>
      ))}
    </div>
  );

  if (v.superseded) {
    return (
      <div className="space-y-2">
        {warning}
        <div className="rounded-md border-2 border-red-800 bg-red-700 text-white px-3 py-2 text-sm font-bold">
          SUPERSEDED — A newer signed amendment exists
          <div className="text-xs font-medium mt-1">
            This is Version {v.sequenceNumber} of {v.totalVersions}. Do not use for clinical decisions.
            {v.latestAmendmentReason && <> Latest amendment reason: {v.latestAmendmentReason}</>}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => onOpenVersion(v.latestReportId, false)}>Open latest version</Button>
            <Button size="sm" variant="ghost" className="text-white" onClick={() => setShowHistory((s) => !s)}>History</Button>
          </div>
        </div>
        {history}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {warning}
      <div className="rounded-md border border-blue-500 bg-blue-50 text-blue-900 px-3 py-2 text-xs font-semibold">
        Amended report — Version {v.sequenceNumber} of {v.totalVersions}
        {v.amendmentReason && <> • Reason: {v.amendmentReason}</>}
        {v.resolvedReportId !== v.requestedReportId && (
          <span className="font-normal"> (requested version was superseded — showing the latest signed version)</span>
        )}
        <div className="mt-1 flex gap-2">
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setShowHistory((s) => !s)}>History</Button>
          {v.resolvedReportId !== v.requestedReportId && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onOpenVersion(v.requestedReportId, true)}>View original as requested</Button>
          )}
        </div>
      </div>
      {history}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// D9 — amendment lifecycle: pending-verification banner (with Verify action)
// and the re-delivery prompt when a verified amendment supersedes a report
// that was already delivered. Additive; the D8 VersionBanner stays as-is.
// ────────────────────────────────────────────────────────────────────────────
function LifecycleBanner({ report, onVerify, onShare }: {
  report: ReportRow;
  onVerify: (r: ReportRow) => void;
  onShare: (r: ReportRow) => void;
}) {
  const [dismissed, setDismissed] = useState(false); // session-local only; durable ack state is deferred
  const lc = report.lifecycle;
  if (!lc) return null;
  const v = report.version;

  if (lc.pendingVerification && lc.structuredSigned) {
    return (
      <div className="rounded-md border border-amber-500 bg-amber-50 text-amber-900 px-3 py-2 text-xs font-semibold">
        {lc.amendmentPendingVerification
          ? <>Amendment pending verification — Version {v?.sequenceNumber ?? "?"} of {v?.totalVersions ?? "?"}</>
          : <>Signed structured report — pending verification</>}
        {v?.amendmentReason && <span className="font-normal"> • Reason: {v.amendmentReason}</span>}
        <div className="font-normal mt-0.5">
          Signed by {report.signedByName ?? "—"} • Created {new Date(report.createdAt).toLocaleString("en-IN")}.
          A different authorized doctor must countersign before delivery.
        </div>
        <div className="mt-2">
          <Button size="sm" onClick={() => onVerify(report)}><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verify (countersign)</Button>
        </div>
      </div>
    );
  }

  if (lc.deliverable && lc.recipientNotificationPending && !dismissed) {
    return (
      <div className="rounded-md border border-emerald-500 bg-emerald-50 text-emerald-900 px-3 py-2 text-xs font-semibold">
        Verified amendment — Revision {v?.sequenceNumber ?? "?"}. Earlier version(s) were already delivered:
        <div className="font-normal mt-1 space-y-0.5">
          {lc.priorDeliveries.map((d, i) => (
            <div key={i}>• {d.channel}{d.recipient ? ` → ${d.recipient}` : ""}{d.at ? ` (${new Date(d.at).toLocaleDateString("en-IN")})` : ""}</div>
          ))}
        </div>
        <div className="font-normal mt-1">Recommend re-sharing the amended report so recipients are not left with the superseded version.</div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onShare(report)}><Send className="h-3.5 w-3.5 mr-1" /> Share amended report</Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Dismiss</Button>
        </div>
      </div>
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Editor — body + parameters + impression + critical + template
// ────────────────────────────────────────────────────────────────────────────
type Template = { id: number; testId: number; name: string; content: string; format: string };

function EditorDialog({
  open, onOpenChange, reportId, signatures, onSign, onVerify, onShare, onPrint, onPdf,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; reportId: number; signatures: Signature[];
  onSign: (r: ReportRow) => void; onVerify: (r: ReportRow) => void; onShare: (r: ReportRow) => void; onPrint: (r: ReportRow) => void; onPdf: (r: ReportRow) => void;
}) {
  const { toast } = useToast();
  const [report, setReport] = useState<(ReportRow & { shares: ReportShare[] }) | null>(null);
  const [body, setBody] = useState("");
  const [impression, setImpression] = useState("");
  const [params, setParams] = useState<Param[]>([]);
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  // D8 — which version this dialog is looking at. The server resolves the
  // default view to the latest signed version; explicit historical views pin
  // the exact row with ?version=specific.
  const [viewVersion, setViewVersion] = useState<{ id: number; historical: boolean }>({ id: reportId, historical: false });

  useEffect(() => { setViewVersion({ id: reportId, historical: false }); }, [reportId]);

  useEffect(() => {
    api.get<ReportRow & { shares: ReportShare[] }>(`/api/patient-reports/${viewVersion.id}${viewVersion.historical ? "?version=specific" : ""}`).then((r) => {
      setReport(r);
      setBody(r.body || "");
      setImpression(r.impression ?? "");
      setIsCritical(r.isCritical);
      setCriticalNote(r.criticalNote ?? "");
      try { setParams(r.parameters ? JSON.parse(r.parameters) : []); } catch { setParams([]); }
      api.get<Template[]>(`/api/patient-reports/templates/${r.testId}`).then(setTemplates).catch(() => setTemplates([]));
    }).catch((err) => toast({ title: "Load failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }));
  }, [viewVersion, toast]);

  const editable = report ? report.status === "draft" : false;

  async function save() {
    if (!report) return;
    setBusy(true);
    try {
      await api.patch(`/api/patient-reports/${report.id}`, { body, impression, parameters: params, isCritical, criticalNote: isCritical ? criticalNote : null });
      toast({ title: "Saved" });
      const r = await api.get<ReportRow & { shares: ReportShare[] }>(`/api/patient-reports/${report.id}`);
      setReport(r);
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  function applyTemplate(tpl: Template) {
    setBody((b) => (b ? `${b}\n\n${tpl.content}` : tpl.content));
    toast({ title: "Template applied", description: tpl.name });
  }
  function updateParam(i: number, field: keyof Param, v: string) {
    setParams((arr) => arr.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));
  }

  // Best-effort assist, never a dictate: suggests a flag and reference range
  // from the pathology registry (sex/age-aware) after a result is entered,
  // but never disables or overrides the manual Flag dropdown above it — a
  // subsequent manual change simply overwrites whatever was suggested here,
  // same as it always could. Silent on any failure (unresolvable analyte
  // name, network error, no registry match) since this is a convenience on
  // top of manual entry, not a required step.
  async function suggestFlag(i: number) {
    const row = params[i];
    if (!row || !row.name.trim() || !row.result.trim()) return;
    try {
      const res = await api.post<{
        result: { flag: string; rangeDisplay: string };
      }>("/api/pathology-flag-preview", {
        patientId: report?.patientId,
        analyte: row.name.trim(),
        value: row.result,
        unit: row.unit.trim() || undefined,
      });
      setParams((arr) => arr.map((p, idx) => {
        if (idx !== i) return p;
        const mapped = mapAbnormalFlag(res.result.flag);
        return {
          ...p,
          flag: mapped ?? p.flag,
          refRange: p.refRange.trim() || (res.result.rangeDisplay !== "—" ? res.result.rangeDisplay : p.refRange),
        };
      }));
    } catch { /* best-effort — manual entry is always available regardless */ }
  }

  if (!report) {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Loading…</DialogTitle></DialogHeader></DialogContent></Dialog>;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> {report.reportNumber} — {report.title}
            <StatusPill status={report.status} />
            {report.isCritical && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold uppercase"><AlertTriangle className="h-3 w-3" /> CRITICAL</span>}
          </DialogTitle>
          <DialogDescription>
            {report.patientName} ({report.patientCode}) • {report.testName} • Created {new Date(report.createdAt).toLocaleString("en-IN")}
          </DialogDescription>
        </DialogHeader>

        <VersionBanner report={report} onOpenVersion={(id, historical) => setViewVersion({ id, historical })} />
        <LifecycleBanner report={report} onVerify={onVerify} onShare={onShare} />

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            {/* Templates */}
            {templates.length > 0 && editable && (
              <div className="border rounded-md p-2 bg-muted/30">
                <div className="text-xs font-semibold mb-1">Insert template:</div>
                <div className="flex flex-wrap gap-1">
                  {templates.map((t) => (
                    <Button key={t.id} variant="outline" size="sm" onClick={() => applyTemplate(t)}>{t.name}</Button>
                  ))}
                </div>
              </div>
            )}

            {/* Pathology parameters */}
            {report.type === "pathology" && (
              <div className="border rounded-md">
                <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                  <div className="text-sm font-semibold">Parameters</div>
                  {editable && <Button size="sm" variant="outline" onClick={() => setParams((a) => [...a, emptyParam()])}><Plus className="h-3 w-3 mr-1" /> Add row</Button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30"><tr>
                      <th className="px-2 py-1 text-left font-semibold">Parameter</th>
                      <th className="px-2 py-1 text-left font-semibold">Result</th>
                      <th className="px-2 py-1 text-left font-semibold">Unit</th>
                      <th className="px-2 py-1 text-left font-semibold">Reference</th>
                      <th className="px-2 py-1 text-left font-semibold">Flag</th>
                      {editable && <th />}
                    </tr></thead>
                    <tbody>
                      {params.length === 0 && (<tr><td colSpan={editable ? 6 : 5} className="px-2 py-3 text-center text-muted-foreground">No parameters yet — add a row to capture structured pathology results.</td></tr>)}
                      {params.map((p, i) => (
                        <tr key={i} className={`border-t ${p.flag !== "normal" ? "bg-rose-50/50" : ""}`}>
                          <td className="px-2 py-1"><Input className="h-7 text-xs" disabled={!editable} value={p.name} onChange={(e) => updateParam(i, "name", e.target.value)} /></td>
                          <td className="px-2 py-1"><Input className="h-7 text-xs" disabled={!editable} value={p.result} onChange={(e) => updateParam(i, "result", e.target.value)} onBlur={() => void suggestFlag(i)} /></td>
                          <td className="px-2 py-1 w-24"><Input className="h-7 text-xs" disabled={!editable} value={p.unit} onChange={(e) => updateParam(i, "unit", e.target.value)} onBlur={() => void suggestFlag(i)} /></td>
                          <td className="px-2 py-1 w-32"><Input className="h-7 text-xs" disabled={!editable} value={p.refRange} onChange={(e) => updateParam(i, "refRange", e.target.value)} /></td>
                          <td className="px-2 py-1 w-28">
                            <Select value={p.flag} onValueChange={(v) => updateParam(i, "flag", v)} disabled={!editable}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="normal">Normal</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="critical">Critical</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          {editable && (
                            <td className="px-2 py-1 w-8">
                              <button onClick={() => setParams((a) => a.filter((_, idx) => idx !== i))} className="text-rose-500 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Impression */}
            <div>
              <Label>Impression / Summary</Label>
              <Input disabled={!editable} value={impression} onChange={(e) => setImpression(e.target.value)} placeholder="Single-line summary shown on the printout" />
            </div>

            {/* Body */}
            <div>
              <Label>Report Body</Label>
              <Textarea rows={10} disabled={!editable} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type the narrative report here…" />
            </div>

            {/* Critical alert */}
            <div className="border rounded-md p-3 bg-rose-50/50">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 m-0"><AlertTriangle className="h-4 w-4 text-rose-600" /> Mark as Critical</Label>
                <Switch checked={isCritical} onCheckedChange={setIsCritical} disabled={!editable} data-testid="switch-critical" />
              </div>
              {isCritical && (
                <Input className="mt-2" disabled={!editable} value={criticalNote} onChange={(e) => setCriticalNote(e.target.value)} placeholder="Critical-value note (e.g. Hb 4.2 g/dL — alert physician)" />
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-3">
            <div className="border rounded-md p-3 text-xs space-y-1">
              <div className="font-semibold mb-1">Workflow</div>
              <div>Status: <StatusPill status={report.status} /></div>
              {report.signedByName && <div>✍ Signed by <strong>{report.signedByName}</strong> {report.signedAt ? `on ${new Date(report.signedAt).toLocaleString("en-IN")}` : ""}</div>}
              {report.verifiedByName && <div>✓ Verified by <strong>{report.verifiedByName}</strong> {report.verifiedAt ? `on ${new Date(report.verifiedAt).toLocaleString("en-IN")}` : ""}</div>}
              {report.deliveredAt && <div>📤 Delivered {new Date(report.deliveredAt).toLocaleString("en-IN")}</div>}
            </div>

            <div className="border rounded-md p-3 text-xs space-y-1">
              <div className="font-semibold mb-1">Share Log ({report.shares.length})</div>
              {report.shares.length === 0 ? (
                <div className="text-muted-foreground">No shares yet.</div>
              ) : report.shares.map((s) => (
                <div key={s.id} className={`py-0.5 ${s.status === "failed" ? "text-rose-600" : ""}`}>
                  {new Date(s.createdAt).toLocaleString("en-IN")} • <strong>{s.channel.toUpperCase()}</strong>
                  {s.recipient ? ` → ${s.recipient}` : ""} {s.status === "failed" ? `(failed: ${s.errorMessage})` : ""}
                </div>
              ))}
            </div>

            <div className="border rounded-md p-3 text-xs space-y-2">
              <div className="font-semibold">Actions</div>
              {editable && <Button onClick={save} disabled={busy} className="w-full">{busy ? "Saving…" : "Save Draft"}</Button>}
              {report.status === "draft" && !report.lifecycle?.structuredSigned && <Button onClick={() => onSign(report)} className="w-full" variant="default" data-testid="btn-sidebar-sign"><ShieldCheck className="h-4 w-4 mr-1" /> Sign</Button>}
              {(report.status === "pending_verification" || (report.lifecycle?.pendingVerification && report.lifecycle?.structuredSigned)) && <Button onClick={() => onVerify(report)} className="w-full"><CheckCircle2 className="h-4 w-4 mr-1" /> Verify</Button>}
              {(report.status === "verified" || report.status === "delivered") && (
                <>
                  <Button onClick={() => onPrint(report)} variant="outline" className="w-full"><Printer className="h-4 w-4 mr-1" /> Print</Button>
                  <Button onClick={() => onPdf(report)} variant="outline" className="w-full"><Download className="h-4 w-4 mr-1" /> PDF</Button>
                  <Button onClick={() => onShare(report)} variant="outline" className="w-full"><Send className="h-4 w-4 mr-1" /> Share</Button>
                </>
              )}
            </div>

            {!editable && (
              <div className="border rounded-md p-3 text-[11px] bg-amber-50 text-amber-800">This report is locked. Body and parameters can no longer be edited (verified or higher).</div>
            )}
            {signatures.length === 0 && (
              <div className="border rounded-md p-3 text-[11px] bg-amber-50 text-amber-800">No signatures uploaded yet — open the <strong>Signatures</strong> manager from the toolbar to add doctor signatures before signing reports.</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sign / Verify
// ────────────────────────────────────────────────────────────────────────────
function SignDialog({ open, onOpenChange, report, signatures, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; report: ReportRow; signatures: Signature[]; onDone: () => void }) {
  const { toast } = useToast();
  const active = signatures.filter((s) => s.isActive);
  const [signatureId, setSignatureId] = useState<string>(active[0] ? String(active[0].id) : "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/patient-reports/${report.id}/sign`, {
        signatureId: signatureId ? Number(signatureId) : null,
        signedByName: name.trim() || undefined,
      });
      toast({ title: "Report signed" });
      onDone();
    } catch (err) {
      toast({ title: "Sign failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sign Report — {report.reportNumber}</DialogTitle>
          <DialogDescription>The report will move to <strong>Pending Verification</strong> and then need to be counter-signed by another doctor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Signature</Label>
            <Select value={signatureId} onValueChange={setSignatureId}>
              <SelectTrigger><SelectValue placeholder="Choose a signature on file…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None / Type name only —</SelectItem>
                {active.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Override name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to use signature's name" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="btn-confirm-sign">{busy ? "Signing…" : "Sign"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ open, onOpenChange, report, signatures, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; report: ReportRow; signatures: Signature[]; onDone: () => void }) {
  const { toast } = useToast();
  const candidates = signatures.filter((s) => s.isActive && s.id !== report.signatureId);
  const [signatureId, setSignatureId] = useState<string>(candidates[0] ? String(candidates[0].id) : "");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/patient-reports/${report.id}/verify`, {
        signatureId: signatureId ? Number(signatureId) : null,
        verifiedByName: name.trim() || undefined,
        verifierNotes: notes.trim() || undefined,
      });
      toast({ title: "Report verified" });
      onDone();
    } catch (err) {
      toast({ title: "Verify failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verify Report — {report.reportNumber}</DialogTitle>
          <DialogDescription>Counter-sign by a different doctor. Once verified, the body cannot be edited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">Originally signed by: <strong>{report.signedByName ?? "—"}</strong></div>
          <div>
            <Label>Verifier signature</Label>
            <Select value={signatureId} onValueChange={setSignatureId}>
              <SelectTrigger><SelectValue placeholder="Choose verifier…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">— None / Type name only —</SelectItem>
                {candidates.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Override name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave blank to use signature's name" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Verifier remarks (optional)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="btn-confirm-verify">{busy ? "Verifying…" : "Verify"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Share
// ────────────────────────────────────────────────────────────────────────────
function ShareDialog({ open, onOpenChange, report, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; report: ReportRow; onDone: () => void }) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<"whatsapp" | "email">(report.patientPhone ? "whatsapp" : "email");
  const [recipient, setRecipient] = useState<string>(channel === "whatsapp" ? (report.patientPhone ?? "") : (report.patientEmail ?? ""));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRecipient(channel === "whatsapp" ? (report.patientPhone ?? "") : (report.patientEmail ?? ""));
  }, [channel, report]);

  async function submit() {
    setBusy(true);
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/api/patient-reports/${report.id}/share`, { channel, recipient });
      if (result.ok) {
        toast({ title: `${channel.toUpperCase()} sent`, description: recipient });
        onDone();
      } else {
        toast({ title: "Share failed", description: result.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Share failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share — {report.reportNumber}</DialogTitle>
          <DialogDescription>Send the report link to the patient. Each share is logged.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as "whatsapp" | "email")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp"><Send className="h-3 w-3 inline mr-1" /> WhatsApp</SelectItem>
                <SelectItem value="email"><Mail className="h-3 w-3 inline mr-1" /> Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{channel === "whatsapp" ? "Phone" : "Email"}</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={channel === "whatsapp" ? "+91XXXXXXXXXX" : "patient@email.com"} />
          </div>
          <div className="text-[11px] text-muted-foreground">Share link will be: <code>/api/patient-reports/{report.id}/pdf</code></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !recipient} data-testid="btn-confirm-share">{busy ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Signature Manager
// ────────────────────────────────────────────────────────────────────────────
function SignatureManagerDialog({ open, onOpenChange, signatures, onChanged }: { open: boolean; onOpenChange: (v: boolean) => void; signatures: Signature[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Pathologist");
  const [qualification, setQualification] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast({ title: "Image too large", description: "Max 1 MB", variant: "destructive" }); return; }
    setImageDataUrl(await fileToDataUrl(f));
  }

  async function add() {
    if (!name.trim() || !imageDataUrl) { toast({ title: "Name and signature image required", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await api.post("/api/signatures", { name, role, qualification, registrationNo, imageDataUrl });
      toast({ title: "Signature added" });
      setName(""); setQualification(""); setRegistrationNo(""); setImageDataUrl(""); if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!window.confirm("Deactivate this signature?")) return;
    try {
      await api.delete(`/api/signatures/${id}`);
      toast({ title: "Deactivated" });
      onChanged();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Doctor / Radiologist Signatures</DialogTitle>
          <DialogDescription>Upload signatures (PNG/JPG, max 1 MB). They appear on the printed report and on the audit trail.</DialogDescription>
        </DialogHeader>

        <div className="border rounded-md p-3 space-y-2 bg-muted/30">
          <div className="text-sm font-semibold">Add new</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. R. Sharma" data-testid="input-sig-name" /></div>
            <div><Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pathologist">Pathologist</SelectItem>
                  <SelectItem value="Radiologist">Radiologist</SelectItem>
                  <SelectItem value="Lab Director">Lab Director</SelectItem>
                  <SelectItem value="Doctor">Doctor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Qualification</Label><Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="MD (Pathology)" /></div>
            <div><Label>Registration No.</Label><Input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="12345/MMC" /></div>
          </div>
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={pick} className="text-xs" data-testid="input-sig-file" />
            {imageDataUrl && <img src={imageDataUrl} alt="preview" className="h-10 max-w-[180px] object-contain border rounded bg-white" />}
            {imageDataUrl && <button onClick={() => { setImageDataUrl(""); if (fileRef.current) fileRef.current.value = ""; }} className="text-xs text-rose-600 hover:underline"><XIcon className="h-3 w-3 inline" /> clear</button>}
          </div>
          <Button onClick={add} disabled={busy} data-testid="btn-add-signature"><Upload className="h-4 w-4 mr-1" /> {busy ? "Saving…" : "Add Signature"}</Button>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">On file ({signatures.length})</div>
          {signatures.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3">No signatures yet.</div>
          ) : (
            <div className="space-y-1">
              {signatures.map((s) => (
                <div key={s.id} className={`flex items-center gap-3 border rounded-md p-2 ${!s.isActive ? "opacity-50" : ""}`}>
                  <img src={s.imageDataUrl} alt={s.name} className="h-10 w-32 object-contain bg-white border rounded" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{s.name} {!s.isActive && <span className="text-xs text-muted-foreground">(inactive)</span>}</div>
                    <div className="text-[11px] text-muted-foreground">{s.role} • {s.qualification} {s.registrationNo ? `• Reg ${s.registrationNo}` : ""}</div>
                  </div>
                  {s.isActive && <Button size="sm" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
