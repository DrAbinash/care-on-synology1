import { describe, expect, it } from "vitest";
import {
  buildOvernightDisplay,
  compareOvernightDraftRows,
  deriveOvernightDisplayStatus,
  overnightCountBucket,
  overnightSortRank,
  canCancelOvernightJob,
  canRetryOvernightJob,
} from "./overnightAiDraftStatus";

const NOW = new Date("2026-08-17T12:00:00.000Z");

describe("deriveOvernightDisplayStatus", () => {
  it("maps worklist PENDING + job pending to QUEUED (not PROCESSING)", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "pending",
      lockedAt: null,
      now: NOW,
    })).toBe("QUEUED");
  });

  it("maps claimed running job with a fresh lock to RUNNING", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "running",
      lockedAt: new Date(NOW.getTime() - 2 * 60_000),
      now: NOW,
    })).toBe("RUNNING");
  });

  it("maps running with stale locked_at (no heartbeat) to STUCK", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "running",
      lockedAt: new Date(NOW.getTime() - 11 * 60_000),
      now: NOW,
    })).toBe("STUCK");
  });

  it("maps running without locked_at to STUCK (corrupt claim)", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "running",
      lockedAt: null,
      now: NOW,
    })).toBe("STUCK");
  });

  it("maps retrying to RETRYING", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "retrying",
      lockedAt: null,
      now: NOW,
    })).toBe("RETRYING");
  });

  it("maps READY worklist to READY when no in-flight job", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "READY",
      jobStatus: "success",
      lockedAt: null,
      now: NOW,
    })).toBe("READY");
  });

  it("maps EMPTY / QUARANTINED worklist statuses through", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "EMPTY",
      jobStatus: "success",
      lockedAt: null,
      now: NOW,
    })).toBe("EMPTY");
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "QUARANTINED",
      jobStatus: "success",
      lockedAt: null,
      now: NOW,
    })).toBe("QUARANTINED");
  });

  it("does not invent READY from job=success when worklist is still NONE", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "NONE",
      jobStatus: "success",
      lockedAt: null,
      now: NOW,
    })).toBe("EMPTY");
  });

  it("prefers RUNNING over READY when an in-flight retry exists", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "READY",
      jobStatus: "running",
      lockedAt: new Date(NOW.getTime() - 30_000),
      now: NOW,
    })).toBe("RUNNING");
  });

  it("maps abandoned/failed jobs to ERROR even if worklist stayed PENDING", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: "abandoned",
      lockedAt: null,
      now: NOW,
    })).toBe("ERROR");
  });

  it("maps worklist PENDING with no job row to QUEUED (legacy enqueue mark)", () => {
    expect(deriveOvernightDisplayStatus({
      worklistAiDraftStatus: "PENDING",
      jobStatus: null,
      lockedAt: null,
      now: NOW,
    })).toBe("QUEUED");
  });
});

describe("cancel / retry safety", () => {
  it("allows cancel only for pending/retrying — never running", () => {
    expect(canCancelOvernightJob("pending")).toBe(true);
    expect(canCancelOvernightJob("retrying")).toBe(true);
    expect(canCancelOvernightJob("running")).toBe(false);
    expect(canCancelOvernightJob("success")).toBe(false);
  });

  it("allows retry for ERROR, EMPTY, QUARANTINED — not STUCK or RUNNING", () => {
    expect(canRetryOvernightJob("ERROR")).toBe(true);
    expect(canRetryOvernightJob("EMPTY")).toBe(true);
    expect(canRetryOvernightJob("QUARANTINED")).toBe(true);
    expect(canRetryOvernightJob("STUCK")).toBe(false);
    expect(canRetryOvernightJob("RUNNING")).toBe(false);
    expect(canRetryOvernightJob("QUEUED")).toBe(false);
  });
});

describe("refineDisplayStatusFromAiDraftPointer", () => {
  it("corrects legacy empty READY pointer (draftId 19 shape) to EMPTY", async () => {
    const { refineDisplayStatusFromAiDraftPointer } = await import("./overnightAiDraftStatus");
    expect(refineDisplayStatusFromAiDraftPointer("READY", {
      source: "ai_shadow",
      draftId: 19,
      version: 1,
      findingCount: 0,
      findings: "",
      impression: [],
      updatedAt: "2026-08-20T15:50:05.506Z",
    })).toBe("EMPTY");
  });

  it("maps empty READY with quarantinedCount to QUARANTINED", async () => {
    const { refineDisplayStatusFromAiDraftPointer } = await import("./overnightAiDraftStatus");
    expect(refineDisplayStatusFromAiDraftPointer("READY", {
      findingCount: 0,
      findings: "",
      impression: [],
      quarantinedCount: 3,
    })).toBe("QUARANTINED");
  });
});

describe("overnight display payload", () => {
  it("exposes queue position only for queued/retrying", () => {
    const queued = buildOvernightDisplay({
      worklistAiDraftStatus: "PENDING",
      job: {
        jobId: 12,
        jobStatus: "pending",
        queuedAt: NOW,
        startedAt: null,
        completedAt: null,
        lastAttemptAt: null,
        attemptCount: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
      queuePosition: 4,
      now: NOW,
    });
    expect(queued.displayStatus).toBe("QUEUED");
    expect(queued.queuePosition).toBe(4);
    expect(queued.canCancel).toBe(true);

    const running = buildOvernightDisplay({
      worklistAiDraftStatus: "PENDING",
      job: {
        jobId: 11,
        jobStatus: "running",
        queuedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        lastAttemptAt: NOW,
        attemptCount: 1,
        lastError: null,
        lockedAt: NOW,
        lockedBy: "api-1",
      },
      queuePosition: 1,
      now: NOW,
    });
    expect(running.displayStatus).toBe("RUNNING");
    expect(running.queuePosition).toBeNull();
    expect(running.canCancel).toBe(false);
  });
});

describe("overnight priority sort", () => {
  it("orders RUNNING, READY (newest completed), ERROR, then QUEUED by position", () => {
    const rows = [
      { displayStatus: "QUEUED" as const, completedAt: null, startedAt: null, lastAttemptAt: null, queuePosition: 2, queuedAt: "t", jobId: 20 },
      { displayStatus: "READY" as const, completedAt: "2026-08-17T01:00:00Z", startedAt: null, lastAttemptAt: null, queuePosition: null, queuedAt: null, jobId: 1 },
      { displayStatus: "ERROR" as const, completedAt: null, startedAt: null, lastAttemptAt: "2026-08-17T03:00:00Z", queuePosition: null, queuedAt: null, jobId: 3 },
      { displayStatus: "QUEUED" as const, completedAt: null, startedAt: null, lastAttemptAt: null, queuePosition: 1, queuedAt: "t", jobId: 10 },
      { displayStatus: "READY" as const, completedAt: "2026-08-17T04:00:00Z", startedAt: null, lastAttemptAt: null, queuePosition: null, queuedAt: null, jobId: 2 },
      { displayStatus: "RUNNING" as const, completedAt: null, startedAt: "2026-08-17T05:00:00Z", lastAttemptAt: null, queuePosition: null, queuedAt: null, jobId: 9 },
    ];
    const sorted = [...rows].sort(compareOvernightDraftRows);
    expect(sorted.map((r) => r.displayStatus)).toEqual([
      "RUNNING", "READY", "READY", "ERROR", "QUEUED", "QUEUED",
    ]);
    expect(sorted[1].completedAt).toBe("2026-08-17T04:00:00Z");
    expect(sorted[4].queuePosition).toBe(1);
    expect(sorted[5].queuePosition).toBe(2);
  });

  it("ranks RUNNING before READY before ERROR before QUEUED", () => {
    expect(overnightSortRank("RUNNING")).toBeLessThan(overnightSortRank("READY"));
    expect(overnightSortRank("READY")).toBeLessThan(overnightSortRank("ERROR"));
    expect(overnightSortRank("ERROR")).toBe(overnightSortRank("STUCK"));
    expect(overnightSortRank("ERROR")).toBeLessThan(overnightSortRank("QUEUED"));
    expect(overnightSortRank("QUEUED")).toBe(overnightSortRank("RETRYING"));
  });
});

describe("count buckets", () => {
  it("buckets RETRYING with queued and STUCK with errors", () => {
    expect(overnightCountBucket("QUEUED")).toBe("queued");
    expect(overnightCountBucket("RETRYING")).toBe("queued");
    expect(overnightCountBucket("RUNNING")).toBe("running");
    expect(overnightCountBucket("READY")).toBe("ready");
    expect(overnightCountBucket("ERROR")).toBe("errors");
    expect(overnightCountBucket("STUCK")).toBe("errors");
    expect(overnightCountBucket("NONE")).toBeNull();
  });
});
