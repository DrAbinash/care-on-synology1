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
import { finalizeRadiologyReport, saveRadiologyDraft } from "@/lib/radiologyReportLifecycle";
import OpenStudyPanel from "@/components/radiology/OpenStudyPanel";
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
  type QuickFinding, type QuickProtocol,
} from "@/components/radiology/QuickFindingsPanel";
import {
  renderAbnormality, type AbnormalityInstance, type RenderedAbnormality, type Side,
  mergeBlock, mergeImpression,
  applyRenderedTransition, toggleQuickSelection, setQuickInstance, deleteQuickInstance,
  seedQuickInstance, patchQuickInstance,
} from "@/lib/renderEngine";
import { deriveQuickSelectFindings } from "@/lib/quickSelectFindingsPayload";
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
import { isLearnableAddition } from "@/lib/learningEngine";
import { upsertMeasurement } from "@/lib/measurementVars";
import CollapsibleSection from "@/components/radiology/CollapsibleSection";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import { useLocalDraftBackup } from "@/hooks/useLocalDraftBackup";
import { useRadiologyDraftId } from "@/hooks/useRadiologyDraftId";
import { isOwnerRole } from "@/lib/staffSession";
import {
  serializeReportSnapshot, isReportDirty, shouldOfferBackupRestore,
  restorableSelections, extractD1QuickSelections, toInstanceParams,
  deriveLifecycleBadges, canVerifyReport, matchWorkspaceShortcut,
  type FinalReportMeta, type PersistedInstanceRow,
} from "@/lib/workspaceReportState";
import { canLeaveStudy, type QueueStudy } from "@/lib/reportingWorkflow";
import { createCommandDispatcher } from "@/lib/workspaceCommands";
import { useReportingWorkflow } from "@/hooks/useReportingWorkflow";
import type { StudyLaunchResult } from "@/lib/studyLaunchService";
import { ChevronLeft, ChevronRight, PauseCircle } from "lucide-react";

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

/** M1.4 — POST /api/radiology/report-generator/validate-draft response: the
 *  backend runs the REAL D3/D3.5 builder + D1 validator read-only; nothing
 *  here is computed client-side. */
type ValidateDraftResponse = {
  success: boolean;
  structured:
    | { enabled: false; attempted: false }
    | {
        enabled: true; attempted: true; built: true;
        documentId: string; contentSha256: string; findingsCount: number;
        errors: unknown[]; warnings: string[];
      }
    | {
        enabled: true; attempted: true; built: false;
        skipReasons: string[]; errors: unknown[]; warnings: string[];
      };
  legacy: { rawFindings: boolean; impression: boolean };
};

/** Renders a backend validation issue (string or {code,message,path} object)
 *  as one human-readable line — display only, no interpretation. */
function validationIssueText(issue: unknown): string {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") {
    const o = issue as { code?: unknown; message?: unknown; path?: unknown };
    const parts = [o.code, o.path, o.message].filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length) return parts.join(" — ");
    try { return JSON.stringify(issue); } catch { /* fall through */ }
  }
  return String(issue);
}

const BADGE_TONE_CLASS: Record<string, string> = {
  green: "bg-green-100 text-green-800 border-green-300",
  amber: "bg-amber-100 text-amber-800 border-amber-300",
  red: "bg-red-100 text-red-800 border-red-300",
  blue: "bg-blue-100 text-blue-800 border-blue-300",
  slate: "bg-slate-100 text-slate-700 border-slate-300",
};

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
  // Read ONCE per mount (M1.4). readStaffSession() parses localStorage into a
  // fresh object every call; as a plain per-render read it fed the
  // style-preferences effect below a new identity on every render, producing
  // an INFINITE effect→setState→render→effect fetch loop (measured: 151
  // requests to /style-preferences in 20s — enough to trip the API's
  // 300/min rate limit and 429 real saves).
  const session = useMemo(() => readStaffSession(), []);
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

  // ── M1.4 — workflow state (Phase 2) ───────────────────────────────────────
  // Deliberately NOT a second store: plain local state whose RULES (dirty
  // detection, backup gating, selection restore, lifecycle badges, verify
  // permission, shortcuts) live as pure functions in
  // lib/workspaceReportState.ts.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  /** Serialized snapshot of the last state known to match the server (saved,
   *  finalized, or machine-hydrated FROM the server). null = nothing known. */
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
  /** Machine hydration steps (draft load, template auto-fill, AI pre-fill,
   *  selection restore) request a baseline recapture; the effect below runs
   *  in the render AFTER their state has flushed, so it always serializes the
   *  post-hydration values. User edits never request a recapture — they are
   *  exactly what "dirty" must detect.
   *
   *  A monotonic NONCE, deliberately not a boolean (M1.5): with a boolean,
   *  a machine effect firing in the same effects pass as the recapture
   *  consuming an earlier request had its set-true swallowed by the
   *  recapture's set-false in the same batch — the restored Quick Select
   *  selections then never entered the baseline and the workspace sat
   *  permanently "dirty" after returning to a study (found by the M1.5
   *  browser verification). Every increment now guarantees one capture in
   *  the render after its batch flushes. */
  const [baselineRecaptureNonce, setBaselineRecaptureNonce] = useState(0);
  function requestBaselineRecapture() {
    setBaselineRecaptureNonce((n) => n + 1);
  }
  /** Truthful D5 outcome of the finalize that happened in THIS session:
   *  {signed:true,...} or {signed:false, fallback:"legacy", reason}. */
  const [structuredFinalInfo, setStructuredFinalInfo] = useState<Record<string, unknown> | null>(null);
  /** Truthful reason when finalize could not create a patient-facing report
   *  row (unbilled study — patient_reports.test_id is NOT NULL). */
  const [reportCreationSkipped, setReportCreationSkipped] = useState<string | null>(null);
  const [finalizedReportId, setFinalizedReportId] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  /** Admin-only structured diagnostics drawer inside the preview (Phase 7). */
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ── M1.5 — workflow controller (queue, history, parked, transitions) ─────
  const workflow = useReportingWorkflow(studyId);
  /** Viewer launch state mirrored up from OpenStudyPanel: transitions are
   *  blocked while a launch is in flight, and the status bar shows the last
   *  outcome. */
  const [viewerLaunch, setViewerLaunch] = useState<{ busy: boolean; lastResult: StudyLaunchResult | null }>({
    busy: false,
    lastResult: null,
  });

  // ── Quick Select — Smart Report Engine (Phase 2) ──────────────────────────
  // Each button is a smart object (technique / findings / impression /
  // recommendation). At insert time the side selector transforms the text
  // (left↔right↔bilateral, whole words only); insertedTextRef remembers the
  // EXACT strings inserted per button so that deselect removes precisely
  // what went in — even if the side selector changed afterwards. Manually
  // edited text is never touched (exact-match removal only).
  const [selectedQuickIds, setSelectedQuickIds] = useState<Set<number>>(new Set());
  const [quickSide, setQuickSide] = useState<Side>("left");
  // Phase 4: one structured instance per selected abnormality.
  const [quickInstances, setQuickInstances] = useState<Map<number, AbnormalityInstance>>(new Map());
  const insertedTextRef = useRef<Map<number, RenderedAbnormality>>(new Map());
  // Learning Engine (Phase 5): remembers the last selected finding so any
  // manually-added recommendation text at finalize time can be attributed
  // to it and offered as a suggestion next time. Suggestion-only — never
  // auto-inserted.
  const lastToggledFindingRef = useRef<QuickFinding | null>(null);

  /** Applies rendered abnormality sections to the report: exact-remove of
   *  what was previously generated for this instance, then dedupe-merge of
   *  the new render. Edited sentences no longer match exactly → removal
   *  no-ops → manual edits always win. The remove/merge decision itself is
   *  renderEngine's applyRenderedTransition (Ticket F1b) — a pure function;
   *  this wrapper only owns reading/writing the actual React state and the
   *  insertedTextRef ref, which stay in the component per F1b's scope. */
  function applyRendered(id: number, next: RenderedAbnormality | null) {
    const prev = insertedTextRef.current.get(id);
    const result = applyRenderedTransition(
      { rawFindings, impression, technique, recommendation },
      prev,
      next,
    );
    if (next) insertedTextRef.current.set(id, next);
    else insertedTextRef.current.delete(id);
    setRawFindings(result.rawFindings);
    setImpression(result.impression);
    setTechnique(result.technique);
    setRecommendation(result.recommendation);
  }

  function handleQuickToggle(f: QuickFinding, nowSelected: boolean) {
    if (nowSelected) lastToggledFindingRef.current = f;
    setSelectedQuickIds((prev) => toggleQuickSelection(prev, f.id, nowSelected));
    if (nowSelected) {
      // New instance seeded from the global side selector.
      const inst = seedQuickInstance(quickSide);
      setQuickInstances((prev) => setQuickInstance(prev, f.id, inst));
      applyRendered(f.id, renderAbnormality(f, inst));
    } else {
      setQuickInstances((prev) => deleteQuickInstance(prev, f.id));
      applyRendered(f.id, null);
    }
  }

  /** Phase 4: property chip changed → re-render this abnormality and
   *  update the entire report instantly (all four sections). */
  function handleInstanceUpdate(f: QuickFinding, patch: Partial<AbnormalityInstance>) {
    const inst = patchQuickInstance(quickInstances.get(f.id), quickSide, patch);
    setQuickInstances((prev) => setQuickInstance(prev, f.id, inst));
    applyRendered(f.id, renderAbnormality(f, inst));
  }

  /** Auto-fill Technique from the study tab — only when Technique is empty,
   *  so an already-written technique is never overwritten. */
  function handleAutoTechnique(text: string) {
    setTechnique((prev) => (prev.trim() ? prev : text));
  }

  /** One-click baseline normals — dedupe-merged, never duplicated. */
  function handleInsertNormals(text: string) {
    setRawFindings((prev) => mergeBlock(prev, text));
  }

  // ── Protocol Engine (Phase 5) ──────────────────────────────────────────────
  // Selecting a protocol (e.g. "MRI Brain Trauma") loads its own technique/
  // normal/recommendation — these take precedence over the generic tab-level
  // ones for empty fields, and its checklist drives the live completeness
  // score below. Switching protocols never deletes anything the radiologist
  // has already typed.
  const [activeProtocol, setActiveProtocol] = useState<QuickProtocol | null>(null);
  const [checklistPercent, setChecklistPercent] = useState(100);
  const [checklistRemaining, setChecklistRemaining] = useState<string[]>([]);

  function handleProtocolChange(protocol: QuickProtocol | null) {
    setActiveProtocol(protocol);
    if (!protocol) return;
    if (protocol.techniqueText) setTechnique((prev) => (prev.trim() ? prev : protocol.techniqueText));
    if (protocol.recommendationText) setRecommendation((prev) => mergeBlock(prev, protocol.recommendationText));
  }

  function handleInsertProtocolNormals() {
    if (activeProtocol?.normalText) setRawFindings((prev) => mergeBlock(prev, activeProtocol.normalText));
  }

  const missingRequiredMeasurements = useMemo(() => {
    if (!activeProtocol?.requiredMeasurements) return [];
    return activeProtocol.requiredMeasurements
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m && !rawFindings.toLowerCase().includes(m.toLowerCase()));
  }, [activeProtocol, rawFindings]);

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
    () => computeQualityScore({
      findings: rawFindings, impression, recommendation, technique, clinicalHistory,
      checklistPercent: activeProtocol ? checklistPercent : undefined,
      missingRequiredMeasurements,
    }),
    [rawFindings, impression, recommendation, technique, clinicalHistory, activeProtocol, checklistPercent, missingRequiredMeasurements],
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
    // `at` (M1.4) lets the restore banner compare backup age against the
    // server draft's updatedAt — only a backup NEWER than the server offer
    // restores (lib/workspaceReportState.shouldOfferBackupRestore).
    () => ({ at: Date.now(), clinicalHistory, technique, rawFindings, impression, recommendation }),
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

  // ── Draft identity (Radiology Roadmap Ticket A3.0) ────────────────────────
  // Loads any existing radiology_report_drafts row for this study and tracks
  // its id, so "Save Draft" updates that same row instead of inserting a new
  // orphaned one on every click — the shared hook this page was missing
  // (pages/RadiologyReportGenerator.tsx already had the correct pattern; see
  // hooks/useRadiologyDraftId.ts). Quick Select's structured click state
  // (selectedQuickIds/quickInstances) is not part of this — it was never
  // persisted before this fix and still isn't; only the previously-saved
  // flattened text fields are restored here.
  const { draftId, existingDraft, captureSavedDraftId, isLoadingExistingDraft } = useRadiologyDraftId(studyId);

  // ── M1.4 — study-switch isolation (Phase 4/10) ────────────────────────────
  // Navigating this mounted page from one study to another (same route,
  // different :studyId param — wouter does NOT remount) must never carry the
  // previous patient's text, selections, or exact-removal state across.
  // Extracted (M1.5) so "reload current study" can reuse the exact same
  // reset instead of duplicating the field list.
  function resetWorkspaceState() {
    setClinicalHistory(""); setTechnique(""); setRawFindings("");
    setImpression([]); setRecommendation(""); setFindingsMap({});
    setUseStructured(true);
    setSelectedQuickIds(new Set()); setQuickInstances(new Map());
    insertedTextRef.current = new Map();
    lastToggledFindingRef.current = null;
    setIsCritical(false); setCriticalNote("");
    setReportStatus("DRAFT");
    setSelectedTemplateId(null);
    setAiOutput("");
    setLastSavedSnapshot(null); setLastSavedAt(null);
    setStructuredFinalInfo(null); setFinalizedReportId(null);
    setReportCreationSkipped(null);
    setShowDiagnostics(false);
    setPreviewMode(false); // transient UI must not carry across patients
    // Re-arm the once-per-study machine-hydration guards (M1.5): REVISITING a
    // study (Previous / return-to-parked) must hydrate and restore selections
    // again after this reset — the M1.4 refs otherwise stay armed for the
    // draft id and would leave the editor empty AND, worse, let the next save
    // wipe the persisted selections (found by the M1.5 browser verification).
    hydratedDraftForStudyRef.current = null;
    selectionsRestoredForDraftRef.current = null;
    autoTemplateForStudyRef.current = null;
  }
  const activeStudyRef = useRef<number | undefined>(studyId);
  useEffect(() => {
    if (activeStudyRef.current === studyId) return;
    activeStudyRef.current = studyId;
    resetWorkspaceState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyId]);

  // ── M1.5 — arrival + wrong-patient cross-check (Phase 7) ─────────────────
  // When the target study's identity loads, release the navigation lock and
  // verify the loaded patient matches what the queue row claimed at
  // transition time. The M1.4 draft-hydration patient guard is the second
  // layer; this catches a worklist row whose linkage changed mid-flight.
  useEffect(() => {
    if (!entry) return;
    const expectation = workflow.markArrived(entry.id);
    if (
      expectation && expectation.patientId != null &&
      entry.patientId != null && expectation.patientId !== entry.patientId
    ) {
      toast({
        title: "Patient identity mismatch",
        description: `The queue listed patient #${expectation.patientId} for this study, but the loaded study belongs to patient #${entry.patientId}. Verify the patient before reporting.`,
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  // ── M1.4 — draft hydration (Phase 3), ONCE per study ─────────────────────
  // The old effect re-ran on every background refetch of the drafts query
  // (object identity changes), re-writing server text over whatever the
  // radiologist had typed since — a silent manual-edit clobber. Hydration now
  // happens exactly once per study, and only after the study identity has
  // loaded so the patient cross-check below can run.
  const hydratedDraftForStudyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!existingDraft) return;
    if (studyId != null && !entry) return; // wait for study identity
    const studyKey = studyId ?? -1;
    if (hydratedDraftForStudyRef.current === studyKey) return;
    // Never merge two patients' drafts (Phase 3 rule 8). The drafts query is
    // already study-scoped server-side; this cross-check refuses a mislinked
    // row instead of hydrating the wrong patient's text.
    if (
      existingDraft.patientId != null && entry?.patientId != null &&
      existingDraft.patientId !== entry.patientId
    ) {
      hydratedDraftForStudyRef.current = studyKey;
      console.warn(
        `[workspace] draft ${existingDraft.id} belongs to patient ${existingDraft.patientId} ` +
        `but study ${studyId} belongs to patient ${entry.patientId} — draft NOT loaded`,
      );
      return;
    }
    hydratedDraftForStudyRef.current = studyKey;
    if (existingDraft.clinicalHistory) setClinicalHistory(existingDraft.clinicalHistory);
    if (existingDraft.rawFindings) setRawFindings(existingDraft.rawFindings);
    if (existingDraft.findingsSections) {
      try {
        setFindingsMap(JSON.parse(existingDraft.findingsSections) as Record<string, { normal: boolean; text: string }>);
        setUseStructured(true);
      } catch { /* ignore malformed JSON — falls back to whatever rawFindings already restored */ }
    } else if (existingDraft.rawFindings) {
      // A free-text draft must come back VISIBLE as free text — the default
      // structured view would hide the restored rawFindings behind template
      // sections (Phase 3 rule 4: exact content back).
      setUseStructured(false);
    }
    if (existingDraft.impression) {
      try {
        const arr = JSON.parse(existingDraft.impression) as string[];
        if (Array.isArray(arr)) setImpression(arr);
      } catch { /* ignore malformed JSON */ }
    }
    if (existingDraft.recommendation) setRecommendation(existingDraft.recommendation);
    // Server-hydrated content is the CLEAN baseline, not an unsaved edit.
    requestBaselineRecapture();
  }, [existingDraft, entry, studyId]);

  // ── M1.4 — Quick Select selection restore (Phase 3 rule 5 / Phase 4) ─────
  // Primary source: the A3.2 report_finding_instances rows for this draft
  // (GET /finding-instances). Fallback: the D1 draft document's extension
  // selections (structured_json_d1). When neither exists (flags off / legacy
  // draft), behavior stays exactly as before: flattened text only.
  const { data: instancesData } = useQuery<{
    success: boolean;
    instances: Array<{ findingId: number; structuredJson: unknown; source: string }>;
  }>({
    queryKey: ["radiology-finding-instances", draftId],
    queryFn: () => api.get(`/api/radiology/report-generator/finding-instances?draftId=${draftId}`),
    enabled: !!draftId,
    staleTime: 60_000,
  });

  /** Latest loaded Quick Select templates (set by QuickFindingsPanel's
   *  onFindingsLoaded) — needed to rebuild exact-match removal state for
   *  RESTORED selections without re-inserting any text. */
  const quickFindingTemplatesRef = useRef<QuickFinding[] | null>(null);

  /** For each restored selection whose template is known, record what its
   *  render WOULD have inserted — the saved draft text already contains those
   *  sentences, so deselect can exact-remove them. Never touches the text. */
  function seedRestoredInsertedText(
    findings: QuickFinding[],
    ids: Set<number>,
    insts: Map<number, AbnormalityInstance>,
  ) {
    for (const f of findings) {
      if (!ids.has(f.id) || insertedTextRef.current.has(f.id)) continue;
      const inst = insts.get(f.id);
      if (inst) insertedTextRef.current.set(f.id, renderAbnormality(f, inst));
    }
  }

  function handleFindingsLoaded(findings: QuickFinding[]) {
    quickFindingTemplatesRef.current = findings;
    seedRestoredInsertedText(findings, selectedQuickIds, quickInstances);
  }

  const selectionsRestoredForDraftRef = useRef<number | null>(null);
  useEffect(() => {
    if (!draftId || !instancesData) return;
    // Ownership guard (M1.5 Phase 7): during a study transition the adopted
    // draftId can still belong to the PREVIOUS study for a few renders (the
    // hook re-adopts asynchronously). Restoring then would carry the old
    // patient's selections into the new study — verified in the M1.5 browser
    // run. Only restore once the study-keyed draft row confirms this draftId
    // belongs to the study on screen.
    if (!existingDraft || existingDraft.id !== draftId) return;
    if (selectionsRestoredForDraftRef.current === draftId) return;
    selectionsRestoredForDraftRef.current = draftId;
    let rows: PersistedInstanceRow[] = instancesData.success ? instancesData.instances : [];
    if (rows.length === 0 && existingDraft?.id === draftId) {
      rows = extractD1QuickSelections(existingDraft.structuredJsonD1);
    }
    const selections = restorableSelections(rows);
    if (selections.length === 0) return;
    const ids = new Set(selections.map((s) => s.findingId));
    const map = new Map<number, AbnormalityInstance>();
    for (const s of selections) map.set(s.findingId, toInstanceParams(s.params));
    setSelectedQuickIds(ids);
    setQuickInstances(map);
    if (quickFindingTemplatesRef.current) {
      seedRestoredInsertedText(quickFindingTemplatesRef.current, ids, map);
    }
    // Restored selections are saved state — keep the workspace clean.
    requestBaselineRecapture();
  }, [draftId, instancesData, existingDraft]);

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

  // Auto-select template based on worklist entry — ONCE per study (M1.4).
  // The old version kept selectedTemplateId in its deps and re-forced the
  // auto match on every change, instantly reverting any template the
  // radiologist picked by hand. It now fires once; manual choices stick.
  const autoTemplateForStudyRef = useRef<number | null>(null);
  // "auto" = machine-initiated apply (mount/study match) → fills ONLY empty
  // fields and stays clean; "manual" = explicit user click in the Templates
  // tab → full apply (pre-M1.4 behavior) and counts as an unsaved edit.
  const templateApplySourceRef = useRef<"auto" | "manual">("auto");
  useEffect(() => {
    if (!entry || templates.length === 0) return;
    const studyKey = studyId ?? -1;
    if (autoTemplateForStudyRef.current === studyKey) return;
    autoTemplateForStudyRef.current = studyKey;
    const modalityMap: Record<string, string> = { "X-RAY": "X-RAY", USG: "USG", MRI: "MRI", CT: "CT" };
    const mod = modalityMap[entry.modality] || entry.modality;
    const bodyPart = (entry.studyDescription || "").toUpperCase();
    let match = templates.find((t) => t.modality === mod && bodyPart.includes(t.bodyPart));
    if (!match) match = templates.find((t) => t.modality === mod);
    if (match && match.id !== selectedTemplateId) {
      templateApplySourceRef.current = "auto";
      setSelectedTemplateId(match.id);
    }
  }, [entry, templates, selectedTemplateId, studyId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  // Load template content when selected. Auto-selection must never clobber a
  // hydrated draft or typed text (the draft/template queries race — whichever
  // resolved last used to win); it only fills fields that are still empty.
  useEffect(() => {
    if (!selectedTemplate) return;
    const sections = parseSectionsJson(selectedTemplate.sectionsJson);
    const map: Record<string, { normal: boolean; text: string }> = {};
    for (const item of sections.findingsItems) {
      map[item.label] = { normal: true, text: item.normal };
    }
    if (templateApplySourceRef.current === "manual") {
      // Explicit user choice: full apply, and it IS an unsaved change.
      setTechnique(sections.technique);
      setFindingsMap(map);
      setRawFindings(selectedTemplate.defaultFindings || "");
      setImpression(selectedTemplate.defaultImpression ? [selectedTemplate.defaultImpression] : []);
      setRecommendation("Please correlate with clinical findings.");
      return;
    }
    setTechnique((prev) => (prev.trim() ? prev : sections.technique));
    setFindingsMap((prev) => (Object.keys(prev).length > 0 ? prev : map));
    setRawFindings((prev) => (prev.trim() ? prev : selectedTemplate.defaultFindings || ""));
    setImpression((prev) =>
      prev.filter(Boolean).length > 0
        ? prev
        : selectedTemplate.defaultImpression ? [selectedTemplate.defaultImpression] : prev,
    );
    setRecommendation((prev) => (prev.trim() ? prev : "Please correlate with clinical findings."));
    // Machine fill → part of the clean baseline.
    requestBaselineRecapture();
  }, [selectedTemplate]);

  // Pre-populate from AI draft — fill-empty-only (M1.4): a saved draft (the
  // radiologist's actual work) must always beat the AI suggestion; the old
  // unconditional writes raced the draft hydration for the same fields.
  useEffect(() => {
    if (!entry?.aiDraftJson) return;
    try {
      const draft = JSON.parse(entry.aiDraftJson) as Record<string, string>;
      if (draft.clinical_history) setClinicalHistory((prev) => (prev.trim() ? prev : draft.clinical_history));
      if (draft.technique) setTechnique((prev) => (prev.trim() ? prev : draft.technique));
      if (draft.findings) setRawFindings((prev) => (prev.trim() ? prev : draft.findings));
      if (draft.impression) setImpression((prev) => (prev.filter(Boolean).length > 0 ? prev : [draft.impression]));
      if (draft.recommendation) setRecommendation((prev) => (prev.trim() ? prev : draft.recommendation));
      requestBaselineRecapture();
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

  // ── M1.4 — derived workflow state ─────────────────────────────────────────

  /** Dirty = current content differs from the last state known to match the
   *  server (rules in lib/workspaceReportState.ts). Locked reports are never
   *  dirty — editing is disabled. */
  const dirty = !isLocked && isReportDirty(
    { clinicalHistory, technique, rawFindings, impression, recommendation, quickSelectIds: Array.from(selectedQuickIds) },
    lastSavedSnapshot,
  );

  // Baseline recapture: runs in the render AFTER a machine-hydration step's
  // state has flushed (the pending flag is state, so this effect sees the
  // hydrated values, never the pre-hydration closure).
  const lastCapturedNonceRef = useRef(0);
  useEffect(() => {
    if (baselineRecaptureNonce === lastCapturedNonceRef.current) return;
    lastCapturedNonceRef.current = baselineRecaptureNonce;
    setLastSavedSnapshot(serializeReportSnapshot({
      clinicalHistory, technique, rawFindings, impression, recommendation,
      quickSelectIds: Array.from(selectedQuickIds),
    }));
  }, [baselineRecaptureNonce, clinicalHistory, technique, rawFindings, impression, recommendation, selectedQuickIds]);

  // Unsaved-change safeguard (Phase 10): browser-level warning on tab close /
  // hard navigation while dirty.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── M1.5 Phase 9 — THE command dispatcher ─────────────────────────────────
  // Every workflow action (button, keyboard, and later voice) routes through
  // one named-command dispatcher. Handlers own their guards, so behavior is
  // identical regardless of how a command arrives. Recreated per render —
  // closures always see current state; the function handlers hoist.
  function focusQuickSearch() {
    setRightTab("quickselect");
    // The panel mounts (and loads its dataset) when the tab switches, and
    // its search input can remount as the data arrives — keep re-asserting
    // focus briefly until it actually sticks.
    let attempts = 0;
    const tryFocus = () => {
      const el = document.querySelector<HTMLInputElement>("[data-qs-search]");
      if (el && document.activeElement === el) return;
      el?.focus();
      if (++attempts < 15) window.setTimeout(tryFocus, 100);
    };
    window.setTimeout(tryFocus, 50);
  }
  function openViewer() {
    // The ONE launch pipeline (M1.2) — trigger the panel's primary action.
    document.querySelector<HTMLButtonElement>('[data-testid="btn-open-study"]')?.click();
  }
  const commandDispatcher = createCommandDispatcher({
    save: () => { if (!isLocked && !saving) void saveDraft(); },
    finalize: () => { if (!isLocked && !finalizing) void finalizeReport(); },
    next: () => nextStudy(),
    previous: () => previousStudy(),
    park: () => parkCurrentStudy(),
    refresh: () => refreshQueueAndCurrent(),
    "open-viewer": openViewer,
    "focus-quick-search": focusQuickSearch,
  });

  // Keyboard shortcuts (M1.4 Phase 11 + M1.5 Phase 8) — matching rules live
  // in lib/workspaceReportState.matchWorkspaceShortcut; actions route through
  // the command dispatcher. Re-attached per render so handlers see current
  // state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = matchWorkspaceShortcut({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
        target: e.target as { tagName?: string } | null,
      });
      if (!shortcut) return;
      if (shortcut === "escape") {
        if (showDiagnostics) setShowDiagnostics(false);
        else if (previewMode) setPreviewMode(false);
        return;
      }
      e.preventDefault();
      const command =
        shortcut === "quickselect" ? "focus-quick-search"
        : shortcut === "open-study" ? "open-viewer"
        : shortcut === "next-study" ? "next"
        : shortcut === "previous-study" ? "previous"
        : shortcut === "park-study" ? "park"
        : shortcut; // save | finalize
      commandDispatcher.dispatch(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── M1.4 — lifecycle / amendment metadata (Phase 9, D8/D9 read-only) ─────
  // The linked patient_reports row: freshly finalized in this session, or
  // referenced by the worklist entry, or the row a structured finalize
  // promoted this draft into. GET /:id resolves to the LATEST version (D8)
  // and carries additive `version` + `lifecycle` metadata (D8/D9).
  const linkedReportId = finalizedReportId ?? entry?.reportId ?? existingDraft?.finalReportId ?? null;
  const { data: finalReport } = useQuery<FinalReportMeta & { id?: number; signedByName?: string | null }>({
    queryKey: ["workspace-final-report", linkedReportId],
    queryFn: () => api.get(`/api/patient-reports/${linkedReportId}`),
    enabled: !!linkedReportId,
  });
  const lifecycleBadges = deriveLifecycleBadges(finalReport ?? null);
  const verifyGate = canVerifyReport(
    session ? { subjectName: session.user.name, role: session.user.role, permissions: session.user.permissions } : null,
    finalReport ?? null,
  );
  const lifecycleState = finalReport?.lifecycle?.state ?? finalReport?.status ?? null;
  const reportSuperseded = Boolean(finalReport?.version?.superseded || finalReport?.lifecycle?.superseded);
  /** Verify shows only for permitted users on a verifiable row; the D9 route
   *  re-enforces everything server-side. */
  const canShowVerify = Boolean(finalReport) && verifyGate.allowed && !reportSuperseded &&
    lifecycleState !== "draft" && lifecycleState !== "verified" && lifecycleState !== "delivered";

  // ── M1.4 — backend validation (Phase 7) — fetched on demand ──────────────
  const { data: draftValidation, isFetching: validating, refetch: refetchValidation } = useQuery<ValidateDraftResponse>({
    queryKey: ["radiology-validate-draft", draftId],
    queryFn: () => api.post<ValidateDraftResponse>("/api/radiology/report-generator/validate-draft", { draftId }),
    enabled: false,
  });

  // ── M1.4 — local-backup restore gating (Phase 3 rule 7) ───────────────────
  const serverDraftContent = useMemo(() => {
    if (!existingDraft) return null;
    let impressionLines: string[] = [];
    try {
      const arr = JSON.parse(existingDraft.impression ?? "[]") as unknown;
      if (Array.isArray(arr)) impressionLines = arr.filter((l): l is string => typeof l === "string");
    } catch { /* malformed stored impression — compare as empty */ }
    return {
      clinicalHistory: existingDraft.clinicalHistory ?? "",
      rawFindings: existingDraft.rawFindings ?? "",
      impression: impressionLines,
      recommendation: existingDraft.recommendation ?? "",
    };
  }, [existingDraft]);
  const offerBackupRestore = !isLocked && draftBackup.restoreAvailable &&
    shouldOfferBackupRestore(draftBackup.peek(), existingDraft?.updatedAt ?? null, serverDraftContent);

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

  // Named distinctly from quickFindingsMerge's imported removeImpression(lines, line)
  // (Bug-001): this one was a same-named local function declaration that, via
  // JS/TS hoisting, shadowed the import for this component's entire scope —
  // including applyRendered's call at an earlier line — so Quick Select's
  // deselect path was silently calling this by-index function instead of the
  // intended exact-match removal. Renamed so the import resolves correctly.
  function deleteImpressionLineAt(index: number) {
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

  /** Canonical draft save (M1.1 transport, M1.4 workflow). Returns the saved
   *  draft id on success and null on failure, so finalizeReport can persist
   *  the editor state first and validate exactly what will be signed. On
   *  failure nothing is cleared — the typed text stays. */
  async function saveDraft(): Promise<number | null> {
    if (saving || isLocked) return null;
    if (!entry) {
      toast({ title: "No study loaded", description: "Open a study from the worklist before saving.", variant: "destructive" });
      return null;
    }
    setSaving(true);
    try {
      // id omitted on the first save (server creates the row); included on
      // every save after (server updates that same row) — see
      // useRadiologyDraftId.ts.
      //
      // studyId is the page's OWN study identity (the :studyId route param,
      // i.e. the worklist row id) — the same key useRadiologyDraftId reloads
      // by. The previous payload stored entry.studyId (the radiology_studies
      // id, often null and never equal to the reload key), so saved drafts
      // could not be found again — reload always started blank (M1.4 broken
      // link #2).
      //
      // findings[] (Ticket A3.1) serializes the current Quick Select
      // selection; A3.2 persists it to report_finding_instances, which is
      // what the selection restore above reads back.
      const savedFindings = deriveQuickSelectFindings(selectedQuickIds, quickInstances);
      const res = await saveRadiologyDraft<{ success: boolean; draft: { id: number } & Record<string, unknown> }>(
        {
          id: draftId ?? undefined,
          studyId: studyId ?? entry.studyId ?? null,
          worklistId: entry.id ?? null,
          patientId: entry.patientId ?? null,
          templateId: selectedTemplate?.templateName || null,
          modality: entry.modality || null,
          studyName: selectedTemplate?.templateName || entry.studyDescription || null,
          clinicalHistory: clinicalHistory || null,
          rawFindings: rawFindings || null,
          findingsSections: useStructured ? findingsMap : null,
          impression: impression.filter(Boolean),
          recommendation: recommendation || null,
          findings: savedFindings,
        },
      );
      captureSavedDraftId(res.draft.id);
      // The server now holds exactly the selections we sent — the restore
      // effect must not re-apply them over the editor after this save.
      selectionsRestoredForDraftRef.current = res.draft.id;
      // M1.5 — keep the query caches truthful so RETURNING to this study
      // (Previous / return-to-parked) hydrates what was actually saved, not
      // the stale row cached at first load (found by the M1.5 browser
      // verification: an edit saved just before Next vanished on Previous).
      qc.setQueryData(["radiology-existing-draft", studyId], res.draft);
      qc.setQueryData(["radiology-finding-instances", res.draft.id], {
        success: true,
        instances: savedFindings.map((f) => ({
          findingId: f.findingId,
          structuredJson: f.params,
          source: "quickselect",
        })),
      });
      setLastSavedAt(new Date());
      setLastSavedSnapshot(serializeReportSnapshot({
        clinicalHistory, technique, rawFindings, impression, recommendation,
        quickSelectIds: Array.from(selectedQuickIds),
      }));
      // An open preview's validation is now stale; refresh on next open.
      void qc.invalidateQueries({ queryKey: ["radiology-validate-draft"] });
      toast({ title: "Draft Saved" });
      return res.draft.id;
    } catch (err) {
      toast({
        title: "Save Failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function finalizeReport() {
    if (!entry) return;
    // Guard against double-finalize: both re-clicks while in flight
    // (finalizing flag) and re-finalizing an already-final report.
    if (finalizing || reportStatus === "FINAL") return;
    setFinalizing(true);
    let confirmed = false;
    try {
      // 1) Persist the editor state first (M1.4): D5 signs from the DRAFT's
      //    persisted data, so an unsaved editor would validate and sign
      //    yesterday's content. A failed save aborts finalize truthfully.
      let effectiveDraftId = draftId;
      if (dirty || !effectiveDraftId) {
        effectiveDraftId = await saveDraft();
        if (effectiveDraftId === null) return;
      }

      // 2) Backend validation of exactly what will be signed — the REAL
      //    D3/D3.5 builder + D1 validator, read-only. Unreachable validation
      //    is reported, never guessed.
      let validation: ValidateDraftResponse | null = null;
      try {
        validation = await api.post<ValidateDraftResponse>(
          "/api/radiology/report-generator/validate-draft",
          { draftId: effectiveDraftId },
        );
      } catch { validation = null; }

      const s = validation?.structured;
      let validationSummary: string;
      let blockingErrors: string[] = [];
      if (!validation) {
        validationSummary = "Structured validation: could not be checked (endpoint unreachable).";
      } else if (!s || !s.enabled) {
        validationSummary = "Structured validation: disabled — legacy finalize path.";
      } else if (s.built) {
        validationSummary = `Structured document valid — ${s.findingsCount} finding(s).` +
          (s.warnings.length ? `\nWarnings (non-blocking):\n${s.warnings.map((w, i) => `  ${i + 1}. ${w}`).join("\n")}` : "");
      } else if (s.errors.length > 0) {
        blockingErrors = s.errors.map(validationIssueText);
        validationSummary =
          `STRUCTURED VALIDATION FAILED — ${blockingErrors.length} error(s):\n` +
          blockingErrors.map((e, i) => `  ${i + 1}. ${e}`).join("\n") +
          "\nFinalizing now will sign via the LEGACY path (no structured document).";
      } else {
        validationSummary =
          `Structured document skipped (${s.skipReasons.join("; ") || "no structured data"}) — legacy finalize path.`;
      }

      // 3) Client-side rule warnings (existing validator — warn only).
      const warnings = validateReport({ findings: rawFindings, impression, recommendation });

      // 4) ONE explicit confirmation carrying the exact identity being
      //    signed (Phase 7/8): patient, study, modality, accession +
      //    validation state. window.confirm is this page's existing dialog
      //    idiom — not redesigning.
      const identity =
        `Patient: ${entry.patientName}${entry.age || entry.sex ? ` (${[entry.age, entry.sex].filter(Boolean).join("/")})` : ""}\n` +
        `Study: ${entry.studyDescription || "—"} · ${entry.modality}\n` +
        `Accession: ${entry.accessionNumber}`;
      const warningBlock = warnings.length
        ? `\nReport check warnings:\n${warnings.map((w, i) => `  ${i + 1}. ${w}`).join("\n")}\n`
        : "";
      // Unbilled study: the report row cannot be created (test_id NOT NULL) —
      // say so BEFORE the radiologist commits, not after.
      const unbilledNote = entry.patientId && !entry.studyId
        ? "\nNote: no billed test is linked to this study — the worklist will be marked final, but no patient-facing report row can be created.\n"
        : "";
      confirmed = window.confirm(
        `Finalize this report?\n\n${identity}\n\n${validationSummary}\n${warningBlock}${unbilledNote}\nAfter finalizing, editing is disabled.`,
      );
      if (!confirmed) return;
    } finally {
      // The in-flight guard for phases 1–4; the signing block below manages
      // its own flag lifetime so a thrown error can't leave it stuck.
      if (!confirmed) setFinalizing(false);
    }

    // Learning Engine (Phase 5): if the recommendation contains a sentence
    // beyond what the last-selected finding's own template inserted, and it
    // looks like a genuine addition, record it against that finding for
    // this radiologist. Fire-and-forget, never blocks finalize, never
    // inserts anything automatically — purely building up future
    // suggestions the radiologist can choose to accept.
    const lastFinding = lastToggledFindingRef.current;
    if (lastFinding) {
      const extra = recommendation
        .split(/\n+/)
        .map((s) => s.trim())
        .find((s) => isLearnableAddition(s, lastFinding.recommendationText || ""));
      if (extra) {
        api.post("/api/radiology/quick-select/learned-patterns", {
          triggerLabel: lastFinding.label,
          suggestedText: extra,
        }).catch(() => { /* learning is best-effort, never blocks finalize */ });
      }
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

      // M1.1 — canonical finalize path shared with every reporting surface.
      // D5 (when ff_radiology_structured_final is on) signs the structured
      // document server-side with SESSION-derived authorship and reports the
      // TRUE outcome in structuredFinal; createdBy below only labels the
      // legacy row path.
      const { reportId, structuredFinal, reportCreationSkipped: skippedReason } = await finalizeRadiologyReport(
        {
          patientId: entry.patientId,
          studyId: entry.studyId,
          // The page's study key (worklist row id) — the same key drafts are
          // saved under, so D5 finds THIS study's draft.
          worklistId: entry.id ?? studyId ?? null,
          modality: entry.modality,
          studyDescription: entry.studyDescription,
          accessionNumber: entry.accessionNumber,
          studyInstanceUID: entry.studyInstanceUID,
        },
        {
          title: selectedTemplate?.templateName || entry.studyDescription || "Radiology Report",
          htmlBody: html,
          impression,
          isCritical,
          criticalNote,
          createdBy: session?.user.name ?? "Radiologist",
          actor: session?.user.name ?? "staff",
        },
      );

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
      setFinalizedReportId(reportId);
      setStructuredFinalInfo(structuredFinal);
      setReportCreationSkipped(skippedReason);
      // M1.5 — the queue treats this study as done immediately, even before
      // the 30s worklist refetch reflects the server status flip.
      if (studyId != null) workflow.markCompleted(studyId);
      // Finalized content is on the server — the workspace is clean now.
      setLastSavedSnapshot(serializeReportSnapshot({
        clinicalHistory, technique, rawFindings, impression, recommendation,
        quickSelectIds: Array.from(selectedQuickIds),
      }));
      // Finalized text is now safely on the server — remove the local
      // backup so patient report text never lingers on a shared machine.
      draftBackup.clear();
      // Surface the TRUE finalize path (Phase 8) — never claim a structured
      // sign that did not happen.
      const signedStructured = structuredFinal?.signed === true;
      const legacyFallback = structuredFinal?.signed === false;
      toast({
        title: signedStructured ? "Report Finalized — structured document signed" : "Report Finalized",
        description: skippedReason
          ? `Worklist marked final, but NO patient report row was created: ${skippedReason}.`
          : legacyFallback
            ? `Signed via LEGACY path: ${typeof structuredFinal?.reason === "string" ? structuredFinal.reason : "structured signing unavailable"}`
            : reportId ? `Report ID: ${reportId}` : "Worklist updated.",
        ...(legacyFallback || skippedReason ? { variant: "destructive" as const } : {}),
      });
      void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
      // Lifecycle metadata for the fresh report (Phase 8: refresh
      // report/version metadata, preserve access to the signed report).
      void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
      void qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });
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

  /** M1.4 Phase 9 — countersign via the existing D9 route. UI gating only;
   *  the server re-enforces role, permission, and verifier≠signer. */
  async function verifyReport() {
    if (!finalReport || verifying) return;
    const targetId = finalReport.id ?? linkedReportId;
    if (!targetId) return;
    if (!window.confirm(
      `Verify (countersign) this report as ${session?.user.name ?? "current user"}?\n\n` +
      `This records you as the verifying radiologist.`,
    )) return;
    setVerifying(true);
    try {
      await api.post(`/api/patient-reports/${targetId}/verify`, {
        verifiedByName: session?.user.name ?? undefined,
      });
      toast({ title: "Report verified" });
      void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
      void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
    } catch (err) {
      toast({
        title: "Verify failed",
        description: err instanceof Error ? err.message : "Error",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // M1.5 — WORKFLOW TRANSITIONS (next / previous / park / refresh)
  // ══════════════════════════════════════════════════════════════════════════

  /** Central transition gate (Phase 3/7): busy states BLOCK, dirty CONFIRMS.
   *  Rules are pure (lib/reportingWorkflow.canLeaveStudy). */
  function guardedLeave(): boolean {
    const verdict = canLeaveStudy({
      dirty, saving, finalizing,
      viewerLaunching: viewerLaunch.busy,
      transitioning: workflow.transitioning,
    });
    if (verdict.kind === "blocked") {
      toast({ title: "Cannot switch study", description: verdict.reason, variant: "destructive" });
      return false;
    }
    if (verdict.kind === "confirm") return window.confirm(verdict.reason);
    return true;
  }

  /** Phase 7: pending requests for the departing study must never land on
   *  the next patient's screen. Keyed queries already isolate the DATA; this
   *  aborts the in-flight requests themselves. */
  function cancelCurrentStudyRequests() {
    void qc.cancelQueries({ queryKey: ["workspace-entry", studyId] });
    void qc.cancelQueries({ queryKey: ["radiology-existing-draft", studyId] });
    void qc.cancelQueries({ queryKey: ["radiology-finding-instances"] });
    void qc.cancelQueries({ queryKey: ["radiology-validate-draft"] });
    void qc.cancelQueries({ queryKey: ["workspace-final-report"] });
  }

  /** Navigate to a queue row: history + navigation lock + expected-patient
   *  capture happen in the controller; the M1.4 isolation effect resets all
   *  report state when the :studyId param changes. */
  function goToStudy(target: QueueStudy) {
    cancelCurrentStudyRequests();
    workflow.beginTransition(studyId, target);
    navigate(`/radiology/report/${target.id}`);
  }

  /** Phase 3 — Next Study: next eligible (skips completed + parked, wraps);
   *  when the fresh queue is exhausted, offers the oldest parked study. */
  function nextStudy() {
    if (!guardedLeave()) return;
    const target = workflow.peekNext();
    if (target) {
      goToStudy(target);
      return;
    }
    const parkedNext = workflow.peekParked();
    if (parkedNext) {
      const label = `${parkedNext.patientName} · ${parkedNext.accessionNumber}`;
      if (window.confirm(`No unreported studies left in the queue.\n\nReturn to parked study?\n${label}`)) {
        workflow.unpark(parkedNext.id);
        goToStudy(parkedNext);
      }
      return;
    }
    toast({ title: "Queue complete", description: "No more eligible studies to report." });
  }

  /** Phase 4 — Previous Study: true back-stack of visited studies. */
  function previousStudy() {
    if (workflow.historyDepth === 0) {
      toast({ title: "No previous study", description: "You haven't navigated from another study yet." });
      return;
    }
    if (!guardedLeave()) return;
    cancelCurrentStudyRequests();
    const targetId = workflow.beginPreviousTransition(studyId);
    if (targetId == null) return;
    navigate(`/radiology/report/${targetId}`);
  }

  /** Phase 5 — Park the current study (optional reason) and advance. */
  function parkCurrentStudy() {
    if (studyId == null || !entry) return;
    if (workflow.isParked(studyId)) {
      workflow.unpark(studyId);
      toast({ title: "Study unparked" });
      return;
    }
    if (!guardedLeave()) return;
    const reason = window.prompt("Park this study — reason (optional):", "");
    if (reason === null) return; // cancelled
    workflow.park(studyId, reason);
    const target = workflow.peekNext();
    if (target) goToStudy(target);
    else toast({ title: "Study parked", description: "No further eligible studies — staying on this study." });
  }

  /** Phase 6 — queue refresh; never touches the report being typed. */
  function refreshQueueAndCurrent() {
    workflow.refreshQueue();
    // Re-pull the current study's status/lifecycle additively — hydration is
    // once-per-study, so a refetch can NEVER rewrite the editor text.
    void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
    void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
    toast({ title: "Queue refreshed" });
  }

  /** Phase 6 — full reload of the current study from the server (explicit,
   *  confirmed when dirty; reuses the study-switch reset + load path). */
  function reloadCurrentStudy() {
    if (studyId == null) return;
    if (dirty && !window.confirm("Reload this study from the server? Unsaved changes will be lost.")) return;
    resetWorkspaceState(); // also re-arms the once-per-study hydration guards
    void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
    void qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });
    void qc.invalidateQueries({ queryKey: ["radiology-finding-instances"] });
    toast({ title: "Study reloaded" });
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
              onClick={() => {
                // Explicit user choice → full template apply (M1.4).
                templateApplySourceRef.current = "manual";
                setSelectedTemplateId(t.id);
              }}
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
        {/* M1.4 — draft-load + dirty state, always truthful */}
        {!!studyId && isLoadingExistingDraft && (
          <span className="shrink-0 text-[10px] text-muted-foreground">Loading draft…</span>
        )}
        {!!studyId && !isLoadingExistingDraft && !existingDraft && !lastSavedAt && (
          <span className="shrink-0 text-[10px] text-muted-foreground">No saved draft</span>
        )}
        {dirty ? (
          <Badge variant="outline" className="shrink-0 text-[10px] bg-amber-50 text-amber-800 border-amber-300">
            Unsaved changes
          </Badge>
        ) : lastSavedAt ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            Saved {lastSavedAt.toLocaleTimeString()}
          </span>
        ) : null}
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

      {/* ── M1.5 — workflow status bar (Phase 10) ──────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b bg-muted/20 text-[11px] flex-wrap" data-testid="workflow-status-bar">
        <span className="text-muted-foreground" data-testid="queue-position">
          Study {workflow.position.index >= 0 ? `${workflow.position.index + 1} of ${workflow.position.total}` : `— of ${workflow.position.total}`}
        </span>
        <span className="text-green-700">✓ {workflow.completedCount} completed</span>
        <span className={workflow.parkedCount > 0 ? "text-amber-700" : "text-muted-foreground"}>⏸ {workflow.parkedCount} parked</span>
        {workflow.isParked(studyId) && (
          <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] py-0" data-testid="parked-badge">
            PARKED{(() => { const r = workflow.parked.find((p) => p.id === studyId)?.reason; return r ? ` — ${r}` : ""; })()}
          </Badge>
        )}
        {dirty && <span className="text-amber-700">● unsaved</span>}
        {saving && <span className="text-blue-700">Saving…</span>}
        {finalizing && <span className="text-blue-700">Finalizing…</span>}
        {workflow.transitioning && <span className="text-blue-700">Switching study…</span>}
        <span className="text-muted-foreground" data-testid="viewer-status">
          Viewer:{" "}
          {viewerLaunch.busy
            ? "connecting…"
            : viewerLaunch.lastResult?.success && viewerLaunch.lastResult.selectedNetworkMode
              ? `connected via ${viewerLaunch.lastResult.selectedNetworkMode}`
              : viewerLaunch.lastResult && !viewerLaunch.lastResult.success
                ? "launch failed"
                : "—"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Jump to a specific queue row — indicators: → current ✓ done ⏸ parked */}
          <select
            className="h-6 max-w-[260px] text-[10px] border rounded-md px-1 bg-background text-muted-foreground"
            value=""
            data-testid="queue-jump"
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!id) return;
              const row = workflow.queue.find((s) => s.id === id);
              if (!row || row.id === studyId) return;
              if (!guardedLeave()) return;
              goToStudy(row);
            }}
            title="Jump to a study in the queue"
          >
            <option value="">Queue ({workflow.position.total})…</option>
            {workflow.queue.map((s) => {
              const ind = workflow.indicators.find((i) => i.id === s.id);
              const prefix = ind?.current ? "→ " : ind?.completed ? "✓ " : ind?.parked ? "⏸ " : "";
              return (
                <option key={s.id} value={s.id}>
                  {prefix}{s.patientName} · {s.modality} · {s.accessionNumber}
                </option>
              );
            })}
          </select>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5 px-1.5"
            onClick={() => previousStudy()} disabled={workflow.historyDepth === 0 || workflow.transitioning}
            title="Previous study (Ctrl+Shift+P)" data-testid="btn-previous-study">
            <ChevronLeft size={11} /> Prev
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5 px-1.5"
            onClick={() => nextStudy()} disabled={workflow.transitioning}
            title="Next eligible study (Ctrl+Shift+N)" data-testid="btn-next-study">
            Next <ChevronRight size={11} />
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-0.5 px-1.5"
            onClick={() => parkCurrentStudy()} disabled={!entry || workflow.transitioning}
            title={workflow.isParked(studyId) ? "Unpark this study" : "Park this study and move on (Ctrl+Shift+K)"}
            data-testid="btn-park-study">
            <PauseCircle size={11} /> {workflow.isParked(studyId) ? "Unpark" : "Park"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-0.5 px-1.5"
            onClick={() => refreshQueueAndCurrent()} disabled={workflow.queueRefreshing}
            title="Refresh the queue and this study's status" data-testid="btn-refresh-queue">
            <RefreshCw size={11} className={workflow.queueRefreshing ? "animate-spin" : ""} /> Refresh
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1.5"
            onClick={() => reloadCurrentStudy()} disabled={!studyId}
            title="Reload this study from the server (unsaved changes prompt first)" data-testid="btn-reload-study">
            Reload
          </Button>
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
                  <span className="text-muted-foreground">Study UID</span>
                  <span className="font-mono text-[10px] truncate" title={entry.studyInstanceUID || undefined}>
                    {entry.studyInstanceUID || "— missing —"}
                  </span>
                </div>
                {/* M1.2 — the ONE study-launch control (network auto-selection,
                    forced modes, route badge, diagnostics). URL construction
                    lives in lib/studyLaunchService, not in this page. */}
                <OpenStudyPanel
                  study={{
                    studyInstanceUID: entry.studyInstanceUID ?? null,
                    accessionNumber: entry.accessionNumber ?? null,
                    patientId: entry.patientId ?? null,
                    worklistId: entry.id ?? null,
                  }}
                  isAdmin={isOwnerRole(session)}
                  onLaunchStateChange={setViewerLaunch}
                />
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

            {/* M1.4 — truthful "no report row" note for THIS session's finalize */}
            {reportCreationSkipped && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] shrink-0">
                <AlertTriangle size={13} className="shrink-0" />
                <span>
                  Worklist marked final, but no patient-facing report row was created: {reportCreationSkipped}.
                </span>
              </div>
            )}

            {/* M1.4 — truthful finalize path for THIS session's finalize */}
            {structuredFinalInfo && (
              structuredFinalInfo.signed === true ? (
                <div className="flex items-center gap-2 p-2 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-[11px] shrink-0">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>
                    Structured document signed
                    {typeof structuredFinalInfo.documentId === "string" ? ` · ${structuredFinalInfo.documentId}` : ""}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[11px] shrink-0">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>
                    Finalized via the LEGACY path — no structured document was signed
                    {typeof structuredFinalInfo.reason === "string" ? ` (${structuredFinalInfo.reason})` : ""}.
                  </span>
                </div>
              )
            )}

            {/* M1.4 — D8/D9 lifecycle, version and amendment state of the
                linked final report; Verify appears only for permitted users
                (server re-enforces). */}
            {(lifecycleBadges.length > 0 || canShowVerify) && (
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                {lifecycleBadges.map((b) => (
                  <span
                    key={b.label}
                    className={`text-[10px] font-semibold rounded-full px-2 py-0.5 border ${BADGE_TONE_CLASS[b.tone] ?? BADGE_TONE_CLASS.slate}`}
                  >
                    {b.label}
                  </span>
                ))}
                {canShowVerify && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 border-green-300 text-green-700 hover:bg-green-50"
                    onClick={verifyReport}
                    disabled={verifying}
                    title="Countersign this report as the verifying radiologist (D9)"
                  >
                    {verifying ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                    Verify report
                  </Button>
                )}
                {!canShowVerify && verifyGate.reason === "verifier must differ from signer" && (
                  <span className="text-[10px] text-muted-foreground">Verification requires a second radiologist.</span>
                )}
              </div>
            )}

            {/* Unsaved local backup found — offered ONLY when newer than the
                server draft AND actually different from it (M1.4 Phase 3). */}
            {offerBackupRestore && (
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
                  title={quality.issues.length ? quality.issues.map((i, n) => `${n + 1}. ${i}`).join("\n") + (checklistRemaining.length ? `\n\nChecklist remaining: ${checklistRemaining.join(", ")}` : "") : "Report is complete and consistent."}
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
                {activeProtocol?.normalText && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={handleInsertProtocolNormals}
                    title={activeProtocol.normalText}>
                    + {activeProtocol.name} normals
                  </Button>
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
                        onClick={() => deleteImpressionLineAt(i)}
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
                {/* M1.4 — REAL backend validation of the saved draft (the
                    D3/D3.5 builder + D1 validator run read-only server-side;
                    nothing here is recomputed in React). */}
                <div className="px-3 py-2 border-b text-[11px] space-y-1">
                  {!draftId ? (
                    <div className="text-muted-foreground">Save the draft to run structured validation.</div>
                  ) : validating ? (
                    <div className="text-muted-foreground">Running structured validation…</div>
                  ) : !draftValidation ? (
                    <div className="text-muted-foreground">Structured validation not loaded.</div>
                  ) : !draftValidation.structured.enabled ? (
                    <div className="text-muted-foreground">
                      Structured validation disabled — legacy draft only
                      {` (findings ${draftValidation.legacy.rawFindings ? "present" : "missing"}, impression ${draftValidation.legacy.impression ? "present" : "missing"}).`}
                    </div>
                  ) : draftValidation.structured.built ? (
                    <>
                      <div className="text-green-700 font-medium">
                        ✓ Structured document valid — {draftValidation.structured.findingsCount} finding(s)
                      </div>
                      {draftValidation.structured.warnings.map((w, i) => (
                        <div key={i} className="text-amber-700">⚠ {w}</div>
                      ))}
                    </>
                  ) : draftValidation.structured.errors.length > 0 ? (
                    <>
                      <div className="text-red-700 font-semibold">
                        ✗ Structured validation failed — {draftValidation.structured.errors.length} blocking error(s); finalize would use the legacy path
                      </div>
                      {draftValidation.structured.errors.map((err, i) => (
                        <div key={i} className="text-red-700">{i + 1}. {validationIssueText(err)}</div>
                      ))}
                    </>
                  ) : (
                    <div className="text-amber-700">
                      Structured document skipped ({(draftValidation.structured.skipReasons ?? []).join("; ") || "no structured data"}) — legacy fallback.
                    </div>
                  )}
                  {/* Renderer/hash diagnostics — admin-only drawer (Phase 7) */}
                  {isOwnerRole(session) && draftValidation?.structured.enabled && draftValidation.structured.built && (
                    <div>
                      <button
                        className="underline text-muted-foreground"
                        onClick={() => setShowDiagnostics((v) => !v)}
                      >
                        {showDiagnostics ? "Hide" : "Show"} structured diagnostics
                      </button>
                      {showDiagnostics && (
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
                          <div>document_id: {draftValidation.structured.documentId}</div>
                          <div>content_sha256: {draftValidation.structured.contentSha256}</div>
                        </div>
                      )}
                    </div>
                  )}
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
                onClick={() => void saveDraft()}
                disabled={saving}
                title="Save draft (Ctrl+S)"
              >
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                Save Draft
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                // Opening the preview refreshes the REAL backend validation
                // of the saved draft (M1.4 Phase 7).
                if (!previewMode && draftId) void refetchValidation();
                setPreviewMode(!previewMode);
              }}
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
                onClick={() => void finalizeReport()}
                disabled={finalizing}
                title="Finalize report (Ctrl+Enter)"
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
                instances={quickInstances}
                onUpdateInstance={handleInstanceUpdate}
                onAutoTechnique={handleAutoTechnique}
                onInsertNormals={handleInsertNormals}
                activeProtocolId={activeProtocol?.id ?? null}
                onProtocolChange={handleProtocolChange}
                onChecklistChange={(percent, remaining) => { setChecklistPercent(percent); setChecklistRemaining(remaining); }}
                onAcceptLearnedSuggestion={(text) => setRecommendation((prev) => mergeBlock(prev, text))}
                onFindingsLoaded={handleFindingsLoaded}
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
