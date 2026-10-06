/**
 * The guard's failure posture is FAIL CLOSED.
 *
 * "No AI jobs" and "I could not look at the AI jobs" are different clinical
 * statements and must never produce the same answer. A 503 costs the
 * radiologist one retry; signing a draft nobody reviewed cannot be unsent.
 * This is also cheap in availability terms: the same Postgres serves the report
 * write, so if it is genuinely down, finalize was going to fail anyway.
 *
 * Case D of the follow-up brief, and the counterpart to
 * patient-reports.unreviewedAi.test.ts (which proves the route honours it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; status: string; trackedChangesJson: string | null }>,
  failWith: null as string | null,
  failAt: "limit" as "limit" | "where",
  select: vi.fn(),
}));

function chain() {
  return {
    from: () => ({
      where: () => {
        if (h.failAt === "where" && h.failWith) throw new Error(h.failWith);
        return {
          orderBy: () => ({
            limit: async () => {
              if (h.failWith) throw new Error(h.failWith);
              return h.rows;
            },
          }),
        };
      },
    }),
  };
}

vi.mock("@workspace/db", () => ({
  db: { select: (...a: unknown[]) => h.select(...a) ?? chain() },
}));
vi.mock("@workspace/db/schema", () => ({
  aiReportComposeJobsTable: {
    id: "id",
    worklistId: "worklist_id",
    studyId: "study_id",
    reportId: "report_id",
    status: "status",
    trackedChangesJson: "tracked_changes_json",
    updatedAt: "updated_at",
  },
}));
vi.mock("../logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  aiReviewStateUnavailableError,
  checkUnreviewedAiFinalize,
  findUnreviewedAiDraft,
} from "./unreviewedAiGuard";
import { logger } from "../logger";

const pendingJson = JSON.stringify([{ id: "c1", reviewState: "PENDING" }]);
const reviewedJson = JSON.stringify([
  { id: "c1", reviewState: "ACCEPTED" },
  { id: "c2", reviewState: "REJECTED" },
]);

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.failWith = null;
  h.failAt = "limit";
});

describe("A+B+C — the guard answers what it actually found", () => {
  it("A. no AI jobs at all → clear, finalize allowed", async () => {
    h.rows = [];
    expect(await checkUnreviewedAiFinalize({ worklistId: 9 })).toEqual({ state: "clear" });
  });

  it("B. AI jobs that are fully reviewed → clear", async () => {
    h.rows = [{ id: 1, status: "READY", trackedChangesJson: reviewedJson }];
    expect(await checkUnreviewedAiFinalize({ worklistId: 9 })).toEqual({ state: "clear" });
  });

  it("C. an unreviewed proposal → unreviewed, with the numbers the UI needs", async () => {
    h.rows = [{ id: 44, status: "READY", trackedChangesJson: pendingJson }];
    expect(await checkUnreviewedAiFinalize({ worklistId: 9 })).toEqual({
      state: "unreviewed",
      draft: { jobId: 44, status: "READY", pendingChangeCount: 1 },
    });
  });
});

describe("D — a failed check is never reported as a clear one", () => {
  it("database unreachable → unknown, not clear", async () => {
    h.failWith = "connection terminated unexpectedly";
    const res = await checkUnreviewedAiFinalize({ worklistId: 9, studyId: 9 });
    expect(res).toEqual({ state: "unknown", reason: "query_failed" });
    expect(res.state).not.toBe("clear");
  });

  it("a query error thrown while building the filter also fails closed", async () => {
    h.failAt = "where";
    h.failWith = "current transaction is aborted";
    expect(await checkUnreviewedAiFinalize({ studyId: 9 })).toEqual({
      state: "unknown",
      reason: "query_failed",
    });
  });

  it("the underlying finder no longer swallows the error", async () => {
    h.failWith = "connection terminated unexpectedly";
    await expect(findUnreviewedAiDraft({ worklistId: 9 })).rejects.toThrow(
      /connection terminated/,
    );
  });

  it("logs at error level with the refs, because a blocked finalize must be explainable", async () => {
    h.failWith = "connection terminated unexpectedly";
    await checkUnreviewedAiFinalize({ worklistId: 9, reportId: 3 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const calls = (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const [payload, msg] = calls[0] as [Record<string, unknown>, string];
    expect(payload.refs).toEqual({ worklistId: 9, reportId: 3 });
    expect(String(msg)).toMatch(/fail closed/i);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a malformed review payload on one row does not throw — that row simply is not actionable", async () => {
    h.rows = [{ id: 7, status: "READY", trackedChangesJson: "{not json" }];
    expect(await checkUnreviewedAiFinalize({ worklistId: 9 })).toEqual({ state: "clear" });
  });
});

describe("the two refusals are not conflated", () => {
  it("no study reference means no job can belong to it → clear, and nothing is queried", async () => {
    expect(await checkUnreviewedAiFinalize({})).toEqual({ state: "clear" });
    expect(h.select).not.toHaveBeenCalled();
  });

  it("the 503 payload says nothing was changed and to retry, and is a different code from the 409", () => {
    const e = aiReviewStateUnavailableError();
    expect(e.error).toBe("ai_review_state_unavailable");
    expect(e.retryable).toBe(true);
    expect(e.message).toMatch(/NOT finalized/i);
    expect(e.message).toMatch(/nothing was changed/i);
    expect(e.message).toMatch(/try again/i);
    expect(e.error).not.toBe("unreviewed_ai_compose_changes");
  });
});
