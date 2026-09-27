/**
 * V-03 abnormal-pattern suggestions.
 *
 * Suggestion-only. Apply opens the existing MergePreviewDialog (mergePreviewOpen
 * + lastMergeResult). applyMacroBundle runs only inside the confirm callback
 * that MergePreviewDialog's Apply reaches via applyMergedResult.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace, type AppliedPathologyPatch } from "@/lib/zai-workspace/store";
import {
  buildAbnormalPatternMergePreview,
  buildAbnormalPatternObservations,
  bumpPatternUsageCount,
  matchAbnormalPatterns,
  patternBundleId,
  type AbnormalPattern,
  type AbnormalPatternHit,
} from "@/lib/reporting/abnormalPatterns";
import {
  appliedPatternMarker,
  upsertAppliedPatternMarker,
  type AppliedPatternMarker,
} from "@/lib/abnormalPatternDraft";

export type UseAbnormalPatternSuggestionsInput = {
  region: string;
  modality: string;
  protocolName?: string | null;
  selectedChipLabels: string[];
  clinicalHistory: string;
  findingsText: string;
  appliedPathologyPatches: AppliedPathologyPatch[];
  learnedIgnored: Set<string>;
  recordIgnored: (id: string, ignored: boolean) => void;
  studyId: number | null;
};

function dismissalKey(studyId: number | null, patternId: string): string {
  return `pattern:${studyId ?? "none"}:${patternId}`;
}

function dismissedIdsForStudy(studyId: number | null, learned: Set<string>, session: Set<string>): string[] {
  const ids = new Set(session);
  const prefix = `pattern:${studyId ?? "none"}:`;
  for (const key of learned) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  }
  return [...ids];
}

/**
 * Stages the merge preview. The callback stored on the workspace is what
 * MergePreviewDialog Apply invokes (applyMergedResult early-returns into it).
 * This is the only pattern applyMacroBundle call site.
 */
export function stageAbnormalPatternForConfirm(pattern: AbnormalPattern, region: string): void {
  const observations = buildAbnormalPatternObservations(pattern, region);
  useWorkspace.setState({
    mergePreviewOpen: true,
    lastMergeResult: buildAbnormalPatternMergePreview(pattern),
    lastMergeFormats: null,
    abnormalPatternConfirm: () => {
      useWorkspace.getState().applyMacroBundle({
        bundleId: patternBundleId(pattern),
        observations,
      });
      const marker = appliedPatternMarker(pattern);
      useWorkspace.setState({
        appliedPatternMarkers: upsertAppliedPatternMarker(
          useWorkspace.getState().appliedPatternMarkers,
          marker,
        ),
        patternUsageCounts: bumpPatternUsageCount(pattern.id),
      });
    },
  });
}

export function useAbnormalPatternSuggestions(input: UseAbnormalPatternSuggestionsInput) {
  const library = useWorkspace((s) => s.abnormalPatternLibrary);
  const suggestionsEnabled = useWorkspace((s) => s.abnormalPatternSuggestionsEnabled);
  const appliedPatternMarkers = useWorkspace((s) => s.appliedPatternMarkers);
  const patternUsageCounts = useWorkspace((s) => s.patternUsageCounts);
  const [sessionDismissed, setSessionDismissed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSessionDismissed(new Set());
  }, [input.studyId]);

  const patternSuggestions: AbnormalPatternHit[] = useMemo(() => {
    const bundleIds = input.appliedPathologyPatches
      .map((p) => p.observation?.bundleId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return matchAbnormalPatterns({
      region: input.region,
      modality: input.modality,
      protocolName: input.protocolName,
      selectedChipLabels: input.selectedChipLabels,
      clinicalHistory: input.clinicalHistory,
      findingsText: input.findingsText,
      appliedBundleIds: bundleIds,
      appliedPatternIds: appliedPatternMarkers.map((m) => m.patternId),
      dismissedPatternIds: dismissedIdsForStudy(input.studyId, input.learnedIgnored, sessionDismissed),
    }, library);
  }, [
    input.region,
    input.modality,
    input.protocolName,
    input.selectedChipLabels,
    input.clinicalHistory,
    input.findingsText,
    input.appliedPathologyPatches,
    input.learnedIgnored,
    input.studyId,
    appliedPatternMarkers,
    sessionDismissed,
    library,
  ]);

  const applyPattern = useCallback((patternId: string) => {
    const pattern = library.find((p) => p.id === patternId && p.enabled !== false);
    if (!pattern) return;
    stageAbnormalPatternForConfirm(pattern, input.region);
  }, [library, input.region]);

  const dismissPattern = useCallback((patternId: string) => {
    setSessionDismissed((prev) => {
      const next = new Set(prev);
      next.add(patternId);
      return next;
    });
    input.recordIgnored(dismissalKey(input.studyId, patternId), true);
  }, [input.studyId, input.recordIgnored]);

  return {
    patternSuggestions,
    applyPattern,
    dismissPattern,
    appliedPatternMarkers: appliedPatternMarkers as AppliedPatternMarker[],
    patternUsageCounts,
    abnormalPatternSuggestionsEnabled: suggestionsEnabled,
  };
}
