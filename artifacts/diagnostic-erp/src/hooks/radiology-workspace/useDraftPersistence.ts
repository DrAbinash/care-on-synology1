/**
 * Draft persistence, hydrate, leave guards, and 30s autosave for
 * RadiologyReportingWorkspace. Phase 3 extraction — behavior unchanged.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type Dispatch, type MutableRefObject, type SetStateAction,
} from "react";
import type { RadiologyDraftRow } from "@/hooks/useRadiologyDraftId";
import {
  draftIdentityForSave,
  type AcknowledgedDraftRowArgs,
  type ProvenDraftIdentity,
} from "@/lib/radiologyDraftId";
import { createDraftSaveQueue, type DraftSaveQueue } from "@/lib/draftSaveQueue";
import { saveRadiologyDraft } from "@/lib/radiologyReportLifecycle";
import { HttpError } from "@/lib/fetchApi";
import type { ComposerPersistenceTag } from "@/lib/reportComposer/types";
import {
  canHydrateDraftForPatient,
  shouldCommitAutosave,
} from "@/lib/radiologyWorkspaceSafety";
import { registerDraftRescueSaver, deregisterDraftRescueSaver } from "@/lib/draftRescue";
import { writeDraftBackupSnapshot } from "@/hooks/useLocalDraftBackup";
import { createEnsureDraftOnce, isMeaningfulReportEdit } from "@/lib/ensureDraftOnce";
import {
  DRAFT_REVISION_CONFLICT,
  draftSaveOutcome,
  draftSaveRefusalCode,
  evaluateDraftSaveAck,
  type DraftSaveResponse,
} from "@/lib/draftSaveOutcome";
import { leaveDirtyStudy, type LeaveChoice } from "@/lib/leaveDirtyStudy";
import { canLeaveStudy } from "@/lib/reportingWorkflow";
import type { AutoSaveStatus } from "@/lib/humanSaveStatus";
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
  extractCareRegionTransitions,
  regionTransitionPayload,
} from "@/lib/regionTransition";
import { resolveDraftTechnique } from "@/lib/draftTechniqueRoundTrip";
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
import {
  extractDemographyOverridesFromStructuredJson,
  type ReportDemography,
} from "@/lib/reportDemography";
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
import { studyTransitionReset } from "@/lib/zai-workspace/clinicalStateReset";
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
   * The signed half of the caller's `contentLocked`: true when the study is
   * signed and the trial-phase in-place unlock is off. Passed composed rather
   * than recomputed here so the two cannot drift. `isFinalized` on its own is
   * narrower — only `completeFinalize` writes it — and a save it lets through is
   * a save `assertDraftWritable` answers 409 REPORT_LOCKED for.
   */
  signedContentLocked: boolean;
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
  /**
   * The by-id worklist detail read's patientId — the identity authority that
   * survives the reading-queue filter. `workflow.currentRow` is a row of the
   * FILTERED queue and is null for any study it excludes (a CT under the MR
   * preset, a deep link, a filter change mid-report). The hydrate gate waits
   * for the patient before restoring a patient-carrying draft; without this
   * fallback the wait never ends, the saved draft never hydrates, and the
   * next save overwrites it with the still-empty editor — silent draft loss
   * for exactly the studies opened from the Study Queue Report button
   * (Radiology Highway Audit, Patient B finding). Queue row still wins when
   * present, so in-queue hydration is byte-identical to before.
   */
  detailPatientId: number | null | undefined;
  existingDraft: RadiologyDraftRow | null | undefined;
  isLoadingExistingDraft: boolean;
  /** A failed/paused initial read is unknown, not a confirmed absent draft. */
  draftReadSucceeded: boolean;
  /**
   * Records the draft row a save acknowledged, for the study that save was sent
   * for. `useRadiologyDraftId` keeps this per study, so an acknowledgement that
   * arrives after the radiologist has moved on still becomes the row that study
   * reopens from.
   */
  captureSavedDraft: (ack: Omit<AcknowledgedDraftRowArgs, "previous">) => RadiologyDraftRow;
  /**
   * P0-2 — re-read the study's row. A revision refusal proves the token this
   * editor holds is stale, so the only way out of a permanent refusal is a fresh
   * one; the read replaces the cache, never the editor.
   */
  refetchExistingDraft: () => Promise<unknown>;
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
  /**
   * PR #1171 — the radiologist's demography corrections, radiologist-local
   * component state that the persistence hook round-trips: sent on every
   * save (an empty object clears a stale stored correction — a reverted
   * correction must not survive), and restored when a draft reopens. They
   * never touch the patient master and never weaken identity validation.
   */
  demographyOverrides: Partial<ReportDemography>;
  setDemographyOverrides: Dispatch<SetStateAction<Partial<ReportDemography>>>;
};

export function useDraftPersistence(opts: UseDraftPersistenceOptions) {
  const {
    studyId, draftId, isOnline, isDirty, isFinalized, signedContentLocked, isMobile,
    backupEnabled,
    useStructured, findingsMap, structuredValues, studySetup, workflow,
    detailPatientId,
    existingDraft, isLoadingExistingDraft, draftReadSucceeded, captureSavedDraft,
    refetchExistingDraft, toast,
    openStudy, onStudySwitchPageReset, setStructuredValues, setSelectedQuickIds,
    structuredTouchedRef,
    findingsText, impressionText, techniqueText, recommendationText, clinicalHistoryText,
    draftHydratedStudyId, setDraftHydratedStudyId,
    demographyOverrides, setDemographyOverrides,
  } = opts;

  const hydratedDraftForStudyRef = useRef<number | null>(null);
  /** A rejected patient binding stays unwritable for this study open. */
  const rejectedDraftForStudyRef = useRef<number | null>(null);
  /** Study whose server draft was restored into the editor this open. */
  const restoredDraftForStudyRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const studyIdRef = useRef<number | undefined>(undefined);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const leaveResolverRef = useRef<((choice: LeaveChoice) => void) | null>(null);
  const leavePromptReasonRef = useRef("This report has unsaved changes.");
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveDraftRef = useRef<(opts?: { silent?: boolean }) => Promise<number | null>>(async () => null);
const signedContentLockedRef = useRef(false);
  const draftIdRef = useRef<number | null>(null);
  draftIdRef.current = draftId ?? null;

  /**
   * The draft row this console has proven, per study, read at SEND time rather
   * than from the render a save callback closed over — see
   * `draftIdentityForSave`. Kept in a ref because the two facts that update it
   * (an acknowledged save and a settled read) both arrive BETWEEN renders — and
   * in the browser two queued saves are 1 ms apart, so the render that would
   * carry the first one's acknowledgement has not happened when the second one
   * sends. Returned with the other refs so that between-render state is
   * observable rather than only inferable.
   */
  const provenDraftRef = useRef(new Map<number, ProvenDraftIdentity>());
  /** One save in flight per study; see lib/draftSaveQueue.ts for the transcript. */
  const saveQueueRef = useRef<DraftSaveQueue | null>(null);
  if (saveQueueRef.current == null) saveQueueRef.current = createDraftSaveQueue();
  /** Why the last save returned null, so a refusal is not reported as a failure. */
  const lastSaveRefusalRef = useRef<"conflict" | "signed" | null>(null);
  /**
   * The study this console was refused on, and must therefore stop writing to on
   * its own. A 409 means another session or tab holds a report this one has never
   * seen; the autosave, the pre-leave flush and any background retry all ask to
   * save without being told to, and letting one through would silently choose
   * which report survives. Only an explicit Save decides that, so this holds the
   * autosave off until then. One study at a time, because one console edits one
   * study at a time.
   */
  const conflictLatchedStudyRef = useRef<number | null>(null);

  useEffect(() => {
    if (studyId == null) return;
    const row = existingDraft ?? null;
    // Mirror the settled read exactly. The gap between a save being
    // acknowledged and this effect re-running is covered by the direct write in
    // the save path below, and `useRadiologyDraftId`'s write watermark stops a
    // read issued BEFORE that ack from ever regressing the row here.
    provenDraftRef.current.set(studyId, {
      id: row?.id ?? null,
      revision: row?.revision ?? null,
    });
  }, [studyId, existingDraft]);

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

  // Reset patient-specific editor state when switching studies.
  // This transition is FULL for clinical content AND for active-study identity
  // (see the A-02 note below); it is PARTIAL only in that it preserves
  // `reportingContext`, which the hydrate effect repopulates for the incoming study.
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
    //
    // A-02 — the active-study IDENTITY now moves in this same setState.
    // `studyId` is the route param, i.e. the radiology_worklist row, and it is the
    // only authoritative reporting-study identity in the workspace. Before this,
    // `activeStudyId` was written by a separate mirror effect in
    // `useWorkspaceClinicalUi` that bailed out when the study had not yet landed in
    // the scoped `studies` array, so a worklist navigate / deep link / Back could
    // leave the store convinced it was still on Patient A while the screen showed
    // Patient B — and about twenty consumers, the Copilot study stamp among them,
    // read that lagging value as if it were the truth. Resetting content and moving
    // identity are one lifecycle transition, so they are now one atomic write and
    // cannot be observed in between.
    //
    // `activeStudyInstanceUID` is set to null rather than carried over: the DICOM UID
    // of the incoming study is genuinely not known at this instant, and null means
    // "unknown" (anchor rejection fails safe, Ctrl+I refuses to apply). The effect in
    // `useWorkspaceClinicalUi` that binds it only writes a UID it has verified belongs
    // to this exact route study.
    useWorkspace.setState(studyTransitionReset(studyId));
    // The reset wiped the ACTIVE critical-SLA clock along with the rest of the
    // clinical state; the incoming study's session ledger entry — if it has
    // one — is the honest replacement (selectStudy does the same for queue-row
    // switches; this path is the worklist navigate / deep link / Back variant,
    // which never calls selectStudy). A study with no entry stays null: the
    // clock starts when a critical finding is actually detected on it.
    useWorkspace.getState().restoreCriticalSlaFor(studyId);
    // Draft identity resets inside useRadiologyDraftId on studyId change —
    // do not call captureSavedDraft(null) here (that pattern caused React #185).
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
  rejectedDraftForStudyRef.current = null;
  setDraftHydratedStudyId(null);
}, [studyId]);

// ─── Hydrate editor when study changes ──────────────────────────────────────
useEffect(() => {
  if (!studyId) return;
  if (isLoadingExistingDraft || !draftReadSucceeded) return;
  if (hydratedDraftForStudyRef.current === studyId) return;
  if (rejectedDraftForStudyRef.current === studyId) return;

  if (existingDraft) {
    const rowPatientId = workflow.currentRow?.patientId ?? detailPatientId ?? null;
    // Wait for worklist patient before deciding — do not mark hydrated yet.
    if (existingDraft.patientId != null && rowPatientId == null) return;
    if (!canHydrateDraftForPatient(existingDraft.patientId, rowPatientId)) {
      console.warn("[radiology-workspace] refusing to hydrate draft for a different patient");
      rejectedDraftForStudyRef.current = studyId;
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
      // B-01 — `draft.technique` is read by nothing here any more, and it never
      // could be: `radiology_report_drafts` has no technique column, so GET /drafts
      // (a full-row select) has no such key to return. The value is persisted by
      // save-draft inside the `findings_sections` JSON column as the `Technique`
      // section — which is also what the server's own print path renders. Reading
      // the missing key restored "" on every reopen, and because this save body is
      // built from the live store, the next autosave rewrote findings_sections
      // WITHOUT the section: the stored Technique was destroyed, not just hidden.
      // Technique also feeds `sequencesAvailable` (acquisition gating), so the loss
      // silently changed what the rest of the report was allowed to assert.
      technique: resolveDraftTechnique(draft),
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
      useWorkspace.getState().hydrateCanalApRecords(
        restoredCanal as Record<string, unknown> | null,
      );
    }
    // Spine V3: numbering / sequences / screening selections are restored so
    // the canvas rebuilds the same structured state (prose stays ledger-owned).
    const restoredSpine = extractSpineReportingState(draft.structuredJson);
    if (restoredSpine) {
      useWorkspace.setState({
        lumbarNumbering: restoredSpine.lumbarNumbering,
        dorsalNumbering: restoredSpine.dorsalNumbering,
        dorsoLumbarNumbering: restoredSpine.dorsoLumbarNumbering,
        sequencesAvailable: restoredSpine.sequencesAvailable,
        screening: restoredSpine.screening,
        // Restored with the roles themselves: the §23 billing proposal is derived
        // again on open, and must not undo a role the radiologist chose.
        screeningRolesOverridden: restoredSpine.screeningRolesOverridden,
        impressionOrderFrozen: restoredSpine.impressionOrderFrozen,
      });
    }
    // The radiologist's stated acquisition answers gate every strong vascular
    // sentence, so they must survive save → close → reopen unchanged.
    const restoredVascular = extractCareVascularTechnique(draft.structuredJson);
    if (restoredVascular) {
      useWorkspace.getState().setVascularTechnique(restoredVascular);
    }
    // ADR-004 — the sentences this report stopped claiming, and who decided it, have to
    // survive save → close → reopen. Without the history a reopened report looks like a
    // draft that lost normals on its own, and the region on screen no longer explains the
    // text under it.
    useWorkspace.getState().hydrateRegionTransitions(
      extractCareRegionTransitions(draft.structuredJson),
    );
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
    // PR #1171 — restore the radiologist's demography corrections, so a
    // reopened draft shows the corrected card instead of a blank one and
    // the next save keeps carrying them. The route-keyed study-switch reset
    // has already cleared this state for the PREVIOUS study before this
    // per-study hydration runs; restoring an empty object is a no-op.
    setDemographyOverrides(
      extractDemographyOverridesFromStructuredJson(draft.structuredJson),
    );
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
        // `warning` is also set when the ledger came back and only some rows were re-staled, and
        // that is the common case: measured on the LS Spine rig after a plain Ctrl+S and a reload,
        // the clicked-off box was still on the rail marked selected while the toast said the report
        // had opened as narrative text. Say which of the two happened, because the radiologist
        // decides whether to re-click the box on the strength of this sentence.
        title: hydrated.mode === "narrative-only"
          ? "Opened as narrative-only"
          : "Opened with your Quick Select boxes",
        description: hydrated.warning,
      });
    }
    // Server hydration is not an edit, even though individual content writers dirty the store.
    useWorkspace.setState({ isDirty: false });
    restoredDraftForStudyRef.current = studyId;
    hydratedDraftForStudyRef.current = studyId;
    setDraftHydratedStudyId(studyId);
    return;
  }

  // Successful read with no server draft — protocol/template auto-select may run.
  // Do NOT auto-apply AI draft text into the editor (AI must never silent-fill).
  // Radiologist can still open AI draft via explicit composer / AI panel actions.
  const row = workflow.currentRow;
  if (row) {
    const state = useWorkspace.getState();
    if (!state.clinicalHistoryText.trim()) {
      state.setField("clinicalHistory", (row as { clinicalHistory?: string }).clinicalHistory ?? "");
    }
  }
  hydratedDraftForStudyRef.current = studyId;
  setDraftHydratedStudyId(studyId);
}, [studyId, existingDraft, isLoadingExistingDraft, draftReadSucceeded, workflow.currentRow?.patientId, detailPatientId, workflow.currentRow]);

// ─── Draft rescue registration (pre-redirect flush on 401) ─────────────────
// Writes the study's rolling backup key — the one WorkspaceOverlays' restore
// banner already reads back through shouldOfferBackupRestore. This used to write
// draftRescue's `rcc_rescue_draft`, which only the deprecated
// RadiologyCommandCenter reads, and which that page matches on an
// `accessionNumber` this payload never carried. So on the canonical workspace
// the flush landed in a store nothing would ever look in, and the last few
// seconds of dictation were lost anyway — the exact loss the flush exists to
// prevent.
//
// Structured cards ride along via a ref mirror (not effect deps): the saver
// must capture the cards as they are at FLUSH time, without re-registering on
// every card keystroke. Prose comes from the live store at flush time; the
// cards live in hook options, so they need the ref.
const rescueStructuredRef = useRef({ findingsMap, useStructured });
rescueStructuredRef.current = { findingsMap, useStructured };
useEffect(() => {
  registerDraftRescueSaver(() => {
    const texts = readWorkspaceClinicalTexts();
    const { findingsMap: sections, useStructured: structured } = rescueStructuredRef.current;
    const envelope = rescueBackupEnvelope({
      ...texts,
      findingsSections: structured ? sections : null,
      useStructured: structured,
    }, {
      signed: isFinalized || !backupEnabled,
    });
    if (envelope) writeDraftBackupSnapshot(radiologyReportBackupKey(studyId), envelope);
  });
  return () => deregisterDraftRescueSaver();
}, [studyId, isFinalized, backupEnabled]);

// Hydration is a per-open success latch: a later refetch error must not revoke
// permission to save an editor whose initial server draft was genuinely restored.
const draftReady = !!studyId
  && draftHydratedStudyId === studyId
  && hydratedDraftForStudyRef.current === studyId;

/**
 * The body of one save, unordered. Every caller reaches it through
 * `saveDraftOrdered` below; this keeps its own name because
 * `draftSaveSignedRefusal.hardening.test.ts` pins the signed-study refusal as
 * sitting inside `saveDraft`, before anything can be sent.
 */
const saveDraft = useCallback(async (opts?: {
  silent?: boolean;
  /**
   * PROMPT 4 — set only by the AI composer's Apply step. It asks the server to
   * compare this study's saved report against the baseline it recorded when the
   * draft was generated, and to remember the content it writes. Without that
   * comparison, "AI draft applied" is a claim about the browser's memory; with it,
   * the claim is about a row. Ordinary saves never send it and behave exactly as
   * before.
   */
  composer?: ComposerPersistenceTag;
}): Promise<number | null> => {
  if (!studyId) return null;
  lastSaveRefusalRef.current = null;
  // A study this console was refused on stays un-written until the radiologist
  // acts. Everything that saves without being told to — the 30 s autosave, the
  // flush before leaving a study, a background retry, the structured-values
  // debounce — arrives here with `silent`, and each of them would resolve the
  // conflict by choosing which report survives. Nothing is thrown away: this
  // console's text stays in the editor, the other session's stays on the server,
  // and the Save button is the deliberate tie-breaker.
  if (opts?.silent && conflictLatchedStudyRef.current === studyId) {
    lastSaveRefusalRef.current = "conflict";
    return null;
  }
  // Check both committed hydration and live identity BEFORE reading the store.
  // A callback retained by a dialog/debounce from the previous study must not
  // post this study's live clinical content under that former study's identity.
  if (!draftReady
    || hydratedDraftForStudyRef.current !== studyId
    || studyIdRef.current !== studyId
    || useWorkspace.getState().activeStudyId !== String(studyId)) return null;
  // The auto-save effect below refuses a signed study, but it is not the only
  // caller of this function: the top bar's Save button, the command palette's
  // `save`, four Quick Select pick handlers, the structured-values debounce and
  // the Word export all call it directly. On a signed study every one of those
  // is a request the server is certain to refuse — `assertDraftWritable` throws
  // 409 REPORT_LOCKED when the worklist row is REPORT_FINAL or DELIVERED, or
  // when the draft is already finalized, and `radiologyHardening.request.test.ts`
  // case 14 pins exactly that. The catch at the end of this callback then toasts
  // "Save failed" whether or not `silent` was passed, because `silent` only ever
  // suppressed the success toast — and with TOAST_LIMIT at 1 that red toast
  // evicts whatever the refused action had just said about itself.
  //
  // Checked before the offline branch on purpose: a signed report cannot be
  // saved from here online or offline, and "Offline" would promise that
  // reconnecting helps.
  if (signedContentLocked) {
    if (!opts?.silent) {
      toast({
        title: "Save refused — the report is signed",
        description:
          "Nothing was saved. To correct it, withdraw the signature from Report Hub — only the signer or an administrator can.",
        variant: "destructive",
        duration: 8000,
      });
    }
    lastSaveRefusalRef.current = "signed";
    return null;
  }
  const capturedStudyId = studyId;
  const capturedGeneration = saveGenerationRef.current;
  const capturedPatientId = workflow.currentRow?.patientId ?? detailPatientId ?? null;
  const offlineMsg = offlineBlockMessage(isOnline, "save");
  if (offlineMsg) {
    setAutoSaveStatus("error");
    toast({ title: "Offline", description: offlineMsg, variant: "destructive" });
    return null;
  }
  setAutoSaveStatus("saving");
  try {
    // P0-2 — name the revision this editor was working from, so the route can
    // refuse rather than quietly replace a report another window moved.
    //
    // Read at SEND time from what this console has proven, not from the render
    // this callback closed over. Saves for one study are queued behind each
    // other (lib/draftSaveQueue.ts), so by the time this one runs the save ahead
    // of it may have created the row or moved its revision — and a callback that
    // still claims `"absent"` for a row that exists forks a second row for the
    // study, or is refused for racing itself.
    //
    // A row whose token is unknown still saves UNGUARDED: the fallback must
    // never be a guessed token, because that would refuse an honest radiologist.
    const identity = draftIdentityForSave({
      proven: provenDraftRef.current.get(capturedStudyId) ?? null,
      existingDraft,
      draftReadSucceeded,
    });
    const expectedRevision = identity.expectedRevision;
    // Snapshot the structured sections this request carries, so the retry below
    // and the acknowledgement record describe the SAME body. `retryWithBackoff`
    // re-runs the builder after a transient failure, and by then the radiologist
    // may have typed more; the acknowledgement must still name the bytes that
    // were actually sent.
    const sentSections = useStructured ? findingsMap : undefined;
    // Always persist the live store — never the debounced shell mirror.
    // (The adjacency of this read and the request below is pinned by
    // workspaceClinicalTexts.test.ts: persistence must send what it just read.)
    const live = readWorkspaceClinicalTexts();
    const res = await retryWithBackoff(
      () => saveRadiologyDraft<DraftSaveResponse>({
        id: identity.id ?? draftId ?? undefined,
        studyId: capturedStudyId,
        worklistId: capturedStudyId,
        patientId: capturedPatientId,
        expectedRevision,
        clinicalHistory: live.clinicalHistoryText,
        technique: live.techniqueText,
        rawFindings: live.findingsText,
        impression: [live.impressionText],
        recommendation: live.recommendationText,
        // Undefined unless this save is the composer's Apply persistence step, so
        // every other writer sends the identical body it always did.
        ...(opts?.composer ? { composer: opts.composer } : {}),
        findingsSections: sentSections,
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
          dorsalNumbering: useWorkspace.getState().dorsalNumbering,
          dorsoLumbarNumbering: useWorkspace.getState().dorsoLumbarNumbering,
          sequencesAvailable: useWorkspace.getState().sequencesAvailable,
          screening: useWorkspace.getState().screening,
          screeningRolesOverridden: useWorkspace.getState().screeningRolesOverridden,
          impressionOrderFrozen: useWorkspace.getState().impressionOrderFrozen,
        }),
        // Undefined while untouched, so existing reports gain no envelope key.
        vascularTechnique: vascularTechniquePayload(useWorkspace.getState().vascularTechnique),
        // ADR-004 — undefined while the report has never been re-regioned, so every other
        // save sends exactly the body it always sent.
        regionTransitions: regionTransitionPayload(useWorkspace.getState().regionTransitions),
        // Baseline format identity — survives save → close → reopen so the
        // applied-format banner stays and the bootstrap never re-fires.
        linkedStudy: linkedStudyPayload(useWorkspace.getState().linkedStudy),
        // PR #1171 — the radiologist's demography corrections ride every save
        // (an empty object is a real CLEAR of a stale stored correction, the
        // same write signal the server's patch builder reads).
        demographyOverrides,
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
    const outcome = draftSaveOutcome(res);
    const id = outcome.id;
    // P0-1 — the acknowledgement is recorded BEFORE deciding whether this save
    // still belongs on screen. A save for Patient A that comes back after the
    // radiologist has opened Patient B is still a fact about Patient A's row, and
    // it is that fact which makes Patient A correct when it is reopened. Silently
    // dropping it (which is what this return used to do) left A's cached row at
    // the pre-save narrative, and the next save of A persisted that stale text
    // over the newer one — the audit's disappearing sentence.
    //
    // Recorded even on a partial save: the draft row exists, the narrative
    // committed, and saving again without the id would insert a second row.
    if (id) {
      const acknowledged = captureSavedDraft({
        studyId: capturedStudyId,
        draftId: id,
        patientId: capturedPatientId,
        sent: live,
        sentSections,
        responseDraft: res?.draft ?? null,
        // The token for the row as it stands AFTER the server's own envelope
        // patch — the one thing this client cannot derive for itself.
        revision: res?.revision ?? null,
      });
      // Recorded for the study this save was sent for, not the one on screen:
      // the next save of THAT study has to name this row and this token even
      // before the cache write has re-rendered anything.
      provenDraftRef.current.set(capturedStudyId, {
        id,
        revision: acknowledged.revision ?? null,
      });
      // A save that reached the server has resolved the conflict — that was the
      // one act the latch exists to wait for. No silent save can get here while
      // the latch is up, so there is nothing else to distinguish.
      if (conflictLatchedStudyRef.current === capturedStudyId) {
        conflictLatchedStudyRef.current = null;
      }
    }
    if (!shouldCommitAutosave(capturedStudyId, studyIdRef.current, capturedGeneration, saveGenerationRef.current)) {
      return null;
    }
    // D-05 / F3 — the response acknowledges the bytes this request carried, not
    // whatever the store holds now. The generation guard above only refuses
    // after a STUDY SWITCH (the only thing that bumps it); typing more while the
    // request was in flight sailed through, cleared `isDirty` over text that
    // was never persisted, and the 30-second autosave — armed on `isDirty` —
    // never re-armed. The ack is therefore evaluated against the live store at
    // acknowledgement time, byte for byte. A stale ack still remembers the row
    // id and the rescue point (lastSavedAt), but the dirty flag stays up, no
    // "Draft saved" toast is fired, and the Unsaved badge tells the truth
    // until a later save of the NEWEST text lands.
    const ack = evaluateDraftSaveAck(outcome, live, readWorkspaceClinicalTexts());
    if (id && ack.clearDirty) useWorkspace.setState({ isDirty: false });
    setLastSavedAt(new Date());
    setAutoSaveStatus(outcome.status);
    if (outcome.notice === "partial") {
      toast({
        title: "Report text saved, structured details did not",
        description:
          "Your findings, impression and technique are saved. Measurements, the observation ledger and the applied format may be missing if you reopen this study now. They are saved again when you next edit or leave this report.",
        variant: "destructive",
      });
    } else if (!opts?.silent && ack.ackCoversNewestText) {
      // No success toast over a stale ack: the chip must not claim "saved"
      // while the newest sentences are still only in the editor. The Unsaved
      // badge carries that message instead.
      toast({ title: "Draft saved", duration: 1500 });
    }
    return id;
  } catch (err) {
    // P0-2 — the server found a report this save would have replaced, so it wrote
    // nothing. That is a refusal, not a failure (#862): the text stays in the
    // editor, the autosave must stay armed, and "Save failed" would report a loss
    // that did not happen while evicting the sentence that explained it.
    //
    // The refused revision is now known stale, so the row is re-read. Without that
    // the next save names the same stale token and is refused again — a refusal
    // with no way out, which is the trap this repo has already been burned by
    // once. The re-read replaces the cache only: hydration is a per-open latch, so
    // the other window's row never overwrites what the radiologist is typing.
    if (draftSaveRefusalCode(err as { status?: number; details?: unknown }) === DRAFT_REVISION_CONFLICT) {
      lastSaveRefusalRef.current = "conflict";
      setAutoSaveStatus("conflict");
      // Stop this console writing on its own. The autosave, the pre-leave flush
      // and any background retry would otherwise pick up the token this re-read
      // is about to hand back and write over the other session's report 30
      // seconds later, with nothing clicked — measured in the browser
      // (tmp/evidence/who-retries.json): the refusal held, and the next save went
      // through 305 ms later anyway. Reviewing and saving again is the
      // radiologist's decision, not a background job's.
      conflictLatchedStudyRef.current = capturedStudyId;
      void refetchExistingDraft();
      toast({
        title: "Report changed in another session",
        description:
          "This report was changed in another session. Your current text is preserved. Review before saving again.",
        variant: "destructive",
        duration: 9000,
      });
      return null;
    }
    // A composer-tagged save can be refused because the study's saved report
    // moved after the AI draft was generated. That is a refusal, not a failure
    // (#862): the radiologist's text stays in the editor, the ordinary autosave
    // still persists it, and it is the Apply that stops. Toasting "Save failed"
    // here would report a loss that did not happen — and with TOAST_LIMIT at 1 it
    // would evict the Apply-refused explanation the composer is about to show.
    if (opts?.composer && err instanceof HttpError && err.status === 409) {
      setAutoSaveStatus("refused");
      return null;
    }
    setAutoSaveStatus("error");
    toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    return null;
  }
}, [studyId, draftId, isOnline, signedContentLocked, captureSavedDraft, refetchExistingDraft, toast, useStructured, findingsMap, structuredValues, studySetup.selectedTemplate, workflow.currentRow?.patientId, detailPatientId, draftHydratedStudyId, draftReady, existingDraft?.id, existingDraft?.revision, draftReadSucceeded]);

/**
 * One save in flight per study, in the order the editor asked for them.
 *
 * The measured failure (`tmp/evidence/diag2-cold-hydrate.json`): leaving a study
 * that had never been saved fired three `save-draft` calls within 40 ms. The
 * third still claimed `id:null` and `expectedRevision:"absent"` one millisecond
 * after the first had created the row, so the P0-2 guard refused it with 409 —
 * and because that save was the pre-leave flush, the radiologist could not leave
 * the study at all. A guard that protects the report must not trap its reader.
 *
 * Ordering alone is not the protection: two consoles still race, and the
 * server's revision check is what refuses the loser. This only stops ONE console
 * racing itself.
 *
 * This is the function the hook hands out and the one `saveDraftRef` holds, so
 * no caller can reach the unordered body by accident.
 */
const saveDraftOrdered = useCallback(
  (opts?: Parameters<typeof saveDraft>[0]): Promise<number | null> =>
    saveQueueRef.current!.run(studyId ?? null, () => saveDraft(opts)),
  [saveDraft, studyId],
);
saveDraftRef.current = saveDraftOrdered;
  saveDraftRef.current = saveDraftOrdered;

// First-save mutex — stable across re-renders; recreate when the save identity changes.
const ensureDraftOnce = useMemo(
  () =>
    createEnsureDraftOnce({
      getDraftId: () => draftIdRef.current,
      createDraft: () => saveDraftOrdered({ silent: true }),
    }),
  [saveDraftOrdered],
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
      // B-01 — same reader as the hydrate path. "Discard my local edits" returns
      // the editor to the SERVER draft; reading the key that does not exist made
      // discarding silently blank the Technique the stored draft still has.
      technique: resolveDraftTechnique(draft),
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
  // "Save & leave" on a signed report has nothing to save. Without this, both
  // calls below reach saveDraft's refusal, which returns null and — because it
  // was passed `silent` — says nothing, so the `id == null` branch reported a
  // policy as a failure and held the radiologist on the study with "Could not
  // save before leaving", which reads as an invitation to try again.
  if (signedContentLocked) {
    setAutoSaveStatus("refused");
    toast({
      title: "Nothing to save — the report is signed",
      description:
        "Local edits cannot be added to a signed report. Choose Discard to leave, or withdraw the signature from Report Hub — only the signer or an administrator can.",
      variant: "destructive",
      duration: 8000,
    });
    return false;
  }
  await ensureDraftOnce();
  const id = await saveDraftOrdered({ silent: true });
  if (id == null) {
    // A revision conflict already spoke for itself: "This report was changed in
    // another session. Your current text is preserved. Review before saving
    // again." Reporting that as "Save failed" would claim a loss that did not
    // happen (#862) and, with TOAST_LIMIT at 1, evict the sentence that named the
    // other session. Staying put is what that sentence already implies — and
    // since the conflict latches the study, this flush now returns null without
    // even reaching the server, so the other session's report cannot be walked
    // over by a save nobody asked for.
    if (lastSaveRefusalRef.current !== "conflict") {
      toast({
        title: "Save failed",
        description: "Could not save before leaving. Stay on this study.",
        variant: "destructive",
      });
    }
    return false;
  }
  return true;
}, [ensureDraftOnce, saveDraftOrdered, toast, signedContentLocked]);

const requestLeaveThen = useCallback(
  async (navigateFn: () => void) => {
    // FEW-CLICKS (pass 2): silent flush instead of the three-button dialog.
    // The dialog taxed a click on EVERY study switch with unsaved edits —
    // which is the normal case while drafting, because the autosave debounces
    // 30 s. Saving a draft never loses anything (drafts are revisable; the
    // 30 s autosave would persist the same text anyway), so the safe default
    // is save-and-leave, silently: zero clicks, edits preserved, a toast only
    // when the save FAILS (stay + reason, same as before). The explicit
    // Save/Discard/Stay dialog stays reachable for the one case where saving
    // is impossible — local edits on a SIGNED study — because there its
    // Discard is the only real exit.
    const verdict = canLeaveStudy({
      dirty: useWorkspace.getState().isDirty,
      saving: autoSaveStatus === "saving",
      finalizing: useWorkspace.getState().isFinalizing,
      viewerLaunching: false,
      transitioning: workflow.transitioning,
    });
    if (verdict.kind === "blocked") {
      toast({ title: verdict.reason });
      return;
    }
    if (verdict.kind === "ok") {
      navigateFn();
      return;
    }
    if (signedContentLocked) {
      // Edits on a signed report can never be saved; the dialog's Discard is
      // the only honest exit, so the choice stays explicit here.
      const result = await leaveDirtyStudy({
        guards: {
          dirty: true,
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
      return;
    }
    // Dirty draft: flush silently, then leave. A failed flush toasts and
    // stays (inside saveAndConfirmLeave) — never navigates away from unsaved
    // text.
    const ok = await saveAndConfirmLeave();
    if (!ok) return;
    navigateFn();
  },
  [
    autoSaveStatus,
    workflow.transitioning,
    promptDirtyLeave,
    saveAndConfirmLeave,
    discardLocalEditor,
    toast,
    signedContentLocked,
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
  if (!isDirty || !isOnline || signedContentLocked || isMobile) {
    if (autoSaveTimerRef.current) { clearTimeout(autoSaveTimerRef.current); autoSaveTimerRef.current = null; }
    // Guarding on `isFinalized` alone let a report signed in ANOTHER session arm
    // this timer, fire it, and land in saveDraft's refusal — which was passed
    // `silent`, so it returned null without saying why, and the `.then` below
    // mapped that null onto setAutoSaveStatus("error"): a red, sticky "Save
    // failed" for a save that was never attempted and never could be.
    if (isDirty && signedContentLocked) setAutoSaveStatus("refused");
    return;
  }
  if (!draftReady) return;
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
    // Held off, not lost. Returning here rather than calling through keeps the
    // chip on the conflict the radiologist was already told about — setting a
    // second status writer would let some other path invent a conflict that did
    // not happen, which is the thing that pin forbids.
    if (conflictLatchedStudyRef.current === studyId) return;
    const genAtSchedule = saveGenerationRef.current;
    setAutoSaveStatus("saving");
    const run = async () => {
      if (!draftIdRef.current) {
        return ensureDraftOnce();
      }
      return saveDraftOrdered({ silent: true });
    };
    run().then((id) => {
      if (genAtSchedule !== saveGenerationRef.current) return;
      // A refusal is not a failure. When the 409 arrives while this timer's own
      // save is in flight, `saveDraft` has already named the honest status —
      // "conflict", or "refused" for a signed row — and returned null. Mapping
      // that null onto "error" replaced the one sentence the radiologist can act
      // on with a red "Save failed", and did it from a second writer, which is
      // what the single-writer pin exists to prevent. So: say nothing, and let
      // the refusal keep the chip it already set.
      if (id == null && lastSaveRefusalRef.current != null) return;
      setAutoSaveStatus(id != null ? "saved" : "error");
    }).catch(() => {
      if (genAtSchedule !== saveGenerationRef.current) return;
      setAutoSaveStatus("error");
    });
  }, 30_000);
  return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
}, [isDirty, isOnline, draftId, signedContentLocked, isMobile, findingsText, impressionText, techniqueText, recommendationText, clinicalHistoryText, saveDraftOrdered, ensureDraftOnce, draftReady]);

// ─── FEW-CLICKS (pass 2): silent flush on route-away ────────────────────────
// Leaving the workspace route entirely (sidebar → worklist, patients, anywhere)
// never ran the leave gate: the 30 s autosave timer was simply cleared on
// unmount and the last stretch of typing fell to the 2 s localStorage backup,
// which only pays off if the radiologist comes back the same way. Flush the
// same silent save the timer would have run — best-effort by design: a failed
// flush logs (the backup still holds the text), and a dirty SIGNED study never
// flushes because its local edits cannot be saved anywhere (the backup and the
// leave dialog's explicit Discard own that case). Unmount-only: switching
// studies inside the workspace keeps its guarded doors (requestLeaveThen
// above), which already flush before switching.
signedContentLockedRef.current = signedContentLocked;
useEffect(() => () => {
  if (!useWorkspace.getState().isDirty) return;
  if (signedContentLockedRef.current) return;
  void saveDraftRef.current({ silent: true }).catch((err) => {
    console.warn("[draft-flush-on-leave] silent save failed (localStorage backup retained):", err);
  });
}, []);

  return {
    saveDraft: saveDraftOrdered,
    ensureDraftOnce,
    autoSaveStatus,
    // A getter, not a snapshot: the latch lives in a ref precisely because a
    // refusal must not re-render the editor, so the signing path has to read it
    // at the moment it decides rather than trust whatever the last render saw.
    conflictLatchedStudyId: () => conflictLatchedStudyRef.current,
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
    provenDraftRef,
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
