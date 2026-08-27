import { describe, expect, test, vi, beforeEach } from "vitest";

const selectResults: unknown[][] = [];

function chainable(limitResult: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => limitResult,
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResults.shift() ?? [],
          }),
        }),
      }),
    }),
  },
  billsTable: {},
  paymentsTable: {},
  userDayClosuresTable: {},
}));

vi.mock("@workspace/db/schema", () => ({
  billsTable: {},
  paymentsTable: {},
  userDayClosuresTable: {},
}));

vi.mock("./financialIntegrity", () => ({
  isCollectiblePayment: (p: { settlementStatus?: string | null }) =>
    p.settlementStatus !== "void" && p.settlementStatus !== "failed",
}));

import { loadPostClosureActivity } from "./postClosureActivity";

describe("loadPostClosureActivity", () => {
  beforeEach(() => {
    selectResults.length = 0;
  });

  test("returns empty when user has never closed", async () => {
    selectResults.push([]);
    const result = await loadPostClosureActivity("Alice");
    expect(result.closedAt).toBeNull();
    expect(result.bills).toHaveLength(0);
  });

  test("returns empty when latest row is open (first-time drawer)", async () => {
    selectResults.push([{ id: 1, closedAt: new Date("2026-08-21T10:00:00Z"), drawerStatus: "open" }]);
    const result = await loadPostClosureActivity("Alice");
    expect(result.closedAt).toBeNull();
    expect(result.bills).toHaveLength(0);
  });

  test("includes post-close bills when drawer was reopened (regression)", async () => {
    const closedAt = new Date("2026-08-21T18:00:00Z");
    selectResults.push([
      { id: 5, closedAt, drawerStatus: "reopened" },
    ]);
    selectResults.push([
      {
        id: 101,
        billNumber: "B-101",
        totalAmount: "500",
        paidAmount: "500",
        status: "paid",
        createdAt: new Date("2026-08-21T19:00:00Z"),
      },
    ]);
    selectResults.push([
      {
        id: 201,
        billId: 101,
        amount: "500",
        method: "cash",
        createdAt: new Date("2026-08-21T19:00:00Z"),
        settlementStatus: "settled",
      },
    ]);

    const result = await loadPostClosureActivity("Alice");
    expect(result.closedAt).toEqual(closedAt);
    expect(result.drawerStatus).toBe("reopened");
    expect(result.bills).toHaveLength(1);
    expect(result.billTotal).toBe(500);
    expect(result.paymentTotal).toBe(500);
  });

  test("detects post-close activity after balanced close", async () => {
    const closedAt = new Date("2026-08-21T18:00:00Z");
    selectResults.push([
      { id: 3, closedAt, drawerStatus: "balanced" },
    ]);
    selectResults.push([
      {
        id: 102,
        billNumber: "B-102",
        totalAmount: "1200",
        paidAmount: "1200",
        status: "paid",
        createdAt: new Date("2026-08-21T20:00:00Z"),
      },
    ]);
    selectResults.push([]);

    const result = await loadPostClosureActivity("Bob");
    expect(result.closureId).toBe(3);
    expect(result.bills).toHaveLength(1);
    expect(result.billTotal).toBe(1200);
    expect(result.paymentTotal).toBe(0);
  });
});
