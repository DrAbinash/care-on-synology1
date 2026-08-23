/**
 * useVoiceComposer — local AI report composer integration for voice dictation.
 */
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/fetchApi";
import { previewChangePlan } from "@/lib/voiceReportComposer/applyChangePlan";
import type {
  ComposeApiResponse,
  VoiceChangePlan,
  VoiceComposerDiagnostics,
  VoiceComposerProvenance,
} from "@/lib/voiceReportComposer/types";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type VoiceComposerPreview = {
  transcript: string;
  plan: VoiceChangePlan;
  adds: string[];
  removes: string[];
  impression?: string;
  diagnostics?: VoiceComposerDiagnostics;
  provenance?: VoiceComposerProvenance;
};

export function useVoiceComposer(opts: {
  modality?: string;
  region?: string;
  reportTitle?: string;
  protectedQuickFindingLabels?: string[];
  enabled?: boolean;
}) {
  const [preview, setPreview] = useState<VoiceComposerPreview | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTranscriptRef = useRef("");

  const compose = useCallback(async (
    transcript: string,
    generateImpressionOnly = false,
  ): Promise<VoiceComposerPreview | null> => {
    if (!opts.enabled) return null;
    const text = transcript.trim();
    if (!text) return null;
    lastTranscriptRef.current = text;
    setComposing(true);
    setError(null);

    const state = useWorkspace.getState();
    try {
      const res = await api.post<ComposeApiResponse>(
        "/api/radiology/voice-report-composer/compose",
        {
          transcript: text,
          modality: opts.modality,
          region: opts.region,
          reportTitle: opts.reportTitle,
          findingsText: state.findingsText,
          impressionText: state.impressionText,
          techniqueText: state.techniqueText,
          priorTranscript: state.voiceComposerTranscriptHistory.slice(-1)[0],
          priorObservations: state.voiceComposerObservations,
          generateImpressionOnly,
          fieldProvenance: state.fieldProvenance,
          protectedQuickFindingLabels: opts.protectedQuickFindingLabels,
        },
      );

      if (!res.ok || !res.plan) {
        const msg = res.error ?? "Local composer unavailable — dictation preserved";
        setError(msg);
        setPreview(null);
        return null;
      }

      const pv = previewChangePlan({
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

      const item: VoiceComposerPreview = {
        transcript: text,
        plan: res.plan,
        adds: pv.adds,
        removes: pv.removes,
        impression: pv.impression,
        diagnostics: res.diagnostics,
        provenance: res.provenance,
      };
      setPreview(item);
      return item;
    } catch {
      setError("Local composer unavailable — dictation preserved");
      setPreview(null);
      return null;
    } finally {
      setComposing(false);
    }
  }, [opts.enabled, opts.modality, opts.region, opts.reportTitle, opts.protectedQuickFindingLabels]);

  const applyPreview = useCallback(() => {
    if (!preview) return false;
    const status = useWorkspace.getState().applyVoiceComposerPlan(preview.plan, preview.transcript);
    if (status === "applied") {
      setPreview(null);
      setError(null);
      return true;
    }
    setError("Could not apply voice change plan");
    return false;
  }, [preview]);

  const discardPreview = useCallback(() => {
    setPreview(null);
    setError(null);
  }, []);

  return {
    preview,
    composing,
    error,
    compose,
    applyPreview,
    discardPreview,
    lastTranscript: lastTranscriptRef.current,
  };
}
