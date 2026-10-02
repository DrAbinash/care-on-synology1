/**
 * AI auto-impression (Ctrl+I) for RadiologyReportingWorkspace.
 *
 * Posts the typed findings as `reportBody` — the field the /draft handler
 * actually reads — under `field: "impression"`, which the handler also reads:
 * it asks the model for an Impression only and returns no Findings, so this
 * path can never hand back model-invented findings as a replacement for text
 * the radiologist already typed.
 *
 * The response carries a grounding verdict from the composer's own validator.
 * It is surfaced as a toast and never as text: the impression still lands in
 * the ghost layer and still needs an explicit accept.
 *
 * A response is dropped unless the study open when it lands is the study the
 * request was built from (see shouldApplyAsyncStudyKey). Without that, an
 * impression summarising Patient A's findings appears in Patient B's ghost
 * layer one keystroke from being accepted into B's report.
 *
 * Registers the callback on the zai workspace store so the command palette /
 * host bridge can invoke it. useWorkspaceCommands closes over the same
 * returned callback for the keyboard path.
 */

import { useCallback, useEffect } from "react";
import type { AiDraftValidation, AiReportingDraftRequest } from "@workspace/api-zod";
import { api } from "@/lib/fetchApi";
import { draftValidationNotice } from "@/lib/aiDraftValidation";
import { shouldApplyAsyncStudyKey } from "@/lib/radiologyWorkspaceSafety";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type UseTriggerAiImpressionOptions = {
  studyInstanceUID: string | null | undefined;
  modality: string | null | undefined;
};

type AiDraftResponse = {
  impression?: string;
  findings?: string;
  validation?: AiDraftValidation;
  aiSafetyLabel?: string;
};

export function useTriggerAiImpression(opts: UseTriggerAiImpressionOptions) {
  const { studyInstanceUID, modality } = opts;
  const { toast } = useToast();

  const triggerAiImpression = useCallback(async () => {
    const atRequest = useWorkspace.getState();
    const cur = atRequest.findingsText;
    if (!cur.trim()) return;
    // Captured BEFORE the await. A /draft round trip to a local model takes
    // seconds, and a radiologist working a list moves on inside that window; the
    // callback still closes over the study the request was built from, so the
    // response has to be checked against the study that is open when it lands.
    const requested = {
      studyId: atRequest.activeStudyId,
      studyInstanceUID: atRequest.activeStudyInstanceUID ?? studyInstanceUID ?? null,
    };
    try {
      const body: AiReportingDraftRequest = {
        studyInstanceUID,
        modality,
        field: "impression",
        reportBody: cur,
      };
      const res = await api.post<AiDraftResponse>("/api/ai-reporting/draft", body);
      const now = useWorkspace.getState();
      const sameStudy =
        shouldApplyAsyncStudyKey(requested.studyId, now.activeStudyId)
        && shouldApplyAsyncStudyKey(requested.studyInstanceUID, now.activeStudyInstanceUID);
      if (!sameStudy) {
        toast({
          title: "AI impression discarded",
          description: "You moved to another study while the model was working. Nothing was changed.",
          variant: "destructive",
          duration: 12000,
        });
        return;
      }
      if (res.impression) {
        now.setGhostText(res.impression, "impression");
        const notice = draftValidationNotice(res.validation, { impressionOnly: true });
        if (notice) {
          toast({
            title: "AI impression needs verification",
            description: notice,
            variant: "destructive",
            duration: 12000,
          });
        }
      } else {
        toast({
          title: "AI returned no impression",
          description: "Your findings are unchanged.",
          variant: "destructive",
        });
      }
    } catch (err) {
      // A silent console.warn here meant a radiologist pressing Ctrl+I saw
      // nothing happen at all, with no way to tell a disabled model from a
      // dropped request.
      toast({
        title: "AI impression failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [studyInstanceUID, modality, toast]);

  useEffect(() => {
    useWorkspace.setState({ triggerAiImpression });
    return () => useWorkspace.setState({ triggerAiImpression: undefined });
  }, [triggerAiImpression]);

  return { triggerAiImpression };
}
