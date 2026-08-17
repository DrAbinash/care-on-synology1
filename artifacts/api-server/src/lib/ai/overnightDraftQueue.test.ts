import { describe, expect, it } from "vitest";
import { pickLatestJobByUid, queuePositionsByJobId, overnightIdempotencyKey } from "./overnightDraftQueue";

function job(partial: Partial<{
  id: number; status: string; uid: string; createdAt: Date | null;
  startedAt: Date | null; completedAt: Date | null; lastAttemptedAt: Date | null;
  retryCount: number; failureReason: string | null; lockedAt: Date | null; lockedBy: string | null;
}>) {
  return {
    id: 1, status: "pending", uid: "1.2.3", createdAt: new Date(), startedAt: null,
    completedAt: null, lastAttemptedAt: null, retryCount: 0, failureReason: null,
    lockedAt: null, lockedBy: null, ...partial,
  };
}

describe("overnight draft queue helpers", () => {
  it("uses a stable overnight idempotency key (no Date.now)", () => {
    expect(overnightIdempotencyKey("1.2.840.x")).toBe("ai:shadow:1.2.840.x:overnight");
  });

  it("prefers running over pending over success for the same UID", () => {
    const map = pickLatestJobByUid([
      job({ id: 1, uid: "a", status: "success" }),
      job({ id: 2, uid: "a", status: "pending" }),
      job({ id: 3, uid: "a", status: "running" }),
      job({ id: 9, uid: "b", status: "abandoned" }),
    ]);
    expect(map.get("a")?.jobId).toBe(3);
    expect(map.get("a")?.jobStatus).toBe("running");
    expect(map.get("b")?.jobStatus).toBe("abandoned");
  });

  it("assigns FIFO queue position by job id among pending/retrying", () => {
    const pos = queuePositionsByJobId([
      job({ id: 10, status: "running" }),
      job({ id: 12, status: "pending", uid: "q2" }),
      job({ id: 11, status: "retrying", uid: "q1" }),
      job({ id: 13, status: "success", uid: "done" }),
    ]);
    expect(pos.get(11)).toBe(1);
    expect(pos.get(12)).toBe(2);
    expect(pos.has(10)).toBe(false);
  });
});
