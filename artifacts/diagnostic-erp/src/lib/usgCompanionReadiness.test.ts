import { describe, it, expect } from "vitest";
import { computeReadinessScore, buildCompanionTimeline } from "./usgCompanionReadiness";

describe("computeReadinessScore (pure workflow completeness)", () => {
  it("is 100 when every axis is complete", () => {
    const r = computeReadinessScore({
      measurementsExpected: 8, measurementsFound: 8,
      templateSelected: true, protocolSelected: true, historyPresent: true,
      quickFindingsSelected: true, copilotClear: true,
    });
    expect(r.score).toBe(100);
    expect(r.axes.every((a) => a.done)).toBe(true);
  });

  it("is 0 when nothing is done and measurements are expected", () => {
    const r = computeReadinessScore({
      measurementsExpected: 6, measurementsFound: 0,
      templateSelected: false, protocolSelected: false, historyPresent: false,
      quickFindingsSelected: false, copilotClear: false,
    });
    expect(r.score).toBe(0);
  });

  it("gives proportional credit for partial measurements", () => {
    const r = computeReadinessScore({
      measurementsExpected: 10, measurementsFound: 5,
      templateSelected: false, protocolSelected: false, historyPresent: false,
      quickFindingsSelected: false, copilotClear: false,
    });
    // 5/10 of the 25-point measurement axis.
    expect(r.axes.find((a) => a.key === "measurements")?.earned).toBe(13); // round(12.5)
    expect(r.score).toBe(13);
  });

  it("does not penalise study types with no auto-measurements (thyroid/breast)", () => {
    const r = computeReadinessScore({
      measurementsExpected: 0, measurementsFound: 0,
      templateSelected: true, protocolSelected: false, historyPresent: false,
      quickFindingsSelected: false, copilotClear: false,
    });
    const meas = r.axes.find((a) => a.key === "measurements");
    expect(meas?.earned).toBe(25);
    expect(meas?.done).toBe(true);
    // 25 (measurements) + 15 (template) = 40
    expect(r.score).toBe(40);
  });

  it("never exceeds 100 when found > expected", () => {
    const r = computeReadinessScore({
      measurementsExpected: 4, measurementsFound: 99,
      templateSelected: true, protocolSelected: true, historyPresent: true,
      quickFindingsSelected: true, copilotClear: true,
    });
    expect(r.score).toBe(100);
  });
});

describe("buildCompanionTimeline", () => {
  it("returns the 7 workflow stages in order with done flags", () => {
    const t = buildCompanionTimeline({
      receivedAt: "2026-07-16T10:00:00Z",
      measurementsImported: true, measurementsAt: "2026-07-16T10:01:00Z",
      templateLoaded: true, protocolLoaded: false, userEdited: true,
      reportSaved: false, reportFinalized: false,
    });
    expect(t.map((s) => s.key)).toEqual([
      "received", "measurements", "template", "protocol", "edited", "saved", "finalized",
    ]);
    expect(t.find((s) => s.key === "received")?.done).toBe(true);
    expect(t.find((s) => s.key === "protocol")?.done).toBe(false);
    expect(t.find((s) => s.key === "finalized")?.done).toBe(false);
  });
});
