import { describe, expect, test, vi, beforeEach } from "vitest";

const selectResults: unknown[][] = [];

// The builder chain a drizzle select goes through. `leftJoin` is part of it
// because the payments query joins bills → patients → orders → doctors to name
// the bill and the patient instead of printing a row id.
function chainable() {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "leftJoin", "innerJoin", "where", "orderBy", "groupBy"]) {
    chain[step] = () => chain;
  }
  chain.limit = async () => selectResults.shift() ?? [];
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: { select: () => chainable() },
  billsTable: {},
  paymentsTable: {},
  userDayClosuresTable: {},
}));

vi.mock("@workspace/db/schema", () => ({
  billsTable: {},
  paymentsTable: {},
  userDayClosuresTable: {},
  ordersTable: {},
  doctorsTable: {},
  patientsTable: {},
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
        billNumber: "B-101",
        amount: "500",
        method: "cash",
        createdAt: new Date("2026-08-21T19:00:00Z"),
        settlementStatus: "settled",
        patientFirstName: "Vijay",
        patientLastName: "Kumar",
        referringDoctor: "Dr Rao",
      },
    ]);

    const result = await loadPostClosureActivity("Alice");
    expect(result.closedAt).toEqual(closedAt);
    expect(result.drawerStatus).toBe("reopened");
    expect(result.bills).toHaveLength(1);
    expect(result.billTotal).toBe(500);
    expect(result.paymentTotal).toBe(500);
    // The alert used to render `Bill #${billId}`. The row id is not a bill number,
    // and a card that names neither the patient nor the referral forces a click.
    expect(result.payments[0]).toMatchObject({
      billNumber: "B-101",
      patientName: "Vijay Kumar",
      referringDoctor: "Dr Rao",
    });
  });

  test("a payment whose bill row is gone keeps its amount and says so", async () => {
    selectResults.push([{ id: 7, closedAt: new Date("2026-08-21T14:00:00Z"), drawerStatus: "balanced" }]);
    selectResults.push([]);
    selectResults.push([
      {
        id: 301,
        billId: 999,
        billNumber: null,
        amount: "700",
        method: "cash",
        createdAt: new Date("2026-08-22T09:00:00Z"),
        settlementStatus: "settled",
        patientFirstName: null,
        patientLastName: null,
        referringDoctor: null,
      },
    ]);

    const result = await loadPostClosureActivity("Carol");
    expect(result.paymentTotal).toBe(700);
    expect(result.payments[0].billNumber).toBeNull();
    expect(result.payments[0].patientName).toBeNull();
  });

  test("detects post-close activity after balanced close", async () => {
    // 14:00 UTC = 19:30 IST on 2026-08-21; bill at 16:00 UTC = 21:30 IST same day
    const closedAt = new Date("2026-08-21T14:00:00Z");
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
        createdAt: new Date("2026-08-21T16:00:00Z"),
      },
    ]);
    selectResults.push([]);

    const result = await loadPostClosureActivity("Bob");
    expect(result.closureId).toBe(3);
    expect(result.bills).toHaveLength(1);
    expect(result.billTotal).toBe(1200);
    expect(result.paymentTotal).toBe(0);
    expect(result.bills[0].sameDayAfterClose).toBe(true);
    expect(result.sameDayBillCount).toBe(1);
    expect(result.sameDayBillTotal).toBe(1200);
  });
});
