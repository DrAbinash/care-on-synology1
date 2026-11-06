import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, rateAwareRetry } from "@/lib/fetchApi";
import {
  acknowledgedDraftRow, pickAdoptedDraftId, withDraftId as withDraftIdPure,
  type AcknowledgedDraftRowArgs, type RadiologyDraftRow,
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
 * loaded row's id is adopted once per studyId; a later `captureSavedDraft`
 * call (after a successful save) always wins and is never overwritten by a
 * background refetch of the same query.
 *
 * The cache holds more than an id on purpose: it is what the editor hydrates
 * from when a study is reopened before a fresh read settles. Recording only
 * the id left the cached narrative as it was at open, so switching patients
 * and returning handed the radiologist the pre-save text and — because
 * hydration clears `isDirty` — the next save wrote that stale text over the
 * newer one on the server. See `acknowledgedDraftRow()`.
 */
export function useRadiologyDraftId(studyId: number | null | undefined) {
  const [draftId, setDraftId] = useState<number | null>(null);
  const adoptedForRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  /**
   * Per-study write watermark. A save this browser acknowledged bumps it, and a
   * read issued BEFORE the bump cannot have seen that write, so its answer is
   * the older fact and must not replace what was acknowledged.
   */
  const ackWatermarkRef = useRef(new Map<number, number>());
  const ackCountRef = useRef(0);
  /**
   * The study as of the LATEST render, read by `captureSavedDraft`. A save
   * callback can be held by a debounce or dialog and resolve after the route has
   * moved to another study; comparing against the closure's `studyId` — which is
   * frozen at the study the save was sent for — would adopt that finished study's
   * draft id as the current one, and the open study's editor would then save
   * under a row that belongs to a different patient.
   */
  const liveStudyIdRef = useRef<number | null | undefined>(studyId);
  liveStudyIdRef.current = studyId;

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
      const readStudyId = studyId as number;
      const watermarkAtIssue = ackWatermarkRef.current.get(readStudyId) ?? 0;
      const res = await api.get<{ success: boolean; drafts: RadiologyDraftRow[] }>(
        `/api/radiology/report-generator/drafts?studyId=${readStudyId}`,
      );
      const fetched = res?.drafts?.[0] ?? null;
      if ((ackWatermarkRef.current.get(readStudyId) ?? 0) !== watermarkAtIssue) {
        const acknowledged = queryClient.getQueryData<RadiologyDraftRow | null>(
          ["radiology-existing-draft", readStudyId],
        );
        return acknowledged ?? fetched;
      }
      return fetched;
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
    if (adoptedForRef.current === studyId) return; // already adopted for this study — a save's captureSavedDraft always wins from here on
    adoptedForRef.current = studyId;
    setDraftId(pickAdoptedDraftId(existingDraft ?? null));
  }, [studyId, existingDraft, draftReadPending, existingDraftError]);

  /**
   * Record the draft row a successful save proved for `ack.studyId`.
   *
   * Deliberately keyed on the SAVED study rather than the one on screen: a save
   * acknowledged after the radiologist has navigated away still describes the
   * study it was sent for, and that row is what makes the later reopen correct.
   * The row it replaces is therefore read from THAT study's cache entry — the
   * entry for the study currently open can belong to a different patient.
   *
   * Such a late acknowledgement must not touch the current study's identity or
   * editor, so the id is adopted only when the save is for the open study.
   */
  const captureSavedDraft = useCallback((
    ack: Omit<AcknowledgedDraftRowArgs, "previous">,
  ) => {
    const key = ["radiology-existing-draft", ack.studyId] as const;
    const draft = acknowledgedDraftRow({
      ...ack,
      previous: queryClient.getQueryData<RadiologyDraftRow | null>(key) ?? null,
    });
    ackWatermarkRef.current.set(ack.studyId, ++ackCountRef.current);
    queryClient.setQueryData(key, draft);
    if (ack.studyId === liveStudyIdRef.current) {
      setDraftId(draft.id);
      adoptedForRef.current = ack.studyId;
    }
    return draft;
  }, [queryClient]);

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
    captureSavedDraft,
  };
}
