import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  pickAdoptedDraftId, withDraftId as withDraftIdPure, type RadiologyDraftRow,
} from "@/lib/radiologyDraftId";

export type { RadiologyDraftRow };

/**
 * Owns the identity of "the current draft for this study" — extracted from
 * pages/RadiologyReportGenerator.tsx's pre-existing, correct
 * load-then-track-then-update-by-id pattern (the only place in this
 * codebase that implemented it) so both that page and
 * pages/RadiologyReportingWorkspace.tsx share one implementation instead of
 * each re-deriving it.
 *
 * On mount (once `studyId` is known), loads the most recently updated
 * radiology_report_drafts row for this study, if any exists — mirroring
 * GET /drafts's existing `ORDER BY updated_at DESC LIMIT 50` and simply
 * taking the first result, exactly as the legacy page already did. The
 * loaded row's id is adopted once per studyId; a later `captureSavedDraftId`
 * call (after a successful save) always wins and is never overwritten by a
 * background refetch of the same query.
 */
export function useRadiologyDraftId(studyId: number | null | undefined) {
  const [draftId, setDraftId] = useState<number | null>(null);
  const adoptedForRef = useRef<number | null>(null);

  const { data: existingDraft, isLoading: isLoadingExistingDraft } = useQuery<RadiologyDraftRow | null>({
    queryKey: ["radiology-existing-draft", studyId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; drafts: RadiologyDraftRow[] }>(
        `/api/radiology/report-generator/drafts?studyId=${studyId}`,
      );
      return res?.drafts?.[0] ?? null;
    },
    enabled: !!studyId,
  });

  // Study switch: drop Patient A's draft id immediately, then adopt B's once loaded.
  useEffect(() => {
    adoptedForRef.current = null;
    setDraftId(null);
  }, [studyId]);

  useEffect(() => {
    if (!studyId || isLoadingExistingDraft) return;
    if (adoptedForRef.current === studyId) return; // already adopted for this study — a save's captureSavedDraftId always wins from here on
    adoptedForRef.current = studyId;
    setDraftId(pickAdoptedDraftId(existingDraft ?? null));
  }, [studyId, existingDraft, isLoadingExistingDraft]);

  /** Call with the id returned by a successful save so the next save
   *  updates this same row instead of creating another one. */
  const captureSavedDraftId = useCallback((id: number) => {
    setDraftId(id);
    // Stamp adopt so a concurrent query adoption cannot clobber this save.
    if (studyId) adoptedForRef.current = studyId;
  }, [studyId]);

  return {
    draftId,
    existingDraft: existingDraft ?? null,
    isLoadingExistingDraft,
    withDraftId: <T extends object>(body: T) => withDraftIdPure(body, draftId),
    captureSavedDraftId,
  };
}
