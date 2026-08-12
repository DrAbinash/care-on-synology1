import { describe, it, expect } from "vitest";
import { inWindow, decideScheduling, admitJob, type SchedulerConfig, type SchedulingInput } from "./aiScheduler";

const cfg: SchedulerConfig = {
  nightStart: "23:00", nightEnd: "06:00", quietStart: "08:00", quietEnd: "20:00",
  maxConcurrentJobs: 2, gpuLimitPercent: 90, cpuLimitPercent: 80,
  skipFinalizedReports: true, skipUnchangedStudies: true,
};
const M = (h: number, m = 0) => h * 60 + m;
const inp = (o: Partial<SchedulingInput> = {}): SchedulingInput => ({ modalityMode: "immediate", priority: "routine", nowMinutes: M(13), isFinalized: false, isUnchanged: false, ...o });

describe("scheduler time windows (G10)", () => {
  it("handles a night window that wraps past midnight", () => {
    expect(inWindow(M(23, 30), "23:00", "06:00")).toBe(true);
    expect(inWindow(M(2), "23:00", "06:00")).toBe(true);
    expect(inWindow(M(12), "23:00", "06:00")).toBe(false);
  });
  it("handles a daytime quiet window", () => {
    expect(inWindow(M(13), "08:00", "20:00")).toBe(true);
    expect(inWindow(M(22), "08:00", "20:00")).toBe(false);
  });
});

describe("scheduler decisions across modes (G10)", () => {
  it("on-demand/manual requests always enqueue immediately", () => {
    expect(decideScheduling(inp({ manualRequest: true, modalityMode: "disabled" }), cfg)).toMatchObject({ enqueue: true, mode: "immediate" });
  });
  it("skips finalized and unchanged studies", () => {
    expect(decideScheduling(inp({ isFinalized: true }), cfg).enqueue).toBe(false);
    expect(decideScheduling(inp({ isUnchanged: true }), cfg).enqueue).toBe(false);
  });
  it("disabled and manual-only modalities never auto-enqueue", () => {
    expect(decideScheduling(inp({ modalityMode: "disabled" }), cfg).enqueue).toBe(false);
    expect(decideScheduling(inp({ modalityMode: "manual" }), cfg).enqueue).toBe(false);
  });
  it("immediate modality enqueues now outside quiet hours", () => {
    expect(decideScheduling(inp({ nowMinutes: M(22) }), cfg)).toMatchObject({ enqueue: true, mode: "immediate" });
  });
  it("defers a routine immediate study during quiet hours to night batch", () => {
    expect(decideScheduling(inp({ nowMinutes: M(13) }), cfg)).toMatchObject({ enqueue: false, mode: "night_batch" });
  });
  it("STAT/emergency runs immediately even during quiet hours", () => {
    expect(decideScheduling(inp({ nowMinutes: M(13), priority: "stat" }), cfg)).toMatchObject({ enqueue: true, mode: "immediate" });
  });
  it("night_batch modality defers outside the night window but enqueues inside it", () => {
    expect(decideScheduling(inp({ modalityMode: "night_batch", nowMinutes: M(22) }), cfg)).toMatchObject({ enqueue: false, mode: "night_batch" });
    expect(decideScheduling(inp({ modalityMode: "night_batch", nowMinutes: M(23, 30) }), cfg)).toMatchObject({ enqueue: true, mode: "night_batch" });
    expect(decideScheduling(inp({ modalityMode: "night_batch", nowMinutes: M(2) }), cfg)).toMatchObject({ enqueue: true, mode: "night_batch" });
    expect(decideScheduling(inp({ modalityMode: "night_batch", priority: "emergency" }), cfg)).toMatchObject({ enqueue: true, mode: "immediate" });
  });
});

describe("scheduler admission control (G10)", () => {
  it("refuses past max concurrency", () => {
    expect(admitJob({ runningJobs: 2 }, cfg).admit).toBe(false);
    expect(admitJob({ runningJobs: 1 }, cfg).admit).toBe(true);
  });
  it("refuses past GPU/CPU ceilings when metrics are supplied", () => {
    expect(admitJob({ runningJobs: 0, gpuPercent: 95 }, cfg).admit).toBe(false);
    expect(admitJob({ runningJobs: 0, cpuPercent: 85 }, cfg).admit).toBe(false);
    expect(admitJob({ runningJobs: 0, gpuPercent: 50, cpuPercent: 50 }, cfg).admit).toBe(true);
  });
});
