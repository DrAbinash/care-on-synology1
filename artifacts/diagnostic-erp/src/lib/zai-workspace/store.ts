import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Study, MeasurementRow, PriorStudy, CopilotItem, CriticalFinding, QuickSelectTile, QuickSelectField, ReportFormat, SnippetMacro, SignOffProfile, MergeResult, Modality, LintIssue } from "./types";
import { runLintRules, runCopilotAnalysis, computeQualityScore, mergeTwoFormats, expandMacro, detectMacroTrigger, shouldPreloadNext } from "./types";
import { normalizeWorkspaceStudies } from "./normalizeWorkspaceStudy";
import { DEFAULT_QUICK_SELECT_TILES, lookupTiles, loadTiles, saveTiles, createTile, resetToDefaults } from "./quick-select-library";
import {
  DEFAULT_REPORT_FORMATS, lookupFormats, loadFormats, saveFormats, createFormat, resetFormatsToDefaults,
} from "./report-formats-library";
import {
  bumpReportFormatUsage,
  createReportFormatOnServer,
  deleteReportFormatOnServer,
  hydrateReportFormatsLibrary,
} from "./reportFormatsApi";
import { hydrateChocolateMacrosFromServer } from "@/lib/chocolateMacrosApi";
import { shouldConfirmFormatOverwrite, clinicalFieldsFromFormat } from "./fullReportFormat";
import { appendClinicalPhrase } from "@/lib/clinicalHistoryText";
import { DEFAULT_SNIPPET_MACROS, lookupMacros, lookupMacrosForContext, loadMacros, saveMacros, createMacro } from "./snippet-macros-library";
import { DEFAULT_SIGN_OFF_PROFILES, loadProfiles, saveProfiles, lookupProfile, formatSignOff, createProfile } from "./sign-off-profiles";
import {
  mergeReportFieldContentWithProvenance,
  provenanceFromText,
  reconcileProvenanceAfterManualEdit,
  normalizeForDedupe,
  type FieldProvenanceMap,
  type InsertSource,
  type ReportFieldKey,
} from "@/lib/reportFieldMerge";
import {
  EMPTY_REPORTING_STUDY_CONTEXT,
  canonicalContentRegion,
  reportingContextEqual,
  type ReportingStudyContext,
} from "@/lib/reportingStudyContext";
import {
  applyPathologyPatch as overlayPathology,
  applySideToIncoming,
  inferOwnership,
  relateralizeOwnedText,
  type PathologyIncoming,
  type PathologyOwnership,
  type ReportNarrative,
} from "@/lib/pathologyPatch";
import type { Side } from "@/lib/sideSwap";
import { applyChangePlan } from "@/lib/voiceReportComposer/applyChangePlan";
import type { VoiceChangePlan, VoiceObservation } from "@/lib/voiceReportComposer/types";
import {
  buildCanonicalObservation,
  contributionPresent,
  contributionProtected,
  observationsMutuallyExclusive,
  ownershipFromObservation,
  type CanonicalObservation,
} from "@/lib/observationSlot";
import {
  impressionNeedsRefreshFromNarrative,
  observationInputFromVoice,
  refreshImpressionFromObservations,
  removeLedgerObservation,
  serializeObservationLedger,
  parseObservationLedger,
  reconstructProvenanceFromLedger,
  logLedgerHydrationSafe,
  detectUnownedSiblingConflictsForLedger,
  UNOWNED_SIBLING_HINT,
  renderedInField,
  extractRecordedHashes,
  reconcilePatchAgainstNarrative,
  stampVoiceAuthoredProvenance,
  type LedgerHydrationResult,
  type LedgerPatch,
  type SerializedObservationLedger,
} from "@/lib/observationLedger";
import { generateLocalImpression } from "@/lib/generateLocalImpression";
import type { ObservationAnchor } from "@/lib/observationAnchor";
import { anchorsEqual } from "@/lib/observationAnchor";
import type { CoverageMark } from "@/lib/coverageMarks";
import {
  coverageMarksEqual,
  defaultCoverageMarks,
  setCoverageStatus,
  markRegionViewed,
  parseCoverageMarks,
  filterCoverageForScope,
  serializeCoverageEnvelope,
  COVERAGE_ENVELOPE_KEY,
} from "@/lib/coverageMarks";
import { coverageScopeKey } from "@/lib/mriLumbarLevelState";

function parseCoverageFromRaw(raw: unknown): CoverageMark[] | null {
  return parseCoverageMarks(raw);
}

function hydrateCoverageFromLedgerRaw(raw: unknown): CoverageMark[] | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  // Prefer full envelope (scoped) when present
  if (rec[COVERAGE_ENVELOPE_KEY] != null || rec.careCoverageByScope != null) {
    return parseCoverageMarks(rec);
  }
  if (rec.careCoverageMarks != null) return parseCoverageMarks(rec.careCoverageMarks);
  return null;
}

export type EditorField = "findings" | "impression" | "recommendation" | "technique" | "clinicalHistory";
export type RailStage = "orient" | "observe" | "measure" | "conclude" | "verify";

type FieldProvenanceState = Partial<Record<EditorField, FieldProvenanceMap>>;

export type AppliedPathologyPatch = {
  id: string;
  ownership: PathologyOwnership;
  templates: PathologyIncoming;
  lastRendered: PathologyIncoming;
  source: InsertSource;
  observation?: CanonicalObservation;
  replacedBaseline?: { findings: string[]; impression: string[] };
  protected?: boolean;
  stale?: boolean;
};

export type PendingPathologyPatch = {
  incoming: PathologyIncoming;
  ownership: PathologyOwnership;
  source: InsertSource;
  side?: Side | "";
  templates?: PathologyIncoming;
  id?: string;
  region?: string;
  concept?: string | null;
  level?: string;
  laterality?: string;
  label?: string;
  catalogId?: number | string;
  properties?: string;
  supportsLaterality?: boolean;
  findingsText?: string;
  bundleId?: string;
  sectionsOwned?: CanonicalObservation["sectionsOwned"];
  role?: CanonicalObservation["role"];
  specificity?: CanonicalObservation["specificity"];
  /** Optional explicit anchor; when omitted, store stamps activeAnchor at apply time. */
  anchor?: ObservationAnchor | null;
  severity?: string;
  state?: string;
  measurement?: string;
};

type PatchSnapshot = {
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  fieldProvenance: FieldProvenanceState;
  appliedPathologyPatches: AppliedPathologyPatch[];
  voiceComposerObservations: VoiceObservation[];
  voiceComposerTranscriptHistory: string[];
};

function narrativeFromState(s: Pick<S, "clinicalHistoryText" | "techniqueText" | "findingsText" | "impressionText" | "recommendationText">): ReportNarrative {
  return {
    clinicalHistory: s.clinicalHistoryText,
    technique: s.techniqueText,
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
  };
}

/** Stable empty provenance — never use inline `?? {}` inside zustand selectors (React #185). */
export const EMPTY_FIELD_PROVENANCE: FieldProvenanceMap = {};

function toLedgerPatch(p: AppliedPathologyPatch): LedgerPatch {
  const observation = p.observation ?? buildCanonicalObservation({
    id: p.id,
    conflictGroup: p.ownership.conflictGroup,
    anatomicalSection: p.ownership.anatomicalSection,
    baselineReplaces: p.ownership.baselineReplaces,
    concept: p.ownership.concept,
    level: p.ownership.level,
    laterality: p.ownership.laterality,
    source: p.source,
  });
  return {
    id: p.id,
    observation,
    templates: p.templates,
    lastRendered: p.lastRendered,
    replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
    source: p.source,
    protected: p.protected ?? false,
    stale: p.stale,
  };
}

function observationFromPending(
  opts: PendingPathologyPatch,
  reportingRegion: string | null,
  activeAnchor?: ObservationAnchor | null,
): CanonicalObservation {
  const templates = opts.templates ?? opts.incoming;
  const metaMissing = !(opts.ownership.anatomicalSection || opts.ownership.conflictGroup || opts.ownership.baselineReplaces || opts.concept);
  const inferred = metaMissing
    ? inferOwnership(opts.label ?? "", [templates.findings ?? "", templates.impression ?? ""])
    : {};
  const ownership = { ...inferred, ...opts.ownership };
  const now = new Date().toISOString();
  const stampAnchor = opts.anchor === null
    ? undefined
    : (opts.anchor ?? activeAnchor ?? undefined);
  return buildCanonicalObservation({
    id: opts.id,
    catalogId: opts.catalogId,
    region: opts.region || reportingRegion || "",
    concept: opts.concept ?? ownership.concept,
    conflictGroup: ownership.conflictGroup,
    anatomicalSection: ownership.anatomicalSection,
    baselineReplaces: ownership.baselineReplaces,
    label: opts.label,
    findingsText: opts.findingsText ?? templates.findings,
    level: opts.level ?? ownership.level,
    laterality: opts.laterality ?? opts.side,
    supportsLaterality: opts.supportsLaterality,
    properties: opts.properties,
    source: opts.source,
    bundleId: opts.bundleId,
    sectionsOwned: opts.sectionsOwned,
    role: opts.role,
    specificity: opts.specificity,
    severity: opts.severity,
    state: opts.state,
    measurement: opts.measurement,
    impressionText: templates.impression,
    recommendationText: templates.recommendation,
    anchor: stampAnchor,
    createdAt: now,
    updatedAt: now,
  });
}

function splitReplacedByField(replaced: string[], existing: ReportNarrative): { findings: string[]; impression: string[] } {
  const findings: string[] = [];
  const impression: string[] = [];
  for (const s of replaced) {
    if (existing.findings.includes(s)) findings.push(s);
    else if (existing.impression.includes(s)) impression.push(s);
    else findings.push(s);
  }
  return { findings, impression };
}

function contributionMutated(prevField: string, nextField: string, lastRendered: string | undefined): boolean {
  const last = (lastRendered ?? "").trim();
  if (!last) return false;
  if (!nextField.includes(last)) {
    const parts = last.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!(parts.length > 1 && parts.every((s) => nextField.includes(s)))) return true;
  }
  const idx = nextField.indexOf(last);
  if (idx >= 0) {
    const after = nextField.slice(idx + last.length);
    if (after.trim() && !after.startsWith("\n")) return true;
  }
  return false;
}

function fieldProvenanceEqual(a: FieldProvenanceMap | undefined, b: FieldProvenanceMap): boolean {
  if (!a || Object.keys(a).length === 0) return Object.keys(b).length === 0;
  return JSON.stringify(a) === JSON.stringify(b);
}

interface S {
  studies: Study[]; activeStudyId: string | null; nextStudyId: string | null; nextStudyPreloaded: boolean;
  findingsText: string; impressionText: string; recommendationText: string; techniqueText: string; clinicalHistoryText: string;
  /** Editor-only source map; never serialized into clinical report / preview / PDF. */
  fieldProvenance: FieldProvenanceState;
  measurements: MeasurementRow[]; priors: PriorStudy[]; criticalFindings: CriticalFinding[];
  isDirty: boolean; isFinalizing: boolean; isFinalized: boolean; railStage: RailStage;
  showCommandPalette: boolean; showVoiceBar: boolean; voiceListening: boolean; voiceTranscript: string; voiceProvider: string | null;
  ghostText: string | null; ghostTextTarget: EditorField | null;
  copilotItems: CopilotItem[]; acknowledgedCopilotIds: Set<string>; activeCopilotItem: CopilotItem | null;
  completedStudyIds: Set<string>; parkedStudyIds: Set<string>;
  sessionStartedAt: number; lastSignAt: number | null; fatigueCardDismissed: boolean;
  notification: { kind: "interrupt" | "edge-glow" | "ledger"; text: string; id: string } | null;
  criticalSlaStartedAt: number | null; criticalSlaMinutes: number; criticalSlaEscalated: boolean;
  quickSelectTiles: QuickSelectTile[]; quickSelectEditorOpen: boolean; quickSelectEditingTile: QuickSelectTile | null; quickSelectEditorField: QuickSelectField | null;
  reportFormats: ReportFormat[]; selectedFormatIds: string[]; reportFormatPickerOpen: boolean;
  /** Printed heading from the last applied Full Report Format (null = use fallback chain). */
  appliedFormatReportTitle: string | null;
  saveAsFormatDialogOpen: boolean; mergePreviewOpen: boolean; lastMergeResult: MergeResult | null;
  lastMergeFormats: { a: ReportFormat; b: ReportFormat | null } | null; confirmOverwriteOpen: boolean; pendingFormatIds: string[];
  pendingPathologyPatch: PendingPathologyPatch | null;
  lastPatchSnapshot: PatchSnapshot | null;
  appliedPathologyPatches: AppliedPathologyPatch[];
  impressionNeedsRefresh: boolean;
  /** Live FRAMES/OHIF viewport context — ephemeral; stamped onto new observations only. */
  activeAnchor: ObservationAnchor | null;
  /** Selected ledger observation for key-image attach (Reporting Canvas R2). */
  selectedObservationId: string | null;
  /** Expected study UID for activeAnchor rejection across study switches. */
  activeStudyInstanceUID: string | null;
  /** Advisory coverage marks for the active Study Tab scope. Never a finalize hard gate. */
  coverageMarks: CoverageMark[];
  /** Coverage bags keyed by Study Tab / reporting region. */
  coverageByScope: Record<string, CoverageMark[]>;
  /** Format name last applied (display); title remains appliedFormatReportTitle. */
  appliedFormatName: string | null;
  ownershipReviewWarnings: Array<{ sentence: string; token: string; hint: string }>;
  ledgerHydrationWarning: string | null;
  /** Active voice-composer observations for incremental dictation context. */
  voiceComposerObservations: VoiceObservation[];
  voiceComposerTranscriptHistory: string[];
  snippetMacros: SnippetMacro[]; macroEditorOpen: boolean; editingMacro: SnippetMacro | null;
  activeMacroPrompt: { macro: SnippetMacro; field: EditorField; startPos: number } | null;
  signOffProfiles: SignOffProfile[];
  preloadTriggered: boolean;
  /** Resolved reporting identity — content selectors must use this, not DICOM bodyPart. */
  reportingContext: ReportingStudyContext;
}

export type WorkspaceStore = S & {
  setStudies: (s: unknown) => void; selectStudy: (id: string) => void; setNextStudy: (id: string | null) => void; markNextStudyPreloaded: () => void;
  setField: (f: EditorField, v: string, opts?: { source?: InsertSource; replaceProvenance?: boolean }) => void;
  /** Semantic merge + provenance update (Quick Select / Quick Findings / protocol / …). */
  mergeField: (f: EditorField, incoming: string, source: InsertSource) => void;
  /** Fill only when the field is empty; assigns provenance for the inserted block. */
  setFieldIfEmpty: (f: EditorField, v: string, source: InsertSource) => void;
  /** Wholesale replace with provenance for the new content. */
  replaceField: (f: EditorField, v: string, source: InsertSource) => void;
  setEditorContent: (c: { findings: string; impression: string; recommendation: string; technique: string; clinicalHistory: string }) => void;
  setMeasurements: (m: MeasurementRow[]) => void; setPriors: (p: PriorStudy[]) => void;
  insertMeasurement: (id: string) => void; insertAllMeasurements: () => void;
  setGhostText: (t: string | null, target: EditorField | null) => void; acceptGhostText: () => void;
  acknowledgeCopilotItem: (id: string) => void; setActiveCopilotItem: (i: CopilotItem | null) => void; insertCopilotText: (i: CopilotItem) => void; recomputeCopilot: () => void;
  setRailStage: (s: RailStage) => void; toggleCommandPalette: () => void; setCommandPalette: (o: boolean) => void;
  toggleVoiceBar: () => void; setVoiceListening: (o: boolean) => void; setVoiceTranscript: (t: string) => void; setVoiceProvider: (p: string | null) => void;
  parkStudy: () => void; startFinalize: () => void; completeFinalize: () => void; cancelFinalize: () => void; advanceToNextStudy: () => void;
  dismissFatigueCard: () => void; pushNotification: (n: { kind: "interrupt" | "edge-glow" | "ledger"; text: string }) => void; clearNotification: () => void;
  startCriticalSla: () => void; clearCriticalSla: () => void; escalateCriticalSla: () => void;
  openQuickSelectEditor: (t: QuickSelectTile | null, f: QuickSelectField) => void; closeQuickSelectEditor: () => void;
  saveQuickSelectTile: (i: Omit<QuickSelectTile, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void; deleteQuickSelectTile: (id: string) => void;
  incrementTileUsage: (id: string) => void; toggleTileFavorite: (id: string) => void; resetQuickSelectToDefaults: () => void;
  toggleReportFormatPicker: () => void; setReportFormatPickerOpen: (o: boolean) => void; toggleFormatSelection: (id: string) => void; clearFormatSelection: () => void;
  applySelectedFormats: () => void; applyFormatById: (id: string) => void; confirmOverwriteAndApply: () => void; cancelOverwrite: () => void; applyMergedResult: () => void; cancelMerge: () => void;
  toggleFormatFavorite: (id: string) => void;
  applyPathologyOverlay: (opts: PendingPathologyPatch & { force?: boolean }) => "applied" | "pending";
  applyMacroBundle: (opts: { bundleId?: string; observations: Array<PendingPathologyPatch & { force?: boolean }> }) => "applied" | "pending";
  /**
   * Bundle deselect: remove only this bundle's observations that are (a) not protected
   * and (b) not superseded by a newer QS/voice observation on the same slotKey.
   * Overridden slots keep the overriding observation's text and ownership.
   * Non-overridden slots restore replacedBaseline, same as removeObservation.
   */
  removeMacroBundle: (bundleId: string) => "removed" | "preserved-manual" | "no-op-unproven" | "missing";
  removeObservation: (id: string) => "removed" | "preserved-manual" | "no-op-unproven" | "missing";
  refreshImpressionFromLedger: () => void;
  hydrateObservationLedger: (raw: unknown) => LedgerHydrationResult;
  serializeObservationLedger: () => SerializedObservationLedger;
  setActiveAnchor: (anchor: ObservationAnchor | null) => void;
  setSelectedObservationId: (id: string | null) => void;
  setCoverageMark: (regionKey: string, status: CoverageMark["status"], reason?: string) => void;
  /** Focus / jump: promote unopened → viewed only; never downgrade or dirty. */
  touchCoverageViewed: (regionKey: string) => void;
  hydrateCoverageMarks: (raw: unknown) => void;
  serializeCoverageMarks: () => CoverageMark[];
  dismissOwnershipReview: () => void;
  dismissLedgerHydrationWarning: () => void;
  undoLastPatch: () => boolean;
  applyVoiceComposerPlan: (plan: VoiceChangePlan, transcript: string, opts?: { force?: boolean }) => "applied" | "blocked";
  /** Apply accepted AI composer plain text in one atomic undo snapshot (Guard 9). */
  applyAiComposerAccepted: (opts: {
    findings: string;
    impression: string;
    recommendation: string;
  }) => "applied";
  clearVoiceComposerSession: () => void;
  relateralizePatches: (side: Side) => void;
  /** Host-injected hook for Ctrl+I / command palette — set by RadiologyReportingWorkspace. */
  triggerAiImpression?: () => void | Promise<void>;
  saveAsFormat: (i: Omit<ReportFormat, "id" | "createdAt" | "updatedAt">) => void; deleteReportFormat: (id: string) => void;
  openSaveAsFormatDialog: () => void; closeSaveAsFormatDialog: () => void; resetReportFormatsToDefaults: () => void;
  /** Hydrate formats (+ chocolate macros) from server; migrate localStorage once. */
  hydrateContentLibraries: () => Promise<void>;
  openMacroEditor: (m: SnippetMacro | null) => void; closeMacroEditor: () => void; saveMacro: (i: Omit<SnippetMacro, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  deleteMacro: (id: string) => void; setActiveMacroPrompt: (p: { macro: SnippetMacro; field: EditorField; startPos: number } | null) => void; applyMacroWithValues: (v: Record<string, string>) => void;
  updateSignOffProfile: (m: Modality, n: string, c: string) => void; triggerPreload: () => void; resetPreload: () => void;
  setReportingContext: (ctx: ReportingStudyContext) => void;
};

function scopedSnippetMacros(get: () => WorkspaceStore): SnippetMacro[] {
  const st = get().studies.find((s) => s.id === get().activeStudyId);
  return lookupMacrosForContext(get().snippetMacros, st?.modality, get().reportingContext);
}

function fieldTextKey(f: EditorField): keyof Pick<S, "findingsText" | "impressionText" | "recommendationText" | "techniqueText" | "clinicalHistoryText"> {
  if (f === "findings") return "findingsText";
  if (f === "impression") return "impressionText";
  if (f === "recommendation") return "recommendationText";
  if (f === "technique") return "techniqueText";
  return "clinicalHistoryText";
}

const createWorkspaceStore: StateCreator<WorkspaceStore> = (set, get) => ({
  studies: [], activeStudyId: null, nextStudyId: null, nextStudyPreloaded: false,
  findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: "",
  fieldProvenance: {},
  measurements: [], priors: [], criticalFindings: [],
  isDirty: false, isFinalizing: false, isFinalized: false, railStage: "orient",
  showCommandPalette: false, showVoiceBar: false, voiceListening: false, voiceTranscript: "", voiceProvider: null,
  ghostText: null, ghostTextTarget: null,
  copilotItems: [], acknowledgedCopilotIds: new Set(), activeCopilotItem: null,
  completedStudyIds: new Set(), parkedStudyIds: new Set(),
  sessionStartedAt: Date.now(), lastSignAt: null, fatigueCardDismissed: false,
  notification: null, criticalSlaStartedAt: null, criticalSlaMinutes: 15, criticalSlaEscalated: false,
  quickSelectTiles: typeof window !== "undefined" ? loadTiles() : DEFAULT_QUICK_SELECT_TILES, quickSelectEditorOpen: false, quickSelectEditingTile: null, quickSelectEditorField: null,
  reportFormats: typeof window !== "undefined" ? loadFormats() : DEFAULT_REPORT_FORMATS, selectedFormatIds: [], reportFormatPickerOpen: false,
  appliedFormatReportTitle: null,
  saveAsFormatDialogOpen: false, mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, confirmOverwriteOpen: false, pendingFormatIds: [],
  pendingPathologyPatch: null, lastPatchSnapshot: null, appliedPathologyPatches: [], impressionNeedsRefresh: false,
  activeAnchor: null, selectedObservationId: null, activeStudyInstanceUID: null, coverageMarks: [], coverageByScope: {},
  appliedFormatName: null,
  ownershipReviewWarnings: [], ledgerHydrationWarning: null,
  voiceComposerObservations: [], voiceComposerTranscriptHistory: [],
  snippetMacros: typeof window !== "undefined" ? loadMacros() : DEFAULT_SNIPPET_MACROS, macroEditorOpen: false, editingMacro: null, activeMacroPrompt: null,
  signOffProfiles: typeof window !== "undefined" ? loadProfiles() : DEFAULT_SIGN_OFF_PROFILES, preloadTriggered: false,
  reportingContext: EMPTY_REPORTING_STUDY_CONTEXT,

  setStudies: (s) => {
    const next = normalizeWorkspaceStudies(s);
    const prev = get().studies;
    // Skip no-op updates — otherwise setStudies(workflow.queue) in a render-driven
    // effect can thrash when the queue array is a new [] reference each render
    // (React minified error #185 / maximum update depth).
    if (
      prev.length === next.length
      && prev.every((p, i) => {
        const n = next[i]!;
        return p.id === n.id
          && p.accession === n.accession
          && p.studyInstanceUID === n.studyInstanceUID
          && p.status === n.status
          && p.priority === n.priority
          && p.patient?.id === n.patient?.id
          && p.patient?.name === n.patient?.name
          && p.tatMinutes === n.tatMinutes
          && p.lockedBy === n.lockedBy;
      })
    ) {
      return;
    }
    set({ studies: next });
  },
  selectStudy: (id) => { const st = get().studies.find(s => s.id === id); if (!st) return; set({ activeStudyId: id, findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: st.clinicalHistory || "", fieldProvenance: {}, measurements: [], priors: [], isDirty: false, isFinalized: false, isFinalizing: false, railStage: "orient", ghostText: null, ghostTextTarget: null, acknowledgedCopilotIds: new Set(), activeCopilotItem: null, voiceTranscript: "", voiceListening: false, selectedFormatIds: [], reportFormatPickerOpen: false, appliedFormatReportTitle: null, appliedPathologyPatches: [], impressionNeedsRefresh: false, activeAnchor: null, selectedObservationId: null, activeStudyInstanceUID: st.studyInstanceUID ?? null, coverageMarks: [], coverageByScope: {}, appliedFormatName: null, ownershipReviewWarnings: [], ledgerHydrationWarning: null, lastPatchSnapshot: null, voiceComposerObservations: [], voiceComposerTranscriptHistory: [], criticalSlaStartedAt: null, criticalSlaEscalated: false, preloadTriggered: false, nextStudyPreloaded: false, reportingContext: EMPTY_REPORTING_STUDY_CONTEXT }); setTimeout(() => get().recomputeCopilot(), 0); },
  setNextStudy: (id) => set({ nextStudyId: id }), markNextStudyPreloaded: () => set({ nextStudyPreloaded: true }),
  setField: (f, v, opts) => {
    const key = fieldTextKey(f);
    const prevText = get()[key];
    const prevProv = get().fieldProvenance[f] ?? EMPTY_FIELD_PROVENANCE;
    let nextProv: FieldProvenanceMap;
    if (opts?.replaceProvenance && opts.source) {
      nextProv = provenanceFromText(v, opts.source);
    } else if (opts?.source && opts.source !== "manual") {
      // Wholesale assign from a known source without semantic merge.
      nextProv = provenanceFromText(v, opts.source);
    } else {
      nextProv = reconcileProvenanceAfterManualEdit(prevText, v, prevProv);
    }
    if (prevText === v && fieldProvenanceEqual(prevProv, nextProv)) return;
    const p: Partial<S> = {
      isDirty: true,
      [key]: v,
      fieldProvenance: { ...get().fieldProvenance, [f]: nextProv },
    };
    if (f === "findings" && (opts?.source === "manual" || !opts?.source)) {
      p.impressionNeedsRefresh = true;
    }
    if (f === "impression" && opts?.source && opts.source !== "manual") {
      p.impressionNeedsRefresh = false;
    }
    set(p);
    if (opts?.source === "manual" || !opts?.source) {
      const narrative = narrativeFromState(get());
      const prov = get().fieldProvenance;
      set({
        appliedPathologyPatches: get().appliedPathologyPatches.map((patch) => {
          if (patch.protected) return patch;
          const lastF = patch.lastRendered.findings ?? "";
          const lastI = patch.lastRendered.impression ?? "";
          const lastR = patch.lastRendered.recommendation ?? "";
          const missingFindings = Boolean(lastF.trim()) && !contributionPresent(narrative.findings, lastF);
          const missingImpression = Boolean(lastI.trim()) && !contributionPresent(narrative.impression, lastI);
          const mutated = (f === "findings" && contributionMutated(prevText, v, lastF))
            || (f === "impression" && contributionMutated(prevText, v, lastI))
            || (f === "recommendation" && contributionMutated(prevText, v, lastR));
          const manual = contributionProtected(lastF, prov.findings)
            || contributionProtected(lastI, prov.impression)
            || contributionProtected(lastR, prov.recommendation);
          return { ...patch, protected: Boolean(patch.protected || missingFindings || missingImpression || mutated || manual) };
        }),
      });
    }
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const d = detectMacroTrigger(v, scopedSnippetMacros(get));
      if (d) set({ activeMacroPrompt: { macro: d.macro, field: f, startPos: d.startPos } });
      else if (get().activeMacroPrompt) set({ activeMacroPrompt: null });
    }
    const st = get().studies.find(s => s.id === get().activeStudyId);
    if (f === "findings" && st && shouldPreloadNext(v, st.modality, get().preloadTriggered)) set({ preloadTriggered: true });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  mergeField: (f, incoming, source) => {
    const key = fieldTextKey(f);
    const existing = get()[key];
    const existingProvenance = get().fieldProvenance[f] ?? EMPTY_FIELD_PROVENANCE;
    const result = mergeReportFieldContentWithProvenance({
      field: f as ReportFieldKey,
      existing,
      incoming,
      source,
      existingProvenance,
    });
    if (
      result.text === existing
      && fieldProvenanceEqual(existingProvenance, result.provenance)
    ) {
      return;
    }
    set({
      isDirty: true,
      [key]: result.text,
      fieldProvenance: { ...get().fieldProvenance, [f]: result.provenance },
    });
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const d = detectMacroTrigger(result.text, scopedSnippetMacros(get));
      if (d) set({ activeMacroPrompt: { macro: d.macro, field: f, startPos: d.startPos } });
      else if (get().activeMacroPrompt) set({ activeMacroPrompt: null });
    }
    const st = get().studies.find(s => s.id === get().activeStudyId);
    if (f === "findings" && st && shouldPreloadNext(result.text, st.modality, get().preloadTriggered)) set({ preloadTriggered: true });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  setFieldIfEmpty: (f, v, source) => {
    const existing = get()[fieldTextKey(f)];
    if (!existing.trim() && v.trim()) {
      get().setField(f, v, { source, replaceProvenance: true });
    }
  },
  replaceField: (f, v, source) => {
    get().setField(f, v, { source, replaceProvenance: true });
  },
  setEditorContent: (c) => {
    // Normalize: API may return impression/recommendation as string[] or string
    const norm = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
    const findings = norm(c.findings);
    const impression = norm(c.impression);
    const recommendation = norm(c.recommendation);
    const technique = norm(c.technique);
    const clinicalHistory = norm(c.clinicalHistory);
    const state = get();
    const nextProv = {
      findings: provenanceFromText(findings, "manual"),
      impression: provenanceFromText(impression, "manual"),
      recommendation: provenanceFromText(recommendation, "manual"),
      technique: provenanceFromText(technique, "manual"),
      clinicalHistory: provenanceFromText(clinicalHistory, "manual"),
    };
    if (
      state.findingsText === findings
      && state.impressionText === impression
      && state.recommendationText === recommendation
      && state.techniqueText === technique
      && state.clinicalHistoryText === clinicalHistory
      && fieldProvenanceEqual(state.fieldProvenance.findings, nextProv.findings)
      && fieldProvenanceEqual(state.fieldProvenance.impression, nextProv.impression)
      && fieldProvenanceEqual(state.fieldProvenance.recommendation, nextProv.recommendation)
      && fieldProvenanceEqual(state.fieldProvenance.technique, nextProv.technique)
      && fieldProvenanceEqual(state.fieldProvenance.clinicalHistory, nextProv.clinicalHistory)
    ) {
      return;
    }
    // Loaded drafts/templates have uncertain provenance — mark as manual (safe).
    set({
      findingsText: findings,
      impressionText: impression,
      recommendationText: recommendation,
      techniqueText: technique,
      clinicalHistoryText: clinicalHistory,
      fieldProvenance: nextProv,
      isDirty: true,
    });
  },
  setMeasurements: (m) => {
    const prev = get().measurements;
    if (
      prev.length === m.length
      && prev.every((p, i) => {
        const n = m[i]!;
        return p.id === n.id
          && p.name === n.name
          && p.value === n.value
          && p.unit === n.unit
          && p.priorValue === n.priorValue
          && p.delta === n.delta
          && p.source === n.source
          && p.inserted === n.inserted;
      })
    ) {
      return;
    }
    set({ measurements: m });
  }, setPriors: (p) => set({ priors: p }),
  insertMeasurement: (id) => {
    const ms = get().measurements.map(m => m.id === id ? { ...m, inserted: true } : m);
    const m = ms.find(x => x.id === id);
    if (m) {
      const t = `${m.name}: ${m.value}${m.unit}${m.priorValue ? ` (prior ${m.priorValue}${m.unit})` : ""}`;
      const sentence = t.trim().endsWith(".") ? t.trim() : `${t.trim()}.`;
      get().mergeField("findings", sentence, "companion");
    }
    set({ measurements: ms });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  insertAllMeasurements: () => {
    const ms = get().measurements.map(m => ({ ...m, inserted: true }));
    const t = ms.map(m => `${m.name}: ${m.value}${m.unit}${m.priorValue ? ` (prior ${m.priorValue}${m.unit})` : ""}`).join(", ");
    get().mergeField("findings", `Measurements: ${t}.`, "companion");
    set({ measurements: ms });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  setGhostText: (t, target) => set({ ghostText: t, ghostTextTarget: target }),
  acceptGhostText: () => {
    const { ghostText, ghostTextTarget } = get();
    if (!ghostText || !ghostTextTarget) return;
    get().mergeField(ghostTextTarget, ghostText, "ai-draft");
    set({ ghostText: null, ghostTextTarget: null });
  },
  acknowledgeCopilotItem: (id) => { const a = new Set(get().acknowledgedCopilotIds); a.add(id); set({ acknowledgedCopilotIds: a }); },
  setActiveCopilotItem: (i) => set({ activeCopilotItem: i }),
  insertCopilotText: (item) => {
    if (!item.insertText) return;
    if (item.kind === "missing" && item.id === "missing-impression") {
      set({ activeCopilotItem: item });
      return;
    }
    if (item.id === "missing-comparison") {
      const insert = item.insertText.trim();
      const c = get().findingsText;
      if (!c.trim()) {
        get().mergeField("findings", insert, "companion");
      } else if (c.startsWith("Comparison")) {
        get().mergeField("findings", insert, "companion");
      } else {
        const combined = `${insert} ${c}`;
        const prevProv = get().fieldProvenance.findings ?? EMPTY_FIELD_PROVENANCE;
        const nextProv = reconcileProvenanceAfterManualEdit(c, combined, prevProv);
        for (const [k, sources] of Object.entries(provenanceFromText(insert, "companion"))) {
          nextProv[k] = sources;
        }
        set({
          isDirty: true,
          findingsText: combined,
          fieldProvenance: { ...get().fieldProvenance, findings: nextProv },
        });
        setTimeout(() => get().recomputeCopilot(), 0);
      }
    } else if (item.kind === "measurement") {
      get().insertAllMeasurements();
    } else {
      get().mergeField("findings", item.insertText, "companion");
    }
    get().acknowledgeCopilotItem(item.id);
  },
  recomputeCopilot: () => { const { findingsText, impressionText, measurements, activeStudyId, priors, copilotItems } = get(); const st = get().studies.find(s => s.id === activeStudyId); if (!st?.patient) { if (copilotItems.length) set({ copilotItems: [] }); return; } const items = runCopilotAnalysis({ findingsText, impressionText, measurements, modality: st.modality, sex: st.patient?.sex, hasPrior: priors.length > 0 }); if (JSON.stringify(copilotItems) === JSON.stringify(items)) return; const ci = items.filter(i => i.kind === "critical" && !get().acknowledgedCopilotIds.has(i.id)); if (ci.length > 0 && !get().notification) { get().pushNotification({ kind: "interrupt", text: `Critical finding: ${ci[0].detail}` }); if (!get().criticalSlaStartedAt) get().startCriticalSla(); } set({ copilotItems: items }); },
  setRailStage: (s) => set({ railStage: s }), toggleCommandPalette: () => set({ showCommandPalette: !get().showCommandPalette }), setCommandPalette: (o) => set({ showCommandPalette: o }),
  toggleVoiceBar: () => set({ showVoiceBar: !get().showVoiceBar }), setVoiceListening: (o) => set({ voiceListening: o }), setVoiceTranscript: (t) => set({ voiceTranscript: t }), setVoiceProvider: (p) => set({ voiceProvider: p }),
  parkStudy: () => { const id = get().activeStudyId; if (!id) return; const pk = new Set(get().parkedStudyIds); pk.add(id); set({ parkedStudyIds: pk }); get().advanceToNextStudy(); },
  startFinalize: () => set({ isFinalizing: true }),
  completeFinalize: () => { const id = get().activeStudyId; if (!id) { set({ isFinalizing: false }); return; } const c = new Set(get().completedStudyIds); c.add(id); set({ isFinalizing: false, isFinalized: true, completedStudyIds: c, lastSignAt: Date.now(), criticalSlaStartedAt: null, criticalSlaEscalated: false }); /* Navigation after finalize is handled by the workspace page (React Router navigate),  not here — the store has no router access. */ },
  cancelFinalize: () => set({ isFinalizing: false }),
  advanceToNextStudy: () => { const { studies, completedStudyIds, activeStudyId, nextStudyId, nextStudyPreloaded } = get(); if (nextStudyId && nextStudyPreloaded) { get().selectStudy(nextStudyId); set({ nextStudyId: null, nextStudyPreloaded: false }); return; } const r = studies.filter(s => !completedStudyIds.has(s.id) && s.id !== activeStudyId); const pr: Record<string, number> = { stat: 0, urgent: 1, routine: 2, vip: 1 }; r.sort((a, b) => ((pr[a.priority] ?? 2) - (pr[b.priority] ?? 2)) || (a.tatMinutes - b.tatMinutes)); if (r[0]) get().selectStudy(r[0].id); else set({ activeStudyId: null, findingsText: "", impressionText: "", recommendationText: "", fieldProvenance: {} }); },
  dismissFatigueCard: () => set({ fatigueCardDismissed: true }),
  pushNotification: (n) => set({ notification: { ...n, id: Math.random().toString(36).slice(2) } }), clearNotification: () => set({ notification: null }),
  startCriticalSla: () => set({ criticalSlaStartedAt: Date.now(), criticalSlaEscalated: false }), clearCriticalSla: () => set({ criticalSlaStartedAt: null, criticalSlaEscalated: false }), escalateCriticalSla: () => set({ criticalSlaEscalated: true }),
  openQuickSelectEditor: (t, f) => set({ quickSelectEditorOpen: true, quickSelectEditingTile: t, quickSelectEditorField: f }),
  closeQuickSelectEditor: () => set({ quickSelectEditorOpen: false, quickSelectEditingTile: null, quickSelectEditorField: null }),
  saveQuickSelectTile: (input) => { const e = input.id ? get().quickSelectTiles.find(t => t.id === input.id) : null; let tiles: QuickSelectTile[]; if (e) tiles = get().quickSelectTiles.map(t => t.id === e.id ? { ...t, ...input, updatedAt: new Date().toISOString() } : t); else tiles = [...get().quickSelectTiles, createTile(input)]; saveTiles(tiles); set({ quickSelectTiles: tiles }); get().closeQuickSelectEditor(); },
  deleteQuickSelectTile: (id) => { const t = get().quickSelectTiles.filter(t => t.id !== id); saveTiles(t); set({ quickSelectTiles: t }); get().closeQuickSelectEditor(); },
  incrementTileUsage: (id) => set({ quickSelectTiles: get().quickSelectTiles.map(t => t.id === id ? { ...t, usageCount: (t.usageCount ?? 0) + 1 } : t) }),
  toggleTileFavorite: (id) => { const t = get().quickSelectTiles.map(x => x.id === id ? { ...x, favorite: !x.favorite, updatedAt: new Date().toISOString() } : x); saveTiles(t); set({ quickSelectTiles: t }); },
  resetQuickSelectToDefaults: () => set({ quickSelectTiles: resetToDefaults() }),
  toggleReportFormatPicker: () => set({ reportFormatPickerOpen: !get().reportFormatPickerOpen }),
  setReportFormatPickerOpen: (o) => set({ reportFormatPickerOpen: o }),
  toggleFormatSelection: (id) => { const c = get().selectedFormatIds; if (c.includes(id)) set({ selectedFormatIds: c.filter(x => x !== id) }); else if (c.length < 2) set({ selectedFormatIds: [...c, id] }); },
  clearFormatSelection: () => set({ selectedFormatIds: [] }),
  applySelectedFormats: () => {
    const ids = get().selectedFormatIds;
    if (!ids.length) return;
    const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id));
    if (!fs.length) return;
    const { findingsText, impressionText, recommendationText, techniqueText } = get();
    if (shouldConfirmFormatOverwrite({
      technique: techniqueText,
      findings: findingsText,
      impression: impressionText,
      recommendation: recommendationText,
    })) {
      set({ confirmOverwriteOpen: true, pendingFormatIds: ids, pendingPathologyPatch: null });
      return;
    }
    get().confirmOverwriteAndApply();
  },
  applyFormatById: (id) => {
    set({ selectedFormatIds: [id] });
    get().applySelectedFormats();
  },
  toggleFormatFavorite: (id) => {
    const nf = get().reportFormats.map((x: ReportFormat) => x.id === id ? { ...x, favorite: !x.favorite, updatedAt: new Date().toISOString() } : x);
    saveFormats(nf);
    set({ reportFormats: nf });
  },
  confirmOverwriteAndApply: () => {
    const pendingPatch = get().pendingPathologyPatch;
    if (pendingPatch) {
      get().undoLastPatch();
      get().applyPathologyOverlay({ ...pendingPatch, force: true });
      set({ confirmOverwriteOpen: false, pendingPathologyPatch: null });
      return;
    }
    const ids = get().pendingFormatIds.length ? get().pendingFormatIds : get().selectedFormatIds;
    const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id));
    if (!fs.length) { set({ confirmOverwriteOpen: false, pendingFormatIds: [] }); return; }
    if (fs.length === 1) {
      const f = fs[0];
      const clinical = clinicalFieldsFromFormat(f);
      get().setField("technique", clinical.technique, { source: "template", replaceProvenance: true });
      get().setField("findings", clinical.findings, { source: "template", replaceProvenance: true });
      get().setField("impression", clinical.impression, { source: "template", replaceProvenance: true });
      get().setField("recommendation", clinical.recommendation, { source: "template", replaceProvenance: true });
      if (clinical.clinicalHistory.trim()) {
        // Patient/worklist/manual Hx wins: merge format phrase (no duplicate), never replace.
        const cur = get().clinicalHistoryText;
        const phrase = clinical.clinicalHistory.trim();
        if (!cur.trim()) {
          get().setField("clinicalHistory", phrase, { source: "template", replaceProvenance: true });
        } else {
          const merged = appendClinicalPhrase(cur, phrase);
          if (merged !== cur) {
            get().setField("clinicalHistory", merged, { source: "template" });
          }
        }
      }
      const nf = get().reportFormats.map((x: ReportFormat) => x.id === f.id ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x);
      saveFormats(nf);
      // Mark prior ledger contributions stale — do not silently delete rows.
      const stalePatches = get().appliedPathologyPatches.map((p) => ({ ...p, stale: true as const }));
      set({
        reportFormats: nf,
        confirmOverwriteOpen: false,
        pendingFormatIds: [],
        reportFormatPickerOpen: false,
        appliedPathologyPatches: stalePatches,
        lastPatchSnapshot: null,
        appliedFormatReportTitle: clinical.reportTitle || null,
        appliedFormatName: f.name || null,
      });
      get().pushNotification({
        kind: "ledger",
        text: "Full report applied. Prior structured contributions marked stale for review.",
      });
      void bumpReportFormatUsage(f.id);
      return;
    }
    const [a, b] = fs;
    const r = mergeTwoFormats(a, b);
    set({ lastMergeResult: r, lastMergeFormats: { a, b }, mergePreviewOpen: true, confirmOverwriteOpen: false, pendingFormatIds: [] });
  },
  cancelOverwrite: () => {
    const pendingPatch = get().pendingPathologyPatch;
    if (pendingPatch) {
      get().undoLastPatch();
      const observation = observationFromPending(pendingPatch, get().reportingContext.region, get().activeAnchor);
      const patchId = pendingPatch.id || observation.id || `pending_${Date.now().toString(36)}`;
      const templates = pendingPatch.templates ?? pendingPatch.incoming;
      set({
        appliedPathologyPatches: [
          ...get().appliedPathologyPatches.filter((p) => p.id !== patchId),
          {
            id: patchId,
            ownership: pendingPatch.ownership,
            templates,
            lastRendered: pendingPatch.incoming,
            source: pendingPatch.source,
            observation: { ...observation, id: patchId },
            replacedBaseline: { findings: [], impression: [] },
            protected: false,
          },
        ],
        confirmOverwriteOpen: false,
        pendingPathologyPatch: null,
      });
      return;
    }
    set({ confirmOverwriteOpen: false, pendingFormatIds: [], pendingPathologyPatch: null });
  },
  applyPathologyOverlay: (opts) => {
    const templates = opts.templates ?? opts.incoming;
    const patchId = opts.id ?? `patch_${Date.now().toString(36)}`;
    const observation = observationFromPending({ ...opts, id: patchId }, get().reportingContext.region, get().activeAnchor);
    const ownership = ownershipFromObservation(observation);
    const incoming = applySideToIncoming(templates, observation.supportsLaterality ? (opts.side ?? "") : "");
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: get().appliedPathologyPatches.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };

    const siblings = get().appliedPathologyPatches.filter((p) => {
      if (p.id === patchId) return false;
      const other = toLedgerPatch(p).observation;
      return observationsMutuallyExclusive(observation, other);
    });

    let narrative = narrativeFromState(get());
    let provenance = get().fieldProvenance;
    // Drop mutex siblings from the ledger only. Do not pre-strip their
    // sentences — structured overlay owns replacement and records
    // replacedBaseline so deselect can restore a normal/baseline.
    let patches = get().appliedPathologyPatches.filter((p) => p.id !== patchId && !siblings.some((s) => s.id === p.id));

    const result = overlayPathology({
      existing: narrative,
      incoming,
      ownership,
      provenance,
      source: opts.source,
      force: opts.force,
    });
    const replaced = splitReplacedByField(result.replacedSentences, narrative);
    const lastRendered: PathologyIncoming = {
      findings: renderedInField(incoming.findings, result.narrative.findings) || incoming.findings,
      impression: renderedInField(incoming.impression, result.narrative.impression) || incoming.impression,
      technique: renderedInField(incoming.technique, result.narrative.technique) || incoming.technique,
      recommendation: renderedInField(incoming.recommendation, result.narrative.recommendation) || incoming.recommendation,
    };
    const nextPatch: AppliedPathologyPatch = {
      id: patchId,
      ownership,
      templates,
      lastRendered,
      source: opts.source,
      observation,
      replacedBaseline: replaced,
      protected: false,
    };
    const nextPatches = [...patches.filter((p) => p.id !== patchId), nextPatch];
    const siblingHits = detectUnownedSiblingConflictsForLedger({
      findings: result.narrative.findings,
      patches: nextPatches.map(toLedgerPatch),
    });
    const ownershipReviewWarnings = siblingHits.map((w) => ({
      sentence: w.sentence,
      token: w.token,
      hint: UNOWNED_SIBLING_HINT,
    }));
    if (result.ambiguous && !opts.force) {
      set({
        clinicalHistoryText: result.narrative.clinicalHistory,
        techniqueText: result.narrative.technique,
        findingsText: result.narrative.findings,
        impressionText: result.narrative.impression,
        recommendationText: result.narrative.recommendation,
        fieldProvenance: result.provenance,
        isDirty: true,
        lastPatchSnapshot: snap,
        appliedPathologyPatches: nextPatches,
        ownershipReviewWarnings,
        confirmOverwriteOpen: true,
        pendingPathologyPatch: { ...opts, incoming, templates, ownership, id: patchId },
      });
      return "pending";
    }
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: result.provenance,
      isDirty: true,
      lastPatchSnapshot: snap,
      appliedPathologyPatches: nextPatches,
      ownershipReviewWarnings,
      impressionNeedsRefresh: impressionNeedsRefreshFromNarrative(
        result.narrative.impression,
        nextPatches.map(toLedgerPatch),
        result.provenance.impression,
      ),
    });
    return "applied";
  },
  applyMacroBundle: (opts) => {
    const bundleId = opts.bundleId || `bundle_${Date.now().toString(36)}`;
    let status: "applied" | "pending" = "applied";
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: get().appliedPathologyPatches.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };
    for (const obs of opts.observations) {
      const r = get().applyPathologyOverlay({ ...obs, bundleId, id: obs.id ?? `${bundleId}-${obs.concept ?? obs.label ?? "obs"}` });
      if (r === "pending") status = "pending";
    }
    set({ lastPatchSnapshot: snap });
    return status;
  },
  /**
   * Bundle deselect: remove only this bundle's observations that are
   * (a) not protected and (b) not superseded by a newer QS/voice observation
   * on the same slotKey. Overridden slots keep the overriding observation's
   * text and ownership; remaining bundle slots restore replacedBaseline,
   * same as individual removeObservation. Never auto-deletes manual text.
   */
  removeMacroBundle: (bundleId) => {
    const id = (bundleId ?? "").trim();
    if (!id) return "missing";
    const all = get().appliedPathologyPatches;
    const bundle = all.filter((p) => (p.observation?.bundleId ?? "") === id);
    if (bundle.length === 0) return "missing";
    const others = all.filter((p) => (p.observation?.bundleId ?? "") !== id);
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: all.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };
    let anyRemoved = false;
    let anyPreserved = false;
    for (const patch of bundle) {
      if (patch.protected) {
        anyPreserved = true;
        continue;
      }
      const slot = patch.observation?.slotKey;
      const overridden = Boolean(slot && others.some((o) => {
        if (o.observation?.slotKey !== slot) return false;
        return o.source === "quick-select" || o.source === "quick-findings" || o.source === "radiologist-voice";
      }));
      if (overridden) continue;
      const outcome = get().removeObservation(patch.id);
      if (outcome === "preserved-manual") anyPreserved = true;
      if (outcome === "removed") anyRemoved = true;
    }
    set({ lastPatchSnapshot: snap, isDirty: true });
    if (anyPreserved && !anyRemoved) return "preserved-manual";
    if (anyRemoved) return "removed";
    return "no-op-unproven";
  },
  refreshImpressionFromLedger: () => {
    const patches = get().appliedPathologyPatches.map(toLedgerPatch);
    const remaining = generateLocalImpression(get().findingsText);
    const next = refreshImpressionFromObservations({
      currentImpression: get().impressionText,
      patches,
      remainingAbnormalLines: remaining,
      provenance: get().fieldProvenance.impression,
    });
    const nextProv = { ...(get().fieldProvenance.impression ?? EMPTY_FIELD_PROVENANCE) };
    for (const s of next.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      const key = normalizeForDedupe(s);
      if (!key) continue;
      if (nextProv[key]?.includes("manual")) continue;
      const prev = nextProv[key] ?? [];
      nextProv[key] = prev.includes("quick-findings") ? prev : [...prev, "quick-findings"];
    }
    set({
      impressionText: next,
      fieldProvenance: { ...get().fieldProvenance, impression: nextProv },
      impressionNeedsRefresh: false,
      isDirty: true,
    });
  },
  hydrateObservationLedger: (raw) => {
    const parsed = parseObservationLedger(raw);
    if (parsed.status === "absent") {
      set({ appliedPathologyPatches: [], ledgerHydrationWarning: null });
      return { ok: true, mode: "narrative-only", reason: "absent", patchCount: 0 };
    }
    if (parsed.status !== "restored") {
      const result: LedgerHydrationResult = {
        ok: false,
        mode: "narrative-only",
        reason: parsed.status,
        patchCount: 0,
        warning: "Observation ledger could not be restored. Report text is unchanged.",
      };
      logLedgerHydrationSafe(result);
      set({ appliedPathologyPatches: [], ledgerHydrationWarning: result.warning ?? null });
      return result;
    }
    const narrative = narrativeFromState(get());
    const hashes = extractRecordedHashes(raw);
    const reconciled = parsed.patches.map((p) => reconcilePatchAgainstNarrative(p, narrative, hashes.get(p.id)));
    const staleCount = reconciled.filter((p) => p.stale).length;
    const provenance = parsed.fieldProvenance ?? reconstructProvenanceFromLedger(narrative, reconciled);
    const warning = staleCount > 0
      ? "Some saved observations no longer match the report text. Narrative was not changed."
      : null;
    const impressionNeedsRefresh = impressionNeedsRefreshFromNarrative(
      narrative.impression,
      reconciled,
      provenance.impression,
    );
    set({
      appliedPathologyPatches: reconciled.map((p) => ({
        id: p.id,
        ownership: ownershipFromObservation(p.observation),
        templates: p.templates,
        lastRendered: p.lastRendered,
        source: p.source,
        observation: p.observation,
        replacedBaseline: p.replacedBaseline,
        protected: p.protected,
        stale: p.stale,
      })),
      fieldProvenance: {
        ...get().fieldProvenance,
        findings: provenance.findings ?? get().fieldProvenance.findings,
        impression: provenance.impression ?? get().fieldProvenance.impression,
        technique: provenance.technique ?? get().fieldProvenance.technique,
        recommendation: provenance.recommendation ?? get().fieldProvenance.recommendation,
        clinicalHistory: provenance.clinicalHistory ?? get().fieldProvenance.clinicalHistory,
      },
      ledgerHydrationWarning: warning,
      impressionNeedsRefresh,
      ...(hydrateCoverageFromLedgerRaw(raw) ? { coverageMarks: hydrateCoverageFromLedgerRaw(raw)! } : {}),
    });
    return {
      ok: true,
      mode: "restored",
      reason: "restored",
      patchCount: reconciled.length,
      warning: warning ?? undefined,
    };
  },
  serializeObservationLedger: () => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const byScope = { ...get().coverageByScope, [scope]: get().coverageMarks };
    return serializeObservationLedger(
      get().appliedPathologyPatches.map(toLedgerPatch),
      get().fieldProvenance,
      get().coverageMarks.length > 0
        ? serializeCoverageEnvelope(get().coverageMarks, { scopeKey: scope, byScope })
        : undefined,
    );
  },
  setActiveAnchor: (anchor) => {
    if (anchorsEqual(get().activeAnchor, anchor)) return;
    const expected = get().activeStudyInstanceUID;
    if (
      anchor
      && expected
      && anchor.studyInstanceUID
      && anchor.studyInstanceUID !== expected
    ) {
      return;
    }
    set({ activeAnchor: anchor });
  },
  setSelectedObservationId: (id) => {
    if (get().selectedObservationId === id) return;
    set({ selectedObservationId: id });
  },
  setCoverageMark: (regionKey, status, reason) => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const base = get().coverageMarks.length ? get().coverageMarks : defaultCoverageMarks(scope);
    const next = setCoverageStatus(base, regionKey, status, reason, scope);
    if (coverageMarksEqual(get().coverageMarks, next)) return;
    const byScope = { ...get().coverageByScope, [scope]: next };
    set({
      coverageMarks: next,
      coverageByScope: byScope,
      isDirty: status === "reviewed" || status === "waived" || status === "partial" || get().isDirty,
    });
  },
  touchCoverageViewed: (regionKey) => {
    const scope = coverageScopeKey(get().reportingContext.region);
    const base = get().coverageMarks.length ? get().coverageMarks : defaultCoverageMarks(scope);
    const next = markRegionViewed(base, regionKey, get().activeAnchor);
    if (coverageMarksEqual(get().coverageMarks, next)) return;
    const byScope = { ...get().coverageByScope, [scope]: next };
    set({
      coverageMarks: next,
      coverageByScope: byScope,
      // Focus alone never dirties the report.
    });
  },
  hydrateCoverageMarks: (raw) => {
    const parsed = parseCoverageFromRaw(raw);
    if (!parsed) return;
    const scope = coverageScopeKey(get().reportingContext.region);
    const scoped = filterCoverageForScope(parsed, scope);
    set({
      coverageMarks: scoped,
      coverageByScope: { ...get().coverageByScope, [scope]: scoped },
    });
  },
  serializeCoverageMarks: () => get().coverageMarks,
  dismissOwnershipReview: () => set({ ownershipReviewWarnings: [] }),
  dismissLedgerHydrationWarning: () => set({ ledgerHydrationWarning: null }),
  removeObservation: (id) => {
    const patch = get().appliedPathologyPatches.find((p) => p.id === id);
    if (!patch) return "missing";
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: get().appliedPathologyPatches.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };
    const result = removeLedgerObservation(narrativeFromState(get()), get().fieldProvenance, toLedgerPatch(patch));
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: result.provenance,
      appliedPathologyPatches: get().appliedPathologyPatches.filter((p) => p.id !== id),
      selectedObservationId: get().selectedObservationId === id ? null : get().selectedObservationId,
      lastPatchSnapshot: snap,
      isDirty: true,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("care:observation-removed", { detail: { observationId: id } }));
    }
    return result.outcome;
  },
  undoLastPatch: () => {
    const snap = get().lastPatchSnapshot;
    if (!snap) return false;
    set({
      clinicalHistoryText: snap.clinicalHistoryText,
      techniqueText: snap.techniqueText,
      findingsText: snap.findingsText,
      impressionText: snap.impressionText,
      recommendationText: snap.recommendationText,
      fieldProvenance: snap.fieldProvenance,
      appliedPathologyPatches: snap.appliedPathologyPatches,
      voiceComposerObservations: snap.voiceComposerObservations ?? [],
      voiceComposerTranscriptHistory: snap.voiceComposerTranscriptHistory ?? [],
      lastPatchSnapshot: null,
      isDirty: true,
    });
    return true;
  },
  applyVoiceComposerPlan: (plan: VoiceChangePlan, transcript: string, opts?: { force?: boolean }) => {
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: get().appliedPathologyPatches.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };
    const result = applyChangePlan({
      narrative: narrativeFromState(get()),
      provenance: get().fieldProvenance,
      plan,
      activeObservations: get().voiceComposerObservations,
      force: opts?.force,
    });
    if (!result.ok || !result.narrative || !result.provenance) {
      return "blocked";
    }
    const region = get().reportingContext.region || "";
    const kept = get().appliedPathologyPatches.filter((p) => !p.id.startsWith("voice-"));
    const voicePatches: AppliedPathologyPatch[] = (result.activeObservations ?? []).map((obs) => {
      const observation = buildCanonicalObservation(observationInputFromVoice(obs, region));
      return {
        id: observation.id || `voice-${obs.concept ?? "obs"}`,
        ownership: ownershipFromObservation(observation),
        templates: { findings: obs.findingsText, impression: obs.impressionText },
        lastRendered: { findings: obs.findingsText, impression: obs.impressionText },
        source: "radiologist-voice",
        observation,
        replacedBaseline: { findings: [], impression: [] },
        protected: false,
      };
    });
    const written = {
      findings: (result.activeObservations ?? []).map((o) => o.findingsText).filter(Boolean).join("\n"),
      impression: (result.activeObservations ?? []).map((o) => o.impressionText).filter(Boolean).join("\n"),
    };
    set({
      clinicalHistoryText: result.narrative.clinicalHistory,
      techniqueText: result.narrative.technique,
      findingsText: result.narrative.findings,
      impressionText: result.narrative.impression,
      recommendationText: result.narrative.recommendation,
      fieldProvenance: stampVoiceAuthoredProvenance(result.provenance, written),
      isDirty: true,
      lastPatchSnapshot: snap,
      voiceComposerObservations: result.activeObservations ?? [],
      voiceComposerTranscriptHistory: transcript
        ? [...get().voiceComposerTranscriptHistory, transcript]
        : get().voiceComposerTranscriptHistory,
      appliedPathologyPatches: [...kept, ...voicePatches],
    });
    return "applied";
  },
  applyAiComposerAccepted: (opts) => {
    const snap: PatchSnapshot = {
      clinicalHistoryText: get().clinicalHistoryText,
      techniqueText: get().techniqueText,
      findingsText: get().findingsText,
      impressionText: get().impressionText,
      recommendationText: get().recommendationText,
      fieldProvenance: { ...get().fieldProvenance },
      appliedPathologyPatches: get().appliedPathologyPatches.map((p) => ({ ...p })),
      voiceComposerObservations: [...get().voiceComposerObservations],
      voiceComposerTranscriptHistory: [...get().voiceComposerTranscriptHistory],
    };
    const markField = (field: "findings" | "impression" | "recommendation", text: string): FieldProvenanceMap => {
      const map: FieldProvenanceMap = { ...(get().fieldProvenance[field] ?? EMPTY_FIELD_PROVENANCE) };
      for (const sent of text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
        const key = normalizeForDedupe(sent);
        if (!key) continue;
        const prev = map[key] ?? [];
        map[key] = prev.includes("ai-draft") ? prev : [...prev, "ai-draft"];
      }
      return map;
    };
    set({
      findingsText: opts.findings,
      impressionText: opts.impression,
      recommendationText: opts.recommendation,
      fieldProvenance: {
        ...get().fieldProvenance,
        findings: markField("findings", opts.findings),
        impression: markField("impression", opts.impression),
        recommendation: markField("recommendation", opts.recommendation),
      },
      isDirty: true,
      lastPatchSnapshot: snap,
    });
    return "applied";
  },
  clearVoiceComposerSession: () => set({
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    appliedPathologyPatches: get().appliedPathologyPatches.filter((p) => !p.id.startsWith("voice-")),
  }),
  relateralizePatches: (side) => {
    const patches = get().appliedPathologyPatches;
    if (!patches.length) return;
    let findings = get().findingsText;
    let impression = get().impressionText;
    let technique = get().techniqueText;
    let recommendation = get().recommendationText;
    const nextPatches = patches.map((p) => {
      if (p.observation && !p.observation.supportsLaterality) return p;
      const next = applySideToIncoming(p.templates, side);
      findings = relateralizeOwnedText(findings, p.lastRendered.findings ?? "", next.findings ?? "");
      impression = relateralizeOwnedText(impression, p.lastRendered.impression ?? "", next.impression ?? "");
      technique = relateralizeOwnedText(technique, p.lastRendered.technique ?? "", next.technique ?? "");
      recommendation = relateralizeOwnedText(recommendation, p.lastRendered.recommendation ?? "", next.recommendation ?? "");
      const observation = p.observation
        ? buildCanonicalObservation({
          ...p.observation,
          laterality: side,
          supportsLaterality: true,
          id: p.observation.id,
        })
        : p.observation;
      return { ...p, lastRendered: next, observation };
    });
    set({
      findingsText: findings,
      impressionText: impression,
      techniqueText: technique,
      recommendationText: recommendation,
      appliedPathologyPatches: nextPatches,
      isDirty: true,
    });
  },
  applyMergedResult: () => {
    const r = get().lastMergeResult;
    if (!r) return;
    // Build per-sentence provenance from the merge result so differential colors
    // (Format A = emerald, Format B = sky, common = template/gray) persist in the editor.
    const buildProv = (sentences: Array<{ text: string; source: "common" | "from-a" | "from-b" }>): FieldProvenanceMap => {
      const out: FieldProvenanceMap = {};
      for (const s of sentences) {
        const key = normalizeForDedupe(s.text);
        if (!key) continue;
        const src: InsertSource = s.source === "from-a" ? "template-a" : s.source === "from-b" ? "template-b" : "template";
        out[key] = [src];
      }
      return out;
    };
    const techniqueProv = provenanceFromText(r.technique, "template");
    const findingsProv = buildProv(r.findingsMerged.sentences);
    const impressionProv = buildProv(r.impressionMerged.sentences);
    const recommendationProv = buildProv(r.recommendationMerged.sentences);
    const historyText = (r.clinicalHistory ?? "").trim() ? r.clinicalHistory : get().clinicalHistoryText;
    const historyProv = (r.clinicalHistory ?? "").trim()
      ? buildProv(r.clinicalHistorySentences ?? [])
      : (get().fieldProvenance.clinicalHistory ?? EMPTY_FIELD_PROVENANCE);
    set({
      techniqueText: r.technique,
      findingsText: r.findings,
      impressionText: r.impression,
      recommendationText: r.recommendation,
      clinicalHistoryText: historyText,
      fieldProvenance: {
        technique: techniqueProv,
        findings: findingsProv,
        impression: impressionProv,
        recommendation: recommendationProv,
        clinicalHistory: historyProv,
      },
      isDirty: true,
      mergePreviewOpen: false,
      lastMergeResult: null,
      lastMergeFormats: null,
      reportFormatPickerOpen: false,
      appliedPathologyPatches: [],
      lastPatchSnapshot: null,
      impressionNeedsRefresh: false,
      appliedFormatReportTitle:
        r.combinedReportTitle
        || (get().lastMergeFormats?.a?.reportTitle ?? "").trim()
        || (get().lastMergeFormats?.b?.reportTitle ?? "").trim()
        || null,
    });
    // Increment usage count
    const ids = get().selectedFormatIds;
    const nf = get().reportFormats.map((x: ReportFormat) => ids.includes(x.id) ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x);
    saveFormats(nf);
    set({ reportFormats: nf });
  },
  cancelMerge: () => set({ mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null }),
  saveAsFormat: (i) => {
    const local = createFormat({
      ...i,
      bodyPart: canonicalContentRegion(i.bodyPart) || i.bodyPart,
      clinicalHistory: i.clinicalHistory ?? "",
    });
    const optimistic = [...get().reportFormats, local];
    saveFormats(optimistic);
    set({ reportFormats: optimistic, saveAsFormatDialogOpen: false });
    void createReportFormatOnServer(i)
      .then((serverFmt) => {
        const withoutTemp = get().reportFormats.filter((f) => f.id !== local.id);
        const next = [...withoutTemp, serverFmt];
        saveFormats(next);
        set({ reportFormats: next });
      })
      .catch(() => {
        /* offline: local cache remains until next hydrate/migrate */
      });
  },
  deleteReportFormat: (id) => {
    const fs = get().reportFormats.filter((f: ReportFormat) => f.id !== id);
    saveFormats(fs);
    set({ reportFormats: fs, selectedFormatIds: get().selectedFormatIds.filter((x: string) => x !== id) });
    void deleteReportFormatOnServer(id).catch(() => { /* offline soft-fail */ });
  },
  openSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: true }), closeSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: false }),
  resetReportFormatsToDefaults: () => set({ reportFormats: resetFormatsToDefaults(), selectedFormatIds: [] }),
  hydrateContentLibraries: async () => {
    try {
      const formats = await hydrateReportFormatsLibrary();
      set({ reportFormats: formats });
    } catch { /* keep bootstrap loadFormats() */ }
    try {
      await hydrateChocolateMacrosFromServer();
    } catch { /* keep local chocolate cache */ }
  },
  openMacroEditor: (m) => set({ macroEditorOpen: true, editingMacro: m }), closeMacroEditor: () => set({ macroEditorOpen: false, editingMacro: null }),
  saveMacro: (input) => { const e = input.id ? get().snippetMacros.find((m: SnippetMacro) => m.id === input.id) : null; let ms: SnippetMacro[]; if (e) ms = get().snippetMacros.map((m: SnippetMacro) => m.id === e.id ? { ...m, ...input, updatedAt: new Date().toISOString() } : m); else ms = [...get().snippetMacros, createMacro(input)]; saveMacros(ms); set({ snippetMacros: ms }); get().closeMacroEditor(); },
  deleteMacro: (id) => { const ms = get().snippetMacros.filter((m: SnippetMacro) => m.id !== id); saveMacros(ms); set({ snippetMacros: ms }); get().closeMacroEditor(); },
  setActiveMacroPrompt: (p) => set({ activeMacroPrompt: p }),
  applyMacroWithValues: (values: Record<string, string>) => {
    const p = get().activeMacroPrompt;
    if (!p) return;
    const exp = expandMacro(p.macro, values);
    const c = get()[`${p.field}Text` as "findingsText"];
    const before = c.slice(0, p.startPos);
    const after = c.slice(p.startPos).replace(/^:[a-z][a-z0-9_]*/i, "");
    // Macro expansion replaces the trigger token; merge the expanded text with macro provenance.
    const assembled = before + exp + " " + after;
    const prevProv = get().fieldProvenance[p.field] ?? EMPTY_FIELD_PROVENANCE;
    const macroProv = provenanceFromText(exp, "macro");
    const reconciled = reconcileProvenanceAfterManualEdit(c, assembled, { ...prevProv, ...macroProv });
    // Prefer macro attribution for sentences that came from the expansion.
    for (const [k, sources] of Object.entries(macroProv)) {
      reconciled[k] = sources;
    }
    set({
      isDirty: true,
      [fieldTextKey(p.field)]: assembled,
      fieldProvenance: { ...get().fieldProvenance, [p.field]: reconciled },
      activeMacroPrompt: null,
    });
    setTimeout(() => get().recomputeCopilot(), 0);
  },
  updateSignOffProfile: (m: Modality, n: string, c: string) => { const e = get().signOffProfiles.find((p: SignOffProfile) => p.modality === m); let ps: SignOffProfile[]; if (e) ps = get().signOffProfiles.map((p: SignOffProfile) => p.id === e.id ? { ...p, signerName: n, signerCredentials: c } : p); else ps = [...get().signOffProfiles, createProfile({ modality: m, signerName: n, signerCredentials: c, isDefault: true })]; saveProfiles(ps); set({ signOffProfiles: ps }); },
  triggerPreload: () => set({ preloadTriggered: true }), resetPreload: () => set({ preloadTriggered: false, nextStudyPreloaded: false }),
  setReportingContext: (ctx) => {
    if (reportingContextEqual(get().reportingContext, ctx)) return;
    const prevScope = coverageScopeKey(get().reportingContext.region);
    const nextScope = coverageScopeKey(ctx.region);
    const byScope = { ...get().coverageByScope, [prevScope]: get().coverageMarks };
    const nextMarks = filterCoverageForScope(byScope[nextScope] ?? [], nextScope);
    // Region change: swap coverage scope; do not leak LS marks into Brain UI.
    set({
      reportingContext: ctx,
      coverageByScope: { ...byScope, [nextScope]: nextMarks },
      coverageMarks: nextMarks,
    });
  },
} as WorkspaceStore);

export const useWorkspace: UseBoundStore<StoreApi<WorkspaceStore>> = create<WorkspaceStore>()(createWorkspaceStore);

/**
 * Typed selector — shallow equality by default so selectors never trigger
 * infinite re-renders from fresh `{}` / `[]` fallbacks (React minified #185).
 */
export function useWorkspaceSelector<T>(selector: (state: WorkspaceStore) => T): T {
  return useWorkspace(useShallow(selector));
}

export { DEFAULT_QUICK_SELECT_TILES, lookupTiles, DEFAULT_REPORT_FORMATS, lookupFormats, DEFAULT_SNIPPET_MACROS, lookupMacros, DEFAULT_SIGN_OFF_PROFILES, lookupProfile, formatSignOff };
