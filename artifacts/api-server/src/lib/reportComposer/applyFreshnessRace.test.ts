import { describe, expect, it } from "vitest";
import { isComposeJobStale } from "./snapshot";

describe("compose Apply freshness race (READY → edit → Apply)", () => {
  it("flags stale when live reportRevision diverges after READY", () => {
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: "rev-a",
      storedFindingsHash: "f-a",
      storedImpressionHash: "i-a",
      storedInputHash: "in-a",
      current: {
        findingsHash: "f-b",
        impressionHash: "i-a",
        reportRevision: "rev-b",
        inputHash: "in-a",
      },
    });
    expect(stale).toBe(true);
  });

  it("stays fresh when live hashes match enqueue snapshot", () => {
    const { stale } = isComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: "rev-a",
      storedFindingsHash: "f-a",
      storedImpressionHash: "i-a",
      storedInputHash: "in-a",
      current: {
        findingsHash: "f-a",
        impressionHash: "i-a",
        reportRevision: "rev-a",
        inputHash: "in-a",
      },
    });
    expect(stale).toBe(false);
  });
});
