/**
 * AI auto-impression (Ctrl+I) for RadiologyReportingWorkspace.
 *
 * Posts the typed findings as `reportBody` — the field the /draft handler
 * actually reads — and toasts when the model gives nothing back.
 *
 * Registers the callback on the zai workspace store so the command palette /
 * host bridge can invoke it. useWorkspaceCommands closes over the same
 * returned callback for the keyboard path.
 */

import { useCallback, useEffect } from "react";
import { api } from "@/lib/fetchApi";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type UseTriggerAiImpressionOptions = {
  studyInstanceUID: string | null | undefined;
  modality: string | null | undefined;
};

export function useTriggerAiImpression(opts: UseTriggerAiImpressionOptions) {
  const { studyInstanceUID, modality } = opts;
  const { toast } = useToast();

  const triggerAiImpression = useCallback(async () => {
    const cur = useWorkspace.getState().findingsText;
    if (!cur.trim()) return;
    try {
      const res = await api.post<{ impression?: string }>("/api/ai-reporting/draft", {
        studyInstanceUID,
        modality,
        field: "impression",
        reportBody: cur,
      });
      if (res.impression) {
        useWorkspace.getState().setGhostText(res.impression, "impression");
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
