import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import {
  Heart, Activity, Ruler, Zap, Save, Send, AlertTriangle,
  CheckCircle2, RefreshCw, ChevronLeft, Stethoscope,
  Download, Mic, MicOff,
  Settings2,
} from "lucide-react";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";

interface EchoMeasurements {
  id?: number;
  heightCm?: number;
  weightKg?: number;
  bsa?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  heartRate?: number;
  ivsd?: number;
  ivss?: number;
  lvidd?: number;
  lvids?: number;
  lvpwd?: number;
  lvpws?: number;
  laDiameter?: number;
  laVolume?: number;
  laVolumeIndex?: number;
  raSize?: number;
  aorticRoot?: number;
  ascendingAorta?: number;
  rvBasal?: number;
  rvMid?: number;
  rvLength?: number;
  tapase?: number;
  rvsp?: number;
  efSimpson?: number;
  efTeichholz?: number;
  fractionalShortening?: number;
  lvMass?: number;
  lvMassIndex?: number;
  mvE?: number;
  mvA?: number;
  mvEaRatio?: number;
  mvDecelTime?: number;
  mvEePrime?: number;
  septalEPrime?: number;
  lateralEPrime?: number;
  avVelocity?: number;
  avGradient?: number;
  avArea?: number;
  trVelocity?: number;
  trGradient?: number;
  pulmonaryVelocity?: number;
  pulmonaryGradient?: number;
  lvh?: boolean;
  relativeWallThickness?: number;
  lvGeometry?: string;
  diastolicDysfunctionGrade?: string;
  pulmonaryHypertension?: boolean;
}

interface ValveAssessment {
  id?: number;
  valveName: string;
  morphology?: string;
  stenosis?: string;
  stenosisNotes?: string;
  regurgitation?: string;
  regurgitationNotes?: string;
  additionalFindings?: string;
}

interface WallMotion {
  id?: number;
  segment: string;
  motion: string;
  notes?: string;
}

interface EchoReport {
  id?: number;
  leftVentricle?: string;
  rightVentricle?: string;
  leftAtrium?: string;
  rightAtrium?: string;
  interatrialSeptum?: string;
  interventricularSeptum?: string;
  aorticValve?: string;
  mitralValve?: string;
  tricuspidValve?: string;
  pulmonaryValve?: string;
  pericardium?: string;
  dopplerFindings?: string;
  impression?: string;
  recommendation?: string;
  status?: string;
  aiDraft?: string;
  criticalAlertsAcknowledged?: boolean;
}

const VALVE_OPTIONS = ["mitral", "aortic", "tricuspid", "pulmonary"];
const WALL_SEGMENTS = [
  "anterior", "anteroseptal", "inferoseptal", "inferior", "inferolateral", "anterolateral", "apex",
];
const MOTION_OPTIONS = ["normal", "hypokinesia", "akinesia", "dyskinesia", "hyperkinesia"];
const SEVERITY_OPTIONS = ["none", "mild", "mild-moderate", "moderate", "moderate-severe", "severe"];
const MORPHOLOGY_OPTIONS = ["normal", "thickened", "calcified", "prolapse", "myxomatous", "rheumatic"];
const LV_GEOMETRY_OPTIONS = ["normal", "concentric_remodeling", "concentric_lvh", "eccentric_lvh"];
const DIASTOLIC_OPTIONS = ["none", "grade_i", "grade_ii", "grade_iii"];

function calcBSA(h: number, w: number): number {
  return Math.round(Math.sqrt((h * w) / 3600) * 100) / 100;
}

function calcRWT(ivsd: number, lvpwd: number, lvidd: number): number {
  return Math.round(((ivsd + lvpwd) / lvidd) * 100) / 100;
}

function calcFS(lvidd: number, lvids: number): number {
  return Math.round(((lvidd - lvids) / lvidd) * 100 * 100) / 100;
}

export default function EchoCardiology() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [studyId, setStudyId] = useState<number | null>(null);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [meas, setMeas] = useState<EchoMeasurements>({});
  const [valves, setValves] = useState<ValveAssessment[]>([]);
  const [walls, setWalls] = useState<WallMotion[]>([]);
  const [report, setReport] = useState<EchoReport>({});
  const [criticalAlerts, setCriticalAlerts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("measurements");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTarget, setVoiceTarget] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  // Print / PDF
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const { data: clinicSettings } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  const params = new URLSearchParams(window.location.search);
  const sid = Number(params.get("studyId"));
  const pid = Number(params.get("patientId"));

  useEffect(() => {
    if (sid) { setStudyId(sid); setPatientId(pid || null); loadData(sid); }
  }, [sid]);

  async function loadData(sid: number) {
    setLoading(true);
    try {
      const m = await api.get<{ measurements: EchoMeasurements | null; valves: ValveAssessment[]; walls: WallMotion[] }>(`/api/echo-cardiology/measurements/${sid}`);
      if (m.measurements) setMeas(m.measurements);
      setValves(m.valves);
      setWalls(m.walls);
      const r = await api.get<{ report: EchoReport | null }>(`/api/echo-cardiology/reports/${sid}`);
      if (r.report) setReport(r.report);
      const c = await api.get<{ alerts: string[]; hasCritical: boolean }>(`/api/echo-cardiology/reports/${sid}/critical-alerts`);
      setCriticalAlerts(c.alerts);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function saveMeasurements() {
    if (!studyId) return;
    setSaving(true);
    try {
      await api.post(`/api/echo-cardiology/measurements/${studyId}`, { ...meas, patientId });
      toast({ title: "Measurements saved" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setSaving(false); }
  }

  async function saveValve(v: ValveAssessment) {
    if (!studyId) return;
    try {
      await api.post(`/api/echo-cardiology/valves/${studyId}`, v);
      const updated = await api.get<{ valves: ValveAssessment[] }>(`/api/echo-cardiology/measurements/${studyId}`);
      setValves(updated.valves);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  async function saveWall(w: WallMotion) {
    if (!studyId) return;
    try {
      await api.post(`/api/echo-cardiology/walls/${studyId}`, w);
      const updated = await api.get<{ walls: WallMotion[] }>(`/api/echo-cardiology/measurements/${studyId}`);
      setWalls(updated.walls);
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  async function saveReport() {
    if (!studyId) return;
    setSaving(true);
    try {
      await api.post(`/api/echo-cardiology/reports/${studyId}`, { ...report, patientId });
      toast({ title: "Report saved" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setSaving(false); }
  }

  async function generateDraft() {
    if (!studyId) return;
    setLoading(true);
    try {
      const res = await api.post<{ aiDraft: string }>(`/api/echo-cardiology/reports/${studyId}/generate-draft`, {});
      setReport((prev) => ({ ...prev, aiDraft: res.aiDraft }));
      toast({ title: "AI Draft generated", description: "Review before finalizing" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
    finally { setLoading(false); }
  }

  async function reviewReport() {
    if (!studyId) return;
    try {
      await api.post(`/api/echo-cardiology/reports/${studyId}/review`, {});
      setReport((prev) => ({ ...prev, status: "reviewed" }));
      toast({ title: "Report marked as reviewed" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  async function finalizeReport() {
    if (!studyId) return;
    if (criticalAlerts.length > 0 && !report.criticalAlertsAcknowledged) {
      toast({ variant: "destructive", title: "Critical alerts not acknowledged", description: "Please acknowledge before finalizing" });
      return;
    }
    try {
      await api.post(`/api/echo-cardiology/reports/${studyId}/finalize`, {});
      setReport((prev) => ({ ...prev, status: "final" }));
      toast({ title: "Report finalized" });
    } catch (e: any) {
      if (e?.error?.includes("Critical alerts")) {
        toast({ variant: "destructive", title: "Critical alerts", description: e.error });
      } else {
        toast({ variant: "destructive", title: "Failed", description: String(e) });
      }
    }
  }

  async function acknowledgeCritical() {
    if (!studyId) return;
    try {
      await api.post(`/api/echo-cardiology/reports/${studyId}/acknowledge-critical`, {});
      setReport((prev) => ({ ...prev, criticalAlertsAcknowledged: true }));
      toast({ title: "Critical alerts acknowledged" });
    } catch (e) { toast({ variant: "destructive", title: "Failed", description: String(e) }); }
  }

  // --- PDF Generation ---
  function downloadPdf() {
    if (!studyId) return;
    const measurements = [
      { label: "IVSd", value: meas.ivsd?.toString() ?? "" },
      { label: "IVSs", value: meas.ivss?.toString() ?? "" },
      { label: "LVIDd", value: meas.lvidd?.toString() ?? "" },
      { label: "LVIDs", value: meas.lvids?.toString() ?? "" },
      { label: "LVPWd", value: meas.lvpwd?.toString() ?? "" },
      { label: "EF", value: meas.efSimpson?.toString() ?? "" },
      { label: "FS", value: meas.fractionalShortening?.toString() ?? "" },
      { label: "LV Mass", value: meas.lvMass?.toString() ?? "" },
    ].filter((m) => m.value);
    generateReportPDF({
      patientName: "Patient",
      studyDate: new Date().toLocaleDateString(),
      modality: "2D Echo",
      bodyPart: "Heart",
      findings: report.dopplerFindings,
      impression: report.impression,
      recommendation: report.recommendation,
      measurements,
      reportTitle: "2D Echo Cardiology Report",
    }, printSettings, clinicSettings ?? null);
    toast({ title: "PDF downloaded" });
  }

  // --- Voice Dictation ---
  function toggleVoice(target: string) {
    if (voiceActive && voiceTarget === target) {
      recognitionRef.current?.stop();
      setVoiceActive(false);
      setVoiceTarget(null);
      return;
    }
    if (voiceActive) recognitionRef.current?.stop();
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
      setReport((prev) => ({ ...prev, [target]: (prev[target as keyof EchoReport] ?? "" as any) + text }));
    };
    rec.onerror = (e: any) => { if (e.error !== "aborted") toast({ variant: "destructive", title: "Voice error", description: e.error }); setVoiceActive(false); };
    rec.onend = () => setVoiceActive(false);
    rec.start();
    recognitionRef.current = rec;
    setVoiceActive(true);
    setVoiceTarget(target);
  }

  function updateMeas<K extends keyof EchoMeasurements>(key: K, value: EchoMeasurements[K]) {
    setMeas((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-calculate derived fields
      if (next.heightCm && next.weightKg) {
        next.bsa = calcBSA(next.heightCm, next.weightKg);
      }
      if (next.ivsd && next.lvpwd && next.lvidd) {
        next.relativeWallThickness = calcRWT(next.ivsd, next.lvpwd, next.lvidd);
      }
      if (next.lvidd && next.lvids) {
        next.fractionalShortening = calcFS(next.lvidd, next.lvids);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Echo Cardiology"
        subtitle="2D Echocardiography reporting with measurements, AI draft, and critical alerts"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocation("/radiology/worklist")}>
              <ChevronLeft size={14} className="mr-1" /> Worklist
            </Button>
          </div>
        }
      />

      {criticalAlerts.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-700 font-semibold">
            <AlertTriangle size={16} />
            Critical Alerts
          </div>
          <ul className="list-disc list-inside text-sm text-red-700">
            {criticalAlerts.map((a) => (<li key={a}>{a}</li>))}
          </ul>
          {!report.criticalAlertsAcknowledged && (
            <Button size="sm" variant="outline" className="border-red-300 text-red-700" onClick={acknowledgeCritical}>
              Acknowledge
            </Button>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="measurements"><Ruler size={14} className="mr-1" /> Measurements</TabsTrigger>
          <TabsTrigger value="valves"><Heart size={14} className="mr-1" /> Valves</TabsTrigger>
          <TabsTrigger value="walls"><Activity size={14} className="mr-1" /> Walls</TabsTrigger>
          <TabsTrigger value="report"><Stethoscope size={14} className="mr-1" /> Report</TabsTrigger>
        </TabsList>

        <TabsContent value="measurements" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Patient Vitals</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-3">
              <div><Label className="text-xs">Height (cm)</Label><Input type="number" value={meas.heightCm ?? ""} onChange={(e) => updateMeas("heightCm", Number(e.target.value))} /></div>
              <div><Label className="text-xs">Weight (kg)</Label><Input type="number" value={meas.weightKg ?? ""} onChange={(e) => updateMeas("weightKg", Number(e.target.value))} /></div>
              <div><Label className="text-xs">BSA</Label><Input type="number" value={meas.bsa ?? ""} readOnly className="bg-muted" /></div>
              <div><Label className="text-xs">Heart Rate</Label><Input type="number" value={meas.heartRate ?? ""} onChange={(e) => updateMeas("heartRate", Number(e.target.value))} /></div>
              <div><Label className="text-xs">BP Systolic</Label><Input type="number" value={meas.bpSystolic ?? ""} onChange={(e) => updateMeas("bpSystolic", Number(e.target.value))} /></div>
              <div><Label className="text-xs">BP Diastolic</Label><Input type="number" value={meas.bpDiastolic ?? ""} onChange={(e) => updateMeas("bpDiastolic", Number(e.target.value))} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">2D Measurements (mm)</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-3">
              {[
                ["IVSd", "ivsd"], ["IVSs", "ivss"], ["LVIDd", "lvidd"], ["LVIDs", "lvids"],
                ["LVPWd", "lvpwd"], ["LVPWs", "lvpws"], ["LA Diam", "laDiameter"], ["LA Vol", "laVolume"],
                ["LA Vol Index", "laVolumeIndex"], ["RA Size", "raSize"], ["Aortic Root", "aorticRoot"], ["Asc Aorta", "ascendingAorta"],
                ["RV Basal", "rvBasal"], ["RV Mid", "rvMid"], ["RV Length", "rvLength"], ["TAPSE", "tapase"],
                ["RVSP", "rvsp"],
              ].map(([label, key]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input type="number" value={(meas as any)[key] ?? ""} onChange={(e) => updateMeas(key as any, Number(e.target.value))} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">EF & Function</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-3">
              <div><Label className="text-xs">EF Simpson (%)</Label><Input type="number" value={meas.efSimpson ?? ""} onChange={(e) => updateMeas("efSimpson", Number(e.target.value))} /></div>
              <div><Label className="text-xs">EF Teichholz (%)</Label><Input type="number" value={meas.efTeichholz ?? ""} onChange={(e) => updateMeas("efTeichholz", Number(e.target.value))} /></div>
              <div><Label className="text-xs">Fractional Shortening (%)</Label><Input type="number" value={meas.fractionalShortening ?? ""} readOnly className="bg-muted" /></div>
              <div><Label className="text-xs">LV Mass</Label><Input type="number" value={meas.lvMass ?? ""} onChange={(e) => updateMeas("lvMass", Number(e.target.value))} /></div>
              <div><Label className="text-xs">LV Mass Index</Label><Input type="number" value={meas.lvMassIndex ?? ""} onChange={(e) => updateMeas("lvMassIndex", Number(e.target.value))} /></div>
              <div><Label className="text-xs">LVH</Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.lvh ? "true" : "false"} onChange={(e) => updateMeas("lvh", e.target.value === "true")}>
                  <option value="false">No</option><option value="true">Yes</option>
                </select>
              </div>
              <div><Label className="text-xs">LV Geometry</Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.lvGeometry ?? ""} onChange={(e) => updateMeas("lvGeometry", e.target.value)}>
                  <option value="">Select</option>
                  {LV_GEOMETRY_OPTIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                </select>
              </div>
              <div><Label className="text-xs">RWT</Label><Input type="number" value={meas.relativeWallThickness ?? ""} readOnly className="bg-muted" /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Doppler</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-4 gap-3">
              {[
                ["MV E", "mvE"], ["MV A", "mvA"], ["E/A Ratio", "mvEaRatio"], ["Decel Time", "mvDecelTime"],
                ["E/e'", "mvEePrime"], ["Septal e'", "septalEPrime"], ["Lateral e'", "lateralEPrime"], ["AV Velocity", "avVelocity"],
                ["AV Gradient", "avGradient"], ["AV Area", "avArea"], ["TR Velocity", "trVelocity"], ["TR Gradient", "trGradient"],
                ["Pulm Velocity", "pulmonaryVelocity"], ["Pulm Gradient", "pulmonaryGradient"],
              ].map(([label, key]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input type="number" value={(meas as any)[key] ?? ""} onChange={(e) => updateMeas(key as any, Number(e.target.value))} />
                </div>
              ))}
              <div><Label className="text-xs">Diastolic Dysfunction</Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.diastolicDysfunctionGrade ?? ""} onChange={(e) => updateMeas("diastolicDysfunctionGrade", e.target.value)}>
                  <option value="">Select</option>
                  {DIASTOLIC_OPTIONS.map((o) => (<option key={o} value={o}>{o.replace(/_/g, " ")}</option>))}
                </select>
              </div>
              <div><Label className="text-xs">Pulmonary HTN</Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={meas.pulmonaryHypertension ? "true" : "false"} onChange={(e) => updateMeas("pulmonaryHypertension", e.target.value === "true")}>
                  <option value="false">No</option><option value="true">Yes</option>
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

        <TabsContent value="valves" className="space-y-4">
          {VALVE_OPTIONS.map((valveName) => {
            const v = valves.find((x) => x.valveName === valveName) ?? { valveName };
            return (
              <Card key={valveName}>
                <CardHeader><CardTitle className="text-sm capitalize">{valveName} Valve</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-3 gap-3">
                  <div><Label className="text-xs">Morphology</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={v.morphology ?? ""} onChange={(e) => saveValve({ ...v, morphology: e.target.value })}>
                      <option value="">Select</option>
                      {MORPHOLOGY_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Stenosis</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={v.stenosis ?? ""} onChange={(e) => saveValve({ ...v, stenosis: e.target.value })}>
                      <option value="">Select</option>
                      {SEVERITY_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div><Label className="text-xs">Regurgitation</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={v.regurgitation ?? ""} onChange={(e) => saveValve({ ...v, regurgitation: e.target.value })}>
                      <option value="">Select</option>
                      {SEVERITY_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </div>
                  <div className="col-span-3"><Label className="text-xs">Additional Findings</Label><Textarea value={v.additionalFindings ?? ""} onChange={(e) => saveValve({ ...v, additionalFindings: e.target.value })} rows={2} /></div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="walls" className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {WALL_SEGMENTS.map((segment) => {
              const w = walls.find((x) => x.segment === segment) ?? { segment, motion: "normal" };
              return (
                <div key={segment} className="flex items-center gap-3 rounded-md border p-3">
                  <span className="w-32 font-medium text-sm capitalize">{segment}</span>
                  <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={w.motion} onChange={(e) => saveWall({ ...w, motion: e.target.value })}>
                    {MOTION_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
                  </select>
                  <Input className="flex-1 text-sm" placeholder="Notes" value={w.notes ?? ""} onChange={(e) => saveWall({ ...w, notes: e.target.value })} />
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="report" className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={report.status === "final" ? "default" : report.status === "reviewed" ? "secondary" : "outline"}>{report.status ?? "draft"}</Badge>
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
          </div>

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
              {[
                ["Left Ventricle", "leftVentricle"], ["Right Ventricle", "rightVentricle"], ["Left Atrium", "leftAtrium"],
                ["Right Atrium", "rightAtrium"], ["Interatrial Septum", "interatrialSeptum"], ["Interventricular Septum", "interventricularSeptum"],
                ["Aortic Valve", "aorticValve"], ["Mitral Valve", "mitralValve"], ["Tricuspid Valve", "tricuspidValve"],
                ["Pulmonary Valve", "pulmonaryValve"], ["Pericardium", "pericardium"], ["Doppler Findings", "dopplerFindings"],
              ].map(([label, key]) => (
                <div key={key}>
                  <Label className="text-xs font-semibold">{label}</Label>
                  <Textarea className="text-sm" value={(report as any)[key] ?? ""} onChange={(e) => setReport((prev) => ({ ...prev, [key]: e.target.value }))} rows={2} />
                </div>
              ))}
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
            <Button onClick={saveReport} disabled={saving}>
              <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save Report"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
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
