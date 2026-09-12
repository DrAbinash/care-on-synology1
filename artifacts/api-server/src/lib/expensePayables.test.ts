import { describe, expect, it } from "vitest";
import {
  assertPaymentAllowed,
  balanceDue,
  derivePaymentStatus,
  isCashPaymentMode,
  summarizeExpenseMoney,
} from "./expensePayables";

describe("expensePayables domain", () => {
  it("derives PAID / PART_PAID / DUE", () => {
    expect(derivePaymentStatus({ billAmount: 50000, totalPaid: 0 })).toBe("DUE");
    expect(derivePaymentStatus({ billAmount: 50000, totalPaid: 20000 })).toBe("PART_PAID");
    expect(derivePaymentStatus({ billAmount: 50000, totalPaid: 50000 })).toBe("PAID");
    expect(derivePaymentStatus({ billAmount: 50000, totalPaid: 50000, isVoid: true })).toBe("VOID");
  });

  it("computes balance due", () => {
    expect(balanceDue(50000, 20000)).toBe(30000);
    expect(balanceDue(50000, 50000)).toBe(0);
  });

  it("rejects overpayment", () => {
    const r = assertPaymentAllowed({ billAmount: 50000, alreadyPaid: 40000, newPayment: 15000 });
    expect(r.ok).toBe(false);
  });

  it("accepts settling payment", () => {
    const r = assertPaymentAllowed({ billAmount: 50000, alreadyPaid: 30000, newPayment: 20000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nextPaid).toBe(50000);
      expect(r.nextDue).toBe(0);
      expect(r.nextStatus).toBe("PAID");
    }
  });

  it("summarizes lifecycle 50k / 20k / 10k / 20k", () => {
    let s = summarizeExpenseMoney({ billAmount: 50000, totalPaid: 20000 });
    expect(s).toEqual({
      billAmount: 50000,
      totalPaid: 20000,
      balanceDue: 30000,
      paymentStatus: "PART_PAID",
    });
    s = summarizeExpenseMoney({ billAmount: 50000, totalPaid: 30000 });
    expect(s.balanceDue).toBe(20000);
    s = summarizeExpenseMoney({ billAmount: 50000, totalPaid: 50000 });
    expect(s.paymentStatus).toBe("PAID");
  });

  it("cash mode detection matches day-close rule", () => {
    expect(isCashPaymentMode("cash")).toBe(true);
    expect(isCashPaymentMode("")).toBe(true);
    expect(isCashPaymentMode("upi")).toBe(false);
    expect(isCashPaymentMode("bank-transfer")).toBe(false);
  });
});
