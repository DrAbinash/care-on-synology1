import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
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
import { readStaffSession, normalizeRole, isOwnerRole, isFeatureEnabled } from "@/lib/staffSession";
import { api } from "@/lib/fetchApi";
import { queryAiReporting } from "@/lib/aiReportingClient";
// Cockpit→Workspace merge: shared status/priority/role helpers (already used by
// RadiologyWorklist and the deprecated Cockpit) — reused, not duplicated.
import { toUnifiedStatus, priorityInfo, worklistRoleView } from "@/lib/radiologyStatus";
import { finalizeRadiologyReport, saveRadiologyDraft } from "@/lib/radiologyReportLifecycle";
import { exportRadiologyReportToWord, safeFileNamePart } from "@/lib/radiologyReportWordExport";
import { exportRadiologyReportToPdf } from "@/lib/radiologyReportPdfExport";
import { type ReportImageRef } from "@/lib/reportImageRefs";
import ReportLayoutQuickSelect, {
  type ReportLayoutKey,
  quickSelectLayoutKey,
  reportLayoutTemplateQuery,
} from "@/components/radiology/ReportLayoutQuickSelect";
import OpenStudyPanel from "@/components/radiology/OpenStudyPanel";
import ReferringDoctorQuickSelect from "@/components/ReferringDoctorQuickSelect";
import {
  ArrowLeft, ExternalLink, Sparkles, Save, CheckCircle2, AlertTriangle,
  Printer, RefreshCw, Star, ClipboardList, Plus, Trash2, Eye,
  Share2, AlertCircle, X, Send, Zap, BookOpen, MonitorPlay,
  LayoutTemplate, BarChart3, Monitor, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Brain, GitCompare, FileText,
  Maximize2, Columns2, AppWindow, FileOutput, FileDown,
} from "lucide-react";
import EmbeddedWadoViewer from "@/components/EmbeddedWadoViewer";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  CENTER_MIN_PX, LEFT_COLLAPSED_PCT, LEFT_MAX_PCT, LEFT_MIN_PCT,
  RIGHT_COLLAPSED_PCT, RIGHT_MAX_PCT, RIGHT_MIN_PCT,
  clampLeftPct, clampRightPct, fallbackModeWhenPopupBlocked,
  loadWorkspaceLayoutPrefs, saveWorkspaceLayoutPrefs, shouldShowEmbeddedViewer,
  workspaceLayoutStorageKey,
  type ModeLayoutState, type WorkspaceLayoutMode, type WorkspaceLayoutPrefs,
} from "@/lib/workspaceLayoutPrefs";
import ReportImagePicker from "@/components/radiology/ReportImagePicker";
import PrintImagePicker from "@/components/radiology/PrintImagePicker";
import RadiologyCopilotPanel from "@/components/RadiologyCopilotPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { FindingsHighlightEditor, type FindingsHighlightEditorHandle } from "@/components/FindingsHighlightEditor";
import { chocolateBoxSetFor, insertAtCursor } from "@/lib/findingsMacros";
import RadiologyMemoryPanel from "@/components/RadiologyMemoryPanel";
import RadiologyKnowledgePanel from "@/components/RadiologyKnowledgePanel";
import MeasurementAssistantPanel from "@/components/MeasurementAssistantPanel";
// R2.0 — canonical ultrasound integration: USG mode inside the ONE
// canonical workspace (no separate USG reporting workflow).
import UsgMeasurementReviewPanel from "@/components/radiology/UsgMeasurementReviewPanel";
import ObDashboardStrip from "@/components/radiology/ObDashboardStrip";
// CARE USG Companion (Phase 1) — workflow-automation panel that composes the
// existing engines (study recognition, template, protocol, measurements,
// comparison, Copilot) into a pre-report snapshot inside THIS workspace.
import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel";
import type { CompanionCopilotContext } from "@/lib/usgCompanionTypes";
import type { PopulateBlock as CompanionPopulateBlock, AutoPopulatePlan } from "@/lib/usgCompanionAutoPopulate";
import ModuleErrorBoundary from "@/components/ModuleErrorBoundary";
import "@/lib/copilotUsgCompanionModule"; // registers the USG Companion Copilot module
// Cockpit→Workspace merge (D1): external-viewer (OHIF/Weasis/DICOM-SR)
// measurement import queue — self-hides when the study has none.
import ViewerMeasurementsPanel, { useViewerMeasurements } from "@/components/radiology/ViewerMeasurementsPanel";
import PreferencesPanel from "@/components/PreferencesPanel";
import { isUltrasoundModality, isObstetricUsgStudy } from "@/lib/usgModality";
import { templateCatalogModality, templateModalityMatches } from "@/lib/radiologyTemplateModality";
import {
  pickStructuredTemplate,
  studyRegionToBodyPart,
  templateRegionMismatch,
} from "@/lib/pickStructuredTemplate";
import { pickQuickProtocol } from "@/lib/pickQuickProtocol";
import { buildUnifiedInboxExtras, mergeCopilotItems } from "@/lib/unifiedCopilotInbox";
import QuickFindingsPanel, {
  type QuickFinding, type QuickProtocol, type QuickClinicalHistoryChip, type QuickSelectData,
} from "@/components/radiology/QuickFindingsPanel";
import { matchStudyRegion } from "@/lib/studyRegion";
import { hasPhrase, appendClinicalPhrase, removeClinicalPhrase } from "@/lib/clinicalHistoryText";
import {
  renderAbnormality, type AbnormalityInstance, type RenderedAbnormality, type Side,
  mergeBlock, mergeImpression, EMPTY_INSTANCE,
  applyRenderedTransition, toggleQuickSelection, setQuickInstance, deleteQuickInstance,
  seedQuickInstance, patchQuickInstance,
} from "@/lib/renderEngine";
import { applySectionContribution, conflictingSelections, matchTemplateSection } from "@/lib/smartFindings";
import { deriveQuickSelectFindings } from "@/lib/quickSelectFindingsPayload";
import {
  parseQuestions, resolveSection, generateStructuredFinding,
  initialValues as structuredInitialValues,
} from "@/lib/structuredFindings";
import StructuredFindingDialog from "@/components/radiology/StructuredFindingDialog";
import CommandPalette from "@/components/radiology/CommandPalette";
import { useRadiologyPalettePrefs } from "@/hooks/useRadiologyPalettePrefs";
import type { PaletteItem } from "@/lib/commandPalette";
import { validateReport, computeQualityScore } from "@/lib/reportValidator";
// PR #101 Phase 1 (shadow-first): run the canonical quality engine in parallel
// with the legacy validator and log parity diffs in dev only. Does not change
// the user-visible score.
import { logParityInDev } from "@/lib/reportQualityShadow";
// F3 (Cockpit→Workspace merge): real-time missed-finding text-pattern nudges.
// This lib was otherwise dead (imported only by the deprecated Cockpit).
import { observeReportText, type CoPilotSuggestion } from "@/lib/radiologyCoPilotEngine";
import CareCopilotPanel, { type CopilotAction } from "@/components/radiology/CareCopilotPanel";
import { analyzeCopilot, type CopilotContext, type CopilotItem } from "@/lib/copilotOrchestrator";
import { suggestCompletion } from "@/lib/copilotCompletion";
import { runLocalModules, runAiModules } from "@/lib/copilotModules";
import "@/lib/copilotAiModule"; // registers the on-demand AI reasoning module (Part 20)
import "@/lib/copilotComparisonModule"; // registers the previous-study comparison module (MRI PR 1)
import "@/lib/copilotMeasurementModule"; // registers the viewer-measurement completeness module (MRI PR 2)
// PR B — USG Platform Consolidation §12: USG Copilot modules, registered the
// same way as the modules above — plain plug-ins via registerCopilotModule(),
// zero changes to copilotModules.ts/copilotOrchestrator.ts/CareCopilotPanel.tsx.
import "@/lib/copilotUsgAbdomenModule";
import "@/lib/copilotUsgObstetricModule";
import "@/lib/copilotUsgThyroidModule";
import "@/lib/copilotUsgBreastModule";
import "@/lib/copilotUsgScrotumModule";
import "@/lib/copilotUsgDopplerModule";
// PR C — CARE USG Gold Standard §7: seven more organ/study-specific USG
// modules, same plug-in pattern, zero core changes.
import "@/lib/copilotUsgKidneyModule";
import "@/lib/copilotUsgLiverModule";
import "@/lib/copilotUsgGallbladderModule";
import "@/lib/copilotUsgPelvisModule";
import "@/lib/copilotUsgTvsModule";
import "@/lib/copilotUsgGrowthModule";
import "@/lib/copilotUsgAnomalyModule";
import "@/lib/copilotCriticalModule"; // registers the critical-results safety module (MRI PR 3)
import "@/lib/copilotRecommendationModule"; // registers the Clinical Recommendation Registry module (CDS PR)
import { detectCriticalFindings } from "@/lib/criticalResults";
import { computeFinalizeSafety, formatFinalizeSafety, criticalFindingBlocksFinalize } from "@/lib/finalizeSafety";
import { useFinalizeFlow } from "@/hooks/useFinalizeFlow";
import FinalizeSignDialog from "@/components/radiology/FinalizeSignDialog";
import {
  loadReadingSession, toggleReadingSession, bumpSessionCompleted, type ReadingSessionState,
} from "@/lib/readingSession";
import { criticalWatchListFor } from "@/lib/radiologyMasterTemplates";
import {
  combinationsForModality, buildCombination, combinationInserts, matchStudyCombination,
  type StudyCombination,
} from "@/lib/studyCombinations";
import ComparisonPanel, { type SelectedPrior } from "@/components/radiology/ComparisonPanel";
import { useCopilotPrefs } from "@/hooks/useCopilotPrefs";
import { useCopilotLearning } from "@/hooks/useCopilotLearning";
import { isLearnableAddition } from "@/lib/learningEngine";
import { upsertMeasurement, upsertLabeledLine } from "@/lib/measurementVars";
import CollapsibleSection from "@/components/radiology/CollapsibleSection";
import FollowUpPanel from "@/components/radiology/FollowUpPanel";
import { useLocalDraftBackup } from "@/hooks/useLocalDraftBackup";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { retryWithBackoff, isTransientError, offlineBlockMessage } from "@/lib/reliability";
import {
  registerDraftRescueSaver, deregisterDraftRescueSaver, writeRescueDraft, readRescueDraft, clearRescueDraft,
  type RescueDraft,
} from "@/lib/draftRescue";
import { useRadiologyDraftId } from "@/hooks/useRadiologyDraftId";
import {
  serializeReportSnapshot, isReportDirty, shouldOfferBackupRestore,
  restorableSelections, extractD1QuickSelections, toInstanceParams,
  deriveLifecycleBadges, canVerifyReport, matchWorkspaceShortcut,
  type FinalReportMeta, type PersistedInstanceRow,
} from "@/lib/workspaceReportState";
import { canLeaveStudy, type QueueStudy } from "@/lib/reportingWorkflow";
import { createCommandDispatcher } from "@/lib/workspaceCommands";
import { useReportingWorkflow } from "@/hooks/useReportingWorkflow";
import { useStudyLock } from "@/hooks/useStudyLock";
import { lockStatusMessage, QUEUE_SCOPE_LABELS, parseQueueScope, assignmentCategoryOf, type QueueScope } from "@/lib/studyLockState";
import type { StudyLaunchResult } from "@/lib/studyLaunchService";
import { ChevronLeft, ChevronRight, PauseCircle, Lock, TrendingUp, TrendingDown, Minus, CalendarDays, Library } from "lucide-react";
import { DATE_PRESETS, toISTDateStr } from "@/lib/dateRangePresets";
// M1.6B2 — the ONE voice pipeline (providers/grammar/safety live in libs; the
// hook executes through THIS page's adapter → the M1.5 command dispatcher).
import { useVoiceSession, type VoiceExecutionResult } from "@/hooks/useVoiceSession";
import VoiceCommandBar from "@/components/radiology/VoiceCommandBar";
import ReportingWorkspaceChrome, { WORKSPACE_CHROME_COLLAPSED_KEY } from "@/components/radiology/ReportingWorkspaceChrome";
import { normalizeDictationText, describeIntent, type ParsedVoiceCommand, type ViewerOp } from "@/lib/voiceCommandGrammar";
import { voiceKeyAction } from "@/lib/voiceSessionState";
import {
  parseVoiceSettings, parseVoiceUserPrefs, mergeVoiceSettings, fetchTranscribeCapabilities,
  type TranscribeCapabilities,
} from "@/lib/voiceTranscription";
import type { EmbeddedViewerHandle } from "@/components/EmbeddedWadoViewer";
import { AiDraftPanel } from "@/components/ai/AiDraftPanel";
import FindingsLibraryPanel from "@/components/radiology/FindingsLibraryPanel";
import { appendToFindings } from "@/lib/aiDraftBinding";

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
  // M1.6B1 — id-based assignment (full-row select serves these)
  assignedRadiologistId?: number | null;
  assignedAt?: string | null;
  assignedByName?: string | null;
  aiDraftStatus: string;
  aiDraftJson: string | null;
  reportId: number | null;
  deliveryStatus: string | null;
  // Cockpit→Workspace merge (B1): billing/triage banner fields. Already served
  // by GET /api/radiology/pacs-worklist (uhid = matched ERP patient id,
  // billNumber via study→bill, priority = radiology_studies.priority) — no
  // backend change, additive display only.
  uhid?: string | null;
  billNumber?: string | null;
  priority?: string | null;
  createdAt: string;
  updatedAt: string;
  autoLinkMeta?: {
    linked: boolean;
    studyId?: number;
    matchPoints?: number;
    matchScore?: string;
    reason?: string;
  } | null;
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

// Cockpit→Workspace merge (E1): Phase-F "winner" master template catalog
// (radiology_master_templates), consolidated from the four legacy systems.
// A different table/endpoint from StructuredTemplate above — surfaced here so
// radiologists keep the catalog they used in the Cockpit. Content-only apply.
type MasterTemplate = {
  id: number;
  groupName: string;
  templateName: string;
  modality: string;
  studyType: string | null;
  bodyPart: string | null;
  findings: string;
  impression: string;
  recommendations: string | null;
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

type StylePreferences = {
  impressionStyle: "concise" | "detailed" | "academic" | "diagnostic";
  terminologyLevel: "simple" | "standard" | "advanced";
  autoNumberImpressions: boolean;
  includeDifferential: boolean;
  includeMeasurements: boolean;
};

type RightTab = "copilot" | "quickselect" | "library" | "templates" | "followup" | "prior" | "ai" | "measurements" | "teaching" | "knowledge" | "diff" | "print";

// Workspace layout mode selector (Phase 2) — the upper-right control that
// used to be a single left-panel collapse icon. Doesn't depend on component
// state, so it's a module-level constant rather than rebuilt every render.
const LAYOUT_MODE_OPTIONS: Array<{ mode: WorkspaceLayoutMode; label: string; title: string; icon: ReactNode }> = [
  { mode: "reportFocus", label: "Report", title: "Report Focus — viewer hidden, editor gets maximum width (toggle viewer: Alt+\\)", icon: <Maximize2 size={13} /> },
  { mode: "split", label: "Split", title: "Split View — viewer and editor share the screen (laptop/remote default; toggle viewer: Alt+\\)", icon: <Columns2 size={13} /> },
  { mode: "viewerFocus", label: "Viewer", title: "Viewer Focus — embedded viewer gets more width for close image review", icon: <Monitor size={13} /> },
  { mode: "dualScreen", label: "Dual", title: "Dual Screen — open the viewer in a separate window/monitor, editor uses the full primary screen", icon: <AppWindow size={13} /> },
];

// F3 (Cockpit→Workspace merge): rules superseded by MeasurementAssistantPanel,
// which computes real ADC/Evans-Index values rather than just reminding the
// radiologist to mention them — excluded from the ported nudge list.
const COPILOT_SUPERSEDED_IDS = new Set(["brain-adc", "hydrocephalus-evans"]);

// C1/F6 (Cockpit→Workspace merge): viewer_measurements.measurementType is the
// caliper KIND, not an anatomical label — see the schema comment in
// lib/db/src/schema/radiologyLesions.ts. Real OHIF/Weasis/DICOM-SR imports
// will almost always populate one of these four generic values, so matching
// or deduping on measurementType alone would collide across unrelated
// measurements. Skip the relevant checks whenever the type is this generic.
const GENERIC_CALIPER_TYPES = new Set(["linear", "area", "volume", "ellipse"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cockpit→Workspace merge (E2): tolerant parse of a stored AI draft blob so a
// malformed aiDraftJson can never throw in render.
function safeParseAiDraft(json: string | null | undefined): { findings?: string; impression?: string } {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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
  imageRefs: ReportImageRef[];
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
    // Normal-scaffold rendering: one line per anatomical region. A NORMAL
    // region prints its full descriptive normal sentence (the template
    // baseline text) — never the bare word "Normal" — so the report reads as
    // a complete radiologist narrative in which each region is accounted for.
    // An ABNORMAL region swaps that sentence for the finding text and is
    // bolded, so the abnormal reads immediately against the normal scaffold.
    findingsHtml = Object.entries(opts.findingsMap)
      .map(([label, item]) => {
        const raw = item.text.trim();
        const sentence = raw || (item.normal ? "Normal." : "—");
        const body = escHtml(sentence).replaceAll("\n", "<br/>");
        const bodyHtml = item.normal ? body : `<strong>${body}</strong>`;
        // R1.4 — break-after:avoid-page on the heading itself (not the full
        // .section-heading class, which carries template color/border/font
        // styling this handwritten preview does not use) so a heading can
        // never print as the last line on a page with its content starting
        // on the next.
        return `<p style="margin:${sp} 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtml(fmtHeading(label, hc))}:</strong> ${bodyHtml}</p>`;
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

  // R1.4 — break-after:avoid-page on every section heading below so a
  // heading can never print as the last line on a page with its content
  // starting on the next (this HTML is now stored verbatim as the signed
  // report's body — see radiologyReportLifecycle.ts — instead of being
  // stripped to a structureless paragraph, so these rules now actually
  // reach the printed/PDF/delivered document).
  const hStyle = (margin: string) => `margin:${margin};break-after:avoid-page;page-break-after:avoid;`;

  const orderedImageRefs = [...opts.imageRefs].sort((a, b) => a.displayOrder - b.displayOrder);
  const imagesHtml = orderedImageRefs.length > 0
    ? `<h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeading("Key Images", hc)}</u></h3>
    <ul style="margin:4px 0 0 18px;padding:0;">${orderedImageRefs.map((img, i) => `<li>Image ${i + 1}${img.isKeyImage ? " (KEY)" : ""}: ${escHtml(img.description)}</li>`).join("")}</ul>`
    : "";

  return `<div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111;max-width:720px;margin:0 auto;">
    ${headerHtml}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h2 style="text-align:center;text-decoration:underline;font-size:15px;margin:8px 0;break-after:avoid-page;page-break-after:avoid;"><strong>${escHtml(opts.studyName)}</strong></h2>
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeading("Technique", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(opts.technique)}</p>
    ${opts.clinicalHistory ? `<h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeading("Clinical History", hc)}</u></h3><p style="margin:0 0 ${sp};">${escHtml(opts.clinicalHistory)}</p>` : ""}
    <hr style="border:none;border-top:2px solid #000;margin:6px 0;" />
    <h3 style="${hStyle(`${sp} 0 ${sp}`)}"><u>${fmtHeading("Findings / Observation", hc)}</u></h3>
    ${findingsHtml}
    ${imagesHtml}
    <h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeading("Impression", hc)}</u></h3>
    ${impressionHtml}
    <h3 style="${hStyle(`${sp2} 0 ${sp}`)}"><u>${fmtHeading("Recommendation", hc)}</u></h3>
    <p style="margin:0 0 ${sp};">${escHtml(opts.recommendation || "Please correlate with clinical findings.")}</p>
    <hr style="border:none;border-top:1px solid #999;margin:${sp2} 0 4px;" />
    <p style="font-size:11px;color:#666;font-style:italic;margin:0;">Please correlate with clinical history and findings. Report issued by authorized radiologist only.</p>
  </div>`.trim();
}

// Static command-palette entries (PR #77). Actions route through the workspace's
// EXISTING handlers / command dispatcher (see runPaletteCommand) — no new logic.
// The id suffix after "command:" / "setting:" is the action / route.
const PALETTE_COMMANDS: PaletteItem[] = [
  { id: "command:generate-impression", kind: "command", title: "Generate Impression", subtitle: "AI draft from current findings", keywords: "ai impression summary" },
  { id: "command:save", kind: "command", title: "Save Draft", keywords: "store persist" },
  { id: "command:finalize", kind: "command", title: "Finalize Report", keywords: "sign submit complete" },
  { id: "command:clear-findings", kind: "command", title: "Clear Findings", keywords: "reset empty remove" },
  { id: "command:open-viewer", kind: "command", title: "Open Viewer", keywords: "dicom pacs images" },
  { id: "command:focus-findings", kind: "command", title: "Focus Findings", keywords: "cursor edit" },
  { id: "command:focus-impression", kind: "command", title: "Focus Impression", keywords: "cursor edit" },
  { id: "command:next", kind: "command", title: "Next Study", keywords: "navigate forward" },
  { id: "command:previous", kind: "command", title: "Previous Study", keywords: "navigate back" },
  { id: "command:new-brain-report", kind: "command", title: "New Brain Report", keywords: "create worklist mri ct" },
  { id: "command:new-ls-report", kind: "command", title: "New LS Spine Report", keywords: "create worklist lumbar" },
  { id: "command:compare-previous", kind: "command", title: "Compare with previous study", subtitle: "Open the prior-study comparison", keywords: "prior previous comparison interval change longitudinal" },
];
const PALETTE_SETTINGS: PaletteItem[] = [
  { id: "setting:/settings/radiology-quick-select", kind: "setting", title: "Settings — Radiology Quick Select", subtitle: "Findings, structured questions, protocols, chips", keywords: "configure structured questions defaults" },
  { id: "setting:/settings", kind: "setting", title: "Settings — All", keywords: "configure preferences" },
];

// Item 1 — default Recommendation / Advice quick chips, used when the
// admin-editable `report_recommendation_chips` pacs setting is unset or
// malformed. Clicking a chip merges its text into the Recommendation field.
const DEFAULT_RECOMMENDATION_CHIPS: string[] = [
  "Clinical correlation is recommended.",
  "Please correlate with clinical and laboratory findings.",
  "Correlation with previous imaging is advised.",
  "Follow-up imaging is advised as clinically indicated.",
  "Contrast-enhanced study is suggested for further characterisation.",
  "MRI is advised for further evaluation.",
  "Specialist / surgical consultation is recommended.",
  "No further imaging is required at present.",
];

// AI-draft-vs-final diff, embedded as a workspace tab (previously only the
// standalone ReportDiffViewer page). Reuses the existing
// /api/ai-reporting/report-diff/:worklistId endpoint, scoped to the open study.
function DiffList({ title, items, tone }: { title: string; items: string[]; tone: "add" | "del" | "same" }) {
  const toneCls =
    tone === "add" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
    : tone === "del" ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
    : "border-card-border bg-muted/30 text-muted-foreground";
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1">{title} <span className="opacity-60">({items.length})</span></div>
      {items.length === 0 ? (
        <div className="text-[10px] text-muted-foreground italic">None</div>
      ) : (
        <ul className="space-y-1">
          {items.map((t, i) => (
            <li key={i} className={`text-[11px] rounded border px-2 py-1 whitespace-pre-wrap ${toneCls}`}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportDiffTab({ worklistId }: { worklistId: number | null }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workspace-report-diff", worklistId],
    enabled: !!worklistId,
    queryFn: () => api.get<{
      aiDraft: string;
      finalReport: string;
      aiDraftStatus: string;
      diff: { addedByRadiologist: string[]; removedByRadiologist: string[]; unchanged: string[] };
    }>(`/api/ai-reporting/report-diff/${worklistId}`),
  });

  if (!worklistId) return <div className="p-3 text-xs text-muted-foreground">Open a study to compare its AI draft with your report.</div>;
  if (isLoading) return <div className="p-3 text-xs text-muted-foreground">Loading diff…</div>;
  if (isError || !data) return <div className="p-3 text-xs text-muted-foreground">No AI draft available to compare yet.</div>;
  if (!(data.aiDraft ?? "").trim()) return <div className="p-3 text-xs text-muted-foreground">No AI draft was generated for this study — nothing to compare.</div>;

  return (
    <div className="p-3 space-y-3 overflow-y-auto">
      <div className="text-[11px] text-muted-foreground">AI draft vs your report — what you added, removed, or kept.</div>
      <DiffList title="Added by you" items={data.diff.addedByRadiologist} tone="add" />
      <DiffList title="Removed from AI draft" items={data.diff.removedByRadiologist} tone="del" />
      <DiffList title="Unchanged" items={data.diff.unchanged} tone="same" />
    </div>
  );
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
  const finalizeFlow = useFinalizeFlow();
  const [readingSession, setReadingSession] = useState<ReadingSessionState>(() => loadReadingSession());
  const finalizeSignerRef = useRef<{ signatureId: number | null; notifyReferring: boolean }>({
    signatureId: null,
    notifyReferring: false,
  });

  // Worklist-first: empty workspace (no study) redirects to the worklist.
  useEffect(() => {
    if (studyId == null || !Number.isFinite(studyId) || studyId <= 0) {
      navigate("/radiology/worklist", { replace: true });
    }
  }, [studyId, navigate]);

  // ── Layout ────────────────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<RightTab>("templates");
  // Which sub-panel the embedded Knowledge tab shows (RadiologyKnowledgePanel is
  // parent-driven: it renders one of master/personal/packs/knowledge by activePanel).
  const [knowledgeSubPanel, setKnowledgeSubPanel] = useState<"knowledge" | "personal" | "master" | "packs">("knowledge");
  const [previewMode, setPreviewMode] = useState(false);
  // R1.1 — the preview shows the CANONICAL server-rendered document (shared
  // presentation layer) whenever a saved draft/report exists; the client-side
  // assembly remains only as the unsaved-draft fallback.
  const [serverPreviewHtml, setServerPreviewHtml] = useState<string | null>(null);
  // R1.4 — bumped on every successful save so the preview effect below
  // refetches even when draftId/linkedReportId are unchanged (the normal
  // case after the FIRST save: draftId stays the same stable number on
  // every subsequent save, so it alone never re-triggers the effect).
  // Previously the preview iframe silently froze on whatever HTML was
  // fetched at the last previewMode toggle, showing older content than the
  // draft the radiologist kept editing and re-saving — Print/PDF, which
  // fetch fresh on every click, would then show something the on-screen
  // preview never displayed.
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  // R1.1 — per-session layout preview (Classic vs Premium); print/preview
  // use ?template= so radiologists can compare without changing clinic settings.
  const { data: presentationTemplates } = useQuery<{ active: Partial<Record<string, string>> }>({
    queryKey: ["presentation-templates"],
    queryFn: () => api.get("/api/radiology/presentation-templates"),
    staleTime: 60_000,
  });
  const clinicReportLayout = quickSelectLayoutKey(presentationTemplates?.active?.standard);
  const [previewLayoutOverride, setPreviewLayoutOverride] = useState<ReportLayoutKey | null>(null);
  const previewLayout = previewLayoutOverride ?? clinicReportLayout;

  // ── Template selection ────────────────────────────────────────────────────
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  // PR B — USG Platform Consolidation: "General USG Reporting" in the sidebar
  // links here with `?modality=USG` so the SAME canonical workspace opens
  // pre-configured (Templates tab defaults to the USG catalog) instead of a
  // separate USG workspace. Raw value, not normalizeModality() — this filter
  // does an exact match against each template row's `modality` column
  // ("USG"/"MRI"/"CT"/"X-RAY", see modalityMap below), not the worklist's
  // "US"-bucket normalization.
  const [modalityFilter, setModalityFilter] = useState<string>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("modality");
    return fromUrl ? templateCatalogModality(fromUrl) : "";
  });

  const [clinicalHistory, setClinicalHistory] = useState("");
  const [technique, setTechnique] = useState("");
  const [findingsMap, setFindingsMap] = useState<Record<string, { normal: boolean; text: string }>>({});
  const [impression, setImpression] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [useStructured, setUseStructured] = useState(true);

  // ── Chocolate Box quick-macro engine (freeform findings only) ───────────
  const findingsTextareaRef = useRef<FindingsHighlightEditorHandle>(null);

  const isMobile = useIsMobile();

  // ── Workspace layout mode (Report Focus / Split View / Viewer Focus /
  // Dual Screen) — one persisted preference object per radiologist drives
  // which panels show, their widths, and left/right collapse state. Column
  // sizes and collapse state are tracked PER MODE, so switching modes and
  // switching back restores whatever the radiologist last left that specific
  // mode at, rather than one global collapse flag fighting across modes.
  // Replaces the old single `radiologyWorkspaceLeftPanelCollapsed` boolean —
  // one persisted object, not parallel state.
  const layoutUserKey = session?.user?.id ?? null;
  const [layoutPrefs, setLayoutPrefs] = useState<WorkspaceLayoutPrefs>(() => {
    const loaded = loadWorkspaceLayoutPrefs(layoutUserKey);
    // First-ever visit (nothing persisted yet) on a narrow screen: start
    // with the left panel collapsed so the report editor gets real width
    // immediately — mirrors the pre-redesign mobile default. Never overrides
    // an explicit stored preference.
    let hasStoredPrefs = true;
    try { hasStoredPrefs = localStorage.getItem(workspaceLayoutStorageKey(layoutUserKey)) != null; } catch { hasStoredPrefs = true; }
    if (!hasStoredPrefs && typeof window !== "undefined" && window.innerWidth < 768) {
      return {
        ...loaded,
        byMode: { ...loaded.byMode, [loaded.mode]: { ...loaded.byMode[loaded.mode], leftCollapsed: true } },
      };
    }
    return loaded;
  });
  useEffect(() => {
    saveWorkspaceLayoutPrefs(layoutUserKey, layoutPrefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutPrefs]);

  const layoutMode = layoutPrefs.mode;
  const currentModeLayout = layoutPrefs.byMode[layoutMode];
  const setLayoutMode = useCallback((mode: WorkspaceLayoutMode) => {
    setLayoutPrefs((prev) => (prev.mode === mode ? prev : { ...prev, mode }));
  }, []);
  function updateModeLayout(mode: WorkspaceLayoutMode, patch: Partial<ModeLayoutState>) {
    setLayoutPrefs((prev) => {
      const cur = prev.byMode[mode];
      const next = { ...cur, ...patch };
      if (next.left === cur.left && next.right === cur.right
        && next.leftCollapsed === cur.leftCollapsed && next.rightCollapsed === cur.rightCollapsed) {
        return prev; // no-op — avoids redundant re-renders/saves from idempotent library callbacks
      }
      return { ...prev, byMode: { ...prev.byMode, [mode]: next } };
    });
  }

  // Kept as `isLeftPanelCollapsed` (same name as before this redesign) so the
  // render logic and header toggle below need minimal changes — it now reads
  // from the per-mode layout instead of its own standalone state.
  const isLeftPanelCollapsed = currentModeLayout.leftCollapsed;
  // New (Phase 5) — the right contextual drawer previously had no collapse
  // control at all.
  const isRightPanelCollapsed = currentModeLayout.rightCollapsed;

  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // The embedded DICOM viewer's mount/unmount is driven ONLY by the layout
  // mode (Phase 2/4) — never by panel collapse state, which just controls
  // how much patient metadata is visible alongside it.
  const showEmbeddedViewer = shouldShowEmbeddedViewer(layoutMode);

  // ── Viewer focus mode ──────────────────────────────────────────────────
  // Clicking into the embedded WADO/OHIF viewer maximises image space: the
  // patient-demographics block (top of this left panel) collapses to a slim
  // strip, and the app's blue navigation sidebar minimises (via the decoupled
  // `care:viewer-focus` event that Layout listens for). Clicking back into the
  // report editor — or the strip's "Show details" — restores both. A ref backs
  // the boolean so the toggler is stable and never fires a redundant event.
  const [viewerFocusMode, setViewerFocusMode] = useState(false);
  const viewerFocusRef = useRef(false);
  const setViewerFocus = useCallback((on: boolean) => {
    if (viewerFocusRef.current === on) return;
    viewerFocusRef.current = on;
    setViewerFocusMode(on);
    try { window.dispatchEvent(new CustomEvent("care:viewer-focus", { detail: on })); } catch { /* SSR/no window */ }
  }, []);
  // Leave focus mode whenever the viewer isn't shown (mode switched to Report
  // Focus / Dual Screen) so the demographics + app sidebar can never get stuck
  // collapsed with no viewer to justify it.
  useEffect(() => {
    if (!showEmbeddedViewer) setViewerFocus(false);
  }, [showEmbeddedViewer, setViewerFocus]);
  // Restore the app sidebar if we unmount (navigate away) while focused.
  useEffect(() => () => {
    if (viewerFocusRef.current) {
      try { window.dispatchEvent(new CustomEvent("care:viewer-focus", { detail: false })); } catch { /* noop */ }
    }
  }, []);

  // ── Reporting focus chrome — collapse the bulky header/queue toolbar so the
  // Clinical History → Findings editor gets maximum vertical space. Persisted
  // per browser; defaults to collapsed on first visit.
  const [chromeCollapsed, setChromeCollapsed] = useState(() => {
    try { return localStorage.getItem(WORKSPACE_CHROME_COLLAPSED_KEY) !== "0"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(WORKSPACE_CHROME_COLLAPSED_KEY, chromeCollapsed ? "1" : "0"); } catch { /* noop */ }
  }, [chromeCollapsed]);
  const collapseReportingChrome = useCallback(() => setChromeCollapsed(true), []);
  const enterReportingFocusMode = useCallback(() => {
    setChromeCollapsed(true);
    leftPanelRef.current?.collapse();
    rightPanelRef.current?.collapse();
    updateModeLayout(layoutMode, { leftCollapsed: true, rightCollapsed: true });
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
  }, [layoutMode]);
  // Worklist → workspace handoff: ?focus=1 collapses chrome for immediate dictation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") !== "1") return;
    enterReportingFocusMode();
    params.delete("focus");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }, [studyId, enterReportingFocusMode]);
  // Minimise the app navigation sidebar while the radiologist is reporting.
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: true })); } catch { /* noop */ }
    return () => {
      try { window.dispatchEvent(new CustomEvent("care:workspace-focus", { detail: false })); } catch { /* noop */ }
    };
  }, []);

  // Reposition the two resizable panels whenever the mode changes (imperative
  // — the panels stay mounted across mode switches so the embedded viewer
  // never remounts just because the mode's proportions changed). Live drag
  // and manual collapse/expand are handled by the Resizable* callbacks near
  // the 3-column body, and intentionally do NOT run through this effect.
  useEffect(() => {
    if (currentModeLayout.leftCollapsed) leftPanelRef.current?.collapse();
    else { leftPanelRef.current?.expand(); leftPanelRef.current?.resize(currentModeLayout.left); }
    if (currentModeLayout.rightCollapsed) rightPanelRef.current?.collapse();
    else { rightPanelRef.current?.expand(); rightPanelRef.current?.resize(currentModeLayout.right); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode]);

  function handleWorkspacePanelLayout(sizes: number[]) {
    const [leftSize, , rightSize] = sizes;
    if (typeof leftSize !== "number" || typeof rightSize !== "number") return;
    setLayoutPrefs((prev) => {
      const mode = prev.mode;
      const cur = prev.byMode[mode];
      const next = { ...cur };
      // Only a panel's OWN drag while expanded counts as a width preference —
      // collapsed panels report their tiny snap size through this same
      // callback, which must never overwrite the remembered expanded width.
      if (!cur.leftCollapsed) next.left = clampLeftPct(leftSize);
      if (!cur.rightCollapsed) next.right = clampRightPct(rightSize);
      if (next.left === cur.left && next.right === cur.right) return prev;
      return { ...prev, byMode: { ...prev.byMode, [mode]: next } };
    });
  }

  // ── Cockpit→Workspace merge ────────────────────────────────────────────────
  // G1: client-side role gate on the Sign action (defense-in-depth + clearer
  // UX than a live button that only fails server-side). Reuses worklistRoleView
  // (same shared helper the Cockpit and Worklist already use).
  const canSign = useMemo(() => {
    const view = worklistRoleView(normalizeRole(session?.user?.role ?? ""));
    return view === "radiologist" || view === "owner";
  }, [session]);

  // E3: personal macro live "/shortcut" expansion in the Findings text. Reuses
  // the SAME user-report-preferences source PreferencesPanel already reads — no
  // new backend surface, complements (does not duplicate) click-to-insert.
  const { data: userReportPrefs } = useQuery<any>({
    queryKey: ["user-report-preferences"],
    queryFn: () => api.get<any>("/api/radiology/user-report-preferences"),
    enabled: !!session?.user?.id,
    staleTime: 300_000,
  });
  const personalMacros = useMemo<{ name: string; content: string }[]>(() => {
    if (!userReportPrefs?.personalMacros) return [];
    try {
      const parsed = JSON.parse(userReportPrefs.personalMacros);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [userReportPrefs]);
  const expandFindingsMacros = (val: string): string => {
    let replaced = val;
    for (const m of personalMacros) {
      if (m?.name && replaced.includes(`/${m.name}`)) {
        replaced = replaced.replaceAll(`/${m.name}`, m.content);
        toast({ title: "Macro applied", description: `Expanded /${m.name}` });
      }
    }
    return replaced;
  };

  // D3: last dictated phrase, fed to MeasurementAssistantPanel so its existing
  // regex parser (midline shift, tumor axes, BPD/AC/FL…) can autofill fields.
  const [lastVoiceCommand, setLastVoiceCommand] = useState("");

  // D2: auto-bridge calculated measurements into Findings/Impression (the
  // MeasurementAssistantPanel is already mounted here; only the optional
  // onMeasurementsChange callback was unused). Ported from the Cockpit.
  const handleMeasurementsApplied = (text: string, calcs: Record<string, any>) => {
    setRawFindings((prev) => {
      const base = prev.split("MEASUREMENTS LOG:")[0].trim();
      return base ? `${base}\n\n${text}` : text;
    });
    setImpression((prev) => {
      const next = [...prev.filter(Boolean)];
      const pushUnique = (item: string) => { if (!next.includes(item)) next.push(item); };
      if (calcs.tumorVolume && calcs.tumorVolume > 10)
        pushUnique(`Large space-occupying lesion with volume of ${calcs.tumorVolume} cc.`);
      if (calcs.evansIndex && calcs.evansIndex > 0.3)
        pushUnique(`Evans Index is ${calcs.evansIndex}, consistent with ventriculomegaly/hydrocephalus.`);
      if (calcs.slipPct && calcs.slipPct > 25)
        pushUnique(`Spondylolisthesis (${calcs.slipGrade}).`);
      if (calcs.efw)
        pushUnique(`Estimated Fetal Weight is ${calcs.efw} g.`);
      return next;
    });
  };

  // ── Report meta ───────────────────────────────────────────────────────────
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [reportStatus, setReportStatus] = useState<string>("DRAFT");
  // F5 (Cockpit→Workspace merge): critical-result communication checklist —
  // ACR-style documentation that an actionable/critical finding was actually
  // communicated to the referring clinician. Unlike the Cockpit (where this
  // state was never sent to the server), it's persisted via the finalize
  // auditDetails payload — see F7 below.
  const [checklistComm, setChecklistComm] = useState({ phoned: false, annotated: false, dispatched: false });

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
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
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

  // ── M1.6A — assignment-aware queue scope + study lock ────────────────────
  const [queueScope, setQueueScope] = useState<QueueScope>(() => {
    try {
      return parseQueueScope(window.localStorage.getItem("radiology_queue_scope"));
    } catch { return "all"; }
  });

  // M1.6B1 — assignable radiologists (By-Radiologist scope + display names).
  const { data: radiologistsData } = useQuery<{ success: boolean; radiologists: Array<{ id: number; name: string; role: string }> }>({
    queryKey: ["radiology-radiologists"],
    queryFn: () => api.get("/api/radiology/radiologists"),
    staleTime: 5 * 60_000,
  });
  const radiologists = radiologistsData?.radiologists ?? [];
  function changeQueueScope(next: QueueScope) {
    setQueueScope(next);
    try { window.localStorage.setItem("radiology_queue_scope", next); } catch { /* private mode */ }
  }

  // ── M1.5 — workflow controller (queue, history, parked, transitions) ─────
  const workflow = useReportingWorkflow(studyId, {
    scope: queueScope,
    myUserId: session?.user.id ?? null,
    myName: session?.user.name ?? null,
  });

  // ── A1 (Cockpit→Workspace merge): free-text + modality filter over the JUMP
  // dropdown only. Deliberately NOT applied to Next/Previous/park — those stay
  // scope-based so the CURRENT study never drops out of the queue (which would
  // corrupt position/history). This just lets a radiologist find-and-jump to a
  // study by patient/accession/modality without leaving the report. State is
  // distinct from the template `modalityFilter` (which filters the picker).
  const [queueFilterText, setQueueFilterText] = useState("");
  const [queueModalityFilter, setQueueModalityFilter] = useState("all");
  // Date-range filter over the jump list — same IST-calendar-day presets as
  // the PACS Worklist page (Today/Yesterday/Day Before/This Week/This Month).
  const [queueDateFrom, setQueueDateFrom] = useState("");
  const [queueDateTo, setQueueDateTo] = useState("");
  function setQueueDatePreset(from: string, to: string) {
    setQueueDateFrom(from);
    setQueueDateTo(to);
  }
  const jumpQueue = useMemo(() => {
    const q = queueFilterText.trim().toLowerCase();
    const mod = queueModalityFilter;
    return workflow.queue.filter((s) => {
      if (mod !== "all") {
        const m = (s.modality ?? "").toUpperCase();
        const matchesModality = mod === "US"
          ? isUltrasoundModality(s.modality)
          : m.startsWith(mod);
        if (!matchesModality) return false;
      }
      if (queueDateFrom || queueDateTo) {
        const d = s.createdAt ? toISTDateStr(s.createdAt) : null;
        if (!d) return false;
        if (queueDateFrom && d < queueDateFrom) return false;
        if (queueDateTo && d > queueDateTo) return false;
      }
      if (q) {
        const hay = `${s.patientName ?? ""} ${s.modality ?? ""} ${s.accessionNumber ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [workflow.queue, queueFilterText, queueModalityFilter, queueDateFrom, queueDateTo]);

  // Claim the current study on entry (visible in the status bar — never
  // silent), heartbeat while held, stop after finalize. Server expiry stays
  // authoritative; losing the lock never touches local text.
  const studyLock = useStudyLock(studyId, { enabled: reportStatus !== "FINAL" });
  const lockedByOther = studyLock.status === "locked-by-other";
  const lockLost = studyLock.status === "expired-lost";
  /** Viewer launch state mirrored up from OpenStudyPanel: transitions are
   *  blocked while a launch is in flight, and the status bar shows the last
   *  outcome. */
  const [viewerLaunch, setViewerLaunch] = useState<{ busy: boolean; lastResult: StudyLaunchResult | null }>({
    busy: false,
    lastResult: null,
  });

  // Dual Screen mode relies entirely on the EXISTING study-launch path above
  // (Open Study / OHIF / Weasis, already popup-safe and already reported
  // through viewerLaunch by OpenStudyPanel) — no separate window.open logic.
  // If the browser blocked that popup, fall back to Split View so the
  // radiologist still has a working in-page viewer instead of a dead end.
  useEffect(() => {
    if (layoutMode !== "dualScreen") return;
    if (viewerLaunch.busy || !viewerLaunch.lastResult) return;
    if (!viewerLaunch.lastResult.success && viewerLaunch.lastResult.errorCode === "POPUP_BLOCKED") {
      setLayoutMode(fallbackModeWhenPopupBlocked(layoutMode));
      toast({
        title: "Popup blocked — showing Split View",
        description: "Allow popups for this site to use Dual Screen, then open the study again.",
        variant: "destructive",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode, viewerLaunch]);

  // ── M1.6B2 — voice layer wiring ───────────────────────────────────────────
  /** Live handle onto the embedded viewer (null unless a study is rendered) —
   *  voice viewer commands call the SAME setters the toolbar buttons use. */
  const embeddedViewerRef = useRef<EmbeddedViewerHandle | null>(null);
  /** Voice "search finding <term>" → the panel adopts this as its search text. */
  const [qsExternalSearch, setQsExternalSearch] = useState<{ seq: number; term: string } | null>(null);
  /** Spoken park reason: non-null makes parkCurrentStudy skip its prompt
   *  (voice supplies "" when no reason was spoken). Cleared after dispatch. */
  const voiceParkReasonRef = useRef<string | null>(null);
  // Same query key as RadiologySettingsCenter — one cache entry.
  const { data: pacsSettingsRows } = useQuery<Array<{ id: number; key: string; value: string | null; category: string }>>({
    queryKey: ["pacs-settings"],
    queryFn: () => api.get("/api/radiology/pacs-settings"),
    staleTime: 5 * 60_000,
  });
  const clinicVoiceSettings = useMemo(() => parseVoiceSettings(pacsSettingsRows), [pacsSettingsRows]);
  // M1.6B3 — the caller's own overrides layered over the clinic defaults
  // (tighten-only merge rules live in lib/voiceTranscription).
  const { data: voiceUserPrefsRaw } = useQuery<unknown>({
    queryKey: ["voice-user-preferences"],
    queryFn: () => api.get("/api/radiology/report-generator/voice-preferences"),
    enabled: clinicVoiceSettings.enabled,
    staleTime: 5 * 60_000,
  });
  const voiceSettings = useMemo(
    () => mergeVoiceSettings(clinicVoiceSettings, voiceUserPrefsRaw ? parseVoiceUserPrefs(voiceUserPrefsRaw) : null),
    [clinicVoiceSettings, voiceUserPrefsRaw],
  );
  const { data: voiceCapabilities = { server: false, local: false } } = useQuery<TranscribeCapabilities>({
    queryKey: ["voice-transcribe-status"],
    queryFn: fetchTranscribeCapabilities,
    enabled: voiceSettings.enabled,
    staleTime: 5 * 60_000,
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
    applyManyRendered([{ id, next }]);
  }

  /** Apply several rendered-abnormality transitions over a SINGLE report-text
   *  state, committing once. Needed when one action changes more than one
   *  finding (conflict-group eviction), because each applyRenderedTransition
   *  reads the current state — looping the single version would let the last
   *  write clobber the earlier ones. */
  function applyManyRendered(changes: Array<{ id: number; next: RenderedAbnormality | null }>) {
    let state = { rawFindings, impression, technique, recommendation };
    for (const { id, next } of changes) {
      const prev = insertedTextRef.current.get(id);
      state = applyRenderedTransition(state, prev, next);
      if (next) insertedTextRef.current.set(id, next);
      else insertedTextRef.current.delete(id);
    }
    setRawFindings(state.rawFindings);
    setImpression(state.impression);
    setTechnique(state.technique);
    setRecommendation(state.recommendation);
  }

  // ── Smart Findings engine (Phase 6) ─────────────────────────────────────────
  // In structured mode a finding flips its mapped template section from the
  // baseline normal to the finding text (replace, anatomical order, conflict
  // resolution — all inherent to findingsMap). In free-text mode it appends to
  // rawFindings exactly as before. Reuses findingsMap + renderAbnormality; no
  // second engine.
  const OTHER_SECTION = "Additional Observations";
  // Per-finding text last contributed to a section, so a change can exact-remove
  // the old contribution (leaving manual edits intact) and merge the new one.
  const sectionContribRef = useRef<Map<number, { section: string; text: string }>>(new Map());

  // ── Structured Finding Assistant (Phase 6.2) ────────────────────────────────
  // A finding with configured questions (questionsJson) opens a compact dialog
  // to collect only the values it needs; the finding/impression text is then
  // generated from its {key} / [optional clause] templates and flows through the
  // SAME Smart Findings Engine (applySectionContribution / applyManyRendered).
  // No second reporting engine — this only decides WHAT text a finding renders.
  //
  // The applied per-finding values live in a ref (read mid-handler like
  // insertedTextRef / sectionContribRef) and are also persisted inside each
  // finding's params so a reloaded draft regenerates the exact same text.
  const structuredValuesRef = useRef<Map<number, Record<string, string>>>(new Map());
  // Last value chosen per question key this session → the next dialog pre-fills
  // it ("remember previous selection" + smart defaults). Pre-fill only; always
  // confirmed/overridable in the dialog, so it is intentionally NOT reset on a
  // study switch.
  const sessionMemoryRef = useRef<Record<string, string>>({});
  // The finding whose compact dialog is open (null = none); `editing` = already
  // selected (shows a Remove button and pre-fills its current values).
  const [structuredDialog, setStructuredDialog] = useState<{ finding: QuickFinding; editing: boolean } | null>(null);

  /** A finding is "structured" when it declares questions. */
  function findingQuestions(f: QuickFinding) {
    return parseQuestions(f.questionsJson);
  }

  /** True while the structured report (with a loaded template) is the active
   *  surface — the only mode where findings drive sections. */
  function smartModeActive(): boolean {
    return useStructured && !!selectedTemplate;
  }

  /** The findingsMap section a finding drives: its configured anatomical section
   *  (with {key} resolved from the finding's structured values, so one generic
   *  "Disc Bulge" maps to the selected level's section) or a shared catch-all,
   *  so an unmapped finding is still shown and ordered rather than vanishing
   *  into hidden free text. */
  function sectionForFinding(f: QuickFinding): string {
    const raw = (f.anatomicalSection ?? "").trim();
    const values = structuredValuesRef.current.get(f.id);
    const resolved = values ? resolveSection(raw, values).trim() : raw;
    if (!resolved) return OTHER_SECTION;
    // Keyword-match the (possibly loosely-labelled) section to the loaded
    // template's real region labels, so near-misses — level spellings like
    // "L4/5", catalog category names, technician typos — still flip the
    // intended region instead of scattering into a stray section.
    const matched = matchTemplateSection(resolved, currentBaseline().map((b) => b.label));
    return matched ?? resolved;
  }

  /** One finding's rendered report sections. A structured finding (has questions
   *  AND collected values) generates from its {key}/[clause] templates; every
   *  other finding renders through the property-chip engine exactly as before.
   *  Both return the identical RenderedAbnormality shape, so the downstream
   *  Smart Findings Engine is untouched. */
  function renderFinding(f: QuickFinding, inst: AbnormalityInstance): RenderedAbnormality {
    const values = structuredValuesRef.current.get(f.id);
    if (values && findingQuestions(f).length > 0) {
      const g = generateStructuredFinding(f, values);
      return { finding: g.finding, impression: g.impression, technique: g.technique, recommendation: g.recommendation };
    }
    return renderAbnormality(f, inst);
  }

  /** The loaded template's ordered {label, normal} baseline sections. */
  function currentBaseline(): Array<{ label: string; normal: string }> {
    return selectedTemplate ? parseSectionsJson(selectedTemplate.sectionsJson).findingsItems : [];
  }

  /** Apply ONE finding's structured contribution to its section: exact-remove
   *  its previous text (so manual edits survive — removeBlock no-ops on edited
   *  text) and dedupe-merge its new text; if it moved sections, clear the old
   *  one. Empty section → restore the template normal, or drop a created
   *  catch-all. Only the affected section(s) change; every other section (and
   *  every manual edit elsewhere) is untouched. `selected=false` removes it. */
  function applySmartFinding(f: QuickFinding, inst: AbnormalityInstance, selected: boolean) {
    const baseline = currentBaseline();
    const normalFor = (label: string) => baseline.find((b) => b.label === label)?.normal;
    const section = sectionForFinding(f);
    const prev = sectionContribRef.current.get(f.id) ?? null;
    const nextText = selected ? renderFinding(f, inst).finding.trim() : "";
    if (selected && nextText) sectionContribRef.current.set(f.id, { section, text: nextText });
    else sectionContribRef.current.delete(f.id);
    setFindingsMap((map) => {
      const next = { ...map };
      const secs = new Set<string>([section]);
      if (prev && prev.section !== section) secs.add(prev.section);
      for (const sec of secs) {
        const prevForSec = prev && prev.section === sec ? prev.text : null;
        const nextForSec = sec === section && nextText ? nextText : null;
        const updated = applySectionContribution(next[sec], normalFor(sec), prevForSec, nextForSec);
        if (updated) next[sec] = updated;
        else delete next[sec];
      }
      return next;
    });
  }

  /** Seed sectionContribRef from restored selections so a later deselect can
   *  exact-remove the finding's section text. Mirrors seedRestoredInsertedText. */
  function seedRestoredSectionContribs(findings: QuickFinding[], ids: Set<number>, instances: Map<number, AbnormalityInstance>) {
    const byId = new Map(findings.map((f) => [f.id, f]));
    for (const id of ids) {
      const f = byId.get(id);
      if (!f) continue;
      // renderFinding regenerates the exact structured text when this finding's
      // values were restored (below), so a later deselect exact-removes it.
      const text = renderFinding(f, instances.get(id) ?? EMPTY_INSTANCE).finding.trim();
      if (text) sectionContribRef.current.set(id, { section: sectionForFinding(f), text });
    }
  }

  /** Rendered abnormality for a finding. In smart mode the finding text is
   *  routed to its section (not free text), so blank the `finding` field here
   *  while still letting impression/technique/recommendation merge as usual. */
  function renderForReport(f: QuickFinding, inst: AbnormalityInstance): RenderedAbnormality {
    const r = renderFinding(f, inst);
    return smartModeActive() ? { ...r, finding: "" } : r;
  }

  /** Current findings as readable text for the AI Impression prompt — the
   *  abnormal structured sections in anatomical order (or the free text). Keeps
   *  the AI input clean instead of raw JSON. */
  function findingsAsText(): string {
    if (useStructured) {
      const parts = Object.entries(findingsMap)
        .filter(([, s]) => !s.normal && s.text.trim())
        .map(([label, s]) => `${label}: ${s.text.trim()}`);
      return parts.length ? parts.join("\n") : "All imaged structures are within normal limits.";
    }
    return rawFindings;
  }

  function handleQuickToggle(f: QuickFinding, nowSelected: boolean) {
    if (isLocked) return;
    if (nowSelected) lastToggledFindingRef.current = f;

    // Structured findings: guarantee collected values exist before rendering so
    // ANY selection path (dialog, voice, keyboard) produces real text rather
    // than raw {key} templates. The dialog sets these first; a direct toggle
    // falls back to session memory + smart defaults. Deselect clears them.
    const questions = findingQuestions(f);
    if (nowSelected && questions.length > 0 && !structuredValuesRef.current.has(f.id)) {
      structuredValuesRef.current.set(f.id, structuredInitialValues(questions, sessionMemoryRef.current));
    }
    if (!nowSelected) structuredValuesRef.current.delete(f.id);

    // Conflict groups: selecting a finding deselects any same-group sibling.
    const evictIds = nowSelected
      ? conflictingSelections(
          { id: f.id, studyType: f.studyType, conflictGroup: f.conflictGroup ?? "" },
          [...selectedQuickIds]
            .map((id) => findingById.get(id))
            .filter((x): x is QuickFinding => !!x)
            .map((x) => ({ id: x.id, studyType: x.studyType, conflictGroup: x.conflictGroup ?? "" })),
        )
      : [];

    let nextSelected = toggleQuickSelection(selectedQuickIds, f.id, nowSelected);
    let nextInstances = nowSelected
      ? setQuickInstance(quickInstances, f.id, seedQuickInstance(quickSide))
      : deleteQuickInstance(quickInstances, f.id);
    for (const cid of evictIds) {
      nextSelected = toggleQuickSelection(nextSelected, cid, false);
      nextInstances = deleteQuickInstance(nextInstances, cid);
      structuredValuesRef.current.delete(cid);
    }
    setSelectedQuickIds(nextSelected);
    setQuickInstances(nextInstances);

    // Impression / technique / recommendation contributions (+ evictions),
    // committed over one state so nothing clobbers.
    const changes: Array<{ id: number; next: RenderedAbnormality | null }> = [
      { id: f.id, next: nowSelected ? renderForReport(f, nextInstances.get(f.id) ?? EMPTY_INSTANCE) : null },
    ];
    for (const cid of evictIds) changes.push({ id: cid, next: null });
    applyManyRendered(changes);

    // Structured findings: apply each finding's section contribution.
    if (smartModeActive()) {
      applySmartFinding(f, nextInstances.get(f.id) ?? EMPTY_INSTANCE, nowSelected);
      for (const cid of evictIds) {
        const cf = findingById.get(cid);
        if (cf) applySmartFinding(cf, EMPTY_INSTANCE, false);
      }
    }
  }

  /** Property chip changed → re-render this finding and refresh its section /
   *  free-text contribution instantly (no AI). */
  function handleInstanceUpdate(f: QuickFinding, patch: Partial<AbnormalityInstance>) {
    const inst = patchQuickInstance(quickInstances.get(f.id), quickSide, patch);
    const nextInstances = setQuickInstance(quickInstances, f.id, inst);
    setQuickInstances(nextInstances);
    applyManyRendered([{ id: f.id, next: renderForReport(f, inst) }]);
    if (smartModeActive()) applySmartFinding(f, inst, true);
  }

  // ── Structured Finding Assistant — dialog orchestration ─────────────────────
  /** Entry point for a Quick Finding click (strip + panel). Fewest clicks: a
   *  finding with NO questions inserts/removes immediately; a finding WITH
   *  questions opens the compact dialog to collect only what it needs. */
  function handleFindingClick(f: QuickFinding) {
    if (isLocked) return;
    if (findingQuestions(f).length === 0) {
      handleQuickToggle(f, !selectedQuickIds.has(f.id));
      return;
    }
    setStructuredDialog({ finding: f, editing: selectedQuickIds.has(f.id) });
  }

  /** Pre-fill for the open dialog: an already-selected finding shows its current
   *  values; a fresh one shows session memory + smart defaults. */
  function structuredDialogInitialValues(dlg: { finding: QuickFinding; editing: boolean }): Record<string, string> {
    const questions = findingQuestions(dlg.finding);
    const existing = structuredValuesRef.current.get(dlg.finding.id);
    const memory = dlg.editing && existing ? existing : sessionMemoryRef.current;
    return structuredInitialValues(questions, memory);
  }

  /** Apply the dialog: remember the values for next time, store them for this
   *  finding, then select it (or re-render in place if already selected) so the
   *  generated text flows through the EXISTING Smart Findings Engine. */
  function applyStructuredDialog(values: Record<string, string>) {
    const dlg = structuredDialog;
    if (!dlg) return;
    const f = dlg.finding;
    sessionMemoryRef.current = { ...sessionMemoryRef.current, ...values };
    structuredValuesRef.current.set(f.id, values);
    setStructuredDialog(null);
    if (!selectedQuickIds.has(f.id)) {
      handleQuickToggle(f, true); // full select path — renderFinding now uses these values
    } else {
      // Already selected: re-render impression + section with the new values.
      applyManyRendered([{ id: f.id, next: renderForReport(f, EMPTY_INSTANCE) }]);
      if (smartModeActive()) applySmartFinding(f, EMPTY_INSTANCE, true);
    }
  }

  /** Remove a structured finding from the dialog (deselect via the normal path,
   *  which exact-removes its section + impression text). */
  function removeStructuredFinding(f: QuickFinding) {
    setStructuredDialog(null);
    if (selectedQuickIds.has(f.id)) handleQuickToggle(f, false);
    else structuredValuesRef.current.delete(f.id);
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
  // The exact Technique text this workspace last inserted from a protocol.
  // Lets us tell "unedited protocol text" (safe to replace silently) from
  // "the radiologist has since edited Technique" (must confirm before we
  // overwrite it). Never persisted — reset when a protocol replaces it.
  const lastInsertedTechniqueRef = useRef<string | null>(null);
  // When a protocol switch would overwrite manually-edited Technique text, we
  // stash the pending protocol here and show a Replace / Keep / Cancel prompt.
  const [protocolReplacePrompt, setProtocolReplacePrompt] = useState<QuickProtocol | null>(null);

  /** Apply a protocol's side effects. `replaceTechnique` gates the (possibly
   *  destructive) Technique overwrite; Recommendation is always a safe merge. */
  function applyProtocol(protocol: QuickProtocol | null, replaceTechnique: boolean) {
    setActiveProtocol(protocol);
    if (!protocol) return;
    if (protocol.recommendationText) setRecommendation((prev) => mergeBlock(prev, protocol.recommendationText));
    if (protocol.techniqueText && replaceTechnique) {
      setTechnique(protocol.techniqueText);
      lastInsertedTechniqueRef.current = protocol.techniqueText;
    }
  }

  /** Shared entry point for BOTH protocol dropdowns (right Quick panel and the
   *  one beside Technique). They write the SAME activeProtocol state and route
   *  through the SAME insertion logic — no duplicate selection value, no
   *  duplicate insertion path. Prompts before replacing manually-edited
   *  Technique text (Phase 8 safety rule). */
  function requestProtocolChange(protocol: QuickProtocol | null) {
    // Clearing the protocol, or one with no technique text, never risks a
    // manual-edit overwrite — apply immediately.
    if (!protocol || !protocol.techniqueText) {
      applyProtocol(protocol, false);
      return;
    }
    const current = technique.trim();
    const lastInserted = (lastInsertedTechniqueRef.current ?? "").trim();
    const manuallyEdited = current !== "" && current !== lastInserted;
    if (manuallyEdited) {
      setProtocolReplacePrompt(protocol); // ask Replace / Keep Current Text / Cancel
      return;
    }
    // Technique is empty or still exactly the last protocol's text — safe to fill.
    applyProtocol(protocol, true);
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

  // R2.0 — USG measurement review panel "Insert" / "Approve & Insert": the
  // same upsert-by-label pattern as handleSmartMeasurement above, just keyed
  // by (label, value, unit) instead of a "{value}" template string.
  function handleUsgMeasurementInsert(label: string, value: string, unit?: string) {
    // R2.0 — USG panel values are often non-numeric free text (Placenta
    // Position, Uterus Size with descriptors, Fetal Presentation, ...) and
    // always form one whole "Label: value" line, so this upserts by label
    // prefix (upsertLabeledLine) rather than the numeric-only linked-
    // variable matcher handleSmartMeasurement/upsertMeasurement uses for
    // Quick Select's embedded-in-sentence measurements.
    const filledValue = unit ? `${value} ${unit}` : value;
    setRawFindings((prev) => {
      const { text, updated } = upsertLabeledLine(prev, label, filledValue);
      if (updated) toast({ title: "Measurement updated", description: "Existing value replaced in the report." });
      return text;
    });
  }

  /** CARE USG Companion (Phase 2) — apply a deterministic auto-population plan
   *  through the EXISTING setters/merge primitives. Fill-empty for
   *  Technique/Impression, dedupe-merge for Findings-normals/Recommendation,
   *  upsert for machine measurements — never overwriting manual text. The
   *  applied blocks feed the provenance ledger + edit-tracking. */
  function handleCompanionAutoPopulate(plan: AutoPopulatePlan) {
    if (isLocked) return;
    let applied = 0;
    for (const b of plan.blocks) {
      if (b.section === "technique") setTechnique((prev) => (prev.trim() ? prev : b.text));
      else if (b.section === "findings" && b.kind === "machine" && b.label && b.value) handleUsgMeasurementInsert(b.label, b.value, b.unit);
      else if (b.section === "findings") setRawFindings((prev) => mergeBlock(prev, b.text));
      else if (b.section === "recommendation") setRecommendation((prev) => mergeBlock(prev, b.text));
      else if (b.section === "impression") setImpression((prev) => (prev.filter(Boolean).length ? prev : [b.text]));
      applied++;
    }
    // Machine fill is part of the clean baseline — subsequent edits then register
    // as real changes (and as "Edited" in the provenance ledger).
    requestBaselineRecapture();
    setCompanionLedger(plan.blocks);
    if (applied > 0) toast({ title: "Report auto-populated", description: `${applied} section(s) filled from machine data — review before finalizing.` });
  }

  // R2.0 — apply a practical USG template (Whole Abdomen/KUB/Pregnancy/
  // Doppler/Breast/Thyroid/...): calls the existing confidence-gated
  // auto-generate endpoint (fills ONLY from approved measurements; low-
  // confidence values become an explicit "[___ low confidence – verify]"
  // placeholder; unmeasured fields stay blank for manual entry — see
  // usgReportTemplates.ts) and applies the result as a full manual apply,
  // same semantics as picking a structured template by hand.
  const [applyingUsgTemplateId, setApplyingUsgTemplateId] = useState<string | null>(null);
  async function applyUsgTemplate(templateId: string) {
    if (!entry?.studyInstanceUID || isLocked) return;
    setApplyingUsgTemplateId(templateId);
    try {
      const out = await api.post<{
        content: string; filledFieldCount: number; skippedLowConfidenceCount: number; hasApprovedMeasurements: boolean;
      }>("/api/usg-reports/auto-generate", { templateId, studyInstanceUID: entry.studyInstanceUID });
      templateApplySourceRef.current = "manual";
      setSelectedTemplateId(null);
      setRawFindings(out.content);
      toast({
        title: "USG template applied",
        description: out.hasApprovedMeasurements
          ? `${out.filledFieldCount} field(s) filled from approved measurements${out.skippedLowConfidenceCount ? `, ${out.skippedLowConfidenceCount} flagged low-confidence for review` : ""}.`
          : "No approved measurements yet — template inserted blank for manual entry.",
      });
    } catch {
      toast({ title: "Failed to apply USG template", variant: "destructive" });
    } finally {
      setApplyingUsgTemplateId(null);
    }
  }

  // R2.0 PCPNDT — "Review & Map to Form F": Form F must NEVER be auto-filled.
  // This reads the current APPROVED usg_measurements row (never a
  // pending_review/rejected one) and hands its raw biometry values to Form F
  // as plain reference text via a query param — deliberately with no
  // "Normal"/"Abnormal" categorization guessed on this end, so the
  // radiologist must still explicitly choose the result category and type
  // any abnormality detail themselves on the Form F page before saving.
  const [mappingToFormF, setMappingToFormF] = useState(false);
  async function reviewAndMapToFormF() {
    if (!entry?.studyInstanceUID) return;
    setMappingToFormF(true);
    try {
      const rows = await api.get<Array<Record<string, unknown>>>(
        `/api/usg-extraction/study/${encodeURIComponent(entry.studyInstanceUID)}`,
      );
      const m = rows?.[0];
      if (!m || m.status !== "approved") {
        toast({
          title: "No approved measurements yet",
          description: "Approve the extracted measurements in the Measure tab before mapping to Form F.",
          variant: "destructive",
        });
        return;
      }
      const parts: string[] = [];
      const add = (label: string, v: unknown) => { if (v) parts.push(`${label}: ${v}`); };
      add("GA", m.ga); add("CRL", m.crl); add("EDD", m.edd); add("FHR", m.fhr);
      add("BPD", m.bpd); add("HC", m.hc); add("AC", m.ac); add("FL", m.fl); add("EFW", m.efw);
      add("Placenta", m.placentaPosition); add("Liquor/AFI", m.liquorAfi);
      add("Presentation", m.fetalPresentation);
      if (parts.length === 0) {
        toast({ title: "No obstetric measurements to map", description: "This study has no OB/fetal measurement values.", variant: "destructive" });
        return;
      }
      // usg_measurements (the row fetched above) has no fetalUsgStudyId
      // column at all — that id only exists on the separate FetalUsgLevel4
      // pipeline's fetal_usg_studies table. Look it up the same way
      // ObDashboardStrip does, via the existing /strip/:studyId endpoint —
      // best-effort: a missing link here still lets the biometry summary
      // through, it just won't carry the Form F <-> fetal-study cross-link.
      let fetalUsgStudyId: number | null = null;
      if (entry.studyId != null) {
        try {
          const strip = await api.get<{ found: boolean; fetalStudyId?: number }>(
            `/api/fetal-usg-dashboard/strip/${entry.studyId}`,
          );
          if (strip.found && strip.fetalStudyId) fetalUsgStudyId = strip.fetalStudyId;
        } catch { /* best-effort only — proceed without the link */ }
      }
      const params = new URLSearchParams({ prefillUsgSummary: parts.join(", ") });
      if (fetalUsgStudyId != null) params.set("prefillFetalUsgStudyId", String(fetalUsgStudyId));
      window.open(`/form-f?${params.toString()}`, "_blank", "noopener");
    } catch {
      toast({ title: "Failed to load measurements for Form F review", variant: "destructive" });
    } finally {
      setMappingToFormF(false);
    }
  }

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

  // MRI PR 5 — offline awareness for Save/Finalize (reuses the existing hook).
  const isOnline = useOnlineStatus();
  // MRI PR 5 — a rescue draft recovered from a 401 session-expiry (state here;
  // the register/read effects live after `entry` is declared).
  const [rescueDraft, setRescueDraft] = useState<RescueDraft | null>(null);

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

  const autoLinkNotifiedRef = useRef<number | null>(null);
  useEffect(() => {
    const meta = entry?.autoLinkMeta;
    if (!meta || !studyId) return;
    if (meta.reason !== "auto-linked to billed study") return;
    if (autoLinkNotifiedRef.current === studyId) return;
    autoLinkNotifiedRef.current = studyId;
    toast({
      title: "Billed study linked",
      description: `Auto-linked to study #${meta.studyId}${meta.matchScore ? ` (${meta.matchScore} match)` : ""}.`,
    });
  }, [entry?.autoLinkMeta, studyId, toast]);

  // MRI PR 5 — participate in the 401 session-expiry rescue (reuses draftRescue,
  // the exact mechanism the Command Center uses). If the JWT expires mid-dictation
  // and fetchApi redirects to login, the in-memory findings/impression are written
  // to localStorage FIRST so nothing is lost — the workspace previously did not
  // register a saver, so its dictation was unprotected against that redirect.
  useEffect(() => {
    registerDraftRescueSaver(() => {
      const acc = entry?.accessionNumber;
      if (!acc) return;
      if (!rawFindings.trim() && impression.filter(Boolean).length === 0) return;
      writeRescueDraft({ accessionNumber: acc, rawFindings, impression: impression.filter(Boolean), savedAt: new Date().toISOString() });
    });
    return () => deregisterDraftRescueSaver();
  }, [entry?.accessionNumber, rawFindings, impression]);
  // On (re)entry, offer a rescue draft only when it belongs to THIS study and the
  // report is still editable — never over a finalized report.
  useEffect(() => {
    const r = readRescueDraft();
    setRescueDraft(r && entry?.accessionNumber && r.accessionNumber === entry.accessionNumber && reportStatus !== "FINAL" ? r : null);
  }, [entry?.accessionNumber, reportStatus]);

  // Pre-filter the template picker to the open study's modality (MR → MRI, etc.).
  useEffect(() => {
    if (!entry?.modality) return;
    const fromUrl = new URLSearchParams(window.location.search).get("modality");
    if (fromUrl) return;
    setModalityFilter(templateCatalogModality(entry.modality));
  }, [entry?.modality, studyId]);

  function restoreRescueDraft() {
    if (!rescueDraft) return;
    if (rescueDraft.rawFindings) setRawFindings(rescueDraft.rawFindings);
    if (rescueDraft.impression?.length) setImpression(rescueDraft.impression);
    clearRescueDraft();
    setRescueDraft(null);
    toast({ title: "Recovered after session expiry", description: "Your dictation from before the session expired has been restored." });
  }
  function dismissRescueDraft() {
    clearRescueDraft();
    setRescueDraft(null);
  }

  // ── Quick-select config (shared cache with the right Quick panel) ───────────
  // Same queryKey as QuickFindingsPanel, so react-query de-dupes — no extra
  // network. Drives the study-specific Clinical History chips and the
  // near-Technique protocol dropdown, both resolved to the SAME study region
  // the panel uses (via matchStudyRegion), so all three stay in agreement.
  const { data: quickSelectData } = useQuery<QuickSelectData>({
    queryKey: ["radiology-quick-select"],
    queryFn: () => api.get("/api/radiology/quick-select"),
    staleTime: 5 * 60_000,
  });

  // Finding definitions by id — the Smart Findings engine looks up a selected
  // finding's anatomical section, conflict group and render templates here.
  const findingById = useMemo(
    () => new Map((quickSelectData?.findings ?? []).map((f) => [f.id, f])),
    [quickSelectData],
  );

  // All active study-region tab names (ordered) — the option list for the
  // manual region override below.
  const availableRegions = useMemo(
    () => (quickSelectData?.tabs ?? [])
      .filter((t) => t.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((t) => t.name),
    [quickSelectData],
  );

  // The region resolved from the study's modality + description (matchStudyRegion:
  // longest matching tab name wins). This is only as good as the PACS/billing
  // labelling, so it can be wrong for a mislabelled or misrouted study.
  const autoStudyRegion = useMemo(
    () => matchStudyRegion(`${entry?.modality ?? ""} ${entry?.studyDescription ?? ""}`, availableRegions),
    [availableRegions, entry?.modality, entry?.studyDescription],
  );

  // Manual override — lets the radiologist FORCE the study region (and therefore
  // which quick findings / protocols / clinical-history chips appear) when the
  // technician/billing desk labelled the study wrong or the auto-match misfired.
  // Reset whenever the open study changes (below) so it never leaks across
  // patients. `null` = follow the auto-resolved region.
  const [regionOverride, setRegionOverride] = useState<string | null>(null);
  const studyRegion = regionOverride ?? autoStudyRegion;

  // Protocols for this study region — the SAME list the Quick panel shows.
  const availableProtocols = useMemo(
    () => (quickSelectData?.protocols ?? [])
      .filter((p) => p.isActive && !!studyRegion && p.studyType === studyRegion)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [quickSelectData, studyRegion],
  );

  // Up to 10 active clinical-history chips for this study region.
  // All active clinical-history chips for this study region — no cap; the strip
  // wraps to as many rows as needed (they are quick-insert workhorses).
  const clinicalHistoryChips = useMemo(
    () => (quickSelectData?.clinicalHistory ?? [])
      .filter((c) => c.isActive && !!studyRegion && c.studyType === studyRegion)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.displayLabel.localeCompare(b.displayLabel)),
    [quickSelectData, studyRegion],
  );

  // Study-specific findings for the prominent in-column "Quick Findings" strip
  // (Phase 6). Same list the right Quick panel shows, wired to the same toggle.
  const regionFindings = useMemo(
    () => (quickSelectData?.findings ?? [])
      .filter((f) => f.isActive && !!studyRegion && f.studyType === studyRegion)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [quickSelectData, studyRegion],
  );

  // Item 2 — grouped options for the Findings "add from list" dropdown. Quick
  // chips cannot hold every finding for a busy study (the user's own point:
  // "chocolate/quick boxes will not accommodate all findings"), so this
  // dropdown exposes the FULL region finding set, grouped by anatomical
  // section, and drives the SAME handleFindingClick engine the chips use — so
  // in structured mode a pick flips its region normal→abnormal, and in
  // free-text mode it inserts, exactly like clicking a chip.
  const findingsDropdownGroups = useMemo(() => {
    const groups = new Map<string, QuickFinding[]>();
    for (const f of regionFindings) {
      const key = (f.anatomicalSection ?? "").trim() || OTHER_SECTION;
      const arr = groups.get(key) ?? [];
      arr.push(f);
      groups.set(key, arr);
    }
    return [...groups.entries()];
  }, [regionFindings]);

  // Item 1 — Recommendation / Advice quick-select chips. Admin-editable from
  // Radiology Settings via the `report_recommendation_chips` pacs setting
  // (JSON string array); falls back to a sensible default set so the panel is
  // useful out of the box. Clicking a chip merges its text into Recommendation.
  const recommendationChips = useMemo<string[]>(() => {
    const raw = pacsSettingsRows?.find((r) => r.key === "report_recommendation_chips")?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const chips = parsed.map((x) => String(x).trim()).filter(Boolean);
          if (chips.length > 0) return chips;
        }
      } catch { /* malformed setting → fall back to defaults */ }
    }
    return DEFAULT_RECOMMENDATION_CHIPS;
  }, [pacsSettingsRows]);

  // Options for the near-Technique dropdown. Normally the region's protocols;
  // if the shared selection points at a protocol outside this region (the Quick
  // panel allows multi-region selection) we prepend it so the control still
  // shows the active selection rather than appearing blank.
  const techniqueProtocolOptions = useMemo(
    () => (activeProtocol && !availableProtocols.some((p) => p.id === activeProtocol.id)
      ? [activeProtocol, ...availableProtocols]
      : availableProtocols),
    [availableProtocols, activeProtocol],
  );

  /** Toggle a clinical-history chip's phrase in/out of the Clinical History
   *  field. Append is duplicate-safe; remove only deletes an exact previously
   *  inserted phrase, so manually typed history is never clobbered. */
  function toggleClinicalHistoryChip(chip: QuickClinicalHistoryChip) {
    if (isLocked) return;
    setClinicalHistory((cur) =>
      hasPhrase(cur, chip.insertedText)
        ? removeClinicalPhrase(cur, chip.insertedText)
        : appendClinicalPhrase(cur, chip.insertedText),
    );
  }

  // Chocolate Box macro set — depends on `entry`, so must be declared after it.
  const chocolateBoxSet = useMemo(
    () => chocolateBoxSetFor(entry?.modality, entry?.studyDescription),
    [entry?.modality, entry?.studyDescription],
  );

  // Live Report Quality Score (Phase 3) — recomputed as the radiologist
  // types; purely informational, never blocks anything.
  //
  // The input is extracted so the (user-visible) legacy score and the PR #101
  // shadow parity check see byte-for-byte identical data.
  const qualityInput = useMemo(
    () => ({
      findings: rawFindings, impression, recommendation, technique, clinicalHistory,
      checklistPercent: activeProtocol ? checklistPercent : undefined,
      missingRequiredMeasurements,
      // F2: medical-consistency context (Cockpit→Workspace merge) — each
      // check is a no-op when its field is absent, so this is additive.
      sex: entry?.sex, age: entry?.age, modality: entry?.modality, studyDescription: entry?.studyDescription,
    }),
    [rawFindings, impression, recommendation, technique, clinicalHistory, activeProtocol, checklistPercent, missingRequiredMeasurements,
      entry?.sex, entry?.age, entry?.modality, entry?.studyDescription],
  );
  // User-visible score — UNCHANGED (still the legacy computeQualityScore).
  const quality = useMemo(() => computeQualityScore(qualityInput), [qualityInput]);
  // PR #101 Phase 1 (shadow-first, strangler façade): run the canonical engine
  // in parallel and log parity differences in dev only. Never changes what the
  // radiologist sees; wrapped so it can never affect the workspace.
  useEffect(() => { logParityInDev(qualityInput); }, [qualityInput]);

  // F6 (Cockpit→Workspace merge): imported-viewer-measurement safety checks.
  // Reads the SAME cache entry ViewerMeasurementsPanel populates (shared
  // queryKey via useViewerMeasurements) rather than re-fetching. Ported from
  // the Cockpit's Inspector engine — a measurement the radiologist marked
  // "Imported" but never actually mentioned in the report text is a real
  // missed-finding risk, distinct from the text-insertion helpers (which only
  // guard against re-typing, not against forgetting entirely).
  const viewerMeasurementsForSafety = useViewerMeasurements(entry?.studyInstanceUID);
  const measurementSafetyIssues = useMemo(() => {
    const imported = (viewerMeasurementsForSafety.data ?? []).filter((m) => m.status === "imported");
    if (imported.length === 0) return [] as Array<{ id: string; severity: "critical" | "important"; message: string }>;
    const fullTextLower = [clinicalHistory, technique, rawFindings, impression.join(" "), recommendation]
      .join(" ").toLowerCase();
    const issues: Array<{ id: string; severity: "critical" | "important"; message: string }> = [];
    const seen = new Set<string>();
    for (const m of imported) {
      const valLower = (m.value ?? "").trim().toLowerCase();
      if (!valLower) continue;
      // Word-boundary matched, not a plain substring search — a raw
      // indexOf() on a short numeric value like "5" or "45" almost always
      // finds a coincidental match elsewhere in the report (ages, vertebral
      // levels, dates), silently suppressing this critical check for
      // exactly the short values most likely to be forgotten.
      const valueRegex = new RegExp(`(?<![\\w.])${escapeRegExp(valLower)}(?![\\w.])`);
      const match = valueRegex.exec(fullTextLower);
      if (!match) {
        issues.push({
          id: `meas-ref-${m.id}`,
          severity: "critical",
          message: `Imported measurement (${m.measurementType}: ${m.value} ${m.unit}) isn't mentioned anywhere in the report.`,
        });
      } else if (m.unit) {
        const idx = match.index;
        const nearby = fullTextLower.substring(Math.max(0, idx - 20), idx + valLower.length + 20);
        if (!nearby.includes(m.unit.trim().toLowerCase())) {
          issues.push({
            id: `meas-unit-${m.id}`,
            severity: "important",
            message: `Imported measurement's unit '${m.unit}' doesn't appear near its value in the report text — verify unit consistency.`,
          });
        }
      }
      // Dedup key includes the source location (series/slice), not just
      // type+value+unit — measurementType is usually a generic caliper kind
      // ("linear"), so two DIFFERENT lesions that happen to be the same size
      // would otherwise collide and produce a false "duplicate" warning.
      // Same series+slice+value+unit is what actually indicates the same
      // caliper got imported twice.
      const dupKey = `${m.seriesInstanceUID ?? ""}-${m.sliceNumber ?? ""}-${m.value}-${m.unit}`;
      if (seen.has(dupKey)) {
        issues.push({
          id: `meas-dup-${m.id}`,
          severity: "important",
          message: `${m.value} ${m.unit} for '${m.measurementType}' appears to be imported more than once from the same location — verify it isn't a duplicate acquisition.`,
        });
      }
      seen.add(dupKey);
    }
    return issues;
  }, [viewerMeasurementsForSafety.data, clinicalHistory, technique, rawFindings, impression, recommendation]);

  // C1 (Cockpit→Workspace merge): quantitative interval-change vs the same
  // patient's prior measurements — distinct from C2's narrative structured
  // comparison, and distinct from just listing old numbers (RadiologyMemoryPanel
  // already does that): this computes an actual %-change per matched parameter.
  // Reuses the same viewer-measurements cache F6 reads (via useViewerMeasurements
  // above) rather than a second parallel query.
  const { data: historicalMeasurementsForCompare = [] } = useQuery<
    Array<{ studyId: number | null; measurementType: string; label: string; value: string; unit: string | null }>
  >({
    queryKey: ["historical-measurements", entry?.patientId],
    queryFn: () =>
      entry?.patientId
        ? api
            .get<{ measurements: Array<{ studyId: number | null; measurementType: string; label: string; value: string; unit: string | null }> }>(
              `/api/radiology-lesions/measurements?patientId=${entry.patientId}`,
            )
            .then((res) => res.measurements ?? [])
        : Promise.resolve([]),
    enabled: !!entry?.patientId,
    staleTime: 300_000,
  });
  const priorComparisonMetrics = useMemo(() => {
    type Metric = { label: string; current: string; previous: string; changePercent: number; direction: "growth" | "regression" | "stable" };
    const imported = (viewerMeasurementsForSafety.data ?? []).filter((m) => m.status === "imported");
    if (imported.length === 0 || historicalMeasurementsForCompare.length === 0) return [] as Metric[];
    const priorMeasures = historicalMeasurementsForCompare.filter((p) => p.studyId !== entry?.studyId);
    const list: Metric[] = [];
    for (const curr of imported) {
      const currType = (curr.measurementType || "").toLowerCase();
      // viewer_measurements.measurementType is the CALIPER KIND ("linear" |
      // "area" | "volume" | "ellipse"), not a descriptive label — there is
      // no anatomical-name field on that table. Matching on a generic kind
      // would silently pair unrelated measurements (e.g. a liver-span
      // caliper against an unrelated midline-shift value, both "linear")
      // and show a misleading growth/regression trend. Only compare when
      // the type string is itself descriptive enough to be a real match key.
      if (GENERIC_CALIPER_TYPES.has(currType)) continue;
      const prior = priorMeasures.find(
        (p) => p.label.toLowerCase() === currType || p.measurementType.toLowerCase() === currType,
      );
      if (!prior) continue;
      const currVal = parseFloat(curr.value);
      const priorVal = parseFloat(prior.value);
      if (isNaN(currVal) || isNaN(priorVal) || priorVal <= 0) continue;
      const diff = currVal - priorVal;
      const pct = Math.round((diff / priorVal) * 100);
      list.push({
        label: curr.measurementType,
        current: `${currVal} ${curr.unit}`,
        previous: `${priorVal} ${prior.unit || curr.unit}`,
        changePercent: pct,
        direction: pct > 0 ? "growth" : pct < 0 ? "regression" : "stable",
      });
    }
    return list;
  }, [viewerMeasurementsForSafety.data, historicalMeasurementsForCompare, entry?.studyId]);

  // F3 (Cockpit→Workspace merge): real-time missed-finding nudges. Excludes
  // the engine's "brain-adc" and "hydrocephalus-evans" rules — those are
  // superseded by MeasurementAssistantPanel, which computes real ADC/Evans
  // Index values rather than just reminding the radiologist to mention them.
  const [dismissedCoPilotIds, setDismissedCoPilotIds] = useState<Set<string>>(new Set());
  const coPilotSuggestions = useMemo(() => {
    if (!rawFindings.trim()) return [] as CoPilotSuggestion[];
    return observeReportText(entry?.modality ?? "", entry?.studyDescription ?? "", rawFindings)
      .filter((s) => !COPILOT_SUPERSEDED_IDS.has(s.id) && !dismissedCoPilotIds.has(s.id));
  }, [rawFindings, entry?.modality, entry?.studyDescription, dismissedCoPilotIds]);

  // ── CARE Copilot (PR #80) ───────────────────────────────────────────────────
  // Unified, always-on advisory panel. The analysis is LOCAL and deterministic
  // (analyzeCopilot composes the EXISTING observer engine + validator + quality
  // score — no new engine, no per-keystroke AI call), so it can run on every
  // render. Nothing here mutates the report; the panel's Insert routes back
  // through the same setters the rest of the workspace uses (Part 17 safety).
  const [copilotDismissed, setCopilotDismissed] = useState<Set<string>>(new Set());
  const [copilotRecent, setCopilotRecent] = useState<CopilotAction[]>([]);
  const copilotUndoRef = useRef<(() => void) | null>(null);
  // Shared analysis context — the SINGLE source both the deterministic engine
  // and the plug-in modules (local + on-demand AI) read from (Part 20).
  // Previous-study comparison (MRI PR 1) — the ComparisonPanel reports the
  // selected prior + significant measurement changes up here, so the Copilot
  // comparison module can advise and the reference can persist with the draft.
  const [selectedPrior, setSelectedPrior] = useState<SelectedPrior | null>(null);

  // CARE USG Companion (Phase 1) — the Companion panel reports its
  // machine-measurement outcome up here so the EXISTING Copilot can advise on
  // imported / rejected / modified / missing measurements (no second Copilot).
  const [companionCopilot, setCompanionCopilot] = useState<CompanionCopilotContext | null>(null);
  // CARE USG Companion (Phase 2) — the blocks the Companion auto-populated, so
  // the provenance ledger + edit-tracking + telemetry can reflect them.
  const [companionLedger, setCompanionLedger] = useState<CompanionPopulateBlock[]>([]);

  // Accepted viewer/DICOM-SR measurements (MRI PR 2) — read from the SAME hook +
  // cache the existing ViewerMeasurementsPanel uses, mapped into the Copilot
  // context so the measurement-completeness module can advise. No extra fetch.
  const { data: viewerMeasurementRows = [] } = useViewerMeasurements(entry?.studyInstanceUID);
  const copilotViewerMeasurements = useMemo(
    () => viewerMeasurementRows
      .map((m) => ({ label: (m.measurementType || "").trim(), value: Number(m.value), unit: (m.unit || "").trim(), imported: m.status === "imported" }))
      .filter((m) => Number.isFinite(m.value)),
    [viewerMeasurementRows],
  );

  // MRI PR 3 — per-study critical watch terms, reused verbatim from the master
  // template `criticalWatchList` data (no duplicate list here); seeds the
  // critical-results detector in addition to its built-in emergency table.
  const entryCriticalWatchList = useMemo(
    () => criticalWatchListFor(entry?.modality, entry?.studyDescription),
    [entry?.modality, entry?.studyDescription],
  );

  const copilotContext = useMemo<CopilotContext>(() => ({
    modality: entry?.modality ?? "",
    studyDescription: entry?.studyDescription ?? "",
    clinicalHistory,
    findings: useStructured ? findingsAsText() : rawFindings,
    impression: impression.filter(Boolean),
    recommendation,
    technique,
    selectedFindingLabels: [...selectedQuickIds]
      .map((id) => findingById.get(id)?.label)
      .filter((l): l is string => !!l),
    checklistPercent,
    missingRequiredMeasurements,
    prior: selectedPrior
      ? { available: true, dateIso: selectedPrior.dateIso, studyName: selectedPrior.studyName, significantChanges: selectedPrior.significantChanges }
      : undefined,
    viewerMeasurements: copilotViewerMeasurements,
    // MRI PR 3 — reuse the existing "Mark Critical Finding" toggle + F5
    // communication checklist as the criticality state the Copilot advises on.
    criticalWatchList: entryCriticalWatchList,
    criticalMarked: isCritical,
    criticalCommunicated: checklistComm.phoned,
    // CARE USG Companion (Phase 1) — machine-measurement outcome for the
    // USG Companion Copilot module (undefined for non-USG studies → module no-op).
    usgCompanion: companionCopilot ?? undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entry?.modality, entry?.studyDescription, clinicalHistory, useStructured, findingsMap, rawFindings, impression, recommendation, technique, selectedQuickIds, findingById, checklistPercent, missingRequiredMeasurements, selectedPrior, copilotViewerMeasurements, entryCriticalWatchList, isCritical, checklistComm.phoned, companionCopilot]);

  // MRI PR 3 — critical findings described in the drafted report (for the
  // finalize-safety gate and the pre-sign preview), computed from the same
  // resolved findings/impression the Copilot context uses.
  const criticalHits = useMemo(
    () => detectCriticalFindings(copilotContext.findings, copilotContext.impression, entryCriticalWatchList),
    [copilotContext.findings, copilotContext.impression, entryCriticalWatchList],
  );

  /** Insert a comparison statement into Findings (free-text) or the structured
   *  catch-all section — editable, additive, never overwriting (§6 safety). */
  function comparisonInsertFindings(text: string) {
    if (isLocked) return;
    if (smartModeActive()) {
      setFindingsMap((m) => ({ ...m, [OTHER_SECTION]: { normal: false, text: mergeBlock(m[OTHER_SECTION]?.text ?? "", text) } }));
    } else {
      setRawFindings((prev) => mergeBlock(prev, text));
    }
  }
  function comparisonInsertImpression(text: string) {
    if (!isLocked) setImpression((prev) => [...prev, text]);
  }

  // Core deterministic report + any registered LOCAL add-on modules (Part 20).
  const copilotReport = useMemo(() => {
    const core = analyzeCopilot(copilotContext);
    const extra = runLocalModules(copilotContext);
    return { ...core, items: [...core.items, ...extra] };
  }, [copilotContext]);

  // On-demand AI reasoning (Parts 6/7/21) — cached per report input (Part 18).
  const [aiCopilotItems, setAiCopilotItems] = useState<CopilotItem[]>([]);
  const [aiCopilotBusy, setAiCopilotBusy] = useState(false);
  const aiCopilotCacheRef = useRef<Map<string, CopilotItem[]>>(new Map());

  async function askCopilotAi() {
    if (aiCopilotBusy || !entry) return;
    const key = JSON.stringify([copilotContext.studyDescription, copilotContext.clinicalHistory, copilotContext.findings, copilotContext.impression]);
    const cached = aiCopilotCacheRef.current.get(key);
    if (cached) { setAiCopilotItems(cached); return; }
    setAiCopilotBusy(true);
    try {
      const items = await runAiModules(copilotContext, async (promptText) => {
        // Reuse the EXISTING AI endpoint — provider selection + fallback live
        // there — through the canonical typed contract (promptText).
        const res = await queryAiReporting({
          promptText,
          studyInstanceUID: entry.studyInstanceUID,
          accessionNumber: entry.accessionNumber,
          patientId: entry.patientId ?? undefined,
          provider: "gemini",
          maxImages: 0,
        });
        return res.aiResponse ?? "";
      });
      aiCopilotCacheRef.current.set(key, items);
      setAiCopilotItems(items);
      if (items.length === 0) toast({ title: "Copilot AI", description: "No additional suggestions." });
    } catch {
      toast({ title: "Copilot AI unavailable", description: "Could not reach the AI provider.", variant: "destructive" });
    } finally {
      setAiCopilotBusy(false);
    }
  }

  function copilotAudit(item: CopilotItem, outcome: "accepted" | "ignored") {
    // Advisory audit trail (Part 22) — reuses the EXISTING copilot log endpoint
    // + table (radiology_copilot_logs), no duplicate store. Fire-and-forget;
    // records category, provider, confidence and the (non-sensitive) title only
    // — never report text. Provider is "local" for these on-device rules.
    void api.post("/api/radiology-copilot/log", {
      studyInstanceUID: entry?.studyInstanceUID ?? undefined,
      suggestionType: item.category,
      suggestionContent: `provider=local confidence=${item.confidence} — ${item.title}`,
      action: outcome === "accepted" ? "accepted" : "dismissed",
    }).catch(() => {});
  }

  function copilotInsert(item: CopilotItem) {
    if (isLocked || !item.insertText) return;
    const text = item.insertText;
    const target = item.insertTarget ?? "findings";
    if (target === "recommendation") { const prev = recommendation; copilotUndoRef.current = () => setRecommendation(prev); setRecommendation((p) => mergeBlock(p, text)); }
    else if (target === "impression") { const prev = impression; copilotUndoRef.current = () => setImpression(prev); setImpression((p) => [...p, text]); }
    else if (smartModeActive()) { const prev = findingsMap; copilotUndoRef.current = () => setFindingsMap(prev); setFindingsMap((m) => ({ ...m, [OTHER_SECTION]: { normal: false, text: mergeBlock(m[OTHER_SECTION]?.text ?? "", text) } })); }
    else { const prev = rawFindings; copilotUndoRef.current = () => setRawFindings(prev); setRawFindings((p) => mergeBlock(p, text)); }
    setCopilotDismissed((d) => new Set(d).add(item.id));
    setCopilotRecent((r) => [{ id: item.id, title: item.title, category: item.category, outcome: "accepted" as const }, ...r].slice(0, 20));
    copilotAudit(item, "accepted");
    toast({ title: "Copilot suggestion inserted", description: "Undo it from Recent AI Actions in the Copilot panel." });
  }

  function copilotDismiss(item: CopilotItem) {
    setCopilotDismissed((d) => new Set(d).add(item.id));
    setCopilotRecent((r) => [{ id: item.id, title: item.title, category: item.category, outcome: "ignored" as const }, ...r].slice(0, 20));
    copilotAudit(item, "ignored");
    // Opt-in learning (Part 11): remember an ignored suggestion so it stops
    // resurfacing for this radiologist. Only when learning is enabled.
    if (copilotPrefs.learning) copilotLearning.record(item.id, true);
  }

  function copilotUndoLast() {
    copilotUndoRef.current?.();
    copilotUndoRef.current = null;
    toast({ title: "Reverted last Copilot insertion" });
  }

  function copilotGoToConflict(_matchText: string) {
    focusEditor("findings");
  }

  // ── CARE Copilot — preferences + smart auto-completion (PR #80 Part 12) ─────
  const { prefs: copilotPrefs, set: setCopilotPref } = useCopilotPrefs();

  // Opt-in personal-style learning (Part 11) — reuses the existing copilot
  // profile endpoint; learned-ignored suggestions are hidden alongside this
  // session's dismissals.
  const copilotLearning = useCopilotLearning(copilotPrefs.learning);
  const copilotEffectiveDismissed = useMemo(
    () => new Set<string>([...copilotDismissed, ...copilotLearning.learnedIgnored]),
    [copilotDismissed, copilotLearning.learnedIgnored],
  );
  function copilotResetLearning() {
    copilotLearning.reset();
    toast({ title: "Copilot learning reset", description: "Previously-ignored suggestions may reappear." });
  }
  function copilotExportLearning() {
    const blob = new Blob([copilotLearning.exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "care-copilot-preferences.json"; a.click();
    URL.revokeObjectURL(url);
  }

  // Local, deterministic next-sentence suggestion for the free-text Findings
  // editor (no AI call). Only while typing free text (structured mode edits
  // per-section boxes, not rawFindings) and the report is editable.
  const copilotCompletion = useMemo(
    () => (copilotPrefs.enabled && copilotPrefs.autoComplete && !useStructured
      ? suggestCompletion(rawFindings, { studyDescription: entry?.studyDescription ?? "" })
      : null),
    [copilotPrefs.enabled, copilotPrefs.autoComplete, useStructured, rawFindings, entry?.studyDescription],
  );

  /** Accept the suggested completion — append it and place the caret at the end.
   *  Advisory only: reached solely via Tab / the Accept chip. */
  function acceptCopilotCompletion() {
    if (!copilotCompletion || isLocked) return;
    const el = findingsTextareaRef.current?.el ?? null;
    const text = copilotCompletion.completion;
    setRawFindings((prev) => prev + text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    });
    void api.post("/api/radiology-copilot/log", {
      studyInstanceUID: entry?.studyInstanceUID ?? undefined,
      suggestionType: "completion", suggestionContent: "provider=local — auto-complete accepted", action: "accepted",
    }).catch(() => {});
  }

  // F4 (Cockpit→Workspace merge): institution-mandated "Comparison" section
  // enforcement — the one genuinely novel required-section rule (Clinical
  // History/Recommendation are already covered by computeQualityScore's
  // existing completeness deductions; the cosmetic formatting sub-rules from
  // the same institutional-style settings are intentionally NOT ported — the
  // Workspace already gives direct manual heading-case/spacing controls,
  // which serves that intent more directly than an AI nag would).
  const { data: institutionalStyle } = useQuery<{ showComparison: boolean }>({
    queryKey: ["institutional-style"],
    queryFn: () => api.get("/api/radiology/institutional-style"),
    staleTime: 300_000,
  });
  const { data: priorReportsTotal = 0 } = useQuery<number>({
    queryKey: ["patient-prior-reports-count", entry?.patientId],
    queryFn: () =>
      entry?.patientId
        ? api.get<{ total: number }>(`/api/patient-reports/patient/${entry.patientId}?type=radiology&limit=1`).then((r) => r.total ?? 0)
        : Promise.resolve(0),
    enabled: !!entry?.patientId,
    staleTime: 300_000,
  });
  const COMPARISON_KEYWORDS = ["comparison", "prior", "compared", "previously", "previous study", "interval"];
  const comparisonSectionMissing = useMemo(() => {
    if (!institutionalStyle?.showComparison || priorReportsTotal === 0) return false;
    // Deliberately excludes clinicalHistory — that field routinely contains
    // unrelated phrases like "h/o prior appendectomy", which would otherwise
    // satisfy the "prior" keyword and silently suppress this check even when
    // no actual imaging-comparison wording was ever written in the report.
    const fullTextLower = [technique, rawFindings, impression.join(" "), recommendation]
      .join(" ").toLowerCase();
    return !COMPARISON_KEYWORDS.some((kw) => fullTextLower.includes(kw));
  }, [institutionalStyle, priorReportsTotal, technique, rawFindings, impression, recommendation]);

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
    sectionContribRef.current = new Map();
    // Per-report structured values reset with the study; sessionMemoryRef is
    // deliberately kept (it only pre-fills the next dialog).
    structuredValuesRef.current = new Map();
    setStructuredDialog(null);
    // CARE Copilot AI reasoning is per-report — clear it and its cache.
    setAiCopilotItems([]);
    aiCopilotCacheRef.current = new Map();
    // CARE USG Companion Phase 2 — the auto-population ledger is per-study.
    setCompanionLedger([]);
    setCopilotDismissed(new Set());
    setSelectedPrior(null); // previous-study comparison is per-report (MRI PR 1)
    lastToggledFindingRef.current = null;
    setIsCritical(false); setCriticalNote("");
    // F5 fix: without this, switching studies carried the PREVIOUS study's
    // communication checklist forward — a new critical finding on the next
    // study could silently inherit "Telephoned Doctor: true" from a call that
    // was never made for this patient, suppressing the safety gate and
    // falsely recording it in the finalize audit trail.
    setChecklistComm({ phoned: false, annotated: false, dispatched: false });
    setReportStatus("DRAFT");
    setSelectedTemplateId(null);
    setAiOutput("");
    setLastSavedSnapshot(null); setLastSavedAt(null);
    setStructuredFinalInfo(null); setFinalizedReportId(null);
    setReportCreationSkipped(null);
    setShowDiagnostics(false);
    setRegionOverride(null); // manual region override must not leak across studies
    setActiveProtocol(null);
    lastInsertedTechniqueRef.current = null;
    setProtocolReplacePrompt(null);
    autoProtocolForStudyRef.current = null;
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
      // renderFinding regenerates structured findings from their restored values
      // (seeded below), so deselect exact-removes the impression/technique text.
      if (inst) insertedTextRef.current.set(f.id, renderFinding(f, inst));
    }
  }

  /** Restore each finding's collected structured values from its persisted
   *  params (piggybacked under `__structured`), so a reloaded draft regenerates
   *  the identical finding/impression text and remains exact-removable. */
  function seedRestoredStructuredValues(selections: Array<{ findingId: number; params: Record<string, unknown> }>) {
    for (const s of selections) {
      const sv = (s.params as { __structured?: unknown }).__structured;
      if (sv && typeof sv === "object" && !Array.isArray(sv)) {
        structuredValuesRef.current.set(s.findingId, sv as Record<string, string>);
      }
    }
  }

  function handleFindingsLoaded(findings: QuickFinding[]) {
    quickFindingTemplatesRef.current = findings;
    seedRestoredInsertedText(findings, selectedQuickIds, quickInstances);
    seedRestoredSectionContribs(findings, selectedQuickIds, quickInstances);
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
    // Structured values first — the two seeds below regenerate exact text from them.
    seedRestoredStructuredValues(selections);
    setSelectedQuickIds(ids);
    setQuickInstances(map);
    if (quickFindingTemplatesRef.current) {
      seedRestoredInsertedText(quickFindingTemplatesRef.current, ids, map);
      seedRestoredSectionContribs(quickFindingTemplatesRef.current, ids, map);
    }
    // Restored selections are saved state — keep the workspace clean.
    requestBaselineRecapture();
  }, [draftId, instancesData, existingDraft]);

  const { data: templates = [] } = useQuery<StructuredTemplate[]>({
    queryKey: ["structured-templates"],
    queryFn: () => api.get<StructuredTemplate[]>("/api/radiology/structured-report-templates"),
  });

  // E1: Phase-F master template catalog (additive alongside the structured
  // templates above — both surfaces coexist in the picker). Fetched the same
  // way the Cockpit did; the section renders only when non-empty, so a doctor
  // with the feature off (empty catalog) sees no change.
  const { data: masterTemplatesResp } = useQuery<{ templates: MasterTemplate[]; count: number }>({
    queryKey: ["radiology-master-templates-v2"],
    queryFn: () => api.get("/api/radiology/knowledge/master-templates"),
    staleTime: 300_000,
  });
  const masterTemplates = masterTemplatesResp?.templates ?? [];
  // Apply a master template: content-only. Deliberately clears
  // selectedTemplateId (that field references the structured_report_templates
  // id namespace; reusing it for master ids would misattribute the draft).
  const handleApplyMasterTemplate = (tpl: MasterTemplate) => {
    // Guarded like E2's importAiDraft — unlike the structured-template picker
    // (fill-empty-only), this content-only apply used to overwrite typed
    // Findings/Impression unconditionally with no way to undo.
    const hasTyped = rawFindings.trim().length > 0 || impression.filter(Boolean).length > 0;
    if (hasTyped && !window.confirm(`Replace the current Findings and Impression with "${tpl.templateName}"?`)) return;
    setSelectedTemplateId(null);
    setRawFindings(tpl.findings || "");
    if (tpl.impression) setImpression([tpl.impression]);
    toast({ title: "Master template applied", description: `${tpl.templateName} (${tpl.groupName.replace(/_/g, " ")})` });
  };

  /** MRI PR 4 — apply a multi-study COMBINATION by assembling its base master
   *  templates through the EXISTING assembler (studyCombinations → assembleReport)
   *  and inserting the result through the canonical, additive primitives. Never
   *  overwrites: findings/recommendation merge, impression de-dupes, and a
   *  confirmation guards any pre-existing content. Returns a VoiceExecutionResult
   *  so the command palette and voice share exactly one apply path. */
  function applyCombination(combo: StudyCombination): VoiceExecutionResult {
    if (isLocked) return { ok: false, message: "Report is read-only" };
    const assembled = buildCombination(combo.templateIds);
    if (!assembled) return { ok: false, message: `Combination "${combo.label}" is unavailable` };
    const inserts = combinationInserts(assembled);
    const hasContent = rawFindings.trim().length > 0 || impression.filter(Boolean).length > 0 || Object.keys(findingsMap).length > 0;
    if (hasContent && !window.confirm(`Add the "${combo.label}" combined template (${inserts.findingsBlocks.length} sections) to this report?`)) {
      return { ok: false, message: "Combination cancelled" };
    }
    const prev = { findings: rawFindings, impression, recommendation, technique, templateId: selectedTemplateId };
    // A combination is free-text combined content — drop the single-study
    // structured template (as handleApplyMasterTemplate does) so the merged
    // body-part sections render in the findings editor.
    setSelectedTemplateId(null);
    const findingsBlock = inserts.findingsBlocks.map((b) => `${b.heading}:\n${b.text}`).join("\n\n");
    setRawFindings((p) => mergeBlock(p, findingsBlock));
    if (inserts.technique) setTechnique((p) => (p.trim() ? p : inserts.technique));
    if (inserts.impression.length) {
      setImpression((p) => {
        let next = p.filter(Boolean);
        for (const line of inserts.impression) next = mergeImpression(next, line);
        return next;
      });
    }
    if (inserts.recommendation) setRecommendation((p) => mergeBlock(p, inserts.recommendation));
    toast({ title: "Combination applied", description: combo.label });
    return {
      ok: true, message: `Applied combination: ${combo.label}`,
      undo: () => {
        setRawFindings(prev.findings); setImpression(prev.impression);
        setRecommendation(prev.recommendation); setTechnique(prev.technique);
        setSelectedTemplateId(prev.templateId);
      },
      undoLabel: "combination",
    };
  }

  /** Voice adapter — resolve a spoken combination name and apply it. */
  function voiceCombination(term: string): VoiceExecutionResult {
    const combo = matchStudyCombination(term);
    if (!combo) {
      return { ok: false, message: `No unique study combination matches “${term}” — open the palette (Ctrl+K) to pick one` };
    }
    return applyCombination(combo);
  }

  // ── Universal Command Palette (Ctrl+K) — PR #77 ─────────────────────────────
  // A keyboard-first launcher over data the workspace ALREADY has cached (quick
  // findings, protocols, templates, clinical-history chips, studies) plus a
  // command / settings registry. No new fetch, no new search index — the pure
  // ranking/grouping lives in lib/commandPalette, and running an item calls the
  // SAME handler the mouse UI uses. Recents + ⭐ favourites persist client-side.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const {
    recent: paletteRecent, favourites: paletteFavourites,
    markRecent: markPaletteRecent, toggleFav: togglePaletteFavourite,
  } = useRadiologyPalettePrefs();

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const f of quickSelectData?.findings ?? []) {
      if (!f.isActive) continue;
      items.push({
        id: `finding:${f.id}`, kind: "finding", title: f.label, subtitle: f.studyType,
        keywords: `${f.studyType} ${f.tags ?? ""} ${f.category ?? ""}`, favouritable: true, payload: f,
      });
    }
    for (const p of quickSelectData?.protocols ?? []) {
      if (!p.isActive) continue;
      items.push({
        id: `protocol:${p.id}`, kind: "protocol", title: p.name,
        subtitle: [p.modality, p.studyType].filter(Boolean).join(" · "), keywords: p.studyType,
        favouritable: true, payload: p,
      });
    }
    for (const t of templates) {
      if (!t.isActive) continue;
      items.push({
        id: `template:s:${t.id}`, kind: "template", title: t.templateName,
        subtitle: [t.modality, t.bodyPart].filter(Boolean).join(" · "),
        keywords: `${t.modality} ${t.bodyPart} structured`, favouritable: true,
        payload: { kind: "structured", template: t },
      });
    }
    for (const m of masterTemplates) {
      if (!m.isActive) continue;
      items.push({
        id: `template:m:${m.id}`, kind: "template", title: m.templateName,
        subtitle: [m.modality, m.groupName?.replace(/_/g, " ")].filter(Boolean).join(" · "),
        keywords: `${m.modality} ${m.studyType ?? ""} master`, favouritable: true,
        payload: { kind: "master", template: m },
      });
    }
    for (const c of quickSelectData?.clinicalHistory ?? []) {
      if (!c.isActive) continue;
      items.push({
        id: `history:${c.id}`, kind: "history", title: c.displayLabel,
        subtitle: c.studyType, keywords: c.insertedText, payload: c,
      });
    }
    for (const s of workflow.queue) {
      items.push({
        id: `study:${s.id}`, kind: "study", title: s.patientName,
        subtitle: [s.modality, s.studyDescription].filter(Boolean).join(" · "),
        keywords: s.accessionNumber, payload: s,
      });
    }
    // MRI PR 4 — study combinations for this modality (revives the reserved
    // `combination` palette kind; running one assembles via the shared engine).
    for (const combo of combinationsForModality(entry?.modality)) {
      items.push({
        id: combo.id, kind: "combination", title: combo.label,
        subtitle: `${combo.templateIds.length} studies · combined report`,
        keywords: combo.keywords, favouritable: true, payload: combo,
      });
    }
    items.push(...PALETTE_COMMANDS, ...PALETTE_SETTINGS);
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickSelectData, templates, masterTemplates, workflow.queue, entry?.modality]);

  // E2: on-demand full AI draft from study metadata (distinct from the
  // impression-only aiImpressionMutation and from the passive fill-empty-only
  // effect below). Lets a radiologist (re)request a draft and review it before
  // importing — the import is guarded so it never silently clobbers typed text.
  const generateAiDraftMutation = useMutation({
    mutationFn: async () => {
      if (!entry) return;
      return api.post(`/api/internal/radiology/ai-draft`, {
        studyId: entry.studyId,
        modality: entry.modality,
        studyDescription: entry.studyDescription ?? entry.modality,
        patientName: entry.patientName,
        age: entry.age ?? "",
        sex: entry.sex ?? "",
        accessionNumber: entry.accessionNumber,
        studyDate: entry.studyDate ?? "",
      });
    },
    onSuccess: () => {
      toast({ title: "AI draft ready", description: "AI-generated draft retrieved." });
      qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
      if (studyId) qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
    },
    onError: () => {
      toast({ title: "AI draft failed", description: "Could not generate a draft for this study.", variant: "destructive" });
    },
  });
  const importAiDraft = () => {
    const draft = safeParseAiDraft(entry?.aiDraftJson);
    if (!draft.findings && !draft.impression) return;
    const hasTyped = rawFindings.trim().length > 0 || impression.filter(Boolean).length > 0;
    if (hasTyped && !window.confirm("Replace the current Findings and Impression with the AI draft?")) return;
    if (draft.findings) setRawFindings(draft.findings);
    if (draft.impression) setImpression([draft.impression]);
    toast({ title: "Draft applied", description: "Editor fields replaced with AI observations." });
  };

  // R2.0 — canonical ultrasound integration. `entry.modality` is whatever
  // the PACS/DICOM source sent verbatim (US/USG/Doppler/OB US/...); fold it
  // through the ONE normalizer so USG mode reliably turns on regardless of
  // spelling (see lib/usgModality.ts).
  const isUltrasound = useMemo(() => isUltrasoundModality(entry?.modality), [entry?.modality]);

  // CARE Reporting Companion eligibility. The Companion is NOT a USG feature —
  // it composes the SAME shared engines (protocol / clinical-history / quick
  // findings / measurements / Copilot) into a pre-report snapshot, driven by the
  // region props it already receives. It mounts for ultrasound and for CT (which
  // now carries full Knowledge-Pack content), reusing the ONE panel — there is
  // no per-modality Companion. The server assembly degrades gracefully for any
  // study, and the panel is wrapped in a ModuleErrorBoundary, so broadening the
  // gate can never break reporting for either modality.
  const isCtModality = useMemo(
    () => (entry?.modality ?? "").trim().toUpperCase().startsWith("CT"),
    [entry?.modality],
  );
  const companionEligible = isUltrasound || isCtModality;

  // PCPNDT gate (roadmap §1.4 step 2 — docs/usg-reporting/
  // pcpndt-canonical-roadmap.md). The server-side finalize gates
  // (patient-reports.ts, internal-radiology.ts) now run the real shared
  // Form F verification, so this workspace no longer blocks obstetric/fetal
  // USG unconditionally: it asks the server whether the patient's Form F is
  // complete and verified, finalizes normally when it is, and blocks with
  // the exact missing fields when it isn't. Non-obstetric USG and every
  // non-ultrasound modality are completely unaffected. Draft/save/print/
  // preview remain fully usable either way — only Finalize is gated, and
  // the server re-checks regardless of anything this client decides.
  const isPcpndtRelevantUsg = useMemo(
    () => isObstetricUsgStudy(entry?.modality, entry?.studyDescription),
    [entry?.modality, entry?.studyDescription],
  );
  const { data: pcpndtCompliance } = useQuery<{ compliant: boolean; errors: string[]; formFId: number | null }>({
    queryKey: ["pcpndt-compliance", entry?.patientId],
    queryFn: () => api.get(`/api/patient-reports/pcpndt-compliance/${entry!.patientId}`),
    enabled: isPcpndtRelevantUsg && !!entry?.patientId,
    // Form F is completed in a separate tab (the "Review & Map to Form F"
    // hand-off) — poll so the unblock is picked up without a page reload.
    refetchInterval: 30_000,
  });
  // Blocked when relevant AND not yet confirmed compliant (unknown/loading/
  // no-patient counts as blocked — fail closed; the server enforces anyway).
  const pcpndtBlocked = isPcpndtRelevantUsg && pcpndtCompliance?.compliant !== true;

  // Practical USG template catalog (Whole Abdomen/KUB/Pelvis/OB/Doppler/
  // Prostate/Scrotum/Thyroid/Breast) — a separate, confidence-gated-autofill
  // catalog from `templates` above; only fetched in USG mode.
  const { data: usgTemplates = [] } = useQuery<
    Array<{ id: string; label: string; category: string; description: string }>
  >({
    queryKey: ["usg-report-templates"],
    queryFn: () => api.get("/api/usg-reports/templates"),
    enabled: isUltrasound,
    // Server returns a hardcoded, in-memory catalog (usgReportTemplates.ts)
    // that cannot change without a redeploy — no need for the app's default
    // 60s refetchInterval to hit it repeatedly per open USG report.
    staleTime: 5 * 60_000,
    refetchInterval: false,
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
  const autoProtocolForStudyRef = useRef<number | null>(null);
  // "auto" = machine-initiated apply (mount/study match) → fills ONLY empty
  // fields and stays clean; "manual" = explicit user click in the Templates
  // tab → full apply (pre-M1.4 behavior) and counts as an unsaved edit.
  const templateApplySourceRef = useRef<"auto" | "manual">("auto");

  /** Apply the default protocol + structured template for a study region.
   *  `fullReplace` overwrites technique/findings (region override / re-apply). */
  const applyStudyRegionDefaults = useCallback((region: string | null, opts?: { fullReplace?: boolean }) => {
    if (!region) return;
    const protocol = pickQuickProtocol(quickSelectData?.protocols ?? [], region);
    if (protocol) {
      if (opts?.fullReplace) applyProtocol(protocol, true);
      else requestProtocolChange(protocol);
    } else if (opts?.fullReplace) {
      setActiveProtocol(null);
      lastInsertedTechniqueRef.current = null;
    }
    if (!entry || templates.length === 0) return;
    let match = pickStructuredTemplate(templates, entry.modality, entry.studyDescription);
    if (!match) {
      const bodyPart = studyRegionToBodyPart(region);
      const mod = templateCatalogModality(entry.modality);
      if (bodyPart) {
        match = templates.find(
          (t) => templateCatalogModality(t.modality) === mod && t.bodyPart === bodyPart,
        ) ?? null;
      }
    }
    if (!match) return;
    templateApplySourceRef.current = opts?.fullReplace ? "manual" : "auto";
    setSelectedTemplateId(match.id);
    if (opts?.fullReplace) {
      toast({ title: "Study setup applied", description: `${protocol?.name ?? "Protocol"} · ${match.templateName}` });
    }
  }, [entry, templates, quickSelectData, toast]);

  function handleRegionOverrideSelect(nextValue: string) {
    if (isLocked) return;
    const targetRegion = nextValue || null;
    if (!targetRegion || targetRegion === studyRegion) return;
    const hasContent = technique.trim().length > 0
      || rawFindings.trim().length > 0
      || Object.keys(findingsMap).length > 0
      || impression.some((l) => l.trim());
    if (hasContent) {
      if (!window.confirm(
        "Changing the study region reloads the default protocol and structured template. "
        + "Current technique and findings will be replaced. Continue?",
      )) return;
    }
    setRegionOverride(targetRegion === autoStudyRegion ? null : targetRegion);
    applyStudyRegionDefaults(targetRegion, { fullReplace: true });
  }

  function handleReapplyStudyDefaults() {
    if (isLocked || !studyRegion) return;
    if (!window.confirm(
      "Reload the default protocol and structured template for this study region? "
      + "Technique and findings will be replaced.",
    )) return;
    applyStudyRegionDefaults(studyRegion, { fullReplace: true });
  }

  useEffect(() => {
    if (!entry || templates.length === 0) return;
    const studyKey = studyId ?? -1;
    if (autoTemplateForStudyRef.current === studyKey) return;
    autoTemplateForStudyRef.current = studyKey;
    let match = pickStructuredTemplate(templates, entry.modality, entry.studyDescription);
    if (!match && studyRegion) {
      const bodyPart = studyRegionToBodyPart(studyRegion);
      const mod = templateCatalogModality(entry.modality);
      if (bodyPart) {
        match = templates.find(
          (t) => templateCatalogModality(t.modality) === mod && t.bodyPart === bodyPart,
        ) ?? null;
      }
    }
    if (match && match.id !== selectedTemplateId) {
      templateApplySourceRef.current = "auto";
      setSelectedTemplateId(match.id);
    }
  }, [entry, templates, selectedTemplateId, studyId, studyRegion]);

  // Auto-apply the region's default protocol once per study (after draft hydration).
  useEffect(() => {
    if (!entry || !quickSelectData || isLoadingExistingDraft) return;
    const studyKey = studyId ?? -1;
    if (autoProtocolForStudyRef.current === studyKey) return;
    if (existingDraft && hydratedDraftForStudyRef.current !== studyKey) return;
    autoProtocolForStudyRef.current = studyKey;
    if (technique.trim() || activeProtocol) return;
    const protocol = pickQuickProtocol(quickSelectData.protocols, studyRegion);
    if (protocol) applyProtocol(protocol, true);
  }, [entry, quickSelectData, isLoadingExistingDraft, existingDraft, studyId, studyRegion, technique, activeProtocol]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId]
  );

  const templateMismatch = useMemo(
    () => templateRegionMismatch(studyRegion, selectedTemplate?.bodyPart ?? null),
    [studyRegion, selectedTemplate?.bodyPart],
  );

  const applyCorrectStructuredTemplate = useCallback(() => {
    if (!entry || templates.length === 0) return;
    let match = pickStructuredTemplate(templates, entry.modality, entry.studyDescription);
    if (!match && studyRegion) {
      const bodyPart = studyRegionToBodyPart(studyRegion);
      const mod = templateCatalogModality(entry.modality);
      if (bodyPart) {
        match = templates.find(
          (t) => templateCatalogModality(t.modality) === mod && t.bodyPart === bodyPart,
        ) ?? null;
      }
    }
    if (!match) {
      toast({ title: "No matching template", description: "Pick a template from the Templates tab.", variant: "destructive" });
      return;
    }
    templateApplySourceRef.current = "manual";
    setSelectedTemplateId(match.id);
    toast({ title: "Template applied", description: match.templateName });
  }, [entry, templates, studyRegion, toast]);

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
    if (modalityFilter) {
      rows = rows.filter((t) => templateModalityMatches(modalityFilter, t.modality));
    }
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

  const statusLocked = STATUS_CONFIG[reportStatus]?.locked ?? false;
  // M1.6A — the editing gate: a finalized report OR a study actively locked
  // by another user is read-only. All existing disabled= paths hang off this.
  const isLocked = statusLocked || lockedByOther;

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
  /** M1.6B2 — focus a report editor via its data-editor attribute (same
   *  retry-until-stable pattern as focusQuickSearch; sections can remount). */
  function focusEditor(which: "findings" | "impression") {
    if (which === "impression" && impression.length === 0 && !isLocked) addImpressionLine();
    const selector = which === "findings"
      ? (useStructured ? '[data-editor="findings-section"]' : '[data-editor="findings"]')
      : '[data-editor="impression"]';
    let attempts = 0;
    const tryFocus = () => {
      const all = document.querySelectorAll<HTMLTextAreaElement>(selector);
      const el = all.length > 0 ? all[all.length - 1] : null;
      if (el && document.activeElement === el) return;
      el?.focus();
      if (++attempts < 10) window.setTimeout(tryFocus, 100);
    };
    window.setTimeout(tryFocus, 0);
  }
  /** The workspace's ONE "close the top panel" rule — Escape and the
   *  close-panel command share it. */
  function closeTopPanel() {
    if (showDiagnostics) setShowDiagnostics(false);
    else if (previewMode) setPreviewMode(false);
  }
  /** M1.6B2 — unpark: the current study if parked, else return to the oldest
   *  parked study (through the normal transition guards). */
  function unparkStudyCommand() {
    if (studyId != null && workflow.isParked(studyId)) {
      workflow.unpark(studyId);
      toast({ title: "Study unparked" });
      return;
    }
    const parkedNext = workflow.peekParked();
    if (!parkedNext) { toast({ title: "No parked studies" }); return; }
    if (!guardedLeave()) return;
    workflow.unpark(parkedNext.id);
    goToStudy(parkedNext);
  }
  // R2.0 — Ctrl+1..6 USG practical-template quick-select. No-op outside USG
  // mode or once the report is locked, same guard style as every other
  // command; picks the first catalog entry with this id (skips silently if
  // the catalog hasn't loaded / doesn't contain it — never throws).
  const USG_QUICK_TEMPLATE_BY_DIGIT: Record<string, string> = {
    "1": "WHOLE_ABDOMEN", "2": "KUB", "3": "OB_GROWTH",
    "4": "ARTERIAL_DOPPLER", "5": "BREAST", "6": "THYROID",
  };
  function selectUsgQuickTemplate(digit: string) {
    if (!isUltrasound || isLocked) return;
    const templateId = USG_QUICK_TEMPLATE_BY_DIGIT[digit];
    if (!templateId || !usgTemplates.some((t) => t.id === templateId)) return;
    void applyUsgTemplate(templateId);
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
    // M1.6B2 — same guard style as above; handlers own their guards.
    verify: () => { if (canShowVerify && !verifying) void verifyReport(); },
    unpark: () => unparkStudyCommand(),
    "reload-current": () => reloadCurrentStudy(),
    "focus-findings": () => focusEditor("findings"),
    "focus-impression": () => focusEditor("impression"),
    "close-panel": () => closeTopPanel(),
    // R2.0
    "select-template-1": () => selectUsgQuickTemplate("1"),
    "select-template-2": () => selectUsgQuickTemplate("2"),
    "select-template-3": () => selectUsgQuickTemplate("3"),
    "select-template-4": () => selectUsgQuickTemplate("4"),
    "select-template-5": () => selectUsgQuickTemplate("5"),
    "select-template-6": () => selectUsgQuickTemplate("6"),
  });

  // ── M1.6B2 — the voice execution adapter ──────────────────────────────────
  // Workflow intents dispatch through THE command dispatcher (no second
  // workflow path); edits go through the SAME setters/handlers buttons use.
  // The safety policy has already gated by lock/permission/mode; handlers
  // keep their own guards on top.

  function voiceDictate(intent: { target: "findings" | "impression" | "recommendation"; mode: "append" | "replace"; text: string }): VoiceExecutionResult {
    const text = normalizeDictationText(intent.text, { autoPunctuation: voiceSettings.autoPunctuation });
    if (!text) return { ok: false, message: "Nothing to insert" };
    if (intent.target === "findings") {
      const prev = rawFindings;
      setRawFindings(intent.mode === "replace" ? text : prev.trim() ? `${prev.replace(/\s+$/, "")}\n${text}` : text);
      return {
        ok: true, message: `${intent.mode === "replace" ? "Replaced" : "Appended to"} findings`,
        undo: () => setRawFindings(prev), undoLabel: "findings edit",
      };
    }
    if (intent.target === "impression") {
      const prev = impression;
      setImpression(intent.mode === "replace" ? [text] : [...prev, text]);
      return {
        ok: true, message: `${intent.mode === "replace" ? "Replaced" : "Appended to"} impression`,
        undo: () => setImpression(prev), undoLabel: "impression edit",
      };
    }
    const prev = recommendation;
    setRecommendation(intent.mode === "replace" ? text : prev.trim() ? `${prev.replace(/\s+$/, "")}\n${text}` : text);
    return {
      ok: true, message: `${intent.mode === "replace" ? "Replaced" : "Appended to"} recommendation`,
      undo: () => setRecommendation(prev), undoLabel: "recommendation edit",
    };
  }

  function voiceQuickSelect(action: "search" | "select" | "remove", term: string): VoiceExecutionResult {
    if (action === "search") {
      setQsExternalSearch((prev) => ({ seq: (prev?.seq ?? 0) + 1, term }));
      focusQuickSearch();
      return { ok: true, message: `Searching quick findings for “${term}”` };
    }
    const templates = quickFindingTemplatesRef.current;
    if (!templates?.length) return { ok: false, message: "Quick findings are not loaded yet — open the Quick tab once" };
    const norm = term.trim().toLowerCase();
    const pool = action === "remove" ? templates.filter((f) => selectedQuickIds.has(f.id)) : templates;
    let matches = pool.filter((f) => f.label.trim().toLowerCase() === norm);
    if (matches.length === 0) matches = pool.filter((f) => f.label.toLowerCase().includes(norm));
    if (matches.length === 0) {
      return { ok: false, message: action === "remove" ? `No selected finding matches “${term}”` : `No quick finding matches “${term}”` };
    }
    if (matches.length > 1) {
      return { ok: false, message: `Multiple findings match “${term}”: ${matches.slice(0, 3).map((f) => f.label).join(" · ")} — say the full name` };
    }
    const f = matches[0];
    const nowSelected = action === "select";
    if (nowSelected && selectedQuickIds.has(f.id)) return { ok: true, message: `“${f.label}” is already selected` };
    handleQuickToggle(f, nowSelected);
    return {
      ok: true, message: `${nowSelected ? "Selected" : "Removed"} “${f.label}”`,
      undo: () => handleQuickToggle(f, !nowSelected), undoLabel: `quick finding ${nowSelected ? "selection" : "removal"}`,
    };
  }

  function voiceQuickModifier(property: "side" | "severity" | "level", value: string): VoiceExecutionResult {
    const f = lastToggledFindingRef.current;
    if (!f || !selectedQuickIds.has(f.id)) {
      return { ok: false, message: "Select a quick finding first — the modifier applies to the last selected finding" };
    }
    const prevValue = quickInstances.get(f.id)?.[property] ?? "";
    handleInstanceUpdate(f, { [property]: value } as Partial<AbnormalityInstance>);
    return {
      ok: true, message: `Set ${property} = ${value} on “${f.label}”`,
      undo: () => handleInstanceUpdate(f, { [property]: prevValue } as Partial<AbnormalityInstance>),
      undoLabel: `${property} change`,
    };
  }

  function voiceViewer(op: ViewerOp): VoiceExecutionResult {
    const h = embeddedViewerRef.current;
    if (!h) return { ok: false, message: "Embedded viewer is not open for this study" };
    const ops: Record<ViewerOp, () => void> = {
      "next-image": h.nextFrame, "previous-image": h.prevFrame,
      "zoom-in": h.zoomIn, "zoom-out": h.zoomOut, "reset-view": h.resetView,
    };
    ops[op]();
    return { ok: true, message: describeIntent({ type: "viewer", op }) };
  }

  function executeVoiceCommand(parse: ParsedVoiceCommand): VoiceExecutionResult {
    const intent = parse.intent;
    if (!intent) return { ok: false, message: "Nothing to execute" };
    switch (intent.type) {
      case "cancel":
        return { ok: true, message: "Cancelled" };
      case "workflow": {
        // Spoken park reason (possibly "") skips the prompt; cleared right
        // after — dispatch invokes the handler synchronously.
        if (intent.command === "park") voiceParkReasonRef.current = intent.reason ?? "";
        const res = commandDispatcher.dispatch(intent.command);
        if (intent.command === "park") voiceParkReasonRef.current = null;
        return res.executed
          ? { ok: true, message: describeIntent(intent) }
          : { ok: false, message: `Command not available (${res.reason ?? "unknown"})` };
      }
      case "dictate": return voiceDictate(intent);
      case "quick-select": return voiceQuickSelect(intent.action, intent.term);
      case "quick-modifier": return voiceQuickModifier(intent.property, intent.value);
      case "combination": return voiceCombination(intent.term);
      case "viewer": return voiceViewer(intent.op);
      case "viewer-unsupported": return { ok: false, message: `The embedded viewer does not support ${intent.capability}` };
      // Session-control intents (M1.6B3) are handled inside useVoiceSession
      // and never dispatched here — defensive no-ops only.
      case "confirm": return { ok: false, message: "Nothing to confirm" };
      case "handsfree": return { ok: false, message: "Hands-free is controlled from the voice bar" };
    }
  }

  const voice = useVoiceSession({
    studyId,
    settings: voiceSettings,
    capabilities: voiceCapabilities,
    getContext: () => ({
      studyId: studyId ?? null,
      dirty,
      isLocked,
      lockedByOther,
      lockLost,
      canVerify: canShowVerify,
      structuredFindings: useStructured,
      viewerAvailable: embeddedViewerRef.current != null,
      confirmationPolicy: voiceSettings.confirmationPolicy,
    }),
    execute: executeVoiceCommand,
    // Phase 11 — minimal metadata only: command type, study, outcome. The
    // server derives the actor from the session; no transcript is ever sent.
    onAudit: (commandType, outcome) => {
      if (studyId == null) return;
      void api.post("/api/radiology/voice-command-audit", { commandType, studyId, outcome }).catch(() => undefined);
    },
  });

  // Keyboard shortcuts (M1.4 Phase 11 + M1.5 Phase 8) — matching rules live
  // in lib/workspaceReportState.matchWorkspaceShortcut; actions route through
  // the command dispatcher. Re-attached per render so handlers see current
  // state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // PR #77 — Ctrl/Cmd+K opens the universal command palette from ANYWHERE in
      // the workspace (including inside the editors). While it is open it owns
      // the keyboard, so nothing below double-handles the same keystroke.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (paletteOpen) return;

      // PR #80 Part 12 — Tab accepts the Copilot's inline next-sentence
      // completion, GitHub-Copilot-style, but ONLY when the Findings editor is
      // focused and a suggestion is showing. Otherwise Tab keeps its normal
      // focus-traversal behaviour.
      if (e.key === "Tab" && !e.shiftKey && copilotCompletion
        && document.activeElement === (findingsTextareaRef.current?.el ?? null)) {
        e.preventDefault();
        acceptCopilotCompletion();
        return;
      }

      // M1.6B2 — voice keys FIRST (Ctrl+Space toggle, Space push-to-talk
      // outside editors, Enter confirms a non-finalize preview, Escape
      // cancels an ACTIVE voice capture/preview). Null falls through to the
      // pinned M1.4/M1.5 shortcut matrix unchanged.
      const action = voiceKeyAction(
        {
          key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
          shiftKey: e.shiftKey, repeat: e.repeat,
          target: e.target as { tagName?: string; isContentEditable?: boolean } | null,
        },
        {
          enabled: voice.enabled,
          pttKey: voiceSettings.pttKey,
          capturing: voice.capturing,
          hasPendingPreview: voice.pending != null,
          confirmViaEnterAllowed: voice.pending?.verdict.confirmViaEnterAllowed ?? false,
        },
      );
      if (action) {
        e.preventDefault();
        if (action === "toggle-listen") voice.toggleListening();
        else if (action === "ptt-start") voice.startListening("ptt");
        else if (action === "confirm-pending") voice.confirmPending("enter");
        else voice.cancel();
        return;
      }
      const shortcut = matchWorkspaceShortcut({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey,
        target: e.target as { tagName?: string } | null,
      });
      if (!shortcut) return;
      if (shortcut === "escape") {
        closeTopPanel();
        return;
      }
      // Layout redesign — panel/viewer toggles route to the resizable-panel
      // handles + layout mode directly (component-local refs/state), not the
      // command dispatcher.
      if (shortcut === "toggle-left-panel") {
        e.preventDefault();
        if (isLeftPanelCollapsed) leftPanelRef.current?.expand();
        else leftPanelRef.current?.collapse();
        return;
      }
      if (shortcut === "toggle-right-panel") {
        e.preventDefault();
        if (isRightPanelCollapsed) rightPanelRef.current?.expand();
        else rightPanelRef.current?.collapse();
        return;
      }
      if (shortcut === "toggle-viewer") {
        e.preventDefault();
        // Show the embedded viewer (Split) when it's currently hidden,
        // otherwise hide it (Report Focus). Mirrors the mode selector — one
        // source of truth (layoutMode), no parallel viewer-visibility flag.
        setLayoutMode(showEmbeddedViewer ? "reportFocus" : "split");
        return;
      }
      if (shortcut === "focus-mode") {
        e.preventDefault();
        enterReportingFocusMode();
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
    // Releasing Space ends a push-to-talk capture (start is keydown above).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " && voice.captureTrigger === "ptt") voice.stopListening();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // ── M1.4 — lifecycle / amendment metadata (Phase 9, D8/D9 read-only) ─────
  // The linked patient_reports row: freshly finalized in this session, or
  // referenced by the worklist entry, or the row a structured finalize
  // promoted this draft into. GET /:id resolves to the LATEST version (D8)
  // and carries additive `version` + `lifecycle` metadata (D8/D9).
  const linkedReportId = finalizedReportId ?? entry?.reportId ?? existingDraft?.finalReportId ?? null;

  // R1.1 — load the canonical server-rendered document for the preview panel.
  useEffect(() => {
    if (!previewMode) return;
    const templateQs = reportLayoutTemplateQuery(previewLayout);
    const url = linkedReportId
      ? `/api/patient-reports/${linkedReportId}/print?preview=true&${templateQs}`
      : draftId
        ? `/api/radiology/report-generator/drafts/${draftId}/print-preview?${templateQs}`
        : null;
    if (!url) { setServerPreviewHtml(null); return; }
    let cancelled = false;
    api.get<string>(url)
      .then((html) => { if (!cancelled) setServerPreviewHtml(typeof html === "string" ? html : null); })
      .catch(() => { if (!cancelled) setServerPreviewHtml(null); });
    return () => { cancelled = true; };
  }, [previewMode, draftId, linkedReportId, previewRefreshToken, previewLayout]);

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

  // R1.1 — the images selected in the Report Images panel below, persisted
  // as DICOM references. Reuses the SAME query key ReportImagePicker/
  // ReportImagePanel already use, so this never issues a second network
  // round trip when that panel is open. Feeds buildPreviewHtml() below (so
  // Preview/finalize/Word export all show them) and the PDF export further
  // down — previously this was a local useState([]) with no setter, so the
  // selected images never reached any of those artifacts.
  const { data: imageRefs = [] } = useQuery<ReportImageRef[]>({
    queryKey: ["report-image-references", draftId],
    queryFn: () => api.get(`/api/radiology/report-generator/image-references?draftId=${draftId}`),
    enabled: !!draftId,
  });

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

  // The clinic composes final reports in Word, not this app's structured
  // builder — every finalize here runs the LEGACY path (see the banner
  // below). This exports the SAME content already shown in the Preview pane
  // above (previewHtml, from the exact same buildPreviewHtml() call this
  // memo makes) as a .docx starting point, so a radiologist can continue
  // from what they already typed here instead of retyping it in Word.
  async function handleExportWord() {
    setExportingWord(true);
    try {
      const fileName = `${safeFileNamePart(entry?.patientName || "patient")}_${safeFileNamePart(entry?.accessionNumber || "report")}`;
      await exportRadiologyReportToWord(previewHtml, fileName);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not build the Word document",
        variant: "destructive",
      });
    } finally {
      setExportingWord(false);
    }
  }

  // Real PDF (jsPDF, via reportPdfGenerator.ts — the same generator already
  // used in production by USG/Echo/Fetal reporting), including whatever
  // images are currently selected in the Report Images panel below (the
  // SAME imageRefs query above feeds this — no second network round trip).
  const { data: clinicSettings } = useQuery({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });
  const { data: pdfViewerLaunch } = useQuery<{ dicomWebBaseUrl?: string | null }>({
    queryKey: ["viewer-launch", entry?.studyInstanceUID],
    queryFn: () => api.get(`/api/radiology/studies/${encodeURIComponent(entry!.studyInstanceUID!)}/ohif-launch`),
    enabled: !!entry?.studyInstanceUID,
    staleTime: 5 * 60_000,
  });

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      await exportRadiologyReportToPdf({
        patientName: entry?.patientName || "",
        age: entry?.age || "",
        sex: entry?.sex || "",
        accessionNumber: entry?.accessionNumber || "",
        studyDate: entry?.studyDate || "",
        referringDoctor: entry?.referringDoctor || "",
        modality: entry?.modality || "",
        bodyPart: entry?.studyDescription || "",
        clinicalHistory,
        technique,
        useStructured,
        findingsMap,
        rawFindings,
        impression,
        recommendation,
        studyName: selectedTemplate?.templateName || entry?.studyDescription || "Radiology Report",
        headingCase,
        dicomWebBase: pdfViewerLaunch?.dicomWebBaseUrl ?? null,
        imageRefs,
        clinic: clinicSettings ?? null,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not build the PDF",
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  }

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
      const res = await queryAiReporting({
        promptText: `As a radiologist, generate a numbered, clinically relevant impression from these findings. Be concise.\n\nFindings:\n${findingsAsText()}\n\nClinical History: ${clinicalHistory}\nModality: ${entry.modality}\nStyle: ${stylePrefs.impressionStyle}`,
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
    // Never overwrite an impression the radiologist has already written without
    // confirmation (Phase 9 AI-impression safety rule).
    if (impression.some((l) => l.trim()) &&
        !window.confirm("Replace the current impression with the AI-generated impression?")) {
      return;
    }
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
    // MRI PR 5 — fail clearly (not confusingly) when offline; the local autosave
    // has the text either way, so nothing is lost.
    const offline = offlineBlockMessage(isOnline, "save");
    if (offline) {
      toast({ title: "Offline", description: offline, variant: "destructive" });
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
      const savedFindings = deriveQuickSelectFindings(selectedQuickIds, quickInstances, structuredValuesRef.current);
      // MRI PR 5 — a transient network blip retries with backoff before it
      // becomes a "Save Failed" toast; non-transient errors still fail fast.
      const res = await retryWithBackoff(() => saveRadiologyDraft<{ success: boolean; draft: { id: number } & Record<string, unknown> }>(
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
      ), { shouldRetry: isTransientError });
      captureSavedDraftId(res.draft.id);
      // R1.4 — force the preview effect to refetch even though draftId is
      // unchanged on every save after the first (see previewRefreshToken).
      setPreviewRefreshToken((n) => n + 1);
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
    // M1.6A — ownership gate (the server re-checks; this keeps the failure
    // early and the message clear). Draft text is never touched either way.
    if (lockedByOther) {
      toast({ title: "Cannot finalize", description: `${lockStatusMessage("locked-by-other", studyLock.ownerName)}.`, variant: "destructive" });
      return;
    }
    if (lockLost) {
      toast({ title: "Cannot finalize", description: "Your study lock expired — reclaim the study first. Your text is preserved.", variant: "destructive" });
      return;
    }
    // PCPNDT gate (see isPcpndtRelevantUsg/pcpndtBlocked above). Blocks only
    // when the patient's Form F is genuinely missing/incomplete — a
    // compliant obstetric study finalizes here normally now, and the server
    // re-verifies with the same shared check regardless. This single client
    // enforcement point also covers the Ctrl+Enter / Command Palette
    // "finalize" dispatcher, which calls finalizeReport() directly and would
    // otherwise bypass a disabled Finalize button. Draft save / print /
    // preview are unaffected; only finalize is gated.
    if (pcpndtBlocked) {
      const missing = pcpndtCompliance?.errors?.length
        ? ` Missing: ${pcpndtCompliance.errors.join(" ")}`
        : "";
      toast({
        title: "Finalize blocked — PCPNDT Form F required",
        description:
          `This is an obstetric/fetal ultrasound and the patient's PCPNDT Form F record is missing or incomplete.${missing} Use "Review & Map to Form F" (Measurements tab) to complete and verify Form F, then finalize again — this page rechecks automatically. Your draft is unaffected and remains saved.`,
        variant: "destructive",
      });
      return;
    }
    // MRI PR 5 — never begin a sign flow offline (the save-before-sign would
    // fail mid-way); block clearly with the work preserved locally.
    const offlineFinal = offlineBlockMessage(isOnline, "finalize");
    if (offlineFinal) {
      toast({ title: "Offline", description: offlineFinal, variant: "destructive" });
      return;
    }
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
      const warnings = validateReport({
        findings: rawFindings, impression, recommendation, technique, clinicalHistory,
        sex: entry?.sex, age: entry?.age, modality: entry?.modality, studyDescription: entry?.studyDescription,
      });

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
      // MRI PR 3 — pre-finalization safety checks (protocol completeness +
      // critical-result handling), composed by the pure aggregator and surfaced
      // in this SAME confirm dialog. Advisory: it never blocks — clicking OK is
      // the radiologist's decision, exactly as before.
      const safetyInput = {
        checklistActive: !!activeProtocol,
        checklistPercent,
        checklistRemaining,
        missingRequiredMeasurements,
        criticalHits,
        criticalMarked: isCritical,
        criticalCommunicated: checklistComm.phoned,
      };
      const safetyBlock = formatFinalizeSafety(computeFinalizeSafety(safetyInput));
      const criticalRequiresAck = criticalFindingBlocksFinalize(safetyInput);
      // Unbilled study: the report row cannot be created (test_id NOT NULL) —
      // say so BEFORE the radiologist commits, not after.
      const unbilledNote = entry.patientId && !entry.studyId
        ? "\nNote: no billed test is linked to this study — the worklist will be marked final, but no patient-facing report row can be created.\n"
        : "";

      // Structured quality advisory (analysis item 3): when the flag is on,
      // surface structured validation failures more prominently in the dialog.
      const qualityAdvisory = isFeatureEnabled("ff_radiology_quality_advisory");
      const advisoryExtra = qualityAdvisory && blockingErrors.length > 0
        ? `\nQuality advisory (non-blocking until structured_final is enabled):\n${blockingErrors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}\n`
        : "";

      let signatures: { id: number; name: string; isActive?: boolean }[] = [];
      try {
        const rows = await api.get<Array<{ id: number; name: string; isActive?: boolean }>>("/api/signatures");
        signatures = (rows ?? []).filter((s) => s.isActive !== false).map((s) => ({ id: s.id, name: s.name }));
      } catch {
        signatures = [];
      }

      const promptResult = await finalizeFlow.promptFinalize({
        identity,
        validationSummary: validationSummary + advisoryExtra,
        warningBlock,
        safetyBlock,
        unbilledNote,
        signatures,
        criticalRequiresAck,
        criticalSummary: criticalHits.map((h) => h.label).join(", ") || criticalNote || undefined,
      });
      confirmed = promptResult.confirmed;
      if (!confirmed) return;
      finalizeSignerRef.current = {
        signatureId: promptResult.signatureId,
        notifyReferring: promptResult.notifyReferring,
      };
      if (promptResult.criticalAcknowledged && !isCritical) {
        setIsCritical(true);
      }
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
      const { reportId, structuredFinal, reportCreationSkipped: skippedReason, signed, signError } = await finalizeRadiologyReport(
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
          signatureId: finalizeSignerRef.current.signatureId,
          // F7 (Cockpit→Workspace merge): durable record of the quality
          // warnings that existed and how the critical finding (if any) was
          // communicated at the moment of signing. `auditDetails` is already
          // forwarded verbatim by finalizeRadiologyReport — no new transport.
          auditDetails: {
            qualityScore: quality.score,
            qualityIssues: quality.issues,
            measurementSafetyIssues: measurementSafetyIssues.map((i) => ({ severity: i.severity, message: i.message })),
            criticalFinding: isCritical ? { note: criticalNote, communication: checklistComm } : null,
            notifyReferring: finalizeSignerRef.current.notifyReferring,
          },
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
      // MRI PR 5 — the signed report supersedes any session-expiry rescue draft.
      clearRescueDraft();
      setRescueDraft(null);
      // Surface the TRUE finalize path (Phase 8) — never claim a structured
      // sign that did not happen. R1.4 — never claim "Finalized" as a
      // completed, deliverable document unless it is actually signed: an
      // unsigned report cannot be verified, shared, or downloaded by the
      // patient, so a false "Finalized" claim used to leave reports silently
      // stuck at status=draft with no indication anything further was needed.
      const signedStructured = structuredFinal?.signed === true;
      const legacyFallback = structuredFinal?.signed === false;
      const needsAttention = !signed || legacyFallback || !!skippedReason;
      toast({
        title: signedStructured
          ? "Report Finalized — structured document signed"
          : signed
            ? "Report Finalized and Signed"
            : "Report saved but NOT signed",
        description: skippedReason
          ? `Worklist marked final, but NO patient report row was created: ${skippedReason}.`
          : !signed
            ? `${signError ?? "Signing failed"} — the report will not be deliverable until it is signed from Report Hub.`
            : legacyFallback
              ? `Signed via LEGACY path: ${typeof structuredFinal?.reason === "string" ? structuredFinal.reason : "structured signing unavailable"}`
              : reportId ? `Report ID: ${reportId}` : "Worklist updated.",
        ...(needsAttention ? { variant: "destructive" as const } : {}),
      });
      void qc.invalidateQueries({ queryKey: ["workspace-entry", studyId] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
      // Lifecycle metadata for the fresh report (Phase 8: refresh
      // report/version metadata, preserve access to the signed report).
      void qc.invalidateQueries({ queryKey: ["workspace-final-report"] });
      void qc.invalidateQueries({ queryKey: ["radiology-existing-draft", studyId] });

      // Critical finding: optional notify referring doctor (best-effort).
      if (finalizeSignerRef.current.notifyReferring && (isCritical || criticalHits.length > 0) && reportId) {
        void api.post(`/api/patient-reports/${reportId}/acknowledge-critical`, {
          note: criticalNote || criticalHits.map((h) => h.label).join(", "),
          notifyReferring: true,
        }).catch(() => {
          toast({
            title: "Critical ack saved locally",
            description: "Referring-doctor notify could not be sent — complete from Critical Findings / Report Hub.",
            variant: "destructive",
          });
        });
      }

      // Reading session mode: auto-advance to next eligible study.
      if (readingSession.enabled) {
        setReadingSession((prev) => bumpSessionCompleted(prev));
        window.setTimeout(() => nextStudy(), 400);
      }
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
    // M1.6A — leaving safely (guards passed) releases our lock; a failed
    // release is harmless because expiry is authoritative.
    studyLock.release(studyId);
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
    studyLock.release(studyId);
    const targetId = workflow.beginPreviousTransition(studyId);
    if (targetId == null) return;
    navigate(`/radiology/report/${targetId}`);
  }

  // ── Command Palette run handlers (PR #77) ───────────────────────────────────
  /** Clear all Findings + Impression (structured sections revert to their
   *  baseline normals); clinical history and technique are kept. Destructive →
   *  confirmed. */
  function clearFindings() {
    if (isLocked) return;
    if (!window.confirm("Clear all findings and impression? Clinical history and technique are kept.")) return;
    setRawFindings("");
    setSelectedQuickIds(new Set());
    setQuickInstances(new Map());
    insertedTextRef.current = new Map();
    sectionContribRef.current = new Map();
    structuredValuesRef.current = new Map();
    setImpression([]);
    if (selectedTemplate) {
      const base = currentBaseline();
      setFindingsMap(Object.fromEntries(base.map((b) => [b.label, { normal: true, text: b.normal }])));
    } else {
      setFindingsMap({});
    }
  }

  /** Palette "Commands" → the workspace's existing actions. Most route through
   *  the SAME commandDispatcher the keyboard shortcuts use (no second path). */
  function runPaletteCommand(action: string) {
    switch (action) {
      case "generate-impression": if (entry && !aiLoading) aiImpressionMutation.mutate(); break;
      case "clear-findings": clearFindings(); break;
      case "compare-previous": setRightTab("prior"); break;
      case "new-brain-report":
      case "new-ls-report": navigate("/radiology/worklist"); break;
      default: commandDispatcher.dispatch(action); break; // save | finalize | next | previous | open-viewer | focus-findings | focus-impression
    }
  }

  /** Run one palette item through the workspace's existing handlers, remember it
   *  for the Recent list, and close the palette. */
  function runPaletteItem(item: PaletteItem) {
    switch (item.kind) {
      case "finding": handleFindingClick(item.payload as QuickFinding); break;
      case "protocol": requestProtocolChange(item.payload as QuickProtocol); break;
      case "template": {
        const p = item.payload as { kind: "structured" | "master"; template: StructuredTemplate | MasterTemplate };
        if (p.kind === "structured") setSelectedTemplateId((p.template as StructuredTemplate).id);
        else handleApplyMasterTemplate(p.template as MasterTemplate);
        break;
      }
      case "history": toggleClinicalHistoryChip(item.payload as QuickClinicalHistoryChip); break;
      case "study": {
        const s = item.payload as QueueStudy;
        if (s.id !== studyId && guardedLeave()) goToStudy(s);
        break;
      }
      case "combination": applyCombination(item.payload as StudyCombination); break;
      case "command": runPaletteCommand(item.id.replace(/^command:/, "")); break;
      case "setting": navigate(item.id.replace(/^setting:/, "")); break;
    }
    markPaletteRecent(item.id);
    setPaletteOpen(false);
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
    // M1.6B2 — a spoken reason (possibly "") skips the prompt; button/keyboard
    // parks still prompt exactly as before.
    const voiceReason = voiceParkReasonRef.current;
    const reason = voiceReason !== null ? voiceReason : window.prompt("Park this study — reason (optional):", "");
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

  // R1.1 — print the CANONICAL server artifact (the exact document every
  // delivery surface produces), not the on-screen editing preview. A
  // finalized report prints its patient-reports artifact; a draft prints the
  // shared-layer draft preview (DRAFT watermark). Falls back to the local
  // preview only when nothing is saved yet.
  //
  // R1.4 — the popup window is now opened SYNCHRONOUSLY, before any await:
  // opening it only after `await api.get(...)` resolves put the call outside
  // the click handler's synchronous call stack, so browsers that require a
  // fresh user gesture for window.open (Safari in particular, and Chrome
  // once the post-gesture window elapses on a slow request) silently
  // blocked the popup with no error shown — clicking Print did nothing
  // visible at all. A blocked popup is now a visible toast, not silence.
  async function printReport() {
    const w = window.open("", "_blank");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" });
      return;
    }
    const templateQs = reportLayoutTemplateQuery(previewLayout);
    const url = linkedReportId
      ? `/api/patient-reports/${linkedReportId}/print?${templateQs}`
      : draftId
        ? `/api/radiology/report-generator/drafts/${draftId}/print-preview?autoPrint=true&${templateQs}`
        : null;
    if (url) {
      try {
        const html = await api.get<string>(url);
        w.document.write(html); // artifact carries its own auto-print script
        w.document.close();
        w.focus();
        return;
      } catch {
        toast({ title: "Server print failed — using local preview", variant: "destructive" });
      }
    }
    if (!previewRef.current) { w.close(); return; }
    w.document.write(
      `<html><head><title>Radiology Report</title></head><body>${previewRef.current.innerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 250);
  }

  /** Draft preview without the large DRAFT watermark — layout check before sign. */
  async function printReportLikeFinal() {
    if (linkedReportId) {
      return printReport();
    }
    const w = window.open("", "_blank");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups for this site to print.", variant: "destructive" });
      return;
    }
    if (!draftId) {
      w.close();
      toast({ title: "Save draft first", description: "Print-like-final needs a saved draft.", variant: "destructive" });
      return;
    }
    const templateQs = reportLayoutTemplateQuery(previewLayout);
    const url = `/api/radiology/report-generator/drafts/${draftId}/print-preview?autoPrint=true&likeFinal=true&${templateQs}`;
    try {
      const html = await api.get<string>(url);
      w.document.write(html);
      w.document.close();
      w.focus();
    } catch {
      w.close();
      toast({ title: "Print preview failed", variant: "destructive" });
    }
  }

  // Was posting to /api/whatsapp/send-report, which does not exist — every
  // click 404'd. The real send path is the same /:id/share endpoint the
  // report-hub's Share dialog already uses (patient-reports.ts), which
  // needs a finalized report id (it requires the row to be verified or
  // delivered) and falls back to the patient's phone on file when no
  // explicit recipient is given.
  async function shareWhatsApp() {
    if (!linkedReportId) {
      toast({ title: "Finalize the report first", description: "WhatsApp delivery needs a signed report.", variant: "destructive" });
      return;
    }
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/api/patient-reports/${linkedReportId}/share`, {
        channel: "whatsapp",
      });
      if (!result.ok) {
        toast({ title: "Failed", description: result.error || "WhatsApp send failed", variant: "destructive" });
        return;
      }
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

        {/* R2.0 — practical USG templates (Whole Abdomen/KUB/Pregnancy/
            Doppler/Prostate/Scrotum/Thyroid/Breast/Soft Tissue/...), a
            separate confidence-gated-autofill catalog from the structured
            templates above. Shown ONLY in USG mode. */}
        {isUltrasound && usgTemplates.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              USG Templates
            </div>
            <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto">
              {usgTemplates.map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  variant="outline"
                  className="h-auto py-1.5 text-left justify-start px-2 flex-col items-start gap-0"
                  onClick={() => applyUsgTemplate(t.id)}
                  disabled={isLocked || applyingUsgTemplateId === t.id}
                >
                  <span className="text-xs font-medium">{t.label}</span>
                  <span className="text-[10px] opacity-70">{t.category}</span>
                </Button>
              ))}
            </div>
          </>
        )}

        {/* E1: Master Library (Phase-F winner catalog) — additive, filtered to
            the current study's modality, content-only apply. Renders only when
            the catalog is non-empty. */}
        {masterTemplates.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pt-1">
              Master Library
            </div>
            <div className="flex flex-wrap gap-1.5">
              {masterTemplates
                .filter((m) => {
                  if (!entry?.modality) return true;
                  return templateModalityMatches(entry.modality, m.modality);
                })
                .slice(0, 12)
                .map((m) => (
                  <Button
                    key={`master-${m.id}`}
                    size="sm"
                    variant="outline"
                    title={`${m.groupName.replace(/_/g, " ")}${m.bodyPart ? " · " + m.bodyPart : ""}`}
                    onClick={() => handleApplyMasterTemplate(m)}
                    disabled={isLocked}
                    className="h-7 text-[10px]"
                  >
                    {m.templateName}
                  </Button>
                ))}
            </div>
          </>
        )}

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
            <div className="text-xs text-muted-foreground text-center py-3 space-y-1">
              <div>No templates found{modalityFilter ? ` for ${modalityFilter}` : ""}.</div>
              <div>Try the <button type="button" className="underline font-medium text-foreground" onClick={() => setRightTab("quickselect")}>Quick</button> tab for one-click findings, or tap <span className="font-medium">All</span> above to clear the modality filter.</div>
            </div>
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

        {/* Favourite + recently-used templates/findings/macros — already
            DB-backed (user_report_preferences + usage-frequency log);
            surfacing it here gives every modality (USG included) "favourite
            and recently used templates first" without inventing new state. */}
        <div className="pt-1 border-t">
          <PreferencesPanel
            currentUserId={session?.user.id ?? null}
            onApplyTemplate={(templateName) => {
              const usgMatch = usgTemplates.find((t) => t.label === templateName);
              if (usgMatch) { void applyUsgTemplate(usgMatch.id); return; }
              const structuredMatch = templates.find((t) => t.templateName === templateName);
              if (structuredMatch) {
                templateApplySourceRef.current = "manual";
                setSelectedTemplateId(structuredMatch.id);
              }
            }}
            onInsertFindingText={(text) => setRawFindings((prev) => mergeBlock(prev, text))}
            onInsertImpressionPoint={(text) => setImpression((prev) => mergeImpression(prev, text))}
          />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const unifiedInboxExtras = useMemo(
    () => buildUnifiedInboxExtras({
      measurementSafetyIssues,
      comparisonSectionMissing,
      checklistRemaining,
      qualityIssues: quality.issues,
    }),
    [measurementSafetyIssues, comparisonSectionMissing, checklistRemaining, quality.issues],
  );

  // Live items only count when auto-analyse is on; the whole tab hides when the
  // radiologist disables the Copilot (Settings in the panel header).
  // Panel = deterministic items (when live-analyse is on) + unified inbox extras
  // (measurement safety, prior comparison, checklist, quality) + AI items.
  const copilotPanelReport = useMemo(() => ({
    ...copilotReport,
    items: mergeCopilotItems(
      [...(copilotPrefs.autoAnalyze ? copilotReport.items : []), ...aiCopilotItems],
      unifiedInboxExtras,
    ),
  }), [copilotReport, copilotPrefs.autoAnalyze, aiCopilotItems, unifiedInboxExtras]);
  const copilotInboxCount = copilotPanelReport.items.filter(
    (i) => !copilotEffectiveDismissed.has(i.id),
  ).length;
  const copilotAlerts = copilotPanelReport.items.filter(
    (i) => !copilotEffectiveDismissed.has(i.id) && (i.severity === "critical" || i.severity === "warning"),
  ).length;
  const RIGHT_TABS = [
    ...(copilotPrefs.enabled ? [{ id: "copilot", label: "Copilot", icon: <Sparkles size={14} />, badge: copilotInboxCount }] : []),
    { id: "quickselect", label: "Quick", icon: <Zap size={14} /> },
    { id: "library", label: "Library", icon: <Library size={14} /> },
    { id: "templates", label: "Templates", icon: <LayoutTemplate size={14} /> },
    { id: "followup", label: "Follow-up", icon: <RefreshCw size={14} /> },
    { id: "prior", label: "Prior", icon: <ClipboardList size={14} /> },
    { id: "ai", label: "AI", icon: <Sparkles size={14} /> },
    { id: "measurements", label: "Measure", icon: <BarChart3 size={14} /> },
    { id: "knowledge", label: "Knowledge", icon: <Brain size={14} /> },
    { id: "diff", label: "Diff", icon: <GitCompare size={14} /> },
    { id: "print", label: "Print", icon: <FileText size={14} /> },
    { id: "teaching", label: "Teaching", icon: <BookOpen size={14} /> },
  ];
  // HERO_ACCENT — distinct accent color for the 4 most-used tabs (Copilot/
  // Quick/AI/Templates) in the compact ribbon below; looked up by id so a
  // tab simply gets the default neutral accent when not listed here (e.g.
  // Copilot disappearing entirely when copilotPrefs.enabled is false doesn't
  // require any shifting logic elsewhere).
  const HERO_ACCENT: Record<string, { card: string; chip: string; text: string }> = {
    copilot: {
      card: "border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30",
      chip: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800",
      text: "text-indigo-900 dark:text-indigo-200",
    },
    quickselect: {
      card: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
      chip: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800",
      text: "text-amber-900 dark:text-amber-200",
    },
    ai: {
      card: "border-purple-300 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/30",
      chip: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-800",
      text: "text-purple-900 dark:text-purple-200",
    },
    templates: {
      card: "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30",
      chip: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800",
      text: "text-blue-900 dark:text-blue-200",
    },
  };

  return (
    <div className="flex flex-col" style={{ height: chromeCollapsed ? "calc(100vh - 36px)" : "calc(100vh - 48px)" }}>
      {/* Phase P3 — feature-flagged AI draft panel. Renders nothing unless AI is
          enabled AND visible for this radiologist (pilot/production); default OFF.
          Accept inserts into the EXISTING findings editor (setRawFindings), which
          the existing autosave persists to radiology_report_drafts — the AI never
          writes the draft store, patient_reports, or signs. */}
      <AiDraftPanel
        studyInstanceUid={entry?.studyInstanceUID ?? null}
        modality={entry?.modality ?? null}
        onInsertText={(text) => setRawFindings((prev) => appendToFindings(prev, text))}
      />

      <ReportingWorkspaceChrome
        collapsed={chromeCollapsed}
        onCollapsedChange={setChromeCollapsed}
        onEnterFocusMode={enterReportingFocusMode}
        onBackToWorklist={() => {
          studyLock.release(studyId);
          navigate("/radiology/worklist");
        }}
        patientBanner={entry
          ? `${entry.patientName}${(entry.age || entry.sex) ? ` · ${[entry.age, entry.sex].filter(Boolean).join("/")}` : ""} · ${entry.accessionNumber}${entry.modality ? ` · ${entry.modality}` : ""}`
          : undefined}
        reportStatusLabel={STATUS_CONFIG[reportStatus]?.label || reportStatus}
        reportStatusClass={STATUS_CONFIG[reportStatus]?.color || ""}
        isOnline={isOnline}
        isLoadingDraft={!!studyId && isLoadingExistingDraft}
        hasExistingDraft={!!existingDraft}
        dirty={dirty}
        lastSavedAt={lastSavedAt}
        useStructured={useStructured}
        onStructuredChange={setUseStructured}
        structuredDisabled={isLocked}
        layoutMode={layoutMode}
        layoutModeOptions={LAYOUT_MODE_OPTIONS}
        onLayoutModeChange={(mode) => setLayoutMode(mode as WorkspaceLayoutMode)}
        isLeftPanelCollapsed={isLeftPanelCollapsed}
        isRightPanelCollapsed={isRightPanelCollapsed}
        onToggleLeftPanel={() => { if (isLeftPanelCollapsed) leftPanelRef.current?.expand(); else leftPanelRef.current?.collapse(); }}
        onToggleRightPanel={() => { if (isRightPanelCollapsed) rightPanelRef.current?.expand(); else rightPanelRef.current?.collapse(); }}
        readingSessionEnabled={readingSession.enabled}
        readingSessionDone={readingSession.completedInSession}
        onToggleReadingSession={() => setReadingSession((prev) => toggleReadingSession(prev))}
        workflow={workflow}
        studyId={studyId ?? 0}
        parkedReason={workflow.parked.find((p) => p.id === studyId)?.reason ?? undefined}
        saving={saving}
        finalizing={finalizing}
        studyLock={studyLock}
        viewerBusy={viewerLaunch.busy}
        viewerConnected={!!(viewerLaunch.lastResult?.success && viewerLaunch.lastResult.selectedNetworkMode)}
        viewerNetworkMode={viewerLaunch.lastResult?.selectedNetworkMode ?? undefined}
        queueScope={queueScope}
        onQueueScopeChange={(scope) => changeQueueScope(parseQueueScope(String(scope)))}
        radiologists={radiologists}
        queueFilterText={queueFilterText}
        onQueueFilterTextChange={setQueueFilterText}
        queueModalityFilter={queueModalityFilter}
        onQueueModalityFilterChange={setQueueModalityFilter}
        queueDateFrom={queueDateFrom}
        queueDateTo={queueDateTo}
        onQueueDatePreset={setQueueDatePreset}
        jumpQueue={jumpQueue}
        onJumpStudy={(id) => {
          const row = workflow.queue.find((s) => s.id === id);
          if (!row || row.id === studyId) return;
          if (!guardedLeave()) return;
          goToStudy(row);
        }}
        onPreviousStudy={() => previousStudy()}
        onNextStudy={() => nextStudy()}
        onParkStudy={() => parkCurrentStudy()}
        onRefreshQueue={() => refreshQueueAndCurrent()}
        onReloadStudy={() => reloadCurrentStudy()}
        hasEntry={!!entry}
        voiceBar={voiceSettings.enabled ? <VoiceCommandBar voice={voice} /> : undefined}
      />

      {/* ── 3-column body — resizable via drag (react-resizable-panels), plus
          collapsible left/right panels. Widths + collapse state persist per
          radiologist per layout mode (layoutPrefs above); the panels stay
          mounted across mode switches (see the layoutMode effect) so the
          embedded viewer never remounts just from toggling a drawer. ───── */}
      <ResizablePanelGroup
        direction={isMobile ? "vertical" : "horizontal"}
        className="flex-1 min-h-0"
        onLayout={handleWorkspacePanelLayout}
      >

        {/* ── LEFT: patient/study panel — collapsible to a compact summary
            card (Phase 4), never to a bare icon strip, so the essentials
            stay legible even collapsed. The embedded DICOM viewer inside the
            expanded state is gated separately by showEmbeddedViewer (layout
            mode), not by this collapse state. ──────────────────────────── */}
        <ResizablePanel
          ref={leftPanelRef}
          id="workspace-left"
          order={1}
          collapsible
          collapsedSize={LEFT_COLLAPSED_PCT}
          minSize={LEFT_MIN_PCT}
          maxSize={LEFT_MAX_PCT}
          defaultSize={isLeftPanelCollapsed ? LEFT_COLLAPSED_PCT : currentModeLayout.left}
          onCollapse={() => updateModeLayout(layoutMode, { leftCollapsed: true })}
          onExpand={() => updateModeLayout(layoutMode, { leftCollapsed: false })}
          className="flex flex-col border-r bg-muted/5"
        >
        {isLeftPanelCollapsed ? (
          <div className="flex flex-col h-full overflow-y-auto" data-testid="left-panel-compact">
            <div className="shrink-0 p-2.5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => leftPanelRef.current?.expand()}
                title={entry ? `${entry.patientName} · ${entry.modality} — expand patient panel` : "Expand patient panel"}
                className="self-start p-1 -m-1 rounded text-muted-foreground hover:bg-muted transition-colors"
              >
                <PanelLeftOpen size={14} />
              </button>
              {entryLoading && <div className="text-xs text-muted-foreground">Loading study...</div>}
              {!entryLoading && !entry && (
                <div className="text-xs text-muted-foreground">No study loaded. Open from worklist.</div>
              )}
              {entry && (
                <div className="flex flex-col gap-1.5" data-testid="left-panel-compact-summary">
                  <div className="font-semibold text-sm leading-tight truncate" title={entry.patientName}>{entry.patientName}</div>
                  <div className="text-xs text-muted-foreground">
                    {[entry.age, entry.sex].filter(Boolean).join(" / ") || "—"}
                  </div>
                  <Badge variant="outline" className="w-fit text-[10px] py-0 h-4">{entry.modality}</Badge>
                  <div className="text-xs truncate" title={entry.studyDescription || undefined}>{entry.studyDescription || "—"}</div>
                  <div className="text-xs text-muted-foreground truncate" title={entry.referringDoctor || undefined}>
                    {entry.referringDoctor || "—"}
                  </div>
                  {(() => { const u = toUnifiedStatus(entry.status, entry.deliveryStatus); return (
                    <span className={`inline-flex w-fit items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${u.color}`}>{u.label}</span>
                  ); })()}
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
          </div>
        ) : (
        <>
          {/* Viewer focus mode — the demographics block collapses to this slim
              strip so the embedded viewer below gets the reclaimed height. */}
          {viewerFocusMode && showEmbeddedViewer ? (
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/10" data-testid="viewer-focus-strip">
              <MonitorPlay size={13} className="text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold truncate flex-1" title={entry?.patientName ?? undefined}>
                {entry?.patientName ?? "Viewer"}
              </span>
              {entry?.modality && <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{entry.modality}</Badge>}
              <button
                type="button"
                onClick={() => setViewerFocus(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                title="Show patient details and the app menu again"
                data-testid="viewer-focus-restore"
              >
                Show details
              </button>
            </div>
          ) : (
          /* Study info */
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-sm">{entry.patientName}</div>
                    {/* B1: STAT/URGENT/VIP triage chip (hidden for routine) */}
                    {(() => { const pr = priorityInfo(entry.priority); return pr.highlight ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold ${pr.color}`}>{pr.label}</span>
                    ) : null; })()}
                    {/* B1: unified lifecycle status pill */}
                    {(() => { const u = toUnifiedStatus(entry.status, entry.deliveryStatus); return (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${u.color}`} title={`Internal: ${entry.status}`}>{u.label}</span>
                    ); })()}
                  </div>
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
                  <span className="truncate" title={entry.referringDoctor || undefined}>
                    {entry.referringDoctor || "—"}
                  </span>
                  {/* Quick-select: most referrals are from a few doctors (Billing Desk slots + recent worklist). */}
                  <ReferringDoctorQuickSelect
                    worklistId={entry.id}
                    currentName={entry.referringDoctor}
                    disabled={reportStatus === "FINAL"}
                  />
                  {/* B1: billing/patient cross-reference identifiers */}
                  <span className="text-muted-foreground">UHID</span>
                  <span className="font-mono truncate">{entry.uhid || "—"}</span>
                  <span className="text-muted-foreground">Bill</span>
                  <span className="font-mono truncate">{entry.billNumber || "—"}</span>
                  <span className="text-muted-foreground">Date</span>
                  <span>{entry.studyDate || "—"}</span>
                  <span className="text-muted-foreground">Study UID</span>
                  <span className="font-mono text-[10px] truncate" title={entry.studyInstanceUID || undefined}>
                    {entry.studyInstanceUID || "— missing —"}
                  </span>
                  {/* M1.6B1 — assignment (organizational ownership, distinct from the lock) */}
                  <span className="text-muted-foreground">Assigned</span>
                  <span
                    className="truncate"
                    title={entry.assignedAt
                      ? `Assigned ${new Date(entry.assignedAt).toLocaleString()}${entry.assignedByName ? ` by ${entry.assignedByName}` : ""}`
                      : undefined}
                  >
                    {entry.assignedRadiologist || "— unassigned —"}
                    {entry.assignedByName ? <span className="text-muted-foreground text-[10px]"> · by {entry.assignedByName}</span> : null}
                  </span>
                </div>
                {/* Assigned to another radiologist: warn, never silently steal */}
                {assignmentCategoryOf(entry, session?.user.name ?? null, session?.user.id ?? null) === "other" && (
                  <div className="flex items-center gap-1.5 p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
                    <AlertTriangle size={12} className="shrink-0" />
                    <span>Assigned to {entry.assignedRadiologist} — reporting it will NOT change the assignment.</span>
                  </div>
                )}
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
          )}

          {/* DICOM image viewer — mounted only when the layout mode calls
              for it (Phase 2/4). Report Focus and Dual Screen hide it so
              this space goes to metadata + report images instead; Split
              View and Viewer Focus show it. Gated on the mode alone, so
              toggling the LEFT panel collapse or switching right-drawer
              tabs never mounts/unmounts it. Clicking anywhere in the viewer
              enters viewer-focus mode (collapses demographics + app sidebar
              for maximum image room) — onMouseDownCapture so it engages even
              though the viewer's own pan handler also consumes the event. */}
          {showEmbeddedViewer ? (
            <div className="flex-1 overflow-hidden" onMouseDownCapture={() => setViewerFocus(true)} data-testid="embedded-viewer-wrap">
              {entry?.studyInstanceUID ? (
                <EmbeddedWadoViewer
                  ref={embeddedViewerRef}
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
          ) : (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground/70 border-y bg-muted/10"
              data-testid="viewer-hidden-notice"
            >
              <MonitorPlay size={24} className="text-muted-foreground/30" />
              <p className="text-xs max-w-[220px]">
                {layoutMode === "dualScreen"
                  ? "Embedded viewer hidden — use Open Study above to view images in a separate window or monitor."
                  : "Embedded viewer hidden in Report Focus."}
              </p>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setLayoutMode("split")}>
                Switch to Split View
              </Button>
            </div>
          )}

          {/* R1.1 — selected report images: persisted as DICOM references,
              rendered into every artifact by the shared presentation layer. */}
          <div className="shrink-0 p-2 border-t overflow-y-auto max-h-64 space-y-2">
            <ReportImagePicker
              draftId={draftId}
              studyId={entry?.studyId ?? null}
              studyInstanceUID={entry?.studyInstanceUID ?? null}
              disabled={isLocked}
            />
            {/* Print-from-workspace bridge: a SEPARATE, unpersisted selection
                for the clinic's glossy-photo printer — independent of what's
                in the report above. */}
            <PrintImagePicker
              studyInstanceUID={entry?.studyInstanceUID ?? null}
              disabled={isLocked}
            />
          </div>
        </>
        )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* ── CENTER: Report editor + action bar — the workspace's primary
            working area; gets the remaining space and never shrinks below a
            clinically usable width. Clicking back into the editor exits
            viewer-focus mode (restores the demographics + app sidebar). ── */}
        <ResizablePanel
          id="workspace-center"
          order={2}
          minSize={20}
          style={{ minWidth: CENTER_MIN_PX, minHeight: isMobile ? 320 : undefined }}
          className="flex flex-col overflow-hidden min-w-0"
          onMouseDownCapture={() => setViewerFocus(false)}
        >

          {/* Scrollable editor area */}
          <div className={`flex-1 overflow-y-auto flex flex-col ${chromeCollapsed ? "p-2 gap-2" : "p-4 gap-4"}`}>

            {/* R2.0 — Pregnancy Dashboard strip: silent (renders nothing) for
                every non-obstetric study; only fetches when isUltrasound. */}
            {isUltrasound && (
              <ObDashboardStrip
                studyId={entry?.studyId}
                onApplyToReport={(text) => setRawFindings((prev) => mergeBlock(prev, text))}
              />
            )}

            {/* CARE USG Companion (Phase 1) — pre-report snapshot composed from the
                existing engines. Independent + defensive: an error here is caught
                by the boundary and never breaks the reporting workspace. */}
            {companionEligible && entry?.studyInstanceUID && (
              <ModuleErrorBoundary resetKey={String(entry.studyInstanceUID)}>
                <UsgCompanionPanel
                  studyInstanceUID={entry.studyInstanceUID}
                  studyId={entry.studyId ?? undefined}
                  patientId={entry.patientId ?? undefined}
                  disabled={isLocked}
                  templateSelected={selectedTemplateId != null}
                  protocolSelected={!!activeProtocol}
                  historyPresent={clinicalHistory.trim().length > 0}
                  quickFindingsSelected={selectedQuickIds.size > 0}
                  copilotClear={!copilotReport.items.some((i) => i.category === "critical" || i.severity === "critical")}
                  userEdited={dirty || !!lastSavedAt}
                  reportSaved={!!lastSavedAt}
                  reportFinalized={statusLocked || finalizedReportId != null}
                  currentTechnique={technique}
                  currentFindings={rawFindings}
                  currentImpression={impression}
                  currentRecommendation={recommendation}
                  protocolTechnique={activeProtocol?.techniqueText ?? null}
                  protocolNormals={activeProtocol?.normalText ?? null}
                  protocolRecommendation={activeProtocol?.recommendationText ?? null}
                  selectedFindingIds={[...selectedQuickIds]}
                  region={studyRegion}
                  checklistRemaining={activeProtocol ? checklistRemaining : []}
                  autoPopulatedBlocks={companionLedger}
                  onAutoPopulate={handleCompanionAutoPopulate}
                  onOpenTab={(tab) => setRightTab(tab as RightTab)}
                  onCopilotContext={setCompanionCopilot}
                  onApplyProtocol={availableProtocols.some((p) => p.isDefault)
                    ? () => { const d = availableProtocols.find((p) => p.isDefault); if (d) requestProtocolChange(d); }
                    : undefined}
                  onSuggestHistory={clinicalHistoryChips.length > 0
                    ? () => { if (isLocked) return; setClinicalHistory((cur) => clinicalHistoryChips.reduce((acc, chip) => hasPhrase(acc, chip.insertedText) ? acc : appendClinicalPhrase(acc, chip.insertedText), cur)); }
                    : undefined}
                />
              </ModuleErrorBoundary>
            )}

            {/* Finalized banner */}
            {statusLocked && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 border border-green-200 text-green-800 text-xs font-medium shrink-0">
                <CheckCircle2 size={14} /> Report is finalized. Editing is disabled.
              </div>
            )}

            {/* M1.6A — locked by another radiologist: read-only view */}
            {!statusLocked && lockedByOther && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-medium shrink-0">
                <Lock size={14} className="shrink-0" />
                <span className="flex-1">
                  {lockStatusMessage("locked-by-other", studyLock.ownerName)} — read-only view. Editing and finalize are
                  disabled until the study is released{studyLock.expiresAt ? ` (lock expires ${new Date(studyLock.expiresAt).toLocaleTimeString()})` : ""}.
                </span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void studyLock.claim()}>
                  Retry claim
                </Button>
                {isOwnerRole(session) && (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] border-red-300 text-red-700"
                    onClick={() => {
                      const reason = window.prompt(`Admin override — force-release the lock held by ${studyLock.ownerName ?? "another user"}?\nReason (required for the audit log):`, "");
                      if (reason === null || !reason.trim()) return;
                      void studyLock.forceRelease(reason.trim()).then((ok) => {
                        if (!ok) toast({ title: "Override failed", description: "Admin override required.", variant: "destructive" });
                      });
                    }}>
                    Admin override
                  </Button>
                )}
              </div>
            )}

            {/* M1.6A — our lock lapsed while editing: text preserved, reclaim to continue */}
            {!statusLocked && lockLost && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium shrink-0">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1">
                  {lockStatusMessage("expired-lost", null)}. Your text is preserved locally — reclaim before saving or finalizing.
                </span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void studyLock.claim()}>
                  Reclaim study
                </Button>
              </div>
            )}

            {/* M1.6A — heartbeat unreachable: lock may lapse server-side */}
            {!statusLocked && studyLock.status === "connection-lost" && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium shrink-0">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1">{lockStatusMessage("connection-lost", null)}. Your text is safe locally.</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void studyLock.claim()}>
                  Reconnect
                </Button>
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

            {/* MRI PR 5 — dictation recovered from a 401 session expiry (distinct
                from the autosave banner above: this is the exact in-memory text
                captured at the moment the session dropped and the page redirected). */}
            {rescueDraft && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-medium shrink-0">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1">Recovered dictation from before your session expired ({new Date(rescueDraft.savedAt).toLocaleString()}).</span>
                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={restoreRescueDraft}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={dismissRescueDraft}>
                  Dismiss
                </Button>
              </div>
            )}

            {/* Unified Copilot inbox — one place for all advisory items */}
            {!isLocked && copilotPrefs.enabled && copilotInboxCount > 0 && rightTab !== "copilot" && (
              <div
                className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-indigo-200 bg-indigo-50/80 text-indigo-900 text-xs shrink-0"
                data-testid="copilot-inbox-banner"
              >
                <Sparkles size={14} className="shrink-0 text-indigo-600" />
                <span className="flex-1">
                  <span className="font-semibold">{copilotInboxCount} Copilot item{copilotInboxCount > 1 ? "s" : ""}</span>
                  {copilotAlerts > 0 && (
                    <span className="text-indigo-700"> · {copilotAlerts} need attention</span>
                  )}
                  <span className="text-indigo-700/80"> — measurements, priors, checklist, and quality in one inbox.</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] border-indigo-300"
                  onClick={() => setRightTab("copilot")}
                >
                  Open Copilot
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

            {/* Study setup — region, protocol, template; manual override + re-apply */}
            {!isLocked && availableRegions.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 p-2 rounded-md border bg-slate-50/80 dark:bg-slate-900/40 text-[11px] shrink-0"
                data-testid="study-setup-bar"
              >
                <span className="font-semibold text-muted-foreground uppercase text-[9px] tracking-wide">Study setup</span>
                <label className="inline-flex items-center gap-1">
                  <span className="text-muted-foreground">Region</span>
                  <select
                    aria-label="Study region"
                    className="h-6 text-[10px] rounded border bg-background px-1 max-w-[140px]"
                    value={studyRegion ?? ""}
                    onChange={(e) => handleRegionOverrideSelect(e.target.value)}
                  >
                    {!studyRegion && <option value="">— none —</option>}
                    {availableRegions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {regionOverride != null && regionOverride !== autoStudyRegion && (
                    <button
                      type="button"
                      className="text-amber-600 underline text-[10px]"
                      title={`Auto-detected: ${autoStudyRegion ?? "none"}`}
                      onClick={() => setRegionOverride(null)}
                    >
                      reset
                    </button>
                  )}
                </label>
                <span className="text-muted-foreground">
                  Protocol:{" "}
                  <span className={activeProtocol ? "text-foreground font-medium" : "text-amber-600"}>
                    {activeProtocol?.name ?? (availableProtocols[0]?.name ? `${availableProtocols[0].name} (not applied)` : "none")}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Template:{" "}
                  <span className={selectedTemplate ? "text-foreground font-medium" : "text-amber-600"}>
                    {selectedTemplate?.templateName ?? "none"}
                  </span>
                </span>
                {(templateMismatch || !activeProtocol) && studyRegion && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600">
                    <AlertTriangle size={11} />
                    {templateMismatch ? "template mismatch" : "protocol not applied"}
                  </span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] ml-auto"
                  disabled={!studyRegion}
                  onClick={handleReapplyStudyDefaults}
                >
                  Re-apply defaults
                </Button>
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
              {/* Study-specific quick-select chips (up to 10). Clicking inserts
                  the configured phrase; clicking again removes it. Manually
                  typed history is never overwritten (see clinicalHistoryText). */}
              {clinicalHistoryChips.length > 0 && (
                <div className="flex flex-wrap gap-1" data-testid="clinical-history-chips">
                  {clinicalHistoryChips.map((chip) => {
                    const active = hasPhrase(clinicalHistory, chip.insertedText);
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        disabled={isLocked}
                        onClick={() => toggleClinicalHistoryChip(chip)}
                        title={chip.insertedText}
                        aria-pressed={active}
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground"
                        }`}
                      >
                        {chip.displayLabel}
                      </button>
                    );
                  })}
                </div>
              )}
              <Textarea
                value={clinicalHistory}
                onChange={(e) => setClinicalHistory(e.target.value)}
                onFocus={collapseReportingChrome}
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
                <div className="flex items-center gap-1">
                  {/* Protocol control beside Technique — the SAME selection and
                      insertion path as the right Quick panel's dropdown (one
                      shared activeProtocol state, one requestProtocolChange
                      handler). Changing it here updates the panel and vice
                      versa. */}
                  {techniqueProtocolOptions.length > 0 && (
                    <>
                      <span className="text-[10px] text-muted-foreground shrink-0">Protocol</span>
                      <select
                        value={activeProtocol?.id ?? ""}
                        disabled={isLocked}
                        onChange={(e) => {
                          const id = Number(e.target.value) || null;
                          requestProtocolChange(techniqueProtocolOptions.find((p) => p.id === id) ?? null);
                        }}
                        title="Insert the study protocol's Technique text. Same selection as the Quick panel."
                        className="h-6 text-[10px] border rounded-md px-1 bg-background max-w-[160px]"
                      >
                        <option value="">None</option>
                        {techniqueProtocolOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.isDefault ? "◉ " : p.isGoldStandard ? "★ " : ""}{p.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <VoiceDictationButton
                    onInsert={(t) => setTechnique((p) => p + t)}
                    targetField="technique"
                    className="h-5 text-[10px]"
                  />
                </div>
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
                  {/* Item 2 — full-list Findings dropdown (like the Technique
                      protocol dropdown). Quick chips cannot hold every finding
                      for a busy study; this exposes the complete list grouped
                      by anatomical section and drives the same engine. */}
                  {findingsDropdownGroups.length > 0 && (
                    <select
                      aria-label="Add finding from full list"
                      title="Add a finding from the full list — for findings that do not fit as quick chips"
                      className="h-5 max-w-[150px] text-[10px] rounded border bg-background px-1"
                      value=""
                      disabled={isLocked}
                      onChange={(e) => {
                        const f = findingById.get(Number(e.target.value));
                        if (f) handleFindingClick(f);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">＋ Finding…</option>
                      {findingsDropdownGroups.map(([section, items]) => (
                        <optgroup key={section} label={section}>
                          {items.map((f) => (
                            <option key={f.id} value={f.id}>
                              {selectedQuickIds.has(f.id) ? "✓ " : ""}{f.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
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
                    onInsert={(t) => {
                      setLastVoiceCommand(t); // D3: feed the measurement parser
                      setRawFindings((p) => expandFindingsMacros(p + t)); // E3: expand any dictated /shortcut
                    }}
                    targetField="findings"
                    className="h-5 text-[10px]"
                  />
                </div>
              </div>

              {/* Study region is controlled from the Study setup bar above. */}

              {/* Quick Findings (Phase 6) — prominent study-specific chips in
                  the main report column. Clicking a chip flips its anatomical
                  section from baseline normal to the finding text live (in
                  structured mode), or appends to free text — the SAME
                  handleQuickToggle the right Quick panel uses. No AI, instant. */}
              {regionFindings.length > 0 && (
                <div className="flex flex-col gap-1 p-1.5 rounded-md border bg-muted/20" data-testid="quick-findings-strip">
                  <span className="text-[9px] font-semibold uppercase text-muted-foreground px-1">
                    Quick Findings — click to add / remove · ⣿ opens a quick details prompt
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {regionFindings.map((f) => {
                      const selected = selectedQuickIds.has(f.id);
                      const structured = findingQuestions(f).length > 0;
                      return (
                        <button
                          key={f.id}
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleFindingClick(f)}
                          title={structured ? `${f.label} — set details` : (f.findingText || f.impressionText || f.label)}
                          aria-pressed={selected}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          {f.label}{structured && <span className="ml-1 opacity-70">⣿</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chocolate Box — context-aware quick-macro tiles, only
                  meaningful for the freeform editor (structured mode's
                  findingsMap already has its own per-item text boxes). Each
                  tile splices its narrative at the live cursor position and
                  auto-selects the first [bracketed] variable for immediate
                  overwrite (see insertAtCursor in lib/findingsMacros.ts). */}
              {!useStructured && chocolateBoxSet && (
                <div className="flex flex-wrap gap-1 p-1.5 rounded-md border bg-muted/20">
                  <span className="text-[9px] font-semibold uppercase text-muted-foreground self-center px-1">
                    {chocolateBoxSet.label} quick tiles
                  </span>
                  {chocolateBoxSet.tiles.map((tile) => (
                    <Button
                      key={tile.label}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-5 text-[10px] px-1.5"
                      disabled={isLocked}
                      onClick={() =>
                        insertAtCursor(findingsTextareaRef.current?.el ?? null, rawFindings, tile.text, setRawFindings)
                      }
                    >
                      {tile.label}
                    </Button>
                  ))}
                </div>
              )}

              {templateMismatch && (
                <div className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-amber-300 bg-amber-50 text-[11px] text-amber-900">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>
                    Findings template ({selectedTemplate?.templateName ?? "unknown"}) does not match study region
                    ({studyRegion}). Brain sections will not apply to a spine study.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] ml-auto"
                    disabled={isLocked}
                    onClick={applyCorrectStructuredTemplate}
                  >
                    Load {studyRegion} template
                  </Button>
                </div>
              )}

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
                          className="text-xs font-semibold cursor-pointer flex-1"
                        >
                          {label}
                        </Label>
                        <span className="text-[10px] text-muted-foreground">
                          {item.normal ? "Normal" : "Abnormal"}
                        </span>
                        {!isLocked && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                            title={`Remove "${label}" section`}
                            aria-label={`Remove ${label} section`}
                            onClick={() => {
                              setFindingsMap((prev) => {
                                const next = { ...prev };
                                delete next[label];
                                return next;
                              });
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
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
                          data-editor="findings-section"
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
                <FindingsHighlightEditor
                  ref={findingsTextareaRef}
                  value={rawFindings}
                  onChange={(v) => setRawFindings(expandFindingsMacros(v))}
                  placeholder="Enter free-text findings…  (type /shortcut to expand a saved macro)"
                  className="min-h-[180px] text-sm font-mono resize-y"
                  disabled={isLocked}
                  dataEditor="findings"
                />
              )}
              {/* CARE Copilot auto-completion (Part 12) — advisory ghost line;
                  Tab or Accept inserts, ✕ turns it off. Free-text mode only. */}
              {copilotCompletion && !isLocked && (
                <div className="mt-0.5 flex items-center gap-1.5 rounded border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-[11px]" data-testid="copilot-completion">
                  <kbd className="rounded border px-1 text-[9px]">Tab</kbd>
                  <span className="truncate italic text-muted-foreground">{copilotCompletion.completion.trim()}</span>
                  <button className="ml-auto text-[10px] font-medium text-primary" onClick={acceptCopilotCompletion}>Accept</button>
                  <button className="text-[10px] text-muted-foreground hover:text-foreground" title="Turn off auto-completion" onClick={() => setCopilotPref({ autoComplete: false })}>✕</button>
                </div>
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
                      data-editor="impression"
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
              {/* Item 1 — quick-select "chocolate box" chips for Recommendation,
                  like the other sections. Admin-editable from Radiology Settings
                  (report_recommendation_chips). Clicking merges the text in. */}
              {recommendationChips.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5" data-testid="recommendation-chips">
                  {recommendationChips.map((chip, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={isLocked}
                      title={chip}
                      onClick={() => setRecommendation((prev) => mergeBlock(prev, chip))}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-background text-muted-foreground border-border hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-50 max-w-[220px] truncate"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                value={recommendation}
                onChange={(e) => setRecommendation(e.target.value)}
                placeholder="Recommendation..."
                className="min-h-[44px] text-sm resize-none"
                disabled={isLocked}
                data-editor="recommendation"
              />
            </CollapsibleSection>

            {/* Item 5 — DICOM selectable-image picker surfaced in the report
                column. The left-panel picker lives under the embedded viewer,
                which is unmounted when the viewer panel is collapsed (Report
                mode) — so the "premium report with selectable DICOM images"
                feature appeared "nowhere". When the left panel is collapsed we
                mount the SAME picker here (exactly one instance ever, so no
                double side-effects) so selected images remain reachable and
                render into the report artifact. */}
            {isLeftPanelCollapsed && (
              <CollapsibleSection
                layoutKey="radiology_report_layout"
                id="report-images"
                title="Report Images (DICOM)"
              >
                <div className="space-y-2">
                  <ReportImagePicker
                    draftId={draftId}
                    studyId={entry?.studyId ?? null}
                    studyInstanceUID={entry?.studyInstanceUID ?? null}
                    disabled={isLocked}
                  />
                  {/* Print-from-workspace bridge: a SEPARATE, unpersisted
                      selection for the clinic's glossy-photo printer —
                      independent of what's in the report above. */}
                  <PrintImagePicker
                    studyInstanceUID={entry?.studyInstanceUID ?? null}
                    disabled={isLocked}
                  />
                </div>
              </CollapsibleSection>
            )}

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
                <>
                  <Textarea
                    value={criticalNote}
                    onChange={(e) => setCriticalNote(e.target.value)}
                    placeholder="Describe critical finding (e.g. acute infarct, cord compression, tension pneumothorax)..."
                    className="min-h-[50px] text-sm resize-none"
                    disabled={isLocked}
                  />
                  {/* F5: communication checklist — documents that the critical
                      finding was actually relayed, not just flagged. */}
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-red-100">
                    <span className="text-[10px] font-semibold text-red-700 uppercase tracking-wide">Communication Checklist</span>
                    {([
                      ["phoned", "Telephoned Doctor"],
                      ["annotated", "Annotated in PACS"],
                      ["dispatched", "Dispatched Alert"],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={checklistComm[key]}
                          onCheckedChange={(v) => setChecklistComm((prev) => ({ ...prev, [key]: !!v }))}
                          disabled={isLocked}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Report preview */}
            {previewMode && (
              <div className="border rounded-md bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b flex-wrap gap-2">
                  <h3 className="text-sm font-semibold">Report Preview</h3>
                  <ReportLayoutQuickSelect
                    value={previewLayout}
                    activeKey={presentationTemplates?.active?.standard}
                    onChange={setPreviewLayoutOverride}
                    className="max-w-xs"
                  />
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
                      {/* warnings arrive as issue OBJECTS ({rule, severity, path,
                          message}) — render through the same text helper the
                          errors use, or React throws "Objects are not valid as
                          a React child" and the whole preview panel dies. */}
                      {draftValidation.structured.warnings.map((w, i) => (
                        <div key={i} className="text-amber-700">⚠ {validationIssueText(w)}</div>
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
                {serverPreviewHtml ? (
                  /* R1.1 — the canonical server-rendered document (shared
                     presentation layer): exactly what print/PDF/delivery
                     produce, selected images included. */
                  <iframe
                    title="Report preview"
                    srcDoc={serverPreviewHtml}
                    className="w-full border-none bg-white"
                    style={{ minHeight: "70vh" }}
                    sandbox="allow-same-origin"
                    data-testid="server-report-preview"
                  />
                ) : (
                  // R1.4 — this fallback is a DIFFERENT, hand-rolled renderer
                  // (no clinic letterhead/logo, no signature block, no QR,
                  // none of the canonical page-break CSS) used only when the
                  // server preview call failed or nothing has been saved
                  // yet. It used to swap in silently, with nothing on
                  // screen distinguishing it from the real preview — a
                  // radiologist could mistake it for the final formatted
                  // report. The banner makes the substitution honest; Print
                  // and PDF always use the canonical renderer regardless.
                  <div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs font-medium">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span>Preview temporarily unavailable — showing a simplified draft view, not the final formatted report. Print and PDF are unaffected.</span>
                    </div>
                    <div
                      ref={previewRef}
                      className="p-4"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Sticky bottom action bar. On a narrow mobile column each
              labeled button no longer fits side by side, so flex-wrap used
              to stack all six into ~6 rows (~250px tall) and crowd out the
              editor above it — scroll horizontally instead, a single
              predictable-height row. ──────────────────────────────────── */}
          <div className={`shrink-0 border-t bg-white px-3 py-2 flex items-center gap-2 ${
            isMobile ? "overflow-x-auto flex-nowrap [&>*]:shrink-0" : "flex-wrap"
          }`}>
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
              onClick={() => void handleExportWord()}
              disabled={exportingWord}
              title="Download this draft as a Word document to finish and sign there"
            >
              {exportingWord ? <RefreshCw size={12} className="animate-spin" /> : <FileDown size={12} />}
              Export to Word
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf}
              title="Download a real PDF, including any images selected below in Report Images"
            >
              {exportingPdf ? <RefreshCw size={12} className="animate-spin" /> : <FileOutput size={12} />}
              Export as PDF
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
            {!isLocked && canSign && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => void finalizeReport()}
                disabled={finalizing || pcpndtBlocked}
                title={
                  pcpndtBlocked
                    ? `Blocked: PCPNDT Form F for this patient is missing or incomplete.${pcpndtCompliance?.errors?.length ? ` Missing: ${pcpndtCompliance.errors.join(" ")}` : ""} Complete Form F, then finalize — this page rechecks automatically.`
                    : "Finalize report (Ctrl+Enter)"
                }
              >
                {finalizing ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}{" "}
                Finalize
              </Button>
            )}
            {/* PCPNDT: persistent, always-visible status (not just a toast on
                click) so the state is understood before the radiologist even
                reaches for Finalize — red when Form F is missing/incomplete,
                green once verified (finalize then proceeds here normally). */}
            {!isLocked && canSign && isPcpndtRelevantUsg && (
              pcpndtBlocked ? (
                <span
                  className="text-[11px] text-red-600 font-medium self-center px-2 flex items-center gap-1 max-w-[260px]"
                  title={`PCPNDT Form F for this patient is missing or incomplete.${pcpndtCompliance?.errors?.length ? ` Missing: ${pcpndtCompliance.errors.join(" ")}` : ""} Complete and verify Form F (Measurements tab → "Review & Map to Form F"); this page rechecks automatically.`}
                >
                  ⚠ PCPNDT: complete Form F to finalize
                </span>
              ) : (
                <span
                  className="text-[11px] text-emerald-600 font-medium self-center px-2 flex items-center gap-1 max-w-[260px]"
                  title="PCPNDT Form F for this patient is complete and ID-verified — finalize proceeds normally (the server re-verifies on finalize)."
                >
                  ✓ PCPNDT Form F verified
                </span>
              )
            )}
            {/* G1: non-signing roles see why, not a live button that only 500s server-side */}
            {!isLocked && !canSign && (
              <span className="text-[11px] text-muted-foreground self-center px-2" title="Only a radiologist can sign the final report">
                Final sign-off: radiologist only
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={shareWhatsApp}
              disabled={!linkedReportId}
              title={linkedReportId ? "Send the finalized report via WhatsApp" : "Finalize the report first"}
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
        </ResizablePanel>

        {/* ── RIGHT: contextual tool drawer — Copilot/Quick/Templates/AI/
            Follow-up/Prior/Measure/Knowledge/Diff/Print/Teaching, one
            compact icon ribbon instead of large "hero" cards (Phase 5), so
            it no longer permanently consumes a third of the screen. Only one
            tab body ever renders (unchanged below); collapsible to a slim
            icon rail. ─────────────────────────────────────────────────── */}
        <ResizableHandle withHandle />
        <ResizablePanel
          ref={rightPanelRef}
          id="workspace-right"
          order={3}
          collapsible
          collapsedSize={RIGHT_COLLAPSED_PCT}
          minSize={RIGHT_MIN_PCT}
          maxSize={RIGHT_MAX_PCT}
          defaultSize={isRightPanelCollapsed ? RIGHT_COLLAPSED_PCT : currentModeLayout.right}
          onCollapse={() => updateModeLayout(layoutMode, { rightCollapsed: true })}
          onExpand={() => updateModeLayout(layoutMode, { rightCollapsed: false })}
          className="flex flex-col border-l overflow-hidden"
        >
        {isRightPanelCollapsed ? (
          <div className="flex flex-col items-center gap-1 py-2 h-full overflow-y-auto" data-testid="right-panel-compact">
            <button
              type="button"
              title="Expand tool drawer"
              onClick={() => rightPanelRef.current?.expand()}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors mb-1"
            >
              <PanelRightOpen size={14} />
            </button>
            {RIGHT_TABS.map((tab) => {
              const active = rightTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.label}
                  aria-label={tab.label}
                  onClick={() => { setRightTab(tab.id as RightTab); rightPanelRef.current?.expand(); }}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    active
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  {"badge" in tab && tab.badge ? (
                    <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-rose-500 px-1 text-center text-[8px] font-bold leading-[14px] text-white shadow-sm">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
        <>
          {/* Tab header — compact icon ribbon, every tool at equal visual
              weight (Phase 5). Tooltip + aria-label carry the tab name;
              the active tab's name also appears in the strip below so a
              dozen icons stay identifiable without full-width cards. */}
          <div className="shrink-0 flex flex-wrap items-center gap-1 p-1.5 border-b bg-muted/10" data-testid="right-drawer-ribbon">
            {RIGHT_TABS.map((tab) => {
              const active = rightTab === tab.id;
              const accent = HERO_ACCENT[tab.id];
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.label}
                  aria-label={tab.label}
                  aria-pressed={active}
                  data-testid={`right-tab-${tab.id}`}
                  onClick={() => setRightTab(tab.id as RightTab)}
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    active
                      ? accent
                        ? `${accent.chip} border-current`
                        : "bg-primary/10 border-primary/40 text-primary"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  {"badge" in tab && tab.badge ? (
                    <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-rose-500 px-1 text-center text-[8px] font-bold leading-[14px] text-white shadow-sm">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <div className="flex-1" />
            <button
              type="button"
              title="Collapse tool drawer"
              onClick={() => rightPanelRef.current?.collapse()}
              className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              <PanelRightClose size={14} />
            </button>
          </div>
          <div className="shrink-0 px-2 py-1 border-b bg-muted/5 text-[11px] font-semibold text-foreground/80 flex items-center gap-1.5">
            {RIGHT_TABS.find((t) => t.id === rightTab)?.icon}
            {RIGHT_TABS.find((t) => t.id === rightTab)?.label}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">

            {/* CARE Copilot (PR #80) — always-on advisory assistant */}
            {rightTab === "copilot" && (
              <CareCopilotPanel
                report={copilotPanelReport}
                dismissed={copilotEffectiveDismissed}
                onInsert={copilotInsert}
                onDismiss={copilotDismiss}
                onGoToConflict={copilotGoToConflict}
                recentActions={copilotRecent}
                onUndoLast={copilotUndoLast}
                provider="local"
                prefs={copilotPrefs}
                onSetPref={setCopilotPref}
                onAskAi={askCopilotAi}
                aiBusy={aiCopilotBusy}
                aiCount={aiCopilotItems.length}
                onResetLearning={copilotResetLearning}
                onExportLearning={copilotExportLearning}
              />
            )}

            {/* Tab 1: Templates */}
            {rightTab === "quickselect" && (
              <QuickFindingsPanel
                selectedIds={selectedQuickIds}
                onToggle={handleQuickToggle}
                onFindingClick={handleFindingClick}
                onMeasurement={handleSmartMeasurement}
                side={quickSide}
                onSideChange={setQuickSide}
                instances={quickInstances}
                onUpdateInstance={handleInstanceUpdate}
                externalSearch={qsExternalSearch}
                onAutoTechnique={handleAutoTechnique}
                onInsertNormals={handleInsertNormals}
                activeProtocolId={activeProtocol?.id ?? null}
                onProtocolChange={requestProtocolChange}
                onChecklistChange={(percent, remaining) => { setChecklistPercent(percent); setChecklistRemaining(remaining); }}
                onAcceptLearnedSuggestion={(text) => setRecommendation((prev) => mergeBlock(prev, text))}
                onFindingsLoaded={handleFindingsLoaded}
                disabled={isLocked}
                initialStudyHint={`${entry?.modality ?? ""} ${entry?.studyDescription ?? ""}`}
                isAdmin={isOwnerRole(session)}
              />
            )}
            {rightTab === "library" && (
              <FindingsLibraryPanel
                modalityHint={entry?.modality ?? ""}
                studyHint={`${entry?.modality ?? ""} ${entry?.studyDescription ?? ""}`}
                onApplyReport={({ findingsText, impressionLines, technique }) => {
                  // Template-driven: the composed report (normal base with abnormal
                  // organs swapped in) becomes the report's Findings + Impression.
                  setRawFindings(findingsText);
                  setImpression(impressionLines.length ? impressionLines : [""]);
                  if (technique) setTechnique((prev) => (prev.trim() ? prev : technique));
                }}
                disabled={isLocked}
              />
            )}
            {rightTab === "templates" && <TemplatesTab />}
            {/* Knowledge / reference lookup + personal library (previously an
                orphaned component, never rendered). Its sub-panels are
                parent-driven, so a compact sub-nav selects which one shows.
                onInsert reuses the shared, lock-and-smart-mode-aware inserter. */}
            {rightTab === "knowledge" && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex flex-wrap gap-1 p-2 border-b border-card-border shrink-0">
                  {([
                    ["knowledge", "Reference"],
                    ["personal", "My Library"],
                    ["master", "Master"],
                    ["packs", "Packs"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setKnowledgeSubPanel(id)}
                      className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                        knowledgeSubPanel === id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-card-border hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <RadiologyKnowledgePanel
                    activePanel={knowledgeSubPanel}
                    onInsert={comparisonInsertFindings}
                  />
                </div>
              </div>
            )}
            {/* AI-draft-vs-final diff for the open study (was a separate page). */}
            {rightTab === "diff" && <ReportDiffTab worklistId={entry?.id ?? null} />}
            {/* Print / PDF: surfaces the workspace's existing canonical
                server-rendered preview + print, so it's reachable from the tab
                bar too (the toolbar "Preview" button toggles the same view). */}
            {rightTab === "print" && (
              <div className="p-3 space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  Preview the final, server-rendered document and print or save as PDF — without leaving the workspace.
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => setPreviewMode(true)}>
                    <Eye size={13} /> Show full preview
                  </Button>
                  <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => void printReport()}>
                    <Printer size={13} /> Print / Save as PDF
                  </Button>
                  {!linkedReportId && draftId && (
                    <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => void printReportLikeFinal()}>
                      <Printer size={13} /> Print like final (no draft watermark)
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Tip: the “Preview” button in the report toolbar toggles the same in-page canonical preview.
                </p>
              </div>
            )}
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
              <div className="flex flex-col">
                {/* Structured previous-study comparison (MRI PR 1) — reuses the
                    existing prior-studies endpoint + comparison engine, above the
                    existing prior/AI-impression panel (same tab, no duplicate). */}
                <ComparisonPanel
                  patientId={entry?.patientId ?? undefined}
                  excludeStudyId={entry?.studyId ?? undefined}
                  currentModality={entry?.modality ?? ""}
                  currentStudyDescription={entry?.studyDescription ?? ""}
                  currentFindings={useStructured ? findingsAsText() : rawFindings}
                  onInsertFindings={comparisonInsertFindings}
                  onInsertImpression={comparisonInsertImpression}
                  onSelectPrior={setSelectedPrior}
                />
                <div className="border-t" />
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
                  onInsertComparisonText={(text) => setRawFindings((prev) => mergeBlock(prev, text))}
                  initialTab="prior"
                />
              </div>
            )}

            {/* Tab 3: AI Review */}
            {rightTab === "ai" && (
              <div className="flex flex-col">
                {/* E2: on-demand full AI draft from study metadata. Distinct
                    from the impression-only "AI Review" and from the passive
                    fill-empty autofill — this lets the radiologist (re)request
                    and review a complete draft, then import it (guarded). */}
                <div className="mx-2 mt-2 border rounded-md p-2 bg-muted/30 shrink-0">
                  <div className="text-[10px] font-semibold flex items-center gap-1 mb-1.5">
                    <Sparkles size={10} className="text-indigo-500" /> AI Draft Assistant
                  </div>
                  <Button
                    size="sm"
                    className="w-full h-7 text-[11px] gap-1.5"
                    onClick={() => generateAiDraftMutation.mutate()}
                    disabled={generateAiDraftMutation.isPending || !entry || isLocked}
                  >
                    <RefreshCw size={11} className={generateAiDraftMutation.isPending ? "animate-spin" : ""} />
                    {generateAiDraftMutation.isPending ? "Generating…" : "Query AI Draft"}
                  </Button>
                  {entry?.aiDraftJson && (
                    <div className="mt-2 space-y-1.5">
                      <div className="text-[10px] font-medium text-muted-foreground">Draft findings preview</div>
                      <div className="bg-background border rounded p-1.5 text-[10px] max-h-32 overflow-y-auto font-mono whitespace-pre-line leading-normal">
                        {safeParseAiDraft(entry.aiDraftJson).findings || "No findings text"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-[10px]"
                        onClick={importAiDraft}
                        disabled={isLocked}
                      >
                        Import Draft into Findings/Impression
                      </Button>
                    </div>
                  )}
                </div>
                {/* Live clinical nudges now live in the unified Copilot tab */}
                {coPilotSuggestions.length > 0 && (
                  <div className="mx-2 mt-2 p-2 rounded-md border bg-indigo-50/50 text-[10px] text-indigo-800 shrink-0">
                    {coPilotSuggestions.length} live finding nudge{coPilotSuggestions.length > 1 ? "s" : ""} moved to the{" "}
                    <button type="button" className="underline font-medium" onClick={() => setRightTab("copilot")}>
                      Copilot
                    </button>{" "}
                    inbox — one place for all advisories.
                  </div>
                )}
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
                  onInsertComparisonText={(text) => setRawFindings((prev) => mergeBlock(prev, text))}
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
                    {/* MRI PR 3: critical-result DETECTION — the report describes a
                        critical finding but the critical flag is still off. */}
                    {criticalHits.length > 0 && !isCritical && (
                      <div className="text-red-500">⚠ Report describes a critical finding ({criticalHits.map((h) => h.label).join(", ")}) but "Mark Critical Finding" is off.</div>
                    )}
                    {/* F5: critical-finding communication gate */}
                    {isCritical && !checklistComm.phoned && (
                      <div className="text-red-500">⚠ Critical finding flagged but "Telephoned Doctor" not yet checked in the Communication Checklist.</div>
                    )}
                    {/* F4: institution-mandated Comparison section */}
                    {comparisonSectionMissing && (
                      <div className="text-amber-600">⚠ This patient has prior report(s) but no Comparison section/wording was found.</div>
                    )}
                    {/* F6: imported-viewer-measurement safety checks */}
                    {measurementSafetyIssues.map((issue) => (
                      <div key={issue.id} className={issue.severity === "critical" ? "text-red-500" : "text-amber-600"}>
                        ⚠ {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Measurements */}
            {rightTab === "measurements" && (
              <div className="flex flex-col">
                {/* R2.0 — USG measurement review (DICOM SR → GE tags → OCR →
                    Manual, provenance, approve/insert, PCPNDT Form F review)
                    only for ultrasound studies; MeasurementAssistantPanel
                    below stays the generic manual measurement/calculator
                    widget for every modality including USG. */}
                {isUltrasound && entry?.studyInstanceUID && (
                  <div className="border-b">
                    <UsgMeasurementReviewPanel
                      studyInstanceUID={entry.studyInstanceUID}
                      draftId={draftId}
                      onInsertMeasurement={handleUsgMeasurementInsert}
                    />
                    <div className="p-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-[11px]"
                        onClick={() => void reviewAndMapToFormF()}
                        disabled={mappingToFormF}
                      >
                        <ClipboardList size={11} className="mr-1.5" />
                        {mappingToFormF ? "Loading…" : "Review & Map to Form F"}
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Opens Form F with approved values shown for reference only — nothing is saved until you review and click Save there.
                      </p>
                    </div>
                  </div>
                )}
                <MeasurementAssistantPanel
                  patientId={entry?.patientId ?? undefined}
                  studyId={entry?.studyId ?? undefined}
                  orderId={entry?.id ?? undefined}
                  modality={entry?.modality ?? undefined}
                  bodyPart={entry?.studyDescription ?? undefined}
                  onMeasurementsChange={handleMeasurementsApplied} // D2: auto-bridge calcs → Findings/Impression
                  voiceTextCommand={lastVoiceCommand} // D3: autofill fields from dictated numbers
                />
                {/* D1: external-viewer measurement import queue (self-hides when empty) */}
                <div className="border-t">
                  <ViewerMeasurementsPanel
                    studyInstanceUID={entry?.studyInstanceUID}
                    onInsertToFindings={(line) => setRawFindings((prev) => mergeBlock(prev, line))}
                    onInsertToImpression={(line) => setImpression((prev) => mergeImpression(prev, line))}
                  />
                </div>
                {/* C1: quantitative interval-change vs this patient's prior
                    measurements — self-hides when there's no matching pair. */}
                {priorComparisonMetrics.length > 0 && (
                  <div className="border-t p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      <GitCompare size={11} /> Prior Comparisons
                    </div>
                    {priorComparisonMetrics.map((c, idx) => (
                      <div key={idx} className="flex flex-col text-[11px] bg-muted/20 p-2 rounded border">
                        <div className="flex items-center justify-between font-medium">
                          <span>{c.label}</span>
                          <span className={`flex items-center gap-0.5 font-bold ${
                            c.direction === "growth" ? "text-red-600" : c.direction === "regression" ? "text-emerald-600" : "text-muted-foreground"
                          }`}>
                            {c.direction === "growth" ? <TrendingUp size={13} /> : c.direction === "regression" ? <TrendingDown size={13} /> : <Minus size={13} />}
                            {c.changePercent > 0 ? `+${c.changePercent}%` : `${c.changePercent}%`}
                          </span>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>Prior: {c.previous}</span>
                          <span>Current: {c.current}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
        </>
        )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Structured Finding Assistant (Phase 6.2): compact "ask only what's
          needed" dialog. Opened for a finding that declares questions; on Apply
          the collected values generate the finding/impression text through the
          existing Smart Findings Engine. */}
      {structuredDialog && (
        <StructuredFindingDialog
          finding={structuredDialog.finding}
          initialValues={structuredDialogInitialValues(structuredDialog)}
          editing={structuredDialog.editing}
          onApply={applyStructuredDialog}
          onRemove={() => removeStructuredFinding(structuredDialog.finding)}
          onCancel={() => setStructuredDialog(null)}
        />
      )}

      {/* Universal Command Palette (PR #77) — Ctrl+K from anywhere. Searches the
          workspace's cached findings / protocols / templates / history / studies
          + a command registry; runs each through the existing handlers. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        recent={paletteRecent}
        favourites={paletteFavourites}
        onToggleFavourite={togglePaletteFavourite}
        onRun={runPaletteItem}
      />

      {/* Protocol-replace safety prompt (Phase 8): only shown when selecting a
          protocol would overwrite manually-edited Technique text. Never fires
          when Technique is empty or still holds the last protocol's text. */}
      {protocolReplacePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg border bg-background p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Replace Technique?</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Technique contains manual edits. Replace it with the selected protocol
              text (&ldquo;{protocolReplacePrompt.name}&rdquo;)?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                className="h-8"
                onClick={() => { applyProtocol(protocolReplacePrompt, true); setProtocolReplacePrompt(null); }}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  // Switch the selection but keep the manually-edited text; from
                  // now on that text is treated as manual (no silent re-fill).
                  applyProtocol(protocolReplacePrompt, false);
                  lastInsertedTechniqueRef.current = null;
                  setProtocolReplacePrompt(null);
                }}
              >
                Keep Current Text
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => setProtocolReplacePrompt(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <FinalizeSignDialog
        open={finalizeFlow.open}
        input={finalizeFlow.input}
        onResolve={finalizeFlow.resolve}
        onCancel={finalizeFlow.cancel}
      />
    </div>
  );
}
