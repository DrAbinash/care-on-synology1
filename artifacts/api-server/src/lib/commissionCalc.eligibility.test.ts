import { describe, expect, test } from "vitest";
import { computeCommissionHold } from "./commissionCalc";
import { billBalanceFromParts, moneyAdd, moneyMax0, moneySub } from "./money";

/**
 * P0-3 — full_payment_collected must use net retained collection (paidAmount),
 * not patient balanceAmount. Refunds decrement paidAmount and increment
 * refundAmount; billBalanceFromParts(total, paid, refund) can stay 0 after a
 * refund even when net collection is below the bill total.
 *
 * Traced refund semantics (POST /bills/:id/refund):
 *   newPaid   = max(0, paid − refundAmt)     // paidAmount is NET
 *   newRefund = refund + refundAmt
 *   balance   = max(0, total − newPaid − newRefund)
 */

function afterRefund(
  total: number,
  paid: number,
  refundSoFar: number,
  refundAmt: number,
) {
  const newPaid = moneyMax0(moneySub(paid, refundAmt));
  const newRefund = moneyAdd(refundSoFar, refundAmt);
  const balance = billBalanceFromParts(total, newPaid, newRefund);
  return { paid: newPaid, refund: newRefund, balance };
}

const base = {
  cfg: { policy: "full_payment_collected", minAmount: 0 },
  hasBill: true,
  billStatus: "paid" as string | null,
  reportFinalized: false,
  reportDelivered: false,
  commissionAmount: 100,
};

describe("P0-3 commission eligibility — full_payment_collected refund arithmetic", () => {
  test("CASE A: ₹1000 total / ₹1000 paid / no refund → qualifies", () => {
    const total = 1000;
    const paid = 1000;
    const refund = 0;
    const balance = billBalanceFromParts(total, paid, refund);
    expect({ total, paid, refund, balance }).toEqual({
      total: 1000,
      paid: 1000,
      refund: 0,
      balance: 0,
    });

    const hold = computeCommissionHold({
      ...base,
      paidAmount: paid,
      balanceAmount: balance,
      totalAmount: total,
    });
    expect(hold).toEqual({ held: false, reason: null });
  });

  test("CASE A2: partial collection → does not qualify", () => {
    const total = 1000;
    const paid = 400;
    const balance = billBalanceFromParts(total, paid, 0);
    expect(balance).toBe(600);

    const hold = computeCommissionHold({
      ...base,
      billStatus: "partial",
      paidAmount: paid,
      balanceAmount: balance,
      totalAmount: total,
    });
    expect(hold.held).toBe(true);
  });

  test("CASE B: fully paid then ₹200 refund → not eligible (balance still 0)", () => {
    // Prove the dangerous balance-only trap, then the fixed rule.
    const r = afterRefund(1000, 1000, 0, 200);
    expect(r).toEqual({ paid: 800, refund: 200, balance: 0 });

    // Old (buggy) balance-only rule would have released commission here.
    expect(r.balance <= 0.005).toBe(true);

    const hold = computeCommissionHold({
      ...base,
      billStatus: "partial",
      paidAmount: r.paid,
      balanceAmount: r.balance,
      totalAmount: 1000,
    });
    expect(hold.held).toBe(true);
    expect(hold.reason).toMatch(/Collected/i);
  });

  test("CASE C: fully paid then full ₹1000 refund → not eligible merely because balance is 0", () => {
    const r = afterRefund(1000, 1000, 0, 1000);
    expect(r).toEqual({ paid: 0, refund: 1000, balance: 0 });

    const hold = computeCommissionHold({
      ...base,
      billStatus: "pending",
      paidAmount: r.paid,
      balanceAmount: r.balance,
      totalAmount: 1000,
    });
    expect(hold.held).toBe(true);
  });

  test("CASE D: multiple refunds — no double subtraction of refundAmount", () => {
    // First refund ₹300, then ₹200. paidAmount is already net — eligibility
    // must NOT subtract refundAmount again.
    const step1 = afterRefund(1000, 1000, 0, 300);
    expect(step1).toEqual({ paid: 700, refund: 300, balance: 0 });
    const step2 = afterRefund(1000, step1.paid, step1.refund, 200);
    expect(step2).toEqual({ paid: 500, refund: 500, balance: 0 });

    // Correct net collection for eligibility is paidAmount alone (= 500).
    const hold = computeCommissionHold({
      ...base,
      billStatus: "partial",
      paidAmount: step2.paid,
      balanceAmount: step2.balance,
      totalAmount: 1000,
    });
    expect(hold.held).toBe(true);
    expect(step2.paid).toBe(500); // not 0 from double-subtract
  });

  test("cancelled bill stays held regardless of balance/paid", () => {
    const hold = computeCommissionHold({
      ...base,
      billStatus: "cancelled",
      paidAmount: 1000,
      balanceAmount: 0,
      totalAmount: 1000,
    });
    expect(hold).toEqual({ held: true, reason: "Bill cancelled" });
  });

  test("idempotent: same inputs always yield the same hold decision", () => {
    const args = {
      ...base,
      paidAmount: 1000,
      balanceAmount: 0,
      totalAmount: 1000,
    };
    expect(computeCommissionHold(args)).toEqual(computeCommissionHold(args));
    expect(computeCommissionHold(args).held).toBe(false);
  });
});

describe("other collection policies retain paidAmount (net) semantics", () => {
  test("min_amount_collected uses net paidAmount after refund", () => {
    const r = afterRefund(1000, 1000, 0, 600); // net paid 400
    const hold = computeCommissionHold({
      cfg: { policy: "min_amount_collected", minAmount: 500 },
      hasBill: true,
      billStatus: "partial",
      paidAmount: r.paid,
      balanceAmount: r.balance,
      totalAmount: 1000,
      reportFinalized: false,
      reportDelivered: false,
      commissionAmount: 100,
    });
    expect(hold.held).toBe(true);
  });

  test("collected_ge_commission uses net paidAmount after refund", () => {
    const r = afterRefund(1000, 1000, 0, 950); // net paid 50
    const hold = computeCommissionHold({
      cfg: { policy: "collected_ge_commission", minAmount: 0 },
      hasBill: true,
      billStatus: "partial",
      paidAmount: r.paid,
      balanceAmount: r.balance,
      totalAmount: 1000,
      reportFinalized: false,
      reportDelivered: false,
      commissionAmount: 100,
    });
    expect(hold.held).toBe(true);
  });

  test("bill_created ignores collection amounts", () => {
    const hold = computeCommissionHold({
      cfg: { policy: "bill_created", minAmount: 0 },
      hasBill: true,
      billStatus: "pending",
      paidAmount: 0,
      balanceAmount: 1000,
      totalAmount: 1000,
      reportFinalized: false,
      reportDelivered: false,
      commissionAmount: 100,
    });
    expect(hold.held).toBe(false);
  });

  test("report_finalized / report_delivered ignore refund arithmetic", () => {
    const r = afterRefund(1000, 1000, 0, 1000);
    expect(
      computeCommissionHold({
        cfg: { policy: "report_finalized", minAmount: 0 },
        hasBill: true,
        billStatus: "pending",
        paidAmount: r.paid,
        balanceAmount: r.balance,
        totalAmount: 1000,
        reportFinalized: true,
        reportDelivered: false,
        commissionAmount: 100,
      }).held,
    ).toBe(false);
    expect(
      computeCommissionHold({
        cfg: { policy: "report_delivered", minAmount: 0 },
        hasBill: true,
        billStatus: "pending",
        paidAmount: r.paid,
        balanceAmount: r.balance,
        totalAmount: 1000,
        reportFinalized: true,
        reportDelivered: false,
        commissionAmount: 100,
      }).held,
    ).toBe(true);
  });
});
