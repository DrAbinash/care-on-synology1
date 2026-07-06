import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import VoiceDictationButton from "@/components/VoiceDictationButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { readStaffSession } from "@/lib/staffSession";
import { api } from "@/lib/fetchApi";
import {
  ArrowLeft, ExternalLink, Sparkles, Save, CheckCircle2, AlertTriangle,
  Printer, RefreshCw, Star, ClipboardList, Plus, Trash2, Eye,
  Share2, AlertCircle, X, Send, Zap, BookOpen, MonitorPlay,
  LayoutTemplate, BarChart3, Monitor,
} from "lucide-react";
import EmbeddedWadoViewer from "@/components/EmbeddedWadoViewer";
import RadiologyCopilotPanel from "@/components/RadiologyCopilotPanel";
import RadiologyMemoryPanel from "@/components/RadiologyMemoryPanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
import QuickFindingsPanel, {
  mergeBlock, removeBlock, mergeImpression, removeImpression,
  type QuickFinding,
} from "@/components/radiology/QuickFindingsPanel";
import { applySide, type Side } from "@/lib/sideSwap";
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
import { upsertMeasurement } from "@/lib/measurementVars";
import CollapsibleSection from "@/components/radiology/CollapsibleSection";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import { useLocalDraftBackup } from "@/hooks/useLocalDraftBackup";
import { isOwnerRole } from "@/lib/staffSession";

// ════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════

type WorklistEntry = {
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
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  aiDraftJson: string | null;
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
  studyType: string | null;
  sectionsJson: string;
  defaultFindings: string | null;
  defaultImpression: string | null;
  macrosJson: string;
  isActive: boolean;
  isPreset: boolean;
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

type ImageReference = {
  id?: number;
  seriesNumber: string;
  imageNumber: string;
  description: string;
};

type StylePreferences = {
  impressionStyle: "concise" | "detailed" | "academic" | "diagnostic";
  terminologyLevel: "simple" | "standard" | "advanced";
  autoNumberImpressions: boolean;
  includeDifferential: boolean;
  includeMeasurements: boolean;
};

type RightTab = "quickselect" | "templates" | "followup" | "prior" | "ai" | "measurements" | "teaching";

const STATUS_CONFIG: Record<string, { label: string; color: string; locked: boolean }> = {
  DRAFT: { label: "Draft", color: "bg-yellow-100 text-yellow-800 border-yellow-300", locked: false },
  PENDING_REVIEW: { label: "Pending Review", color: "bg-blue-100 text-blue-800 border-blue-300", locked: false },
  FINAL: { label: "Final", color: "bg-green-100 text-green-800 border-green-300", locked: true },
  AMENDED: { label: "Amended", color: "bg-orange-100 text-orange-800 border-orange-300", locked: true },
};

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

function parseSectionsJson(json: string): TemplateSections {
  try {
    return JSON.parse(json) as TemplateSections;
  } catch {
    return { technique: "", findingsItems: [] };
  }
}

function parseMacrosJson(json: string): TemplateMacro[] {
  try {
    return JSON.parse(json) as TemplateMacro[];
  } catch {
    return [];
  }
}

function resolvePlaceholders(text: string, ctx: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => ctx[key] ?? `[${key}]`);
}

function fmtHeading(text: string, headingCase: "all_caps" | "title_case"): string {
  if (headingCase === "all_caps") return text.toUpperCase();
  return text.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function escHtml(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildPreviewHtml(opts: {
  patientName: string;
  age: string;
  sex: string;
  accessionNumber: string;
  referringDoctor: string;
  studyDate: string;
  studyName: string;
  technique: string;
  clinicalHistory: string;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  rawFindings: string;
  useStructured: boolean;
  impression: string[];
  recommendation: string;
  imageRefs: ImageReference[];
  headingCase?: "all_caps" | "title_case";
  sectionSpacing?: "spaced" | "compact";
  impressionStyle?: "bulleted" | "numbered" | "plain";
}): string {
  const hc = opts.headingCase ?? "all_caps";
  const ss = opts.sectionSpacing ?? "spaced";
  const sp = ss === "compact" ? "2px" : "10px";
  const sp2 = ss === "compact" ? "4px" : "12px";

  const headerHtml = `<p style="margin:0 0 2px;"><strong>NAME: ${escHtml(opts.patientName)} &nbsp;&nbsp; AGE/SEX: ${escHtml(opts.age ?? "")}/${escHtml(opts.sex ?? "")} &nbsp;&nbsp; ACC: ${escHtml(opts.accessionNumber)}</strong></p>
  <p style="margin:0 0 2px;"><strong>REF. BY: ${escHtml(opts.referringDoctor)} &nbsp;&nbsp; DATE: ${escHtml(opts.studyDate)}</strong></p>`;

  let findingsHtml = "";
  if (opts.useStructured) {
    findingsHtml = Object.entries(opts.findingsMap)
      .map(([label, item]) => {
        const status = item.normal ? "Normal" : item.text.trim() || "—";
        return `<p style="margin:${sp} 0;"><strong><u>${escHtml(fmtHeading(label, hc))}</u></strong><br/>${escHtml(status).replaceAll("\n", "<br/>")}</p>`;
      })
      .join("\n");
  } else {
    findingsHtml = `<p style="margin:0 0 ${sp};">${escHtml(opts.rawFindings).replaceAll("\n", "<br/>") || "<em style='color:#aaa;'>No findings entered.</em>"}</p>`;
  }

  const impressionBullets = opts.impression.filter(Boolean);
  let impressionHtml = "";
  if (impressionBullets.length > 0) {
    const ist = opts.impressionStyle ?? "bulleted";
    if (ist === "numbered") {
      impressionHtml = `<ol style="margin:4px 0 0 22px;padding:0;">${impressionBullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ol>`;
    } else if (ist === "plain") {
      impressionHtml = `<p style="margin:4px 0;">${impressionBullets.map((b) => escHtml(b)).join("; ")}</p>`;
    } else {
      impressionHtml = `<ul style="margin:4px 0 0 18px;padding:0;">${impressionBullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>`;
    }
  } else {
    impressionHtml = `<p style="margin:4px 0;color:#aaa;"><em>Draft impression — not verified.</em></p>`;
  }

  const imagesHtml = opts.imageRefs.length > 0
    ? `<h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Key Images", hc)}</u></h3>
    <ul style="margin:4px 0 0 18px;padding:0;">${opts.imageRefs.map((img) => `<li>Series ${escHtml(img.seriesNumber)} Image ${escHtml(img.imageNumber)}: ${escHtml(img.description)}</li>`).join("")}</ul>`
    : "";

  return `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111;max-width:720px;margin:0 auto;">
    ${headerHtml}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h2 style="text-align:center;text-decoration:underline;font-size:15px;margin:8px 0;"><strong>${escHtml(opts.studyName)}</strong></h2>
    <h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Technique", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(opts.technique)}</p>
    ${opts.clinicalHistory ? `<h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Clinical History", hc)}</u></h3><p style="margin:0 0 ${sp};">${escHtml(opts.clinicalHistory)}</p>` : ""}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h3 style="margin:${sp} 0 ${sp};"><u>${fmtHeading("Findings / Observation", hc)}</u></h3>
    ${findingsHtml}
    ${imagesHtml}
    <h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Impression", hc)}</u></h3>
    ${impressionHtml}
    <h3 style="margin:${sp2} 0 ${sp};"><u>${fmtHeading("Recommendation", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(opts.recommendation || "Please correlate with clinical findings.")}</p>
    <hr style="border:none;border-top:1px solid #999;margin:${sp2} 0 4px;" />
    <p style="font-size:11px;color:#666;font-style:italic;margin:0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>
  </div>`.trim();
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export default function RadiologyReportingWorkspace({ studyId }: { studyId?: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();
  const previewRef = useRef<HTMLDivElement>(null);

  // ── Layout ────────────────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<RightTab>("templates");
  const [previewMode, setPreviewMode] = useState(false);

  // ── Template selection ────────────────────────────────────────────────────
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState<string>("");

  // ── Report content ────────────────────────────────────────────────────────
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [findingsMap, setFindingsMap] = useState<Record<string, { normal: boolean; text: string }>>({});
  const [impression, setImpression] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [useStructured, setUseStructured] = useState(true);
  const [imageRefs] = useState<ImageReference[]>([]);

  // ── Report meta ───────────────────────────────────────────────────────────
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [reportStatus, setReportStatus] = useState<string>("DRAFT");

  // ── AI ────────────────────────────────────────────────────────────────────
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOutput, setAiOutput] = useState("");

  // ── Style ─────────────────────────────────────────────────────────────────
  const [headingCase, setHeadingCase] = useState<"all_caps" | "title_case">("all_caps");
  const [sectionSpacing, setSectionSpacing] = useState<"spaced" | "compact">("spaced");
  const [impressionStyle, setImpressionStyle] = useState<"bulleted" | "numbered" | "plain">("bulleted");
  const [stylePrefs, setStylePrefs] = useState<StylePreferences>({
    impressionStyle: "concise",
    terminologyLevel: "standard",
    autoNumberImpressions: true,
    includeDifferential: false,
    includeMeasurements: false,
  });

  // ── Loading ───────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [teachingNotes, setTeachingNotes] = useState("");
  const [savingTeaching, setSavingTeaching] = useState(false);

  // ── Quick Select — Smart Report Engine (Phase 2) ──────────────────────────
  // Each button is a smart object (technique / findings / impression /
  // recommendation). At insert time the side selector transforms the text
  // (left↔right↔bilateral, whole words only); insertedTextRef remembers the
  // EXACT strings inserted per button so that deselect removes precisely
  // what went in — even if the side selector changed afterwards. Manually
  // edited text is never touched (exact-match removal only).
  const [selectedQuickIds, setSelectedQuickIds] = useState<Set<number>>(new Set());
  const [quickSide, setQuickSide] = useState<Side>("left");
  const insertedTextRef = useRef<Map<number, { finding: string; impression: string; technique: string; recommendation: string }>>(new Map());

  function handleQuickToggle(f: QuickFinding, nowSelected: boolean) {
    setSelectedQuickIds((prev) => {
      const next = new Set(prev);
      if (nowSelected) next.add(f.id);
      else next.delete(f.id);
      return next;
    });
    if (nowSelected) {
      const inserted = {
        finding: f.findingText ? applySide(f.findingText, quickSide) : "",
        impression: f.impressionText ? applySide(f.impressionText, quickSide) : "",
        technique: f.techniqueText ? applySide(f.techniqueText, quickSide) : "",
        recommendation: f.recommendationText ? applySide(f.recommendationText, quickSide) : "",
      };
      insertedTextRef.current.set(f.id, inserted);
      if (inserted.finding) setRawFindings((prev) => mergeBlock(prev, inserted.finding));
      if (inserted.impression) setImpression((prev) => mergeImpression(prev, inserted.impression));
      if (inserted.technique) setTechnique((prev) => mergeBlock(prev, inserted.technique));
      if (inserted.recommendation) setRecommendation((prev) => mergeBlock(prev, inserted.recommendation));
    } else {
      // Remove exactly what this button inserted (fall back to the raw
      // template if the map has no record, e.g. after a page reload).
      const inserted = insertedTextRef.current.get(f.id) ?? {
        finding: f.findingText, impression: f.impressionText,
        technique: f.techniqueText, recommendation: f.recommendationText,
      };
      insertedTextRef.current.delete(f.id);
      if (inserted.finding) setRawFindings((prev) => removeBlock(prev, inserted.finding));
      if (inserted.impression) setImpression((prev) => removeImpression(prev, inserted.impression));
      if (inserted.technique) setTechnique((prev) => removeBlock(prev, inserted.technique));
      if (inserted.recommendation) setRecommendation((prev) => removeBlock(prev, inserted.recommendation));
    }
  }

  // Smart Measurements (Phase 3): re-entering a measurement updates the
  // existing sentence's value everywhere instead of appending a duplicate.
  function handleSmartMeasurement(templateText: string, value: string) {
    setRawFindings((prev) => {
      const { text, updated } = upsertMeasurement(prev, templateText, value);
      if (updated) toast({ title: "Measurement updated", description: "Existing value replaced in the report." });
      return text;
    });
  }

  // Live Report Quality Score (Phase 3) — recomputed as the radiologist
  // types; purely informational, never blocks anything.
  const quality = useMemo(
    () => computeQualityScore({ findings: rawFindings, impression, recommendation, technique, clinicalHistory }),
    [rawFindings, impression, recommendation, technique, clinicalHistory],
  );

  // Intelligent Normal Generator (Phase 3, structured mode): sets every
  // section the radiologist has NOT touched back to its template-normal
  // text. "Touched" = text differs from the template normal — those are
  // never overwritten.
  function fillRemainingNormals() {
    const sections = selectedTemplate ? parseSectionsJson(selectedTemplate.sectionsJson) : null;
    if (!sections) return;
    setFindingsMap((prev) => {
      const next = { ...prev };
      for (const item of sections.findingsItems) {
        const cur = next[item.label];
        const untouched = !cur || !cur.text.trim() || cur.text === item.normal;
        if (untouched) next[item.label] = { normal: true, text: item.normal };
      }
      return next;
    });
    toast({ title: "Remaining systems set to normal", description: "Edited sections were not changed." });
  }

  // ── Local unsaved-draft protection ────────────────────────────────────────
  // Backs up the typed report to this browser's localStorage every ~2s so a
  // crash, accidental tab close, or temporary API failure never loses work.
  // Cleared on successful finalize.
  const draftSnapshot = useMemo(
    () => ({ clinicalHistory, technique, rawFindings, impression, recommendation }),
    [clinicalHistory, technique, rawFindings, impression, recommendation],
  );
  const draftBackup = useLocalDraftBackup({
    storageKey: `radiology_report_backup_${studyId ?? "new"}`,
    snapshot: draftSnapshot,
    enabled: reportStatus !== "FINAL",
  });

  function restoreLocalBackup() {
    const b = draftBackup.restore();
    if (!b) return;
    if (b.clinicalHistory) setClinicalHistory(b.clinicalHistory);
    if (b.technique) setTechnique(b.technique);
    if (b.rawFindings) setRawFindings(b.rawFindings);
    if (Array.isArray(b.impression) && b.impression.length) setImpression(b.impression);
    if (b.recommendation) setRecommendation(b.recommendation);
    toast({ title: "Unsaved work restored", description: "Your locally backed-up report text has been restored." });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATA FETCHING
  // ══════════════════════════════════════════════════════════════════════════

  const { data: entry, isLoading: entryLoading } = useQuery<WorklistEntry>({
    queryKey: ["workspace-entry", studyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${studyId}`),
    enabled: !!studyId,
  });

  const { data: templates = [] } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get<StructuredTemplate[]>("/api/radiology/structured-report-templates"),
  });

  const { data: normalSnippets = [] } = useQuery<NormalSnippet[]>({
    queryKey: ["normal-snippets", entry?.modality, entry?.studyDescription],
    queryFn: () =>
      api.get<NormalSnippet[]>(
        `/api/radiology/report-generator/normal-snippets?modality=${entry?.modality || ""}&bodyPart=${entry?.studyDescription || ""}`
      ),
    enabled: !!entry,
  });

  // Load style preferences
  useEffect(() => {
    if (!session) return;
    api
      .get<StylePreferences>("/api/radiology/report-generator/style-preferences")
      .then((p) => setStylePrefs(p))
      .catch(() => { /* ignore */ });
  }, [session]);

  // Auto-select template based on worklist entry
  useEffect(() => {
    if (!entry || templates.length === 0) return;
    const modalityMap: Record<string, string> = { "X-RAY": "X-RAY", USG: "USG", MRI: "MRI", CT: "CT" };
    const mod = modalityMap[entry.modality] || entry.modality;
    const bodyPart = (entry.studyDescription || "").toUpperCase();
    let match = templates.find((t) => t.modality === mod && bodyPart.includes(t.bodyPart));
    if (!match) match = templates.find((t) => t.modality === mod);
    if (match && match.id !== selectedTemplateId) setSelectedTemplateId(match.id);
  }, [entry, templates, selectedTemplateId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  // Load template content when selected
  useEffect(() => {
    if (!selectedTemplate) return;
    const sections = parseSectionsJson(selectedTemplate.sectionsJson);
    setTechnique(sections.technique);
    const map: Record<string, { normal: boolean; text: string }> = {};
    for (const item of sections.findingsItems) {
      map[item.label] = { normal: true, text: item.normal };
    }
    setFindingsMap(map);
    setRawFindings(selectedTemplate.defaultFindings || "");
    setImpression(selectedTemplate.defaultImpression ? [selectedTemplate.defaultImpression] : []);
    setRecommendation("Please correlate with clinical findings.");
  }, [selectedTemplate]);

  // Pre-populate from AI draft
  useEffect(() => {
    if (!entry?.aiDraftJson) return;
    try {
      const draft = JSON.parse(entry.aiDraftJson) as Record<string, string>;
      if (draft.clinical_history) setClinicalHistory(draft.clinical_history);
      if (draft.technique) setTechnique(draft.technique);
      if (draft.findings) setRawFindings(draft.findings);
      if (draft.impression) setImpression([draft.impression]);
      if (draft.recommendation) setRecommendation(draft.recommendation);
    } catch { /* ignore */ }
  }, [entry?.aiDraftJson]);

  // Set status from entry
  useEffect(() => {
    if (!entry) return;
    setReportStatus(entry.status === "REPORT_FINAL" ? "FINAL" : "DRAFT");
  }, [entry?.status]);

  // ══════════════════════════════════════════════════════════════════════════
  // MEMOS
  // ══════════════════════════════════════════════════════════════════════════

  const filteredTemplates = useMemo(() => {
    let rows = templates;
    if (modalityFilter) rows = rows.filter((t) => t.modality === modalityFilter);
    if (templateSearch.trim()) {
      const q = templateSearch.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.templateName.toLowerCase().includes(q) ||
          t.bodyPart.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [templates, modalityFilter, templateSearch]);

  const modalities = useMemo(() => {
    const set = new Set(templates.map((t) => t.modality));
    return Array.from(set).sort();
  }, [templates]);

  const isLocked = STATUS_CONFIG[reportStatus]?.locked ?? false;

  const previewHtml = useMemo(
    () =>
      buildPreviewHtml({
        patientName: entry?.patientName || "",
        age: entry?.age || "",
        sex: entry?.sex || "",
        accessionNumber: entry?.accessionNumber || "",
        referringDoctor: entry?.referringDoctor || "",
        studyDate: entry?.studyDate || "",
        studyName:
          selectedTemplate?.templateName || entry?.studyDescription || "Radiology Report",
        technique,
        clinicalHistory,
        findingsMap,
        rawFindings,
        useStructured,
        impression,
        recommendation,
        imageRefs,
        headingCase,
        sectionSpacing,
        impressionStyle,
      }),
    [
      entry,
      selectedTemplate,
      technique,
      clinicalHistory,
      findingsMap,
      rawFindings,
      useStructured,
      impression,
      recommendation,
      imageRefs,
      headingCase,
      sectionSpacing,
      impressionStyle,
    ]
  );

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  function openWeasis() {
    if (!entry?.studyInstanceUID) {
      toast({ title: "No StudyInstanceUID", variant: "destructive" });
      return;
    }
    window.open(`/api/radiology/studies/${entry.studyInstanceUID}/weasis-launch-redirect`, "_blank");
  }

  function applyMacro(macro: TemplateMacro) {
    const ctx: Record<string, string> = {
      patient_name: entry?.patientName || "",
      age: entry?.age || "",
      sex: entry?.sex || "",
      clinical_history: clinicalHistory,
      modality: entry?.modality || "",
      ref_doctor: entry?.referringDoctor || "",
    };
    const resolved = resolvePlaceholders(macro.text, ctx);
    setRawFindings((prev) => prev + (prev ? "\n\n" : "") + resolved);
    toast({ title: `Inserted: ${macro.label}` });
  }

  function applyNormalSnippet(snippet: NormalSnippet) {
    setRawFindings(snippet.text);
    if (snippet.impression) setImpression([snippet.impression]);
    if (snippet.recommendation) setRecommendation(snippet.recommendation);
    toast({ title: `Applied: ${snippet.label}` });
  }

  function addImpressionLine() {
    setImpression((prev) => [...prev, ""]);
  }

  function updateImpression(index: number, value: string) {
    setImpression((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function removeImpression(index: number) {
    setImpression((prev) => prev.filter((_, i) => i !== index));
  }

  const aiImpressionMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No study loaded");
      setAiLoading(true);
      const res = await api.post<{ aiResponse: string }>("/api/ai-reporting/query", {
        promptText: `As a radiologist, generate a numbered, clinically relevant impression from these findings. Be concise.\n\nFindings:\n${rawFindings || JSON.stringify(findingsMap)}\n\nClinical History: ${clinicalHistory}\nModality: ${entry.modality}\nStyle: ${stylePrefs.impressionStyle}`,
        studyInstanceUID: entry.studyInstanceUID,
        accessionNumber: entry.accessionNumber,
        patientId: entry.patientId ?? undefined,
        includeDemographics: true,
        provider: "gemini",
        maxImages: 0,
      });
      return res.aiResponse;
    },
    onSuccess: (text) => {
      setAiOutput(text);
      setAiLoading(false);
      toast({ title: "AI Draft Generated", description: "Review before inserting." });
    },
    onError: (err) => {
      setAiLoading(false);
      toast({
        title: "AI Error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    },
  });

  function insertAiOutput() {
    if (!aiOutput.trim()) return;
    const lines = aiOutput
      .split(/\n/)
      .map((l) => l.replace(/^\d+[.\)]\s*/, "").trim())
      .filter(Boolean);
    setImpression(lines);
    setAiOutput("");
    toast({ title: "Inserted into impression" });
  }

  async function saveDraft() {
    setSaving(true);
    try {
      await api.post("/api/radiology/report-generator/save-draft", {
        studyId: entry?.studyId ?? null,
        worklistId: entry?.id ?? null,
        patientId: entry?.patientId ?? null,
        templateId: selectedTemplate?.templateName || null,
        modality: entry?.modality || null,
        studyName: selectedTemplate?.templateName || entry?.studyDescription || null,
        clinicalHistory: clinicalHistory || null,
        rawFindings: rawFindings || null,
        findingsSections: useStructured ? findingsMap : null,
        impression: impression.filter(Boolean),
        recommendation: recommendation || null,
      });
      toast({ title: "Draft Saved" });
    } catch (err) {
      toast({
        title: "Save Failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function finalizeReport() {
    if (!entry) return;
    // Guard against double-finalize: both re-clicks while in flight
    // (finalizing flag) and re-finalizing an already-final report.
    if (finalizing || reportStatus === "FINAL") return;

    // AI Report Validator (Phase 2) — rule-based pre-finalize checks.
    // WARN ONLY: the radiologist always decides; nothing is auto-corrected.
    const warnings = validateReport({ findings: rawFindings, impression, recommendation });
    if (warnings.length > 0) {
      const proceed = window.confirm(
        `Report check found ${warnings.length} warning(s):\n\n` +
        warnings.map((w, i) => `${i + 1}. ${w}`).join("\n") +
        `\n\nFinalize anyway?`,
      );
      if (!proceed) return;
    } else if (!window.confirm("Finalize this report? After finalizing, editing is disabled.")) {
      return;
    }
    setFinalizing(true);
    try {
      const html = buildPreviewHtml({
        patientName: entry.patientName || "",
        age: entry.age || "",
        sex: entry.sex || "",
        accessionNumber: entry.accessionNumber,
        referringDoctor: entry.referringDoctor || "",
        studyDate: entry.studyDate || "",
        studyName: selectedTemplate?.templateName || entry.studyDescription || "Radiology Report",
        technique,
        clinicalHistory,
        findingsMap,
        rawFindings,
        useStructured,
        impression,
        recommendation,
        imageRefs,
        headingCase,
        sectionSpacing,
        impressionStyle,
      });

      let reportId: number | null = null;
      if (entry.patientId) {
        const report = await api.post<{ id: number }>("/api/patient-reports", {
          patientId: entry.patientId,
          testId: null,
          studyId: entry.studyId ?? null,
          type: "radiology",
          title:
            selectedTemplate?.templateName || entry.studyDescription || "Radiology Report",
          body: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          impression: impression.join("\n"),
          parameters: JSON.stringify({
            modality: entry.modality,
            studyDescription: entry.studyDescription,
            accessionNumber: entry.accessionNumber,
            studyInstanceUID: entry.studyInstanceUID,
          }),
          isCritical,
          criticalNote: isCritical ? criticalNote : null,
          createdBy: session?.user.name ?? "Radiologist",
        });
        reportId = report.id;
      }

      await api.post("/api/internal/radiology/report-status", {
        accessionNumber: entry.accessionNumber,
        studyInstanceUID: entry.studyInstanceUID,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: session?.user.name ?? "staff",
      });

      await api.post("/api/radiology/report-generator/log-action", {
        studyId: entry.studyId || entry.id,
        action: "FINALIZED",
        newValue: "FINAL",
        details: JSON.stringify({
          template: selectedTemplate?.templateName,
          critical: isCritical,
        }),
      });

      setReportStatus("FINAL");
      // Finalized text is now safely on the server — remove the local
      // backup so patient report text never lingers on a shared machine.
      draftBackup.clear();
      toast({
        title: "Report Finalized",
        description: reportId ? `Report ID: ${reportId}` : "Worklist updated.",
      });
      void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    } catch (err) {
      toast({
        title: "Finalize Failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setFinalizing(false);
    }
  }

  function printReport() {
    if (!previewRef.current) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<html><head><title>Radiology Report</title></head><body>${previewRef.current.innerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 250);
  }

  async function shareWhatsApp() {
    if (!entry?.patientId) {
      toast({ title: "No patient linked", variant: "destructive" });
      return;
    }
    try {
      await api.post("/api/whatsapp/send-report", {
        patientId: entry.patientId,
        reportType: "radiology",
        message: `Your radiology report for ${entry.studyDescription || "study"} (Acc: ${entry.accessionNumber}) is ready.`,
      });
      toast({ title: "Report sent" });
    } catch (err) {
      toast({
        title: "Failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    }
  }

  async function saveTeachingCase() {
    if (!rawFindings.trim()) {
      toast({ title: "Enter findings first", variant: "destructive" });
      return;
    }
    setSavingTeaching(true);
    try {
      await api.post("/api/teaching-cases/generate-from-report", {
        patientId: entry?.patientId ?? null,
        studyId: entry?.studyId ?? null,
        worklistId: entry?.id ?? null,
        modality: entry?.modality ?? "",
        bodyPart: entry?.studyDescription ?? "",
        findings: rawFindings,
        impression: impression.filter(Boolean).join("\n"),
        clinicalHistory,
        notes: teachingNotes,
      });
      toast({ title: "Saved as Teaching Case", description: "Patient identifiers removed." });
      setTeachingNotes("");
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setSavingTeaching(false);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INNER COMPONENTS
  // ══════════════════════════════════════════════════════════════════════════

  function TemplatesTab() {
    const macros = selectedTemplate ? parseMacrosJson(selectedTemplate.macrosJson) : [];
    return (
      <div className="flex flex-col gap-2 p-2">
        {/* Modality filter */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setModalityFilter("")}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
              modalityFilter === ""
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-white hover:bg-muted/50"
            }`}
          >
            All
          </button>
          {modalities.map((m) => (
            <button
              key={m}
              onClick={() => setModalityFilter(m === modalityFilter ? "" : m)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                modalityFilter === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white hover:bg-muted/50"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Search */}
        <Input
          placeholder="Search templates..."
          value={templateSearch}
          onChange={(e) => setTemplateSearch(e.target.value)}
          className="h-7 text-xs"
        />

        {/* Template list */}
        <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
          {filteredTemplates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTemplateId(t.id)}
              className={`text-left text-xs px-2 py-1.5 rounded border transition-colors ${
                selectedTemplateId === t.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white hover:bg-muted/50"
              }`}
            >
              <div className="font-medium">{t.templateName}</div>
              <div className="text-[10px] opacity-70">{t.bodyPart} · {t.modality}</div>
            </button>
          ))}
          {filteredTemplates.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-2">No templates found</div>
          )}
        </div>

        {selectedTemplate && (
          <div className="text-[10px] text-muted-foreground border rounded px-2 py-1 bg-muted/20">
            Active: <span className="font-medium text-foreground">{selectedTemplate.templateName}</span>
          </div>
        )}

        {/* Normal snippets */}
        {normalSnippets.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              Normal Shortcuts
            </div>
            <div className="flex flex-col gap-1">
              {normalSnippets.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] justify-start px-2"
                  onClick={() => applyNormalSnippet(s)}
                  disabled={isLocked}
                >
                  <Star size={10} className="mr-1 text-amber-500 shrink-0" /> {s.label}
                </Button>
              ))}
            </div>
          </>
        )}

        {/* Macros */}
        {macros.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              Macros
            </div>
            <div className="flex flex-col gap-1">
              {macros.map((m) => (
                <Button
                  key={m.key}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] justify-start px-2"
                  onClick={() => applyMacro(m)}
                  disabled={isLocked}
                >
                  <Zap size={10} className="mr-1 text-blue-500 shrink-0" /> {m.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const RIGHT_TABS = [
    { id: "quickselect", label: "Quick", icon: <Zap size={11} /> },
    { id: "templates", label: "Templates", icon: <LayoutTemplate size={11} /> },
    { id: "followup", label: "Follow-up", icon: <RefreshCw size={11} /> },
    { id: "prior", label: "Prior", icon: <ClipboardList size={11} /> },
    { id: "ai", label: "AI", icon: <Sparkles size={11} /> },
    { id: "measurements", label: "Measure", icon: <BarChart3 size={11} /> },
    { id: "teaching", label: "Teaching", icon: <BookOpen size={11} /> },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 48px)" }}>

      {/* ── Compact header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b bg-white">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs shrink-0"
          onClick={() => navigate("/radiology/worklist")}
        >
          <ArrowLeft size={13} /> Worklist
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm">Radiology Reporting Workspace</span>
          {entry && (
            <span className="text-xs text-muted-foreground ml-2">
              {entry.patientName} · {entry.accessionNumber}
            </span>
          )}
        </div>
        <Badge
          className={`shrink-0 text-[10px] ${STATUS_CONFIG[reportStatus]?.color || ""}`}
        >
          {STATUS_CONFIG[reportStatus]?.label || reportStatus}
        </Badge>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch
            id="structured"
            checked={useStructured}
            onCheckedChange={setUseStructured}
            disabled={isLocked}
          />
          <Label htmlFor="structured" className="text-xs cursor-pointer select-none">
            Structured
          </Label>
        </div>
      </div>

      {/* ── 3-column body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT 35%: Study info + DICOM viewer ───────────────────────── */}
        <div
          className="flex flex-col border-r bg-muted/5 overflow-hidden shrink-0"
          style={{ width: "35%", minWidth: 280, maxWidth: 460 }}
        >
          {/* Study info */}
          <div className="shrink-0 p-3 border-b">
            {entryLoading && (
              <div className="text-xs text-muted-foreground py-2">Loading study...</div>
            )}
            {!entryLoading && !entry && (
              <div className="text-xs text-muted-foreground py-2">
                No study loaded. Open from worklist.
              </div>
            )}
            {entry && (
              <div className="flex flex-col gap-2">
                <div>
                  <div className="font-semibold text-sm">{entry.patientName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[entry.age, entry.sex].filter(Boolean).join(" / ")}
                  </div>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Accession</span>
                  <span className="font-mono truncate">{entry.accessionNumber}</span>
                  <span className="text-muted-foreground">Modality</span>
                  <Badge variant="outline" className="w-fit text-[10px] py-0 h-4">
                    {entry.modality}
                  </Badge>
                  <span className="text-muted-foreground">Study</span>
                  <span className="truncate">{entry.studyDescription || "—"}</span>
                  <span className="text-muted-foreground">Ref. Dr</span>
                  <span className="truncate">{entry.referringDoctor || "—"}</span>
                  <span className="text-muted-foreground">Date</span>
                  <span>{entry.studyDate || "—"}</span>
                </div>
                {/* Viewer launch buttons */}
                <div className="flex gap-1.5 flex-wrap pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={openWeasis}
                    disabled={!entry.studyInstanceUID}
                  >
                    <MonitorPlay size={12} /> Weasis
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      entry.studyInstanceUID &&
                      window.open(`/radiology/viewer/${entry.studyInstanceUID}`, "_blank")
                    }
                    disabled={!entry.studyInstanceUID}
                  >
                    <Monitor size={12} /> OHIF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      entry.studyInstanceUID &&
                      window.open(
                        `/api/radiology/studies/${entry.studyInstanceUID}/weasis-launch-redirect`,
                        "_blank"
                      )
                    }
                    disabled={!entry.studyInstanceUID}
                  >
                    <ExternalLink size={12} /> PACS
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* DICOM image viewer */}
          <div className="flex-1 overflow-hidden">
            {entry?.studyInstanceUID ? (
              <EmbeddedWadoViewer
                studyInstanceUID={entry.studyInstanceUID}
                accessionNumber={entry.accessionNumber}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                <MonitorPlay size={40} className="text-muted-foreground/20" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No DICOM study linked</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Open images in Weasis or OHIF using the buttons above.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER 45%: Report editor + action bar ────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">

          {/* Scrollable editor area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

            {/* Finalized banner */}
            {isLocked && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 border border-green-200 text-green-800 text-xs font-medium shrink-0">
                <CheckCircle2 size={14} /> Report is finalized. Editing is disabled.
              </div>
            )}

            {/* Unsaved local backup found — offer restore */}
            {!isLocked && draftBackup.restoreAvailable && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium shrink-0">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1">Unsaved report text from a previous session was found on this computer.</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={restoreLocalBackup}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={draftBackup.discard}>
                  Discard
                </Button>
              </div>
            )}

            {/* Live quality score + snapshot history + normals filler (Phase 3) */}
            {!isLocked && (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <span
                  className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${
                    quality.score >= 85
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : quality.score >= 60
                        ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                        : "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                  }`}
                  title={quality.issues.length ? quality.issues.map((i, n) => `${n + 1}. ${i}`).join("\n") : "Report is complete and consistent."}
                >
                  Quality {quality.score}/100{quality.issues.length > 0 ? ` · ${quality.issues.length} issue${quality.issues.length > 1 ? "s" : ""}` : ""}
                </span>
                {draftBackup.listSnapshots().length > 0 && (
                  <select
                    className="h-6 text-[10px] border rounded-md px-1 bg-background text-muted-foreground"
                    value=""
                    onChange={(e) => {
                      const ts = Number(e.target.value);
                      if (!ts) return;
                      const snap = draftBackup.restoreSnapshot(ts);
                      if (!snap) return;
                      if (!window.confirm(`Restore snapshot from ${new Date(ts).toLocaleTimeString()}? Current text will be replaced.`)) return;
                      setClinicalHistory(snap.clinicalHistory ?? "");
                      setTechnique(snap.technique ?? "");
                      setRawFindings(snap.rawFindings ?? "");
                      setImpression(Array.isArray(snap.impression) ? snap.impression : []);
                      setRecommendation(snap.recommendation ?? "");
                      toast({ title: "Snapshot restored" });
                    }}
                    title="Auto-saved snapshots (one per minute while you work)"
                  >
                    <option value="">Snapshots ({draftBackup.listSnapshots().length})…</option>
                    {draftBackup.listSnapshots().map((s) => (
                      <option key={s.ts} value={s.ts}>{new Date(s.ts).toLocaleTimeString()}</option>
                    ))}
                  </select>
                )}
                {useStructured && selectedTemplate && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={fillRemainingNormals}
                    title="Set every section you haven't edited to its normal text — edited sections are never changed">
                    Fill remaining normals
                  </Button>
                )}
              </div>
            )}

            {/* Clinical History — collapsible (Phase 3), layout remembered per browser */}
            <CollapsibleSection
              layoutKey="radiology_report_layout"
              id="clinical_history"
              title="Clinical History"
              headerExtra={
                <VoiceDictationButton
                  onInsert={(t) => setClinicalHistory((p) => p + t)}
                  targetField="clinical_history"
                  className="h-6 text-[10px]"
                />
              }
            >
              <Textarea
                value={clinicalHistory}
                onChange={(e) => setClinicalHistory(e.target.value)}
                placeholder="Enter clinical history..."
                className="min-h-[56px] text-sm resize-none"
                disabled={isLocked}
              />
            </CollapsibleSection>

            {/* Technique — collapsible (Phase 3) */}
            <CollapsibleSection
              layoutKey="radiology_report_layout"
              id="technique"
              title="Technique"
              headerExtra={
                <VoiceDictationButton
                  onInsert={(t) => setTechnique((p) => p + t)}
                  targetField="technique"
                  className="h-5 text-[10px]"
                />
              }
            >
              <Textarea
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                placeholder="Describe technique used..."
                className="min-h-[44px] text-sm resize-none"
                disabled={isLocked}
              />
            </CollapsibleSection>

            {/* Findings */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Findings / Observation</Label>
                <div className="flex items-center gap-1">
                  {selectedTemplate &&
                    parseMacrosJson(selectedTemplate.macrosJson)
                      .slice(0, 3)
                      .map((m) => (
                        <Button
                          key={m.key}
                          size="sm"
                          variant="outline"
                          className="h-5 text-[9px] px-1.5"
                          onClick={() => applyMacro(m)}
                          disabled={isLocked}
                        >
                          <Zap size={9} className="mr-0.5" /> {m.label}
                        </Button>
                      ))}
                  <VoiceDictationButton
                    onInsert={(t) => setRawFindings((p) => p + t)}
                    targetField="findings"
                    className="h-5 text-[10px]"
                  />
                </div>
              </div>

              {useStructured ? (
                <div className="flex flex-col gap-2">
                  {Object.entries(findingsMap).map(([label, item]) => (
                    <div key={label} className="flex flex-col gap-1 border rounded-md p-2.5 bg-white">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`norm-${label}`}
                          checked={item.normal}
                          onCheckedChange={(checked) =>
                            setFindingsMap((prev) => ({
                              ...prev,
                              [label]: { ...prev[label], normal: checked === true },
                            }))
                          }
                          disabled={isLocked}
                        />
                        <Label
                          htmlFor={`norm-${label}`}
                          className="text-xs font-semibold cursor-pointer"
                        >
                          {label}
                        </Label>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {item.normal ? "Normal" : "Abnormal"}
                        </span>
                      </div>
                      {!item.normal && (
                        <Textarea
                          value={item.text}
                          onChange={(e) =>
                            setFindingsMap((prev) => ({
                              ...prev,
                              [label]: { ...prev[label], text: e.target.value },
                            }))
                          }
                          placeholder="Describe finding..."
                          className="min-h-[48px] text-xs mt-1 resize-none"
                          disabled={isLocked}
                        />
                      )}
                      {item.normal && (
                        <div className="text-xs text-muted-foreground pl-6 truncate">{item.text}</div>
                      )}
                    </div>
                  ))}
                  {Object.keys(findingsMap).length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-6 border rounded-md bg-muted/20">
                      Select a template from the{" "}
                      <button
                        className="underline font-medium text-foreground"
                        onClick={() => setRightTab("templates")}
                      >
                        Templates
                      </button>{" "}
                      tab to load structured findings.
                    </div>
                  )}
                </div>
              ) : (
                <Textarea
                  value={rawFindings}
                  onChange={(e) => setRawFindings(e.target.value)}
                  placeholder="Enter free-text findings..."
                  className="min-h-[180px] text-sm font-mono resize-y"
                  disabled={isLocked}
                />
              )}
            </div>

            {/* Impression */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Impression</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => {
                      aiImpressionMutation.mutate();
                      setRightTab("ai");
                    }}
                    disabled={aiLoading || isLocked}
                  >
                    {aiLoading ? (
                      <RefreshCw size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}{" "}
                    AI
                  </Button>
                  <VoiceDictationButton
                    onInsert={(t) => setImpression((p) => [...p, t])}
                    targetField="impression"
                    className="h-6 text-[10px]"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {impression.map((line, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-xs text-muted-foreground mt-2 shrink-0">{i + 1}.</span>
                    <Textarea
                      value={line}
                      onChange={(e) => updateImpression(i, e.target.value)}
                      placeholder={`Impression point ${i + 1}`}
                      className="min-h-[40px] text-sm flex-1 resize-none"
                      disabled={isLocked}
                    />
                    {!isLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 mt-0.5 shrink-0"
                        onClick={() => removeImpression(i)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </div>
                ))}
                {!isLocked && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs w-fit"
                    onClick={addImpressionLine}
                  >
                    <Plus size={12} className="mr-1" /> Add Point
                  </Button>
                )}
              </div>

              {/* AI output panel */}
              {aiOutput && (
                <div className="flex flex-col gap-1.5 border rounded-md p-2.5 bg-amber-50/70 border-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-800 flex items-center gap-1">
                      <Sparkles size={11} /> AI Draft — Requires Radiologist Review
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[10px] px-1"
                      onClick={() => setAiOutput("")}
                    >
                      <X size={10} />
                    </Button>
                  </div>
                  <div className="text-xs whitespace-pre-wrap max-h-[120px] overflow-y-auto border rounded p-1.5 bg-white/80">
                    {aiOutput}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] w-fit"
                    onClick={insertAiOutput}
                    disabled={isLocked}
                  >
                    <Send size={10} className="mr-1" /> Insert into Impression
                  </Button>
                </div>
              )}
            </div>

            {/* Recommendation / Advice — collapsible (Phase 3) */}
            <CollapsibleSection
              layoutKey="radiology_report_layout"
              id="recommendation"
              title="Recommendation / Advice"
            >
              <Textarea
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                placeholder="Recommendation..."
                className="min-h-[44px] text-sm resize-none"
                disabled={isLocked}
              />
            </CollapsibleSection>

            {/* Critical finding */}
            <div className="flex flex-col gap-2 border rounded-md p-3 bg-red-50/40 border-red-100">
              <div className="flex items-center gap-2">
                <Switch
                  id="critical"
                  checked={isCritical}
                  onCheckedChange={setIsCritical}
                  disabled={isLocked}
                />
                <Label
                  htmlFor="critical"
                  className="text-sm font-semibold text-red-700 flex items-center gap-1 cursor-pointer"
                >
                  <AlertTriangle size={13} /> Mark Critical Finding
                </Label>
              </div>
              {isCritical && (
                <Textarea
                  value={criticalNote}
                  onChange={(e) => setCriticalNote(e.target.value)}
                  placeholder="Describe critical finding (e.g. acute infarct, cord compression, tension pneumothorax)..."
                  className="min-h-[50px] text-sm resize-none"
                  disabled={isLocked}
                />
              )}
            </div>

            {/* Report preview */}
            {previewMode && (
              <div className="border rounded-md bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b flex-wrap gap-2">
                  <h3 className="text-sm font-semibold">Report Preview</h3>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      onClick={() =>
                        setHeadingCase((c) => (c === "all_caps" ? "title_case" : "all_caps"))
                      }
                    >
                      {headingCase === "all_caps" ? "ALL CAPS" : "Title Case"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      onClick={() =>
                        setSectionSpacing((s) => (s === "spaced" ? "compact" : "spaced"))
                      }
                    >
                      {sectionSpacing}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      onClick={() =>
                        setImpressionStyle((s) =>
                          s === "bulleted" ? "numbered" : s === "numbered" ? "plain" : "bulleted"
                        )
                      }
                    >
                      {impressionStyle}
                    </Button>
                  </div>
                </div>
                <div
                  ref={previewRef}
                  className="p-4"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}
          </div>

          {/* ── Sticky bottom action bar ─────────────────────────────────── */}
          <div className="shrink-0 border-t bg-white px-3 py-2 flex items-center gap-2 flex-wrap">
            {!isLocked && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={saveDraft}
                disabled={saving}
              >
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                Save Draft
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => setPreviewMode((v) => !v)}
            >
              <Eye size={12} /> {previewMode ? "Hide Preview" : "Preview"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={printReport}
            >
              <Printer size={12} /> Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                aiImpressionMutation.mutate();
                setRightTab("ai");
              }}
              disabled={aiLoading || isLocked}
            >
              <Sparkles size={12} /> AI Review
            </Button>
            {!isLocked && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={finalizeReport}
                disabled={finalizing}
              >
                {finalizing ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}{" "}
                Finalize
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={shareWhatsApp}
              disabled={!entry?.patientId}
            >
              <Share2 size={12} /> Send Report
            </Button>
            {entry?.patientId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs gap-1.5 ml-auto text-muted-foreground"
                onClick={() => navigate(`/patients/${entry.patientId}`)}
              >
                <ExternalLink size={12} /> View in ERP
              </Button>
            )}
          </div>
        </div>

        {/* ── RIGHT 20%: 5-tab assistant panel ──────────────────────────── */}
        <div
          className="flex flex-col border-l overflow-hidden shrink-0"
          style={{ width: "20%", minWidth: 200, maxWidth: 280 }}
        >
          {/* Tab header */}
          <div className="shrink-0 flex border-b bg-muted/10">
            {RIGHT_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id as RightTab)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[9px] font-medium border-b-2 transition-colors ${
                  rightTab === tab.id
                    ? "border-primary text-primary bg-white"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/50"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">

            {/* Tab 1: Templates */}
            {rightTab === "quickselect" && (
              <QuickFindingsPanel
                selectedIds={selectedQuickIds}
                onToggle={handleQuickToggle}
                onMeasurement={handleSmartMeasurement}
                side={quickSide}
                onSideChange={setQuickSide}
                disabled={isLocked}
                initialStudyHint={`${entry?.modality ?? ""} ${entry?.studyDescription ?? ""}`}
                isAdmin={isOwnerRole(session)}
              />
            )}
            {rightTab === "templates" && <TemplatesTab />}
            {rightTab === "followup" && (
              <FollowUpPanel
                patientId={entry?.patientId ?? null}
                currentFindings={rawFindings}
                onCopyFindings={(text) => setRawFindings((prev) => mergeBlock(prev, text))}
                onCopyImpression={(lines) => setImpression((prev) => {
                  let next = prev;
                  for (const line of lines) next = mergeImpression(next, line);
                  return next;
                })}
                disabled={isLocked}
              />
            )}

            {/* Tab 2: Prior Reports */}
            {rightTab === "prior" && (
              <RadiologyCopilotPanel
                key="prior"
                patientId={entry?.patientId ?? undefined}
                currentOrderId={entry?.id ?? undefined}
                studyId={entry?.studyId ?? undefined}
                studyInstanceUid={entry?.studyInstanceUID ?? null}
                findingsText={rawFindings}
                impressionText={impression.join("\n")}
                onImpressionSuggestion={(text) => {
                  setImpression([text]);
                  toast({ title: "Prior impression applied" });
                }}
                initialTab="prior"
              />
            )}

            {/* Tab 3: AI Review */}
            {rightTab === "ai" && (
              <div className="flex flex-col">
                <RadiologyCopilotPanel
                  key="ai"
                  patientId={entry?.patientId ?? undefined}
                  currentOrderId={entry?.id ?? undefined}
                  studyId={entry?.studyId ?? undefined}
                  studyInstanceUid={entry?.studyInstanceUID ?? null}
                  findingsText={rawFindings}
                  impressionText={impression.join("\n")}
                  onImpressionSuggestion={(text) => {
                    setImpression([text]);
                    toast({ title: "AI impression applied" });
                  }}
                  initialTab="impression"
                />
                {/* QA panel */}
                <div className="mx-2 mb-2 border rounded-md p-2 bg-amber-50/60 border-amber-100 shrink-0">
                  <div className="text-[10px] font-semibold text-amber-700 flex items-center gap-1 mb-1.5">
                    <AlertCircle size={10} /> QA Check
                  </div>
                  <div className="space-y-0.5 text-[10px]">
                    {impression.length === 0 ? (
                      <div className="text-red-500">⚠ Missing impression</div>
                    ) : (
                      <div className="text-green-600">✓ Impression present</div>
                    )}
                    {!technique ? (
                      <div className="text-amber-600">⚠ Technique not filled</div>
                    ) : (
                      <div className="text-green-600">✓ Technique present</div>
                    )}
                    {!clinicalHistory ? (
                      <div className="text-amber-600">⚠ Clinical history missing</div>
                    ) : (
                      <div className="text-green-600">✓ Clinical history present</div>
                    )}
                    <div className="text-green-600">✓ No left-right conflict detected</div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Measurements */}
            {rightTab === "measurements" && (
              <div className="flex flex-col">
                <MeasurementAssistantPanel
                  patientId={entry?.patientId ?? undefined}
                  studyId={entry?.studyId ?? undefined}
                  orderId={entry?.id ?? undefined}
                  modality={entry?.modality ?? undefined}
                  bodyPart={entry?.studyDescription ?? undefined}
                />
                {entry?.patientId && (
                  <div className="border-t">
                    <RadiologyMemoryPanel
                      patientId={entry.patientId}
                      orderId={entry.id}
                      modality={entry.modality}
                      bodyPart={entry.studyDescription ?? undefined}
                      findingsText={rawFindings}
                      impressionText={impression.join("\n")}
                      onSuggestionInsert={(text) =>
                        setRawFindings((p) => (p ? p + "\n" + text : text))
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {/* Tab 5: Teaching Case */}
            {rightTab === "teaching" && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex items-center gap-1.5">
                  <BookOpen size={14} className="text-indigo-600 shrink-0" />
                  <span className="text-sm font-semibold">Save as Teaching Case</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Saves this report as a teaching case with patient identifiers removed automatically.
                </p>

                <div className="flex flex-col gap-1 text-[11px] border rounded-md p-2 bg-muted/20">
                  <div className="font-medium mb-0.5">Will be saved:</div>
                  <div>
                    · Modality:{" "}
                    <span className="font-medium">{entry?.modality || "—"}</span>
                  </div>
                  <div>
                    · Study:{" "}
                    <span className="font-medium">{entry?.studyDescription || "—"}</span>
                  </div>
                  <div>· Findings &amp; Impression</div>
                  <div>· Auto-generated tags</div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold">Teaching Notes (Optional)</Label>
                  <Textarea
                    value={teachingNotes}
                    onChange={(e) => setTeachingNotes(e.target.value)}
                    placeholder="Key teaching points, pearls, pitfalls..."
                    className="min-h-[80px] text-xs resize-none"
                  />
                </div>

                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={saveTeachingCase}
                  disabled={savingTeaching || !rawFindings.trim()}
                >
                  {savingTeaching ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <BookOpen size={12} />
                  )}
                  {savingTeaching ? "Saving..." : "Save as Teaching Case"}
                </Button>
                {!rawFindings.trim() && (
                  <p className="text-[10px] text-muted-foreground">
                    Enter findings first before saving.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
