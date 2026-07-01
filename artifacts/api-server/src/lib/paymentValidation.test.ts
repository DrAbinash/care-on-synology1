import { describe, expect, test } from "vitest";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  CreatePaymentBody,
  RefundBillBody,
} from "@workspace/api-zod";

// Approved Fix #9 (Negative Payment Guard): every entry point that accepts a
// money amount must reject zero/negative values before it reaches the
// database — a negative expense would inflate expected cash (see
// day-close.test.ts), a negative payment would deflate paidAmount
// incorrectly, and a negative/zero refund makes no business sense.

describe("CreateExpenseBody — rejects invalid amounts (regression: was previously unconstrained)", () => {
  test("rejects a negative expense amount", () => {
    const result = CreateExpenseBody.safeParse({
      category: "Office", description: "Supplies", amount: -100, expenseDate: "2026-07-01",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a zero expense amount", () => {
    const result = CreateExpenseBody.safeParse({
      category: "Office", description: "Supplies", amount: 0, expenseDate: "2026-07-01",
    });
    expect(result.success).toBe(false);
  });

  test("accepts a positive expense amount", () => {
    const result = CreateExpenseBody.safeParse({
      category: "Office", description: "Supplies", amount: 500, expenseDate: "2026-07-01",
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateExpenseBody — rejects invalid amounts when provided (regression)", () => {
  test("rejects a negative amount on update", () => {
    const result = UpdateExpenseBody.safeParse({ amount: -50 });
    expect(result.success).toBe(false);
  });

  test("rejects a zero amount on update", () => {
    const result = UpdateExpenseBody.safeParse({ amount: 0 });
    expect(result.success).toBe(false);
  });

  test("allows omitting amount entirely (partial update)", () => {
    const result = UpdateExpenseBody.safeParse({ category: "Travel" });
    expect(result.success).toBe(true);
  });

  test("accepts a positive amount on update", () => {
    const result = UpdateExpenseBody.safeParse({ amount: 250 });
    expect(result.success).toBe(true);
  });
});

describe("CreatePaymentBody — already rejects invalid amounts (verification, no change needed)", () => {
  test("rejects a negative payment amount", () => {
    const result = CreatePaymentBody.safeParse({ billId: 1, amount: -1, method: "cash" });
    expect(result.success).toBe(false);
  });

  test("rejects a zero payment amount", () => {
    const result = CreatePaymentBody.safeParse({ billId: 1, amount: 0, method: "cash" });
    expect(result.success).toBe(false);
  });

  test("accepts a positive payment amount", () => {
    const result = CreatePaymentBody.safeParse({ billId: 1, amount: 500, method: "cash" });
    expect(result.success).toBe(true);
  });
});

describe("RefundBillBody — already rejects invalid amounts (verification, no change needed)", () => {
  test("rejects a negative refund amount", () => {
    const result = RefundBillBody.safeParse({ performedBy: "Alice", reason: "test reason", amount: -1 });
    expect(result.success).toBe(false);
  });

  test("rejects a zero refund amount", () => {
    const result = RefundBillBody.safeParse({ performedBy: "Alice", reason: "test reason", amount: 0 });
    expect(result.success).toBe(false);
  });

  test("accepts a positive refund amount", () => {
    const result = RefundBillBody.safeParse({ performedBy: "Alice", reason: "test reason", amount: 100 });
    expect(result.success).toBe(true);
  });
});
