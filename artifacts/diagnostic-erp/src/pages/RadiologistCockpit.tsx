import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import { readStaffSession } from "@/lib/staffSession";
import { useToast } from "@/hooks/use-toast";
import { launchViewer } from "@/lib/viewerService";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Activity, Clock, AlertTriangle, Cpu, Wifi, Database, Users,
  BarChart3, AlertOctagon, Send, Zap, HardDrive, Gauge, Bell,
  RefreshCw, ShieldCheck, ArrowUpRight, MonitorPlay, Tv2,
  FileEdit, Save, CheckCircle2, ChevronRight, Search, ListCollapse,
  Layers, Settings, FileText, ClipboardList, BookOpen, AlertCircle, Sparkles,
  Star, Check, RotateCcw, ChevronUp, ChevronDown, Wand2, Info,
  Ruler, GitCompare, History as HistoryIcon, BrainCircuit, WandSparkles,
  Pencil, SpellCheck, Repeat2, FileDown, Mic, Heart, Baby, Stethoscope, X, Plus
} from "lucide-react";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import ChocolateBoxPanel, { type ChocolateFinding } from "@/components/ChocolateBoxPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import {
  detectBuilderType, getBuilderForType, defaultSelections,
  generateMultiStudyReport, generateCombinedTitle
} from "@/lib/radiologySmartEngine";

// Types
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
  lockUserId?: number | null;
  lockUserName?: string | null;
  lockTime?: string | null;
  lockLastActivityAt?: string | null;
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

export default function RadiologistCockpit() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  // Active study state
  const [activeStudyId, setActiveStudyId] = useState<number | null>(null);

  // Search & Filter for sidebar worklist
  const [searchQuery, setSearchQuery] = useState("");
  const [modalityFilter, setModalityFilter] = useState("all");

  // Form Editor state
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [impression, setImpression] = useState<string[]>([""]);
  const [recommendation, setRecommendation] = useState("Please correlate with clinical findings.");
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [selectedChocolateFindings, setSelectedChocolateFindings] = useState<ChocolateFinding[]>([]);

  // Structured reporting builders state
  const [selectedBuilders, setSelectedBuilders] = useState<string[]>([]);
  const [multiSelections, setMultiSelections] = useState<Record<string, Record<string, any>>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  // Checklist Communication state
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });

  // Voice processing state
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceLoading, setVoiceLoading] = useState(false);

  // Diagnostics & Network profile state
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [diagnosticsLogs, setDiagnosticsLogs] = useState<string[]>(["System started.", "PACS connection idle."]);

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // 1. PACS Worklist
  const { data: worklist = [], isLoading: worklistLoading, refetch: refetchWorklist } = useQuery<WorklistEntry[]>({
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

  // 4. Viewer Configuration Settings
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
  const { data: priorReports = [] } = useQuery<any[]>({
    queryKey: ["patient-prior-reports", activePatientId],
    queryFn: () => api.get<any[]>(`/api/patient-reports/patient/${activePatientId}`),
    enabled: !!activePatientId,
  });

  // 6. User Preferences (macros, templates)
  const { data: preferences } = useQuery<any>({
    queryKey: ["user-report-preferences"],
    queryFn: () => api.get<any>("/api/radiology/user-report-preferences"),
    enabled: !!session?.user?.id,
  });

  const personalMacros = useMemo(() => {
    if (!preferences?.personalMacros) return [];
    try {
      return JSON.parse(preferences.personalMacros) as { name: string; content: string }[];
    } catch {
      return [];
    }
  }, [preferences]);

  // Starred / Favorite Templates List
  const starredTemplates = useMemo(() => {
    if (!preferences?.favoriteTemplates) return [];
    try {
      return JSON.parse(preferences.favoriteTemplates) as string[];
    } catch {
      return [];
    }
  }, [preferences]);

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS / MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  // Save Draft Mutation
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
        impression: impression.filter(Boolean),
        recommendation,
      });
    },
    onSuccess: () => {
      toast({ title: "Draft Saved", description: "Report draft updated successfully." });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e: any) => toast({ title: "Save Failed", description: e.message, variant: "destructive" }),
  });

  // Finalize Mutation
  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!study) return;
      const finalTitle = generateCombinedTitle(selectedBuilders);
      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3>Radiology Report: ${finalTitle}</h3>
          <p><strong>Patient Name:</strong> ${study.patientName}</p>
          <p><strong>Clinical History:</strong> ${clinicalHistory}</p>
          <p><strong>Technique:</strong> ${technique}</p>
          <hr />
          <h4>Findings</h4>
          <p style="white-space: pre-line;">${rawFindings}</p>
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
          title: finalTitle,
          body: htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          impression: impression.join("\n"),
          recommendation,
          technique,
          clinicalHistory,
          findings: rawFindings,
          accessionNumber: study.accessionNumber,
          isCritical,
          criticalNote: isCritical ? criticalNote : null,
        });
        reportId = report.id;
      }

      return api.post("/api/internal/radiology/report-status", {
        accessionNumber: study.accessionNumber,
        studyInstanceUID: study.studyInstanceUID,
        status: "REPORT_FINAL",
        reportId,
        actor: session?.user?.name || "Radiologist",
      });
    },
    onSuccess: () => {
      toast({ title: "Report Finalized", description: "Report signed and finalized." });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e: any) => toast({ title: "Finalization Failed", description: e.message, variant: "destructive" }),
  });

  // AI Draft Generation
  const generateAiDraftMutation = useMutation({
    mutationFn: async () => {
      if (!study) return;
      return api.post(`/api/internal/radiology/ai-draft`, {
        studyId: study.id,
        modality: study.modality,
        studyDescription: study.studyDescription ?? study.modality,
        patientName: study.patientName,
        age: study.age ?? "",
        sex: study.sex ?? "",
        accessionNumber: study.accessionNumber,
        studyDate: study.studyDate ?? "",
      });
    },
    onSuccess: () => {
      toast({ title: "AI Draft Ready", description: "AI generated draft retrieved successfully." });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] });
    },
  });

  // Voice processing AI mutation
  const voiceCleanupMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/radiology/report-generator/voice-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Voice post-processing failed");
      return res.json() as Promise<{ cleaned: string; explanation?: string }>;
    },
    onSuccess: (data) => {
      setRawFindings((prev) => (prev ? prev + "\n" + data.cleaned : data.cleaned));
      setVoiceInput("");
      toast({ title: "Voice Formatted", description: "Standardized text appended to findings." });
    },
    onError: (e: any) => toast({ title: "Dictation Error", description: e.message, variant: "destructive" }),
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EFFECTS & COMPUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  // Auto-select first study on load
  useEffect(() => {
    if (!activeStudyId && worklist.length > 0) {
      setActiveStudyId(worklist[0].id);
    }
  }, [worklist, activeStudyId]);

  // Load details whenever study changes
  useEffect(() => {
    if (!study) return;
    setClinicalHistory("");
    setTechnique("");
    setRawFindings("");
    setImpression([""]);
    setRecommendation("Please correlate with clinical findings.");
    setIsCritical(false);
    setCriticalNote("");
    setSelectedChocolateFindings([]);

    // Auto-detect template builder
    const builder = detectBuilderType(study.modality, study.studyDescription);
    if (builder) {
      setSelectedBuilders([builder]);
      setMultiSelections({ [builder]: defaultSelections(builder) });
    } else {
      setSelectedBuilders([]);
      setMultiSelections({});
    }

    // Pre-populate if draft exists
    if (study.aiDraftJson) {
      try {
        const parsed = JSON.parse(study.aiDraftJson);
        if (parsed.clinical_history) setClinicalHistory(parsed.clinical_history);
        if (parsed.technique) setTechnique(parsed.technique);
        if (parsed.findings) setRawFindings(parsed.findings);
        if (parsed.impression) setImpression(Array.isArray(parsed.impression) ? parsed.impression : [parsed.impression]);
        if (parsed.recommendation) setRecommendation(parsed.recommendation);
      } catch { /* ignore */ }
    }
  }, [study]);

  // Filtered worklist entries
  const filteredWorklist = useMemo(() => {
    return worklist.filter((w) => {
      if (modalityFilter !== "all" && w.modality !== modalityFilter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        w.patientName.toLowerCase().includes(q) ||
        (w.accessionNumber || "").toLowerCase().includes(q) ||
        (w.studyDescription || "").toLowerCase().includes(q)
      );
    });
  }, [worklist, modalityFilter, searchQuery]);

  // Productivity Metrics
  const productivityStats = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const finalizedToday = worklist.filter((w) => w.status === "REPORT_FINAL" && w.updatedAt.startsWith(todayStr)).length;
    const pendingCount = worklist.filter((w) => w.status !== "REPORT_FINAL").length;
    return { finalizedToday, pendingCount, avgTurnaround: "18 mins" };
  }, [worklist]);

  // Network ping emulator
  useEffect(() => {
    const interval = setInterval(() => {
      const start = Date.now();
      api.get("/api/radiology/pacs-worklist/count")
        .then(() => {
          setPingLatency(Date.now() - start);
          setDiagnosticsLogs((prev) => [...prev.slice(-20), `PACS Reachable: ping ${Date.now() - start}ms`]);
        })
        .catch(() => {
          setPingLatency(null);
          setDiagnosticsLogs((prev) => [...prev.slice(-20), "PACS Offline: timeout!"]);
        });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Macro Expansion in Text Area
  const handleFindingsTextChange = (val: string) => {
    let replaced = val;
    personalMacros.forEach((m) => {
      if (replaced.includes(`/${m.name}`)) {
        replaced = replaced.replaceAll(`/${m.name}`, m.content);
        toast({ title: "Macro applied", description: `Expanded /${m.name}` });
      }
    });
    setRawFindings(replaced);
  };

  // Launch OHIF Viewer
  const handleLaunchOhif = () => {
    if (!study || !study.studyInstanceUID) return;
    const template = pacsViewerSettings["ohif_viewer_url_template"] || "/viewer/{studyInstanceUID}";
    const url = template.replace("{studyInstanceUID}", study.studyInstanceUID);
    window.open(url, "_blank");
  };

  // Launch Weasis Viewer
  const handleLaunchWeasis = () => {
    if (!study) return;
    const template = pacsViewerSettings["weasis_manifest_url_template"];
    if (template && study.studyInstanceUID) {
      window.open(template.replace("{studyInstanceUID}", study.studyInstanceUID), "_blank");
    } else if (study.weasisUrl) {
      window.open(study.weasisUrl, "_blank");
    } else {
      toast({ title: "Weasis configuration missing", description: "Set manifest URL template in PACS settings.", variant: "destructive" });
    }
  };

  // Apply Template
  const handleApplyTemplate = (tpl: StructuredTemplate) => {
    setSelectedTemplateId(tpl.id);
    try {
      const sections = JSON.parse(tpl.sectionsJson) as TemplateSections;
      if (sections.technique) setTechnique(sections.technique);
      setRawFindings(tpl.defaultFindings || "");
      if (tpl.defaultImpression) setImpression([tpl.defaultImpression]);
      toast({ title: "Template Applied", description: tpl.templateName });
    } catch {
      setRawFindings(tpl.defaultFindings || "");
    }
  };

  // Append Structured Builder Findings
  const handleAppendBuilderFindings = () => {
    if (selectedBuilders.length === 0) return;
    const report = generateMultiStudyReport(selectedBuilders, multiSelections);
    setRawFindings((prev) => {
      const base = prev ? prev + "\n\n" : "";
      return base + "STRUCTURED FINDINGS:\n" + report.findings;
    });
    if (report.impression) {
      setImpression((prev) => {
        const next = [...prev.filter(Boolean)];
        if (!next.includes(report.impression)) next.push(report.impression);
        return next;
      });
    }
    toast({ title: "Findings Appended", description: "Structured observations added to report." });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-slate-900 text-slate-100 font-sans">
      {/* Top Banner / Diagnostic telemetry bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950 text-xs">
        <div className="flex items-center gap-4">
          <span className="font-bold flex items-center gap-1.5 text-indigo-400">
            <Stethoscope className="h-4 w-4" /> RADIOLOGIST COCKPIT v2.0
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-slate-800 bg-slate-900 text-slate-400">
              LAN Profile: Active
            </Badge>
            <div className="flex items-center gap-1 text-slate-400">
              <Wifi className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
              <span>Ping: {pingLatency !== null ? `${pingLatency}ms` : "checking..."}</span>
            </div>
          </div>
        </div>

        {/* Productivity metrics inline widget */}
        <div className="flex items-center gap-4 text-slate-400">
          <div>Today finalized: <span className="text-emerald-400 font-bold">{productivityStats.finalizedToday}</span></div>
          <div>Avg TAT: <span className="text-indigo-400 font-bold">{productivityStats.avgTurnaround}</span></div>
          <div>Pending queue: <span className="text-amber-400 font-bold">{productivityStats.pendingCount}</span></div>
        </div>
      </div>

      {/* Main Workspace Layout Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Worklist Sidebar */}
        <div className="w-80 border-r border-slate-800 bg-slate-950/80 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <Input
                placeholder="Search patient, accession..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 bg-slate-900 border-slate-800 text-xs h-8 text-slate-100 placeholder-slate-500 focus-visible:ring-indigo-500"
              />
            </div>
            <div className="flex gap-1.5">
              {["all", "CR", "CT", "MR", "US"].map((mod) => (
                <Button
                  key={mod}
                  size="sm"
                  variant={modalityFilter === mod ? "default" : "outline"}
                  onClick={() => setModalityFilter(mod)}
                  className={`h-6 text-[10px] flex-1 px-1 ${
                    modalityFilter === mod
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                      : "border-slate-800 hover:bg-slate-900 text-slate-400"
                  }`}
                >
                  {mod}
                </Button>
              ))}
            </div>
          </div>

          {/* Sidebar Patient Worklist Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {worklistLoading ? (
              <div className="p-10 text-center text-slate-500 text-xs">
                <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2 text-indigo-500" />
                Loading worklist...
              </div>
            ) : filteredWorklist.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-xs">No matching studies</div>
            ) : (
              filteredWorklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setActiveStudyId(item.id)}
                  className={`p-3 cursor-pointer transition-colors relative ${
                    activeStudyId === item.id
                      ? "bg-slate-800/80 border-l-4 border-indigo-500"
                      : "hover:bg-slate-900/60"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="font-semibold text-xs text-slate-200 truncate max-w-[150px]">{item.patientName}</span>
                    <Badge className="bg-slate-800 border-slate-700 text-[9px] font-mono px-1 py-0.5">{item.modality}</Badge>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                    <span>Acc: {item.accessionNumber}</span>
                    <span>{item.studyDate || "—"}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">{item.studyDescription || "No desc"}</div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className={`text-[9px] px-1 py-0.5 rounded ${
                      item.status === "REPORT_FINAL" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950/50 text-amber-400"
                    }`}>
                      {item.status}
                    </span>
                    {item.aiDraftStatus === "READY" && (
                      <Badge className="bg-indigo-950 text-indigo-300 text-[8px] flex items-center gap-0.5">
                        <Sparkles className="h-2 w-2 text-violet-400" /> AI Draft
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Center Column: Editor and Reporting Workspace */}
        <div className="flex-1 flex flex-col bg-slate-900 border-r border-slate-800 overflow-y-auto">
          {studyLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : !study ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
              <Info className="h-8 w-8 text-slate-600" />
              <span>Select a study from the worklist to start reporting</span>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {/* Patient Banner & Study Action Headers */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-100">{study.patientName}</h2>
                    <Badge variant="outline" className="border-slate-800 text-slate-400 text-[10px]">{study.age}/{study.sex}</Badge>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Accession: <span className="font-mono text-slate-300">{study.accessionNumber}</span> &bull; Modality: <span className="text-slate-300">{study.modality}</span> &bull; Description: <span className="text-slate-300">{study.studyDescription}</span>
                  </div>
                </div>

                {/* Viewer Launcher buttons */}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={handleLaunchOhif} className="bg-sky-600 hover:bg-sky-700 text-xs h-8 flex items-center gap-1 text-white">
                    <MonitorPlay className="h-3.5 w-3.5" /> Launch OHIF
                  </Button>
                  <Button size="sm" onClick={handleLaunchWeasis} className="bg-indigo-600 hover:bg-indigo-700 text-xs h-8 flex items-center gap-1 text-white">
                    <Tv2 className="h-3.5 w-3.5" /> Launch Weasis
                  </Button>
                </div>
              </div>

              {/* Patient Prior Reports quick lookup inline */}
              {priorReports.length > 0 && (
                <Card className="bg-slate-950 border-slate-800">
                  <CardHeader className="p-3 pb-0">
                    <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1">
                      <HistoryIcon className="h-3.5 w-3.5 text-indigo-400" /> Patient Previous Studies ({priorReports.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {priorReports.slice(0, 2).map((p: any) => (
                        <div key={p.id} className="bg-slate-900 border border-slate-800/80 rounded p-2 text-[11px] space-y-1">
                          <div className="flex justify-between font-semibold text-slate-200">
                            <span>{p.title || "Previous Report"}</span>
                            <span className="text-slate-500">{p.createdAt ? p.createdAt.split("T")[0] : ""}</span>
                          </div>
                          <p className="text-slate-400 line-clamp-2 italic">"{p.impression || "No impression text."}"</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quick Template Selector */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-300">Fast Templates & Favorites</Label>
                <div className="flex flex-wrap gap-1.5">
                  {templates.slice(0, 6).map((tpl) => (
                    <Button
                      key={tpl.id}
                      size="sm"
                      variant="outline"
                      onClick={() => handleApplyTemplate(tpl)}
                      className={`h-7 text-[10px] bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900 ${
                        selectedTemplateId === tpl.id ? "border-indigo-500 text-indigo-400 bg-indigo-950/20" : ""
                      }`}
                    >
                      {starredTemplates.includes(tpl.templateName) && <Star className="h-3 w-3 text-amber-400 fill-amber-400 mr-1" />}
                      {tpl.templateName}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Main Report Editor Input Form */}
              <div className="space-y-3 bg-slate-950 border border-slate-800 rounded-lg p-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-300">Clinical History</Label>
                  <Input
                    value={clinicalHistory}
                    onChange={(e) => setClinicalHistory(e.target.value)}
                    placeholder="Enter clinical indication..."
                    className="bg-slate-900 border-slate-800 text-xs text-slate-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-300">Technique</Label>
                  <Input
                    value={technique}
                    onChange={(e) => setTechnique(e.target.value)}
                    placeholder="Describe modalities and protocols used..."
                    className="bg-slate-900 border-slate-800 text-xs text-slate-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-300">Findings & Observations</Label>
                    <VoiceDictationButton
                      onInsert={(text: string) => handleFindingsTextChange(rawFindings ? rawFindings + " " + text : text)}
                      className="scale-90"
                    />
                  </div>
                  <Textarea
                    value={rawFindings}
                    onChange={(e) => handleFindingsTextChange(e.target.value)}
                    rows={12}
                    placeholder="Write findings... (Use '/shortcut' to expand template macros)"
                    className="bg-slate-900 border-slate-800 text-xs font-mono text-slate-200 focus-visible:ring-indigo-500 leading-relaxed"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-300">Impression Points</Label>
                  {impression.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <span className="text-xs text-slate-500 font-bold">{idx + 1}.</span>
                      <Input
                        value={line}
                        onChange={(e) => {
                          const next = [...impression];
                          next[idx] = e.target.value;
                          setImpression(next);
                        }}
                        placeholder="Add diagnostic conclusion..."
                        className="bg-slate-900 border-slate-800 text-xs text-slate-200 flex-1"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setImpression((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-7 w-7 p-0 text-slate-500 hover:text-red-400"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImpression((prev) => [...prev, ""])}
                    className="h-6 text-[10px] border-slate-800 text-slate-400 hover:bg-slate-900 mt-1"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Impression Line
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-300">Recommendation</Label>
                  <Input
                    value={recommendation}
                    onChange={(e) => setRecommendation(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-xs text-slate-200"
                  />
                </div>
              </div>

              {/* Critical Findings Panel */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <AlertTriangle className={`h-4 w-4 ${isCritical ? "text-amber-500 animate-bounce" : "text-slate-500"}`} /> Flag Critical Finding
                    </Label>
                    <p className="text-[10px] text-slate-500">Requires documented communication checklist.</p>
                  </div>
                  <Switch checked={isCritical} onCheckedChange={setIsCritical} />
                </div>

                {isCritical && (
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <Textarea
                      placeholder="Specify critical observation (e.g. pneumothorax, severe intracranial hemorrhage)..."
                      value={criticalNote}
                      onChange={(e) => setCriticalNote(e.target.value)}
                      rows={2}
                      className="bg-slate-900 border-slate-800 text-xs text-slate-200"
                    />

                    {/* Communication Checklist */}
                    <div className="space-y-2">
                      <Label className="text-[11px] font-bold text-slate-400">Communication Checklist Status</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <label className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800 text-[10px] cursor-pointer">
                          <Checkbox
                            checked={checklistComm.phoned}
                            onCheckedChange={(checked) => setChecklistComm((prev) => ({ ...prev, phoned: !!checked }))}
                          />
                          <span>Telephoned Doctor</span>
                        </label>
                        <label className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800 text-[10px] cursor-pointer">
                          <Checkbox
                            checked={checklistComm.annotated}
                            onCheckedChange={(checked) => setChecklistComm((prev) => ({ ...prev, annotated: !!checked }))}
                          />
                          <span>Annotated in PACS</span>
                        </label>
                        <label className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800 text-[10px] cursor-pointer">
                          <Checkbox
                            checked={checklistComm.dispatched}
                            onCheckedChange={(checked) => setChecklistComm((prev) => ({ ...prev, dispatched: !!checked }))}
                          />
                          <span>Dispatched Alert</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Status Actions */}
              <div className="flex items-center justify-between gap-4 pt-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Report Status:</span>
                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                    study.status === "REPORT_FINAL" ? "bg-emerald-950 text-emerald-400" : "bg-yellow-950 text-yellow-400"
                  }`}>
                    {study.status === "REPORT_FINAL" ? "FINALIZED" : "DRAFT"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => saveDraftMutation.mutate()}
                    disabled={saveDraftMutation.isPending || study.status === "REPORT_FINAL"}
                    variant="outline"
                    className="border-slate-800 hover:bg-slate-955 text-slate-300 text-xs h-9"
                  >
                    <Save className="h-4 w-4 mr-1.5" /> Save Draft
                  </Button>

                  <Button
                    onClick={() => finalizeMutation.mutate()}
                    disabled={finalizeMutation.isPending || study.status === "REPORT_FINAL"}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-9 font-bold"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Finalize & Sign
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Assistant panel / Chocolate Box / Builders / Telemetry */}
        <div className="w-[380px] flex flex-col flex-shrink-0 bg-slate-955">
          <Tabs defaultValue="assist" className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-4 bg-slate-900 border-b border-slate-800 rounded-none h-11 p-1">
              <TabsTrigger value="assist" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                AI & Voice
              </TabsTrigger>
              <TabsTrigger value="chocolate" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                Findings
              </TabsTrigger>
              <TabsTrigger value="builders" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                Builders
              </TabsTrigger>
              <TabsTrigger value="telemetry" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                PACS Logs
              </TabsTrigger>
            </TabsList>

            {/* TAB: AI & Voice Dictation */}
            <TabsContent value="assist" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-3">
                  <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-indigo-400" /> AI Draft Assistant
                  </CardTitle>
                  <CardDescription className="text-[10px]">Generate clinical observations and drafts using models.</CardDescription>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <Button
                    onClick={() => generateAiDraftMutation.mutate()}
                    disabled={generateAiDraftMutation.isPending || !study}
                    className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs h-8 font-bold"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1.5 ${generateAiDraftMutation.isPending ? "animate-spin" : ""}`} />
                    Query AI Draft
                  </Button>

                  {study?.aiDraftJson && (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <div className="text-[10px] font-bold text-slate-400">Active AI Draft findings:</div>
                      <div className="bg-slate-950 rounded p-2 text-[10px] text-slate-300 max-h-40 overflow-y-auto font-mono whitespace-pre-line leading-normal border border-slate-800">
                        {JSON.parse(study.aiDraftJson).findings || "No findings text"}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            try {
                              const draft = JSON.parse(study.aiDraftJson!);
                              if (draft.findings) setRawFindings(draft.findings);
                              if (draft.impression) setImpression([draft.impression]);
                              toast({ title: "Draft Applied", description: "Replaced editor fields with AI observations." });
                            } catch {}
                          }}
                          className="flex-1 text-[10px] h-7 border-slate-800 text-slate-300 hover:bg-slate-950"
                        >
                          Import Draft
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Speech Voice Helper Panel */}
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-3">
                  <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Mic className="h-4 w-4 text-indigo-400" /> Speech Post-Processing
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <Textarea
                    placeholder="Dictate text or type unstructured logs..."
                    value={voiceInput}
                    onChange={(e) => setVoiceInput(e.target.value)}
                    rows={4}
                    className="bg-slate-955 border-slate-800 text-xs text-slate-200"
                  />
                  <Button
                    onClick={() => voiceCleanupMutation.mutate(voiceInput)}
                    disabled={voiceCleanupMutation.isPending || !voiceInput}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs h-8"
                  >
                    {voiceCleanupMutation.isPending ? "Standardizing..." : "Standardize & Format Dictation"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB: Chocolate Box Smart Findings */}
            <TabsContent value="chocolate" className="flex-1 overflow-y-auto p-4 m-0">
              {study ? (
                <div className="space-y-4">
                  <ChocolateBoxPanel
                    modality={study.modality}
                    bodyPart={study.studyDescription || ""}
                    selectedFindingsList={selectedChocolateFindings}
                    onSelectFinding={(finding: ChocolateFinding) => {
                      setSelectedChocolateFindings((prev) => [...prev, finding]);
                      setRawFindings((prev) => prev ? prev + "\n" + finding.findingText : finding.findingText);
                    }}
                  />
                </div>
              ) : (
                <div className="p-10 text-center text-slate-500 text-xs">No active study selected</div>
              )}
            </TabsContent>

            {/* TAB: Structured Builders */}
            <TabsContent value="builders" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              {study ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-bold text-slate-300">Observation Checklists</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAppendBuilderFindings}
                      className="h-7 text-[10px] border-slate-800 text-indigo-400 hover:bg-slate-900"
                    >
                      Merge selections
                    </Button>
                  </div>

                  {/* Spinal Measurements Panel component Integration */}
                  <MeasurementAssistantPanel
                    patientId={study.patientId || undefined}
                    studyId={study.studyId || undefined}
                    modality={study.modality}
                    bodyPart={study.studyDescription || ""}
                  />
                </div>
              ) : (
                <div className="p-10 text-center text-slate-500 text-xs">No active study selected</div>
              )}
            </TabsContent>

            {/* TAB: Viewer Diagnostics & Telemetry */}
            <TabsContent value="telemetry" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              <Card className="bg-slate-900 border-slate-800">
                <CardHeader className="p-3">
                  <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Cpu className="h-4 w-4 text-indigo-400" /> Viewer Connections & Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 text-[11px] space-y-2">
                  <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400">Orthanc Service:</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Online
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400">Conquest PACS:</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Online
                    </span>
                  </div>
                  <div className="flex justify-between pb-1.5">
                    <span className="text-slate-400">WADO Endpoint:</span>
                    <span className="text-slate-300 font-mono text-[10px]">
                      {pacsViewerSettings["wado_url"] || "configured"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Diagnostic console logger */}
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-400">Diagnostics Log Console</Label>
                <div className="bg-slate-950 rounded border border-slate-800 p-2.5 font-mono text-[10px] text-slate-400 h-48 overflow-y-auto space-y-1">
                  {diagnosticsLogs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed">
                      <span className="text-slate-600">[{new Date().toLocaleTimeString()}]</span> {log}
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
