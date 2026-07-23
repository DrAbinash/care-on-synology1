import { describe, expect, test } from "vitest";
import { severityForValue, evaluateMetric, evaluateMetrics } from "./opsAnomalyDetectors";

describe("severityForValue", () => {
  test("critical / high / null bands", () => {
    expect(severityForValue(120, 50, 100)).toBe("critical");
    expect(severityForValue(100, 50, 100)).toBe("critical");
    expect(severityForValue(60, 50, 100)).toBe("high");
    expect(severityForValue(50, 50, 100)).toBe("high");
    expect(severityForValue(49, 50, 100)).toBeNull();
    expect(severityForValue(0, 50, 100)).toBeNull();
  });
  test("non-finite values never alert (treated as no-data, not critical)", () => {
    expect(severityForValue(NaN, 50, 100)).toBeNull();
    expect(severityForValue(Infinity, 50, 100)).toBeNull();
  });
});

describe("evaluateMetric", () => {
  test("healthy metric → null", () => {
    expect(evaluateMetric({ alertType: "BACKLOG_SPIKE", scope: "reports", label: "Pending", value: 10, warnAt: 50, critAt: 100 })).toBeNull();
  });
  test("breaching metric → candidate with message + severity", () => {
    const c = evaluateMetric({ alertType: "BACKLOG_SPIKE", scope: "reports", label: "Pending reports", value: 130, warnAt: 50, critAt: 100, unit: "reports" });
    expect(c).not.toBeNull();
    expect(c!.severity).toBe("critical");
    expect(c!.alertType).toBe("BACKLOG_SPIKE");
    expect(c!.scope).toBe("reports");
    expect(c!.message).toContain("130");
  });
});

describe("evaluateMetrics", () => {
  test("keeps only breaching metrics", () => {
    const out = evaluateMetrics([
      { alertType: "A", scope: "s", label: "A", value: 5, warnAt: 10, critAt: 20 },
      { alertType: "B", scope: "s", label: "B", value: 15, warnAt: 10, critAt: 20 },
      { alertType: "C", scope: "s", label: "C", value: 25, warnAt: 10, critAt: 20 },
    ]);
    expect(out.map((c) => c.alertType)).toEqual(["B", "C"]);
    expect(out.map((c) => c.severity)).toEqual(["high", "critical"]);
  });
});
