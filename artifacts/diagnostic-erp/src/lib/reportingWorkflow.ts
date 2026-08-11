/**
 * reportingWorkflow.ts — Ticket M1.5
 *
 * The canonical workflow controller's RULES: queue ordering, next/previous
 * selection, park/skip, history, indicators, and transition guards — pure,
 * zero-dependency functions (same testability reasoning as
 * workspaceReportState.ts / radiologyDraftId.ts). The React wiring lives in
 * hooks/useReportingWorkflow.ts; navigation itself stays in the page.
 *
 * Park is deliberately CLIENT-side session state (localStorage): the server
 * worklist has no PARKED status, and inventing one would leak into every
 * status filter across the app. A parked study is a personal "come back to
 * this later" marker for the reporting session, not a clinical state.
 */

/** The queue row fields the workflow rules need (subset of the pacs-worklist
 *  response — the full row passes through untouched). */
export interface QueueStudy {
  id: number;
  patientId: number | null;
  patientName: string;
  modality: string;
  studyDescription: string | null;
  accessionNumber: string;
  status: string;
  reportId?: number | null;
  /** DICOM Study Instance UID — used by MRI warm-cache / OHIF prefetch. */
  studyInstanceUID?: string | null;
  // M1.6A — assignment + lock fields (absent on pre-lock payloads).
  assignedRadiologist?: string | null;
  lockUserId?: number | null;
  lockUserName?: string | null;
  lockExpiresAt?: string | null;
  // M1.6B1 — canonical id-based assignment (name above stays the mirror).
  assignedRadiologistId?: number | null;
  assignedAt?: string | null;
  // Study-received timestamp, used by the queue's date-range filter.
  createdAt?: string;
}

/** Drop malformed queue rows (missing id) so navigation/indicators never crash. */
export function sanitizeQueueStudies(rows: QueueStudy[]): QueueStudy[] {
  return rows.filter(
    (s): s is QueueStudy => s != null && typeof s.id === "number" && Number.isFinite(s.id),
  );
}

export interface ParkedStudy {
  id: number;
  reason: string | null;
  parkedAt: number; // epoch ms
}

/** Server statuses that mean "this study's report is done". */
export const COMPLETED_STATUSES: ReadonlySet<string> = new Set(["REPORT_FINAL", "DELIVERED"]);

export interface WorkflowSnapshot {
  /** Queue rows in server display order (worklist order). */
  queue: QueueStudy[];
  currentId: number | null;
  parked: ParkedStudy[];
  /** Studies finalized in THIS session — excluded from "next eligible" even
   *  before the queue refetch reflects the server status flip. */
  completedIds: ReadonlySet<number>;
  /** M1.6A — when present, rows actively locked by ANOTHER user are excluded
   *  from next-eligible and flagged in the indicators, and next-study prefers
   *  assigned-to-me → unassigned → pooled. Absent = pre-lock behavior. */
  myUserId?: number | null;
  myName?: string | null;
  nowMs?: number;
}

/** Active foreign lock, from the server-computed expiry only. */
export function isQueueRowLockedByOther(row: QueueStudy, myUserId: number | null | undefined, nowMs: number | undefined): boolean {
  if (row.lockUserId == null || myUserId == null || nowMs == null) return false;
  if (row.lockUserId === myUserId) return false;
  const expires = row.lockExpiresAt ? new Date(row.lockExpiresAt).getTime() : NaN;
  return Number.isFinite(expires) && expires > nowMs;
}

export function isStudyCompleted(study: QueueStudy, completedIds: ReadonlySet<number>): boolean {
  return COMPLETED_STATUSES.has(study.status) || completedIds.has(study.id);
}

export function isStudyParked(id: number, parked: ParkedStudy[]): boolean {
  return parked.some((p) => p.id === id);
}

// ─── Queue position + indicators (Phase 6) ───────────────────────────────────

export function queuePosition(queue: QueueStudy[], currentId: number | null): { index: number; total: number } {
  const index = currentId == null ? -1 : queue.findIndex((s) => s.id === currentId);
  return { index, total: queue.length };
}

export interface QueueIndicator {
  id: number;
  current: boolean;
  completed: boolean;
  parked: boolean;
  /** M1.6A — actively locked by another user (visibly marked, not eligible). */
  lockedByOther: boolean;
}

export function queueIndicators(snapshot: WorkflowSnapshot): QueueIndicator[] {
  return snapshot.queue.map((s) => ({
    id: s.id,
    current: s.id === snapshot.currentId,
    completed: isStudyCompleted(s, snapshot.completedIds),
    parked: isStudyParked(s.id, snapshot.parked),
    lockedByOther: isQueueRowLockedByOther(s, snapshot.myUserId, snapshot.nowMs),
  }));
}

// ─── Next / eligibility (Phase 3) ────────────────────────────────────────────

/**
 * The next ELIGIBLE study: scanning forward from the current position (wrap
 * around), skip the current study, everything completed (server status or
 * finalized this session), everything parked, and (M1.6A) everything actively
 * locked by another user. Among the eligible candidates the pick prefers
 * assigned-to-me → unassigned → pooled (assigned to someone else), keeping
 * scan order within a tier. Returns null when nothing is left to report.
 */
export function nextEligibleStudy(snapshot: WorkflowSnapshot): QueueStudy | null {
  const { queue, currentId } = snapshot;
  if (queue.length === 0) return null;
  const start = currentId == null ? -1 : queue.findIndex((s) => s.id === currentId);
  const myName = (snapshot.myName ?? "").trim().toLowerCase();
  let best: { candidate: QueueStudy; tier: number } | null = null;
  for (let step = 1; step <= queue.length; step++) {
    const candidate = queue[(start + step + queue.length) % queue.length];
    if (candidate.id === currentId) continue;
    if (isStudyCompleted(candidate, snapshot.completedIds)) continue;
    if (isStudyParked(candidate.id, snapshot.parked)) continue;
    if (isQueueRowLockedByOther(candidate, snapshot.myUserId, snapshot.nowMs)) continue;
    // Preference tier — the stable staff id is canonical (M1.6B1); the name
    // mirror covers legacy rows.
    let tier: number;
    if (candidate.assignedRadiologistId != null) {
      tier = snapshot.myUserId != null && candidate.assignedRadiologistId === snapshot.myUserId ? 0 : 2;
    } else {
      const assigned = (candidate.assignedRadiologist ?? "").trim().toLowerCase();
      tier = assigned && myName && assigned === myName ? 0 : !assigned ? 1 : 2;
    }
    if (!best || tier < best.tier) best = { candidate, tier };
    if (best.tier === 0) break; // nothing can beat an assigned-to-me study
  }
  return best?.candidate ?? null;
}

/** The next study for RETURN TO PARKED: oldest-parked first, still in queue,
 *  and (M1.6A) not actively locked by another user in the meantime. */
export function nextParkedStudy(snapshot: WorkflowSnapshot): QueueStudy | null {
  const inQueue = new Map(snapshot.queue.map((s) => [s.id, s]));
  const candidates = [...snapshot.parked]
    .filter((p) => {
      const row = inQueue.get(p.id);
      return p.id !== snapshot.currentId && row !== undefined &&
        !isQueueRowLockedByOther(row, snapshot.myUserId, snapshot.nowMs);
    })
    .sort((a, b) => a.parkedAt - b.parkedAt);
  return candidates.length ? inQueue.get(candidates[0].id)! : null;
}

// ─── History (Phase 4) ───────────────────────────────────────────────────────

export const HISTORY_LIMIT = 50;

/** Push a visited study onto the history stack (dedup consecutive, bounded). */
export function pushHistory(stack: number[], id: number, limit = HISTORY_LIMIT): number[] {
  if (stack.length > 0 && stack[stack.length - 1] === id) return stack;
  const next = [...stack, id];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Pop the previous study to return to. Returns the target and the remaining
 *  stack; null target when there is no history. */
export function popHistory(stack: number[]): { target: number | null; stack: number[] } {
  if (stack.length === 0) return { target: null, stack };
  return { target: stack[stack.length - 1], stack: stack.slice(0, -1) };
}

// ─── Park / unpark (Phase 5) ─────────────────────────────────────────────────

export function parkStudy(parked: ParkedStudy[], id: number, reason: string | null, now: number): ParkedStudy[] {
  const trimmed = reason?.trim() || null;
  const without = parked.filter((p) => p.id !== id);
  return [...without, { id, reason: trimmed, parkedAt: now }];
}

export function unparkStudy(parked: ParkedStudy[], id: number): ParkedStudy[] {
  return parked.filter((p) => p.id !== id);
}

/** Drop parked entries that left the queue or are already completed — a
 *  parked marker for a finished/vanished study must not linger. */
export function pruneParked(parked: ParkedStudy[], queue: QueueStudy[], completedIds: ReadonlySet<number>): ParkedStudy[] {
  const byId = new Map(queue.map((s) => [s.id, s]));
  return parked.filter((p) => {
    const row = byId.get(p.id);
    return row !== undefined && !isStudyCompleted(row, completedIds);
  });
}

/** Serialization for localStorage — tolerant of corrupt/legacy payloads. */
export function parseParked(raw: string | null): ParkedStudy[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({
        id: Number(p.id),
        reason: typeof p.reason === "string" && p.reason.trim() ? p.reason : null,
        parkedAt: Number(p.parkedAt) || 0,
      }))
      .filter((p) => Number.isInteger(p.id) && p.id > 0);
  } catch {
    return [];
  }
}

// ─── Transition guards (Phase 3/7) ───────────────────────────────────────────

export interface TransitionGuards {
  dirty: boolean;
  saving: boolean;
  finalizing: boolean;
  viewerLaunching: boolean;
  transitioning: boolean;
}

export type TransitionVerdict =
  | { kind: "ok" }
  | { kind: "confirm"; reason: string }
  | { kind: "blocked"; reason: string };

/**
 * Whether the workspace may leave the current study right now. Busy states
 * BLOCK (switching mid-save/finalize/launch can cross patient boundaries);
 * dirty state requires an explicit CONFIRM (the radiologist decides).
 */
export function canLeaveStudy(g: TransitionGuards): TransitionVerdict {
  if (g.saving) return { kind: "blocked", reason: "Save in progress — wait for it to finish" };
  if (g.finalizing) return { kind: "blocked", reason: "Finalize in progress — wait for it to finish" };
  if (g.viewerLaunching) return { kind: "blocked", reason: "Viewer launch in progress — wait for it to finish" };
  if (g.transitioning) return { kind: "blocked", reason: "Already switching studies" };
  if (g.dirty) return { kind: "confirm", reason: "This report has unsaved changes. Leave without saving?" };
  return { kind: "ok" };
}
