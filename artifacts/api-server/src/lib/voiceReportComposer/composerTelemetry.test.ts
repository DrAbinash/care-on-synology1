/**
 * Eviction telemetry for the Smart Dictation composer.
 *
 * `keep_alive:"30m"` keeps qwen3:14b resident, but the pin dies the moment
 * another model (vision, medgemma) needs the GPU — the next dictation then
 * pays the 19.4 s reload ON TOP of compose time (measured 55.7 s vs ~35 s
 * warm; docs/smart-dictation-deployment-recommendations.md). The radiologist
 * experiences this as a mysterious one-off slowdown; the operator should see
 * it named in the logs the moment it happens, with the cause (model reload)
 * and the fix (expect it when vision runs; do not chase the composer).
 *
 * The heuristic is deliberately conservative: it needs a warm baseline
 * (>= 5 prior samples), a stable median (<= 40 s), and a current latency at
 * least 20 s AND 1.6x above that median. Warm-run jitter (a few seconds)
 * can never trip it.
 */
import { describe, expect, it } from "vitest";
import { evictionHeuristic, medianOf } from "./composerTelemetry";

describe("medianOf", () => {
  it("returns the middle value for odd counts", () => {
    expect(medianOf([30, 20, 40])).toBe(30);
  });

  it("returns the average of the middle pair for even counts", () => {
    expect(medianOf([20, 30, 40, 50])).toBe(35);
  });

  it("handles a single sample", () => {
    expect(medianOf([35])).toBe(35);
  });
});

describe("evictionHeuristic", () => {
  const warm = [34_000, 36_000, 35_000, 33_000, 35_500];

  it("needs a warm baseline — fewer than 5 samples never suspects", () => {
    expect(evictionHeuristic([34_000, 36_000, 35_000], 60_000).suspected).toBe(false);
  });

  it("does not suspect when the median is already slow (baseline is cold, not evicted)", () => {
    const slow = [55_000, 58_000, 56_000, 57_000, 56_500];
    expect(evictionHeuristic(slow, 60_000).suspected).toBe(false);
  });

  it("suspects eviction at 58 s against a 35 s warm baseline (the measured signature)", () => {
    const r = evictionHeuristic(warm, 58_000);
    expect(r.suspected).toBe(true);
    expect(r.median).toBe(35_000);
  });

  it("warm-run jitter never suspects", () => {
    expect(evictionHeuristic(warm, 40_000).suspected).toBe(false);
    expect(evictionHeuristic(warm, 38_000).suspected).toBe(false);
  });

  it("a jump above the +20 s floor but below 1.6x the median does not suspect", () => {
    // median 30 s: +21 s passes the floor, 1.6x = 48 s, 51 s qualifies — 45 s does not.
    const baseline = [29_000, 31_000, 30_000, 30_500, 30_000];
    expect(evictionHeuristic(baseline, 45_000).suspected).toBe(false);
    expect(evictionHeuristic(baseline, 51_000).suspected).toBe(true);
  });
});
