/**
 * useSmartDictation — ChatGPT-style multi-turn dictation session for the six
 * MRI examinations (Task 15, Part E).
 *
 * Two channels, one conversation:
 *
 *   PRE-APPLY (session pending): dictated turns compose against the session's
 *   accumulated observations and fold into ONE consolidated preview. Apply
 *   writes everything in a single store apply — one undo, one provenance
 *   stamp, one normal-retirement pass.
 *
 *   POST-APPLY (empty session, populated ledger): the radiologist keeps
 *   correcting conversationally — "remove ligamentum flavum hypertrophy",
 *   "make L4-L5 narrowing moderate on the left". Turns compose against the
 *   store ledger and preview immediately, exactly like the classic one-turn
 *   voice composer, so a correction never re-opens the whole batch.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { buildChangePreview } from "@/lib/voiceReportComposer/applyChangePlan";
import type {
  ComposeApiResponse,
  VoiceChangePlan,
} from "@/lib/voiceReportComposer/types";
import {
  applyTurnToSession,
  buildConsolidatedPlan,
  newSmartDictationSession,
  sessionHasPending,
  sessionObservations,
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
  /** The single-turn plan for post-apply corrections. */
  plan?: VoiceChangePlan;
  transcript?: string;
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
  /** Post-apply correction turn: one plan against the ledger, applied alone. */
  const [immediatePreview, setImmediatePreview] = useState<SmartDictationPreview | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  /** Last attempted transcript — the phrase-catalog retry source. */
  const lastTranscriptRef = useRef("");

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
      lastTranscriptRef.current = text;
      setComposing(true);
      setError(null);

      const state = useWorkspace.getState();
      const sessionPending = sessionHasPending(sessionRef.current);

      try {
        // Pre-apply: corrections resolve inside the session. Post-apply: they
        // resolve against the store ledger (already-applied observations).
        const prior = sessionPending
          ? sessionObservations(sessionRef.current)
          : state.voiceComposerObservations;

        const res = await compose(text, prior, usePhraseFallback);
        if (!res) return;

        if (!res.ok || !res.plan) {
          const msg = res.error ?? "Local composer unavailable — dictation preserved";
          if (sessionPending) {
            setSession((s) =>
              applyTurnToSession(s, text, null, { error: msg }),
            );
          }
          setError(msg);
          return;
        }

        if (sessionPending) {
          const plan = res.plan;
          setSession((s) =>
            applyTurnToSession(s, text, plan, {
              phraseFallback: res.diagnostics?.phraseFallback ?? usePhraseFallback,
            }),
          );
          return;
        }

        // Post-apply correction: one-turn preview against the live report.
        const pv = buildChangePreview({
          narrative: {
            clinicalHistory: state.clinicalHistoryText,
            technique: state.techniqueText,
            findings: state.findingsText,
            impression: state.impressionText,
            recommendation: state.recommendationText,
          },
          provenance: state.fieldProvenance,
          plan: res.plan,
          activeObservations: state.voiceComposerObservations,
        });
        setImmediatePreview({
          adds: pv.adds,
          removes: pv.removes,
          untouched: pv.untouched,
          conflicts: pv.conflicts,
          hasConflicts: pv.hasConflicts,
          impression: pv.impression,
          plan: res.plan,
          transcript: text,
        });
      } catch {
        const msg = "Local composer unavailable — dictation preserved";
        if (sessionPending) {
          setSession((s) => applyTurnToSession(s, text, null, { error: msg }));
        }
        setError(msg);
      } finally {
        setComposing(false);
      }
    },
    [compose],
  );

  /** Dictate one natural utterance (multiple findings welcome). */
  const dictate = useCallback(
    (transcript: string) => dictateInternal(transcript, false),
    [dictateInternal],
  );

  /** Retry the last failed turn through the deterministic phrase catalog. */
  const retryWithPhraseFallback = useCallback(() => {
    const last =
      lastTranscriptRef.current
      || sessionRef.current.turns.slice(-1)[0]?.transcript
      || "";
    if (!last) return;
    void dictateInternal(last, true);
  }, [dictateInternal]);

  /** ONE consolidated preview over the accumulated session. */
  const preview: SmartDictationPreview | null = useMemo(() => {
    if (sessionHasPending(session)) {
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
        activeObservations: sessionObservations(session),
      });
      return {
        adds: pv.adds,
        removes: pv.removes,
        untouched: pv.untouched,
        conflicts: pv.conflicts,
        hasConflicts: pv.hasConflicts,
        impression: pv.impression,
      };
    }
    return null;
    // The narrative is read from the store at preview time (the report may
    // have been edited between turns); the session drives re-derivation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /**
   * Apply everything in ONE write (pre-apply batch), or the single post-apply
   * correction sitting in immediatePreview.
   */
  const applyAll = useCallback(
    (force = false) => {
      if (immediatePreview?.plan) {
        const status = useWorkspace.getState().applyVoiceComposerPlan(
          immediatePreview.plan,
          immediatePreview.transcript ?? "",
          { force: force || immediatePreview.hasConflicts },
        );
        if (status === "applied") {
          setImmediatePreview(null);
          setError(null);
          return true;
        }
        setError("Could not apply the correction — resolve conflicts first");
        return false;
      }
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
        return true;
      }
      setError("Could not apply — resolve the Quick Select / manual conflicts first");
      return false;
    },
    [session, preview?.hasConflicts, immediatePreview],
  );

  const discard = useCallback(() => {
    if (immediatePreview) {
      setImmediatePreview(null);
      return;
    }
    setSession(newSmartDictationSession());
    setError(null);
  }, [immediatePreview]);

  const discardSession = useCallback(() => {
    setSession(newSmartDictationSession());
    setImmediatePreview(null);
    setError(null);
  }, []);

  return {
    session,
    preview,
    /** Post-apply single-turn correction preview (already on report → apply alone). */
    immediatePreview,
    composing,
    error,
    hasPending: sessionHasPending(session) || !!immediatePreview,
    pendingCount:
      session.observations.size + (immediatePreview ? 1 : 0),
    dictate,
    retryWithPhraseFallback,
    applyAll,
    discard,
    discardSession,
  };
}
