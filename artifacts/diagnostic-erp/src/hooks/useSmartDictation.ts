/**
 * useSmartDictation — hybrid multi-turn dictation session for the six
 * MRI examinations (Task 15, Part E).
 *
 * ONE batch channel throughout: every Compose press runs against the store
 * ledger (already-applied observations) PLUS the session's accumulated set,
 * folds into ONE consolidated preview, and the Apply button writes
 * everything in a single store apply — one undo, one provenance stamp, one
 * normal-retirement pass. A removal that targets an already-applied finding
 * rides along as a pending ledger removal in the same Apply, so "remove
 * ligamentum flavum hypertrophy" after an Apply is simply the first turn of
 * a new batch.
 *
 * Hybrid v1 (owner-approved 2026-10-23): dictated words — typed lines and
 * completed voice captures — STAGE on the panel with no inference; ONE
 * Compose press sends the whole staged batch through the composer, and a
 * further dictate + Compose cycle updates the draft with the new findings
 * in the same conversation (prior observations ride along on every call).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { buildChangePreview } from "@/lib/voiceReportComposer/applyChangePlan";
import {
  dictationBindingHolds,
  dictationIdentityOf,
  dictationStudyKeyOf,
  type DictationStudyIdentity,
} from "@/lib/radiologyWorkspaceSafety";
import type {
  ComposeApiResponse,
} from "@/lib/voiceReportComposer/types";
import {
  appendStagedSegment,
  buildConsolidatedPlan,
  dictationFailureMessage,
  foldComposeTurn,
  lastErrorTurn,
  newSmartDictationSession,
  sessionHasPending,
  sessionObservations,
  stagedWordCount,
  DICTATION_PRESERVED_MSG,
  type ComposeOutcome,
  type SmartDictationSession,
} from "@/lib/voiceReportComposer/smartDictationSession";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type SmartDictationPreview = {
  adds: string[];
  removes: string[];
  untouched: string[];
  conflicts: string[];
  hasConflicts: boolean;
  impression?: string;
};

/**
 * A session whose study identity is gone. Loud, because the radiologist's words
 * were discarded with it, and free of identifiers: nothing here may quote the
 * patient or the study it came from into the study it is being read in.
 */
export const DICTATION_STUDY_SWITCH_MSG =
  "This dictation was spoken against a different study. Nothing was carried over and nothing was applied — dictate again against the study on screen.";

/**
 * The Apply-time refusal. It does not void the session: a press that lands while
 * the store is mid-transition is recoverable by the radiologist, and destroying
 * composed work on a witness that might settle would be worse than saying no.
 */
export const DICTATION_APPLY_REFUSAL_MSG =
  "This dictation belongs to a different study than the one on screen, so nothing was applied. Discard it, then dictate again against this study.";

export function useSmartDictation(opts: {
  /**
   * The authoritative ROUTE study id, from `App.tsx`'s
   * `/radiology/report/:studyId`. Staged dictation, the composed plan and Apply
   * are all bound to it.
   *
   * This is deliberately the route value and not `useWorkspace.activeStudyId`.
   * Store note A-02 records why: a suggestion stamped from `activeStudyId` and
   * then compared against `activeStudyId` was a self-referential check that
   * passed while the field lagged the route, so prose generated for one study
   * could insert into another. Binding is captured at stage time and checked
   * against the live route value and the store at Apply time.
   */
  studyId?: number | string | null;
  modality?: string;
  region?: string;
  reportTitle?: string;
  protectedQuickFindingLabels?: string[];
  enabled?: boolean;
}) {
  const [session, setSession] = useState<SmartDictationSession>(() =>
    newSmartDictationSession(),
  );
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phraseFallbackAvailable, setPhraseFallbackAvailable] = useState(false);
  const [staged, setStaged] = useState("");
  // "Undo apply" explanation — set only when a click raced a newer clinical
  // write and the frame it named was no longer the top of the undo stack.
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  // Re-entry guard read inside callbacks: state `composing` is fine for
  // rendering but goes stale inside memoised callbacks mid-flight.
  const composingRef = useRef(false);

  // ── Study binding (audit C1) ──────────────────────────────────────────────
  // The panel is mounted once per workspace while the route study changes
  // underneath it, so an unbound session survives navigation: words dictated
  // against patient A's narrative could be Composed and Applied into patient B's
  // report — and the compose request already reads A's findings, so B would
  // receive prose describing a different patient.
  const studyKey = dictationStudyKeyOf(opts.studyId);
  const studyKeyRef = useRef(studyKey);
  studyKeyRef.current = studyKey;
  /** The identity this session's words were dictated against; null while empty. */
  const boundRef = useRef<DictationStudyIdentity | null>(null);
  /** Bumped on navigation so a response arriving after a switch is discarded. */
  const generationRef = useRef(0);
  const previousStudyKeyRef = useRef(studyKey);

  /**
   * What is on screen RIGHT NOW, read at the moment of the check: the route id
   * plus the store's live DICOM mirror and active study. Read from refs and
   * `getState()` so a memoised callback can never answer with a stale render.
   */
  const liveIdentity = useCallback(
    (): { identity: DictationStudyIdentity; activeStudyId: string | null } => {
      const state = useWorkspace.getState();
      return {
        identity: dictationIdentityOf({
          studyId: studyKeyRef.current,
          studyInstanceUID: state.activeStudyInstanceUID,
        }),
        activeStudyId: state.activeStudyId,
      };
    },
    [],
  );

  /** Is the session's captured identity still the study on screen? */
  const bindingHolds = useCallback(
    (bound: DictationStudyIdentity | null) => {
      if (!bound) return true;
      const live = liveIdentity();
      return dictationBindingHolds(bound, live.identity, live.activeStudyId);
    },
    [liveIdentity],
  );

  /**
   * The identity is gone: void the session, unbind, and say so. Nothing is
   * folded into the thread — an accepted turn for patient A would be one Apply
   * away from patient B's Findings.
   */
  const voidOnIdentityBreak = useCallback(() => {
    boundRef.current = null;
    generationRef.current += 1;
    setSession(newSmartDictationSession());
    setStaged("");
    setApplyNotice(null);
    setError(DICTATION_STUDY_SWITCH_MSG);
  }, []);

  useEffect(() => {
    if (previousStudyKeyRef.current === studyKey) return;
    previousStudyKeyRef.current = studyKey;
    voidOnIdentityBreak();
  }, [studyKey, voidOnIdentityBreak]);

  const compose = useCallback(
    async (transcript: string, priorObservations: unknown, usePhraseFallback: boolean) => {
      const text = transcript.trim();
      if (!text) return null;
      const state = useWorkspace.getState();
      return api.post<ComposeApiResponse>(
        "/api/radiology/voice-report-composer/compose",
        {
          transcript: text,
          modality: opts.modality,
          region: opts.region,
          reportTitle: opts.reportTitle,
          findingsText: state.findingsText,
          impressionText: state.impressionText,
          techniqueText: state.techniqueText,
          priorTranscript: sessionRef.current.transcriptLog.slice(-1)[0],
          priorObservations,
          usePhraseFallback,
          fieldProvenance: state.fieldProvenance,
          protectedQuickFindingLabels: opts.protectedQuickFindingLabels,
        },
      );
    },
    [opts.modality, opts.region, opts.reportTitle, opts.protectedQuickFindingLabels],
  );

  const dictateInternal = useCallback(
    async (transcript: string, usePhraseFallback: boolean) => {
      const text = transcript.trim();
      if (!text) return;
      // C1 — refuse BEFORE the request goes out. A switch that did not move the
      // route (the row re-linked to another study, or the store's narrative no
      // longer belongs to this study) means the words on the panel were spoken
      // against a different patient's findings, and this call reads exactly
      // those findings into the request body.
      if (!bindingHolds(boundRef.current)) {
        voidOnIdentityBreak();
        return;
      }
      if (!boundRef.current) boundRef.current = liveIdentity().identity;
      const generation = generationRef.current;
      const atRequest = boundRef.current;
      composingRef.current = true;
      setComposing(true);
      setError(null);
      setPhraseFallbackAvailable(false);

      const state = useWorkspace.getState();
      // Corrections resolve against BOTH what is already on the page (the
      // store ledger) and what this session has accumulated — one conversation.
      const prior = [
        ...state.voiceComposerObservations,
        ...sessionObservations(sessionRef.current),
      ];

      try {
        const res = await compose(text, prior, usePhraseFallback);
        if (!res) return;
        // C1 — the response belongs to the study the request was built from, not
        // to whatever is on screen now. A route switch already voided the session
        // and said so, so a bumped generation is dropped quietly; an identity
        // that moved under the same row voids here, because folding the plan
        // would put patient A's findings one Apply from patient B's report.
        if (generationRef.current !== generation) return;
        if (!bindingHolds(atRequest)) {
          voidOnIdentityBreak();
          return;
        }

        // Narrow onto a local const — TypeScript does not preserve property
        // narrowing (res.plan) inside the setSession closure below.
        const plan = res.plan ?? null;
        // Every failure shape — provider down, refused plan, missing plan —
        // folds into a VISIBLE error turn, so the radiologist's words are
        // never silently discarded (they used to live only in a hidden ref).
        const outcome: ComposeOutcome =
          res.ok && plan
            ? {
                ok: true,
                plan,
                phraseFallback: res.diagnostics?.phraseFallback ?? usePhraseFallback,
                // Advisory contradiction warnings (owner pick #2) ride the
                // response next to the plan; the fold lands them on the
                // accepted turn for review. Absent = clean.
                warnings: res.warnings,
              }
            : {
                ok: false,
                // Reason-code UX: the server's generic text says WHAT failed;
                // diagnostics.failureReason says WHY — mapped here to the
                // action the radiologist should take, preservation promise kept.
                error: dictationFailureMessage(res.error, res.diagnostics?.failureReason),
                phraseFallbackAvailable: res.phraseFallbackAvailable ?? false,
              };
        const folded = foldComposeTurn(sessionRef.current, text, outcome);
        setSession(folded.session);
        setError(folded.error);
        setPhraseFallbackAvailable(folded.phraseFallbackAvailable);
      } catch {
        // Network down / request timed out — the words stay in the thread too.
        const folded = foldComposeTurn(sessionRef.current, text, {
          ok: false,
          error: DICTATION_PRESERVED_MSG,
        });
        setSession(folded.session);
        setError(folded.error);
        setPhraseFallbackAvailable(false);
      } finally {
        composingRef.current = false;
        setComposing(false);
      }
    },
    [compose],
  );

  /** Hybrid v1 — STAGE a dictated segment (typed line or completed voice
   *  capture). The words appear immediately and NOTHING is sent to the
   *  model: staging is pure text accumulation, so a long continuous
   *  dictation costs zero inference until the radiologist presses Compose. */
  const stageDictation = useCallback((segment: string) => {
    // C1 — the first words of a batch fix the study they belong to, and a batch
    // whose identity has gone cannot receive more words: they would be sent
    // against the current study's findings under another study's binding.
    if (!bindingHolds(boundRef.current)) {
      voidOnIdentityBreak();
      return;
    }
    if (!boundRef.current) boundRef.current = liveIdentity().identity;
    setStaged((cur) => appendStagedSegment(cur, segment));
  }, []);

  /** ONE model call for everything staged so far. Same lane as every other
   *  turn — same fold, same failure preservation, same Retry — so the batch
   *  either becomes a visible conversation turn or an error turn that keeps
   *  the words. Staging clears on dispatch: the thread now owns the words. */
  const composeStaged = useCallback(() => {
    const text = stagedRef.current.trim();
    if (!text || composingRef.current) return;
    setStaged("");
    void dictateInternal(text, false);
  }, [dictateInternal]);

  /** Drop the staged words without composing (mis-dictation, wrong patient). */
  const discardStaged = useCallback(() => setStaged(""), []);

  /** Dictate one natural utterance (multiple findings welcome). */
  const dictate = useCallback(
    (transcript: string) => dictateInternal(transcript, false),
    [dictateInternal],
  );

  /** Retry the last failed turn through the same composer path — the words
   *  are read from the visible session turn, so no re-dictation is needed. */
  const retryLastTurn = useCallback(() => {
    const failed = lastErrorTurn(sessionRef.current);
    if (!failed) return;
    void dictateInternal(failed.transcript, false);
  }, [dictateInternal]);

  /** Retry the last failed turn through the deterministic phrase catalog. */
  const retryWithPhraseFallback = useCallback(() => {
    const failed = lastErrorTurn(sessionRef.current);
    if (!failed) return;
    void dictateInternal(failed.transcript, true);
  }, [dictateInternal]);

  /** True while the trailing turn is a failed one — retry is meaningful. */
  const canRetryLast = lastErrorTurn(session) !== null;

  /** ONE consolidated preview over the accumulated session. */
  const preview: SmartDictationPreview | null = useMemo(() => {
    if (!sessionHasPending(session)) return null;
    const state = useWorkspace.getState();
    const pv = buildChangePreview({
      narrative: {
        clinicalHistory: state.clinicalHistoryText,
        technique: state.techniqueText,
        findings: state.findingsText,
        impression: state.impressionText,
        recommendation: state.recommendationText,
      },
      provenance: state.fieldProvenance,
      plan: buildConsolidatedPlan(session),
      activeObservations: state.voiceComposerObservations,
    });
    return {
      adds: pv.adds,
      removes: pv.removes,
      untouched: pv.untouched,
      conflicts: pv.conflicts,
      hasConflicts: pv.hasConflicts,
      impression: pv.impression,
    };
    // The narrative is read from the store at preview time (the report may
    // have been edited between turns); the session drives re-derivation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /** Apply everything in ONE write — pending ledger removals + accumulated adds. */
  const applyAll = useCallback(
    (force = false) => {
      if (!sessionHasPending(session)) return false;
      // C1 — the write itself is the dangerous moment: `applyVoiceComposerPlan`
      // lands in the study the STORE holds, so a session composed against
      // another study would put patient A's sentences into patient B's Findings,
      // where autosave then persists them inside the current generation. Refuse
      // before the plan is built, and leave the session intact for Discard.
      if (!bindingHolds(boundRef.current)) {
        setError(DICTATION_APPLY_REFUSAL_MSG);
        return false;
      }
      const plan = buildConsolidatedPlan(session);
      const status = useWorkspace.getState().applyVoiceComposerPlan(
        plan,
        session.transcriptLog.join(" | "),
        { force: force || preview?.hasConflicts === true },
      );
      if (status === "applied") {
        boundRef.current = null;
        setSession(newSmartDictationSession());
        setError(null);
        setApplyNotice(null);
        return true;
      }
      setError("Could not apply — resolve the Quick Select / manual conflicts first");
      return false;
    },
    [session, preview?.hasConflicts],
  );

  // "Undo apply" is available only while the last Apply's frame is still the
  // TOP undo frame — any newer clinical write hides the affordance. Honesty
  // beats convenience: the button must never revert a newer edit by the name
  // of an older apply. Reactive, so the strip disappears the moment the frame
  // is buried or stepped back through Ctrl/⌘+Z.
  const lastApplyUndoable = useWorkspace(
    (s) =>
      s.lastVoiceApplyId !== null
      && s.patchUndoStack.length > 0
      && s.patchUndoStack[s.patchUndoStack.length - 1]?.voiceApplyId === s.lastVoiceApplyId,
  );

  /** Undo the last Apply — one press restores the pre-Apply report exactly. */
  const undoLastApply = useCallback(() => {
    const outcome = useWorkspace.getState().undoLastVoiceApply();
    setApplyNotice(
      outcome === "gone"
        ? "That Apply is no longer the newest clinical change — Ctrl/⌘+Z steps back through the newer edits."
        : null,
    );
    return outcome;
  }, []);

  const discardSession = useCallback(() => {
    boundRef.current = null;
    generationRef.current += 1;
    setSession(newSmartDictationSession());
    setError(null);
    setApplyNotice(null);
  }, []);

  return {
    session,
    preview,
    composing,
    error,
    phraseFallbackAvailable,
    canRetryLast,
    hasPending: sessionHasPending(session),
    pendingCount: session.observations.size + session.pendingRemovals.size,
    staged,
    stagedWords: stagedWordCount(staged),
    stageDictation,
    composeStaged,
    discardStaged,
    dictate,
    retryLastTurn,
    retryWithPhraseFallback,
    applyAll,
    discardSession,
    lastApplyUndoable,
    undoLastApply,
    applyNotice,
  };
}
