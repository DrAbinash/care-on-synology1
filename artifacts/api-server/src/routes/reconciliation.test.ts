import { describe, expect, test, vi } from "vitest";

// reconciliation.ts (and its transitive imports books-sanity / requireStaffAuth)
// import `db` from @workspace/db at module top level, which throws at import
// time when DATABASE_URL is unset. The functions under test here
// (summarizeReconciliation, normSeverity) are pure — they never touch the
// database — so mocking the module prevents the load-time throw without
// affecting what is under test. Same pattern as day-close.test.ts.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  portalSessionsTable: {},
  usersTable: {},
  clinicSettingsTable: {},
}));

import { summarizeReconciliation, normSeverity, type ReconExceptionGroup } from "./reconciliation";

function group(partial: Partial<ReconExceptionGroup>): ReconExceptionGroup {
  return {
    key: "k",
    source: "Test",
    category: "c",
    severity: "low",
    count: 0,
    totalAmount: 0,
    description: "",
    rows: [],
    ...partial,
  };
}

describe("normSeverity", () => {
  test("maps fraud 'critical' up to 'high'", () => {
    expect(normSeverity("critical")).toBe("high");
  });
  test("passes through high/medium/low", () => {
    expect(normSeverity("high")).toBe("high");
    expect(normSeverity("medium")).toBe("medium");
    expect(normSeverity("low")).toBe("low");
  });
  test("unknown / blank falls back to 'low' (never silently high)", () => {
    expect(normSeverity("")).toBe("low");
    expect(normSeverity(null)).toBe("low");
    expect(normSeverity("weird")).toBe("low");
  });
});

describe("summarizeReconciliation", () => {
  test("empty input → all zeros", () => {
    expect(summarizeReconciliation([])).toEqual({
      totalExceptions: 0, groups: 0, high: 0, medium: 0, low: 0, totalAmountAtRisk: 0,
    });
  });

  test("counts exceptions (sum of row counts) and group severities separately", () => {
    const s = summarizeReconciliation([
      group({ severity: "high", count: 3, totalAmount: 1000 }),
      group({ severity: "high", count: 2, totalAmount: 500 }),
      group({ severity: "medium", count: 5, totalAmount: 250 }),
      group({ severity: "low", count: 10, totalAmount: 0 }),
    ]);
    expect(s.totalExceptions).toBe(20); // 3+2+5+10 flagged rows
    expect(s.groups).toBe(4);
    expect(s.high).toBe(2);
    expect(s.medium).toBe(1);
    expect(s.low).toBe(1);
    expect(s.totalAmountAtRisk).toBe(1750);
  });
});
