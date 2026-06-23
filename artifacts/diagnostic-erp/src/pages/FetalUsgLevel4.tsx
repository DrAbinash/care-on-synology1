import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Baby, Zap, Save, Send, AlertTriangle, CheckCircle2, ChevronLeft, Stethoscope,
  Plus, Filter, RefreshCw, FileText, CheckCircle, Download, Phone, Mail, ExternalLink,
  Mic, MicOff, Calendar, BarChart3,
  Settings2,
} from "lucide-react";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";

interface Study {
  id: number; studyId: number; patientId: number; studyType: string; trimester: string;
  status: string; gaWeeks?: number; gaDays?: number; edd?: string; lmp?: string;
  isTwin?: boolean; createdAt: string;
}

interface Measurements {
  crl?: number; msd?: number; yolkSac?: number; fetalHeartRate?: number;
  nt?: number; nasalBone?: string; ductusVenousus?: string; tricuspidFlow?: string;
  bpd?: number; hc?: number; ac?: number; fl?: number; hl?: number; efw?: number; efwPercentile?: number;
  afi?: number; afiInterpretation?: string; sdp?: number;
  placentaLocation?: string; placentaGrade?: string; presentation?: string;
  cervicalLength?: number; cervicalLengthInterpretation?: string;
  umbilicalArteryPi?: number; umbilicalArteryRi?: number; umbilicalArterySd?: number;
  mcaPi?: number; mcaRi?: number; cpr?: number; ductusVenoususPi?: number; ductusVenoususAWave?: string;
  uterineArteryPi?: number; uterineArteryRi?: number;
  twinA_fhr?: number; twinA_bpd?: number; twinA_hc?: number; twinA_ac?: number; twinA_fl?: number; twinA_efw?: number; twinA_presentation?: string;
  twinB_fhr?: number; twinB_bpd?: number; twinB_hc?: number; twinB_ac?: number; twinB_fl?: number; twinB_efw?: number; twinB_presentation?: string;
  discordancePercent?: number;
  bppFetalBreathing?: number; bppFetalMovement?: number; bppFetalTone?: number; bppAfi?: number; bppTotal?: number; nstDone?: boolean; nstResult?: string;
}

interface Checklist {
  skullBrain?: string; face?: string; spine?: string; thorax?: string; heartFourChamber?: string;
  outflowTracts?: string; abdomen?: string; stomachBubble?: string; kidneys?: string;
  urinaryBladder?: string; cordInsertion?: string; limbs?: string; placenta?: string; liquor?: string; cervix?: string; notes?: string;
}

interface Report {
  id?: number; findings?: string; impression?: string; recommendation?: string; aiDraft?: string;
  status?: string; criticalAlertsAcknowledged?: boolean;
}

const STUDY_TYPES = ["early", "nt", "anomaly", "growth", "doppler", "bpp", "twin", "followup"];
const CHECKLIST_OPTIONS = ["not_assessed", "normal", "abnormal"];
const NASAL_BONE_OPTIONS = ["present", "absent", "hypoplastic", "not_assessed"];
const DV_OPTIONS = ["normal", "absent", "reversed", "not_assessed"];
const TRICUSPID_OPTIONS = ["normal", "regurgitation", "not_assessed"];
const PLACENTA_LOCATIONS = ["anterior", "posterior", "fundal", "lateral", "low_lying", "previa"];
const PLACENTA_GRADES = ["0", "1", "2", "3"];
const PRESENTATIONS = ["cephalic", "breech", "transverse", "oblique", "not_assessed"];
const NST_RESULTS = ["reactive", "non_reactive", "suspicious", "not_done"];

export default function FetalUsgLevel4() {
  const [location, setLocation] = useLocation();
  const [, params] = useRoute("/fetal-usg/:studyId");
  const { toast } = useToast();
  const [studyId, setStudyId] = useState<number | null>(null);
  const [study, setStudy] = useState<Study | null>(null);
  const [meas, setMeas] = useState<Measurements>({});
  const [checklist, setChecklist] = useState<Checklist>({});
  const [report, setReport] = useState<Report>({});
  const [criticalAlerts, setCriticalAlerts] = useState<string[]>([]);
  const [worklist, setWorklist] = useState<Study[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("worklist");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<"findings" | "impression" | "recommendation" | null>(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<Array<{ type: string; reason: string; suggestedGa?: string }>>([]);
  const recognitionRef = useRef<any>(null);
  // Print / PDF
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const { data: clinicSettings } = useQuery<{ name?: string; tagline?: string; address?: string; phone?: string; email?: string; website?: string; logoDataUrl?: string | null }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const routeStudyId = params?.studyId ? Number(params.studyId) : null;

  useEffect(() => {
    if (routeStudyId) {
      setStudyId(routeStudyId);
      setActiveTab("measurements");
      loadStudy(routeStudyId);
    } else {
      loadWorklist();
    }
  }, [routeStudyId]);

  async function loadWorklist() {
    setLoading(true);
    try {
      const res = await api.get<{ worklist: Study[] }>("/api/fetal-usg/worklist");
      setWorklist(res.worklist);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  async function loadStudy(sid: number) {
    setLoading(true);
    try {
      const res = await api.get<{ study: Study; measurements: Measurements | null; checklist: Checklist | null; report: Report | null; alerts: string[] }>(`/api/fetal-usg/${sid}`);
      setStudy(res.study);
      if (res.measurements) setMeas(res.measurements);
      if (res.checklist) setChecklist(res.checklist);
      if (res.report) setReport(res.report);
      setCriticalAlerts(res.alerts);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  async function createStudy() {
    setLoading(true);
    try {
      const res = await api.post<{ study: Study }>("/api/fetal-usg/study", { patientId: 1, studyId: 1, studyType: "early" });
      toast({ title: "Study created" });
      loadWorklist();
      setLocation(`/fetal-usg/${res.study.id}`);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  async function saveMeasurements() {
    if (!studyId) return;
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; alerts: string[] }>(`/api/fetal-usg/${studyId}/measurements`, meas);
      setCriticalAlerts(res.alerts);
      toast({ title: "Measurements saved", description: res.alerts.length > 0 ? `${res.alerts.length} alert(s) detected` : undefined });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setSaving(false); }
  }

  async function saveChecklist() {
    if (!studyId) return;
    setSaving(true);
    try {
      await api.post(`/api/fetal-usg/${studyId}/checklist`, checklist);
      toast({ title: "Checklist saved" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setSaving(false); }
  }

  async function saveDraft() {
    if (!studyId) return;
    setSaving(true);
    try {
      await api.post(`/api/fetal-usg/${studyId}/save-draft`, report);
      toast({ title: "Draft saved" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setSaving(false); }
  }

  async function generateDraft() {
    if (!studyId) return;
    setLoading(true);
    try {
      const res = await api.post<{ aiDraft: string }>(`/api/fetal-usg/${studyId}/generate-draft`, {});
      setReport((prev) => ({ ...prev, aiDraft: res.aiDraft }));
      toast({ title: "AI Draft generated" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  async function reviewReport() {
    if (!studyId) return;
    try {
      await api.post(`/api/fetal-usg/${studyId}/review`, {});
      setReport((prev) => ({ ...prev, status: "reviewed" }));
      if (study) setStudy({ ...study, status: "reviewed" });
      toast({ title: "Reviewed" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  async function finalizeReport() {
    if (!studyId) return;
    try {
      await api.post(`/api/fetal-usg/${studyId}/final-sign`, {});
      setReport((prev) => ({ ...prev, status: "final" }));
      if (study) setStudy({ ...study, status: "final" });
      toast({ title: "Finalized" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.error || String(e) });
    }
  }

  async function acknowledgeCritical() {
    if (!studyId) return;
    try {
      await api.post(`/api/fetal-usg/${studyId}/acknowledge-critical`, {});
      setReport((prev) => ({ ...prev, criticalAlertsAcknowledged: true }));
      toast({ title: "Acknowledged" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  function updateMeas<K extends keyof Measurements>(key: K, value: Measurements[K]) {
    setMeas((prev) => ({ ...prev, [key]: value }));
  }

  function updateChecklist<K extends keyof Checklist>(key: K, value: Checklist[K]) {
    setChecklist((prev) => ({ ...prev, [key]: value }));
  }

  // --- PDF Generation ---
  function downloadPdf() {
    if (!study) return;
    const measurements = [
      { label: "CRL", value: meas.crl?.toString() ?? "" },
      { label: "NT", value: meas.nt?.toString() ?? "" },
      { label: "BPD", value: meas.bpd?.toString() ?? "" },
      { label: "HC", value: meas.hc?.toString() ?? "" },
      { label: "AC", value: meas.ac?.toString() ?? "" },
      { label: "FL", value: meas.fl?.toString() ?? "" },
      { label: "EFW", value: meas.efw?.toString() ?? "" },
      { label: "AFI", value: meas.afi?.toString() ?? "" },
      { label: "FHR", value: meas.fetalHeartRate?.toString() ?? "" },
    ].filter((m) => m.value);
    generateReportPDF({
      patientName: `Patient #${study.patientId}`,
      studyDate: new Date(study.createdAt).toLocaleDateString(),
      modality: "USG",
      bodyPart: study.studyType.toUpperCase(),
      clinicalHistory: `GA: ${study.gaWeeks ? `${study.gaWeeks}w ${study.gaDays ?? 0}d` : "?"} | EDD: ${study.edd ?? "?"}`,
      findings: report.findings,
      impression: report.impression,
      recommendation: report.recommendation,
      measurements,
      reportTitle: "Fetal USG Level-4 Report",
    }, printSettings, clinicSettings ?? null);
    toast({ title: "PDF downloaded" });
  }

  // --- Voice Dictation ---
  function toggleVoice(target: "findings" | "impression" | "recommendation") {
    if (voiceActive && voiceTarget === target) {
      recognitionRef.current?.stop();
      setVoiceActive(false);
      setVoiceTarget(null);
      return;
    }
    if (voiceActive) {
      recognitionRef.current?.stop();
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ variant: "destructive", title: "Speech recognition not supported in this browser" });
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event: any) => {
      const text = Array.from(event.results).map((r: any) => r[0].transcript).join(" ");
      setReport((prev) => ({ ...prev, [target]: (prev[target as keyof Report] ?? "" as any) + text }));
    };
    rec.onerror = (e: any) => {
      if (e.error !== "aborted") toast({ variant: "destructive", title: "Voice error", description: e.error });
      setVoiceActive(false);
    };
    rec.onend = () => setVoiceActive(false);
    rec.start();
    recognitionRef.current = rec;
    setVoiceActive(true);
    setVoiceTarget(target);
  }

  // --- Follow-up Suggestion ---
  async function fetchFollowUpSuggestions() {
    if (!studyId) return;
    try {
      const res = await api.get<{ suggestions: Array<{ type: string; reason: string; suggestedGa?: string }> }>(`/api/fetal-usg/${studyId}/follow-up-suggestion`);
      setFollowUpSuggestions(res.suggestions);
      setShowFollowUp(true);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  // --- PACS Viewer ---
  async function openPacsViewer() {
    if (!studyId) return;
    try {
      const res = await api.get<{ viewerUrl: string; weasisUrl: string | null }>(`/api/fetal-usg/${studyId}/pacs-viewer`);
      window.open(res.viewerUrl, "_blank");
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  // --- DICOM SR Extract ---
  async function extractDicomMeasurements() {
    if (!studyId) return;
    setLoading(true);
    try {
      const res = await api.post<{ extracted: Record<string, number | string | null> }>(`/api/fetal-usg/${studyId}/extract-measurements`, {});
      toast({ title: "DICOM extraction", description: res.extracted.status as string });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  const filteredWorklist = filter === "all" ? worklist : worklist.filter((s) => {
    if (filter === "today") return new Date(s.createdAt).toISOString().split("T")[0] === new Date().toISOString().split("T")[0];
    if (filter === "pending") return s.status === "received" || s.status === "draft";
    if (filter === "finalized") return s.status === "final";
    if (filter === "first") return s.trimester === "first";
    if (filter === "nt") return s.studyType === "nt";
    if (filter === "anomaly") return s.studyType === "anomaly";
    if (filter === "growth") return s.studyType === "growth";
    if (filter === "bpp") return s.studyType === "bpp";
    if (filter === "twin") return s.isTwin;
    return true;
  });

  const statusBadge = (s: string) => {
    if (s === "final") return <Badge>Final</Badge>;
    if (s === "reviewed") return <Badge variant="secondary">Reviewed</Badge>;
    if (s === "draft") return <Badge variant="outline">Draft</Badge>;
    return <Badge variant="outline">Received</Badge>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fetal USG Level-4"
        subtitle="Advanced fetal ultrasound reporting with measurements, checklist, AI draft, and critical alerts"
        actions={
          <div className="flex gap-2">
            {studyId && (
              <Button size="sm" variant="outline" onClick={() => { setLocation("/fetal-usg"); setStudyId(null); }}>
                <ChevronLeft size={14} className="mr-1" /> Back
              </Button>
            )}
            <Button size="sm" onClick={createStudy} disabled={loading}>
              <Plus size={14} className="mr-1" /> New Study
            </Button>
          </div>
        }
      />

      {!studyId && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="worklist"><FileText size={14} className="mr-1" /> Worklist</TabsTrigger>
            <TabsTrigger value="dashboard"><RefreshCw size={14} className="mr-1" /> Dashboard</TabsTrigger>
          </TabsList>
          <TabsContent value="worklist" className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
              <Button size="sm" variant={filter === "today" ? "default" : "outline"} onClick={() => setFilter("today")}>Today</Button>
              <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>Pending</Button>
              <Button size="sm" variant={filter === "finalized" ? "default" : "outline"} onClick={() => setFilter("finalized")}>Finalized</Button>
              <Button size="sm" variant={filter === "nt" ? "default" : "outline"} onClick={() => setFilter("nt")}>NT</Button>
              <Button size="sm" variant={filter === "anomaly" ? "default" : "outline"} onClick={() => setFilter("anomaly")}>Anomaly</Button>
              <Button size="sm" variant={filter === "growth" ? "default" : "outline"} onClick={() => setFilter("growth")}>Growth</Button>
              <Button size="sm" variant={filter === "bpp" ? "default" : "outline"} onClick={() => setFilter("bpp")}>BPP</Button>
              <Button size="sm" variant={filter === "twin" ? "default" : "outline"} onClick={() => setFilter("twin")}>Twin</Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>GA</TableHead>
                      <TableHead>EDD</TableHead>
                      <TableHead>Twin</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorklist.map((s) => (
                      <TableRow key={s.id} className="cursor-pointer hover:bg-muted" onClick={() => setLocation(`/fetal-usg/${s.id}`)}>
                        <TableCell>{s.id}</TableCell>
                        <TableCell className="capitalize">{s.studyType}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell>{s.gaWeeks ? `${s.gaWeeks}w ${s.gaDays ?? 0}d` : "-"}</TableCell>
                        <TableCell>{s.edd ?? "-"}</TableCell>
                        <TableCell>{s.isTwin ? "Yes" : "No"}</TableCell>
                        <TableCell>{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell><Button size="sm" variant="ghost"><ChevronLeft size={14} className="rotate-180" /></Button></TableCell>
                      </TableRow>
                    ))}
                    {filteredWorklist.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No studies found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {studyId && study && (
        <>
          {criticalAlerts.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-700 font-semibold">
                <AlertTriangle size={16} /> Critical Alerts
              </div>
              <ul className="list-disc list-inside text-sm text-red-700">
                {criticalAlerts.map((a) => (<li key={a}>{a}</li>))}
              </ul>
              {!report.criticalAlertsAcknowledged && (
                <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={acknowledgeCritical}>Acknowledge</Button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={report.status === "final" ? "default" : report.status === "reviewed" ? "secondary" : "outline"}>{report.status ?? "draft"}</Badge>
            <Badge variant="outline" className="capitalize">{study.studyType}</Badge>
            <Badge variant="outline">{study.trimester}</Badge>
            <span className="text-sm text-muted-foreground">GA: {study.gaWeeks ? `${study.gaWeeks}w ${study.gaDays ?? 0}d` : "?"} | EDD: {study.edd ?? "?"}</span>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="measurements"><Baby size={14} className="mr-1" /> Measurements</TabsTrigger>
              <TabsTrigger value="checklist"><CheckCircle size={14} className="mr-1" /> Checklist</TabsTrigger>
              <TabsTrigger value="report"><Stethoscope size={14} className="mr-1" /> Report</TabsTrigger>
              <TabsTrigger value="growth"><BarChart3 size={14} className="mr-1" /> Growth</TabsTrigger>
              <TabsTrigger value="audit"><FileText size={14} className="mr-1" /> Audit</TabsTrigger>
            </TabsList>

            <TabsContent value="measurements" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Gestational Age</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">LMP</Label><Input type="date" value={study.lmp ?? ""} readOnly className="bg-muted" /></div>
                  <div><Label className="text-xs">GA Weeks</Label><Input type="number" value={study.gaWeeks ?? ""} readOnly className="bg-muted" /></div>
                  <div><Label className="text-xs">GA Days</Label><Input type="number" value={study.gaDays ?? ""} readOnly className="bg-muted" /></div>
                  <div><Label className="text-xs">EDD</Label><Input value={study.edd ?? ""} readOnly className="bg-muted" /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Early Pregnancy</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">CRL (mm)</Label><Input type="number" value={meas.crl ?? ""} onChange={(e) => updateMeas("crl", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">MSD (mm)</Label><Input type="number" value={meas.msd ?? ""} onChange={(e) => updateMeas("msd", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Yolk Sac (mm)</Label><Input type="number" value={meas.yolkSac ?? ""} onChange={(e) => updateMeas("yolkSac", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">FHR (bpm)</Label><Input type="number" value={meas.fetalHeartRate ?? ""} onChange={(e) => updateMeas("fetalHeartRate", Number(e.target.value))} /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">NT Scan</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">NT (mm)</Label><Input type="number" value={meas.nt ?? ""} onChange={(e) => updateMeas("nt", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Nasal Bone</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.nasalBone ?? ""} onChange={(e) => updateMeas("nasalBone", e.target.value)}>
                      <option value="">Select</option>
                      {NASAL_BONE_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Ductus Venosus</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.ductusVenousus ?? ""} onChange={(e) => updateMeas("ductusVenousus", e.target.value)}>
                      <option value="">Select</option>
                      {DV_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Tricuspid Flow</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.tricuspidFlow ?? ""} onChange={(e) => updateMeas("tricuspidFlow", e.target.value)}>
                      <option value="">Select</option>
                      {TRICUSPID_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Biometry</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">BPD (mm)</Label><Input type="number" value={meas.bpd ?? ""} onChange={(e) => updateMeas("bpd", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">HC (mm)</Label><Input type="number" value={meas.hc ?? ""} onChange={(e) => updateMeas("hc", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">AC (mm)</Label><Input type="number" value={meas.ac ?? ""} onChange={(e) => updateMeas("ac", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">FL (mm)</Label><Input type="number" value={meas.fl ?? ""} onChange={(e) => updateMeas("fl", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">HL (mm)</Label><Input type="number" value={meas.hl ?? ""} onChange={(e) => updateMeas("hl", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">EFW (g)</Label><Input type="number" value={meas.efw ?? ""} onChange={(e) => updateMeas("efw", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">EFW Percentile</Label><Input type="number" value={meas.efwPercentile ?? ""} onChange={(e) => updateMeas("efwPercentile", Number(e.target.value))} /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Liquor & Placenta</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">AFI (cm)</Label><Input type="number" value={meas.afi ?? ""} onChange={(e) => updateMeas("afi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">AFI Interpretation</Label><Input value={meas.afiInterpretation ?? ""} readOnly className="bg-muted" /></div>
                  <div><Label className="text-xs">SDP (cm)</Label><Input type="number" value={meas.sdp ?? ""} onChange={(e) => updateMeas("sdp", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Placenta</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.placentaLocation ?? ""} onChange={(e) => updateMeas("placentaLocation", e.target.value)}>
                      <option value="">Select</option>
                      {PLACENTA_LOCATIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Grade</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.placentaGrade ?? ""} onChange={(e) => updateMeas("placentaGrade", e.target.value)}>
                      <option value="">Select</option>
                      {PLACENTA_GRADES.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Presentation</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.presentation ?? ""} onChange={(e) => updateMeas("presentation", e.target.value)}>
                      <option value="">Select</option>
                      {PRESENTATIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Cervical Length (mm)</Label><Input type="number" value={meas.cervicalLength ?? ""} onChange={(e) => updateMeas("cervicalLength", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">CL Interpretation</Label><Input value={meas.cervicalLengthInterpretation ?? ""} readOnly className="bg-muted" /></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Doppler</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">UA PI</Label><Input type="number" value={meas.umbilicalArteryPi ?? ""} onChange={(e) => updateMeas("umbilicalArteryPi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">UA RI</Label><Input type="number" value={meas.umbilicalArteryRi ?? ""} onChange={(e) => updateMeas("umbilicalArteryRi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">UA S/D</Label><Input type="number" value={meas.umbilicalArterySd ?? ""} onChange={(e) => updateMeas("umbilicalArterySd", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">MCA PI</Label><Input type="number" value={meas.mcaPi ?? ""} onChange={(e) => updateMeas("mcaPi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">MCA RI</Label><Input type="number" value={meas.mcaRi ?? ""} onChange={(e) => updateMeas("mcaRi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">CPR</Label><Input type="number" value={meas.cpr ?? ""} onChange={(e) => updateMeas("cpr", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">DV PI</Label><Input type="number" value={meas.ductusVenoususPi ?? ""} onChange={(e) => updateMeas("ductusVenoususPi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">DV A-Wave</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.ductusVenoususAWave ?? ""} onChange={(e) => updateMeas("ductusVenoususAWave", e.target.value)}>
                      <option value="">Select</option>
                      <option value="positive">Positive</option>
                      <option value="absent">Absent</option>
                      <option value="reversed">Reversed</option>
                    </select>
                  </div>
                  <div><Label className="text-xs">Uterine Artery PI</Label><Input type="number" value={meas.uterineArteryPi ?? ""} onChange={(e) => updateMeas("uterineArteryPi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Uterine Artery RI</Label><Input type="number" value={meas.uterineArteryRi ?? ""} onChange={(e) => updateMeas("uterineArteryRi", Number(e.target.value))} /></div>
                </CardContent>
              </Card>

              {study.isTwin && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Twin Pregnancy</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                      <div><Label className="text-xs">Twin A FHR</Label><Input type="number" value={meas.twinA_fhr ?? ""} onChange={(e) => updateMeas("twinA_fhr", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin A BPD</Label><Input type="number" value={meas.twinA_bpd ?? ""} onChange={(e) => updateMeas("twinA_bpd", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin A AC</Label><Input type="number" value={meas.twinA_ac ?? ""} onChange={(e) => updateMeas("twinA_ac", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin A FL</Label><Input type="number" value={meas.twinA_fl ?? ""} onChange={(e) => updateMeas("twinA_fl", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin A EFW</Label><Input type="number" value={meas.twinA_efw ?? ""} onChange={(e) => updateMeas("twinA_efw", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin A Pres</Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.twinA_presentation ?? ""} onChange={(e) => updateMeas("twinA_presentation", e.target.value)}>
                          <option value="">Select</option>
                          {PRESENTATIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      <div><Label className="text-xs">Twin B FHR</Label><Input type="number" value={meas.twinB_fhr ?? ""} onChange={(e) => updateMeas("twinB_fhr", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin B BPD</Label><Input type="number" value={meas.twinB_bpd ?? ""} onChange={(e) => updateMeas("twinB_bpd", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin B AC</Label><Input type="number" value={meas.twinB_ac ?? ""} onChange={(e) => updateMeas("twinB_ac", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin B FL</Label><Input type="number" value={meas.twinB_fl ?? ""} onChange={(e) => updateMeas("twinB_fl", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin B EFW</Label><Input type="number" value={meas.twinB_efw ?? ""} onChange={(e) => updateMeas("twinB_efw", Number(e.target.value))} /></div>
                      <div><Label className="text-xs">Twin B Pres</Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.twinB_presentation ?? ""} onChange={(e) => updateMeas("twinB_presentation", e.target.value)}>
                          <option value="">Select</option>
                          {PRESENTATIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                        </select>
                      </div>
                    </div>
                    <div><Label className="text-xs">Discordance (%)</Label><Input type="number" value={meas.discordancePercent ?? ""} onChange={(e) => updateMeas("discordancePercent", Number(e.target.value))} /></div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-sm">BPP</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-4 gap-3">
                  <div><Label className="text-xs">Fetal Breathing</Label><Input type="number" value={meas.bppFetalBreathing ?? ""} onChange={(e) => updateMeas("bppFetalBreathing", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Fetal Movement</Label><Input type="number" value={meas.bppFetalMovement ?? ""} onChange={(e) => updateMeas("bppFetalMovement", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Fetal Tone</Label><Input type="number" value={meas.bppFetalTone ?? ""} onChange={(e) => updateMeas("bppFetalTone", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">AFI</Label><Input type="number" value={meas.bppAfi ?? ""} onChange={(e) => updateMeas("bppAfi", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">Total ( /10)</Label><Input type="number" value={meas.bppTotal ?? ""} onChange={(e) => updateMeas("bppTotal", Number(e.target.value))} /></div>
                  <div><Label className="text-xs">NST Done</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.nstDone ? "true" : "false"} onChange={(e) => updateMeas("nstDone", e.target.value === "true")}>
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div><Label className="text-xs">NST Result</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.nstResult ?? ""} onChange={(e) => updateMeas("nstResult", e.target.value)}>
                      <option value="">Select</option>
                      {NST_RESULTS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                    </select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={saveMeasurements} disabled={saving}>
                  <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save Measurements"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="checklist" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Anomaly Scan Checklist</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-3 gap-3">
                  {[
                    ["Skull / Brain", "skullBrain"], ["Face", "face"], ["Spine", "spine"],
                    ["Thorax", "thorax"], ["Heart 4-Chamber", "heartFourChamber"], ["Outflow Tracts", "outflowTracts"],
                    ["Abdomen", "abdomen"], ["Stomach Bubble", "stomachBubble"], ["Kidneys", "kidneys"],
                    ["Urinary Bladder", "urinaryBladder"], ["Cord Insertion", "cordInsertion"], ["Limbs", "limbs"],
                    ["Placenta", "placenta"], ["Liquor", "liquor"], ["Cervix", "cervix"],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={(checklist as any)[key] ?? ""} onChange={(e) => updateChecklist(key as any, e.target.value)}>
                        <option value="">Select</option>
                        {CHECKLIST_OPTIONS.map((o) => (
                          <option key={o} value={o} className={o === "abnormal" ? "text-red-600" : o === "normal" ? "text-green-600" : ""}>
                            {o.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <div><Label className="text-xs">Additional Notes</Label><Textarea value={checklist.notes ?? ""} onChange={(e) => updateChecklist("notes", e.target.value)} rows={3} /></div>
              <div className="flex justify-end">
                <Button onClick={saveChecklist} disabled={saving}>
                  <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save Checklist"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="report" className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={generateDraft} disabled={loading}>
                  <Zap size={14} className="mr-1" /> {loading ? "Generating..." : "Generate AI Draft"}
                </Button>
                <Button size="sm" variant="outline" onClick={reviewReport} disabled={report.status === "reviewed" || report.status === "final"}>
                  <CheckCircle2 size={14} className="mr-1" /> Mark Reviewed
                </Button>
                <Button size="sm" onClick={finalizeReport} disabled={report.status === "final"}>
                  <Send size={14} className="mr-1" /> Finalize
                </Button>
                <Button size="sm" variant="outline" onClick={downloadPdf} disabled={!report.status}>
                  <Download size={14} className="mr-1" /> PDF
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPrintSettingsOpen(true)}>
                  <Settings2 size={14} className="mr-1" /> Settings
                </Button>
                <Button size="sm" variant="outline" onClick={openPacsViewer}>
                  <ExternalLink size={14} className="mr-1" /> PACS
                </Button>
                <Button size="sm" variant="outline" onClick={extractDicomMeasurements} disabled={loading}>
                  <BarChart3 size={14} className="mr-1" /> DICOM Extract
                </Button>
                <Button size="sm" variant="outline" onClick={fetchFollowUpSuggestions} disabled={report.status !== "final"}>
                  <Calendar size={14} className="mr-1" /> Follow-up
                </Button>
              </div>
              {showFollowUp && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">Follow-up Suggestions</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {followUpSuggestions.length === 0 && <p className="text-sm text-muted-foreground">No follow-up suggestions.</p>}
                    {followUpSuggestions.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-sm border rounded-md p-2">
                        <span className="capitalize">{s.type.replace(/_/g, " ")}</span>
                        <span className="text-muted-foreground">{s.reason} {s.suggestedGa ? `(at ${s.suggestedGa})` : ""}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {report.aiDraft && (
                <Card>
                  <CardHeader><CardTitle className="text-sm">AI Draft</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea className="text-sm bg-muted" value={report.aiDraft} readOnly rows={12} />
                    <Button size="sm" variant="ghost" className="mt-2" onClick={() => setReport((prev) => ({ ...prev, impression: report.aiDraft }))}>
                      <RefreshCw size={12} className="mr-1" /> Copy to Impression
                    </Button>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle className="text-sm">Report Editor</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Findings</Label><Button size="sm" variant="ghost" onClick={() => toggleVoice("findings")} className={voiceActive && voiceTarget === "findings" ? "text-red-500" : ""}><Mic size={12} /> {voiceActive && voiceTarget === "findings" ? "Stop" : "Dictate"}</Button></div>
                    <Textarea className="text-sm" value={report.findings ?? ""} onChange={(e) => setReport((prev) => ({ ...prev, findings: e.target.value }))} rows={4} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Impression</Label><Button size="sm" variant="ghost" onClick={() => toggleVoice("impression")} className={voiceActive && voiceTarget === "impression" ? "text-red-500" : ""}><Mic size={12} /> {voiceActive && voiceTarget === "impression" ? "Stop" : "Dictate"}</Button></div>
                    <Textarea className="text-sm font-medium" value={report.impression ?? ""} onChange={(e) => setReport((prev) => ({ ...prev, impression: e.target.value }))} rows={4} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between"><Label className="text-xs font-semibold">Recommendation</Label><Button size="sm" variant="ghost" onClick={() => toggleVoice("recommendation")} className={voiceActive && voiceTarget === "recommendation" ? "text-red-500" : ""}><Mic size={12} /> {voiceActive && voiceTarget === "recommendation" ? "Stop" : "Dictate"}</Button></div>
                    <Textarea className="text-sm" value={report.recommendation ?? ""} onChange={(e) => setReport((prev) => ({ ...prev, recommendation: e.target.value }))} rows={2} />
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end">
                <Button onClick={saveDraft} disabled={saving}>
                  <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save Draft"}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="growth" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Fetal Growth Charts</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-2">WHO/ICB fetal growth reference charts (simplified preview). Full charts coming soon.</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="border rounded-md p-2"><div className="font-semibold mb-1">EFW Percentile</div><div className="text-muted-foreground">{meas.efwPercentile ?? "?"} (ref: 10-90th)</div></div>
                    <div className="border rounded-md p-2"><div className="font-semibold mb-1">AC vs GA</div><div className="text-muted-foreground">{meas.ac ?? "?"} mm (ref: ~26mm at 12w, ~200mm at 32w)</div></div>
                    <div className="border rounded-md p-2"><div className="font-semibold mb-1">BPD vs GA</div><div className="text-muted-foreground">{meas.bpd ?? "?"} mm (ref: ~20mm at 12w, ~80mm at 32w)</div></div>
                    <div className="border rounded-md p-2"><div className="font-semibold mb-1">FL vs GA</div><div className="text-muted-foreground">{meas.fl ?? "?"} mm (ref: ~7mm at 12w, ~62mm at 32w)</div></div>
                    <div className="border rounded-md p-2"><div className="font-semibold mb-1">HC vs GA</div><div className="text-muted-foreground">{meas.hc ?? "?"} mm (ref: ~75mm at 12w, ~290mm at 32w)</div></div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit" className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">Audit Log</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">Audit logs are available in the backend. Full log viewer coming soon.</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
      {/* Print Settings Dialog */}
      <ReportPrintSettingsDialog
        open={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
        settings={printSettings}
        onChange={(s) => { setPrintSettings(s); savePrintSettings(s); }}
      />
    </div>
  );
}
