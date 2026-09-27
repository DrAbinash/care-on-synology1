/**
 * AI auto-impression (Ctrl+I) for RadiologyReportingWorkspace.
 * Phase 5a extraction — pure move; behavior unchanged.
 *
 * Registers the callback on the zai workspace store so the command palette /
 * host bridge can invoke it. useWorkspaceCommands closes over the same
 * returned callback for the keyboard path.
 */

import { useCallback, useEffect } from "react";
import { api } from "@/lib/fetchApi";
import { useWorkspace } from "@/lib/zai-workspace/store";

export type UseTriggerAiImpressionOptions = {
  studyInstanceUID: string | null | undefined;
  modality: string | null | undefined;
};

export function useTriggerAiImpression(opts: UseTriggerAiImpressionOptions) {
  const { studyInstanceUID, modality } = opts;

  const triggerAiImpression = useCallback(async () => {
    const cur = useWorkspace.getState().findingsText;
    if (!cur.trim()) return;
    try {
      const res = await api.post<{ impression: string }>("/api/ai-reporting/draft", {
        studyInstanceUID,
        modality,
        field: "impression",
        findings: cur,
      });
      if (res.impression) useWorkspace.getState().setGhostText(res.impression, "impression");
    } catch (err) { console.warn("[Workspace] AI impression:", err); }
  }, [studyInstanceUID, modality]);

  useEffect(() => {
    useWorkspace.setState({ triggerAiImpression });
    return () => useWorkspace.setState({ triggerAiImpression: undefined });
  }, [triggerAiImpression]);

  return { triggerAiImpression };
}
