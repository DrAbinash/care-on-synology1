import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  extractLearnedIgnored, withLearnedIgnored, clearLearned, learnedIgnoredList,
} from "@/lib/copilotLearning";

/**
 * useCopilotLearning — opt-in personal-style learning (PR #80 Part 11).
 *
 * Reuses the EXISTING radiology_user_copilot_profiles endpoint. When learning is
 * enabled, the Copilot remembers which suggestions this radiologist keeps
 * ignoring (namespaced under "copilot:" in the profile's ignoredWarnings) and
 * stops surfacing them. Disabling learning simply stops reading/writing — the
 * data stays until Reset. No new table; the pure logic lives in lib/copilotLearning.
 */

interface CopilotProfile {
  ignoredWarnings?: string[];
  [k: string]: unknown;
}

export function useCopilotLearning(enabled: boolean) {
  const qc = useQueryClient();
  const { data } = useQuery<{ profile: CopilotProfile }>({
    queryKey: ["radiology-copilot-profile"],
    queryFn: () => api.get("/api/radiology-copilot/profile"),
    enabled,
    staleTime: 300_000,
  });
  const ignoredWarnings = useMemo(() => data?.profile?.ignoredWarnings ?? [], [data]);
  const learnedIgnored = useMemo(() => extractLearnedIgnored(ignoredWarnings), [ignoredWarnings]);

  const patch = useMutation({
    mutationFn: (next: string[]) => api.patch("/api/radiology-copilot/profile", { ignoredWarnings: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radiology-copilot-profile"] }),
  });

  const record = useCallback((id: string, ignored: boolean) => {
    if (!enabled) return;
    const next = withLearnedIgnored(ignoredWarnings, id, ignored);
    if (next.length !== ignoredWarnings.length || ignored) patch.mutate(next);
  }, [enabled, ignoredWarnings, patch]);

  const reset = useCallback(() => {
    patch.mutate(clearLearned(ignoredWarnings));
  }, [ignoredWarnings, patch]);

  const exportData = useCallback(
    () => JSON.stringify({ copilotLearnedIgnored: learnedIgnoredList(ignoredWarnings) }, null, 2),
    [ignoredWarnings],
  );

  return { learnedIgnored: enabled ? learnedIgnored : new Set<string>(), record, reset, exportData };
}
