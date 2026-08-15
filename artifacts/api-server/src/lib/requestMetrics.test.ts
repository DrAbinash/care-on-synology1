import { describe, expect, test, beforeEach } from "vitest";
import {
  recordRequest,
  resetMetrics,
  percentileNearestRank,
  summarizeDurations,
  getLatencyForMatcher,
  isBillSavePath,
  isPatientSearchPath,
  getRequestsPerMinute,
  getSlowEndpointsInWindow,
} from "./requestMetrics";

describe("requestMetrics percentiles", () => {
  beforeEach(() => resetMetrics());

  test("percentileNearestRank uses nearest-rank", () => {
    expect(percentileNearestRank([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentileNearestRank([10, 20, 30, 40, 50], 95)).toBe(50);
    expect(percentileNearestRank([], 50)).toBeNull();
  });

  test("summarizeDurations reports p50/p95/max/slow", () => {
    const s = summarizeDurations([100, 200, 1500, 300, 400]);
    expect(s.count).toBe(5);
    expect(s.slowCount).toBe(1);
    expect(s.p50Ms).toBe(300);
    expect(s.maxMs).toBe(1500);
    expect(s.p95Ms).toBe(1500);
  });

  test("bill save and patient search matchers", () => {
    expect(isBillSavePath("POST", "/bills")).toBe(true);
    expect(isBillSavePath("POST", "/bills/12/pay")).toBe(false);
    expect(isBillSavePath("GET", "/bills")).toBe(false);
    expect(isPatientSearchPath("GET", "/patients")).toBe(true);
    expect(isPatientSearchPath("GET", "/patients/:id")).toBe(false);
  });

  test("windowed latency and rpm from recent buffer", () => {
    recordRequest({ method: "POST", path: "/bills", statusCode: 200, durationMs: 120, role: "admin" });
    recordRequest({ method: "POST", path: "/bills", statusCode: 200, durationMs: 1800, role: "admin" });
    recordRequest({ method: "GET", path: "/patients", statusCode: 200, durationMs: 80, role: "admin" });
    recordRequest({ method: "GET", path: "/healthz", statusCode: 200, durationMs: 5, role: "anonymous" });

    const bill = getLatencyForMatcher(isBillSavePath, 15 * 60_000);
    expect(bill.count).toBe(2);
    expect(bill.slowCount).toBe(1);
    expect(bill.maxMs).toBe(1800);

    expect(getRequestsPerMinute()).toBe(4);

    const slow = getSlowEndpointsInWindow(15 * 60_000, 5);
    expect(slow.some((e) => e.path === "/bills" && e.slowCount >= 1)).toBe(true);
  });
});
