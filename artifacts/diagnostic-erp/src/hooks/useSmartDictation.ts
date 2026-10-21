/**
 * useSmartDictation — ChatGPT-style multi-turn dictation session for the six
 * MRI examinations (Task 15, Part E).
 *
 * ONE batch channel throughout: every turn composes against the store ledger
 * (already-applied observations) PLUS the session's accumulated set, folds
 * into ONE consolidated preview, and the Apply button writes everything in a
 * single store apply — one undo, one provenance stamp, one normal-retirement
 * pass. A removal that targets an already-applied finding rides along as a
 * pending ledger removal in the same Apply, so "remove ligamentum flavum
 * hypertrophy" after an Apply is simply the first turn of a new batch.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { buildChangePreview } from "@/lib/voiceReportComposer/applyChangePlan";
import type {
  ComposeApiResponse,
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
        if (!res.ok || !plan) {
          const msg = res.error ?? "Local composer unavailable — dictation preserved";
          setError(msg);
          setPhraseFallbackAvailable(res.phraseFallbackAvailable ?? false);
          return;
        }

        setSession((s) =>
          applyTurnToSession(s, text, plan, {
            phraseFallback: res.diagnostics?.phraseFallback ?? usePhraseFallback,
          }),
        );
      } catch {
        setError("Local composer unavailable — dictation preserved");
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
    const last = lastTranscriptRef.current;
    if (!last) return;
    void dictateInternal(last, true);
  }, [dictateInternal]);

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
        return true;
      }
      setError("Could not apply — resolve the Quick Select / manual conflicts first");
      return false;
    },
    [session, preview?.hasConflicts],
  );

  const discardSession = useCallback(() => {
    setSession(newSmartDictationSession());
    setError(null);
  }, []);

  return {
    session,
    preview,
    composing,
    error,
    phraseFallbackAvailable,
    hasPending: sessionHasPending(session),
    pendingCount: session.observations.size + session.pendingRemovals.size,
    dictate,
    retryWithPhraseFallback,
    applyAll,
    discardSession,
  };
}
