import { describe, expect, test, vi, beforeEach } from "vitest";

const peak = vi.fn(() => true);
let selectCalls = 0;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      selectCalls++;
      return { from: () => ({ where: () => ({ limit: async () => [] }) }) };
    },
  },
}));
vi.mock("@workspace/db/schema", () => ({
  accountsTable: {},
  vouchersTable: { id: "id", paymentId: "payment_id", billId: "bill_id" },
}));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("./paymentMethodClassifier", () => ({ classifyPaymentMethod: () => "cash" }));
vi.mock("./clinicPeakHours", () => ({ isClinicPeakHours: () => peak() }));

import { autoVoucherForPayment } from "./auto-voucher";

beforeEach(() => {
  selectCalls = 0;
  peak.mockReturnValue(true);
});

describe("autoVoucherForPayment — peak deferral", () => {
  test("skips DB work during peak hours unless force=true", async () => {
    await autoVoucherForPayment({
      billId: 1,
      amount: 100,
      method: "cash",
      billNumber: "2026080001",
      paymentId: 9,
    });
    expect(selectCalls).toBe(0);

    peak.mockReturnValue(true);
    await autoVoucherForPayment({
      billId: 1,
      amount: 100,
      method: "cash",
      billNumber: "2026080001",
      paymentId: 9,
      force: true,
    });
    // force bypasses peak — hits the payment_id idempotency SELECT
    expect(selectCalls).toBeGreaterThan(0);
  });
});
