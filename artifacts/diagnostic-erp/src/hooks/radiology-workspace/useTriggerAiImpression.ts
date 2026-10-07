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
 * C2 adds the other half of that sentence: the request also records WHICH
 * findings it was built from, as a context binding carried with the returned
 * suggestion. The study-switch guard above says "this is still the same
 * patient"; it cannot say "this is still the same report", so a radiologist who
 * keeps typing while the model thinks used to be handed a summary of text that
 * no longer exists, with nothing marking it as out of date. The binding is built
 * before the await, from the same `cur` that is posted — never from whatever the
 * store says when the response arrives — and the arrival is classified with it,
 * so the proposal is already marked stale the moment it lands rather than being
 * discovered later. Acceptance re-checks independently in the store; what this
 * hook decides is only what the radiologist is told.
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
import {
  aiProposalBindingForImpression,
  currentAiProposalContext,
  evaluateAiProposal,
} from "@/lib/zai-workspace/aiProposalContext";

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
    // C2 — the request claims an ordering number and a context binding from the
    // text actually being sent (`cur`, the Findings at request time), not from
    // whatever the store holds when the response lands. `requested.studyInstanceUID`
    // is folded into the state the binding is read from so a study identified by
    // its row rather than by the live mirror cannot look like a study switch.
    const requestSeq = atRequest.beginAiProposalRequest();
    const binding = {
      ...aiProposalBindingForImpression(
        { ...atRequest, activeStudyInstanceUID: requested.studyInstanceUID },
        "impression",
      ),
      requestSeq,
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
        now.setGhostText(res.impression, "impression", binding);
        // The proposal is shown whatever the report looks like now, because
        // hiding it would be a silent loss of work the radiologist asked for.
        // What it is not allowed to do is pretend to be current: the store
        // re-reads the binding on every render, and acceptance re-checks it
        // independently of anything said here.
        const verdict = evaluateAiProposal(
          binding,
          currentAiProposalContext(useWorkspace.getState()),
        );
        if (!verdict.fresh) {
          toast({
            title: "AI impression is already out of date",
            description: verdict.reason === "source-changed"
              ? "The Findings changed while the model was working, so this sentence summarises text "
                + "that is no longer in the report. It cannot be accepted — press Regenerate."
              : "This suggestion cannot be shown to belong to the report open now, so it is not "
                + "acceptable — press Regenerate.",
            variant: "destructive",
            duration: 12000,
          });
        }
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
