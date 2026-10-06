/**
 * Draft persistence, hydrate, leave guards, and 30s autosave for
 * RadiologyReportingWorkspace. Phase 3 extraction — behavior unchanged.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from "react";
import type { RadiologyDraftRow } from "@/hooks/useRadiologyDraftId";
import { saveRadiologyDraft } from "@/lib/radiologyReportLifecycle";
import {
  canHydrateDraftForPatient,
  shouldCommitAutosave,
} from "@/lib/radiologyWorkspaceSafety";
import { registerDraftRescueSaver, deregisterDraftRescueSaver } from "@/lib/draftRescue";
import { writeDraftBackupSnapshot } from "@/hooks/useLocalDraftBackup";
import { createEnsureDraftOnce, isMeaningfulReportEdit } from "@/lib/ensureDraftOnce";
import { leaveDirtyStudy, type LeaveChoice } from "@/lib/leaveDirtyStudy";
import { retryWithBackoff, isTransientError, offlineBlockMessage } from "@/lib/reliability";
import {
  formatHasStructuredFields,
} from "@/components/radiology/StructuredFormatPanel";
import {
  extractCareStructuredFormatState,
  toDraftFormatState,
  type StructuredValues,
} from "@/lib/structuredFormat";
import { selectedQuickFindingIds } from "@/lib/observationSlot";
import { extractCareObservationLedger } from "@/lib/observationLedger";
import {
  extractCareViewerMeasurements,
  extractCareCanalApProvenance,
} from "@/lib/structuredViewerMeasurements";
import type { CanalApProvenanceMap } from "@/lib/spineCanalAp";
import {
  extractCareVascularTechnique,
  vascularTechniquePayload,
} from "@/lib/mriBrainVascularDraftState";
import {
  SPINE_REPORTING_DRAFT_KEY,
  extractSpineReportingState,
  spineReportingDraftPayload,
} from "@/lib/mriSpineDraftState";
import {
  extractLinkedStudyFromStructuredJson,
  findingsSectionFromStudy,
  linkedStudyPayload,
} from "@/lib/multiStudyReport";
import { extractAppliedPatternsFromStructuredJson } from "@/lib/abnormalPatternDraft";
import {
  buildCareReportFormatIdentity,
  extractCareReportFormatIdentity,
} from "@/lib/zai-workspace/normalBootstrap";
import { reportFormatRevision } from "@/lib/zai-workspace/fullReportBaseline";
import { reconstructStartingCanvasBaseline } from "@/lib/zai-workspace/startingCanvasHighlight";
import {
  normalizeImpressionLines, radiologyReportBackupKey, rescueBackupEnvelope,
} from "@/lib/workspaceReportState";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { readWorkspaceClinicalTexts } from "@/lib/zai-workspace/workspaceClinicalTexts";

export type DraftStudySetupSlice = {
  selectedTemplate: {
    id: number;
    formatVersion?: number;
    sectionsJson: string;
  } | null | undefined;
};

export type UseDraftPersistenceOptions = {
  studyId: number | undefined;
  draftId: number | null | undefined;
  isOnline: boolean;
  isDirty: boolean;
  isFinalized: boolean;
  /**
   * The gate `useLocalDraftBackup` applies to the same storage key. The rescue
   * flush must obey it too: a report signed in ANOTHER session leaves
   * `isFinalized` false here, and copying its text to localStorage on a shared
   * workstation is exactly what `draftBackup.clear()` on finalize prevents.
   */
  backupEnabled: boolean;
  isMobile: boolean;
  useStructured: boolean;
  findingsMap: Record<string, { normal: boolean; text: string }>;
  structuredValues: StructuredValues;
  studySetup: DraftStudySetupSlice;
  workflow: {
    currentRow: {
      patientId?: number | null;
      clinicalHistory?: string;
      modality?: string | null;
      studyDescription?: string | null;
      bodyPart?: string | null;
      accessionNumber?: string | null;
      studyInstanceUID?: string | null;
    } | null;
    transitioning: boolean;
    peekNext: () => { id: string | number } | null;
    beginTransition: (from: number | undefined, to: { id: string | number }) => void;
    beginPreviousTransition: (from: number | undefined) => string | number | null;
  };
  existingDraft: RadiologyDraftRow | null | undefined;
  isLoadingExistingDraft: boolean;
  captureSavedDraftId: (id: number) => void;
  toast: ReturnType<typeof import("@/hooks/use-toast").useToast>["toast"];
  openStudy: (id: string | number) => void;
  onStudySwitchPageReset: () => void;
  setStructuredValues: Dispatch<SetStateAction<StructuredValues>>;
  setSelectedQuickIds: Dispatch<SetStateAction<Set<number>>>;
  structuredTouchedRef: MutableRefObject<boolean>;
  findingsText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  clinicalHistoryText: string;
  /**
   * Lifted so `useReportingStudySetup({ draftHydrated })` can run before this hook
   * while hydrate logic still lives here (Phase 3 call-order constraint).
   */
  draftHydratedStudyId: number | null;
  setDraftHydratedStudyId: Dispatch<SetStateAction<number | null>>;
};

export function useDraftPersistence(opts: UseDraftPersistenceOptions) {
  const {
    studyId, draftId, isOnline, isDirty, isFinalized, isMobile,
    backupEnabled,
    useStructured, findingsMap, structuredValues, studySetup, workflow,
    existingDraft, isLoadingExistingDraft, captureSavedDraftId, toast,
    openStudy, onStudySwitchPageReset, setStructuredValues, setSelectedQuickIds,
    structuredTouchedRef,
    findingsText, impressionText, techniqueText, recommendationText, clinicalHistoryText,
    draftHydratedStudyId, setDraftHydratedStudyId,
  } = opts;

  const hydratedDraftForStudyRef = useRef<number | null>(null);
  /** Study whose server draft was restored into the editor this open. */
  const restoredDraftForStudyRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const studyIdRef = useRef<number | undefined>(undefined);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const leaveResolverRef = useRef<((choice: LeaveChoice) => void) | null>(null);
  const leavePromptReasonRef = useRef("This report has unsaved changes.");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveDraftRef = useRef<(opts?: { silent?: boolean }) => Promise<number | null>>(async () => null);
  const draftIdRef = useRef<number | null>(null);
  draftIdRef.current = draftId ?? null;

  const goNextStudyRef = useRef<() => void>(() => {});
  const goPrevStudyRef = useRef<() => void>(() => {});
  const openStudyGuardedRef = useRef<(id: string | number) => void>((id) => {
    openStudy(id);
  });

  const goNextStudy = useCallback(() => { goNextStudyRef.current(); }, []);
  const goPrevStudy = useCallback(() => { goPrevStudyRef.current(); }, []);
  const openStudyGuarded = useCallback((id: string | number) => {
    openStudyGuardedRef.current(id);
  }, []);

  // Reset patient-specific editor state when switching studies
  useEffect(() => {
    saveGenerationRef.current += 1;
    studyIdRef.current = studyId;
    restoredDraftForStudyRef.current = null;
    onStudySwitchPageReset();
    // Clear zustand editor unconditionally — worklist navigate() does not call
    // selectStudy, so Patient A text must not linger on Patient B.
    //
    // This is the PARTIAL reset: it spreads the same clinical definition as
    // selectStudy's FULL reset, and differs only by keeping `reportingContext`,
    // which the hydrate effect below (declared after this one, so it runs after)
    // repopulates for the incoming study. Widening this list is safe against a
    // mid-session wipe: `onStudySwitchPageReset` is a stable useCallback over a
    // state setter, so this effect re-fires only when `studyId` genuinely
    // changes. `clinicalHistoryText` is an identity field the helper leaves to
    // the caller — cleared here, reseeded from the study row in selectStudy.
    useWorkspace.setState({
      ...emptyClinicalState(),
      clinicalHistoryText: "",
    });
    // Draft identity resets inside useRadiologyDraftId on studyId change —
    // do not call captureSavedDraftId(null) here (that pattern caused React #185).
  }, [studyId, onStudySwitchPageReset]);

// Browser tab close / hard navigation while dirty.
useEffect(() => {
  if (!isDirty) return;
  const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", warn);
  return () => window.removeEventListener("beforeunload", warn);
}, [isDirty]);

// Reset hydrate marker when studyId changes (must run before the hydrate effect).
useEffect(() => {
  hydratedDraftForStudyRef.current = null;
  setDraftHydratedStudyId(null);
}, [studyId]);

// ─── Hydrate editor when study changes ──────────────────────────────────────
useEffect(() => {
  if (!studyId) return;
  if (isLoadingExistingDraft) return;
  if (hydratedDraftForStudyRef.current === studyId) return;

  if (existingDraft) {
    const rowPatientId = workflow.currentRow?.patientId ?? null;
    // Wait for worklist patient before deciding — do not mark hydrated yet.
    if (existingDraft.patientId != null && rowPatientId == null) return;
    if (!canHydrateDraftForPatient(existingDraft.patientId, rowPatientId)) {
      console.warn("[radiology-workspace] refusing to hydrate draft for a different patient");
      hydratedDraftForStudyRef.current = studyId;
      setDraftHydratedStudyId(studyId);
      useWorkspace.setState({
        findingsText: "",
        impressionText: "",
        recommendationText: "",
        techniqueText: "",
        clinicalHistoryText: "",
        fieldProvenance: {},
        isDirty: false,
      });
      return;
    }
    hydratedDraftForStudyRef.current = studyId;
    setDraftHydratedStudyId(studyId);
    restoredDraftForStudyRef.current = studyId;
    const draft = existingDraft as RadiologyDraftRow & {
      findings?: string | null;
      technique?: string | null;
    };
    // Normalize: API may return impression/recommendation as string[] or string
    const normStr = (v: unknown) => Array.isArray(v) ? v.join("\n") : (typeof v === "string" ? v : "");
    useWorkspace.getState().setEditorContent({
      findings: normStr(draft.findings ?? draft.rawFindings),
      impression: normalizeImpressionLines(draft.impression).join("\n"),
      recommendation: normStr(draft.recommendation),
      technique: normStr(draft.technique),
      clinicalHistory: normStr(draft.clinicalHistory) || (workflow.currentRow as any)?.clinicalHistory || "",
    });
    const restored = extractCareStructuredFormatState(draft.structuredJson);
    if (restored?.values) {
      structuredTouchedRef.current = true;
      setStructuredValues(restored.values);
    }
    const ledger = extractCareObservationLedger(draft.structuredJson);
    const hydrated = useWorkspace.getState().hydrateObservationLedger(ledger);
    const restoredMs = extractCareViewerMeasurements(draft.structuredJson);
    if (restoredMs) {
      useWorkspace.getState().setStructuredViewerMeasurements(restoredMs);
    }
    const restoredCanal = extractCareCanalApProvenance(draft.structuredJson);
    if (restoredCanal) {
      useWorkspace.getState().setCanalApProvenance(restoredCanal as CanalApProvenanceMap);
    }
    // Spine V3: numbering / sequences / screening selections are restored so
    // the canvas rebuilds the same structured state (prose stays ledger-owned).
    const restoredSpine = extractSpineReportingState(draft.structuredJson);
    if (restoredSpine) {
      useWorkspace.setState({
        lumbarNumbering: restoredSpine.lumbarNumbering,
        sequencesAvailable: restoredSpine.sequencesAvailable,
        screening: restoredSpine.screening,
        impressionOrderFrozen: restoredSpine.impressionOrderFrozen,
      });
    }
    // The radiologist's stated acquisition answers gate every strong vascular
    // sentence, so they must survive save → close → reopen unchanged.
    const restoredVascular = extractCareVascularTechnique(draft.structuredJson);
    if (restoredVascular) {
      useWorkspace.getState().setVascularTechnique(restoredVascular);
    }
    const ids = selectedQuickFindingIds(useWorkspace.getState().appliedPathologyPatches.map((p) => p.id));
    setSelectedQuickIds(new Set(ids));
    // Restore the persisted baseline format identity (banner / canvas state).
    // Content-level restore above is authoritative; this only recovers the
    // "applied format" label so save → close → reopen keeps its baseline.
    const linkedRestored = extractLinkedStudyFromStructuredJson(draft.structuredJson);
    if (linkedRestored && studyId) {
      const row = workflow.currentRow;
      useWorkspace.getState().setLinkedStudies(
        findingsSectionFromStudy({
          studyId,
          modality: row?.modality,
          studyDescription: row?.studyDescription,
          region: (row as { bodyPart?: string | null } | null)?.bodyPart ?? null,
          accessionNumber: row?.accessionNumber,
          studyInstanceUID: row?.studyInstanceUID,
        }),
        linkedRestored,
        { markDirty: false },
      );
    }
    useWorkspace.setState({
      appliedPatternMarkers: extractAppliedPatternsFromStructuredJson(draft.structuredJson),
    });
    const formatIdentity = extractCareReportFormatIdentity(draft.structuredJson);
    if (formatIdentity?.name) {
      const format = useWorkspace.getState().reportFormats.find((f) => f.name === formatIdentity.name);
      const canvas = reconstructStartingCanvasBaseline({
        formatName: formatIdentity.name,
        formatRevision: formatIdentity.formatRevision,
        baselineManifestRevision: formatIdentity.baselineManifestRevision,
        appliedAt: formatIdentity.appliedAt,
        format,
        reportFormatRevision,
      });
      useWorkspace.setState({
        appliedFormatName: formatIdentity.name,
        appliedFormatReportTitle: formatIdentity.reportTitle ?? null,
        startingCanvasBaseline: canvas,
      });
    } else if (useWorkspace.getState().appliedFormatName) {
      useWorkspace.setState({
        appliedFormatName: null,
        appliedFormatReportTitle: null,
        startingCanvasBaseline: null,
      });
    }
    if (hydrated.warning) {
      toast({
        title: "Opened as narrative-only",
        description: hydrated.warning,
      });
    }
    return;
  }

  // No server draft — mark hydrated so protocol/template auto-select can run.
  // Do NOT auto-apply AI draft text into the editor (AI must never silent-fill).
  // Radiologist can still open AI draft via explicit composer / AI panel actions.
  hydratedDraftForStudyRef.current = studyId;
  setDraftHydratedStudyId(studyId);
  const row = workflow.currentRow;
  if (row) {
    const state = useWorkspace.getState();
    if (!state.clinicalHistoryText.trim()) {
      state.setField("clinicalHistory", (row as { clinicalHistory?: string }).clinicalHistory ?? "");
    }
  }
}, [studyId, existingDraft, isLoadingExistingDraft, workflow.currentRow?.patientId, workflow.currentRow]);

// ─── Draft rescue registration (pre-redirect flush on 401) ─────────────────
// Writes the study's rolling backup key — the one WorkspaceOverlays' restore
// banner already reads back through shouldOfferBackupRestore. This used to write
// draftRescue's `rcc_rescue_draft`, which only the deprecated
// RadiologyCommandCenter reads, and which that page matches on an
// `accessionNumber` this payload never carried. So on the canonical workspace
// the flush landed in a store nothing would ever look in, and the last few
// seconds of dictation were lost anyway — the exact loss the flush exists to
// prevent.
useEffect(() => {
  registerDraftRescueSaver(() => {
    const envelope = rescueBackupEnvelope(readWorkspaceClinicalTexts(), {
      signed: isFinalized || !backupEnabled,
    });
    if (envelope) writeDraftBackupSnapshot(radiologyReportBackupKey(studyId), envelope);
  });
  return () => deregisterDraftRescueSaver();
}, [studyId, isFinalized, backupEnabled]);

const saveDraft = useCallback(async (opts?: { silent?: boolean }): Promise<number | null> => {
  if (!studyId) return null;
  const capturedStudyId = studyId;
  const capturedGeneration = saveGenerationRef.current;
  const capturedPatientId = workflow.currentRow?.patientId ?? null;
  const offlineMsg = offlineBlockMessage(isOnline, "save");
  if (offlineMsg) {
    setAutoSaveStatus("error");
    toast({ title: "Offline", description: offlineMsg, variant: "destructive" });
    return null;
  }
  setAutoSaveStatus("saving");
  try {
    // Always persist the live store — never the debounced shell mirror.
    const live = readWorkspaceClinicalTexts();
    const res = await retryWithBackoff(
      () => saveRadiologyDraft<{ success?: boolean; draft?: { id: number }; id?: number }>({
        id: draftId ?? undefined,
        studyId: capturedStudyId,
        worklistId: capturedStudyId,
        patientId: capturedPatientId,
        clinicalHistory: live.clinicalHistoryText,
        technique: live.techniqueText,
        rawFindings: live.findingsText,
        impression: [live.impressionText],
        recommendation: live.recommendationText,
        findingsSections: useStructured ? findingsMap : undefined,
        structuredFormatState: structuredTouchedRef.current && studySetup.selectedTemplate && formatHasStructuredFields(studySetup.selectedTemplate.sectionsJson)
          ? toDraftFormatState({
            formatId: studySetup.selectedTemplate.id,
            formatVersion: studySetup.selectedTemplate.formatVersion ?? 1,
            values: structuredValues,
          })
          : undefined,
        observationLedger: useWorkspace.getState().serializeObservationLedger(),
        viewerMeasurements: (() => {
          const s = useWorkspace.getState().structuredViewerMeasurements;
          // Harden: bound payload size for draft structured_json.
          if (!s?.items || s.items.length <= 400) return s;
          return { ...s, items: s.items.slice(-400) };
        })(),
        canalApProvenance: useWorkspace.getState().canalApProvenance,
        // Spine V3 structured capture state (numbering / sequences / screening)
        // — survives save → close → reopen like the AP provenance does.
        [SPINE_REPORTING_DRAFT_KEY]: spineReportingDraftPayload({
          lumbarNumbering: useWorkspace.getState().lumbarNumbering,
          sequencesAvailable: useWorkspace.getState().sequencesAvailable,
          screening: useWorkspace.getState().screening,
          impressionOrderFrozen: useWorkspace.getState().impressionOrderFrozen,
        }),
        // Undefined while untouched, so existing reports gain no envelope key.
        vascularTechnique: vascularTechniquePayload(useWorkspace.getState().vascularTechnique),
        // Baseline format identity — survives save → close → reopen so the
        // applied-format banner stays and the bootstrap never re-fires.
        linkedStudy: linkedStudyPayload(useWorkspace.getState().linkedStudy),
        appliedPatterns: draftHydratedStudyId === capturedStudyId
          ? useWorkspace.getState().appliedPatternMarkers
          : undefined,
        reportFormatIdentity: (() => {
          const ws = useWorkspace.getState();
          if (!ws.appliedFormatName) return undefined;
          const format = ws.reportFormats.find((f) => f.name === ws.appliedFormatName);
          return buildCareReportFormatIdentity({
            name: ws.appliedFormatName,
            reportTitle: ws.appliedFormatReportTitle,
            formatId: format?.id,
            formatRevision:
              ws.startingCanvasBaseline?.formatRevision
              ?? (format ? reportFormatRevision(format) : undefined),
            baselineManifestVersion: format?.baselineManifest?.version,
            baselineManifestRevision:
              format?.baselineManifest?.revision
              ?? ws.startingCanvasBaseline?.formatRevision
              ?? undefined,
          });
        })(),
      } as any),
      { shouldRetry: isTransientError },
    );
    if (!shouldCommitAutosave(capturedStudyId, studyIdRef.current, capturedGeneration, saveGenerationRef.current)) {
      return null;
    }
    const id = res?.draft?.id ?? res?.id ?? null;
    if (id) {
      captureSavedDraftId(id);
      useWorkspace.setState({ isDirty: false });
    }
    setLastSavedAt(new Date());
    setAutoSaveStatus("saved");
    if (!opts?.silent) toast({ title: "Draft saved", duration: 1500 });
    return id;
  } catch (err) {
    setAutoSaveStatus("error");
    toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    return null;
  }
}, [studyId, draftId, isOnline, captureSavedDraftId, toast, useStructured, findingsMap, structuredValues, studySetup.selectedTemplate, workflow.currentRow?.patientId, draftHydratedStudyId]);
saveDraftRef.current = saveDraft;
  saveDraftRef.current = saveDraft;

// First-save mutex — stable across re-renders; recreate when saveDraft identity changes.
const ensureDraftOnce = useMemo(
  () =>
    createEnsureDraftOnce({
      getDraftId: () => draftIdRef.current,
      createDraft: () => saveDraft({ silent: true }),
    }),
  [saveDraft],
);

const promptDirtyLeave = useCallback((_reason: string): Promise<LeaveChoice> => {
  leavePromptReasonRef.current = _reason || "This report has unsaved changes.";
  return new Promise((resolve) => {
    leaveResolverRef.current = resolve;
    setLeaveDialogOpen(true);
  });
}, []);

const resolveLeaveChoice = useCallback((choice: LeaveChoice) => {
  setLeaveDialogOpen(false);
  const resolver = leaveResolverRef.current;
  leaveResolverRef.current = null;
  resolver?.(choice);
}, []);

const discardLocalEditor = useCallback(() => {
  if (existingDraft) {
    const draft = existingDraft as RadiologyDraftRow & {
      findings?: string | null;
      technique?: string | null;
    };
    const normStr = (v: unknown) =>
      Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : "";
    useWorkspace.getState().setEditorContent({
      findings: normStr(draft.findings ?? draft.rawFindings),
      impression: normalizeImpressionLines(draft.impression).join("\n"),
      recommendation: normStr(draft.recommendation),
      technique: normStr(draft.technique),
      clinicalHistory:
        normStr(draft.clinicalHistory) ||
        (workflow.currentRow as { clinicalHistory?: string } | null)?.clinicalHistory ||
        "",
    });
  } else {
    useWorkspace.getState().setEditorContent({
      findings: "",
      impression: "",
      recommendation: "",
      technique: "",
      clinicalHistory: "",
    });
  }
  useWorkspace.setState({ isDirty: false });
}, [existingDraft, workflow.currentRow]);

const saveAndConfirmLeave = useCallback(async () => {
  await ensureDraftOnce();
  const id = await saveDraft({ silent: true });
  if (id == null) {
    toast({
      title: "Save failed",
      description: "Could not save before leaving. Stay on this study.",
      variant: "destructive",
    });
    return false;
  }
  return true;
}, [ensureDraftOnce, saveDraft, toast]);

const requestLeaveThen = useCallback(
  async (navigateFn: () => void) => {
    const result = await leaveDirtyStudy({
      guards: {
        dirty: useWorkspace.getState().isDirty,
        saving: autoSaveStatus === "saving",
        finalizing: useWorkspace.getState().isFinalizing,
        viewerLaunching: false,
        transitioning: workflow.transitioning,
      },
      promptDirty: promptDirtyLeave,
      saveAndConfirm: saveAndConfirmLeave,
      discardLocal: discardLocalEditor,
      onBlocked: (reason) => toast({ title: reason }),
    });
    if (result.action === "navigate") navigateFn();
  },
  [
    autoSaveStatus,
    workflow.transitioning,
    promptDirtyLeave,
    saveAndConfirmLeave,
    discardLocalEditor,
    toast,
  ],
);

goNextStudyRef.current = () => {
  void requestLeaveThen(() => {
    const next = workflow.peekNext();
    if (!next) {
      toast({ title: "End of queue" });
      return;
    }
    workflow.beginTransition(studyId, next);
    openStudy(next.id);
  });
};

goPrevStudyRef.current = () => {
  void requestLeaveThen(() => {
    const prevId = workflow.beginPreviousTransition(studyId);
    if (prevId == null) {
      toast({ title: "No previous study in history" });
      return;
    }
    openStudy(prevId);
  });
};

openStudyGuardedRef.current = (id: string | number) => {
  if (String(id) === String(studyId ?? "")) {
    openStudy(id);
    return;
  }
  void requestLeaveThen(() => openStudy(id));
};

// ─── Debounced server auto-save (30 s after last keystroke) ─────────────────
const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => {
  if (!isDirty || !isOnline || isFinalized || isMobile) {
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    return;
  }
  const live = readWorkspaceClinicalTexts();
  const meaningful = isMeaningfulReportEdit({
    findings: live.findingsText,
    impression: live.impressionText,
    recommendation: live.recommendationText,
    technique: live.techniqueText,
  });
  // First save: only create a server draft on meaningful report-body edits
  // (not clinicalHistory-only, not open/look).
  if (!draftId && !meaningful) {
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    return;
  }
  if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
  autoSaveTimerRef.current = setTimeout(() => {
    const genAtSchedule = saveGenerationRef.current;
    setAutoSaveStatus("saving");
    const run = async () => {
      if (!draftIdRef.current) {
        return ensureDraftOnce();
      }
      return saveDraft({ silent: true });
    };
    run().then((id) => {
      if (genAtSchedule !== saveGenerationRef.current) return;
      setAutoSaveStatus(id != null ? "saved" : "error");
    }).catch(() => {
      if (genAtSchedule !== saveGenerationRef.current) return;
      setAutoSaveStatus("error");
    });
  }, 30_000);
  return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
}, [isDirty, isOnline, draftId, isFinalized, isMobile, findingsText, impressionText, techniqueText, recommendationText, clinicalHistoryText, saveDraft, ensureDraftOnce]);

  return {
    saveDraft,
    ensureDraftOnce,
    autoSaveStatus,
    lastSavedAt,
    setLastSavedAt,
    draftHydratedStudyId,
    restoredDraftForStudyRef,
    leaveDialogOpen,
    promptDirtyLeave,
    resolveLeaveChoice,
    goNextStudy,
    goPrevStudy,
    openStudyGuarded,
    saveDraftRef,
    draftIdRef,
    goNextStudyRef,
    goPrevStudyRef,
    openStudyGuardedRef,
    hydratedDraftForStudyRef,
    saveGenerationRef,
    studyIdRef,
    leavePromptReasonRef,
    leaveResolverRef,
    setLeaveDialogOpen,
  };
}
