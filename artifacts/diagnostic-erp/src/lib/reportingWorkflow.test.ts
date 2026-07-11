import { describe, it, expect } from "vitest";
import {
  type QueueStudy, type ParkedStudy, type WorkflowSnapshot,
  COMPLETED_STATUSES, isStudyCompleted, isStudyParked,
  queuePosition, queueIndicators, nextEligibleStudy, nextParkedStudy,
  pushHistory, popHistory, HISTORY_LIMIT,
  parkStudy, unparkStudy, pruneParked, parseParked,
  canLeaveStudy,
} from "./reportingWorkflow";

// Ticket M1.5 — the workflow controller's pure rules.

const study = (id: number, over: Partial<QueueStudy> = {}): QueueStudy => ({
  id, patientId: id * 10, patientName: `Patient ${id}`, modality: "MRI",
  studyDescription: "STUDY", accessionNumber: `ACC-${id}`, status: "STUDY_RECEIVED",
  ...over,
});

const snap = (over: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot => ({
  queue: [study(1), study(2), study(3), study(4)],
  currentId: 1,
  parked: [],
  completedIds: new Set<number>(),
  ...over,
});

describe("completion + position + indicators (Phase 6)", () => {
  it("server statuses REPORT_FINAL/DELIVERED and session-completed ids both count", () => {
    expect(COMPLETED_STATUSES.has("REPORT_FINAL")).toBe(true);
    expect(isStudyCompleted(study(1, { status: "DELIVERED" }), new Set())).toBe(true);
    expect(isStudyCompleted(study(1), new Set([1]))).toBe(true);
    expect(isStudyCompleted(study(1), new Set())).toBe(false);
  });

  it("queuePosition finds the current row; -1 when absent", () => {
    expect(queuePosition([study(1), study(2)], 2)).toEqual({ index: 1, total: 2 });
    expect(queuePosition([study(1)], 99)).toEqual({ index: -1, total: 1 });
    expect(queuePosition([], null)).toEqual({ index: -1, total: 0 });
  });

  it("indicators mark current / completed / parked per row", () => {
    const s = snap({
      queue: [study(1), study(2, { status: "REPORT_FINAL" }), study(3)],
      currentId: 1,
      parked: [{ id: 3, reason: null, parkedAt: 1 }],
    });
    expect(queueIndicators(s)).toEqual([
      { id: 1, current: true, completed: false, parked: false },
      { id: 2, current: false, completed: true, parked: false },
      { id: 3, current: false, completed: false, parked: true },
    ]);
  });
});

describe("nextEligibleStudy (Phase 3)", () => {
  it("picks the next row after the current position", () => {
    expect(nextEligibleStudy(snap())?.id).toBe(2);
    expect(nextEligibleStudy(snap({ currentId: 3 }))?.id).toBe(4);
  });

  it("wraps around the end of the queue", () => {
    expect(nextEligibleStudy(snap({ currentId: 4 }))?.id).toBe(1);
  });

  it("skips completed (server status AND session-finalized) and parked rows", () => {
    const s = snap({
      queue: [study(1), study(2, { status: "REPORT_FINAL" }), study(3), study(4)],
      completedIds: new Set([3]),
      parked: [{ id: 4, reason: "call ref", parkedAt: 1 }],
      currentId: 1,
    });
    // 2 completed by status, 3 completed this session, 4 parked → nothing.
    expect(nextEligibleStudy(s)).toBeNull();
  });

  it("never returns the current study and null on empty queues", () => {
    expect(nextEligibleStudy(snap({ queue: [study(1)], currentId: 1 }))).toBeNull();
    expect(nextEligibleStudy(snap({ queue: [], currentId: null }))).toBeNull();
  });

  it("current study not in queue: starts from the top", () => {
    expect(nextEligibleStudy(snap({ currentId: 999 }))?.id).toBe(1);
  });
});

describe("nextParkedStudy (Phase 5 — return to parked)", () => {
  it("returns the OLDEST parked study still in the queue, never the current one", () => {
    const parked: ParkedStudy[] = [
      { id: 3, reason: null, parkedAt: 300 },
      { id: 2, reason: "waiting on priors", parkedAt: 100 },
      { id: 99, reason: null, parkedAt: 50 }, // no longer in queue
    ];
    expect(nextParkedStudy(snap({ parked }))?.id).toBe(2);
    expect(nextParkedStudy(snap({ parked, currentId: 2 }))?.id).toBe(3);
    expect(nextParkedStudy(snap({ parked: [] }))).toBeNull();
  });
});

describe("history stack (Phase 4)", () => {
  it("pushes with consecutive-dedup and a bound", () => {
    expect(pushHistory([], 1)).toEqual([1]);
    expect(pushHistory([1], 1)).toEqual([1]); // consecutive dedup
    expect(pushHistory([1], 2)).toEqual([1, 2]);
    const long = Array.from({ length: HISTORY_LIMIT }, (_, i) => i + 1);
    const bounded = pushHistory(long, 999);
    expect(bounded).toHaveLength(HISTORY_LIMIT);
    expect(bounded[bounded.length - 1]).toBe(999);
    expect(bounded[0]).toBe(2); // oldest dropped
  });

  it("pops the most recent visit; empty stack → null", () => {
    expect(popHistory([1, 2])).toEqual({ target: 2, stack: [1] });
    expect(popHistory([])).toEqual({ target: null, stack: [] });
  });
});

describe("park / unpark / prune (Phase 5)", () => {
  it("parks with optional trimmed reason, re-park replaces the entry", () => {
    let parked = parkStudy([], 5, "  call referrer  ", 1000);
    expect(parked).toEqual([{ id: 5, reason: "call referrer", parkedAt: 1000 }]);
    parked = parkStudy(parked, 5, "", 2000);
    expect(parked).toEqual([{ id: 5, reason: null, parkedAt: 2000 }]);
    expect(unparkStudy(parked, 5)).toEqual([]);
    expect(isStudyParked(5, parked)).toBe(true);
  });

  it("prunes parked entries that left the queue or completed", () => {
    const parked: ParkedStudy[] = [
      { id: 1, reason: null, parkedAt: 1 },
      { id: 2, reason: null, parkedAt: 2 },
      { id: 99, reason: null, parkedAt: 3 },
    ];
    const queue = [study(1), study(2, { status: "REPORT_FINAL" })];
    expect(pruneParked(parked, queue, new Set())).toEqual([{ id: 1, reason: null, parkedAt: 1 }]);
    // session completion also prunes
    expect(pruneParked(parked, [study(1), study(2)], new Set([1]))).toEqual([{ id: 2, reason: null, parkedAt: 2 }]);
  });

  it("parseParked tolerates corrupt and legacy payloads", () => {
    expect(parseParked(null)).toEqual([]);
    expect(parseParked("not json")).toEqual([]);
    expect(parseParked('{"a":1}')).toEqual([]);
    expect(parseParked('[{"id":3,"reason":"x","parkedAt":9},{"id":"junk"},null,{"id":-1}]'))
      .toEqual([{ id: 3, reason: "x", parkedAt: 9 }]);
  });
});

describe("canLeaveStudy (Phase 3/7 transition gate)", () => {
  const base = { dirty: false, saving: false, finalizing: false, viewerLaunching: false, transitioning: false };

  it("clean + idle → ok", () => {
    expect(canLeaveStudy(base)).toEqual({ kind: "ok" });
  });

  it("busy states BLOCK (save, finalize, viewer launch, transition)", () => {
    expect(canLeaveStudy({ ...base, saving: true }).kind).toBe("blocked");
    expect(canLeaveStudy({ ...base, finalizing: true }).kind).toBe("blocked");
    expect(canLeaveStudy({ ...base, viewerLaunching: true }).kind).toBe("blocked");
    expect(canLeaveStudy({ ...base, transitioning: true }).kind).toBe("blocked");
  });

  it("dirty requires explicit confirmation; busy wins over dirty", () => {
    expect(canLeaveStudy({ ...base, dirty: true })).toEqual({
      kind: "confirm",
      reason: "This report has unsaved changes. Leave without saving?",
    });
    expect(canLeaveStudy({ ...base, dirty: true, saving: true }).kind).toBe("blocked");
  });
});
