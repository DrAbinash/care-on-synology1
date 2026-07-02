import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Activity, Clock, AlertTriangle, Cpu, Wifi, Database, Users,
  BarChart3, AlertOctagon, Send, Zap, HardDrive, Gauge, Bell,
  RefreshCw, ShieldCheck, ArrowUpRight, MonitorPlay, Tv2,
  FileEdit, Save, CheckCircle2, ChevronRight, Search, ListCollapse,
  Layers, Settings, FileText, ClipboardList, BookOpen, AlertCircle, Sparkles,
  Star, Check, RotateCcw, ChevronUp, ChevronDown, Wand2, Info,
  Ruler, GitCompare, History as HistoryIcon, BrainCircuit, WandSparkles,
  Pencil, SpellCheck, Repeat2, FileDown, Mic, Heart, Baby, Stethoscope, X, Plus,
  TrendingUp, TrendingDown, Minus
} from "lucide-react";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import ChocolateBoxPanel, { type ChocolateFinding } from "@/components/ChocolateBoxPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import {
  observeReportText,
  getSmartReminders,
  getChecklist,
  comparePriorMetrics,
  type ChecklistItem,
  type CoPilotSuggestion
} from "@/lib/radiologyCoPilotEngine";
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

interface InspectorIssue {
  id: string;
  category: "consistency" | "measurement" | "completeness" | "cds" | "priors" | "voice" | "style";
  severity: "critical" | "important" | "suggestion";
  title: string;
  message: string;
  suggestion?: string;
  field?: "technique" | "findings" | "impression" | "recommendation" | "clinicalHistory";
  reviewed?: boolean;
}

class ErrorBoundary extends React.Component<
  { fallback?: React.ReactNode; children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { fallback?: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(err: any) { return { hasError: true, error: err?.message || "Unknown error" }; }
  componentDidCatch(error: any, info: any) { console.error("Cockpit Error:", error, info?.componentStack); }
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 bg-slate-900 text-slate-100">
          <AlertCircle size={40} className="text-amber-500" />
          <h2 className="text-xl font-bold text-slate-100">Cockpit Panel Error</h2>
          <p className="text-sm text-slate-400 max-w-md text-center">
            A panel error occurred. Your session is still active. Click below to reload the cockpit.
          </p>
          <p className="text-xs text-slate-500 font-mono bg-slate-800 px-3 py-1 rounded">{this.state.error}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: "" })}
            className="mt-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg"
          >
            Reload Cockpit
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Top-level cockpit wrapper — renders the cockpit inside a fault-tolerant boundary.
// If the cockpit itself crashes (React error), this shows a recovery screen
// instead of a blank page or portal redirect.
export default function RadiologistCockpitPage() {
  return (
    <ErrorBoundary>
      <RadiologistCockpit />
    </ErrorBoundary>
  );
}

function RadiologistCockpit() {

  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  // Active study state
  const [activeStudyId, setActiveStudyId] = useState<number | null>(null);

  // Pagination for worklist
  const [visibleWorklistCount, setVisibleWorklistCount] = useState(30);

  // Form Editor state
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [impression, setImpression] = useState<string[]>([""]);
  const [recommendation, setRecommendation] = useState("Please correlate with clinical findings.");

  // Debounced states for heavy calculations
  const [debouncedFindings, setDebouncedFindings] = useState("");
  const [debouncedImpression, setDebouncedImpression] = useState<string[]>([]);
  const [debouncedHistory, setDebouncedHistory] = useState("");
  const [debouncedTechnique, setDebouncedTechnique] = useState("");
  const [debouncedRecommendation, setDebouncedRecommendation] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebouncedFindings(rawFindings), 1000);
    return () => clearTimeout(h);
  }, [rawFindings]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedImpression(impression), 1000);
    return () => clearTimeout(h);
  }, [impression]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedHistory(clinicalHistory), 1000);
    return () => clearTimeout(h);
  }, [clinicalHistory]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedTechnique(technique), 1000);
    return () => clearTimeout(h);
  }, [technique]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedRecommendation(recommendation), 1000);
    return () => clearTimeout(h);
  }, [recommendation]);



  // Search & Filter for sidebar worklist
  const [searchQuery, setSearchQuery] = useState("");
  const [modalityFilter, setModalityFilter] = useState("all");

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

  // Workflow tracking states
  const [viewerLaunched, setViewerLaunched] = useState(false);
  const [priorsCompared, setPriorsCompared] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState("assist");
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [lastVoiceCommand, setLastVoiceCommand] = useState("");
  const [measurementCalcs, setMeasurementCalcs] = useState<Record<string, any>>({});
  const [ignoredIssueIds, setIgnoredIssueIds] = useState<string[]>([]);
  const [reviewedIssueIds, setReviewedIssueIds] = useState<string[]>([]);

  const handleMeasurementsApplied = useCallback((text: string, calcs: Record<string, any>) => {
    setMeasurementCalcs(calcs);
    setRawFindings((prev) => {
      const parts = prev.split("MEASUREMENTS LOG:");
      const base = parts[0].trim();
      return base ? base + "\n\n" + text : text;
    });

    setImpression((prev) => {
      const next = [...prev.filter(Boolean)];
      if (calcs.tumorVolume && calcs.tumorVolume > 10) {
        const item = `Large space-occupying lesion with volume of ${calcs.tumorVolume} cc.`;
        if (!next.includes(item)) next.push(item);
      }
      if (calcs.evansIndex && calcs.evansIndex > 0.3) {
        const item = `Evans Index is ${calcs.evansIndex}, consistent with ventriculomegaly/hydrocephalus.`;
        if (!next.includes(item)) next.push(item);
      }
      if (calcs.slipPct && calcs.slipPct > 25) {
        const item = `Spondylolisthesis (${calcs.slipGrade}).`;
        if (!next.includes(item)) next.push(item);
      }
      if (calcs.efw) {
        const item = `Estimated Fetal Weight is ${calcs.efw} g.`;
        if (!next.includes(item)) next.push(item);
      }
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  // 1. PACS Worklist
  const { data: worklist = [], isLoading: worklistLoading, refetch: refetchWorklist } = useQuery<WorklistEntry[]>({
    queryKey: ["radiology-pacs-worklist"],
    queryFn: () => api.get<WorklistEntry[]>("/api/radiology/pacs-worklist"),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  // 2. Active Study Details — uses internal endpoint, accepts staff auth
  // throwOnError: false — do NOT throw unhandled rejection; show graceful UI instead
  // retry: false — do NOT retry on 401 (would just spam failures)
  const { data: study, isLoading: studyLoading, isError: studyError } = useQuery<WorklistEntry>({
    queryKey: ["workspace-entry", activeStudyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${activeStudyId}`),
    enabled: activeStudyId !== null,
    staleTime: 60000,
    retry: false,
    throwOnError: false,
  });

  // 3. Structured Templates Library
  const { data: templates = [] } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get<StructuredTemplate[]>("/api/radiology/structured-report-templates"),
    staleTime: 300000,
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
    staleTime: 300000,
  });

  // 5. Patient's Prior Reports
  const activePatientId = study?.patientId;
  const { data: priorReports = [] } = useQuery<any[]>({
    queryKey: ["patient-prior-reports", activePatientId],
    queryFn: () => api.get<any[]>(`/api/patient-reports/patient/${activePatientId}`),
    enabled: !!activePatientId,
    staleTime: 300000,
  });

  // Viewer Measurements central bridge query
  const { data: viewerMeasurements = [], refetch: refetchViewerMeasurements } = useQuery<any[]>({
    queryKey: ["viewer-measurements", study?.studyInstanceUID],
    queryFn: () => study?.studyInstanceUID
      ? api.get<{ measurements: any[] }>(`/api/radiology-lesions/viewer-measurements?studyInstanceUID=${study.studyInstanceUID}`).then(res => res.measurements)
      : Promise.resolve([]),
    enabled: !!study?.studyInstanceUID,
    staleTime: 5000,
  });

  // Historical measurements for prior comparison
  const { data: historicalMeasurements = [] } = useQuery<any[]>({
    queryKey: ["historical-measurements", activePatientId],
    queryFn: () => activePatientId
      ? api.get<{ measurements: any[] }>(`/api/radiology-lesions/measurements?patientId=${activePatientId}`).then(res => res.measurements)
      : Promise.resolve([]),
    enabled: !!activePatientId,
    staleTime: 300000,
  });

  // Mutation to update status (Import / Ignore) of a single measurement
  const updateViewerMeasurementMutation = useMutation({
    mutationFn: async ({ id, status, value, unit }: { id: number; status?: string; value?: string; unit?: string }) => {
      return api.patch(`/api/radiology-lesions/viewer-measurements/${id}`, { status, value, unit });
    },
    onSuccess: () => {
      refetchViewerMeasurements();
      toast({ title: "Measurement updated successfully." });
    }
  });

  // Mutation to bulk-import all pending measurements
  const importAllMeasurementsMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      return api.post(`/api/radiology-lesions/viewer-measurements/import-all`, { ids });
    },
    onSuccess: () => {
      refetchViewerMeasurements();
      toast({ title: "All measurements imported." });
    }
  });

  // AI Co-Pilot State
  const [userProfile, setUserProfile] = useState<{
    ignoredWarnings: string[];
    favoriteTemplates: string[];
    favoriteChocolateBox: string[];
  }>({ ignoredWarnings: [], favoriteTemplates: [], favoriteChocolateBox: [] });

  const [copilotChecklist, setCopilotChecklist] = useState<ChecklistItem[]>([]);

  // Fetch Co-Pilot Profile
  const { data: copilotProfileData } = useQuery<{ profile: any }, Error>({
    queryKey: ["radiology-copilot-profile"],
    queryFn: () => api.get<{ profile: any }>("/api/radiology-copilot/profile"),
    staleTime: 300000,
  });

  useEffect(() => {
    if (copilotProfileData?.profile) {
      setUserProfile({
        ignoredWarnings: copilotProfileData.profile.ignoredWarnings || [],
        favoriteTemplates: copilotProfileData.profile.favoriteTemplates || [],
        favoriteChocolateBox: copilotProfileData.profile.favoriteChocolateBox || [],
      });
    }
  }, [copilotProfileData]);

  // Mutation to log dismissal / acceptance
  const logCopilotActionMutation = useMutation({
    mutationFn: (args: { suggestionType: string; suggestionContent: string; action: "dismissed" | "accepted" }) =>
      api.post("/api/radiology-copilot/log", {
        studyInstanceUID: study?.studyInstanceUID || undefined,
        ...args,
      }),
  });

  // Mutation to update profile (ignored warnings)
  const updateCopilotProfileMutation = useMutation({
    mutationFn: (updates: Partial<typeof userProfile>) =>
      api.patch("/api/radiology-copilot/profile", updates),
    onSuccess: (data: { profile: any }) => {
      if (data.profile) {
        setUserProfile({
          ignoredWarnings: data.profile.ignoredWarnings || [],
          favoriteTemplates: data.profile.favoriteTemplates || [],
          favoriteChocolateBox: data.profile.favoriteChocolateBox || [],
        });
      }
    },
  });

  // Checklist initialization
  useEffect(() => {
    if (study) {
      const items = getChecklist(study.modality, study.studyDescription || "");
      setCopilotChecklist(items);
    }
  }, [study]);

  // Live observations
  const coPilotSuggestions = useMemo(() => {
    if (!study) return [];
    const obs = observeReportText(study.modality, study.studyDescription || "", debouncedFindings + " " + debouncedImpression.join(" "));
    const reminders = getSmartReminders(study.modality, study.studyDescription || "");
    const combined = [...obs, ...reminders];
    return combined.filter((s) => !userProfile.ignoredWarnings.includes(s.id));
  }, [study, debouncedFindings, debouncedImpression, userProfile.ignoredWarnings]);

  // Prior comparisons
  const coPilotPriorComparisonMetrics = useMemo(() => {
    if (priorReports.length === 0) return [];
    const prior = priorReports[0];
    const prevData: Record<string, string | number> = {
      measurement: prior.findings?.includes("measures") ? 12 : 10,
      birads: prior.impression?.includes("BI-RADS 3") ? "3" : prior.impression?.includes("BI-RADS 4") ? "4" : "2",
      lesionCount: 2,
    };
    const currentData: Record<string, string | number> = {
      measurement: debouncedFindings.includes("15 mm") ? 15 : debouncedFindings.includes("12 mm") ? 12 : 10,
      birads: debouncedImpression.join(" ").includes("BI-RADS 4") ? "4" : "2",
      lesionCount: debouncedFindings.includes("Multiple") || debouncedFindings.includes("three") ? 3 : 2,
    };
    return comparePriorMetrics(prevData, currentData);
  }, [priorReports, debouncedFindings, debouncedImpression]);

  const handleVoiceIntent = (intent: string) => {
    toast({ title: "Voice Command", description: `Intent: ${intent}` });
    if (intent === "compare-previous") {
      handleAutoCompare();
      setActiveRightTab("copilot");
    } else if (intent === "show-measurements") {
      setActiveRightTab("builders");
    } else if (intent === "insert-tumor-volume") {
      const vol = measurementCalcs.tumorVolume || 15;
      const txt = `Tumor volume calculated at approximately ${vol} cc.`;
      setRawFindings(prev => prev ? prev + "\n" + txt : txt);
    } else if (intent === "open-previous-mri") {
      handleLaunchOhif();
    } else if (intent === "show-spectroscopy") {
      setActiveRightTab("copilot");
    }
  };

  // Prior Comparison Engine (Phase 7)
  const priorComparisonMetrics = useMemo(() => {
    const list: Array<{ label: string; current: string; previous: string; changePercent: number; diff: number; direction: "growth" | "regression" | "stable" }> = [];
    if (!historicalMeasurements || historicalMeasurements.length === 0 || viewerMeasurements.length === 0) return list;

    // Filter historical measurements that are NOT from the current study
    const priorMeasures = historicalMeasurements.filter((m: any) => m.studyId !== study?.studyId);
    const importedViewerMeasures = viewerMeasurements.filter((m: any) => m.status === "imported");

    importedViewerMeasures.forEach((curr: any) => {
      // Find a matching prior measurement with the same label/type
      const prev = priorMeasures.find((p: any) => p.label.toLowerCase() === curr.measurementType.toLowerCase() || p.measurementType.toLowerCase() === curr.measurementType.toLowerCase());
      if (prev) {
        const currVal = parseFloat(curr.value);
        const prevVal = parseFloat(prev.value);
        if (!isNaN(currVal) && !isNaN(prevVal) && prevVal > 0) {
          const diff = currVal - prevVal;
          const pct = Math.round((diff / prevVal) * 100);
          list.push({
            label: curr.measurementType,
            current: `${currVal} ${curr.unit}`,
            previous: `${prevVal} ${prev.unit || curr.unit}`,
            changePercent: pct,
            diff: Math.round(diff * 10) / 10,
            direction: pct > 0 ? "growth" : pct < 0 ? "regression" : "stable",
          });
        }
      }
    });

    return list;
  }, [historicalMeasurements, viewerMeasurements, study]);


  // 6. Global Institutional Style Settings
  const { data: styleSetting } = useQuery<any>({
    queryKey: ["institutional-style"],
    queryFn: () => api.get("/api/radiology/institutional-style"),
    staleTime: 300000,
  });

  // 6. User Preferences (macros, templates)
  const { data: preferences } = useQuery<any>({
    queryKey: ["user-report-preferences"],
    queryFn: () => api.get<any>("/api/radiology/user-report-preferences"),
    enabled: !!session?.user?.id,
    staleTime: 300000,
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
  // AI QUALITY INSPECTOR & CLINICAL RULES ENGINE
  // ══════════════════════════════════════════════════════════════════════════
  const aiInspectorResults = useMemo(() => {
    const issues: InspectorIssue[] = [];
    if (!study) {
      return {
        issues,
        score: {
          overall: 100,
          medical: 100,
          measurement: 100,
          completeness: 100,
          comparison: 100,
          grammar: 100,
          recommendation: 100
        }
      };
    }

    const textFindings = debouncedFindings || "";
    const textImpression = (debouncedImpression || []).filter(Boolean).join("\n");
    const fullText = (debouncedHistory + " " + debouncedTechnique + " " + textFindings + " " + textImpression + " " + debouncedRecommendation).trim();
    const fullTextLower = fullText.toLowerCase();

    // Parse measurement values from findings
    const parsedValues: Record<string, string> = {};
    textFindings.split("\n").forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("- ") && trimmed.includes(":")) {
        const parts = trimmed.substring(2).split(":");
        const key = parts[0].trim();
        const val = parts.slice(1).join(":").trim();
        parsedValues[key] = val;
      }
    });

    // ── 1. MEDICAL CONSISTENCY ──
    const studyDesc = (study.studyDescription || "").toUpperCase();

    // Left/Right contradictions
    if (studyDesc.includes("LEFT") && fullTextLower.includes("right") && !fullTextLower.includes("left")) {
      issues.push({
        id: "med-lateral-desc-mismatch",
        category: "consistency",
        severity: "critical",
        title: "Laterality Contradiction",
        message: "Study description specifies LEFT, but report text only mentions RIGHT.",
        suggestion: "Verify laterality and change findings to Left.",
        field: "findings"
      });
    }
    if (studyDesc.includes("RIGHT") && fullTextLower.includes("left") && !fullTextLower.includes("right")) {
      issues.push({
        id: "med-lateral-desc-mismatch-2",
        category: "consistency",
        severity: "critical",
        title: "Laterality Contradiction",
        message: "Study description specifies RIGHT, but report text only mentions LEFT.",
        suggestion: "Verify laterality and change findings to Right.",
        field: "findings"
      });
    }

    const structures = ["femur", "knee", "meniscus", "lung", "kidney", "breast", "ovary", "adrenal", "shoulder", "hip"];
    structures.forEach(s => {
      const regexLeft = new RegExp(`\\bleft\\b.*\\b${s}\\b`, "i");
      const regexRight = new RegExp(`\\bright\\b.*\\b${s}\\b`, "i");
      if (regexLeft.test(fullText) && regexRight.test(fullText)) {
        issues.push({
          id: `med-lateral-${s}`,
          category: "consistency",
          severity: "important",
          title: `Laterality Warning: ${s}`,
          message: `Both left and right mentions of '${s}' are present. Ensure no contradiction.`,
          suggestion: `Confirm if the finding is bilateral or unilateral.`,
          field: "findings"
        });
      }
    });

    // Upper/Lower, Anterior/Posterior
    if (fullTextLower.includes("anterior protrusion") && fullTextLower.includes("posterior protrusion")) {
      issues.push({
        id: "med-ant-post-spinal",
        category: "consistency",
        severity: "important",
        title: "Anterior / Posterior Direction Mismatch",
        message: "Report mentions both anterior and posterior protrusions in similar segments.",
        suggestion: "Verify primary protrusion direction on sagittal view.",
        field: "findings"
      });
    }

    // Gender contradictions
    const isFemale = study.sex?.toUpperCase() === "F";
    const isMale = study.sex?.toUpperCase() === "M";
    if (isFemale && (fullTextLower.includes("prostate") || fullTextLower.includes("seminal vesicle"))) {
      issues.push({
        id: "med-gender-prostate",
        category: "consistency",
        severity: "critical",
        title: "Gender Contradiction",
        message: "Report for Female patient mentions male anatomy (prostate/seminal vesicle).",
        suggestion: "Remove prostate/seminal vesicle references.",
        field: "findings"
      });
    }
    if (isMale && (fullTextLower.includes("uterus") || fullTextLower.includes("ovary") || fullTextLower.includes("ovarian") || fullTextLower.includes("endometrium") || fullTextLower.includes("cervix") || fullTextLower.includes("uterine"))) {
      issues.push({
        id: "med-gender-uterus",
        category: "consistency",
        severity: "critical",
        title: "Gender Contradiction",
        message: "Report for Male patient mentions female anatomy (uterus/ovary/endometrium/cervix).",
        suggestion: "Remove gynecological references.",
        field: "findings"
      });
    }

    // Pediatric vs Adult Case
    const ageMatch = (study.age || "").match(/(\d+)/);
    const ageVal = ageMatch ? parseInt(ageMatch[1]) : null;
    const isPediatric = ageVal !== null && ageVal < 18;
    if (isPediatric) {
      if (fullTextLower.includes("degenerative changes") || fullTextLower.includes("senile") || fullTextLower.includes("osteoarthritis")) {
        issues.push({
          id: "med-pediatric-adult-wording",
          category: "consistency",
          severity: "important",
          title: "Age-Inappropriate Wording",
          message: `Pediatric patient (${study.age}) described using adult degenerative terms.`,
          suggestion: "Use age-appropriate description.",
          field: "findings"
        });
      }
    } else if (ageVal !== null && ageVal > 18) {
      if (fullTextLower.includes("growth plates open") || fullTextLower.includes("physes open")) {
        issues.push({
          id: "med-adult-pediatric-wording",
          category: "consistency",
          severity: "important",
          title: "Age-Inappropriate Wording",
          message: `Adult patient (${study.age}) described with pediatric phrasing (e.g., open growth plates).`,
          suggestion: "Replace with bone maturity status or remove.",
          field: "findings"
        });
      }
    }

    // Wrong modality wording
    if (study.modality === "CT") {
      if (fullTextLower.includes("magnetic resonance") || fullTextLower.includes("flair") || fullTextLower.includes("t1-weighted") || fullTextLower.includes("t2-weighted") || fullTextLower.includes("signal intensity")) {
        issues.push({
          id: "med-modality-ct-mri",
          category: "consistency",
          severity: "critical",
          title: "Modality Terminology Mismatch",
          message: "MRI terminology (FLAIR, T1/T2 weighted, signal intensity) found inside CT report.",
          suggestion: "Replace with CT terminology (attenuation, Hounsfield units).",
          field: "technique"
        });
      }
    }
    if (study.modality === "MRI") {
      const hasHU = /\bhu\b/.test(fullTextLower);
      if (hasHU || fullTextLower.includes("hounsfield") || fullTextLower.includes("computed tomography") || fullTextLower.includes("radiation dose")) {
        issues.push({
          id: "med-modality-mri-ct",
          category: "consistency",
          severity: "critical",
          title: "Modality Terminology Mismatch",
          message: "CT terminology (HU, Hounsfield, computed tomography) found inside MRI report.",
          suggestion: "Replace with MRI terminology (signal intensity, sequences).",
          field: "technique"
        });
      }
    }
    if (study.modality === "CT" || study.modality === "MRI") {
      if (fullTextLower.includes("hyperechoic") || fullTextLower.includes("anechoic") || fullTextLower.includes("acoustic shadowing") || fullTextLower.includes("transducer")) {
        issues.push({
          id: "med-modality-cross-us",
          category: "consistency",
          severity: "important",
          title: "Modality Terminology Mismatch",
          message: "Ultrasound wording (hyperechoic, acoustic shadowing) found inside cross-sectional report.",
          suggestion: "Replace with density/signal intensity wording.",
          field: "findings"
        });
      }
    }

    // Contrast contradictions
    const isContrastStudy = studyDesc.includes("CONTRAST") || studyDesc.includes("CECT") || studyDesc.includes("CEMRI");
    const isNonContrastStudy = studyDesc.includes("WITHOUT CONTRAST") || studyDesc.includes("NCCT") || studyDesc.includes("NON-CONTRAST");
    if (isNonContrastStudy && (fullTextLower.includes("gadolinium") || fullTextLower.includes("contrast enhancement") || fullTextLower.includes("post-contrast"))) {
      issues.push({
        id: "med-contrast-noncon-mismatch",
        category: "consistency",
        severity: "important",
        title: "Contrast Contradiction",
        message: "Non-contrast study mentions contrast enhancement or gadolinium.",
        suggestion: "Remove enhancement/agent references.",
        field: "findings"
      });
    }
    if (isContrastStudy && (fullTextLower.includes("no contrast was administered") || fullTextLower.includes("non-contrast study"))) {
      issues.push({
        id: "med-contrast-con-mismatch",
        category: "consistency",
        severity: "important",
        title: "Contrast Contradiction",
        message: "Contrast study mentions no contrast was administered.",
        suggestion: "Update technique section with contrast injection parameters.",
        field: "technique"
      });
    }

    // Findings vs Impression mismatch
    const normalKeywords = ["no abnormality", "within normal limits", "unremarkable"];
    const hasNormalFindings = normalKeywords.some(kw => textFindings.toLowerCase().includes(kw));
    const abnormalKeywords = ["acute infarct", "fracture", "hemorrhage", "stenosis", "mass", "lesion", "metastasis"];
    const hasAbnormalImpression = abnormalKeywords.some(kw => textImpression.toLowerCase().includes(kw));
    if (hasNormalFindings && hasAbnormalImpression) {
      issues.push({
        id: "med-normal-findings-abnormal-imp",
        category: "consistency",
        severity: "important",
        title: "Findings / Impression Contradiction",
        message: "Findings show normal/unremarkable status, but Impression lists abnormal diagnosis.",
        suggestion: "Detail abnormal observations inside the Findings section.",
        field: "impression"
      });
    }

    const abnormalFindingsKeywords = ["herniation", "fracture", "hemorrhage", "lesion", "infarct", "stenosis"];
    const hasAbnormalFindings = abnormalFindingsKeywords.some(kw => textFindings.toLowerCase().includes(kw));
    const normalImpressionKeywords = ["no significant abnormality", "normal study", "unremarkable exam"];
    const hasNormalImpression = normalImpressionKeywords.some(kw => textImpression.toLowerCase().includes(kw));
    if (hasAbnormalFindings && hasNormalImpression) {
      issues.push({
        id: "med-abnormal-findings-normal-imp",
        category: "consistency",
        severity: "important",
        title: "Findings / Impression Contradiction",
        message: "Findings mention abnormalities, but Impression describes study as normal/unremarkable.",
        suggestion: "Summarize major findings inside the Impression section.",
        field: "impression"
      });
    }

    // ── 2. MEASUREMENT CONSISTENCY ──
    const hasDiscProtrusion = textFindings.toLowerCase().includes("protrusion") || textFindings.toLowerCase().includes("extrusion") || textFindings.toLowerCase().includes("herniation");
    if (study.modality === "MRI" && (studyDesc.includes("SPINE") || studyDesc.includes("LUMBAR"))) {
      if (hasDiscProtrusion && !fullTextLower.includes("ap canal diameter")) {
        issues.push({
          id: "meas-spine-canal-diameter",
          category: "measurement",
          severity: "critical",
          title: "Missing Canal Diameter",
          message: "Disc protrusion/herniation is noted, but AP Spinal Canal Diameter is missing.",
          suggestion: "Add AP Canal Diameter to verify spinal stenosis status.",
          field: "findings"
        });
      }
    }
    if (study.modality === "US" && studyDesc.includes("OBSTETRIC")) {
      if (!fullTextLower.includes("bpd") && !fullTextLower.includes("fl") && !fullTextLower.includes("crl")) {
        issues.push({
          id: "meas-ob-biometry",
          category: "measurement",
          severity: "critical",
          title: "Missing Fetal Biometry",
          message: "Obstetric USG is missing fetal biometry metrics (CRL/BPD/FL).",
          suggestion: "Record BPD/FL or CRL measurements to estimate gestational age.",
          field: "findings"
        });
      }
    }
    if (fullTextLower.includes("hydrocephalus") || fullTextLower.includes("ventriculomegaly")) {
      if (!fullTextLower.includes("evans index") && !fullTextLower.includes("frontal horn")) {
        issues.push({
          id: "meas-brain-evans",
          category: "measurement",
          severity: "important",
          title: "Missing Evans Index",
          message: "Hydrocephalus/ventriculomegaly mentioned, but Evans Index or Frontal Horn Width is missing.",
          suggestion: "Add Evans Index to quantify ventriculomegaly.",
          field: "findings"
        });
      }
    }
    if (study.modality === "MG" && (studyDesc.includes("BREAST") || studyDesc.includes("MAMMOGRAPHY"))) {
      if (!fullTextLower.includes("bi-rads")) {
        issues.push({
          id: "meas-mg-birads",
          category: "measurement",
          severity: "critical",
          title: "Missing BI-RADS Score",
          message: "Mammography study is missing the BI-RADS Category score.",
          suggestion: "Specify a BI-RADS category rating (e.g., BI-RADS Category 1-6).",
          field: "impression"
        });
      }
      if (!fullTextLower.includes("density")) {
        issues.push({
          id: "meas-mg-density",
          category: "measurement",
          severity: "important",
          title: "Missing Breast Density",
          message: "Mammography is missing Breast Density category.",
          suggestion: "Specify Breast Density (e.g. ACR Category A-D).",
          field: "findings"
        });
      }
    }

    // ── 3. REPORT COMPLETENESS ──
    if (!technique.trim()) {
      issues.push({
        id: "comp-technique",
        category: "completeness",
        severity: "important",
        title: "Missing Section: Technique",
        message: "Technique/protocol section is empty.",
        suggestion: "Add the scanner model, views, and sequences protocol.",
        field: "technique"
      });
    }
    if (!clinicalHistory.trim()) {
      issues.push({
        id: "comp-clinicalHistory",
        category: "completeness",
        severity: "important",
        title: "Missing Section: Indication",
        message: "Clinical history/indication section is empty.",
        suggestion: "Provide referral symptoms or clinical query.",
        field: "clinicalHistory"
      });
    }
    if (textFindings.trim().length < 15) {
      issues.push({
        id: "comp-findings",
        category: "completeness",
        severity: "critical",
        title: "Missing Section: Findings",
        message: "Findings details are empty or too short.",
        suggestion: "Add detailed clinical observations.",
        field: "findings"
      });
    }
    if (impression.filter(Boolean).length === 0) {
      issues.push({
        id: "comp-impression",
        category: "completeness",
        severity: "critical",
        title: "Missing Section: Impression",
        message: "Diagnostic Impression summary is empty.",
        suggestion: "Add your main diagnostic conclusions.",
        field: "impression"
      });
    }

    // Duplicate sentences
    const sList = textFindings.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 12);
    const seenS = new Set<string>();
    sList.forEach(s => {
      const normalized = s.toLowerCase().replace(/\s+/g, " ");
      if (seenS.has(normalized)) {
        issues.push({
          id: `comp-dup-${normalized.slice(0, 15)}`,
          category: "completeness",
          severity: "suggestion",
          title: "Duplicate Sentence Detected",
          message: `The sentence starting with "${s.slice(0, 25)}..." is duplicated.`,
          suggestion: "Remove duplicate text.",
          field: "findings"
        });
      } else {
        seenS.add(normalized);
      }
    });

    // ── 4. CLINICAL DECISION SUPPORT (CDS) ──
    if (fullTextLower.includes("tumor") || fullTextLower.includes("lesion") || fullTextLower.includes("mass")) {
      if (study.modality === "MRI" && !fullTextLower.includes("spectroscopy") && !fullTextLower.includes("perfusion")) {
        issues.push({
          id: "cds-brain-tumor",
          category: "cds",
          severity: "suggestion",
          title: "CDS: MR Spectroscopy",
          message: "For cerebral lesions, Spectroscopy or Perfusion adds characterization value.",
          suggestion: "Recommend: 'MR Spectroscopy and Perfusion correlation suggested.'",
          field: "recommendation"
        });
      }
    }
    if (fullTextLower.includes("infarct") || fullTextLower.includes("stroke") || fullTextLower.includes("ischemia")) {
      if (!fullTextLower.includes("mra") && !fullTextLower.includes("cta")) {
        issues.push({
          id: "cds-stroke",
          category: "cds",
          severity: "suggestion",
          title: "CDS: Vascular Angiography",
          message: "Vascular patency imaging is standard for cerebral ischemia.",
          suggestion: "Recommend: 'MRA or CTA of the head and neck is suggested.'",
          field: "recommendation"
        });
      }
    }

    // ── 5. PRIOR STUDY COMPARISON ──
    if (priorReports.length > 0) {
      const compKeywords = ["comparison", "prior", "compared", "previously", "previous study", "stable", "interval", "no significant interval change"];
      const hasComparison = compKeywords.some(kw => fullTextLower.includes(kw));
      if (!hasComparison) {
        issues.push({
          id: "prior-no-comparison",
          category: "priors",
          severity: "important",
          title: "Prior Comparison Missing",
          message: "Prior reports exist, but comparison or interval change is not described.",
          suggestion: "Add interval wording (Stable, Improved, Progressed, Resolved).",
          field: "findings"
        });
      }
    }

    // ── 6. VOICE DICTATION CLEANUP ──
    const voiceWords = textFindings.split(/\s+/);
    for (let i = 0; i < voiceWords.length - 1; i++) {
      const w1 = voiceWords[i].toLowerCase().replace(/[^a-z]/g, "");
      const w2 = voiceWords[i+1].toLowerCase().replace(/[^a-z]/g, "");
      if (w1 && w1 === w2 && w1.length > 2) {
        issues.push({
          id: `voice-duplicate-word-${i}`,
          category: "voice",
          severity: "suggestion",
          title: "Repeated Word",
          message: `Repeated word '${voiceWords[i]}' detected in findings.`,
          suggestion: `Remove the second '${voiceWords[i]}'.`,
          field: "findings"
        });
      }
    }

    // ── 7. INSTITUTIONAL STYLE CHECKS ──
    if (styleSetting) {
      if (styleSetting.showClinicalHistory && !clinicalHistory.trim()) {
        issues.push({
          id: "style-missing-history",
          category: "style",
          severity: "important",
          title: "Required Section Missing: Clinical History",
          message: "Institutional style requires the Clinical History section to be present.",
          suggestion: "Please provide clinical history context.",
          field: "clinicalHistory"
        });
      }
      if (styleSetting.showComparison && !priorsCompared && priorReports.length > 0) {
        issues.push({
          id: "style-missing-comparison",
          category: "style",
          severity: "important",
          title: "Required Section Missing: Comparison",
          message: "Institutional style requires a Comparison section when prior studies exist.",
          suggestion: "Please document comparison with prior studies.",
          field: "findings"
        });
      }
      if (styleSetting.showRecommendation && !recommendation.trim()) {
        issues.push({
          id: "style-missing-recommendation",
          category: "style",
          severity: "important",
          title: "Required Section Missing: Recommendation",
          message: "Institutional style requires a Recommendation section.",
          suggestion: "Please add diagnostic recommendations or correlations.",
          field: "recommendation"
        });
      }
      if (styleSetting.showCriticalCommunication && isCritical && !checklistComm.phoned) {
        issues.push({
          id: "style-missing-critical-comm",
          category: "style",
          severity: "critical",
          title: "Style Rule: Critical Alert Not Documented",
          message: "For critical findings, the hospital style requires documenting the phoned/dispatch status.",
          suggestion: "Check the phoned/annotated checkbox in Checklist Communication.",
          field: "findings"
        });
      }
      if (styleSetting.showMeasurements && Object.keys(measurementCalcs).length === 0 && (studyDesc.includes("SPINE") || studyDesc.includes("OB") || studyDesc.includes("BRAIN"))) {
        issues.push({
          id: "style-missing-measurements",
          category: "style",
          severity: "important",
          title: "Required Section Missing: Measurements",
          message: "Institutional style requires measurements block for this study type.",
          suggestion: "Launch Measurement Assistant to record values.",
          field: "findings"
        });
      }

      if (styleSetting.headingStyle === "bold" || styleSetting.headingStyle === "bold_underlined") {
        const hasUnboldedHeadings = /^[A-Z][a-z]+:\s*$/m.test(textFindings);
        if (hasUnboldedHeadings) {
          issues.push({
            id: "style-unbolded-headings",
            category: "style",
            severity: "suggestion",
            title: "Style Rule: Unbolded Headings",
            message: "Headings inside report text should be bolded as per style settings.",
            suggestion: "Prefix heading lines with '**' (e.g. **Findings**).",
            field: "findings"
          });
        }
      }

      if (styleSetting.spacing === "compact") {
        if (textFindings.includes("\n\n\n")) {
          issues.push({
            id: "style-excessive-spacing",
            category: "style",
            severity: "suggestion",
            title: "Style Rule: Excessive Spacing",
            message: "Compact style setting is active, but excessive consecutive line breaks were found.",
            suggestion: "Reduce spacing between paragraphs.",
            field: "findings"
          });
        }
      } else if (styleSetting.spacing === "comfortable") {
        if (textFindings.length > 50 && !textFindings.includes("\n\n")) {
          issues.push({
            id: "style-cramped-spacing",
            category: "style",
            severity: "suggestion",
            title: "Style Rule: Cramped Spacing",
            message: "Comfortable style is active, but findings have no paragraph breaks.",
            suggestion: "Add double line breaks to split text paragraphs.",
            field: "findings"
          });
        }
      }

      if (styleSetting.abnormalEmphasis === "bold_abnormal" || styleSetting.abnormalEmphasis === "bold_both") {
        const hasAbnormalKeywords = abnormalKeywords.some(kw => textFindings.toLowerCase().includes(kw));
        const hasBoldMarkdown = textFindings.includes("**") || textFindings.includes("<b>");
        if (hasAbnormalKeywords && !hasBoldMarkdown) {
          issues.push({
            id: "style-unbolded-abnormalities",
            category: "style",
            severity: "important",
            title: "Style Rule: Abnormalities Not Bolded",
            message: "Institutional style requires abnormal findings to be bolded.",
            suggestion: "Use bold formatting for diagnostic abnormalities.",
            field: "findings"
          });
        }
      }

      if (styleSetting.abnormalEmphasis === "bold_impression" || styleSetting.abnormalEmphasis === "bold_both") {
        const hasImpressionText = textImpression.trim().length > 0;
        const hasBoldImpression = textImpression.includes("**") || textImpression.includes("<b>");
        if (hasImpressionText && !hasBoldImpression) {
          issues.push({
            id: "style-unbolded-impression",
            category: "style",
            severity: "important",
            title: "Style Rule: Impression Points Not Bolded",
            message: "Institutional style requires Impression summary points to be bolded.",
            suggestion: "Use bold formatting for impression points.",
            field: "impression"
          });
        }
      }
    }

    // ── 8. IMPORTED MEASUREMENTS SAFETY (Phase 9) ──
    const importedViewerMeasures = viewerMeasurements.filter((m: any) => m.status === "imported");
    importedViewerMeasures.forEach((m: any) => {
      const valLower = m.value.toLowerCase();
      // 1. Referenced check
      if (!fullTextLower.includes(valLower)) {
        issues.push({
          id: `meas-ref-${m.id}`,
          category: "measurement",
          severity: "critical",
          title: "Imported Measurement Not Referenced",
          message: `Imported measurement (${m.measurementType}: ${m.value} ${m.unit}) is not mentioned anywhere in the report.`,
          suggestion: `Add the measurement value ${m.value} to the findings or impressions, or remove/ignore the measurement.`,
          field: "findings"
        });
      }
      
      // 2. Unit consistency check
      if (fullTextLower.includes(valLower)) {
        const index = fullTextLower.indexOf(valLower);
        const surroundingText = fullTextLower.substring(Math.max(0, index - 20), Math.min(fullTextLower.length, index + valLower.length + 20));
        if (m.unit && !surroundingText.includes(m.unit.toLowerCase())) {
          issues.push({
            id: `meas-unit-mismatch-${m.id}`,
            category: "measurement",
            severity: "important",
            title: "Measurement Unit Discrepancy",
            message: `Imported measurement has unit '${m.unit}' but the report nearby text might use a different or missing unit.`,
            suggestion: `Verify unit consistency in text: ${surroundingText}`,
            field: "findings"
          });
        }
      }
    });

    // Duplicate measurements check
    const seenValues = new Set<string>();
    importedViewerMeasures.forEach((m: any) => {
      const key = `${m.measurementType}-${m.value}-${m.unit}`;
      if (seenValues.has(key)) {
        issues.push({
          id: `meas-dup-${m.id}`,
          category: "measurement",
          severity: "important",
          title: "Duplicate Imported Measurement",
          message: `The measurement value ${m.value} ${m.unit} for '${m.measurementType}' appears to be duplicated.`,
          suggestion: `Verify if this is a duplicate acquisition and ignore one of them.`,
          field: "findings"
        });
      }
      seenValues.add(key);
    });

    // Calculate score details
    let medicalScore = 100;
    let measurementScore = 100;
    let completenessScore = 100;
    let comparisonScore = priorReports.length > 0 ? 50 : 100;
    let grammarScore = 100;
    let styleScore = 100;

    issues.forEach(issue => {
      const isIgnored = ignoredIssueIds.includes(issue.id) || reviewedIssueIds.includes(issue.id);
      if (isIgnored) return;

      if (issue.category === "consistency") {
        medicalScore -= issue.severity === "critical" ? 20 : 10;
      } else if (issue.category === "measurement") {
        measurementScore -= issue.severity === "critical" ? 20 : 10;
      } else if (issue.category === "completeness") {
        completenessScore -= issue.severity === "critical" ? 25 : 10;
      } else if (issue.category === "priors") {
        comparisonScore = 50;
      } else if (issue.category === "voice") {
        grammarScore -= 5;
      } else if (issue.category === "style") {
        styleScore -= issue.severity === "critical" ? 20 : 10;
      }
    });

    medicalScore = Math.max(0, medicalScore);
    measurementScore = Math.max(0, measurementScore);
    completenessScore = Math.max(0, completenessScore);
    grammarScore = Math.max(0, grammarScore);
    styleScore = Math.max(0, styleScore);

    const recommendationsScore = recommendation.trim() ? 100 : 70;
    const overallScore = Math.round(
      (medicalScore + measurementScore + completenessScore + comparisonScore + grammarScore + recommendationsScore + styleScore) / 7
    );

    return {
      issues,
      score: {
        overall: overallScore,
        medical: medicalScore,
        measurement: measurementScore,
        completeness: completenessScore,
        comparison: comparisonScore,
        grammar: grammarScore,
        recommendation: recommendationsScore
      }
    };
  }, [study, debouncedHistory, debouncedTechnique, debouncedFindings, debouncedImpression, debouncedRecommendation, priorReports, ignoredIssueIds, reviewedIssueIds, viewerMeasurements]);


  const qualityCheckIssues = useMemo(() => {
    return aiInspectorResults.issues
      .filter(i => !ignoredIssueIds.includes(i.id) && !reviewedIssueIds.includes(i.id) && (i.severity === "critical" || i.severity === "important"))
      .map(i => `${i.title}: ${i.message}`);
  }, [aiInspectorResults, ignoredIssueIds, reviewedIssueIds]);

  // ══════════════════════════════════════════════════════════════════════════
  // SMART CONTEXT ENGINE
  // ══════════════════════════════════════════════════════════════════════════
  const smartContext = useMemo(() => {
    if (!study) return null;
    const desc = (study.studyDescription || "").toUpperCase();
    const isContrast = desc.includes("CONTRAST") || desc.includes("CECT") || desc.includes("CEMRI") || desc.includes("+C") || desc.includes("CE");
    const isEmergency = desc.includes("EMERGENCY") || desc.includes("TRAUMA") || desc.includes("ACUTE") || study.status === "EMERGENCY";

    let bodyPart = "General";
    if (desc.includes("BRAIN") || desc.includes("HEAD") || desc.includes("SKULL")) bodyPart = "Brain";
    else if (desc.includes("SPINE") || desc.includes("LUMBAR") || desc.includes("CERVICAL") || desc.includes("LS") || desc.includes("DORSAL")) bodyPart = "Spine";
    else if (desc.includes("CHEST") || desc.includes("LUNG") || desc.includes("THORAX")) bodyPart = "Chest";
    else if (desc.includes("BREAST") || desc.includes("MAMMOGRAPHY")) bodyPart = "Breast";
    else if (desc.includes("PELVIS") || desc.includes("PELVIC")) bodyPart = "Pelvis";
    else if (desc.includes("LIVER") || desc.includes("ABDOMEN") || desc.includes("KIDNEY") || desc.includes("RENAL")) bodyPart = "Abdomen";

    return {
      modality: study.modality,
      bodyPart,
      isContrast,
      isEmergency,
      hasPriors: priorReports.length > 0,
      age: study.age ?? "N/A",
      sex: study.sex ?? "N/A",
    };
  }, [study, priorReports]);

  // ══════════════════════════════════════════════════════════════════════════
  // REPORT COMPLETENESS GATE
  // ══════════════════════════════════════════════════════════════════════════
  const completenessDetails = useMemo(() => {
    const checks = {
      technique: !!technique.trim(),
      clinicalHistory: !!clinicalHistory.trim(),
      findings: rawFindings.trim().length >= 15,
      impression: impression.filter(Boolean).length > 0,
      recommendation: !!recommendation.trim(),
    };
    const items = Object.values(checks);
    const completedCount = items.filter(Boolean).length;
    const pct = Math.round((completedCount / items.length) * 100);
    return { checks, pct };
  }, [technique, clinicalHistory, rawFindings, impression, recommendation]);

  // ══════════════════════════════════════════════════════════════════════════
  // WORKFLOW STEPS
  // ══════════════════════════════════════════════════════════════════════════
  const currentStep = useMemo(() => {
    if (!study) return 0;
    if (!viewerLaunched) return 1; // Step 1: Open Viewer
    if (priorReports.length > 0 && !priorsCompared) return 2; // Step 2: Compare Priors
    if (study.aiDraftStatus === "READY" && rawFindings.trim().length < 25) return 3; // Step 3: Check AI Suggestion
    if (completenessDetails.pct < 100) return 4; // Step 4: Dictate & Fill details
    return 5; // Step 5: Finalize
  }, [study, viewerLaunched, priorReports, priorsCompared, completenessDetails.pct, rawFindings]);

  // Auto-switch tabs and load default templates
  useEffect(() => {
    if (!study) return;
    setViewerLaunched(false);
    setPriorsCompared(false);

    // Auto tab selection based on context
    if (study.modality === "US" || study.modality === "USG") {
      setActiveRightTab("builders");
    } else if (study.aiDraftStatus === "READY") {
      setActiveRightTab("assist");
    } else {
      setActiveRightTab("chocolate");
    }

    // Auto-load template if available
    const modalityMap: Record<string, string> = { "X-RAY": "X-RAY", USG: "USG", MRI: "MRI", CT: "CT" };
    const mod = modalityMap[study.modality] || study.modality;
    const bodyPart = (study.studyDescription || "").toUpperCase();
    const match = templates.find((t) => t.modality === mod && (bodyPart.includes(t.bodyPart.toUpperCase()) || t.bodyPart.toUpperCase().includes(bodyPart)));
    if (match) {
      handleApplyTemplate(match);
    }
  }, [study, templates]);

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
        auditDetails: {
          inspectorScore: aiInspectorResults.score,
          issuesCount: aiInspectorResults.issues.length,
          ignoredIssues: ignoredIssueIds,
          reviewedIssues: reviewedIssueIds,
          unresolvedIssues: aiInspectorResults.issues
            .filter(i => !ignoredIssueIds.includes(i.id) && !reviewedIssueIds.includes(i.id))
            .map(i => ({ id: i.id, title: i.title, severity: i.severity }))
        }
      });
    },
    onSuccess: () => {
      toast({ title: "Report Finalized", description: "Report signed and finalized." });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    },
    onError: (e: any) => toast({ title: "Finalization Failed", description: e.message, variant: "destructive" }),
  });

  // Handle finalization submission with completeness gate
  const handleFinalizeClick = () => {
    if (completenessDetails.pct < 100 || qualityCheckIssues.length > 0) {
      setShowWarningModal(true);
    } else {
      finalizeMutation.mutate();
    }
  };

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

  // Auto-select first study on load or URL param
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const urlStudyId = searchParams.get("studyId");
    if (urlStudyId) {
      const numId = parseInt(urlStudyId, 10);
      if (!isNaN(numId) && activeStudyId !== numId) {
        setActiveStudyId(numId);
        return;
      }
    }
    if (!activeStudyId && worklist.length > 0) {
      setActiveStudyId(worklist[0].id);
    }
  }, [worklist, activeStudyId]);

  useEffect(() => {
    setVisibleWorklistCount(30);
  }, [searchQuery, modalityFilter]);

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

  // Initial values for the Measurement Assistant panel, built from imported viewer
  // measurements. IMPORTANT: this must be a top-level hook (not called inline inside
  // the conditionally-rendered "{study && (...)}" JSX block below) — a hook called
  // only when `study` is truthy changes the hook count between renders and triggers
  // React error #310 ("Rendered more hooks than during the previous render").
  const measurementAssistantInitialValues = useMemo(() => {
    const vals: Record<string, string> = {};
    viewerMeasurements
      .filter((m: any) => m.status === "imported")
      .forEach((m: any) => {
        vals[m.measurementType] = m.value;
      });
    return vals;
  }, [viewerMeasurements]);

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
    }, 60000);
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

  // Launch OHIF Viewer — uses the shared smart launcher (same one RadiologyWorklist
  // uses) which auto-detects LAN vs Tailscale vs Public and adapts the URL host
  // accordingly, instead of opening whatever raw host happens to be saved in
  // settings. This fixes OHIF/Weasis failing to open when accessing the ERP over
  // Tailscale from outside the hospital LAN.
  const handleLaunchOhif = () => {
    if (!study || !study.studyInstanceUID) return;
    void launchViewer(study.studyInstanceUID, "OHIF", pacsViewerSettings, toast);
    setViewerLaunched(true);
  };

  // Launch Weasis Viewer — same smart launcher as OHIF above.
  const handleLaunchWeasis = () => {
    if (!study || !study.studyInstanceUID) return;
    void launchViewer(study.studyInstanceUID, "WEASIS", pacsViewerSettings, toast);
    setViewerLaunched(true);
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

  // Smart Previous Studies Auto-Compare Text Generator
  const handleAutoCompare = () => {
    if (priorReports.length === 0) return;
    const prior = priorReports[0];
    const priorDate = prior.createdAt ? prior.createdAt.split("T")[0] : "previous date";
    const priorTitle = prior.title || "prior study";
    const priorImpression = prior.impression ? prior.impression.trim() : "no significant abnormality";

    const comparisonText = `COMPARISON: Compared with prior study dated ${priorDate} for ${priorTitle}.\nInterval Changes: `;
    setRawFindings((prev) => {
      const base = prev ? prev + "\n\n" : "";
      return base + comparisonText;
    });
    setImpression((prev) => {
      const next = [...prev.filter(Boolean)];
      const priorText = `Stable compared to previous findings of: ${priorImpression.split("\n")[0]}`;
      if (!next.includes(priorText)) next.push(priorText);
      return next;
    });
    setPriorsCompared(true);
    toast({ title: "Prior Study Compared", description: "Interval comparison text generated." });
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
              <>
                {filteredWorklist.slice(0, visibleWorklistCount).map((item) => (
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
                ))}
                {filteredWorklist.length > visibleWorklistCount && (
                  <div className="p-2 text-center bg-slate-950/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6 text-indigo-400 hover:text-indigo-300 w-full"
                      onClick={() => setVisibleWorklistCount((prev) => prev + 30)}
                    >
                      Load More Studies ({filteredWorklist.length - visibleWorklistCount} remaining)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Center Column: Editor and Reporting Workspace */}
        <div className="flex-1 flex flex-col bg-slate-900 border-r border-slate-800 overflow-y-auto">
          {studyLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : studyError ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs gap-3 p-8">
              <AlertTriangle className="h-10 w-10 text-amber-500" />
              <span className="text-sm font-semibold text-slate-300">Study details unavailable</span>
              <span className="text-xs text-slate-500 text-center max-w-xs">
                Could not load study data. This may be a temporary server issue.
                Your session is still active. Please click the study again to retry.
              </span>
              <button
                onClick={() => qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] })}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg border border-slate-700"
              >
                Retry
              </button>
            </div>
          ) : !study ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
              <Info className="h-8 w-8 text-slate-600" />
              <span>Select a study from the worklist to start reporting</span>
            </div>

          ) : (
            <div className="p-4 space-y-4">
              {/* SMART CONTEXT ENGINE BANNER */}
              {smartContext && (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex items-center gap-2.5 text-xs flex-wrap">
                  <span className="font-bold text-slate-400">Context:</span>
                  <Badge variant="outline" className="border-indigo-800 text-indigo-400 bg-indigo-950/30 text-[10px]">
                    Body: {smartContext.bodyPart}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${smartContext.isContrast ? "border-purple-800 text-purple-400 bg-purple-950/30" : "border-slate-800 text-slate-400"}`}>
                    {smartContext.isContrast ? "Contrast Study" : "Non-Contrast"}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${smartContext.isEmergency ? "border-red-800 text-red-400 bg-red-950/30 animate-pulse font-bold" : "border-slate-800 text-slate-400"}`}>
                    {smartContext.isEmergency ? "🚨 Emergency Case" : "Routine Case"}
                  </Badge>
                  {smartContext.hasPriors && (
                    <Badge variant="outline" className="border-emerald-800 text-emerald-400 bg-emerald-950/30 text-[10px]">
                      Priors Available ({priorReports.length})
                    </Badge>
                  )}
                </div>
              )}

              {/* SMART WORKFLOW STEPPER */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs pb-1 border-b border-slate-900">
                  <span className="font-bold text-indigo-400">Smart Steps Dashboard</span>
                  {currentStep === 1 && (
                    <Button size="sm" onClick={handleLaunchOhif} className="bg-amber-600 hover:bg-amber-700 h-6 text-[10px] text-white">
                      Suggested Action: Open OHIF Viewer
                    </Button>
                  )}
                  {currentStep === 2 && (
                    <Button size="sm" onClick={handleAutoCompare} className="bg-amber-600 hover:bg-amber-700 h-6 text-[10px] text-white">
                      Suggested Action: Compare Previous Reports
                    </Button>
                  )}
                  {currentStep === 3 && (
                    <Button
                      size="sm"
                      onClick={() => {
                        try {
                          const draft = JSON.parse(study.aiDraftJson!);
                          if (draft.findings) setRawFindings(draft.findings);
                          if (draft.impression) setImpression([draft.impression]);
                          toast({ title: "Draft Applied", description: "AI suggestions loaded." });
                        } catch {}
                      }}
                      className="bg-amber-600 hover:bg-amber-700 h-6 text-[10px] text-white"
                    >
                      Suggested Action: Import AI suggestions
                    </Button>
                  )}
                  {currentStep === 4 && (
                    <span className="text-amber-500 text-[10px] font-bold">Suggested Action: Fill missing report fields</span>
                  )}
                  {currentStep === 5 && (
                    <Button size="sm" onClick={handleFinalizeClick} className="bg-emerald-600 hover:bg-emerald-700 h-6 text-[10px] text-white font-bold">
                      Suggested Action: Finalize & Sign
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5 text-[10px] text-center">
                  <div className={`p-1.5 rounded border ${currentStep >= 1 ? "bg-indigo-950/20 border-indigo-800 text-indigo-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                    1. Study Loaded
                  </div>
                  <div className={`p-1.5 rounded border ${currentStep >= 2 ? "bg-indigo-950/20 border-indigo-800 text-indigo-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                    2. Viewer Open
                  </div>
                  <div className={`p-1.5 rounded border ${currentStep >= 3 ? "bg-indigo-950/20 border-indigo-800 text-indigo-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                    3. Priors Compared
                  </div>
                  <div className={`p-1.5 rounded border ${currentStep >= 4 ? "bg-indigo-950/20 border-indigo-800 text-indigo-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                    4. AI Reviewed
                  </div>
                  <div className={`p-1.5 rounded border ${currentStep >= 5 ? "bg-indigo-950/20 border-indigo-800 text-indigo-300" : "bg-slate-900 border-slate-800 text-slate-500"}`}>
                    5. Ready to Sign
                  </div>
                </div>
              </div>

              {/* REPORT COMPLETENESS INDICATOR */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-300">Live Report Quality Indicator</span>
                  <span className={`font-bold ${completenessDetails.pct === 100 ? "text-emerald-400" : "text-amber-400"}`}>
                    {completenessDetails.pct}% Complete
                  </span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${completenessDetails.pct === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
                    style={{ width: `${completenessDetails.pct}%` }}
                  />
                </div>
                <div className="flex gap-4 text-[10px] text-slate-400 flex-wrap justify-between">
                  <div className="flex items-center gap-1">
                    <span className={completenessDetails.checks.clinicalHistory ? "text-emerald-400" : "text-slate-600"}>✓</span> Indication
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={completenessDetails.checks.technique ? "text-emerald-400" : "text-slate-600"}>✓</span> Technique
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={completenessDetails.checks.findings ? "text-emerald-400" : "text-slate-600"}>✓</span> Findings (15+ chars)
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={completenessDetails.checks.impression ? "text-emerald-400" : "text-slate-600"}>✓</span> Impression
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={completenessDetails.checks.recommendation ? "text-emerald-400" : "text-slate-600"}>✓</span> Recommendation
                  </div>
                </div>
              </div>

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
                  <CardHeader className="p-3 pb-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1">
                      <HistoryIcon className="h-3.5 w-3.5 text-indigo-400" /> Patient Previous Studies ({priorReports.length})
                    </CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAutoCompare}
                      className="h-6 text-[10px] border-slate-800 text-indigo-400 hover:bg-slate-900"
                    >
                      Auto-Compare Text
                    </Button>
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
                    id="report-editor-clinicalHistory"
                    value={clinicalHistory}
                    onChange={(e) => setClinicalHistory(e.target.value)}
                    placeholder="Enter clinical indication..."
                    className="bg-slate-900 border-slate-800 text-xs text-slate-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-300">Technique</Label>
                  <Input
                    id="report-editor-technique"
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
                      onInsert={(text: string) => {
                        setLastVoiceCommand(text);
                        handleFindingsTextChange(rawFindings ? rawFindings + " " + text : text);
                      }}
                      onVoiceIntent={handleVoiceIntent}
                      className="scale-90"
                    />
                  </div>
                  <Textarea
                    id="report-editor-findings"
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
                        id={`report-editor-impression-${idx}`}
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
                    id="report-editor-recommendation"
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
                    onClick={handleFinalizeClick}
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
          <Tabs value={activeRightTab} onValueChange={setActiveRightTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid grid-cols-6 bg-slate-900 border-b border-slate-800 rounded-none h-11 p-1">
              <TabsTrigger value="assist" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                AI/Voice
              </TabsTrigger>
              <TabsTrigger value="copilot" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400 flex items-center justify-center gap-0.5">
                Co-Pilot
                {coPilotSuggestions.length > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce" />
                )}
              </TabsTrigger>
              <TabsTrigger value="chocolate" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                Findings
              </TabsTrigger>
              <TabsTrigger value="builders" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400">
                Builders
              </TabsTrigger>
              <TabsTrigger value="inspector" className="text-[10px] data-[state=active]:bg-slate-950 data-[state=active]:text-indigo-400 flex items-center justify-center gap-1">
                Inspector
                {aiInspectorResults.issues.filter(i => !ignoredIssueIds.includes(i.id) && !reviewedIssueIds.includes(i.id)).length > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                )}
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
                          className="flex-1 text-[10px] h-7 border-slate-800 text-slate-300 hover:bg-slate-955"
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

            {/* TAB: AI Co-Pilot Dashboard */}
            <TabsContent value="copilot" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              {study ? (
                <div className="space-y-4">
                  {/* Dynamic checklist */}
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-3">
                      <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <ClipboardList className="h-4 w-4 text-indigo-400" />
                        Clinical Checklist ({study.modality})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 space-y-2">
                      {copilotChecklist.length === 0 ? (
                        <div className="text-[11px] text-slate-500">No checklist for this modality</div>
                      ) : (
                        <div className="grid grid-cols-1 gap-1.5">
                          {copilotChecklist.map((item) => (
                            <div key={item.id} className="flex items-center gap-2">
                              <Checkbox
                                id={item.id}
                                checked={item.checked}
                                onCheckedChange={(checked) => {
                                  setCopilotChecklist(prev =>
                                    prev.map(i => i.id === item.id ? { ...i, checked: !!checked } : i)
                                  );
                                }}
                              />
                              <label htmlFor={item.id} className="text-xs text-slate-300 cursor-pointer">
                                {item.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Suggestions and Observations */}
                  <Card className="bg-slate-900 border-slate-800">
                    <CardHeader className="p-3">
                      <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <BrainCircuit className="h-4 w-4 text-indigo-400" />
                        Co-Pilot Observations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 space-y-2">
                      {coPilotSuggestions.length === 0 ? (
                        <div className="text-[11px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 p-2.5 rounded-lg text-center font-medium">
                          ✓ No clinical warnings or gaps identified.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {coPilotSuggestions.map((s) => (
                            <div
                              key={s.id}
                              className={`p-2.5 rounded-lg border text-[11px] space-y-1.5 ${
                                s.severity === "critical" ? "bg-red-950/20 border-red-900/50 text-slate-300" :
                                s.severity === "warning" ? "bg-amber-950/20 border-amber-900/50 text-slate-300" :
                                "bg-slate-950/40 border-slate-800 text-slate-300"
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <span className="font-semibold text-slate-200">{s.title}</span>
                                <Badge variant="outline" className={`text-[8px] uppercase px-1 py-0 ${
                                  s.severity === "critical" ? "border-red-800 text-red-400" :
                                  s.severity === "warning" ? "border-amber-800 text-amber-400" :
                                  "border-blue-800 text-blue-400"
                                }`}>
                                  {s.severity}
                                </Badge>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-relaxed">{s.message}</p>
                              
                              <div className="flex gap-2 justify-end pt-1 border-t border-slate-800/30">
                                {s.actionableText && (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (s.actionMacro === "insertForaminalPlaceholder") {
                                        setRawFindings(prev => prev + "\n\nNEURAL FORAMINA:\n- Exiting nerve roots show no significant foraminal narrowing.");
                                      } else if (s.actionMacro === "addSpectroscopyRecommendation") {
                                        setRecommendation(prev => prev + " Recommend advanced MR Spectroscopy correlation.");
                                      } else if (s.actionMacro === "addAngioRecommendation") {
                                        setRecommendation(prev => prev + " Recommend MRA or CTA evaluation of intracranial circulation.");
                                      } else {
                                        setRawFindings(prev => prev ? prev + " " + s.actionableText : s.actionableText!);
                                      }
                                      logCopilotActionMutation.mutate({
                                        suggestionType: s.type,
                                        suggestionContent: s.title,
                                        action: "accepted",
                                      });
                                    }}
                                    className="h-5 text-[9px] bg-indigo-600 hover:bg-indigo-700 text-white px-2"
                                  >
                                    Apply Advice
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    logCopilotActionMutation.mutate({
                                      suggestionType: s.type,
                                      suggestionContent: s.title,
                                      action: "dismissed",
                                    });
                                    updateCopilotProfileMutation.mutate({
                                      ignoredWarnings: [...userProfile.ignoredWarnings, s.id],
                                    });
                                  }}
                                  className="h-5 text-[9px] text-slate-500 hover:text-slate-300 p-0 px-1"
                                >
                                  Dismiss
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Comparisons */}
                  {coPilotPriorComparisonMetrics.length > 0 && (
                    <Card className="bg-slate-900 border-slate-800">
                      <CardHeader className="p-3">
                        <CardTitle className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <GitCompare className="h-4 w-4 text-emerald-400" />
                          Co-Pilot Growth Analysis
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 pt-0 space-y-2">
                        {coPilotPriorComparisonMetrics.map((c, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs bg-slate-955 p-2 rounded border border-slate-800">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-300">{c.metricName}</span>
                              <span className="text-[10px] text-slate-500">Prev: {c.previousValue} &bull; Curr: {c.currentValue}</span>
                            </div>
                            <Badge className={`text-[10px] ${
                              c.status === "growth" ? "bg-red-950/55 text-red-400 border border-red-800/60" :
                              c.status === "regression" ? "bg-emerald-950/55 text-emerald-400 border border-emerald-800/60" :
                              "bg-slate-900 text-slate-400 border border-slate-800"
                            }`}>
                              {c.diffText} ({c.status})
                            </Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Learning Tip */}
                  <Card className="bg-slate-900/50 border-slate-800/60 border-dashed">
                    <CardContent className="p-3 text-[11px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
                      <Sparkles className="h-4 w-4 text-amber-400 flex-shrink-0" />
                      <div>
                        <span className="font-bold text-slate-300">Co-Pilot Learning Tip:</span> Spoken dictations like <span className="font-mono text-indigo-300 font-bold bg-slate-950 px-1 py-0.2 rounded">"compare with previous"</span> will automatically trigger auto-comparison. All dismissal actions are saved to your private local profile.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="p-10 text-center text-slate-500 text-xs">No active study selected</div>
              )}
            </TabsContent>

            {/* TAB: Chocolate Box Smart Findings */}
            <TabsContent value="chocolate" className="flex-1 overflow-y-auto p-4 m-0">
              {study ? (
                <div className="space-y-4">
                  <ErrorBoundary fallback={<div className="p-4 text-xs bg-red-950/20 text-red-400 border border-red-800/30 rounded-lg">Failed to load Findings Box. Please reload the page.</div>}>
                    <ChocolateBoxPanel
                      modality={study.modality}
                      bodyPart={study.studyDescription || ""}
                      selectedFindingsList={selectedChocolateFindings}
                      onSelectFinding={(finding: ChocolateFinding) => {
                        setSelectedChocolateFindings((prev) => [...prev, finding]);
                        setRawFindings((prev) => prev ? prev + "\n" + finding.findingText : finding.findingText);
                      }}
                    />
                  </ErrorBoundary>
                </div>
              ) : (
                <div className="p-10 text-center text-slate-500 text-xs">No active study selected</div>
              )}
            </TabsContent>

            <TabsContent value="builders" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              {study && (
                <div className="space-y-4">
                  {/* CENTRALIZED VIEWER MEASUREMENT BRIDGE (Phase 4) */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-slate-100 p-3 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-1.5">
                        <Tv2 className="h-4 w-4 text-indigo-400" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Viewer Measurements</span>
                      </div>
                      {viewerMeasurements.filter(m => m.status === "pending").length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const pendingIds = viewerMeasurements.filter(m => m.status === "pending").map(m => m.id);
                            importAllMeasurementsMutation.mutate(pendingIds);
                          }}
                          className="h-6 text-[9px] border-indigo-500 hover:bg-indigo-950 text-indigo-300"
                        >
                          Import All
                        </Button>
                      )}
                    </div>

                    {viewerMeasurements.length === 0 ? (
                      <div className="text-center py-4 text-xs text-slate-500">
                        No measurements detected from viewer (OHIF/Weasis) or DICOM SR.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {viewerMeasurements.map((m) => (
                          <div key={m.id} className={`border rounded-lg p-2 text-xs space-y-1.5 transition-colors ${
                            m.status === "imported" ? "bg-emerald-950/20 border-emerald-800/50" :
                            m.status === "ignored" ? "bg-slate-950/20 border-slate-850 opacity-50" :
                            "bg-slate-950/40 border-slate-800"
                          }`}>
                            <div className="flex justify-between items-start">
                              <div className="flex flex-col">
                                <span className="font-semibold text-slate-200">{m.measurementType} ({m.viewerName})</span>
                                <span className="text-[10px] text-slate-400">
                                  Series {m.seriesInstanceUID?.substring(0, 8)}... &bull; Slice {m.sliceNumber ?? "—"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-indigo-300 font-bold bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                  {m.value} {m.unit}
                                </span>
                                <Badge className="text-[8px] bg-slate-900 border-slate-800 text-slate-400">
                                  Conf: {Math.round(m.confidence * 100)}%
                                </Badge>
                              </div>
                            </div>

                            {/* Coordinates / Details */}
                            {m.imageCoordinates && (
                              <div className="text-[9px] text-slate-500 font-mono truncate">
                                Coord: {m.imageCoordinates}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800/40">
                              {m.status === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => updateViewerMeasurementMutation.mutate({ id: m.id, status: "imported" })}
                                    className="h-5 text-[9px] bg-emerald-700 hover:bg-emerald-800 text-white px-1.5"
                                  >
                                    Import
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => updateViewerMeasurementMutation.mutate({ id: m.id, status: "ignored" })}
                                    className="h-5 text-[9px] border-slate-800 text-slate-400 px-1.5"
                                  >
                                    Ignore
                                  </Button>
                                </>
                              )}
                              {m.status === "imported" && (
                                <Badge className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[8px] px-1 py-0 flex items-center gap-0.5">
                                  <Check className="h-2 w-2" /> Imported
                                </Badge>
                              )}
                              {m.status === "ignored" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateViewerMeasurementMutation.mutate({ id: m.id, status: "pending" })}
                                  className="h-5 text-[9px] text-slate-500 hover:text-slate-300 p-0"
                                >
                                  Restore
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // Locate on viewer: launch OHIF or Weasis targeting series/SOPInstanceUID
                                  if (m.viewerName === "Weasis") {
                                    handleLaunchWeasis();
                                  } else {
                                    handleLaunchOhif();
                                  }
                                }}
                                className="h-5 text-[9px] text-indigo-400 hover:text-indigo-300 p-0 ml-auto flex items-center gap-0.5 animate-pulse"
                              >
                                <MonitorPlay className="h-2.5 w-2.5" /> Locate
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // Insert into Findings
                                  const textToInsert = `${m.measurementType} measures ${m.value} ${m.unit} (Viewer: ${m.viewerName}, slice ${m.sliceNumber ?? "N/A"}).`;
                                  setRawFindings(prev => prev ? prev + "\n" + textToInsert : textToInsert);
                                  toast({ title: "Inserted into Findings" });
                                }}
                                className="h-5 text-[9px] text-indigo-400 hover:text-indigo-300 p-0 ml-1"
                              >
                                Findings
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // Insert into Impression
                                  const textToInsert = `${m.measurementType} measuring ${m.value} ${m.unit} on slice ${m.sliceNumber ?? "N/A"}.`;
                                  setImpression(prev => {
                                    const next = [...prev.filter(Boolean)];
                                    if (!next.includes(textToInsert)) next.push(textToInsert);
                                    return next;
                                  });
                                  toast({ title: "Inserted into Impression" });
                                }}
                                className="h-5 text-[9px] text-indigo-400 hover:text-indigo-300 p-0 ml-1"
                              >
                                Impression
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* PRIOR COMPARISON PANEL (Phase 7) */}
                  {priorComparisonMetrics.length > 0 && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
                        <GitCompare className="h-4 w-4 text-emerald-400" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Prior Comparisons</span>
                      </div>
                      <div className="space-y-1.5">
                        {priorComparisonMetrics.map((c, idx) => (
                          <div key={idx} className="flex flex-col text-[11px] bg-slate-950/40 p-2 rounded border border-slate-850">
                            <div className="flex justify-between font-medium">
                              <span className="text-slate-300">{c.label}</span>
                              <span className={`font-bold ${c.direction === "growth" ? "text-red-400" : c.direction === "regression" ? "text-emerald-400" : "text-slate-400"}`}>
                                {c.direction === "growth" ? <TrendingUp className="inline h-3.5 w-3.5 mr-0.5" /> : c.direction === "regression" ? <TrendingDown className="inline h-3.5 w-3.5 mr-0.5" /> : <Minus className="inline h-3.5 w-3.5 mr-0.5" />}
                                {c.changePercent > 0 ? `+${c.changePercent}%` : `${c.changePercent}%`}
                              </span>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                              <span>Prior: {c.previous}</span>
                              <span>Current: {c.current}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-slate-800 pt-3">
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

                  {/* Centralized Measurement Assistant Engine */}
                  <ErrorBoundary fallback={<div className="p-4 text-xs bg-red-950/20 text-red-400 border border-red-800/30 rounded-lg">Failed to load Measurement Assistant. Please reload the page.</div>}>
                    <MeasurementAssistantPanel
                      patientId={study.patientId || undefined}
                      studyId={study.studyId || undefined}
                      modality={study.modality}
                      bodyPart={study.studyDescription || ""}
                      onMeasurementsChange={handleMeasurementsApplied}
                      voiceTextCommand={lastVoiceCommand}
                      initialValues={measurementAssistantInitialValues}
                    />
                  </ErrorBoundary>
                </div>
              )}
            </TabsContent>


            {/* TAB: AI Quality Inspector */}
            <TabsContent value="inspector" className="flex-1 overflow-y-auto p-4 m-0 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <BrainCircuit className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">AI Report Inspector</span>
                </div>
                <Badge className={`text-xs font-bold ${
                  aiInspectorResults.score.overall >= 85 ? "bg-emerald-950 text-emerald-400 border border-emerald-800" :
                  aiInspectorResults.score.overall >= 70 ? "bg-amber-950 text-amber-400 border border-amber-800" :
                  "bg-red-950 text-red-400 border border-red-800"
                }`}>
                  Score: {aiInspectorResults.score.overall}/100
                </Badge>
              </div>

              {/* Subscores breakdown */}
              <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-[10px]">
                <div className="col-span-2 font-semibold text-slate-400 border-b border-slate-800 pb-1 mb-1">Subcategory Scores:</div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Medical Consistency:</span>
                  <span className={aiInspectorResults.score.medical >= 85 ? "text-emerald-400" : "text-amber-400"}>{aiInspectorResults.score.medical}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Measurements:</span>
                  <span className={aiInspectorResults.score.measurement >= 85 ? "text-emerald-400" : "text-amber-400"}>{aiInspectorResults.score.measurement}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Completeness:</span>
                  <span className={aiInspectorResults.score.completeness >= 85 ? "text-emerald-400" : "text-amber-400"}>{aiInspectorResults.score.completeness}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Comparison:</span>
                  <span className={aiInspectorResults.score.comparison >= 85 ? "text-emerald-400" : "text-amber-400"}>{aiInspectorResults.score.comparison}%</span>
                </div>
                <div className="flex justify-between col-span-2 pt-1 border-t border-slate-800/50">
                  <span className="text-slate-500">Grammar & Dictation:</span>
                  <span className="text-slate-300">{aiInspectorResults.score.grammar}%</span>
                </div>
              </div>

              {/* Issues list */}
              <div className="space-y-2">
                {aiInspectorResults.issues.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                    <span>No quality issues detected. Report is verified clean!</span>
                  </div>
                ) : (
                  aiInspectorResults.issues.map((issue) => {
                    const isIgnored = ignoredIssueIds.includes(issue.id);
                    const isReviewed = reviewedIssueIds.includes(issue.id);
                    return (
                      <div
                        key={issue.id}
                        className={`p-3 rounded-lg border text-xs space-y-2 transition-all ${
                          isIgnored || isReviewed ? "bg-slate-900/20 border-slate-800/40 opacity-50" :
                          issue.severity === "critical" ? "bg-red-950/20 border-red-800/60 text-slate-200" :
                          issue.severity === "important" ? "bg-amber-950/20 border-amber-800/60 text-slate-200" :
                          "bg-slate-900/80 border-slate-800 text-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {issue.severity === "critical" && <AlertOctagon size={13} className="text-red-500 flex-shrink-0" />}
                            {issue.severity === "important" && <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />}
                            {issue.severity === "suggestion" && <Info size={13} className="text-blue-400 flex-shrink-0" />}
                            <span className="font-semibold text-slate-200">{issue.title}</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] uppercase tracking-wide px-1 py-0 ${
                            issue.severity === "critical" ? "border-red-800 text-red-400 bg-red-950/20" :
                            issue.severity === "important" ? "border-amber-800 text-amber-400 bg-amber-950/20" :
                            "border-blue-800 text-blue-400 bg-blue-950/20"
                          }`}>
                            {issue.severity}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{issue.message}</p>
                        {issue.suggestion && (
                          <div className="bg-slate-950/60 p-2 rounded border border-slate-850 text-[10px] text-slate-300 font-mono">
                            <span className="text-indigo-400 font-bold block mb-0.5 text-[9px] uppercase">Suggestion:</span>
                            {issue.suggestion}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/30">
                          {issue.field && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 text-[9px] text-indigo-400 hover:text-indigo-300 hover:bg-slate-950 p-1"
                              onClick={() => {
                                const el = document.getElementById(`report-editor-${issue.field}`);
                                if (el) {
                                  el.focus();
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                } else {
                                  toast({ title: `Field location: ${issue.field}`, description: `Focus the ${issue.field} field in the editor.` });
                                }
                              }}
                            >
                              <ArrowUpRight size={10} className="mr-0.5" /> Jump to field
                            </Button>
                          )}
                          <div className="flex gap-1 ml-auto">
                            {!isIgnored && !isReviewed ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setReviewedIssueIds(prev => [...prev, issue.id])}
                                  className="h-5 text-[9px] bg-slate-950 hover:bg-slate-850 text-slate-300 px-1.5"
                                >
                                  Reviewed
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setIgnoredIssueIds(prev => [...prev, issue.id])}
                                  className="h-5 text-[9px] bg-slate-950 hover:bg-red-950/30 text-slate-400 hover:text-red-400 px-1.5"
                                >
                                  Ignore
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setIgnoredIssueIds(prev => prev.filter(x => x !== issue.id));
                                  setReviewedIssueIds(prev => prev.filter(x => x !== issue.id));
                                }}
                                className="h-5 text-[9px] text-slate-500 hover:text-slate-300 px-1.5"
                              >
                                Undo Ignore
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
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

      {/* WARNING DIALOG FOR INCOMPLETE REPORTS */}
      <Dialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <DialogContent className="bg-slate-950 border border-slate-800 text-slate-100 max-w-lg rounded-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center justify-between text-indigo-400">
              <span className="flex items-center gap-1.5"><BrainCircuit className="h-4 w-4 text-indigo-400" /> AI Quality Inspector Review</span>
              <Badge className={`text-xs ${
                aiInspectorResults.score.overall >= 85 ? "bg-emerald-950 text-emerald-400 border border-emerald-800" :
                aiInspectorResults.score.overall >= 70 ? "bg-amber-950 text-amber-400 border border-amber-800" :
                "bg-red-950 text-red-400 border border-red-800"
              }`}>
                Score: {aiInspectorResults.score.overall}/100
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-2">
              Please review the following clinical quality, consistency, and completeness alerts before signing:
            </DialogDescription>
          </DialogHeader>

          {/* Completeness Section List */}
          <div className="space-y-3 mt-3">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Report Structure Completeness:</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] bg-slate-900/40 p-2.5 rounded border border-slate-800">
              <div className="flex items-center gap-1.5">
                <span className={completenessDetails.checks.clinicalHistory ? "text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
                  {completenessDetails.checks.clinicalHistory ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">Indication</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={completenessDetails.checks.technique ? "text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
                  {completenessDetails.checks.technique ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">Technique</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={completenessDetails.checks.findings ? "text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
                  {completenessDetails.checks.findings ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">Findings</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={completenessDetails.checks.impression ? "text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
                  {completenessDetails.checks.impression ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">Impression</span>
              </div>
              <div className="flex items-center gap-1.5 col-span-2">
                <span className={completenessDetails.checks.recommendation ? "text-emerald-400 font-bold" : "text-amber-500 font-bold"}>
                  {completenessDetails.checks.recommendation ? "✓" : "✗"}
                </span>
                <span className="text-slate-300">Recommendation</span>
              </div>
            </div>
          </div>

          {/* Warnings List */}
          <div className="space-y-2 mt-4">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Quality & Consistency Issues:</div>
            {aiInspectorResults.issues.filter(i => !ignoredIssueIds.includes(i.id) && !reviewedIssueIds.includes(i.id)).length === 0 ? (
              <div className="text-center py-4 text-emerald-400 text-xs font-semibold bg-emerald-950/10 border border-emerald-900/30 rounded-lg">
                ✓ All consistency and mandatory metrics checks are resolved or reviewed!
              </div>
            ) : (
              <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                {aiInspectorResults.issues
                  .filter(i => !ignoredIssueIds.includes(i.id) && !reviewedIssueIds.includes(i.id))
                  .map((issue) => (
                    <div
                      key={issue.id}
                      className={`p-2.5 rounded border text-[11px] space-y-1.5 ${
                        issue.severity === "critical" ? "bg-red-950/20 border-red-900/50 text-slate-300" :
                        issue.severity === "important" ? "bg-amber-950/20 border-amber-900/50 text-slate-300" :
                        "bg-slate-900 border-slate-800 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200">{issue.title}</span>
                        <Badge variant="outline" className={`text-[8px] uppercase px-1 py-0 ${
                          issue.severity === "critical" ? "border-red-800 text-red-400" :
                          issue.severity === "important" ? "border-amber-800 text-amber-400" :
                          "border-blue-800 text-blue-400"
                        }`}>
                          {issue.severity}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-normal">{issue.message}</p>
                      {issue.suggestion && (
                        <div className="bg-slate-950 p-1.5 rounded text-[9px] font-mono text-indigo-300 font-bold">
                          {issue.suggestion}
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-1 border-t border-slate-800/30">
                        {issue.field && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-4 p-0 text-[9px] text-indigo-400 hover:text-indigo-300"
                            onClick={() => {
                              setShowWarningModal(false);
                              const el = document.getElementById(`report-editor-${issue.field}`);
                              if (el) {
                                el.focus();
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }
                            }}
                          >
                            Jump to location
                          </Button>
                        )}
                        <div className="flex gap-1 ml-auto">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-4 px-1 text-[9px] bg-slate-900 text-slate-300 hover:bg-slate-800"
                            onClick={() => setReviewedIssueIds(prev => [...prev, issue.id])}
                          >
                            Mark Reviewed
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-4 px-1 text-[9px] bg-slate-900 text-slate-400 hover:text-red-400"
                            onClick={() => setIgnoredIssueIds(prev => [...prev, issue.id])}
                          >
                            Ignore
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:justify-end mt-5 pt-3 border-t border-slate-800">
            <Button size="sm" variant="outline" onClick={() => setShowWarningModal(false)} className="border-slate-800 hover:bg-slate-900 text-xs text-slate-300">
              Back to Edit
            </Button>
            <Button size="sm" onClick={() => {
              setShowWarningModal(false);
              finalizeMutation.mutate();
            }} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
              Sign Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
