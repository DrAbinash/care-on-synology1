// deriveMilestone is pure but lives in a module that imports `db` at top level;
// set a dummy DATABASE_URL and dynamic-import so lib/db's guard passes without a
// real database (the pg Pool is created lazily and never queried here).
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test_integration";

let deriveMilestone: typeof import("./statusReconciler").deriveMilestone;
beforeAll(async () => { deriveMilestone = (await import("./statusReconciler")).deriveMilestone; });

describe("deriveMilestone (pathology sample + radiology study progress)", () => {
  it("no activity → no milestone", () => {
    const m = deriveMilestone([], []);
    expect(m).toEqual({ sampleCollected: false, studyScheduled: false, studyPerformed: false, headerTarget: null });
  });

  it("a collected sample → SAMPLE_COLLECTED", () => {
    const m = deriveMilestone(["collected"], []);
    expect(m.sampleCollected).toBe(true);
    expect(m.headerTarget).toBe("SAMPLE_COLLECTED");
  });

  it("a sample in processing → IN_PROGRESS (past mere collection)", () => {
    expect(deriveMilestone(["in_processing"], []).headerTarget).toBe("IN_PROGRESS");
  });

  it("a scheduled study (nothing collected) → STUDY_SCHEDULED", () => {
    const m = deriveMilestone([], ["scheduled"]);
    expect(m.studyScheduled).toBe(true);
    expect(m.studyPerformed).toBe(false);
    expect(m.headerTarget).toBe("STUDY_SCHEDULED");
  });

  it("a performed study (acquired/reported) → IN_PROGRESS", () => {
    expect(deriveMilestone([], ["acquired"]).headerTarget).toBe("IN_PROGRESS");
    expect(deriveMilestone([], ["reported_final"]).studyPerformed).toBe(true);
  });

  it("a rejected sample alone is NOT collection", () => {
    expect(deriveMilestone(["rejected"], []).sampleCollected).toBe(false);
    expect(deriveMilestone(["rejected"], []).headerTarget).toBe(null);
  });

  it("collected sample + scheduled study → SAMPLE_COLLECTED (collection outranks scheduling)", () => {
    expect(deriveMilestone(["collected"], ["scheduled"]).headerTarget).toBe("SAMPLE_COLLECTED");
  });
});
