import { describe, expect, test } from "vitest";
import { severityForValue, evaluateMetric, evaluateMetrics, hoursSince, evaluateUnmeasured, reliabilityCandidates, DEFAULT_OPS_THRESHOLDS } from "./opsAnomalyDetectors";

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

const NOW = new Date("2026-10-15T12:00:00.000Z");

describe("hoursSince", () => {
  test("measures elapsed hours from a Date or an ISO string", () => {
    expect(hoursSince(new Date("2026-10-15T09:00:00.000Z"), NOW)).toBe(3);
    expect(hoursSince("2026-10-15T10:30:00.000Z", NOW)).toBe(1.5);
  });
  test("clamps the future to zero instead of going negative", () => {
    // A clock-skewed box would otherwise produce a negative age, and a negative
    // age beats every upper-bound threshold — the backup looks infinitely fresh.
    expect(hoursSince(new Date("2026-10-16T00:00:00.000Z"), NOW)).toBe(0);
  });
  test("returns null for every shape of \"there is no timestamp\"", () => {
    // null is not 0. `0` means "it just happened"; null means nothing has happened.
    expect(hoursSince(null, NOW)).toBeNull();
    expect(hoursSince(undefined, NOW)).toBeNull();
    expect(hoursSince("", NOW)).toBeNull();
    expect(hoursSince("not a date", NOW)).toBeNull();
    expect(hoursSince(new Date("nonsense"), NOW)).toBeNull();
  });
});

describe("evaluateUnmeasured", () => {
  test("an unmeasured metric is critical and says it was not assumed healthy", () => {
    const c = evaluateUnmeasured({ alertType: "BACKUP_STALE", scope: "backup", label: "Last backup", reason: "backup_logs is empty" });
    expect(c.severity).toBe("critical");
    expect(c.alertType).toBe("BACKUP_STALE");
    expect(c.scope).toBe("backup");
    expect(c.message).toContain("could not be measured");
    expect(c.message).toContain("backup_logs is empty");
    expect(c.message).toContain("not assumed healthy");
  });
});

describe("reliabilityCandidates (I12-G)", () => {
  test("healthy readings raise nothing", () => {
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 0, backupAgeHours: 4 })).toEqual([]);
  });
  test("a dead letter alerts on the first one, and escalates at ten", () => {
    expect(reliabilityCandidates({ deadLetters: 1, outboxStalledHours: 0, backupAgeHours: 4 })
      .map((c) => [c.alertType, c.severity])).toEqual([["INTEGRATION_DEAD_LETTER", "high"]]);
    expect(reliabilityCandidates({ deadLetters: 12, outboxStalledHours: 0, backupAgeHours: 4 })[0].severity).toBe("critical");
  });
  test("an event overdue past its backoff alerts by age, not by count", () => {
    // The outbox retries for ~64 minutes on its own budget; six hours of waiting
    // means no worker has touched it, which is #995's abandoned-`sending` shape.
    const seven = reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 7, backupAgeHours: 4 });
    expect(seven[0].alertType).toBe("INTEGRATION_OUTBOX_STALLED");
    expect(seven[0].severity).toBe("high");
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 30, backupAgeHours: 4 })[0].severity).toBe("critical");
  });
  test("a stale backup alerts at 26 h and is critical at 48 h, matching the NAS checklist", () => {
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 0, backupAgeHours: 27 })[0].alertType).toBe("BACKUP_STALE");
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 0, backupAgeHours: 27 })[0].severity).toBe("high");
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: 0, backupAgeHours: 49 })[0].severity).toBe("critical");
  });
  test("a missing backup record is NEVER silent — no row is not a fresh backup", () => {
    const out = reliabilityCandidates({ deadLetters: 3, outboxStalledHours: 0, backupAgeHours: null });
    const stale = out.find((c) => c.alertType === "BACKUP_STALE");
    expect(stale).toBeDefined();
    expect(stale!.severity).toBe("critical");
    expect(out.some((c) => c.alertType === "INTEGRATION_DEAD_LETTER")).toBe(true);
  });
  test("an unreadable dead-letter count reports itself instead of disappearing", () => {
    const out = reliabilityCandidates({ deadLetters: null, outboxStalledHours: 0, backupAgeHours: 2 });
    expect(out).toHaveLength(1);
    expect(out[0].alertType).toBe("INTEGRATION_DEAD_LETTER");
    expect(out[0].severity).toBe("critical");
  });
  test("an empty outbox is legitimately not stalled", () => {
    // min() over no rows yields null; reading that as "critical, nothing moving"
    // would page the clinic over a queue that is simply empty.
    expect(reliabilityCandidates({ deadLetters: 0, outboxStalledHours: null, backupAgeHours: 2 })).toEqual([]);
  });
});

describe("DEFAULT_OPS_THRESHOLDS", () => {
  const entries = Object.entries(DEFAULT_OPS_THRESHOLDS);
  test("every threshold has warnAt below critAt", () => {
    const inverted = entries.filter(([, t]) => !(t.warnAt < t.critAt)).map(([name]) => name);
    expect(inverted).toEqual([]);
  });
  test("no two metrics share the dedupe key the scan uses", () => {
    // runOpsAnomalyScan suppresses a new alert when an open one already exists for
    // the same alertType + scope today. Two metrics on one key would mean the first
    // alert raised hides every later breach of the other, silently.
    const keys = entries.map(([, t]) => `${t.alertType}|${t.scope}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  test("the clinical metrics keep their original thresholds", () => {
    expect(DEFAULT_OPS_THRESHOLDS.pendingReports).toMatchObject({ alertType: "BACKLOG_SPIKE", warnAt: 50, critAt: 120 });
    expect(DEFAULT_OPS_THRESHOLDS.deliveryFailures).toMatchObject({ alertType: "DELIVERY_FAILURE_SPIKE", warnAt: 10, critAt: 30 });
    expect(DEFAULT_OPS_THRESHOLDS.overdueRecalls).toMatchObject({ alertType: "RECALL_BACKLOG", warnAt: 40, critAt: 100 });
  });
});
