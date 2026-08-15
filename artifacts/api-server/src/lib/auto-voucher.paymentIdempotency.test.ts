import { describe, expect, test, vi, beforeEach } from "vitest";

// F2 — autoVoucherForPayment idempotency by payment_id.
// When paymentId is supplied and a voucher already links that payment, the
// function is a no-op (a real-time voucher + a later sync can never double it).

let existingVoucherForPayment: Array<{ id: number }>;
let inserted: Array<Record<string, unknown>>;

vi.mock("@workspace/db", () => {
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => existingVoucherForPayment }),
      }),
    }),
    insert: () => ({ values: (v: Record<string, unknown>) => { inserted.push(v); return Promise.resolve([]); } }),
  };
  return { db };
});
vi.mock("@workspace/db/schema", () => ({
  accountsTable: { __name: "accounts" },
  vouchersTable: { __name: "vouchers", id: "id", paymentId: "payment_id", billId: "bill_id" },
}));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("./paymentMethodClassifier", () => ({ classifyPaymentMethod: () => "cash" }));
vi.mock("./clinicPeakHours", () => ({ isClinicPeakHours: () => false }));

import { autoVoucherForPayment } from "./auto-voucher";

beforeEach(() => {
  existingVoucherForPayment = [];
  inserted = [];
});

describe("autoVoucherForPayment — payment idempotency", () => {
  test("no-op when a voucher already links this payment_id", async () => {
    existingVoucherForPayment = [{ id: 1 }];
    await autoVoucherForPayment({ billId: 10, amount: 500, method: "cash", billNumber: "0042", paymentId: 77 });
    expect(inserted).toHaveLength(0);
  });

  test("zero-amount payment is a no-op regardless", async () => {
    await autoVoucherForPayment({ billId: 10, amount: 0, method: "cash", billNumber: "0042", paymentId: 78 });
    expect(inserted).toHaveLength(0);
  });
});
