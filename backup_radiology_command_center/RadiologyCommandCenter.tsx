/**
 * Radiology Command Center
 * Unified radiologist workspace for reading studies, viewing images, and reporting.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession, FULL_ACCESS_ROLES } from "@/lib/staffSession";
import { useToast } from "@/hooks/use-toast";
import { launchViewer, getOhifUrl, getWeasisUrl } from "@/lib/viewerService";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Activity, Clock, AlertTriangle, Cpu, Wifi, Database, Users,
  BarChart3, AlertOctagon, Send, Zap, HardDrive, Gauge, Bell,
  RefreshCw, ShieldCheck, ArrowUpRight, MonitorPlay, Tv2,
  FileEdit, Save, CheckCircle2, ChevronRight, Search, ListCollapse,
  Layers, Settings, FileText, ClipboardList, BookOpen, AlertCircle, Sparkles
} from "lucide-react";
import EmbeddedWadoViewer from "@/components/EmbeddedWadoViewer";
import VoiceDictationButton from "@/components/VoiceDictationButton";

// ─── Types ──────────────────────────────────────────────────────────────────
type WorklistEntry = {
  id: number;
  studyId: number | null;
  patientId: number | null;
  dicomPatientId: string | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  aeTitle: string | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  aiDraftJson?: string | null;
  reportId: number | null;
  deliveryStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

type StructuredTemplate = {
  id: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  sectionsJson: string;
  defaultFindings: string | null;
  defaultImpression: string | null;
  macrosJson: string;
  isActive: boolean;
};

type TemplateSections = {
  technique: string;
  findingsItems: Array<{ label: string; normal: string }>;
};

type TemplateMacro = { key: string; label: string; text: string };

type NormalSnippet = {
  id: number;
  shortcut: string;
  label: string;
  modality: string | null;
  bodyPart: string | null;
  text: string;
  impression: string | null;
  recommendation: string | null;
};

// ─── Modality Context Definitions ────────────────────────────────────────────
const CONTEXT_MAPPING: Record<string, { templates: string[]; findings: string[]; impressions: string[] }> = {
  "MRI BRAIN": {
    templates: ["MRI Brain Protocol", "MRI Brain Normal Template", "MRI Stroke Protocol"],
    findings: [
      "Ventricular system and sulci are normal for age.",
      "No acute territorial infarct or intracranial hemorrhage.",
      "Gray-white matter differentiation is preserved.",
      "No mass effect or midline shift."
    ],
    impressions: [
      "Normal MRI of the brain.",
      "No acute intracranial pathology.",
      "Age-related cerebral atrophy."
    ]
  },
  "CT BRAIN": {
    templates: ["CT Head Normal", "CT Trauma Protocol", "CT Stroke Study"],
    findings: [
      "No intracranial hemorrhage or mass effect.",
      "No midline shift. Ventricles are normal size.",
      "Bone windows show no fractures."
    ],
    impressions: [
      "No acute intracranial hemorrhage or territorial infarction.",
      "Normal non-contrast CT of the brain."
    ]
  },
  "MRI SPINE": {
    templates: ["MRI Lumbar Spine Normal", "MRI Cervical Spine Normal", "MRI Spine Canal Stenosis"],
    findings: [
      "Normal lumbar lordosis. Vertebral body heights are maintained.",
      "No disc herniation, canal stenosis, or neural foraminal narrowing.",
      "Conus medullaris terminates normally at L1-L2."
    ],
    impressions: [
      "Normal study of the lumbar spine.",
      "No significant disc bulge or canal stenosis."
    ]
  },
  "XRAY CHEST": {
    templates: ["Chest X-Ray 2 Views", "Chest X-Ray AP Portable"],
    findings: [
      "Lungs are clear with no focal consolidation or pleural effusion.",
      "Cardiomediastinal silhouette is within normal limits.",
      "Hila and hemidiaphragms are normal."
    ],
    impressions: [
      "Normal PA/Lateral chest radiograph.",
      "No active cardiopulmonary disease."
    ]
  }
};

export default function RadiologyCommandCenter({ studyId }: { studyId?: number }) {
  const { studyId: routeStudyId } = useParams<{ studyId?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  // Active view: "workspace" or "dashboard"
  const [activeView, setActiveView] = useState<"workspace" | "dashboard">("workspace");

  // Selected study state
  const [activeStudyId, setActiveStudyId] = useState<number | null>(
    studyId ? Number(studyId) : routeStudyId ? Number(routeStudyId) : null
  );
  const [worklistOpen, setWorklistOpen] = useState(true);

  // Search & Filter for worklist sidebar
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarModality, setSidebarModality] = useState("all");

  // Reporting form state
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [impression, setImpression] = useState<string[]>([""]);
  const [recommendation, setRecommendation] = useState("Please correlate with clinical findings.");
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [reportStatus, setReportStatus] = useState<string>("DRAFT");
  
  // Structured reporting toggles
  const [useStructured, setUseStructured] = useState(false);
  const [findingsMap, setFindingsMap] = useState<Record<string, { normal: boolean; text: string }>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  // AI draft states
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOutput, setAiOutput] = useState("");

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Worklist Queue for Sidebar
  const { data: queue = [], isLoading: queueLoading } = useQuery<WorklistEntry[]>({
    queryKey: ["radiology-pacs-worklist"],
    queryFn: () => api.get<WorklistEntry[]>("/api/radiology/pacs-worklist"),
    refetchInterval: 30000,
  });

  // 2. Active Study Details
  const { data: study, isLoading: studyLoading } = useQuery<WorklistEntry>({
    queryKey: ["workspace-entry", activeStudyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${activeStudyId}`),
    enabled: activeStudyId !== null,
  });

  // 3. Structured Templates Library
  const { data: templates = [] } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get<StructuredTemplate[]>("/api/radiology/structured-report-templates"),
  });

  // 4. Viewer settings
  const { data: pacsViewerSettings = {} } = useQuery<Record<string, string>>({
    queryKey: ["pacs-viewer-settings"],
    queryFn: async () => {
      const rows = await api.get<any[]>("/api/radiology/pacs-settings");
      const map: Record<string, string> = {};
      for (const r of rows) if (r.category === "viewer") map[r.key] = r.value;
      return map;
    },
  });

  // 5. Patient's Prior Reports
  const activePatientId = study?.patientId;
  const { data: priorReports } = useQuery<any>({
    queryKey: ["patient-prior-reports", activePatientId],
    queryFn: () => api.get<any>(`/api/patient-reports/patient/${activePatientId}`),
    enabled: !!activePatientId,
  });

  // 6. Operational Dashboard metrics
  const { data: metrics, refetch: refetchMetrics } = useQuery<any>({
    queryKey: ["command-center"],
    queryFn: () => api.get("/api/radiology-workflow/command-center"),
    enabled: activeView === "dashboard",
    refetchInterval: 10000,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EFFECTS & AUTO-DETECTION
  // ══════════════════════════════════════════════════════════════════════════

  // Auto-load parameter if route changes
  useEffect(() => {
    if (routeStudyId) {
      setActiveStudyId(Number(routeStudyId));
    }
  }, [routeStudyId]);

  // If no study loaded yet, auto-load the first one from the queue
  useEffect(() => {
    if (!activeStudyId && queue.length > 0) {
      setActiveStudyId(queue[0].id);
    }
  }, [queue, activeStudyId]);

  // Context-Aware suggestion matching
  const detectedContext = useMemo(() => {
    if (!study) return null;
    const desc = (study.studyDescription || "").toUpperCase();
    const mod = (study.modality || "").toUpperCase();

    if (desc.includes("BRAIN") || desc.includes("HEAD")) {
      return mod.includes("MR") ? "MRI BRAIN" : "CT BRAIN";
    }
    if (desc.includes("SPINE") || desc.includes("LUMBAR") || desc.includes("CERVICAL") || desc.includes("LS")) {
      return "MRI SPINE";
    }
    if (desc.includes("CHEST") || desc.includes("LUNG")) {
      return "XRAY CHEST";
    }
    return null;
  }, [study]);

  // Auto-populate template/text from AI draft or preset defaults when study changes
  useEffect(() => {
    if (!study) return;
    setReportStatus(study.status === "REPORT_FINAL" ? "FINAL" : "DRAFT");
    
    // Clear and reset values
    setClinicalHistory("");
    setTechnique("");
    setRawFindings("");
    setImpression([""]);
    setRecommendation("Please correlate with clinical findings.");
    setIsCritical(false);
    setCriticalNote("");
    setAiOutput("");

    // If pre-existing draft, use it
    if (study.aiDraftJson) {
      try {
        const draft = JSON.parse(study.aiDraftJson);
        if (draft.clinical_history) setClinicalHistory(draft.clinical_history);
        if (draft.technique) setTechnique(draft.technique);
        if (draft.findings) setRawFindings(draft.findings);
        if (draft.impression) setImpression([draft.impression]);
        if (draft.recommendation) setRecommendation(draft.recommendation);
      } catch { /* ignore */ }
    }
  }, [study]);

  // Apply selected template
  const applyTemplate = (template: StructuredTemplate) => {
    setSelectedTemplateId(template.id);
    try {
      const sections = JSON.parse(template.sectionsJson) as TemplateSections;
      setTechnique(sections.technique || "");
      if (useStructured) {
        const map: Record<string, { normal: boolean; text: string }> = {};
        for (const item of sections.findingsItems) {
          map[item.label] = { normal: true, text: item.normal };
        }
        setFindingsMap(map);
      } else {
        setRawFindings(template.defaultFindings || "");
      }
      if (template.defaultImpression) setImpression([template.defaultImpression]);
    } catch {
      setRawFindings(template.defaultFindings || "");
    }
    toast({ title: `Loaded: ${template.templateName}` });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS & MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  // Save Draft
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!study) return;
      return api.post("/api/radiology/report-generator/save-draft", {
        studyId: study.studyId,
        worklistId: study.id,
        patientId: study.patientId,
        templateId: selectedTemplateId ? String(selectedTemplateId) : null,
        modality: study.modality,
        studyName: study.studyDescription || "Radiology Report",
        clinicalHistory,
        rawFindings,
        findingsSections: useStructured ? findingsMap : null,
        impression: impression.filter(Boolean),
        recommendation,
      });
    },
    onSuccess: () => {
      toast({ title: "Draft Saved Successfully" });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e) => toast({ title: "Failed to Save Draft", description: e.message, variant: "destructive" }),
  });

  // Finalize Report
  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!study) return;
      
      // Build plain findings text
      let findingsText = rawFindings;
      if (useStructured) {
        findingsText = Object.entries(findingsMap)
          .map(([label, item]) => `${label}: ${item.normal ? "Normal" : item.text}`)
          .join("\n");
      }

      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3>Radiology Report: ${study.studyDescription || "Study"}</h3>
          <p><strong>Patient Name:</strong> ${study.patientName}</p>
          <p><strong>Clinical History:</strong> ${clinicalHistory}</p>
          <p><strong>Technique:</strong> ${technique}</p>
          <hr />
          <h4>Findings</h4>
          <p style="white-space: pre-line;">${findingsText}</p>
          <h4>Impression</h4>
          <ol>${impression.map((imp) => `<li>${imp}</li>`).join("")}</ol>
          <p><strong>Recommendation:</strong> ${recommendation}</p>
        </div>
      `;

      let reportId = null;
      if (study.patientId) {
        const report = await api.post<{ id: number }>("/api/patient-reports", {
          patientId: study.patientId,
          testId: null,
          studyId: study.studyId,
          type: "radiology",
          title: study.studyDescription || "Radiology Report",
          body: htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          impression: impression.join("\n"),
          parameters: JSON.stringify({
            modality: study.modality,
            studyDescription: study.studyDescription,
            accessionNumber: study.accessionNumber,
            studyInstanceUID: study.studyInstanceUID,
          }),
          isCritical,
          criticalNote: isCritical ? criticalNote : null,
          createdBy: session?.user.name ?? "Radiologist",
        });
        reportId = report.id;
      }

      await api.post("/api/internal/radiology/report-status", {
        accessionNumber: study.accessionNumber,
        studyInstanceUID: study.studyInstanceUID,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: session?.user.name ?? "staff",
      });

      setReportStatus("FINAL");
    },
    onSuccess: () => {
      toast({ title: "Report Finalized", description: "The finalized report has been registered." });
      qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e) => toast({ title: "Finalize Failed", description: e.message, variant: "destructive" }),
  });

  // AI draft generator directly inside workspace
  const generateAiDraft = async () => {
    if (!study) return;
    setAiLoading(true);
    try {
      const res = await api.post<{ aiResponse: string }>("/api/ai-reporting/query", {
        promptText: `As a radiologist, generate a professional draft report for this ${study.modality} study. Clinical History: ${clinicalHistory}. Findings/Observations: ${rawFindings}.`,
        studyInstanceUID: study.studyInstanceUID,
        accessionNumber: study.accessionNumber,
        patientId: study.patientId || undefined,
        includeDemographics: true,
        provider: "gemini",
        maxImages: 0,
      });
      setAiOutput(res.aiResponse);
      setRawFindings(res.aiResponse);
      toast({ title: "AI Draft Loaded" });
    } catch (e: any) {
      toast({ title: "AI Generation Failed", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER FILTERED SIDEBAR WORKLIST
  // ══════════════════════════════════════════════════════════════════════════
  const filteredQueue = useMemo(() => {
    return queue.filter((e) => {
      if (sidebarModality !== "all" && e.modality !== sidebarModality) return false;
      if (!sidebarSearch) return true;
      const s = sidebarSearch.toLowerCase();
      return (
        e.patientName.toLowerCase().includes(s) ||
        (e.accessionNumber || "").toLowerCase().includes(s) ||
        (e.studyDescription || "").toLowerCase().includes(s)
      );
    });
  }, [queue, sidebarSearch, sidebarModality]);

  const activeTemplateSuggestions = useMemo(() => {
    if (!study) return [];
    const mod = study.modality.toUpperCase();
    return templates.filter((t) => t.modality.toUpperCase() === mod);
  }, [study, templates]);

  return (
    <div className="min-h-[calc(100vh-3rem)] bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      
      {/* Header bar */}
      <div className="h-14 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-slate-100"
            onClick={() => setWorklistOpen(!worklistOpen)}
          >
            <ListCollapse size={18} />
          </Button>
          <span className="font-bold text-sm tracking-wide text-slate-200 uppercase flex items-center gap-2">
            <Layers className="text-emerald-500 w-4 h-4" />
            Radiology Command Center
          </span>
          
          {/* View switcher */}
          <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800 ml-4">
            <button
              onClick={() => setActiveView("workspace")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${activeView === "workspace" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
            >
              Interactive Workspace
            </button>
            <button
              onClick={() => setActiveView("dashboard")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${activeView === "dashboard" ? "bg-slate-800 text-emerald-400" : "text-slate-400 hover:text-slate-200"}`}
            >
              Operational Dashboard
            </button>
          </div>
        </div>

        {/* Legacy routing links */}
        <div className="flex items-center gap-2">
          <Button variant="link" onClick={() => navigate("/radiology/reporting-workspace")} className="text-xs text-slate-400 hover:text-slate-200 p-1">
            Legacy Workspace
          </Button>
          <span className="text-slate-700">|</span>
          <Button variant="link" onClick={() => navigate("/radiology/structured-report-templates")} className="text-xs text-slate-400 hover:text-slate-200 p-1">
            Legacy Templates
          </Button>
          <span className="text-slate-700">|</span>
          <Button variant="link" onClick={() => navigate("/radiology/normal-templates")} className="text-xs text-slate-400 hover:text-slate-200 p-1">
            Legacy Findings
          </Button>
        </div>
      </div>

      {/* Main Layout Area */}
      {activeView === "dashboard" ? (
        /* Render Operational Dashboard metrics (preserved feature) */
        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Pending Reports</p>
              <h3 className="text-2xl font-bold text-slate-100">{metrics?.pendingReports ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Critical Alerts</p>
              <h3 className="text-2xl font-bold text-rose-500">{metrics?.criticalAlerts ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">Studies Today</p>
              <h3 className="text-2xl font-bold text-emerald-400">{metrics?.studiesToday ?? "—"}</h3>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-400">AI Queued</p>
              <h3 className="text-2xl font-bold text-cyan-400">{metrics?.aiQueue?.queued ?? "—"}</h3>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Wifi size={14} className="text-emerald-400" /> Modality Stations Status
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
              {metrics?.modalities?.map((m: any) => (
                <div key={m.modality} className="border border-slate-800 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-400 uppercase font-mono">{m.modality}</p>
                  <p className="text-lg font-bold mt-1 text-slate-100">{m.online}/{m.total}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Workspace mode */
        <div className="flex flex-1 overflow-hidden">
          
          {/* 1. COLLAPSIBLE WORKLIST SIDEBAR */}
          {worklistOpen && (
            <div className="w-80 border-r border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col shrink-0">
              <div className="p-3 border-b border-slate-800 flex flex-col gap-2 shrink-0">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Queue</span>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <Input
                    placeholder="Search patients..."
                    value={sidebarSearch}
                    onChange={(e) => setSidebarSearch(e.target.value)}
                    className="h-8 pl-8 text-xs bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
                <select
                  value={sidebarModality}
                  onChange={(e) => setSidebarModality(e.target.value)}
                  className="h-8 text-xs border border-slate-800 rounded bg-slate-950 text-slate-200"
                >
                  <option value="all">All Modalities</option>
                  <option value="MR">MRI</option>
                  <option value="CT">CT</option>
                  <option value="X-RAY">X-Ray</option>
                  <option value="US">Ultrasound</option>
                </select>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {queueLoading ? (
                  <p className="text-xs text-slate-500 text-center py-4">Loading queue...</p>
                ) : filteredQueue.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No studies found</p>
                ) : (
                  filteredQueue.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveStudyId(e.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${e.id === activeStudyId ? "bg-slate-800 border-emerald-500 shadow-md" : "bg-slate-900/40 border-slate-800 hover:bg-slate-800/40"}`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-xs text-slate-200 truncate flex-1 pr-1">{e.patientName}</span>
                        <Badge variant="outline" className="text-[9px] px-1 h-4 font-mono text-emerald-400 border-emerald-800/40">{e.modality}</Badge>
                      </div>
                      <span className="text-[10px] text-slate-500 truncate">{e.studyDescription || "No study desc"}</span>
                      <div className="flex justify-between items-center text-[9px] text-slate-500 font-mono mt-1 pt-1 border-t border-slate-800/40">
                        <span>ACC: {e.accessionNumber}</span>
                        <span>{e.studyDate || "—"}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Core Workspace containing Left, Center, Right & Bottom Reporting panels */}
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Top Workspace Grid (Left Panel + Center Panel + Right Panel) */}
            <div className="flex-1 flex overflow-hidden">
              
              {/* 2. LEFT PANEL: Study information & Patient details */}
              <div className="w-80 border-r border-slate-800 bg-slate-950 overflow-y-auto p-4 flex flex-col gap-4">
                <div className="space-y-3">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Patient & Study Info</h3>
                  {studyLoading ? (
                    <p className="text-xs text-slate-500">Loading study info...</p>
                  ) : !study ? (
                    <p className="text-xs text-slate-500">Select a study to view details</p>
                  ) : (
                    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 space-y-2.5 text-xs">
                      <div>
                        <p className="text-slate-500 text-[10px]">Patient Name</p>
                        <p className="font-semibold text-slate-200">{study.patientName}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-slate-500 text-[10px]">Age / Sex</p>
                          <p className="font-semibold text-slate-200">{[study.age, study.sex].filter(Boolean).join(" / ")}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-[10px]">Modality</p>
                          <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{study.modality}</Badge>
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Accession Number</p>
                        <p className="font-mono text-slate-200">{study.accessionNumber}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Description</p>
                        <p className="font-semibold text-slate-200">{study.studyDescription || "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Referring Doctor</p>
                        <p className="text-slate-300">{study.referringDoctor || "—"}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Date</p>
                        <p className="text-slate-300">{study.studyDate || "—"}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Patient's Previous Reports */}
                <div className="space-y-2 border-t border-slate-800 pt-4 flex-1">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText size={13} className="text-emerald-400" />
                    Previous Reports
                  </h3>
                  <div className="space-y-2 overflow-y-auto">
                    {priorReports?.items?.length > 0 ? (
                      priorReports.items.map((r: any) => (
                        <div key={r.id} className="border border-slate-800 bg-slate-900/30 p-2.5 rounded text-[11px] hover:bg-slate-900/50 cursor-pointer">
                          <p className="font-semibold text-slate-300">{r.title}</p>
                          <p className="text-slate-500 font-mono mt-0.5">{new Date(r.createdAt).toLocaleDateString()}</p>
                          <p className="text-slate-400 line-clamp-2 mt-1">{r.impression || r.body}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500">No prior reports found for this patient.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. CENTER PANEL: Viewer Area */}
              <div className="flex-1 bg-slate-950 border-r border-slate-800 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-800 bg-slate-900/20 flex items-center justify-between shrink-0">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Viewer Workspace</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      onClick={() => launchViewer(study?.studyInstanceUID, "WEASIS", pacsViewerSettings, toast)}
                      disabled={!study?.studyInstanceUID}
                    >
                      <Tv2 size={12} className="mr-1.5 text-blue-400" /> Weasis
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      onClick={() => launchViewer(study?.studyInstanceUID, "OHIF", pacsViewerSettings, toast)}
                      disabled={!study?.studyInstanceUID}
                    >
                      <MonitorPlay size={12} className="mr-1.5 text-emerald-400" /> OHIF
                    </Button>
                  </div>
                </div>

                <div className="flex-1 bg-slate-900/30 overflow-hidden relative">
                  {study?.studyInstanceUID ? (
                    <EmbeddedWadoViewer
                      studyInstanceUID={study.studyInstanceUID}
                      accessionNumber={study.accessionNumber}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                      <MonitorPlay size={44} className="text-slate-800 animate-pulse mb-3" />
                      <p className="text-sm font-semibold text-slate-400">PACS DICOM Viewer Viewport</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm">
                        Use the top Weasis or OHIF buttons to open the complete image stacks in an external window.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. RIGHT PANEL: Context-Aware Assistant */}
              <div className="w-80 border-slate-800 bg-slate-950 overflow-y-auto p-4 flex flex-col gap-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                  <Zap size={14} className="text-emerald-400" />
                  Reporting Assistant
                </h3>

                {detectedContext && (
                  <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono">{detectedContext} Context</span>
                      <Badge variant="outline" className="text-[9px] text-slate-500 border-slate-800">Auto-detected</Badge>
                    </div>

                    {/* Context Specific Suggestions */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Suggested Templates</p>
                      <div className="flex flex-col gap-1.5">
                        {templates
                          .filter((t) => CONTEXT_MAPPING[detectedContext].templates.some((tpl) => t.templateName.includes(tpl)))
                          .map((t) => (
                            <button
                              key={t.id}
                              onClick={() => applyTemplate(t)}
                              className="w-full text-left text-xs bg-slate-950 border border-slate-800 p-2 rounded hover:border-emerald-500/50 hover:bg-slate-900 transition-colors"
                            >
                              {t.templateName}
                            </button>
                          ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Common Findings Macros</p>
                      <div className="flex flex-col gap-1.5">
                        {CONTEXT_MAPPING[detectedContext].findings.map((findingText, i) => (
                          <button
                            key={i}
                            onClick={() => setRawFindings((prev) => prev + (prev ? "\n\n" : "") + findingText)}
                            className="w-full text-left text-[11px] bg-slate-950 border border-slate-800 p-2 rounded hover:bg-slate-900 hover:text-slate-100 text-slate-400 line-clamp-2 transition-colors"
                          >
                            + {findingText}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Impressions</p>
                      <div className="flex flex-col gap-1.5">
                        {CONTEXT_MAPPING[detectedContext].impressions.map((impText, i) => (
                          <button
                            key={i}
                            onClick={() => setImpression((prev) => {
                              const next = [...prev];
                              if (next[0] === "") next[0] = impText;
                              else next.push(impText);
                              return next;
                            })}
                            className="w-full text-left text-[11px] bg-slate-950 border border-slate-800 p-2 rounded hover:bg-slate-900 hover:text-slate-100 text-slate-400 line-clamp-2 transition-colors"
                          >
                            + {impText}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Suggested templates based on Modality */}
                <div className="space-y-2 flex-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">All Modality Templates</p>
                  <div className="flex flex-col gap-1.5">
                    {activeTemplateSuggestions.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className="w-full text-left text-xs bg-slate-900 border border-slate-800 p-2 rounded hover:border-emerald-500/50 hover:bg-slate-800 transition-colors"
                      >
                        {t.templateName}
                      </button>
                    ))}
                    {activeTemplateSuggestions.length === 0 && (
                      <p className="text-xs text-slate-600">No templates matching {study?.modality}</p>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* 5. BOTTOM REPORTING PANEL: Reuse existing report workflow */}
            <div className="border-t border-slate-800 bg-slate-900/40 p-4 shrink-0 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Report Workspace</span>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="structured-mode"
                      checked={useStructured}
                      onCheckedChange={(checked) => setUseStructured(checked === true)}
                    />
                    <Label htmlFor="structured-mode" className="text-xs cursor-pointer select-none text-slate-300">Structured Sections</Label>
                  </div>
                </div>

                <div className="flex gap-2">
                  <VoiceDictationButton
                    onInsert={(t) => setRawFindings((p) => p + t)}
                    targetField="findings"
                    className="h-7 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                    onClick={generateAiDraft}
                    disabled={aiLoading}
                  >
                    <Sparkles size={12} className="mr-1.5 text-purple-400" />
                    {aiLoading ? "Generating..." : "AI Draft"}
                  </Button>
                </div>
              </div>

              {/* Editor Workspace */}
              <div className="grid grid-cols-2 gap-4">
                {/* Findings Editor */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-400">Findings & observations</Label>
                  {useStructured ? (
                    <div className="border border-slate-800 rounded bg-slate-950 p-2 space-y-2 h-44 overflow-y-auto">
                      {Object.entries(findingsMap).map(([label, item]) => (
                        <div key={label} className="border-b border-slate-800/60 pb-2 last:border-0 last:pb-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Checkbox
                              id={`norm-${label}`}
                              checked={item.normal}
                              onCheckedChange={(checked) =>
                                setFindingsMap((prev) => ({
                                  ...prev,
                                  [label]: { ...prev[label], normal: checked === true },
                                }))
                              }
                            />
                            <Label htmlFor={`norm-${label}`} className="text-xs text-slate-300 cursor-pointer">{label}</Label>
                          </div>
                          {!item.normal && (
                            <Input
                              value={item.text}
                              onChange={(e) =>
                                setFindingsMap((prev) => ({
                                  ...prev,
                                  [label]: { ...prev[label], text: e.target.value },
                                }))
                              }
                              placeholder="Describe abnormal finding..."
                              className="h-7 text-xs bg-slate-900 border-slate-800 text-slate-200"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Textarea
                      value={rawFindings}
                      onChange={(e) => setRawFindings(e.target.value)}
                      placeholder="Enter findings here..."
                      className="h-44 text-xs font-mono bg-slate-950 border-slate-800 text-slate-200 resize-none"
                    />
                  )}
                </div>

                {/* Impression Editor */}
                <div className="space-y-1.5 flex flex-col h-48">
                  <Label className="text-xs font-semibold text-slate-400">Impression points</Label>
                  <div className="flex-1 overflow-y-auto space-y-1.5 bg-slate-950 border border-slate-800 rounded p-2 h-36">
                    {impression.map((line, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <span className="text-xs text-slate-500">{i + 1}.</span>
                        <Input
                          value={line}
                          onChange={(e) => {
                            const next = [...impression];
                            next[i] = e.target.value;
                            setImpression(next);
                          }}
                          placeholder={`Point ${i + 1}`}
                          className="h-7 text-xs bg-slate-900 border-slate-800 text-slate-200 flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setImpression(impression.filter((_, idx) => idx !== i))}
                          className="h-7 w-7 text-slate-500 hover:text-slate-300"
                        >
                          <X size={12} />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] border-slate-700 bg-slate-900 hover:bg-slate-850 mt-1"
                      onClick={() => setImpression([...impression, ""])}
                    >
                      + Add Impression Point
                    </Button>
                  </div>
                </div>
              </div>

              {/* Action Buttons row */}
              <div className="flex items-center justify-between border-t border-slate-800 pt-3">
                <div className="flex items-center gap-3">
                  {/* Critical finding button */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={isCritical ? "destructive" : "outline"}
                      className="h-8 text-xs font-semibold"
                      onClick={() => setIsCritical(!isCritical)}
                    >
                      <AlertOctagon size={13} className="mr-1.5" />
                      Critical Finding: {isCritical ? "Active" : "Off"}
                    </Button>
                    {isCritical && (
                      <Input
                        placeholder="Explain critical alert details..."
                        value={criticalNote}
                        onChange={(e) => setCriticalNote(e.target.value)}
                        className="h-8 w-60 text-xs bg-slate-950 border-slate-800 text-slate-200"
                      />
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                    onClick={() => saveDraftMutation.mutate()}
                    disabled={saveDraftMutation.isPending}
                  >
                    <Save size={12} className="mr-1.5" />
                    Save Draft
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    onClick={() => {
                      if (confirm("Are you sure you want to finalize this report?")) {
                        finalizeMutation.mutate();
                      }
                    }}
                    disabled={finalizeMutation.isPending}
                  >
                    <CheckCircle2 size={12} className="mr-1.5" />
                    Finalize Report
                  </Button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
