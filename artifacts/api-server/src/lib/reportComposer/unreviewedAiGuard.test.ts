/**
 * The server-side unreviewed-AI finalize guard, in the shapes the clinic will
 * actually see. Cases A-G of the brief; the real-database scoping proof lives in
 * unreviewedAiGuard.scoped.request.test.ts (skipped when no DATABASE_URL).
 */
import { describe, it, expect } from "vitest";
import {
  UNREVIEWED_AI_JOB_STATUSES,
  firstUnreviewedJob,
  unreviewedAiFinalizeError,
} from "./unreviewedAiGuard";

type JobRow = { id: number; status: string; trackedChangesJson: string | null };

function change(reviewState: string, clinical = false) {
  return {
    id: `c-${reviewState}-${Math.random().toString(36).slice(2, 7)}`,
    source: "AI_COMPOSER",
    changeType: "REPLACE",
    field: "FINDINGS",
    originalText: "original",
    proposedText: "proposed",
    reviewState,
    clinicalSignificance: clinical,
    clinicalSignificanceReasons: [],
    createdAt: new Date().toISOString(),
  };
}

function job(id: number, status: string, changes: unknown[] | string | null): JobRow {
  return {
    id,
    status,
    trackedChangesJson: typeof changes === "string" || changes === null ? changes : JSON.stringify(changes),
  };
}

describe("A. no AI job at all", () => {
  it("nothing to review, nothing blocked", () => {
    expect(firstUnreviewedJob([])).toBeNull();
  });

  it("a READY job whose draft produced no tracked changes does not block", () => {
    expect(firstUnreviewedJob([job(1, "READY", [])])).toBeNull();
  });
});

describe("B and C. READY / STALE_READY with unresolved changes", () => {
  it("READY + one PENDING change blocks, and names the job", () => {
    const rows = [job(77, "READY", [change("PENDING")])];
    expect(firstUnreviewedJob(rows)).toEqual({
      jobId: 77,
      status: "READY",
      pendingChangeCount: 1,
    });
  });

  it("STALE_READY + several PENDING changes blocks with the count", () => {
    const rows = [job(88, "STALE_READY", [change("PENDING"), change("PENDING", true), change("PENDING")])];
    const hit = firstUnreviewedJob(rows);
    expect(hit?.jobId).toBe(88);
    expect(hit?.pendingChangeCount).toBe(3);
  });

  it("a mix of reviewed and unreviewed still blocks on the unreviewed remainder", () => {
    const rows = [job(9, "READY", [change("ACCEPTED"), change("REJECTED"), change("PENDING")])];
    expect(firstUnreviewedJob(rows)?.pendingChangeCount).toBe(1);
  });

  it("only the two reviewable statuses count", () => {
    expect(UNREVIEWED_AI_JOB_STATUSES).toEqual(["READY", "STALE_READY"]);
  });
});

describe("D and E. reviewed and historical jobs never block", () => {
  it("all ACCEPTED / EDITED / REJECTED → allowed", () => {
    const rows = [job(5, "READY", [change("ACCEPTED"), change("EDITED"), change("REJECTED")])];
    expect(firstUnreviewedJob(rows)).toBeNull();
  });

  it("APPLIED jobs are history and never block a sign", () => {
    const rows = [job(6, "APPLIED", [change("PENDING")])];
    expect(firstUnreviewedJob(rows)).toBeNull();
  });

  for (const status of ["QUEUED", "COMPOSING", "FAILED", "DISCARDED", "OBSOLETE", "CANCELLED"]) {
    it(`${status} jobs have no actionable review and never block`, () => {
      expect(firstUnreviewedJob([job(7, status, [change("PENDING")])])).toBeNull();
    });
  }

  it("the newest actionable job wins when several exist", () => {
    const rows = [job(2, "READY", [change("PENDING")]), job(1, "STALE_READY", [change("PENDING")])];
    expect(firstUnreviewedJob(rows)?.jobId).toBe(2);
  });
});

describe("unparseable review state", () => {
  it("is treated as nothing reviewable, exactly like the review panel", () => {
    expect(firstUnreviewedJob([job(3, "READY", "not json")])).toBeNull();
    expect(firstUnreviewedJob([job(4, "READY", null)])).toBeNull();
  });
});

describe("the typed rejection the routes return", () => {
  it("carries a stable code, a radiologist-readable message, and the numbers", () => {
    const payload = unreviewedAiFinalizeError({ jobId: 77, status: "READY", pendingChangeCount: 2 });
    expect(payload.error).toBe("unreviewed_ai_compose_changes");
    expect(payload.jobId).toBe(77);
    expect(payload.pendingChangeCount).toBe(2);
    expect(payload.message).toMatch(/2 AI suggestion\(s\)/);
    expect(payload.message).toMatch(/Review|Reject/);
    expect(payload.message).toMatch(/finalize again/);
  });
});
