import { describe, expect, it, vi } from "vitest";

// daily-summary.ts imports db at module top — mock before import.
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }), execute: async () => ({ rows: [] }) },
}));
vi.mock("@workspace/db/schema", () => ({
  billsTable: {}, paymentsTable: {}, ordersTable: {}, billAuditsTable: {}, voucherAuditsTable: {},
  orderTestsTable: {}, testsTable: {}, patientsTable: {},
}));

import { computeDailySummaryCashMath } from "./daily-summary";
import { isDigitalSettlement, isPhysicalCash } from "../lib/paymentMethodClassifier";

/**
 * Owner Dashboard (advanced-dashboard) must use the same payment-axis
 * cash math and method classifier as Daily Summary — not naive SQL
 * LOWER(method)='cash' / IN ('online',...).
 */
describe("advanced-dashboard cash alignment", () => {
  it("net cash handled subtracts cash refunds and cash expenses", () => {
    const cashIn = 10_000;
    const cashRefunded = 1_500;
    const cashExpenses = 500;
    const netCashHandled = cashIn - cashRefunded - cashExpenses;
    expect(netCashHandled).toBe(8_000);

    const { physicalCashInHand } = computeDailySummaryCashMath({
      totalReceived: 20_000,
      totalRefunded: 1_500,
      expenses: 500,
      cashCollection: cashIn,
      cashRefunded,
      cashExpenses,
    });
    expect(physicalCashInHand).toBe(netCashHandled);
  });

  it("classifies gateway Online (…) as digital, not cash", () => {
    expect(isPhysicalCash("Online (ICICI Orange Pay)")).toBe(false);
    expect(isDigitalSettlement("Online (ICICI Orange Pay)")).toBe(true);
    expect(isDigitalSettlement("Online (HDFC SmartGateway)")).toBe(true);
    expect(isPhysicalCash("cash")).toBe(true);
    expect(isDigitalSettlement("insurance")).toBe(true);
  });
});
