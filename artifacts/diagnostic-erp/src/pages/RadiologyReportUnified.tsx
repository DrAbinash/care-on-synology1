import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession, isFeatureEnabled } from "@/lib/staffSession";
import { detectStudyContext } from "@/lib/radiologyQuickAddData";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import PremiumReportViewer from "@/components/PremiumReportViewer";
import RadiologyProductivityPanel from "@/components/RadiologyProductivityPanel";
import RadiologyKnowledgePanel from "@/components/RadiologyKnowledgePanel";
import RadiologySmartFindingsPanel from "@/components/RadiologySmartFindingsPanel";
import RadiologyAICopilotPanel from "@/components/RadiologyAICopilotPanel";
import {
  runQualityCheck, detectConflicts, suggestSmartImpression, classifyPriority,
  PRIORITY_META,
  type QualityCheck, type Conflict, type Priority,
} from "@/lib/radiologyIntelligenceEngine";
import {
  ALL_MASTER_TEMPLATES, findMasterTemplateById, findMasterVariant, assembleReport,
  type MasterTemplate, type MasterTemplateVariant, type AssembledReport,
} from "@/lib/radiologyMasterTemplates";
import {
  ALL_MEASUREMENT_TEMPLATES, MEASUREMENT_CATEGORIES, findMeasurementById,
  type MeasurementTemplate,
} from "@/lib/radiologyMeasurementLibrary";
import {
  ONE_CLICK_REPORTS, searchOneClickReports, findOneClickReport, runQAGuard, detectCriticalFindings, detectFindingsFromText,
  type OneClickReport, type QAGuardResult, type CriticalFinding, type DetectedFinding,
} from "@/lib/radiologyReportAssembler";
import {
  ArrowLeft, ExternalLink, MonitorPlay, Save, CheckCircle2, AlertTriangle,
  RefreshCw, FileText, Sparkles, ChevronDown, ChevronUp, Download, Settings2,
  ClipboardPaste, RotateCcw, X, ThumbsUp, ThumbsDown,
  Zap, Star, History, Plus, HelpCircle, Keyboard, Command,
  Brain, ShieldCheck, BarChart3, Lightbulb, GitCompare, Construction,
  Volume2, VolumeX, BookOpen, Ruler, Layers, Bot,
  FolderOpen, UserCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorklistEntry {
  id: number;
  studyId: number | null;
  patientId: number | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  referringDoctor: string | null;
  status: string;
  aiDraftStatus: string;
  aiDraftJson: string | null;
  reportId: number | null;
  deliveryStatus: string | null;
}

interface ViewerLaunchData {
  studyInstanceUID: string;
  patientName?: string | null;
  accessionNumber?: string | null;
  ohifUrl?: string | null;
  dicomWebBaseUrl?: string | null;
  pacsType?: string;
  error?: string;
}

interface ReportTemplate {
  id: string;
  label: string;
  category: string;
  modality: string;
  bodyPart?: string;
  normalText: string;
}

interface DicomMeasurement {
  id: number;
  source: string;
  overallConfidence: string;
  status: string;
  // Fetal
  bpd?: string | null; bpdConfidence?: string | null;
  hc?: string | null; hcConfidence?: string | null;
  ac?: string | null; acConfidence?: string | null;
  fl?: string | null; flConfidence?: string | null;
  crl?: string | null; crlConfidence?: string | null;
  efw?: string | null; efwConfidence?: string | null;
  ga?: string | null; gaConfidence?: string | null;
  edd?: string | null; eddConfidence?: string | null;
  fhr?: string | null; fhrConfidence?: string | null;
  placentaPosition?: string | null;
  liquorAfi?: string | null;
  fetalPresentation?: string | null;
  // Pelvic
  uterusSize?: string | null; uterusSizeConfidence?: string | null;
  endometrium?: string | null; endometriumConfidence?: string | null;
  rightOvary?: string | null; rightOvaryConfidence?: string | null;
  leftOvary?: string | null; leftOvaryConfidence?: string | null;
  follicles?: string | null;
  adnexalLesion?: string | null;
  // Abdominal
  liverSize?: string | null; liverSizeConfidence?: string | null;
  spleenSize?: string | null; spleenSizeConfidence?: string | null;
  rightKidney?: string | null; rightKidneyConfidence?: string | null;
  leftKidney?: string | null; leftKidneyConfidence?: string | null;
  cbd?: string | null; cbdConfidence?: string | null;
  gbWall?: string | null; gbWallConfidence?: string | null;
  prostateVolume?: string | null; prostateVolumeConfidence?: string | null;
}

function measurementRows(m: DicomMeasurement): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (m.bpd) rows.push({ label: "BPD", value: m.bpd });
  if (m.hc) rows.push({ label: "HC", value: m.hc });
  if (m.ac) rows.push({ label: "AC", value: m.ac });
  if (m.fl) rows.push({ label: "FL", value: m.fl });
  if (m.crl) rows.push({ label: "CRL", value: m.crl });
  if (m.efw) rows.push({ label: "EFW", value: m.efw });
  if (m.ga) rows.push({ label: "GA", value: m.ga });
  if (m.edd) rows.push({ label: "EDD", value: m.edd });
  if (m.fhr) rows.push({ label: "FHR", value: m.fhr });
  if (m.placentaPosition) rows.push({ label: "Placenta", value: m.placentaPosition });
  if (m.liquorAfi) rows.push({ label: "Liquor AFI", value: m.liquorAfi });
  if (m.fetalPresentation) rows.push({ label: "Presentation", value: m.fetalPresentation });
  if (m.uterusSize) rows.push({ label: "Uterus size", value: m.uterusSize });
  if (m.endometrium) rows.push({ label: "Endometrium", value: m.endometrium });
  if (m.rightOvary) rows.push({ label: "Right ovary", value: m.rightOvary });
  if (m.leftOvary) rows.push({ label: "Left ovary", value: m.leftOvary });
  if (m.follicles) rows.push({ label: "Follicles", value: m.follicles });
  if (m.adnexalLesion) rows.push({ label: "Adnexal lesion", value: m.adnexalLesion });
  if (m.liverSize) rows.push({ label: "Liver size", value: m.liverSize });
  if (m.spleenSize) rows.push({ label: "Spleen size", value: m.spleenSize });
  if (m.rightKidney) rows.push({ label: "Right kidney", value: m.rightKidney });
  if (m.leftKidney) rows.push({ label: "Left kidney", value: m.leftKidney });
  if (m.cbd) rows.push({ label: "CBD", value: m.cbd });
  if (m.gbWall) rows.push({ label: "GB wall", value: m.gbWall });
  if (m.prostateVolume) rows.push({ label: "Prostate volume", value: m.prostateVolume });
  return rows;
}

interface NormalTemplate {
  id: string;
  label: string;
  body: string;
}

// ─── Modality mapping ───────────────────────────────────────────────────────

const MODALITY_LABELS: Record<string, string> = {
  US: "USG", USG: "USG", "US+D": "USG Doppler", "US D": "USG Doppler",
  MR: "MRI", MRI: "MRI", CT: "CT Scan", CR: "X-Ray", DX: "X-Ray",
  MG: "Mammography", BMD: "DEXA", OT: "Other",
  "EC": "Echo", "ECHO": "Echo", "FE": "Fetal Echo", "FETAL": "Fetal USG",
};

function modalityLabel(m: string): string {
  return MODALITY_LABELS[m] || m;
}

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  STUDY_RECEIVED: "Received", AI_DRAFT_READY: "AI Draft",
  REPORT_IN_PROGRESS: "In Progress", REPORT_FINAL: "Final",
  DELIVERED: "Delivered",
};

function statusColor(s: string): string {
  switch (s) {
    case "STUDY_RECEIVED": return "bg-blue-100 text-blue-700 border-blue-200";
    case "AI_DRAFT_READY": return "bg-purple-100 text-purple-700 border-purple-200";
    case "REPORT_IN_PROGRESS": return "bg-amber-100 text-amber-700 border-amber-200";
    case "REPORT_FINAL": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "DELIVERED": return "bg-gray-100 text-gray-600 border-gray-200";
    default: return "bg-gray-100 text-gray-600";
  }
}

// Phase 2D: Priority badge sub-component
function PriorityBadge({ findings, impression }: { findings: string; impression: string }) {
  const priority = classifyPriority(findings, impression);
  const meta = PRIORITY_META[priority];
  return (
    <Badge className={`text-[10px] h-4 px-1 ${meta.bg} ${meta.color}`} title={`Auto-classified: ${meta.label}`}>
      {meta.label}
    </Badge>
  );
}

// ─── Normal templates (built-in) ────────────────────────────────────────────

const NORMAL_TEMPLATES: Record<string, NormalTemplate[]> = {
  US: [
    { id: "usg-abdomen", label: "Abdomen – Normal", body: "LIVER: Normal in size, shape, and echotexture. No focal lesion.\nGALLBLADDER: Normal wall thickness. No calculus.\nPANCREAS: Normal.\nSPLEEN: Normal size.\nKIDNEYS: Both normal size. No hydronephrosis / calculus.\nBLADDER: Normal wall.\nPROSTATE (if male): Normal size.\nUTERUS / OVARIES (if female): Normal size. No mass.\nFree fluid: Not seen.\nIMPRESSION: Normal ultrasound study of abdomen." },
    { id: "usg-kub", label: "KUB – Normal", body: "RIGHT KIDNEY: Normal size and echotexture. No hydronephrosis / calculus.\nLEFT KIDNEY: Normal size and echotexture. No hydronephrosis / calculus.\nURINARY BLADDER: Normal wall thickness. No calculus.\nPROSTATE: Normal size.\nIMPRESSION: Normal study of KUB." },
    { id: "usg-pelvis", label: "Pelvis – Normal", body: "UTERUS: Normal size, shape, and echotexture. Endometrial thickness normal.\nRIGHT OVARY: Normal size. No cyst / mass.\nLEFT OVARY: Normal size. No cyst / mass.\nFree fluid: Not seen.\nIMPRESSION: Normal pelvic ultrasound." },
    { id: "usg-obstetric", label: "Obstetric – Normal", body: "Singleton intrauterine pregnancy seen.\nFetal cardiac activity present.\nCrown-rump length corresponds to gestational age.\nAmniotic fluid: Adequate.\nPlacenta: Anterior/fundal, grade appropriate.\nNo obvious structural anomaly seen.\nIMPRESSION: Normal early pregnancy." },
  ],
  "US+D": [
    { id: "doppler-abd", label: "Doppler Abd – Normal", body: "ABDOMINAL AORTA: Normal caliber, no aneurysm.\nIVC: Patent, no thrombus.\nPORTAL VEIN: Normal flow direction and velocity.\nHEPATIC ARTERY: Normal waveform.\nRENAL ARTERIES: Normal flow bilaterally. RI normal.\nIMPRESSION: Normal abdominal Doppler study." },
  ],
  MR: [
    { id: "mri-brain", label: "Brain – Normal", body: "BRAIN PARENCHYMA: Normal signal intensity on all sequences.\nNo evidence of mass lesion, hemorrhage, or infarct.\nVENTRICLES: Normal size and configuration.\nMIDLINE: No shift.\nEXTRACRANIAL SOFT TISSUES: Normal.\nIMPRESSION: Normal MRI brain study." },
  ],
  CT: [
    { id: "ct-brain", label: "Brain – Normal", body: "BRAIN PARENCHYMA: Normal attenuation. No focal lesion.\nVENTRICLES: Normal size.\nMIDLINE: Not shifted.\nBONE WINDOW: Normal calvarium. No fracture.\nIMPRESSION: Normal CT brain." },
  ],
  CR: [
    { id: "xray-chest", label: "Chest – Normal", body: "LUNG FIELDS: Clear bilaterally.\nCARDIAC SILHOUETTE: Normal size.\nMEDIASTINUM: Normal width.\nCOSTOPHRENIC ANGLES: Sharp bilaterally.\nBONY THORAX: No fracture.\nIMPRESSION: Normal chest X-ray." },
  ],
};

function getNormalTemplates(modality: string): NormalTemplate[] {
  return NORMAL_TEMPLATES[modality] || NORMAL_TEMPLATES["US"] || [];
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RadiologyReportUnified() {
  const { worklistId } = useParams<{ worklistId: string }>();
  const id = Number(worklistId);
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [reportBody, setReportBody] = useState("");
  const [impression, setImpression] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [showNormalPicker, setShowNormalPicker] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [showViewer, setShowViewer] = useState(true);
  const [showAiDraft, setShowAiDraft] = useState(false);
  const [rawFindings, setRawFindings] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  // ── Feature flags ── (Phase 2C: check new names first, then legacy names)
  const ffMeasurementPanel = isFeatureEnabled("radiologyMeasurements") || isFeatureEnabled("showMeasurementPanel");
  const ffAiDraftPanel = isFeatureEnabled("radiologyAiAssistant") || isFeatureEnabled("showAiDraftPanel");
  const ffQuickAdd = isFeatureEnabled("radiologyQuickAdd") || isFeatureEnabled("showQuickAddButtons");
  const ffSmartFormat = isFeatureEnabled("radiologySmartFormat") || isFeatureEnabled("showSmartFormatBuilder");
  const ffMacros = isFeatureEnabled("radiologyMacros") || isFeatureEnabled("showRadiologyMacros");
  const ffPreviousReport = isFeatureEnabled("radiologyPreviousReports") || isFeatureEnabled("showPreviousReportPanel");
  const ffFavorites = isFeatureEnabled("radiologyFavorites") || isFeatureEnabled("showFavoritesLibrary");

  // ── Phase 2D Intelligence flags ──
  const ffStructuredFindings = isFeatureEnabled("radiologyStructuredFindings");
  const ffImpressionSync = isFeatureEnabled("radiologyImpressionSync");
  const ffConflictDetection = isFeatureEnabled("radiologyConflictDetection");
  const ffQualityChecker = isFeatureEnabled("radiologyQualityChecker");
  const ffSmartImpression = isFeatureEnabled("radiologySmartImpression");
  const ffMeasurementLibrary = isFeatureEnabled("radiologyMeasurementLibrary");
  const ffPriorityEngine = isFeatureEnabled("radiologyPriorityEngine");
  const ffComparison = isFeatureEnabled("radiologyComparison");
  const ffFavoritesPack = isFeatureEnabled("radiologyFavoritesPack");
  const ffKnowledgeBase = isFeatureEnabled("radiologyKnowledgeBase");
  const ffVersionHistory = isFeatureEnabled("radiologyVersionHistory");
  const ffAnalytics = isFeatureEnabled("radiologyAnalytics");

  // ── Phase 3: Premium Workstation flags ──
  const ffMasterLibrary = isFeatureEnabled("radiologyMasterLibrary");
  const ffOneClickReports = isFeatureEnabled("radiologyOneClickReports");
  const ffAdvancedMeasurements = isFeatureEnabled("radiologyAdvancedMeasurements");
  const ffAiHooks = isFeatureEnabled("radiologyAiHooks");
  const ffReportAssembler = isFeatureEnabled("radiologyReportAssembler");
  const ffQAGuard = isFeatureEnabled("radiologyQAGuard");
  const ffFinalizationDashboard = isFeatureEnabled("radiologyFinalizationDashboard");

  // Phase 4: Knowledge Platform flags
  const ffKnowledgePlatform = isFeatureEnabled("radiologyKnowledgePlatform");
  const ffMasterTemplates = isFeatureEnabled("radiologyMasterTemplates");
  const ffPersonalLibrary = isFeatureEnabled("radiologyPersonalLibrary");
  const ffTemplatePacks = isFeatureEnabled("radiologyTemplatePacks");
  const ffKnowledgeBase_v2 = isFeatureEnabled("radiologyKnowledgeBase_v2");
  const ffSignOffProfiles = isFeatureEnabled("radiologySignOffProfiles");
  const ffTemplateAnalytics = isFeatureEnabled("radiologyTemplateAnalytics");

  // Phase 5: Structured Smart Reporting Engine flags
  const ffSmartFindings = isFeatureEnabled("radiologySmartFindings_v2");
  const ffImpressionRules = isFeatureEnabled("radiologyImpressionRules");
  const ffFavoriteFindingSets = isFeatureEnabled("radiologyFavoriteFindingSets");
  const ffSmartAnalytics = isFeatureEnabled("radiologySmartAnalytics");

  // Phase 6: AI Copilot flags
  const ffAICopilot = isFeatureEnabled("radiologyAICopilot");
  const ffDifferential = isFeatureEnabled("radiologyDifferentialDiagnosis");
  const ffFollowUp = isFeatureEnabled("radiologyFollowUp");
  const ffImageReview = isFeatureEnabled("radiologyImageReview");
  const ffComparePrevious = isFeatureEnabled("radiologyComparePrevious");
  const ffQualityCheck = isFeatureEnabled("radiologyQualityCheck");
  const ffLanguagePolish = isFeatureEnabled("radiologyLanguagePolish");

  // ── Panel visibility (local toggles, independent of flags) ──
  const [showQuickAddPanel, setShowQuickAddPanel] = useState(false);
  const [showSmartFormatPanel, setShowSmartFormatPanel] = useState(false);
  const [showMacroPanel, setShowMacroPanel] = useState(false);
  const [showPrevReportPanel, setShowPrevReportPanel] = useState(false);
  const [showFavPanel, setShowFavPanel] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem("radiologyTutorialSeen") !== "1";
    } catch { return false; }
  });

  // Phase 2D intelligence panel visibility
  const [showQualityPanel, setShowQualityPanel] = useState(false);
  const [showConflictPanel, setShowConflictPanel] = useState(false);
  const [showSmartImpPanel, setShowSmartImpPanel] = useState(false);
  const [showMeasurementLibPanel, setShowMeasurementLibPanel] = useState(false);
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);
  const [showComparisonPanel, setShowComparisonPanel] = useState(false);
  const [showFavPackPanel, setShowFavPackPanel] = useState(false);
  const [showVersionPanel, setShowVersionPanel] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Phase 3: Premium Workstation panel visibility
  const [showMasterPanel, setShowMasterPanel] = useState(false);
  const [showAdvancedMeasurementPanel, setShowAdvancedMeasurementPanel] = useState(false);
  const [showOneClickPanel, setShowOneClickPanel] = useState(false);
  const [showQAGuardPanel, setShowQAGuardPanel] = useState(false);
  const [showFinalizationPanel, setShowFinalizationPanel] = useState(false);

  // Phase 4: Knowledge Platform panel visibility
  const [showKnowledgeMasterPanel, setShowKnowledgeMasterPanel] = useState(false);
  const [showKnowledgePersonalPanel, setShowKnowledgePersonalPanel] = useState(false);
  const [showKnowledgePacksPanel, setShowKnowledgePacksPanel] = useState(false);
  const [showKnowledgeBasePanel, setShowKnowledgeBasePanel] = useState(false);
  const [showKnowledgeProfilePanel, setShowKnowledgeProfilePanel] = useState(false);
  const [showKnowledgeVersionsPanel, setShowKnowledgeVersionsPanel] = useState(false);
  const [showKnowledgeAnalyticsPanel, setShowKnowledgeAnalyticsPanel] = useState(false);
  const [knowledgePanel, setKnowledgePanel] = useState<string | null>(null);

  // Phase 5: Smart Findings panel visibility
  const [showSmartFindingsPanel, setShowSmartFindingsPanel] = useState(false);
  const [smartFindingsPanel, setSmartFindingsPanel] = useState<string | null>(null);

  // Phase 6: AI Copilot panel visibility
  const [showAICopilotPanel, setShowAICopilotPanel] = useState(false);
  const [aiCopilotTab, setAICopilotTab] = useState<string | null>(null);

  // ── Queries ──
  const { data: entry, isLoading: entryLoading } = useQuery<WorklistEntry>({
    queryKey: ["worklist-entry", id],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${id}`),
    enabled: !!id,
  });

  const { data: ohifData, isLoading: ohifLoading } = useQuery<ViewerLaunchData>({
    queryKey: ["ohif-launch", entry?.studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${entry!.studyInstanceUID}/ohif-launch`),
    enabled: !!entry?.studyInstanceUID,
    staleTime: 60_000,
  });

  const { data: measurements = [] } = useQuery<DicomMeasurement[]>({
    queryKey: ["usg-extraction", entry?.studyInstanceUID],
    queryFn: () => api.get(`/api/usg-extraction/study/${entry!.studyInstanceUID}`),
    enabled: !!entry?.studyInstanceUID,
  });

  const { data: clinicSettings } = useQuery<{ name?: string; tagline?: string; address?: string; phone?: string; email?: string; website?: string; logoDataUrl?: string | null }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  // ── Auto-populate from AI draft when entry loads ──
  useEffect(() => {
    if (!entry) return;
    const title = entry.studyDescription
      ? `${entry.studyDescription} — Report`
      : "Radiology Report";
    setReportTitle(title);
    if (entry.aiDraftJson) {
      try {
        const draft = JSON.parse(entry.aiDraftJson) as {
          formattedReportText?: string; impression?: string; title?: string;
        };
        if (draft.formattedReportText) setReportBody(draft.formattedReportText);
        if (draft.impression) setImpression(draft.impression);
        if (draft.title) setReportTitle(draft.title);
      } catch { /* ignore */ }
    }
  }, [entry]);

  // ── Keyboard shortcuts for productivity panels ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (entry?.status === "REPORT_FINAL" || entry?.status === "DELIVERED") return;
      const ta = document.activeElement as HTMLTextAreaElement | null;
      if (!ta || ta.tagName !== "TEXTAREA") return;

      // Quick Add: Alt+1 through Alt+6
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const digit = e.key;
        if (digit >= "1" && digit <= "6") {
          e.preventDefault();
          const ctx = detectStudyContext(entry?.modality || "", entry?.studyDescription, entry?.studyDescription, entry?.studyDescription);
          const btn = ctx?.buttons[Number(digit) - 1];
          if (btn) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const before = reportBody.slice(0, start);
            const after = reportBody.slice(end);
            const newText = before + btn.text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
            setReportBody(newText);
            if (btn.impression) setImpression((prev) => (prev ? prev + "\n" + btn.impression! : btn.impression!));
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + btn.text.length; ta.focus(); }, 0);
            toast({ title: `Quick Add: ${btn.label}`, description: btn.shortcut });
          }
        }
      }

      // Smart Format: Shift+Alt+1 through Shift+Alt+6
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const digit = e.key;
        if (digit >= "1" && digit <= "6") {
          e.preventDefault();
          const ctx = detectStudyContext(entry?.modality || "", entry?.studyDescription, entry?.studyDescription, entry?.studyDescription);
          const fmt = ctx?.smartFormats?.[Number(digit) - 1];
          if (fmt) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const before = reportBody.slice(0, start);
            const after = reportBody.slice(end);
            const newText = before + fmt.findings + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
            setReportBody(newText);
            if (fmt.impression) setImpression((prev) => (prev ? prev + "\n" + fmt.impression! : fmt.impression!));
            if (fmt.title) setReportTitle(fmt.title);
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + fmt.findings.length; ta.focus(); }, 0);
            toast({ title: `Smart Format: ${fmt.label}`, description: fmt.shortcut });
          }
        }
      }

      // Macro autocomplete: when user types Space / Enter / Tab after a "/word" in the body textarea
      const isMacroTrigger = (e.key === " " || e.key === "Enter" || e.key === "Tab") && ta === textareaRef.current;
      if (isMacroTrigger && ffMacros && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const start = ta.selectionStart;
        const text = reportBody.slice(0, start);
        const match = text.match(/\/(\w+)$/);
        if (match) {
          const macroKey = match[1].toLowerCase();
          const ctx = detectStudyContext(entry?.modality || "", entry?.studyDescription, entry?.studyDescription, entry?.studyDescription);
          const allMacros = [...(ctx?.smartFormats?.map((f) => ({ shortcut: f.id.toLowerCase(), expansion: f.findings })) ?? []), ...(ctx?.buttons?.map((b) => ({ shortcut: b.label.toLowerCase().replace(/\s/g, "_"), expansion: b.text })) ?? [])];
          const macro = allMacros.find((m) => m.shortcut === macroKey) || (ctx ? null : null);
          if (macro) {
            e.preventDefault();
            const before = reportBody.slice(0, start - macroKey.length - 1);
            const after = reportBody.slice(start);
            const newText = before + macro.expansion + (e.key === " " ? " " : "") + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
            setReportBody(newText);
            setTimeout(() => {
              ta.selectionStart = ta.selectionEnd = before.length + macro.expansion.length + (e.key === " " ? 1 : 0);
              ta.focus();
            }, 0);
            toast({ title: `Macro expanded: /${macroKey}` });
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [entry, reportBody, impression, reportTitle, toast, ffMacros, textareaRef, setReportBody, setImpression, setReportTitle]);

  // ── Mutations ──
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry");
      setSaving(true);
      const res = await api.post("/api/internal/radiology/report-draft", {
        worklistId: entry.id,
        patientId: entry.patientId,
        studyInstanceUID: entry.studyInstanceUID,
        accessionNumber: entry.accessionNumber,
        title: reportTitle,
        body: reportBody,
        impression,
        rawFindings,
        clinicalHistory,
        isCritical,
        criticalNote,
        modality: entry.modality,
        studyDescription: entry.studyDescription,
        createdBy: session?.user.name ?? "staff",
      });
      setSaving(false);
      return res;
    },
    onSuccess: () => {
      toast({ title: "Draft saved" });
      void qc.invalidateQueries({ queryKey: ["worklist-entry", id] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    },
    onError: () => {
      setSaving(false);
      toast({ title: "Save failed", variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry");
      setFinalizing(true);
      // 1. Save report
      const reportPayload = {
        patientId: entry.patientId,
        testId: null,
        studyId: entry.studyId ?? null,
        type: "radiology",
        title: reportTitle.trim() || "Radiology Report",
        body: reportBody,
        impression,
        parameters: JSON.stringify({
          modality: entry.modality,
          studyDescription: entry.studyDescription,
          accessionNumber: entry.accessionNumber,
          studyInstanceUID: entry.studyInstanceUID,
        }),
        isCritical,
        criticalNote: isCritical ? criticalNote : null,
        createdBy: session?.user.name ?? "Radiologist",
      };
      let reportId: number | null = null;
      if (entry.patientId) {
        const r = await api.post<{ id: number }>("/api/patient-reports", reportPayload);
        reportId = r.id;
      }
      // 2. Update worklist
      await api.post("/api/internal/radiology/report-status", {
        accessionNumber: entry.accessionNumber,
        studyInstanceUID: entry.studyInstanceUID,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: session?.user.name ?? "staff",
      });
      setFinalizing(false);
      return { reportId };
    },
    onSuccess: ({ reportId }) => {
      toast({
        title: "Report Finalized",
        description: reportId ? `Saved as Report #${reportId}` : "Status updated to FINAL",
      });
      void qc.invalidateQueries({ queryKey: ["worklist-entry", id] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    },
    onError: (err) => {
      setFinalizing(false);
      toast({ title: "Finalize failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    },
  });

  const aiDraftMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry");
      const draft = await api.post<{
        formattedReportText?: string; impression?: string; title?: string;
      }>("/api/internal/radiology/ai-draft", {
        studyId: entry.id,
        modality: entry.modality,
        studyDescription: entry.studyDescription ?? entry.modality,
        clinicalHistory: clinicalHistory.trim() || undefined,
        rawFindings: rawFindings.trim() || undefined,
        patientName: entry.patientName,
        age: entry.age,
        sex: entry.sex,
        accessionNumber: entry.accessionNumber,
        studyDate: entry.studyDate,
      });
      return draft;
    },
    onSuccess: (draft) => {
      if (draft.formattedReportText) setReportBody(draft.formattedReportText);
      if (draft.impression) setImpression(draft.impression);
      if (draft.title) setReportTitle(draft.title);
      toast({ title: "AI Draft generated", description: "Review before finalizing" });
      void qc.invalidateQueries({ queryKey: ["worklist-entry", id] });
    },
    onError: () => toast({ title: "AI Draft failed", variant: "destructive" }),
  });

  // ── Helpers ──
  function applyNormalTemplate(t: NormalTemplate) {
    setReportBody(t.body);
    // Extract impression from the normal text
    const imp = t.body.split("IMPRESSION:")[1]?.trim() || `Normal ${t.label}`;
    setImpression(imp);
    setShowNormalPicker(false);
    toast({ title: `Applied: ${t.label}` });
  }

  function insertMeasurement(m: DicomMeasurement) {
    const rows: string[] = [];
    if (m.bpd) rows.push(`BPD: ${m.bpd}`);
    if (m.hc) rows.push(`HC: ${m.hc}`);
    if (m.ac) rows.push(`AC: ${m.ac}`);
    if (m.fl) rows.push(`FL: ${m.fl}`);
    if (m.crl) rows.push(`CRL: ${m.crl}`);
    if (m.efw) rows.push(`EFW: ${m.efw}`);
    if (m.ga) rows.push(`GA: ${m.ga}`);
    if (m.edd) rows.push(`EDD: ${m.edd}`);
    if (m.fhr) rows.push(`FHR: ${m.fhr}`);
    if (m.placentaPosition) rows.push(`Placenta: ${m.placentaPosition}`);
    if (m.liquorAfi) rows.push(`Liquor AFI: ${m.liquorAfi}`);
    if (m.fetalPresentation) rows.push(`Presentation: ${m.fetalPresentation}`);
    if (m.uterusSize) rows.push(`Uterus size: ${m.uterusSize}`);
    if (m.endometrium) rows.push(`Endometrium: ${m.endometrium}`);
    if (m.rightOvary) rows.push(`Right ovary: ${m.rightOvary}`);
    if (m.leftOvary) rows.push(`Left ovary: ${m.leftOvary}`);
    if (m.follicles) rows.push(`Follicles: ${m.follicles}`);
    if (m.adnexalLesion) rows.push(`Adnexal lesion: ${m.adnexalLesion}`);
    if (m.liverSize) rows.push(`Liver size: ${m.liverSize}`);
    if (m.spleenSize) rows.push(`Spleen size: ${m.spleenSize}`);
    if (m.rightKidney) rows.push(`Right kidney: ${m.rightKidney}`);
    if (m.leftKidney) rows.push(`Left kidney: ${m.leftKidney}`);
    if (m.cbd) rows.push(`CBD: ${m.cbd}`);
    if (m.gbWall) rows.push(`GB wall: ${m.gbWall}`);
    if (m.prostateVolume) rows.push(`Prostate volume: ${m.prostateVolume}`);
    const text = rows.join("\n");
    if (!text) return;
    const ta = textareaRef.current;
    if (!ta) {
      setReportBody((prev) => prev + "\n" + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = reportBody.slice(0, start);
    const after = reportBody.slice(end);
    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
    setReportBody(newText);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + text.length;
      ta.focus();
    }, 0);
  }

  function openOhif() {
    if (ohifData?.ohifUrl) {
      window.open(ohifData.ohifUrl, "_blank");
    }
  }

  // ── Loading states ──
  if (entryLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <AlertTriangle className="h-8 w-8" />
        <p>Worklist entry not found.</p>
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>
    );
  }

  const isFinal = entry.status === "REPORT_FINAL" || entry.status === "DELIVERED";
  const normalTemplates = getNormalTemplates(entry.modality);
  const ohifUrl = ohifData?.ohifUrl;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => window.history.back()}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Worklist
            </Button>
            <div>
              <h1 className="text-sm font-semibold">{entry.patientName}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{[entry.age, entry.sex].filter(Boolean).join(" / ") || "—"}</span>
                <span>·</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1">{modalityLabel(entry.modality)}</Badge>
                <span>·</span>
                <span className="font-mono">{entry.accessionNumber}</span>
                <span>·</span>
                <Badge className={`text-[10px] h-4 px-1 ${statusColor(entry.status)}`}>
                  {STATUS_LABELS[entry.status] || entry.status}
                </Badge>
                {/* Phase 2D: Priority Engine badge */}
                {ffPriorityEngine && (
                  <PriorityBadge findings={reportBody} impression={impression} />
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Viewer toggle */}
            <Button
              size="sm"
              variant={showViewer ? "default" : "outline"}
              className="h-7 text-xs gap-1"
              onClick={() => setShowViewer((v) => !v)}
            >
              <MonitorPlay className="h-3.5 w-3.5" /> Images
            </Button>
            {/* Measurements toggle — feature-flagged */}
            {ffMeasurementPanel && (
              <Button
                size="sm"
                variant={showMeasurements ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowMeasurements((v) => !v)}
                disabled={measurements.length === 0}
              >
                <ClipboardPaste className="h-3.5 w-3.5" /> Measurements
                {measurements.length > 0 && (
                  <Badge className="text-[9px] h-3.5 px-1 bg-primary-foreground text-primary ml-0.5">{measurements.length}</Badge>
                )}
              </Button>
            )}
            {/* AI toggle — feature-flagged */}
            {ffAiDraftPanel && (
              <Button
                size="sm"
                variant={showAiDraft ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowAiDraft((v) => !v)}
              >
                <Sparkles className="h-3.5 w-3.5" /> AI
              </Button>
            )}
            {/* Quick Add — feature-flagged */}
            {ffQuickAdd && (
              <Button
                size="sm"
                variant={showQuickAddPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowQuickAddPanel((v) => !v)}
                disabled={isFinal}
                title="Quick Add Phrases (Alt+1-6)"
              >
                <Plus className="h-3.5 w-3.5" /> Quick
              </Button>
            )}
            {/* Smart Format — feature-flagged */}
            {ffSmartFormat && (
              <Button
                size="sm"
                variant={showSmartFormatPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowSmartFormatPanel((v) => !v)}
                disabled={isFinal}
                title="Smart Format Builder (Shift+Alt+1-6)"
              >
                <Sparkles className="h-3.5 w-3.5" /> Formats
              </Button>
            )}
            {/* Macros — feature-flagged */}
            {ffMacros && (
              <Button
                size="sm"
                variant={showMacroPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowMacroPanel((v) => !v)}
                disabled={isFinal}
                title="Radiology Macros"
              >
                <Zap className="h-3.5 w-3.5" /> Macros
              </Button>
            )}
            {/* Previous Reports — feature-flagged */}
            {ffPreviousReport && (
              <Button
                size="sm"
                variant={showPrevReportPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowPrevReportPanel((v) => !v)}
                title="Previous Reports"
              >
                <History className="h-3.5 w-3.5" /> Prior
              </Button>
            )}
            {/* Favorites — feature-flagged */}
            {ffFavorites && (
              <Button
                size="sm"
                variant={showFavPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowFavPanel((v) => !v)}
                disabled={isFinal}
                title="Favorite Templates"
              >
                <Star className="h-3.5 w-3.5" /> Favorites
              </Button>
            )}
            {/* Phase 2D: Quality Checker — feature-flagged */}
            {ffQualityChecker && (
              <Button
                size="sm"
                variant={showQualityPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowQualityPanel((v) => !v)}
                title="Quality Checker (Ctrl+Shift+Q)"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Quality
              </Button>
            )}
            {/* Phase 2D: Conflict Detection — feature-flagged */}
            {ffConflictDetection && (
              <Button
                size="sm"
                variant={showConflictPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowConflictPanel((v) => !v)}
                title="Conflict Detection"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Conflicts
              </Button>
            )}
            {/* Phase 2D: Smart Impression — feature-flagged */}
            {ffSmartImpression && (
              <Button
                size="sm"
                variant={showSmartImpPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowSmartImpPanel((v) => !v)}
                disabled={isFinal}
                title="Smart Impression Suggestion"
              >
                <Lightbulb className="h-3.5 w-3.5" /> Smart
              </Button>
            )}
            {/* Phase 2D: Measurement Library — feature-flagged */}
            {ffMeasurementLibrary && (
              <Button
                size="sm"
                variant={showMeasurementLibPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowMeasurementLibPanel((v) => !v)}
                disabled={isFinal}
                title="Measurement Library (Ctrl+Shift+M)"
              >
                <BarChart3 className="h-3.5 w-3.5" /> Measure
              </Button>
            )}
            {/* Phase 2D: Knowledge Base — feature-flagged */}
            {ffKnowledgeBase && (
              <Button
                size="sm"
                variant={showKnowledgePanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowKnowledgePanel((v) => !v)}
                title="Knowledge Base"
              >
                <Brain className="h-3.5 w-3.5" /> KB
              </Button>
            )}
            {/* Phase 2D: Comparison — feature-flagged */}
            {ffComparison && (
              <Button
                size="sm"
                variant={showComparisonPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowComparisonPanel((v) => !v)}
                title="Previous Report Comparison"
              >
                <GitCompare className="h-3.5 w-3.5" /> Compare
              </Button>
            )}
            {/* Phase 3: Master Library — feature-flagged */}
            {ffMasterLibrary && (
              <Button
                size="sm"
                variant={showMasterPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowMasterPanel((v) => !v)}
                disabled={isFinal}
                title="Master Template Library"
              >
                <BookOpen className="h-3.5 w-3.5" /> Library
              </Button>
            )}
            {/* Phase 3: Advanced Measurements — feature-flagged */}
            {ffAdvancedMeasurements && (
              <Button
                size="sm"
                variant={showAdvancedMeasurementPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowAdvancedMeasurementPanel((v) => !v)}
                disabled={isFinal}
                title="Advanced Measurement Library"
              >
                <Ruler className="h-3.5 w-3.5" /> Measure
              </Button>
            )}
            {/* Phase 3: AI Hooks — feature-flagged */}
            {ffAiHooks && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 border-dashed"
                onClick={() => toast({ title: "AI Infrastructure Ready", description: "Voice dictation, AI drafting, and AI comparison coming soon." })}
                title="AI-Ready Infrastructure"
              >
                <Layers className="h-3.5 w-3.5" /> AI
              </Button>
            )}
            {/* Phase 3: One-Click Reports — feature-flagged */}
            {ffOneClickReports && (
              <Button
                size="sm"
                variant={showOneClickPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowOneClickPanel((v) => !v)}
                disabled={isFinal}
                title="One-Click Complete Reports"
              >
                <Zap className="h-3.5 w-3.5" /> Reports
              </Button>
            )}
            {/* Phase 3: QA Guard — feature-flagged */}
            {ffQAGuard && (
              <Button
                size="sm"
                variant={showQAGuardPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowQAGuardPanel((v) => !v)}
                disabled={isFinal}
                title="QA Guard"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> QA
              </Button>
            )}
            {/* Phase 3: Finalization Dashboard — feature-flagged */}
            {ffFinalizationDashboard && (
              <Button
                size="sm"
                variant={showFinalizationPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowFinalizationPanel((v) => !v)}
                disabled={isFinal}
                title="Finalization Dashboard"
              >
                <BarChart3 className="h-3.5 w-3.5" /> Finalize
              </Button>
            )}
            {/* Phase 4: Knowledge Platform — master toggle shows all sub-buttons */}
            {ffKnowledgePlatform && (
              <>
                {ffMasterTemplates && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "master" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "master" ? null : "master")}
                    disabled={isFinal}
                    title="Master Template Library"
                  >
                    <BookOpen className="h-3.5 w-3.5" /> Masters
                  </Button>
                )}
                {ffPersonalLibrary && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "personal" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "personal" ? null : "personal")}
                    disabled={isFinal}
                    title="Personal Library"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> Personal
                  </Button>
                )}
                {ffTemplatePacks && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "packs" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "packs" ? null : "packs")}
                    disabled={isFinal}
                    title="Template Packs"
                  >
                    <Layers className="h-3.5 w-3.5" /> Packs
                  </Button>
                )}
                {ffKnowledgeBase_v2 && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "knowledge" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "knowledge" ? null : "knowledge")}
                    disabled={isFinal}
                    title="Knowledge Base"
                  >
                    <Brain className="h-3.5 w-3.5" /> KB
                  </Button>
                )}
                {ffSignOffProfiles && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "profile" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "profile" ? null : "profile")}
                    title="Sign-Off Profile"
                  >
                    <UserCircle className="h-3.5 w-3.5" /> Profile
                  </Button>
                )}
                {ffTemplateAnalytics && (
                  <Button
                    size="sm"
                    variant={knowledgePanel === "analytics" ? "default" : "outline"}
                    className="h-7 text-xs gap-1"
                    onClick={() => setKnowledgePanel((p) => p === "analytics" ? null : "analytics")}
                    title="Usage Analytics"
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Analytics
                  </Button>
                )}
              </>
            )}
            {/* Phase 5: Smart Findings button */}
            {ffSmartFindings && (
              <Button
                size="sm"
                variant={smartFindingsPanel !== null ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setSmartFindingsPanel((p) => p !== null ? null : "smart")}
                disabled={isFinal}
                title="Smart Findings"
              >
                <Construction className="h-3.5 w-3.5" /> Smart Findings
              </Button>
            )}
            {/* Phase 6: AI Copilot button */}
            {ffAICopilot && (
              <Button
                size="sm"
                variant={showAICopilotPanel ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setShowAICopilotPanel((p) => !p)}
                disabled={isFinal}
                title="AI Copilot"
              >
                <Bot className="h-3.5 w-3.5" /> AI Copilot
              </Button>
            )}
            {/* Help button */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground"
              onClick={() => setShowHelp(true)}
              title="Help & Keyboard Shortcuts"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            {/* Normal button */}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-green-300 text-green-700 hover:bg-green-50"
              onClick={() => setShowNormalPicker((v) => !v)}
              disabled={isFinal}
            >
              <ThumbsUp className="h-3.5 w-3.5" /> Normal
            </Button>
            {/* Print */}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => {
                generateReportPDF({
                  patientName: entry.patientName,
                  age: entry.age ?? undefined,
                  sex: entry.sex ?? undefined,
                  accessionNumber: entry.accessionNumber,
                  studyDate: entry.studyDate ?? undefined,
                  referringDoctor: entry.referringDoctor ?? undefined,
                  modality: entry.modality,
                  bodyPart: entry.studyDescription ?? undefined,
                  clinicalHistory,
                  findings: reportBody,
                  impression,
                  reportTitle: reportTitle || "Radiology Report",
                  printedBy: session?.user.name ?? undefined,
                }, printSettings, clinicSettings ?? null);
                toast({ title: "PDF downloaded" });
              }}
            >
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPrintSettingsOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
            </Button>

            {/* TTS Readout */}
            <Button
              size="sm"
              variant={isSpeaking ? "destructive" : "outline"}
              className="h-7 text-xs gap-1"
              onClick={() => {
                if (isSpeaking) {
                  window.speechSynthesis?.cancel();
                  setIsSpeaking(false);
                } else {
                  const text = [reportTitle, reportBody, "Impression:", impression].filter(Boolean).join(".\n");
                  if (!text.trim()) return;
                  const utterance = new SpeechSynthesisUtterance(text);
                  utterance.lang = "en-IN";
                  utterance.rate = 1.0;
                  utterance.pitch = 1.0;
                  utterance.onend = () => setIsSpeaking(false);
                  utterance.onerror = () => setIsSpeaking(false);
                  window.speechSynthesis?.speak(utterance);
                  setIsSpeaking(true);
                }
              }}
              title={isSpeaking ? "Stop reading" : "Read report aloud (en-IN)"}
            >
              {isSpeaking ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              {isSpeaking ? "Stop" : "Read"}
            </Button>

            {/* Save / Finalize */}
            {!isFinal && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => saveDraftMutation.mutate()}
                  disabled={saving}
                >
                  {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => {
                    if (confirm("Finalize this report? It will be locked for editing.")) {
                      finalizeMutation.mutate();
                    }
                  }}
                  disabled={finalizing}
                >
                  {finalizing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Finalize
                </Button>
              </>
            )}
            {isFinal && (
              <Badge className="h-7 text-xs gap-1 bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> Finalized
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── Main body (3 columns) ────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Measurements + Normal templates + Productivity panels */}
        <div className={`${(showMeasurements && ffMeasurementPanel) || showNormalPicker || (showQuickAddPanel && ffQuickAdd) || (showSmartFormatPanel && ffSmartFormat) || (showMacroPanel && ffMacros) || (showPrevReportPanel && ffPreviousReport) || (showFavPanel && ffFavorites) || (showMasterPanel && ffMasterLibrary) || (showAdvancedMeasurementPanel && ffAdvancedMeasurements) || (showOneClickPanel && ffOneClickReports) || (showQAGuardPanel && ffQAGuard) || (showFinalizationPanel && ffFinalizationDashboard) || (knowledgePanel && ffKnowledgePlatform) ? "w-64" : "w-0"} border-r bg-muted/20 flex flex-col overflow-hidden transition-all duration-200`}>
          {/* Normal templates picker */}
          {showNormalPicker && (
            <div className="shrink-0 border-b p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <ThumbsUp className="h-3 w-3" /> Normal Templates
              </h3>
              <div className="space-y-1">
                {normalTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => applyNormalTemplate(t)}
                    className="w-full text-left text-xs rounded-md border bg-background px-2 py-1.5 hover:bg-green-50 hover:border-green-200 transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
                {normalTemplates.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">No normal templates for {modalityLabel(entry.modality)}</p>
                )}
              </div>
            </div>
          )}

          {/* Approved measurements — feature-flagged */}
          {ffMeasurementPanel && showMeasurements && (
            <div className="flex-1 overflow-y-auto p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                <ClipboardPaste className="h-3 w-3" /> Approved Measurements
              </h3>
              {measurements.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  No approved measurements. Go to USG Measurements to approve extracted values.
                </p>
              ) : (
                <div className="space-y-1">
                  {measurements.map((m) => {
                    const rows = measurementRows(m);
                    return (
                      <button
                        key={m.id}
                        onClick={() => insertMeasurement(m)}
                        className="w-full text-left text-xs rounded-md border bg-background px-2 py-1.5 hover:bg-blue-50 hover:border-blue-200 transition-colors group"
                        title="Click to insert into report"
                      >
                        <span className="font-medium">{rows.length} measurement{rows.length > 1 ? "s" : ""}</span>
                        <span className="text-muted-foreground"> · {rows.slice(0, 2).map(r => r.label).join(", ")}{rows.length > 2 ? " ..." : ""}</span>
                        <span className="text-[9px] text-green-600 ml-1 opacity-0 group-hover:opacity-100">Insert →</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Quick Add panel — real */}
          {ffQuickAdd && showQuickAddPanel && (
            <div className="flex-1 overflow-y-auto border-t">
              <RadiologyProductivityPanel
                mode="quick_add"
                modality={entry.modality}
                studyDescription={entry.studyDescription}
                testName={entry.studyDescription}
                bodyPart={entry.studyDescription}
                isFinal={isFinal}
                reportBody={reportBody}
                impression={impression}
                onInsertBody={(text) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const before = reportBody.slice(0, start);
                    const after = reportBody.slice(end);
                    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                    setReportBody(newText);
                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                  } else {
                    setReportBody((prev) => prev + "\n" + text);
                  }
                }}
                onInsertImpression={(text) => {
                  setImpression((prev) => (prev ? prev + "\n" + text : text));
                }}
                onSetBody={setReportBody}
                onSetImpression={setImpression}
              />
            </div>
          )}

          {/* Smart Format panel — real */}
          {ffSmartFormat && showSmartFormatPanel && (
            <div className="flex-1 overflow-y-auto border-t">
              <RadiologyProductivityPanel
                mode="smart_format"
                modality={entry.modality}
                studyDescription={entry.studyDescription}
                testName={entry.studyDescription}
                bodyPart={entry.studyDescription}
                isFinal={isFinal}
                reportBody={reportBody}
                impression={impression}
                onInsertBody={(text) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const before = reportBody.slice(0, start);
                    const after = reportBody.slice(end);
                    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                    setReportBody(newText);
                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                  } else {
                    setReportBody((prev) => prev + "\n" + text);
                  }
                }}
                onInsertImpression={(text) => {
                  setImpression((prev) => (prev ? prev + "\n" + text : text));
                }}
                onSetBody={setReportBody}
                onSetImpression={setImpression}
              />
            </div>
          )}

          {/* Macros panel — real */}
          {ffMacros && showMacroPanel && (
            <div className="flex-1 overflow-y-auto border-t">
              <RadiologyProductivityPanel
                mode="macros"
                modality={entry.modality}
                studyDescription={entry.studyDescription}
                testName={entry.studyDescription}
                bodyPart={entry.studyDescription}
                isFinal={isFinal}
                reportBody={reportBody}
                impression={impression}
                onInsertBody={(text) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const before = reportBody.slice(0, start);
                    const after = reportBody.slice(end);
                    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                    setReportBody(newText);
                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                  } else {
                    setReportBody((prev) => prev + "\n" + text);
                  }
                }}
                onInsertImpression={(text) => {
                  setImpression((prev) => (prev ? prev + "\n" + text : text));
                }}
                onSetBody={setReportBody}
                onSetImpression={setImpression}
              />
            </div>
          )}

          {/* Previous Reports panel — real */}
          {ffPreviousReport && showPrevReportPanel && (
            <div className="flex-1 overflow-y-auto border-t">
              <RadiologyProductivityPanel
                mode="previous"
                modality={entry.modality}
                patientId={entry.patientId}
                isFinal={isFinal}
                reportBody={reportBody}
                impression={impression}
                onInsertBody={(text) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const before = reportBody.slice(0, start);
                    const after = reportBody.slice(end);
                    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                    setReportBody(newText);
                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                  } else {
                    setReportBody((prev) => prev + "\n" + text);
                  }
                }}
                onInsertImpression={(text) => {
                  setImpression((prev) => (prev ? prev + "\n" + text : text));
                }}
                onSetBody={setReportBody}
                onSetImpression={setImpression}
              />
            </div>
          )}

          {/* Favorites panel — real */}
          {ffFavorites && showFavPanel && (
            <div className="flex-1 overflow-y-auto border-t">
              <RadiologyProductivityPanel
                mode="favorites"
                modality={entry.modality}
                isFinal={isFinal}
                reportBody={reportBody}
                impression={impression}
                onInsertBody={(text) => {
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const before = reportBody.slice(0, start);
                    const after = reportBody.slice(end);
                    const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                    setReportBody(newText);
                    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                  } else {
                    setReportBody((prev) => prev + "\n" + text);
                  }
                }}
                onInsertImpression={(text) => {
                  setImpression((prev) => (prev ? prev + "\n" + text : text));
                }}
                onSetBody={setReportBody}
                onSetImpression={setImpression}
              />
            </div>
          )}

          {/* Phase 2D: Quality Checker panel */}
          {ffQualityChecker && showQualityPanel && (
            <QualityPanel findings={reportBody} impression={impression} />
          )}

          {/* Phase 2D: Conflict Detection panel */}
          {ffConflictDetection && showConflictPanel && (
            <ConflictPanel findings={reportBody} />
          )}

          {/* Phase 2D: Smart Impression panel */}
          {ffSmartImpression && showSmartImpPanel && (
            <SmartImpressionPanel findings={reportBody} currentImpression={impression} onApply={setImpression} />
          )}

          {/* Phase 2D: Measurement Library panel */}
          {ffMeasurementLibrary && showMeasurementLibPanel && (
            <MeasurementLibraryPanel onInsert={(text) => {
              const ta = textareaRef.current;
              if (ta) {
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const before = reportBody.slice(0, start);
                const after = reportBody.slice(end);
                const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                setReportBody(newText);
                setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
              } else {
                setReportBody((prev) => prev + "\n" + text);
              }
            }} />
          )}

          {/* Phase 2D: Knowledge Base panel */}
          {ffKnowledgeBase && showKnowledgePanel && (
            <KnowledgeBasePanel onInsert={(text) => {
              const ta = textareaRef.current;
              if (ta) {
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const before = reportBody.slice(0, start);
                const after = reportBody.slice(end);
                const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                setReportBody(newText);
                setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
              } else {
                setReportBody((prev) => prev + "\n" + text);
              }
            }} />
          )}

          {/* Phase 3: Master Library panel */}
          {ffMasterLibrary && showMasterPanel && (
            <MasterLibraryPanel
              modality={entry.modality}
              studyDescription={entry.studyDescription}
              onApplyVariant={(title, findings, impression) => {
                setReportTitle(title);
                setReportBody(findings);
                setImpression(impression);
                setShowMasterPanel(false);
                toast({ title: "Master template applied" });
              }}
            />
          )}

          {/* Phase 3: Advanced Measurement Library panel */}
          {ffAdvancedMeasurements && showAdvancedMeasurementPanel && (
            <AdvancedMeasurementLibraryPanel
              onInsert={(text) => {
                const ta = textareaRef.current;
                if (ta) {
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const before = reportBody.slice(0, start);
                  const after = reportBody.slice(end);
                  const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                  setReportBody(newText);
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                } else {
                  setReportBody((prev) => prev + "\n" + text);
                }
              }}
            />
          )}
          {/* Phase 3: One-Click Reports panel */}
          {ffOneClickReports && showOneClickPanel && (
            <OneClickReportsPanel
              modality={entry.modality}
              studyDescription={entry.studyDescription}
              onApply={(title, findings, impression) => {
                setReportTitle(title);
                setReportBody(findings);
                setImpression(impression);
                setShowOneClickPanel(false);
                toast({ title: "Report applied" });
              }}
            />
          )}
          {/* Phase 3: QA Guard panel */}
          {ffQAGuard && showQAGuardPanel && (
            <QAGuardPanel findings={reportBody} impression={impression} />
          )}
          {/* Phase 3: Finalization Dashboard panel */}
          {ffFinalizationDashboard && showFinalizationPanel && (
            <FinalizationDashboard
              findings={reportBody}
              impression={impression}
              reportTitle={reportTitle}
              onClose={() => setShowFinalizationPanel(false)}
            />
          )}
          {/* Phase 4: Knowledge Platform panels */}
          {ffKnowledgePlatform && knowledgePanel && (
            <RadiologyKnowledgePanel
              activePanel={knowledgePanel}
              onInsert={(text) => {
                const ta = textareaRef.current;
                if (ta) {
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const before = reportBody.slice(0, start);
                  const after = reportBody.slice(end);
                  const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                  setReportBody(newText);
                  setTimeout(() => {
                    ta.selectionStart = ta.selectionEnd = start + text.length;
                    ta.focus();
                  }, 0);
                } else {
                  setReportBody((prev) => prev + "\n" + text);
                }
              }}
              selectedText={typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : ""}
            />
          )}
        </div>

        {/* Phase 5: Smart Findings Panel */}
        {ffSmartFindings && smartFindingsPanel !== null && (
          <div className="w-80 border-l bg-background flex flex-col overflow-hidden">
            <RadiologySmartFindingsPanel
              worklistId={id}
              modality={entry?.modality ?? ""}
              studyDescription={entry?.studyDescription}
              onApplyFindings={(text) => {
                const ta = textareaRef.current;
                if (ta) {
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const before = reportBody.slice(0, start);
                  const after = reportBody.slice(end);
                  const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                  setReportBody(newText);
                  setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
                } else {
                  setReportBody((prev) => prev + "\n" + text);
                }
              }}
              onApplyImpression={(text) => {
                setImpression((prev) => {
                  if (prev) return prev + "\n" + text;
                  return text;
                });
              }}
            />
          </div>
        )}

        {/* Phase 6: AI Copilot Panel */}
        {ffAICopilot && showAICopilotPanel && (
          <RadiologyAICopilotPanel
            worklistId={id}
            modality={entry?.modality ?? ""}
            studyDescription={entry?.studyDescription}
            studyInstanceUID={entry?.studyInstanceUID ?? null}
            reportBody={reportBody}
            impression={impression}
            onInsert={(text) => {
              const ta = textareaRef.current;
              if (ta) {
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const before = reportBody.slice(0, start);
                const after = reportBody.slice(end);
                const newText = before + text + (after.startsWith("\n") || after === "" ? "" : "\n") + after;
                setReportBody(newText);
                setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; ta.focus(); }, 0);
              } else {
                setReportBody((prev) => prev + "\n" + text);
              }
            }}
            onInsertImpression={(text) => {
              setImpression((prev) => {
                if (prev) return prev + "\n" + text;
                return text;
              });
            }}
            ffDraft={ffAICopilot}
            ffDifferential={ffDifferential}
            ffFollowUp={ffFollowUp}
            ffImageReview={ffImageReview}
            ffCompare={ffComparePrevious}
            ffQuality={ffQualityCheck}
            ffPolish={ffLanguagePolish}
            ffPromptManager={isFeatureEnabled("radiologyPromptManager")}
          />
        )}

        {/* Center: Report Editor */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* AI Draft input — feature-flagged */}
          {ffAiDraftPanel && showAiDraft && (
            <div className="shrink-0 border-b p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-purple-500" /> AI Draft Input
                </h3>
                <Button
                  size="sm"
                  className="h-6 text-xs bg-purple-600 hover:bg-purple-700"
                  onClick={() => aiDraftMutation.mutate()}
                  disabled={aiDraftMutation.isPending}
                >
                  {aiDraftMutation.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Generate AI Draft
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Clinical History</label>
                  <Textarea
                    value={clinicalHistory}
                    onChange={(e) => setClinicalHistory(e.target.value)}
                    disabled={isFinal}
                    rows={2}
                    className="text-xs"
                    placeholder="Presenting complaint, relevant history..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Raw Findings</label>
                  <Textarea
                    value={rawFindings}
                    onChange={(e) => setRawFindings(e.target.value)}
                    disabled={isFinal}
                    rows={2}
                    className="text-xs"
                    placeholder="Key observations, dictation..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Critical flag */}
          {!isFinal && (
            <div className="shrink-0 px-3 py-2 border-b flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCritical}
                  onChange={(e) => setIsCritical(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className={isCritical ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                  Critical / Urgent
                </span>
              </label>
              {isCritical && (
                <Input
                  value={criticalNote}
                  onChange={(e) => setCriticalNote(e.target.value)}
                  placeholder="Critical note (e.g., 'Acute finding — notify immediately')"
                  className="text-xs h-6 flex-1"
                />
              )}
            </div>
          )}

          {/* Report title */}
          <div className="shrink-0 px-3 py-2 border-b">
            <Input
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              disabled={isFinal}
              className="text-sm font-medium"
              placeholder="Report title..."
            />
          </div>

          {/* Report body textarea */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="shrink-0 px-3 py-1 flex items-center justify-between border-b">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Report Body
              </span>
              <span className="text-[10px] text-muted-foreground">
                {reportBody.length} chars
              </span>
            </div>
            <Textarea
              ref={textareaRef}
              value={reportBody}
              onChange={(e) => setReportBody(e.target.value)}
              disabled={isFinal}
              className="flex-1 resize-none text-sm leading-relaxed font-mono"
              placeholder="Enter findings here. Click measurements on the left to insert. Click 'Normal' for template. Click 'AI' for AI draft..."
            />
          </div>

          {/* Impression */}
          <div className="shrink-0 px-3 py-2 border-t">
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Impression</label>
            <Textarea
              value={impression}
              onChange={(e) => setImpression(e.target.value)}
              disabled={isFinal}
              rows={2}
              className="text-sm font-medium"
              placeholder="Final impression / conclusion..."
            />
          </div>
        </div>

        {/* Right: OHIF Viewer */}
        {showViewer && (
          <div className="w-[45%] border-l bg-black flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-card border-b">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <MonitorPlay className="h-3 w-3" /> DICOM Viewer
              </span>
              <div className="flex items-center gap-1">
                {ohifUrl && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={openOhif}>
                    <ExternalLink className="h-3 w-3" /> Open
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowViewer(false)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex-1 relative">
              {ohifUrl ? (
                <iframe
                  src={ohifUrl}
                  className="absolute inset-0 w-full h-full border-0"
                  title="OHIF DICOM Viewer"
                  allow="fullscreen"
                />
              ) : ohifLoading ? (
                <div className="flex items-center justify-center h-full text-white text-sm gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" /> Loading viewer...
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-white/60 text-sm gap-2 p-4">
                  <AlertTriangle className="h-6 w-6" />
                  <p>OHIF not configured or no Study UID.</p>
                  <p className="text-xs">Check PACS Settings → Viewer Settings</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ReportPrintSettingsDialog
        open={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
        settings={printSettings}
        onChange={(s) => { setPrintSettings(s); savePrintSettings(s); }}
      />

      {/* ── Help Center Dialog ── */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowHelp(false)}>
          <div className="bg-card border border-card-border rounded-xl shadow-2xl max-w-lg w-full mx-4 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2"><HelpCircle size={18} /> Help Center</h2>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowHelp(false)}><X size={14} /></Button>
            </div>
            <p className="text-sm text-muted-foreground">Radiologist productivity tools and keyboard shortcuts. Enable or disable features in <strong>Settings → Radiology</strong>.</p>
            <div className="space-y-3">
              <div className="bg-muted/30 rounded-lg p-3">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2"><Keyboard size={14} /> Keyboard Shortcuts</h3>
                <div className="grid gap-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Quick Add Buttons</span><span className="font-mono bg-muted px-1 rounded">Alt + 1-6</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Smart Format Templates</span><span className="font-mono bg-muted px-1 rounded">Shift + Alt + 1-8</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Macro Expansion</span><span className="font-mono bg-muted px-1 rounded">/shortcut + Space</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Favorites Panel</span><span className="font-mono bg-muted px-1 rounded">Ctrl + Shift + F</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Previous Reports</span><span className="font-mono bg-muted px-1 rounded">Ctrl + Shift + P</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Measurements Panel</span><span className="font-mono bg-muted px-1 rounded">Ctrl + Shift + M</span></div>
                </div>
              </div>
              <div className="bg-muted/30 rounded-lg p-3">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-2"><Command size={14} /> Macro Examples</h3>
                <div className="grid gap-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Fatty Liver Grade I</span><span className="font-mono bg-muted px-1 rounded">/fl1</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Fazekas Grade I</span><span className="font-mono bg-muted px-1 rounded">/faz1</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Disc Desiccation</span><span className="font-mono bg-muted px-1 rounded">/disc</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Broad Disc Bulge</span><span className="font-mono bg-muted px-1 rounded">/bulge</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Normal Study</span><span className="font-mono bg-muted px-1 rounded">/normal</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Clinical Correlation</span><span className="font-mono bg-muted px-1 rounded">/clinical</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Compare to Previous</span><span className="font-mono bg-muted px-1 rounded">/compare</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Follow-up</span><span className="font-mono bg-muted px-1 rounded">/fup</span></div>
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-card-border">
              <Button variant="outline" size="sm" onClick={() => setShowHelp(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── First-run Tutorial Overlay ── */}
      {showTutorial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTutorial(false)}>
          <div className="bg-card border border-card-border rounded-xl shadow-2xl max-w-md w-full mx-4 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2"><Sparkles size={18} className="text-amber-500" /> Welcome to Radiology</h2>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowTutorial(false)}><X size={14} /></Button>
            </div>
            <p className="text-sm text-muted-foreground">New radiologist productivity tools are available. Here’s a quick guide:</p>
            <div className="space-y-2 text-sm">
              <div className="flex gap-3">
                <div className="bg-primary/10 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shrink-0">1</div>
                <p><strong>Quick Add</strong> — Click buttons to insert common findings for each study type.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shrink-0">2</div>
                <p><strong>Smart Formats</strong> — Insert full study templates with Shift+Alt shortcuts.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shrink-0">3</div>
                <p><strong>Macros</strong> — Type /shortcut (e.g., /fl1, /faz1) then press Space to expand.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shrink-0">4</div>
                <p><strong>Settings</strong> — Enable or disable features in Settings → Radiology.</p>
              </div>
              <div className="flex gap-3">
                <div className="bg-primary/10 rounded-full h-6 w-6 flex items-center justify-center text-xs font-bold shrink-0">5</div>
                <p><strong>Help</strong> — Click the ? button anytime for shortcuts and macro reference.</p>
              </div>
            </div>
            <div className="flex justify-between pt-2 border-t border-card-border">
              <Button variant="ghost" size="sm" onClick={() => setShowTutorial(false)}>Dismiss</Button>
              <Button size="sm" onClick={() => {
                try { window.localStorage.setItem("radiologyTutorialSeen", "1"); } catch { /* ignore */ }
                setShowTutorial(false);
              }}>Got it</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Phase 2D: Intelligence Panel Sub-components ──

function QualityPanel({ findings, impression }: { findings: string; impression: string }) {
  const qc = runQualityCheck(findings, impression);
  return (
    <div className="shrink-0 border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" /> Quality ({qc.score}/100)
      </h3>
      <div className="space-y-1">
        {qc.checks.map((c) => (
          <div key={c.id} className={`flex items-center justify-between text-xs px-2 py-1 rounded border ${c.pass ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <span className={c.pass ? "text-green-700" : "text-amber-700"}>{c.label}</span>
            {c.pass ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
          </div>
        ))}
      </div>
      {qc.warnings.length > 0 && (
        <div className="space-y-1">
          {qc.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-600">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictPanel({ findings }: { findings: string }) {
  const conflicts = detectConflicts(findings);
  if (conflicts.length === 0) {
    return (
      <div className="shrink-0 border-t p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Conflicts
        </h3>
        <p className="text-[10px] text-green-600 mt-1">No conflicts detected.</p>
      </div>
    );
  }
  return (
    <div className="shrink-0 border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <AlertTriangle className="h-3 w-3 text-red-500" /> Conflicts ({conflicts.length})
      </h3>
      {conflicts.map((c, i) => (
        <div key={i} className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
          <p className="font-medium text-red-700">{c.message}</p>
          <p className="text-[10px] text-red-500 mt-0.5">{c.resolution}</p>
        </div>
      ))}
    </div>
  );
}

function SmartImpressionPanel({ findings, currentImpression, onApply }: { findings: string; currentImpression: string; onApply: (s: string) => void }) {
  const suggestion = suggestSmartImpression(findings);
  if (!suggestion) return null;
  const alreadyApplied = currentImpression.toLowerCase().includes(suggestion.toLowerCase());
  return (
    <div className="shrink-0 border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Lightbulb className="h-3 w-3" /> Smart Impression
      </h3>
      <div className="text-xs bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
        <p className="text-blue-800">{suggestion}</p>
      </div>
      {!alreadyApplied && (
        <Button size="sm" variant="outline" className="h-6 text-xs w-full" onClick={() => onApply(suggestion)}>
          <ThumbsUp className="h-3 w-3 mr-1" /> Apply to Impression
        </Button>
      )}
    </div>
  );
}

function MeasurementLibraryPanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const templates = useMemo(() => {
    const all = [
      { id: "bpd", label: "BPD", template: "BPD: ___ mm" },
      { id: "hc", label: "HC", template: "HC: ___ mm" },
      { id: "ac", label: "AC", template: "AC: ___ mm" },
      { id: "fl", label: "FL", template: "FL: ___ mm" },
      { id: "crl", label: "CRL", template: "CRL: ___ mm" },
      { id: "efw", label: "EFW", template: "EFW: ___ g" },
      { id: "ga", label: "GA", template: "GA: ___ weeks" },
      { id: "edd", label: "EDD", template: "EDD: ___" },
      { id: "fhr", label: "FHR", template: "FHR: ___ bpm" },
      { id: "canal", label: "Cervical Canal", template: "Cervical canal diameter: ___ mm" },
      { id: "lesion", label: "Lesion Size", template: "Lesion size: ___ x ___ mm" },
      { id: "liver", label: "Liver Size", template: "Liver size: ___ mm" },
      { id: "prostate", label: "Prostate Volume", template: "Prostate volume: ___ cc" },
    ];
    if (!query.trim()) return all;
    return all.filter((t) => t.label.toLowerCase().includes(query.toLowerCase()));
  }, [query]);
  return (
    <div className="shrink-0 border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <BarChart3 className="h-3 w-3" /> Measurements
      </h3>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="text-xs h-6" />
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onInsert(t.template)}
            className="w-full text-left text-xs rounded-md border bg-background px-2 py-1.5 hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function KnowledgeBasePanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>("All");
  const entries = useMemo(() => {
    const all = [
      { title: "Fatty Liver Grading", body: "Grade I: increased echotexture. Grade II: impaired vessel definition + mild attenuation. Grade III: marked attenuation.", tags: ["USG", "Abdomen"] },
      { title: "Fazekas Scale", body: "Grade 0: none. Grade 1: punctate. Grade 2: early confluent. Grade 3: confluent.", tags: ["MRI Brain", "Neuro"] },
      { title: "Disc Bulge vs Protrusion", body: "Bulge: >50% circumference. Protrusion: <50% circumference. Extrusion: lost connection to parent disc.", tags: ["MRI Spine", "MSK"] },
      { title: "Canal Stenosis Grading", body: "Mild: <1/3 narrowing. Moderate: 1/3-2/3. Severe: >2/3 or obliteration.", tags: ["MRI Spine", "MSK"] },
      { title: "Hydronephrosis Grading", body: "Grade 1: pelvis only. Grade 2: pelvis + calyces. Grade 3: parenchymal thinning.", tags: ["USG", "KUB"] },
      { title: "Placental Grading", body: "Grade 0: homogeneous. Grade 1: few calcifications. Grade 2: basal plate calcifications. Grade 3: complete calcifications.", tags: ["USG", "Obstetric"] },
      { title: "BPD Measurement", body: "Measure from outer to inner table of parietal bone, perpendicular to midline falx.", tags: ["USG", "Obstetric"] },
      { title: "Liver Size Normal", body: "Cranio-caudal: 130-170 mm. Transverse: 200-220 mm. Antero-posterior: 100-130 mm.", tags: ["USG", "Abdomen"] },
    ];
    let filtered = all;
    if (tag !== "All") filtered = filtered.filter((e) => e.tags.includes(tag));
    if (query.trim()) filtered = filtered.filter((e) => e.title.toLowerCase().includes(query.toLowerCase()) || e.body.toLowerCase().includes(query.toLowerCase()));
    return filtered;
  }, [query, tag]);
  const tags = ["All", "USG", "MRI Brain", "MRI Spine", "Abdomen", "KUB", "Obstetric", "Neuro", "MSK"];
  return (
    <div className="shrink-0 border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Brain className="h-3 w-3" /> Knowledge Base
      </h3>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="text-xs h-6" />
      <div className="flex flex-wrap gap-1">
        {tags.map((t: string) => (
          <button
            key={t}
            onClick={() => setTag(t)}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${tag === t ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {entries.map((e: { title: string; body: string; tags: string[] }, i: number) => (
          <div key={i} className="text-xs border rounded px-2 py-1.5 bg-background">
            <p className="font-medium">{e.title}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{e.body}</p>
            <div className="flex gap-1 mt-1">
              <button onClick={() => onInsert(e.body)} className="text-[10px] text-blue-600 hover:underline">Insert</button>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-[10px] text-muted-foreground">No results.</p>}
      </div>
    </div>
  );
}

// ── Phase 3: Master Library Panel ──
function MasterLibraryPanel({
  modality,
  studyDescription,
  onApplyVariant,
}: {
  modality: string;
  studyDescription: string | null;
  onApplyVariant: (title: string, findings: string, impression: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const matchedTemplates = useMemo(() => {
    if (!query.trim()) return ALL_MASTER_TEMPLATES;
    return ALL_MASTER_TEMPLATES.filter(
      (t) =>
        t.label.toLowerCase().includes(query.toLowerCase()) ||
        t.category.toLowerCase().includes(query.toLowerCase()) ||
        t.bodyPart.toLowerCase().includes(query.toLowerCase()) ||
        t.title.toLowerCase().includes(query.toLowerCase())
    );
  }, [query]);

  const currentTemplate = selectedTemplate ? findMasterTemplateById(selectedTemplate) : null;

  return (
    <div className="flex-1 overflow-y-auto border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <BookOpen className="h-3 w-3" /> Master Library
      </h3>
      <p className="text-[10px] text-muted-foreground">Locked Dr. Sugandha templates. View, use, or clone.</p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates..." className="text-xs h-6" />
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {matchedTemplates.map((t) => (
          <div key={t.id}>
            <button
              onClick={() => setSelectedTemplate(selectedTemplate === t.id ? null : t.id)}
              className={`w-full text-left text-xs rounded-md border px-2 py-1.5 transition-colors ${
                selectedTemplate === t.id ? "bg-blue-50 border-blue-200" : "bg-background hover:bg-blue-50 hover:border-blue-200"
              }`}
            >
              <span className="font-medium">{t.label}</span>
              <span className="text-[10px] text-muted-foreground ml-1">({t.category})</span>
            </button>
            {selectedTemplate === t.id && t.variants && (
              <div className="ml-2 mt-1 space-y-1 border-l-2 border-blue-200 pl-2">
                {t.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onApplyVariant(t.title, v.findings, v.impression)}
                    className="w-full text-left text-[10px] rounded-md border bg-background px-2 py-1 hover:bg-green-50 hover:border-green-200 transition-colors"
                  >
                    <span className="font-medium">{v.label}</span>
                    {v.priority === "CRITICAL" && (
                      <span className="ml-1 text-[9px] text-red-600 font-semibold">CRITICAL</span>
                    )}
                    {v.priority === "SIGNIFICANT" && (
                      <span className="ml-1 text-[9px] text-orange-600 font-semibold">SIGNIFICANT</span>
                    )}
                    <span className="text-[9px] text-muted-foreground block">{v.triggerKeywords.slice(0, 3).join(", ")}</span>
                  </button>
                ))}
                <button
                  onClick={() => onApplyVariant(t.title, t.findings, t.impression)}
                  className="w-full text-left text-[10px] rounded-md border bg-background px-2 py-1 hover:bg-green-50 hover:border-green-200 transition-colors"
                >
                  <span className="font-medium">Master Default</span>
                </button>
              </div>
            )}
          </div>
        ))}
        {matchedTemplates.length === 0 && <p className="text-[10px] text-muted-foreground">No templates found.</p>}
      </div>
    </div>
  );
}

// ── Phase 3: Advanced Measurement Library Panel ──
function AdvancedMeasurementLibraryPanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = ALL_MEASUREMENT_TEMPLATES;
    if (selectedCategory !== "all") {
      const cat = MEASUREMENT_CATEGORIES.find((c) => c.id === selectedCategory);
      if (cat) {
        list = cat.templates;
      }
    }
    if (!query.trim()) return list;
    return list.filter(
      (m) =>
        m.label.toLowerCase().includes(query.toLowerCase()) ||
        m.category.toLowerCase().includes(query.toLowerCase()) ||
        m.bodyPart.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, selectedCategory]);

  return (
    <div className="flex-1 overflow-y-auto border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Ruler className="h-3 w-3" /> Measurement Library
      </h3>
      <p className="text-[10px] text-muted-foreground">One-click measurement templates with normal ranges.</p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search measurements..." className="text-xs h-6" />
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedCategory("all")}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedCategory === "all" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          All
        </button>
        {MEASUREMENT_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedCategory === c.id ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {filtered.map((m) => (
          <button
            key={m.id}
            onClick={() => onInsert(m.insertText)}
            className="w-full text-left text-xs rounded-md border bg-background px-2 py-1.5 hover:bg-blue-50 hover:border-blue-200 transition-colors"
            title={`Normal range: ${m.normalRange ?? "N/A"}`}
          >
            <span className="font-medium">{m.label}</span>
            {m.normalRange && (
              <span className="text-[10px] text-muted-foreground ml-1">({m.normalRange})</span>
            )}
            <span className="text-[9px] text-green-600 ml-1 opacity-0 group-hover:opacity-100">Insert →</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-[10px] text-muted-foreground">No measurements found.</p>}
      </div>
    </div>
  );
}

// ── Phase 3 Chunk 2: One-Click Reports Panel ──
function OneClickReportsPanel({
  modality,
  studyDescription,
  onApply,
}: {
  modality: string;
  studyDescription: string | null;
  onApply: (title: string, findings: string, impression: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedModality, setSelectedModality] = useState<string | null>(modality);

  const filtered = useMemo(() => {
    let list = ONE_CLICK_REPORTS;
    if (selectedModality) {
      list = list.filter((r) => r.modality === selectedModality);
    }
    if (!query.trim()) return list;
    return list.filter(
      (r) =>
        r.label.toLowerCase().includes(query.toLowerCase()) ||
        r.bodyPart.toLowerCase().includes(query.toLowerCase()) ||
        r.title.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, selectedModality]);

  return (
    <div className="flex-1 overflow-y-auto border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Zap className="h-3 w-3" /> One-Click Reports
      </h3>
      <p className="text-[10px] text-muted-foreground">Pre-built complete reports. Click to apply directly.</p>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reports..." className="text-xs h-6" />
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setSelectedModality(null)}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedModality === null ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          All
        </button>
        {["MR", "US", "CT", "XR"].map((m) => (
          <button
            key={m}
            onClick={() => setSelectedModality(m)}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedModality === m ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {filtered.map((r) => (
          <button
            key={r.id}
            onClick={() => onApply(r.title, r.findings, r.impression)}
            className={`w-full text-left text-xs rounded-md border bg-background px-2 py-1.5 hover:bg-blue-50 hover:border-blue-200 transition-colors ${
              r.priority === "CRITICAL" ? "border-red-200" : r.priority === "SIGNIFICANT" ? "border-orange-200" : ""
            }`}
          >
            <span className="font-medium">{r.label}</span>
            {r.priority === "CRITICAL" && <span className="ml-1 text-[9px] text-red-600 font-semibold">CRITICAL</span>}
            {r.priority === "SIGNIFICANT" && <span className="ml-1 text-[9px] text-orange-600 font-semibold">SIGNIFICANT</span>}
            <span className="text-[10px] text-muted-foreground ml-1">({r.modality} — {r.bodyPart})</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-[10px] text-muted-foreground">No reports found.</p>}
      </div>
    </div>
  );
}

// ── Phase 3 Chunk 2: QA Guard Panel ──
function QAGuardPanel({ findings, impression }: { findings: string; impression: string }) {
  const qa = runQAGuard(findings, impression);
  const criticals = detectCriticalFindings(findings);
  return (
    <div className="flex-1 overflow-y-auto border-t p-3 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" /> QA Guard
      </h3>
      <div className="flex items-center gap-2">
        <span className={`text-lg font-bold ${qa.score >= 85 ? "text-green-600" : qa.score >= 60 ? "text-amber-600" : "text-red-600"}`}>
          {qa.score}
        </span>
        <span className="text-xs text-muted-foreground">/100</span>
        {qa.passed ? (
          <Badge className="bg-green-100 text-green-700 text-[10px]">PASS</Badge>
        ) : qa.canOverride ? (
          <Badge className="bg-amber-100 text-amber-700 text-[10px]">CAN OVERRIDE</Badge>
        ) : (
          <Badge className="bg-red-100 text-red-700 text-[10px]">BLOCK</Badge>
        )}
      </div>
      <div className="space-y-1">
        {qa.checks.map((c) => (
          <div key={c.id} className={`flex items-center justify-between text-xs px-2 py-1 rounded border ${c.pass ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <span className={c.pass ? "text-green-700" : "text-amber-700"}>{c.label}</span>
            {c.pass ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <AlertTriangle className="h-3 w-3 text-amber-600" />}
          </div>
        ))}
      </div>
      {criticals.length > 0 && (
        <div className="space-y-1">
          {criticals.map((c, i) => (
            <div key={i} className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <p className="font-semibold text-red-700">⚠ {c.label}</p>
              <p className="text-[10px] text-red-500">{c.message}</p>
            </div>
          ))}
        </div>
      )}
      {qa.criticalAlerts.length > 0 && (
        <div className="space-y-1">
          {qa.criticalAlerts.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-600">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase 3 Chunk 2: Finalization Dashboard ──
function FinalizationDashboard({
  findings,
  impression,
  reportTitle,
  onClose,
}: {
  findings: string;
  impression: string;
  reportTitle: string;
  onClose: () => void;
}) {
  const qa = runQAGuard(findings, impression);
  const criticals = detectCriticalFindings(findings);
  const detected = detectFindingsFromText(findings);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto border-t p-3 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <BarChart3 className="h-3 w-3" /> Finalization Dashboard
      </h3>
      <div className={`rounded-lg border p-2 ${qa.score >= 85 ? "bg-green-50 border-green-200" : qa.score >= 60 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${qa.score >= 85 ? "text-green-600" : qa.score >= 60 ? "text-amber-600" : "text-red-600"}`}>{qa.score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <Badge className={`text-[10px] ${qa.score >= 85 ? "bg-green-100 text-green-700" : qa.score >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
            {qa.score >= 85 ? "READY" : qa.score >= 60 ? "REVIEW" : "BLOCKED"}
          </Badge>
        </div>
        <p className="text-[10px] mt-1">
          {qa.score >= 85 ? "All checks passed. Report ready for finalization." : qa.score >= 60 ? "Some issues found. Review warnings before finalizing." : "Critical issues detected. Resolve before finalizing."}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-muted-foreground">Detected Findings</p>
        {detected.map((d, i) => (
          <div key={i} className={`text-xs rounded px-2 py-1 border ${d.priority === "CRITICAL" ? "bg-red-50 border-red-200 text-red-700" : d.priority === "SIGNIFICANT" ? "bg-orange-50 border-orange-200 text-orange-700" : "bg-blue-50 border-blue-200 text-blue-700"}`}>
            {d.label} — {d.priority}
          </div>
        ))}
        {detected.length === 0 && <p className="text-[10px] text-muted-foreground">No specific findings detected.</p>}
      </div>
      {criticals.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-red-600">Critical Findings</p>
          {criticals.map((c, i) => (
            <div key={i} className="text-xs bg-red-50 border border-red-200 rounded px-2 py-1.5">
              <p className="font-semibold text-red-700">{c.label}</p>
              <p className="text-[10px] text-red-500">{c.message}</p>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-muted-foreground">Checks</p>
        {qa.checks.map((c) => (
          <div key={c.id} className={`text-[10px] px-2 py-1 rounded border ${c.pass ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
            {c.pass ? "✓" : "✗"} {c.label} {c.message ? `— ${c.message}` : ""}
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded border-gray-300" />
        <span className="text-muted-foreground">I have reviewed this report and confirm it is accurate.</span>
      </label>
      <div className="flex gap-2">
        <Button size="sm" className="text-xs w-full" disabled={!qa.canOverride || !confirmed} onClick={onClose}>
          <CheckCircle2 className="h-3 w-3 mr-1" /> Close
        </Button>
      </div>
    </div>
  );
}
