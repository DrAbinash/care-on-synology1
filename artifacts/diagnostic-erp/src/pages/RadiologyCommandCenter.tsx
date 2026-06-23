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
  Layers, Settings, FileText, ClipboardList, BookOpen, AlertCircle, Sparkles,
  Star, Check, RotateCcw, ChevronUp, ChevronDown, Construction, Wand2, Info
} from "lucide-react";
import EmbeddedWadoViewer from "@/components/EmbeddedWadoViewer";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import ChocolateBoxPanel, { type ChocolateFinding } from "@/components/ChocolateBoxPanel";
import PreferencesPanel from "@/components/PreferencesPanel";
import { Grid } from "lucide-react";
import {
  ALL_BUILDERS, detectBuilderType, getBuilderForType, defaultSelections,
  generateSmartReport, generateImpressionText,
  generateCombinedTitle, generateCombinedTechnique, generateMultiStudyReport
} from "@/lib/radiologySmartEngine";

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
  pacsArchiveStatus?: string;
  pacsArchiveResponse?: string | null;
  pacsInstanceId?: string | null;
  bodyPart?: string | null;
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
  },
  "GENERAL": {
    templates: ["General Radiology Report", "Normal Exam Template"],
    findings: [
      "No focal abnormality seen.",
      "Visualized structures are within normal limits for age.",
      "No acute pathology detected."
    ],
    impressions: [
      "Normal study.",
      "No acute radiographic abnormality."
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
  const [selectedChocolateFindings, setSelectedChocolateFindings] = useState<ChocolateFinding[]>([]);
  
  // Structured reporting toggles
  const [useStructured, setUseStructured] = useState(false);
  const [findingsMap, setFindingsMap] = useState<Record<string, { normal: boolean; text: string }>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);

  // New Structured Findings Builder States
  const [selectedBuilders, setSelectedBuilders] = useState<string[]>([]);
  const [multiSelections, setMultiSelections] = useState<Record<string, Record<string, any>>>({});
  const [starredFindings, setStarredFindings] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("starred_findings") || "[]");
    } catch { return []; }
  });
  const [starredTemplates, setStarredTemplates] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("starred_templates") || "[]");
    } catch { return []; }
  });
  const [recentFindings, setRecentFindings] = useState<string[]>([]);
  const [searchFindingsQuery, setSearchFindingsQuery] = useState("");
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });

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

  // 7. User Report Preferences for Personal Macros
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

  const handleFindingsChange = (e: any) => {
    let val = e.target.value;
    let updated = false;
    personalMacros.forEach((macro: any) => {
      const shortcut = `/${macro.name}`;
      if (val.includes(shortcut)) {
        val = val.replaceAll(shortcut, macro.content);
        updated = true;
        api.post("/api/radiology/user-item-usage", {
          itemType: "macro",
          itemId: macro.name,
          itemLabel: macro.name,
        }).catch(() => {});
      }
    });
    setRawFindings(val);
    if (updated) {
      toast({ title: "Macro Expanded" });
    }
  };

  const handleImpressionLineChange = (i: number, val: string) => {
    let finalVal = val;
    let updated = false;
    personalMacros.forEach((macro: any) => {
      const shortcut = `/${macro.name}`;
      if (finalVal.includes(shortcut)) {
        finalVal = finalVal.replaceAll(shortcut, macro.content);
        updated = true;
        api.post("/api/radiology/user-item-usage", {
          itemType: "macro",
          itemId: macro.name,
          itemLabel: macro.name,
        }).catch(() => {});
      }
    });
    const next = [...impression];
    next[i] = finalVal;
    setImpression(next);
    if (updated) {
      toast({ title: "Macro Expanded" });
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // EFFECTS & AUTO-DETECTION
  // ══════════════════════════════════════════════════════════════════════════

  // Auto-load parameter if route changes
  useEffect(() => {
    if (routeStudyId) {
      setActiveStudyId(Number(routeStudyId));
    }
  }, [routeStudyId]);

  // Locking system states
  const [isViewOnly, setIsViewOnly] = useState(false);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [currentLockOwner, setCurrentLockOwner] = useState<{ userId: number; userName: string; workstation?: string; lockTime?: string } | null>(null);

  // Periodic lock acquisition and heartbeat hook
  useEffect(() => {
    if (!activeStudyId || !session) return;

    let heartbeatInterval: any;

    const acquireOrRefreshLock = async (forceOverride = false) => {
      try {
        const res = await api.post<{ success: boolean; error?: string; lock?: any }>(
          `/api/radiology/studies/${activeStudyId}/lock`,
          { workstation: window.location.hostname || "WebBrowser", force: forceOverride }
        );
        if (res.success) {
          setIsViewOnly(false);
          setTakeoverOpen(false);
          setCurrentLockOwner(null);
        }
      } catch (err: any) {
        if (err.status === 409) {
          // Conflict: locked by someone else
          try {
            const data = await err.json();
            if (data.lock) {
              setCurrentLockOwner(data.lock);
              setIsViewOnly(true);
              setTakeoverOpen(true);
            }
          } catch {
            setIsViewOnly(true);
            setTakeoverOpen(true);
          }
        } else {
          console.error("Lock error:", err);
        }
      }
    };

    // Initial acquire
    acquireOrRefreshLock();

    // Heartbeat every 10 seconds
    heartbeatInterval = setInterval(() => {
      if (!isViewOnly) {
        acquireOrRefreshLock();
      }
    }, 10000);

    // Release lock on unmount or active study change
    return () => {
      clearInterval(heartbeatInterval);
      api.delete(`/api/radiology/studies/${activeStudyId}/lock`).catch(() => undefined);
    };
  }, [activeStudyId, session, isViewOnly]);

  // Page unload release handler
  useEffect(() => {
    const handleUnload = () => {
      if (activeStudyId && !isViewOnly) {
        // Use keepalive / sendBeacon pattern or sync fetch
        navigator.sendBeacon(`/api/radiology/studies/${activeStudyId}/lock`);
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [activeStudyId, isViewOnly]);

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
    return "GENERAL"; // Safe fallback
  }, [study]);

  // Smart reporting engine bindings
  const detectedType = useMemo(() => {
    if (!study) return null;
    return detectBuilderType(study.modality, study.studyDescription);
  }, [study]);

  const activeBuilderTypes = useMemo(() => {
    if (selectedBuilders.length > 0) return selectedBuilders;
    return detectedType ? [detectedType] : [];
  }, [selectedBuilders, detectedType]);

  const activeBuilder = useMemo(() => {
    const bt = activeBuilderTypes[0];
    return bt ? getBuilderForType(bt) : undefined;
  }, [activeBuilderTypes]);

  // Star templates & selections preferences persistence
  const toggleStarTemplate = (tplName: string) => {
    setStarredTemplates((prev) => {
      const next = prev.includes(tplName) ? prev.filter((t) => t !== tplName) : [...prev, tplName];
      localStorage.setItem("starred_templates", JSON.stringify(next));
      return next;
    });
  };

  const toggleStarFinding = (findingKey: string) => {
    setStarredFindings((prev) => {
      const next = prev.includes(findingKey) ? prev.filter((f) => f !== findingKey) : [...prev, findingKey];
      localStorage.setItem("starred_findings", JSON.stringify(next));
      return next;
    });
  };

  // Populate default selections on builder load
  useEffect(() => {
    if (activeBuilderTypes.length > 0) {
      const updatedSelections = { ...multiSelections };
      activeBuilderTypes.forEach((bType) => {
        if (!updatedSelections[bType]) {
          updatedSelections[bType] = defaultSelections(bType);
        }
      });
      setMultiSelections(updatedSelections);
    }
  }, [activeBuilderTypes]);

  // Auto-detect and trigger Critical Findings flag
  useEffect(() => {
    if (!study) return;
    let hasCritical = false;
    for (const bType of activeBuilderTypes) {
      const sel = multiSelections[bType] || {};
      if (bType === "mri_brain") {
        if (sel.infarctPresent === true || sel.hemorrhagePresent === true) {
          hasCritical = true;
        }
      }
      if (bType === "ct_brain") {
        if ((sel.ctHemorrhage && sel.ctHemorrhage !== "None") || (sel.ctInfarct && sel.ctInfarct !== "None")) {
          hasCritical = true;
        }
      }
      if (bType === "xray_chest") {
        if (sel.opacityType === "Pneumothorax Present" || sel.opacityType === "Large PE") {
          hasCritical = true;
        }
      }
    }
    
    if (hasCritical && !isCritical) {
      setIsCritical(true);
      toast({
        title: "Critical Finding Auto-Detected",
        description: "Suggested Critical Findings flag activated. Please complete the communication checklist.",
        variant: "destructive"
      });
      // Pushes critical audit event
      api.post("/api/radiology/knowledge/analytics/usage", {
        action: "CRITICAL_FINDING_AUTODETECTED",
        modality: study.modality,
        studyInstanceUID: study.studyInstanceUID
      }).catch(() => {});
    }
  }, [multiSelections, activeBuilderTypes, isCritical, study]);

  // Hybrid Template + Findings merge
  const appendSelectedFindings = () => {
    if (activeBuilderTypes.length === 0) return;
    const report = generateMultiStudyReport(activeBuilderTypes, multiSelections);
    setRawFindings((prev) => {
      const base = prev ? prev + "\n\n" : "";
      return base + "STRUCTURED OBSERVATIONS:\n" + report.findings;
    });
    setImpression((prev) => {
      const filtered = prev.filter(Boolean);
      if (report.impression && report.impression !== "No significant abnormality.") {
        const pts = report.impression.split("\n").map(p => p.trim()).filter(Boolean);
        const next = [...filtered];
        for (const p of pts) {
          if (!next.includes(p)) next.push(p);
        }
        return next;
      }
      return prev;
    });
    toast({ title: "Findings Appended", description: "Structured selections merged into the active report draft." });
  };

  // Quality checks pre-flight
  const qualityWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!study) return warnings;

    if (!rawFindings.trim()) {
      warnings.push("Findings editor field is completely empty.");
    }
    if (impression.filter(Boolean).length === 0 || (impression.length === 1 && impression[0] === "")) {
      warnings.push("Impression points list is empty.");
    }

    const findingsText = rawFindings.toLowerCase();
    const isNormalText = findingsText.includes("normal") || findingsText.includes("unremarkable") || findingsText.includes("no focal abnormality");
    
    let hasCriticalFinding = false;
    for (const bType of activeBuilderTypes) {
      const sel = multiSelections[bType] || {};
      if (bType === "mri_brain") {
        if (sel.infarctPresent === true) {
          hasCriticalFinding = true;
          if (isNormalText) warnings.push("Contradiction (Brain): Findings text implies 'normal' study, but Infarct Present check is active.");
        }
        if (sel.hemorrhagePresent === true) {
          hasCriticalFinding = true;
          if (isNormalText) warnings.push("Contradiction (Brain): Findings text implies 'normal' study, but Hemorrhage Present check is active.");
        }
      }
      if (bType === "ct_brain") {
        if (sel.ctHemorrhage && sel.ctHemorrhage !== "None") hasCriticalFinding = true;
        if (sel.ctInfarct && sel.ctInfarct !== "None") hasCriticalFinding = true;
      }
      if (bType === "xray_chest") {
        if (sel.opacityType && sel.opacityType !== "None") {
          if (sel.opacityType.includes("Pneumothorax") || sel.opacityType.includes("Large PE")) {
            hasCriticalFinding = true;
          }
        }
      }

      if (bType === "mri_cervical_spine" || bType === "mri_lumbar_spine") {
        if (!sel.canalDiameter) {
          warnings.push(`Spine template (${bType}) selected, but AP Canal Diameter is missing.`);
        }
      }
    }

    if (hasCriticalFinding && !isCritical) {
      warnings.push("A critical finding is active in selections, but Critical Findings flag is not checked.");
    }

    return warnings;
  }, [study, rawFindings, impression, activeBuilderTypes, multiSelections, isCritical]);

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
    setSelectedBuilders([]);
    setMultiSelections({});
    setSelectedChocolateFindings([]);

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
      
      // Append technique
      setTechnique((prev) => {
        if (!prev) return sections.technique || "";
        if (sections.technique && !prev.includes(sections.technique)) {
          return prev + "\n" + sections.technique;
        }
        return prev;
      });

      if (useStructured) {
        setFindingsMap((prev) => {
          const map = { ...prev };
          for (const item of sections.findingsItems) {
            map[item.label] = { normal: true, text: item.normal };
          }
          return map;
        });
      } else {
        setRawFindings((prev) => {
          if (!prev) return template.defaultFindings || "";
          if (template.defaultFindings && !prev.includes(template.defaultFindings)) {
            return prev + "\n\n" + template.defaultFindings;
          }
          return prev;
        });
      }

      if (template.defaultImpression) {
        const defaultImp = template.defaultImpression;
        setImpression((prev) => {
          const filtered = prev.filter(Boolean) as string[];
          if (!filtered.includes(defaultImp)) {
            return [...filtered, defaultImp];
          }
          return filtered;
        });
      }
    } catch {
      setRawFindings((prev) => {
        if (!prev) return template.defaultFindings || "";
        return prev + "\n\n" + (template.defaultFindings || "");
      });
    }
    toast({ title: `Merged Template: ${template.templateName}` });
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

      const finalTitle = generateCombinedTitle(activeBuilderTypes);

      const htmlBody = `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3>Radiology Report: ${finalTitle}</h3>
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
          title: finalTitle,
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

    let structuredContext = "";
    if (activeBuilderTypes.length > 0) {
      structuredContext = `\nActive Structured Modality/Body Builders: ${activeBuilderTypes.join(", ")}.\nStructured Selections Context: ${JSON.stringify(multiSelections)}`;
    }
    if (selectedChocolateFindings.length > 0) {
      structuredContext += `\nSelected Findings Chocolate Box Tiles: ${selectedChocolateFindings.map(f => `${f.shortName} (${f.findingText})`).join("; ")}`;
    }

    try {
      const res = await api.post<{ aiResponse: string }>("/api/ai-reporting/query", {
        promptText: `As a radiologist, generate a professional draft report for this ${study.modality} study. Clinical History: ${clinicalHistory}. Findings/Observations: ${rawFindings}.${structuredContext}`,
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
                      <div>
                        <p className="text-slate-500 text-[10px]">Report Status</p>
                        <Badge variant="outline" className="mt-0.5 text-slate-300 border-slate-700 bg-slate-950 font-mono">
                          {study.status || "DRAFT"}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">PACS Archival Status</p>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          {study.pacsArchiveStatus === "success" && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              ✓ Archived to PACS
                            </Badge>
                          )}
                          {(study.pacsArchiveStatus === "pending" || study.pacsArchiveStatus === "REPORT_FINAL") && (
                            <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                              Pending PACS Archive
                            </Badge>
                          )}
                          {study.pacsArchiveStatus === "failed" && (
                            <Badge className="bg-red-500/10 text-red-400 border border-red-500/20">
                              Archive Failed
                            </Badge>
                          )}
                          {(!study.pacsArchiveStatus || study.pacsArchiveStatus === "none") && (
                            <Badge variant="outline" className="text-slate-400 border-slate-800">
                              Not Archived
                            </Badge>
                          )}
                          
                          {(study.pacsArchiveStatus === "failed" || study.pacsArchiveStatus === "none" || !study.pacsArchiveStatus) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-2 text-[9px] text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 flex items-center gap-1"
                              onClick={async () => {
                                try {
                                  toast({ title: "Retrying archive...", description: "Uploading report to PACS..." });
                                  const res = await api.post<{ success: boolean; error?: string }>(`/api/radiology/studies/${study.studyId}/archive-retry`, {});
                                  if (res.success) {
                                    toast({ title: "Archived", description: "Report successfully archived to PACS!" });
                                    qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] });
                                  } else {
                                    toast({ title: "Archive Failed", description: res.error || "Unknown error occurred", variant: "destructive" });
                                    qc.invalidateQueries({ queryKey: ["workspace-entry", activeStudyId] });
                                  }
                                } catch (err: any) {
                                  toast({ title: "Error", description: err.message, variant: "destructive" });
                                }
                              }}
                            >
                              <RefreshCw size={8} /> Retry
                            </Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px]">Study Instance UID / ID</p>
                        <p className="font-mono text-[10px] text-slate-400 break-all select-all">
                          {study.studyInstanceUID || "—"}
                        </p>
                        {!study.studyInstanceUID && (
                          <p className="text-red-400 font-semibold text-[10px] mt-1 flex items-center gap-1">
                            <AlertCircle size={10} className="shrink-0 animate-bounce" />
                            Study UID missing; viewer launch may not work.
                          </p>
                        )}
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
                      disabled={!study}
                    >
                      <Tv2 size={12} className="mr-1.5 text-blue-400" /> Weasis
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      onClick={() => launchViewer(study?.studyInstanceUID, "OHIF", pacsViewerSettings, toast)}
                      disabled={!study}
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

              {/* 4. RIGHT PANEL: Structured Reporting & Context Assistant */}
              <div className="w-80 border-slate-800 bg-slate-950 overflow-y-auto p-4 flex flex-col gap-4">
                <Tabs defaultValue="structured" className="flex flex-col flex-1 gap-3 overflow-hidden">
                  <TabsList className="grid grid-cols-5 bg-slate-900/60 p-1 border border-slate-800 rounded-lg shrink-0">
                    <TabsTrigger value="quick-findings" className="text-[10px] py-1 px-1 flex items-center justify-center gap-1">
                      <Grid size={11} className="text-emerald-400" />
                      Quick Box
                    </TabsTrigger>
                    <TabsTrigger value="structured" className="text-[10px] py-1 px-1">Findings</TabsTrigger>
                    <TabsTrigger value="templates" className="text-[10px] py-1 px-1">Templates</TabsTrigger>
                    <TabsTrigger value="preferences" className="text-[10px] py-1 px-1 flex items-center justify-center gap-1">
                      <Star size={11} className="text-yellow-500" />
                      My Prefs
                    </TabsTrigger>
                    <TabsTrigger value="quality" className="text-[10px] py-1 px-1 flex items-center justify-center gap-1">
                      QA
                      {qualityWarnings.length > 0 && (
                        <Badge className="bg-amber-500 text-slate-950 font-bold px-1.5 h-3.5 text-[8px] flex items-center justify-center rounded-full">
                          {qualityWarnings.length}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  {/* TAB 0: QUICK FINDINGS CHOCOLATE BOX */}
                  <TabsContent value="quick-findings" className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono flex items-center gap-1">
                        <Grid size={12} />
                        Quick Findings Box
                      </span>
                      <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-950/40 bg-emerald-950/20">
                        {study ? `${study.modality} - ${study.bodyPart || "General"}` : "General"}
                      </Badge>
                    </div>

                    <ChocolateBoxPanel
                      modality={study?.modality || "MR"}
                      bodyPart={study?.bodyPart || "Brain"}
                      currentUserId={session?.user?.id}
                      userRole={session?.user?.role}
                      selectedFindingsList={selectedChocolateFindings}
                      onSelectFinding={(finding) => {
                        const exists = selectedChocolateFindings.some((s) => s.id === finding.id);
                        let nextList: ChocolateFinding[];
                        if (exists) {
                          nextList = selectedChocolateFindings.filter((s) => s.id !== finding.id);
                          // Remove finding text
                          setRawFindings((prev) => prev.replace(finding.findingText, "").trim());
                          // Remove impression text
                          if (finding.impressionText) {
                            setImpression((prev) => prev.filter((imp) => imp !== finding.impressionText));
                          }
                          if (finding.isCritical) {
                            setIsCritical(false);
                          }
                        } else {
                          nextList = [...selectedChocolateFindings, finding];
                          // Append finding text
                          setRawFindings((prev) => {
                            const separator = prev ? "\n\n" : "";
                            return prev + separator + finding.findingText;
                          });
                          // Suggest impression text
                          if (finding.impressionText) {
                            setImpression((prev) => {
                              const filtered = prev.filter(Boolean);
                              if (!filtered.includes(finding.impressionText!)) {
                                return [...filtered, finding.impressionText!];
                              }
                              return prev;
                            });
                          }
                          if (finding.isCritical) {
                            setIsCritical(true);
                            if (finding.shortName) setCriticalNote(finding.shortName);
                          }
                        }
                        setSelectedChocolateFindings(nextList);
                      }}
                    />
                  </TabsContent>

                  {/* TAB 1: STRUCTURED FINDINGS BUILDER */}
                  <TabsContent value="structured" className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono flex items-center gap-1">
                        <Construction size={12} />
                        Findings Builder
                      </span>
                      {activeBuilder && (
                        <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-950/40 bg-emerald-950/20">
                          {activeBuilder.label}
                        </Badge>
                      )}
                    </div>

                    {/* Active Builder Selector / Body Part Map (Multi-select) */}
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 uppercase font-bold">Body Part Map (Multi-select)</label>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto border border-slate-800 rounded p-1.5 bg-slate-900/30">
                        {ALL_BUILDERS.map((b) => {
                          const isSelected = activeBuilderTypes.includes(b.type);
                          return (
                            <button
                              key={b.type}
                              onClick={() => {
                                setSelectedBuilders((prev) => {
                                  const next = prev.includes(b.type)
                                    ? prev.filter((t) => t !== b.type)
                                    : [...prev, b.type];
                                  
                                  // Initialize selections for newly added builder
                                  if (!multiSelections[b.type]) {
                                    setMultiSelections(ms => ({
                                      ...ms,
                                      [b.type]: defaultSelections(b.type)
                                    }));
                                  }
                                  return next;
                                });
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${isSelected ? "bg-emerald-600/20 border-emerald-500 text-emerald-400 font-semibold" : "bg-slate-950 border-slate-850 text-slate-400 hover:bg-slate-900"}`}
                            >
                              {b.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeBuilderTypes.length > 0 ? (
                      <div className="space-y-3 flex-1 flex flex-col">
                        {/* Selections Builder Inputs for all active builders */}
                        <div className="space-y-3 flex-1 overflow-y-auto max-h-[300px] border border-slate-900 rounded p-2 bg-slate-900/30">
                          {activeBuilderTypes.map((bType) => {
                            const builder = getBuilderForType(bType);
                            if (!builder) return null;
                            const sel = multiSelections[bType] || defaultSelections(bType);
                            return (
                              <div key={bType} className="space-y-2 border border-slate-800/80 rounded p-2 bg-slate-905/30">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                                  <span className="text-[10px] font-bold text-emerald-400 uppercase font-mono">{builder.label}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-4 w-4 text-slate-500 hover:text-slate-200"
                                    onClick={() => {
                                      setMultiSelections(prev => ({
                                        ...prev,
                                        [bType]: defaultSelections(bType)
                                      }));
                                    }}
                                    title="Reset this section"
                                  >
                                    <RotateCcw size={10} />
                                  </Button>
                                </div>
                                {builder.sections.map((section) => {
                                  const isSectionStarred = starredFindings.includes(section.id);
                                  return (
                                    <div key={section.id} className="border border-slate-850 rounded p-2 space-y-1.5 bg-slate-950/40 relative">
                                      <div className="flex items-center justify-between border-b border-slate-800/60 pb-1">
                                        <span className="text-[9px] font-semibold text-slate-300">{section.label}</span>
                                        <button
                                          onClick={() => toggleStarFinding(section.id)}
                                          className={`p-0.5 hover:text-yellow-400 transition-colors ${isSectionStarred ? "text-yellow-500" : "text-slate-600"}`}
                                        >
                                          <Star size={10} fill={isSectionStarred ? "currentColor" : "none"} />
                                        </button>
                                      </div>
                                      <div className="space-y-2">
                                        {section.fields.map((field) => (
                                          <div key={field.id} className="space-y-1">
                                            {field.type === "checkbox" ? (
                                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input
                                                  type="checkbox"
                                                  className="h-3 w-3 rounded border-slate-800 bg-slate-900 text-emerald-600 focus:ring-0 focus:ring-offset-0"
                                                  checked={sel[field.id] === true}
                                                  onChange={(e) => {
                                                    setMultiSelections((prev) => ({
                                                      ...prev,
                                                      [bType]: { ...(prev[bType] || {}), [field.id]: e.target.checked }
                                                    }));
                                                    setRecentFindings((prev) => [field.id, ...prev.filter((x) => x !== field.id)].slice(0, 5));
                                                  }}
                                                />
                                                <span className="text-xs text-slate-300">{field.label}</span>
                                              </label>
                                            ) : field.type === "select" ? (
                                              <div className="space-y-0.5">
                                                <span className="text-[9px] text-slate-500 font-medium">{field.label}</span>
                                                <select
                                                  className="w-full text-[11px] border border-slate-800 rounded bg-slate-900 text-slate-200 h-6 px-1.5 focus:outline-none"
                                                  value={sel[field.id] || ""}
                                                  onChange={(e) => {
                                                    setMultiSelections((prev) => ({
                                                      ...prev,
                                                      [bType]: { ...(prev[bType] || {}), [field.id]: e.target.value }
                                                    }));
                                                    setRecentFindings((prev) => [field.id, ...prev.filter((x) => x !== field.id)].slice(0, 5));
                                                  }}
                                                >
                                                  <option value="">-- Normal / None --</option>
                                                  {field.options?.map((opt) => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                  ))}
                                                </select>
                                              </div>
                                            ) : field.type === "multiselect" ? (
                                              <div className="space-y-1">
                                                <span className="text-[9px] text-slate-500 font-medium block">{field.label}</span>
                                                <div className="flex flex-wrap gap-1">
                                                  {field.options?.map((opt) => {
                                                    const active = (sel[field.id] || []).includes(opt);
                                                    return (
                                                      <button
                                                        key={opt}
                                                        onClick={() => {
                                                          const arr = [...(sel[field.id] || [])];
                                                          const idx = arr.indexOf(opt);
                                                          if (idx > -1) arr.splice(idx, 1); else arr.push(opt);
                                                          setMultiSelections((prev) => ({
                                                            ...prev,
                                                            [bType]: { ...(prev[bType] || {}), [field.id]: arr }
                                                          }));
                                                          setRecentFindings((prev) => [field.id, ...prev.filter((x) => x !== field.id)].slice(0, 5));
                                                        }}
                                                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${active ? "bg-emerald-600/20 border-emerald-500 text-emerald-400 font-semibold" : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-850"}`}
                                                      >
                                                        {opt}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="space-y-0.5">
                                                <span className="text-[9px] text-slate-500 font-medium block">{field.label} {field.unit ? `(${field.unit})` : ""}</span>
                                                <Input
                                                  type={field.type === "number" ? "number" : "text"}
                                                  placeholder={field.placeholder || "Enter value..."}
                                                  value={sel[field.id] !== undefined ? sel[field.id] : ""}
                                                  onChange={(e) => {
                                                    const val = field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
                                                    setMultiSelections((prev) => ({
                                                      ...prev,
                                                      [bType]: { ...(prev[bType] || {}), [field.id]: val }
                                                    }));
                                                  }}
                                                  className="h-6 text-xs bg-slate-900 border-slate-800 text-slate-200"
                                                />
                                              </div>
                                            )}
                                          </div>
                                         ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>

                                {/* Recent Findings Selection Tags */}
                                {recentFindings.length > 0 && (
                                  <div className="space-y-1">
                                    <span className="text-[9px] text-slate-500 uppercase font-bold">Recently Used Selections</span>
                                    <div className="flex flex-wrap gap-1">
                                      {recentFindings.map((fKey, i) => (
                                        <Badge key={i} variant="secondary" className="text-[9px] bg-slate-900 border-slate-800 text-slate-400">
                                          {fKey}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Structured generation triggers */}
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-900">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const report = generateMultiStudyReport(activeBuilderTypes, multiSelections);
                                      setRawFindings(report.findings);
                                      if (report.impression) setImpression([report.impression]);
                                      toast({ title: "Findings Auto-Generated", description: "Replaced editor fields with structured findings." });
                                    }}
                                    className="h-8 text-xs border-emerald-800/40 text-emerald-400 bg-emerald-950/20 hover:bg-emerald-950/40"
                                  >
                                    <Wand2 size={12} className="mr-1.5" />
                                    Over-write
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={appendSelectedFindings}
                                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                  >
                                    Merge Findings
                                  </Button>
                                </div>
                              </div>
                    ) : (
                      <p className="text-xs text-slate-500 text-center py-8">Select one or more body part maps to view selections.</p>
                    )}
                  </TabsContent>

                  {/* TAB 2: TEMPLATES & CONTEXT-AWARE ASSISTANT */}
                  <TabsContent value="templates" className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
                    {detectedContext ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="text-[11px] font-bold text-emerald-400 font-mono">{detectedContext} Context</span>
                          <Badge variant="outline" className="text-[9px] text-slate-500 border-slate-800">Auto-detected</Badge>
                        </div>

                        {/* Suggested templates based on context */}
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Suggested Templates</p>
                          <div className="flex flex-col gap-1.5">
                            {templates
                              .filter((t) => CONTEXT_MAPPING[detectedContext].templates.some((tpl) => t.templateName.includes(tpl)))
                              .map((t) => {
                                const starred = starredTemplates.includes(t.templateName);
                                return (
                                  <div key={t.id} className="flex gap-1.5 items-center w-full bg-slate-900/50 border border-slate-800 rounded p-1.5 group hover:border-emerald-500/35">
                                    <button
                                      onClick={() => applyTemplate(t)}
                                      className="flex-1 text-left text-xs text-slate-300 hover:text-emerald-400 truncate"
                                    >
                                      {t.templateName}
                                    </button>
                                    <button
                                      onClick={() => toggleStarTemplate(t.templateName)}
                                      className={`p-0.5 hover:text-yellow-400 transition-colors shrink-0 ${starred ? "text-yellow-500" : "text-slate-600 opacity-30 group-hover:opacity-100"}`}
                                    >
                                      <Star size={11} fill={starred ? "currentColor" : "none"} />
                                    </button>
                                  </div>
                                );
                              })}
                          </div>
                        </div>

                        {/* Starred templates quick access */}
                        {starredTemplates.length > 0 && (
                          <div className="space-y-2 border-t border-slate-900 pt-2.5">
                            <p className="text-[10px] font-bold text-yellow-500 uppercase flex items-center gap-1">
                              <Star size={10} fill="currentColor" /> Favorites
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {templates
                                .filter((t) => starredTemplates.includes(t.templateName))
                                .map((t) => (
                                  <button
                                    key={t.id}
                                    onClick={() => applyTemplate(t)}
                                    className="w-full text-left text-xs bg-slate-950 border border-slate-800/80 p-2 rounded hover:border-emerald-500/50 hover:bg-slate-900 transition-colors"
                                  >
                                    {t.templateName}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 border-t border-slate-900 pt-2.5">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Common Findings Macros</p>
                          <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
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

                        <div className="space-y-2 border-t border-slate-900 pt-2.5">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">Suggested Impressions</p>
                          <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
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
                    ) : (
                      <p className="text-xs text-slate-500 text-center py-8">Select a study to load template context options.</p>
                    )}

                    {/* Suggested templates based on Modality */}
                    <div className="space-y-2 border-t border-slate-900 pt-3 flex-1">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">All Modality Templates</p>
                      <div className="flex flex-col gap-1.5 max-h-[150px] overflow-y-auto">
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
                  </TabsContent>

                  {/* TAB 3: QUALITY ASSURANCE & CHECKLIST */}
                  <TabsContent value="quality" className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[11px] font-bold text-amber-400 font-mono flex items-center gap-1">
                        <AlertCircle size={12} />
                        Quality Pre-Flight Checks
                      </span>
                      {qualityWarnings.length === 0 && (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px]">Verified</Badge>
                      )}
                    </div>

                    <div className="space-y-2 flex-1">
                      {qualityWarnings.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[10px] text-slate-400 font-semibold">The following warnings should be reviewed before finalizing:</p>
                          <div className="space-y-1.5">
                            {qualityWarnings.map((warning, i) => (
                              <div key={i} className="flex gap-2 items-start border border-amber-900/30 bg-amber-950/10 p-2 rounded text-[11px] text-amber-300">
                                <AlertTriangle size={12} className="shrink-0 text-amber-500 mt-0.5" />
                                <span>{warning}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
                          <CheckCircle2 size={32} className="text-emerald-500 animate-pulse" />
                          <p className="text-xs font-semibold text-slate-300">Report Integrity Looks Excellent</p>
                          <p className="text-[10px] text-slate-500 max-w-xs">No missing templates, empty findings, contradictory reports, or measurements warning indicators were flagged.</p>
                        </div>
                      )}
                    </div>

                    {/* Critical communication checklist */}
                    {isCritical && (
                      <div className="border border-rose-950/40 bg-rose-950/10 rounded-lg p-3 space-y-2.5 mt-auto">
                        <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                          <AlertOctagon size={12} />
                          Critical Communication Checklist
                        </span>
                        <div className="space-y-2 text-xs">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checklistComm.phoned}
                              onChange={(e) => setChecklistComm((prev) => ({ ...prev, phoned: e.target.checked }))}
                              className="h-3.5 w-3.5 rounded border-slate-800 bg-slate-900 text-rose-600 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-slate-300">Physician Notified via Telephone</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checklistComm.annotated}
                              onChange={(e) => setChecklistComm((prev) => ({ ...prev, annotated: e.target.checked }))}
                              className="h-3.5 w-3.5 rounded border-slate-800 bg-slate-900 text-rose-600 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-slate-300">Critical Annotation Marked on PACS</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checklistComm.dispatched}
                              onChange={(e) => setChecklistComm((prev) => ({ ...prev, dispatched: e.target.checked }))}
                              className="h-3.5 w-3.5 rounded border-slate-800 bg-slate-900 text-rose-600 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-slate-300">Emergency Acknowledge Audited</span>
                          </label>
                        </div>
                        {checklistComm.phoned && checklistComm.annotated && checklistComm.dispatched && (
                          <div className="text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/35 p-1 rounded text-center">
                            ✓ Communication fully documented & archived.
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* TAB 4: MY PREFERENCES (Favorites & Macros) */}
                  <TabsContent value="preferences" className="flex-1 flex flex-col gap-3 overflow-y-auto min-h-0">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-[11px] font-bold text-emerald-400 font-mono flex items-center gap-1">
                        <Star size={12} fill="currentColor" className="text-yellow-500" />
                        My Pinned & Macros
                      </span>
                    </div>

                    <PreferencesPanel
                      currentUserId={session?.user?.id}
                      onApplyTemplate={(tpl) => {
                        const target = templates.find((t) => t.templateName === tpl);
                        if (target) applyTemplate(target);
                      }}
                      onInsertFindingText={(txt) => {
                        setRawFindings((prev) => {
                          const separator = prev ? "\n\n" : "";
                          return prev + separator + txt;
                        });
                        toast({ title: "Macro Expanded" });
                      }}
                      onInsertImpressionPoint={(txt) => {
                        setImpression((prev) => {
                          const filtered = prev.filter(Boolean);
                          if (!filtered.includes(txt)) {
                            return [...filtered, txt];
                          }
                          return prev;
                        });
                        toast({ title: "Impression Inserted" });
                      }}
                    />
                  </TabsContent>
                </Tabs>
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

              {/* Dynamic Composition Section */}
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-wrap gap-4 items-center justify-between">
                <div className="flex-1 min-w-[200px]">
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">Dynamic Combined Title</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono tracking-wide">{generateCombinedTitle(activeBuilderTypes)}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                    onClick={() => {
                      setTechnique(generateCombinedTechnique(activeBuilderTypes));
                      toast({ title: "Technique Merged", description: "Dynamic technique text loaded into technique field." });
                    }}
                  >
                    <RefreshCw size={12} className="mr-1.5" /> Merge Technique
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
                      onChange={handleFindingsChange}
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
                          onChange={(e) => handleImpressionLineChange(i, e.target.value)}
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
                    disabled={saveDraftMutation.isPending || isViewOnly}
                  >
                    <Save size={12} className="mr-1.5" />
                    Save Draft {isViewOnly && "(Disabled)"}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    onClick={() => {
                      if (confirm("Are you sure you want to finalize this report?")) {
                        finalizeMutation.mutate();
                      }
                    }}
                    disabled={finalizeMutation.isPending || isViewOnly}
                  >
                    <CheckCircle2 size={12} className="mr-1.5" />
                    Finalize Report {isViewOnly && "(Disabled)"}
                  </Button>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Lock Takeover Modal / Overlay */}
      {takeoverOpen && currentLockOwner && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle className="h-6 w-6 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-200">Concurrent Reporting Alert</h3>
            </div>
            
            <p className="text-sm text-slate-400">
              This study is currently locked for reporting by <span className="font-semibold text-slate-200">{currentLockOwner.userName}</span> (Workstation: {currentLockOwner.workstation || "Unknown"}) since {currentLockOwner.lockTime ? new Date(currentLockOwner.lockTime).toLocaleTimeString() : "some time"}.
            </p>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/60 text-xs text-slate-500">
              <span className="font-semibold block text-slate-400 mb-1">Takeover / View Only Policy:</span>
              To prevent accidental report overwrites and duplicate reporting, you are in <span className="text-red-400 font-semibold">View-Only</span> mode.
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                className="w-full text-xs h-9 bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-300"
                onClick={() => setTakeoverOpen(false)}
              >
                Continue in View Only Mode
              </Button>

              <Button
                variant="outline"
                className="w-full text-xs h-9 border-slate-800 text-slate-300 hover:bg-slate-900 flex items-center justify-center gap-1.5"
                onClick={async () => {
                  try {
                    // Send notification to lock owner (mock or audit log based)
                    await api.post(`/api/radiology/knowledge/analytics/usage`, {
                      action: "LOCK_RELEASE_REQUESTED",
                      details: JSON.stringify({
                        studyId: activeStudyId,
                        requestedBy: session?.user?.name,
                        lockOwner: currentLockOwner.userName
                      })
                    });
                    toast({
                      title: "Release Request Logged",
                      description: `Logged a request to release study lock for ${currentLockOwner.userName}. Please contact them.`
                    });
                  } catch (err: any) {
                    toast({ title: "Request failed", description: err.message, variant: "destructive" });
                  }
                }}
              >
                Request Lock Release
              </Button>

              {(session?.user?.role === "admin" || session?.user?.role === "super_admin") && (
                <Button
                  className="w-full text-xs h-9 bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center justify-center gap-1.5"
                  onClick={async () => {
                    if (confirm(`ADMIN OVERRIDE: Break lock held by ${currentLockOwner.userName}?`)) {
                      try {
                        const res = await api.post<{ success: boolean; error?: string; lock?: any }>(
                          `/api/radiology/studies/${activeStudyId}/lock`,
                          { force: true, workstation: window.location.hostname || "WebBrowser" }
                        );
                        if (res.success) {
                          setIsViewOnly(false);
                          setTakeoverOpen(false);
                          setCurrentLockOwner(null);
                          toast({ title: "Lock Overridden", description: "You have acquired the lock. Draft is now editable." });
                        }
                      } catch (err: any) {
                        toast({ title: "Override failed", description: err.message, variant: "destructive" });
                      }
                    }
                  }}
                >
                  Force Admin Override
                </Button>
              )}
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
