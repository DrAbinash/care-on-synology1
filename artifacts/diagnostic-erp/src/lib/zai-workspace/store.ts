import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Study, MeasurementRow, PriorStudy, CopilotItem, CriticalFinding, QuickSelectTile, QuickSelectField, ReportFormat, SnippetMacro, SignOffProfile, MergeResult, Modality, LintIssue } from "./types";
import { runLintRules, runCopilotAnalysis, computeQualityScore, mergeTwoFormats, expandMacro, detectMacroTrigger, shouldPreloadNext } from "./types";
import { normalizeWorkspaceStudies } from "./normalizeWorkspaceStudy";
import { DEFAULT_QUICK_SELECT_TILES, lookupTiles, loadTiles, saveTiles, createTile, resetToDefaults } from "./quick-select-library";
import { DEFAULT_REPORT_FORMATS, lookupFormats, loadFormats, saveFormats, createFormat, resetFormatsToDefaults } from "./report-formats-library";
import { DEFAULT_SNIPPET_MACROS, lookupMacros, loadMacros, saveMacros, createMacro } from "./snippet-macros-library";
import { DEFAULT_SIGN_OFF_PROFILES, loadProfiles, saveProfiles, lookupProfile, formatSignOff, createProfile } from "./sign-off-profiles";
import {
  mergeReportFieldContentWithProvenance,
  provenanceFromText,
  reconcileProvenanceAfterManualEdit,
  type FieldProvenanceMap,
  type InsertSource,
  type ReportFieldKey,
} from "@/lib/reportFieldMerge";

export type EditorField = "findings" | "impression" | "recommendation" | "technique" | "clinicalHistory";
export type RailStage = "orient" | "observe" | "measure" | "conclude" | "verify";

type FieldProvenanceState = Partial<Record<EditorField, FieldProvenanceMap>>;

/** Stable empty provenance — never use inline `?? {}` inside zustand selectors (React #185). */
export const EMPTY_FIELD_PROVENANCE: FieldProvenanceMap = {};

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
  saveAsFormatDialogOpen: boolean; mergePreviewOpen: boolean; lastMergeResult: MergeResult | null;
  lastMergeFormats: { a: ReportFormat; b: ReportFormat | null } | null; confirmOverwriteOpen: boolean; pendingFormatIds: string[];
  snippetMacros: SnippetMacro[]; macroEditorOpen: boolean; editingMacro: SnippetMacro | null;
  activeMacroPrompt: { macro: SnippetMacro; field: EditorField; startPos: number } | null;
  signOffProfiles: SignOffProfile[];
  preloadTriggered: boolean;
}

function fieldTextKey(f: EditorField): keyof Pick<S, "findingsText" | "impressionText" | "recommendationText" | "techniqueText" | "clinicalHistoryText"> {
  if (f === "findings") return "findingsText";
  if (f === "impression") return "impressionText";
  if (f === "recommendation") return "recommendationText";
  if (f === "technique") return "techniqueText";
  return "clinicalHistoryText";
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
  applySelectedFormats: () => void; confirmOverwriteAndApply: () => void; cancelOverwrite: () => void; applyMergedResult: () => void; cancelMerge: () => void;
  saveAsFormat: (i: Omit<ReportFormat, "id" | "createdAt" | "updatedAt">) => void; deleteReportFormat: (id: string) => void;
  openSaveAsFormatDialog: () => void; closeSaveAsFormatDialog: () => void; resetReportFormatsToDefaults: () => void;
  openMacroEditor: (m: SnippetMacro | null) => void; closeMacroEditor: () => void; saveMacro: (i: Omit<SnippetMacro, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  deleteMacro: (id: string) => void; setActiveMacroPrompt: (p: { macro: SnippetMacro; field: EditorField; startPos: number } | null) => void; applyMacroWithValues: (v: Record<string, string>) => void;
  updateSignOffProfile: (m: Modality, n: string, c: string) => void; triggerPreload: () => void; resetPreload: () => void;
};

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
  saveAsFormatDialogOpen: false, mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, confirmOverwriteOpen: false, pendingFormatIds: [],
  snippetMacros: typeof window !== "undefined" ? loadMacros() : DEFAULT_SNIPPET_MACROS, macroEditorOpen: false, editingMacro: null, activeMacroPrompt: null,
  signOffProfiles: typeof window !== "undefined" ? loadProfiles() : DEFAULT_SIGN_OFF_PROFILES, preloadTriggered: false,

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
  selectStudy: (id) => { const st = get().studies.find(s => s.id === id); if (!st) return; set({ activeStudyId: id, findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: st.clinicalHistory || "", fieldProvenance: {}, measurements: [], priors: [], isDirty: false, isFinalized: false, isFinalizing: false, railStage: "orient", ghostText: null, ghostTextTarget: null, acknowledgedCopilotIds: new Set(), activeCopilotItem: null, voiceTranscript: "", voiceListening: false, selectedFormatIds: [], reportFormatPickerOpen: false, criticalSlaStartedAt: null, criticalSlaEscalated: false, preloadTriggered: false, nextStudyPreloaded: false }); setTimeout(() => get().recomputeCopilot(), 0); },
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
    set(p);
    if (f === "findings" || f === "impression" || f === "recommendation") {
      const d = detectMacroTrigger(v, get().snippetMacros);
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
      const d = detectMacroTrigger(result.text, get().snippetMacros);
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
  setMeasurements: (m) => set({ measurements: m }), setPriors: (p) => set({ priors: p }),
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
  completeFinalize: () => { const id = get().activeStudyId; if (!id) { set({ isFinalizing: false }); return; } const c = new Set(get().completedStudyIds); c.add(id); set({ isFinalizing: false, isFinalized: true, completedStudyIds: c, lastSignAt: Date.now(), criticalSlaStartedAt: null, criticalSlaEscalated: false }); setTimeout(() => get().advanceToNextStudy(), 1800); },
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
  applySelectedFormats: () => { const ids = get().selectedFormatIds; if (!ids.length) return; const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id)); if (!fs.length) return; const { findingsText, impressionText, recommendationText, techniqueText } = get(); if (findingsText.trim() || impressionText.trim() || recommendationText.trim() || techniqueText.trim()) { set({ confirmOverwriteOpen: true, pendingFormatIds: ids }); return; } get().confirmOverwriteAndApply(); },
  confirmOverwriteAndApply: () => { const ids = get().pendingFormatIds.length ? get().pendingFormatIds : get().selectedFormatIds; const fs = get().reportFormats.filter((f: ReportFormat) => ids.includes(f.id)); if (!fs.length) { set({ confirmOverwriteOpen: false, pendingFormatIds: [] }); return; } if (fs.length === 1) { const f = fs[0]; get().setField("technique", f.technique, { source: "template", replaceProvenance: true }); get().setField("findings", f.findings, { source: "template", replaceProvenance: true }); get().setField("impression", f.impression, { source: "template", replaceProvenance: true }); get().setField("recommendation", f.recommendation, { source: "template", replaceProvenance: true }); const nf = get().reportFormats.map((x: ReportFormat) => x.id === f.id ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x); saveFormats(nf); set({ reportFormats: nf, confirmOverwriteOpen: false, pendingFormatIds: [], reportFormatPickerOpen: false }); return; } const [a, b] = fs; const r = mergeTwoFormats(a, b); set({ lastMergeResult: r, lastMergeFormats: { a, b }, mergePreviewOpen: true, confirmOverwriteOpen: false, pendingFormatIds: [] }); },
  cancelOverwrite: () => set({ confirmOverwriteOpen: false, pendingFormatIds: [] }),
  applyMergedResult: () => { const r = get().lastMergeResult; if (!r) return; get().setField("technique", r.technique, { source: "template", replaceProvenance: true }); get().setField("findings", r.findings, { source: "template", replaceProvenance: true }); get().setField("impression", r.impression, { source: "template", replaceProvenance: true }); get().setField("recommendation", r.recommendation, { source: "template", replaceProvenance: true }); const ids = get().selectedFormatIds; const nf = get().reportFormats.map((x: ReportFormat) => ids.includes(x.id) ? { ...x, usageCount: (x.usageCount ?? 0) + 1 } : x); saveFormats(nf); set({ reportFormats: nf, mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null, reportFormatPickerOpen: false }); },
  cancelMerge: () => set({ mergePreviewOpen: false, lastMergeResult: null, lastMergeFormats: null }),
  saveAsFormat: (i) => { const f = createFormat(i); const fs = [...get().reportFormats, f]; saveFormats(fs); set({ reportFormats: fs, saveAsFormatDialogOpen: false }); },
  deleteReportFormat: (id) => { const fs = get().reportFormats.filter((f: ReportFormat) => f.id !== id); saveFormats(fs); set({ reportFormats: fs, selectedFormatIds: get().selectedFormatIds.filter((x: string) => x !== id) }); },
  openSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: true }), closeSaveAsFormatDialog: () => set({ saveAsFormatDialogOpen: false }),
  resetReportFormatsToDefaults: () => set({ reportFormats: resetFormatsToDefaults(), selectedFormatIds: [] }),
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
