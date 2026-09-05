import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import {
  type QueueStudy, type ParkedStudy, type WorkflowSnapshot,
  queuePosition, queueIndicators, nextEligibleStudy, nextParkedStudy,
  pushHistory, popHistory, parkStudy, unparkStudy, pruneParked, parseParked,
  isStudyParked, sanitizeQueueStudies,
} from "@/lib/reportingWorkflow";
import { filterQueueByScope, type QueueScope } from "@/lib/studyLockState";
import { isUltrasoundModality } from "@/lib/usgModality";
import { toISTDateStr, studyDateInRange } from "@/lib/dateRangePresets";
import { buildPacsWorklistUrl, shouldIncludeOrthanc } from "@/lib/pacsWorklistQuery";

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

/** Stable empty fallback — NEVER use `= []` inline on useQuery data (new ref each render → max update depth). */
const EMPTY_QUEUE: QueueStudy[] = [];

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
  /** Modality bucket for the active reporting queue ("all" | "US" | "MR" | "CT" | …). */
  modalityFilter?: string;
  /** Inclusive IST calendar-day bounds (YYYY-MM-DD). Empty = no date bound. */
  dateFrom?: string;
  dateTo?: string;
  /** Server-side patient/accession search (not client-only). */
  search?: string;
  /**
   * When true, allow Orthanc archive merge (still gated by shouldIncludeOrthanc).
   * Default false — Reading Queue Today/Yesterday must stay Postgres-fast.
   */
  searchOrthanc?: boolean;
}

function matchesQueueModality(modality: string | null | undefined, filter: string): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "US") return isUltrasoundModality(modality);
  const m = (modality ?? "").toUpperCase();
  if (filter === "XR" || filter === "XRAY") {
    return m === "CR" || m === "DX" || m === "XR" || m === "XA" || m === "RF"
      || m.includes("X-RAY") || m.includes("XRAY");
  }
  return m.startsWith(filter.toUpperCase());
}

function matchesQueueDate(
  studyDate: string | null | undefined,
  createdAt: string | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  return studyDateInRange(studyDate, createdAt, dateFrom, dateTo);
}

export function useReportingWorkflow(currentStudyId: number | undefined, options: ReportingWorkflowOptions = {}) {
  const {
    scope = "all",
    myUserId = null,
    myName = null,
    modalityFilter = "all",
    dateFrom = "",
    dateTo = "",
    search = "",
    searchOrthanc = false,
  } = options;
  const qc = useQueryClient();

  const includeOrthanc = shouldIncludeOrthanc({
    enabled: searchOrthanc,
    dateFrom: search.trim() ? "" : dateFrom,
    dateTo: search.trim() ? "" : dateTo,
    search,
  });

  const worklistFilterKey = {
    modality: modalityFilter,
    dateFrom: search.trim() ? "" : dateFrom,
    dateTo: search.trim() ? "" : dateTo,
    search: search.trim(),
  } as const;

  // Always paint Postgres first — Orthanc C-FIND must never block the Reading Queue.
  const dbWorklistQueryKey = [
    "radiology-pacs-worklist",
    { ...worklistFilterKey, orthanc: false },
  ] as const;

  const orthancWorklistQueryKey = [
    "radiology-pacs-worklist",
    { ...worklistFilterKey, orthanc: true },
  ] as const;

  const {
    data: dbQueueRaw,
    isFetching: dbRefreshing,
    refetch: refetchDbQueue,
    dataUpdatedAt: dbUpdatedAt,
  } = useQuery<QueueStudy[]>({
    queryKey: dbWorklistQueryKey,
    queryFn: async () => sanitizeQueueStudies(await api.get<QueueStudy[]>(
      buildPacsWorklistUrl({
        modality: modalityFilter,
        dateFrom: search.trim() ? undefined : (dateFrom || undefined),
        dateTo: search.trim() ? undefined : (dateTo || undefined),
        search: search.trim() || undefined,
        orthanc: false,
      }),
    )),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  // Deferred Orthanc archive merge — only when search needs it; no 30s poll.
  const {
    data: orthancQueueRaw,
    isFetching: orthancRefreshing,
    dataUpdatedAt: orthancUpdatedAt,
  } = useQuery<QueueStudy[]>({
    queryKey: orthancWorklistQueryKey,
    queryFn: async () => sanitizeQueueStudies(await api.get<QueueStudy[]>(
      buildPacsWorklistUrl({
        modality: modalityFilter,
        dateFrom: search.trim() ? undefined : (dateFrom || undefined),
        dateTo: search.trim() ? undefined : (dateTo || undefined),
        search: search.trim() || undefined,
        orthanc: true,
      }),
    )),
    enabled: includeOrthanc,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const fullQueueRaw = includeOrthanc && orthancQueueRaw ? orthancQueueRaw : dbQueueRaw;
  const queueRefreshing = dbRefreshing || (includeOrthanc && orthancRefreshing && !orthancQueueRaw);
  const dataUpdatedAt = includeOrthanc && orthancQueueRaw ? orthancUpdatedAt : dbUpdatedAt;

  // The ACTIVE queue is the scoped one; parked pruning below deliberately
  // uses the FULL queue so switching scopes never discards parked markers
  // for studies that merely fell outside the current filter.
  // Modality + date filters then narrow Next/Previous/position to the
  // radiologist's selected study bucket (Reporting Workspace chrome).
  const fullQueue = useMemo(
    () => sanitizeQueueStudies(fullQueueRaw ?? EMPTY_QUEUE),
    [fullQueueRaw],
  );

  const queue = useMemo(
    () => filterQueueByScope(fullQueue, scope, myName, myUserId).filter((s) =>
      matchesQueueModality(s.modality, modalityFilter)
      && (search.trim()
        ? true
        : matchesQueueDate(
          (s as { studyDate?: string | null }).studyDate,
          s.createdAt ?? (s as { receivedAt?: string }).receivedAt,
          dateFrom,
          dateTo,
        )),
    ),
    [fullQueue, scope, myName, myUserId, modalityFilter, dateFrom, dateTo, search],
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
  // Open study stays visible even when it falls outside the modality/date filter.
  const currentRow = useMemo(
    () => fullQueue.find((s) => s.id === currentStudyId)
      ?? queue.find((s) => s.id === currentStudyId)
      ?? null,
    [fullQueue, queue, currentStudyId],
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
    void refetchDbQueue();
    void qc.invalidateQueries({ queryKey: ["radiology-pacs-worklist"] });
    void qc.invalidateQueries({ queryKey: ["study-queue-brief"] });
  }, [refetchDbQueue, qc]);

  return {
    queue,
    fullQueue,
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
