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
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { buildChangePreview } from "@/lib/voiceReportComposer/applyChangePlan";
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

export function useSmartDictation(opts: {
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
      const plan = buildConsolidatedPlan(session);
      const status = useWorkspace.getState().applyVoiceComposerPlan(
        plan,
        session.transcriptLog.join(" | "),
        { force: force || preview?.hasConflicts === true },
      );
      if (status === "applied") {
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
