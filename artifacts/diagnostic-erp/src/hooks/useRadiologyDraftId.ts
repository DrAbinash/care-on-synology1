import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, rateAwareRetry } from "@/lib/fetchApi";
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

  const {
    data: existingDraft,
    isLoading: isLoadingExistingDraft,
    isPending: draftReadPending,
    isSuccess: draftReadSucceeded,
    error: existingDraftError,
    refetch: refetchExistingDraft,
  } = useQuery<RadiologyDraftRow | null>({
    queryKey: ["radiology-existing-draft", studyId],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; drafts: RadiologyDraftRow[] }>(
        `/api/radiology/report-generator/drafts?studyId=${studyId}`,
      );
      return res?.drafts?.[0] ?? null;
    },
    enabled: !!studyId,
    // This query decides whether the key-image rail exists on screen at all: a
    // single 429 collapsed `draftId` to null and the rail presented a study with
    // no images.
    ...rateAwareRetry,
  });

  // Study switch: drop Patient A's draft id immediately, then adopt B's once loaded.
  useEffect(() => {
    adoptedForRef.current = null;
    setDraftId(null);
  }, [studyId]);

  useEffect(() => {
    if (!studyId || draftReadPending) return;
    // A read that FAILED has not answered. Adopting "no draft" here would stamp
    // this study as settled and a later successful refetch would be ignored, so
    // the rail would sit on "no captures" for a study that has them.
    if (existingDraftError) return;
    if (adoptedForRef.current === studyId) return; // already adopted for this study — a save's captureSavedDraftId always wins from here on
    adoptedForRef.current = studyId;
    setDraftId(pickAdoptedDraftId(existingDraft ?? null));
  }, [studyId, existingDraft, draftReadPending, existingDraftError]);

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
    /**
     * The anchor read has not settled for this study — "unknown", which is not
     * the same claim as "this study has no draft".
     */
    draftReadPending: Boolean(studyId) && draftReadPending,
    /** Only success can authorize initial hydration, including an empty result. */
    draftReadSucceeded: Boolean(studyId) && draftReadSucceeded,
    existingDraftError,
    refetchExistingDraft,
    withDraftId: <T extends object>(body: T) => withDraftIdPure(body, draftId),
    captureSavedDraftId,
  };
}
