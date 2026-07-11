import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  type QueueStudy, type ParkedStudy, type WorkflowSnapshot,
  queuePosition, queueIndicators, nextEligibleStudy, nextParkedStudy,
  pushHistory, popHistory, parkStudy, unparkStudy, pruneParked, parseParked,
  isStudyParked,
} from "@/lib/reportingWorkflow";
import { filterQueueByScope, type QueueScope } from "@/lib/studyLockState";

/**
 * useReportingWorkflow — Ticket M1.5 Phase 2: the ONE workflow controller for
 * the canonical Reporting Workspace. Owns queue data, position, history,
 * parked and session-completed state, and the transition lock. All RULES live
 * in lib/reportingWorkflow.ts (pure, unit-tested); navigation itself stays in
 * the page (wouter's navigate), which passes the target id back in as
 * `currentStudyId` on the next render.
 *
 * Deliberately shares the worklist page's query key — one cache entry, no
 * duplicate fetch when both surfaces are open (Phase 11), and the 30s
 * background refetch updates the queue WITHOUT touching report state
 * (placeholderData keeps the previous rows during refetches, so the strip
 * never flickers while the radiologist types).
 */

const PARKED_STORAGE_KEY = "radiology_parked_studies_v1";

function readParked(): ParkedStudy[] {
  try {
    return parseParked(typeof window !== "undefined" ? window.localStorage.getItem(PARKED_STORAGE_KEY) : null);
  } catch {
    return [];
  }
}

function writeParked(parked: ParkedStudy[]): void {
  try {
    window.localStorage.setItem(PARKED_STORAGE_KEY, JSON.stringify(parked));
  } catch { /* private mode — parked state stays in-memory */ }
}

export interface ReportingWorkflowOptions {
  /** M1.6A — assignment-aware queue scope (My Studies / Unassigned / Pool /
   *  All permitted). next/previous/park operate WITHIN the scoped queue. */
  scope?: QueueScope;
  /** Session identity for lock-awareness (skip locked-by-other rows) and
   *  assignment preference (assigned-to-me first). */
  myUserId?: number | null;
  myName?: string | null;
}

export function useReportingWorkflow(currentStudyId: number | undefined, options: ReportingWorkflowOptions = {}) {
  const { scope = "all", myUserId = null, myName = null } = options;
  const qc = useQueryClient();

  // Same key as pages/RadiologyWorklist.tsx — shared cache, no second fetch.
  const { data: fullQueue = [], isFetching: queueRefreshing, refetch: refetchQueue, dataUpdatedAt } = useQuery<QueueStudy[]>({
    queryKey: ["radiology-pacs-worklist"],
    queryFn: () => api.get<QueueStudy[]>("/api/radiology/pacs-worklist"),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev, // background refresh never blanks the strip
  });

  // The ACTIVE queue is the scoped one; parked pruning below deliberately
  // uses the FULL queue so switching scopes never discards parked markers
  // for studies that merely fell outside the current filter.
  const queue = useMemo(
    () => filterQueueByScope(fullQueue, scope, myName),
    [fullQueue, scope, myName],
  );

  const [parked, setParked] = useState<ParkedStudy[]>(readParked);
  const [completedIds, setCompletedIds] = useState<ReadonlySet<number>>(new Set());
  const [historyStack, setHistoryStack] = useState<number[]>([]);
  /** Navigation lock: set when a transition starts, cleared when the target
   *  study's identity has loaded (the page reports back via markArrived). */
  const [transitioning, setTransitioning] = useState(false);
  /** Wrong-patient defense (Phase 7): the patient the TARGET queue row
   *  claimed at transition time; the page cross-checks the loaded entry. */
  const expectedPatientRef = useRef<{ studyId: number; patientId: number | null } | null>(null);

  // Parked entries for finished/vanished studies must not linger — pruned
  // against the FULL queue (scope changes never delete parked markers).
  useEffect(() => {
    if (fullQueue.length === 0) return;
    setParked((prev) => {
      const pruned = pruneParked(prev, fullQueue, completedIds);
      if (pruned.length !== prev.length) writeParked(pruned);
      return pruned.length !== prev.length ? pruned : prev;
    });
  }, [fullQueue, completedIds]);

  const snapshot: WorkflowSnapshot = useMemo(
    () => ({
      queue,
      currentId: currentStudyId ?? null,
      parked,
      completedIds,
      myUserId,
      myName,
      // Refreshed whenever the queue data refreshes (≤30s stale) — plenty for
      // lock-expiry display; the CURRENT study's lock state is authoritative
      // from useStudyLock, not from here.
      nowMs: Date.now(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, currentStudyId, parked, completedIds, myUserId, myName, dataUpdatedAt],
  );

  const position = useMemo(() => queuePosition(queue, currentStudyId ?? null), [queue, currentStudyId]);
  const indicators = useMemo(() => queueIndicators(snapshot), [snapshot]);
  const currentRow = useMemo(
    () => queue.find((s) => s.id === currentStudyId) ?? null,
    [queue, currentStudyId],
  );
  const completedCount = useMemo(
    () => indicators.filter((i) => i.completed).length,
    [indicators],
  );

  /** Next eligible study (skips completed + parked, wraps). */
  const peekNext = useCallback(() => nextEligibleStudy(snapshot), [snapshot]);
  /** Oldest parked study still in the queue. */
  const peekParked = useCallback(() => nextParkedStudy(snapshot), [snapshot]);

  /** Record a departure: push history + set the navigation lock + remember
   *  the target's claimed patient for the arrival cross-check. */
  const beginTransition = useCallback((from: number | undefined, target: QueueStudy) => {
    if (from != null) setHistoryStack((prev) => pushHistory(prev, from));
    expectedPatientRef.current = { studyId: target.id, patientId: target.patientId ?? null };
    setTransitioning(true);
  }, []);

  /** Previous study from the history stack (no re-push of the popped id). */
  const beginPreviousTransition = useCallback((from: number | undefined): number | null => {
    const { target, stack } = popHistory(historyStack);
    if (target == null) return null;
    setHistoryStack(stack);
    const row = queue.find((s) => s.id === target);
    expectedPatientRef.current = { studyId: target, patientId: row?.patientId ?? null };
    setTransitioning(true);
    // Returning from "next" should allow going forward again naturally via
    // Next; the departed study is deliberately NOT pushed (true back-stack).
    void from;
    return target;
  }, [historyStack, queue]);

  /** The page calls this once the target study's worklist row has loaded.
   *  Returns the expected patient id (or undefined when no expectation) so
   *  the page can verify the patient identity actually changed hands. */
  const markArrived = useCallback((studyId: number): { patientId: number | null } | null => {
    setTransitioning(false);
    const expected = expectedPatientRef.current;
    if (expected && expected.studyId === studyId) {
      expectedPatientRef.current = null;
      return { patientId: expected.patientId };
    }
    expectedPatientRef.current = null;
    return null;
  }, []);

  const park = useCallback((id: number, reason: string | null) => {
    setParked((prev) => {
      const next = parkStudy(prev, id, reason, Date.now());
      writeParked(next);
      return next;
    });
  }, []);

  const unpark = useCallback((id: number) => {
    setParked((prev) => {
      const next = unparkStudy(prev, id);
      writeParked(next);
      return next;
    });
  }, []);

  const markCompleted = useCallback((id: number) => {
    setCompletedIds((prev) => new Set(prev).add(id));
  }, []);

  const refreshQueue = useCallback(() => {
    void refetchQueue();
    void qc.invalidateQueries({ queryKey: ["study-queue-brief"] });
  }, [refetchQueue, qc]);

  return {
    queue,
    queueRefreshing,
    queueUpdatedAt: dataUpdatedAt,
    position,
    indicators,
    currentRow,
    parked,
    parkedCount: parked.length,
    completedCount,
    historyDepth: historyStack.length,
    transitioning,
    peekNext,
    peekParked,
    beginTransition,
    beginPreviousTransition,
    markArrived,
    park,
    unpark,
    isParked: (id: number | undefined) => id != null && isStudyParked(id, parked),
    markCompleted,
    refreshQueue,
  };
}
