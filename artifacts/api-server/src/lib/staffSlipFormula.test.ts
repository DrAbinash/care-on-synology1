import { describe, expect, test } from "vitest";
import { computeStaffSlipFormula } from "./staffSlipFormula";

describe("computeStaffSlipFormula", () => {
  test("Suraj handwritten A5: billed + dues − refunds − outstanding = expected; UPI+CASH match", () => {
    const f = computeStaffSlipFormula({
      billed: 247_775,
      duesCollected: 29_700,
      cancelledBills: 0,
      refundsRecorded: 550,
      refundsOnBillsICancelled: 0,
      outstanding: 4_700,
      expense: 0,
    });
    expect(f.subtotal).toBe(277_475);
    expect(f.expected).toBe(272_225);
    expect(99_075 + 173_150).toBe(f.expected);
    expect(f.refunds).toBe(550);
  });

  test("Abinash cancelled Vijay's ₹3400 bill and paid the refund — canceller owns it", () => {
    const abinash = computeStaffSlipFormula({
      billed: 0,
      duesCollected: 0,
      cancelledBills: 3_400,
      refundsRecorded: 3_400,
      refundsOnBillsICancelled: 3_400,
      outstanding: 0,
      expense: 0,
    });
    expect(abinash.refunds).toBe(0);
    expect(abinash.expected).toBe(-3_400);

    const vijay = computeStaffSlipFormula({
      billed: 3_400,
      duesCollected: 0,
      cancelledBills: 0,
      refundsRecorded: 0,
      refundsOnBillsICancelled: 0,
      outstanding: 0,
      expense: 0,
    });
    expect(vijay.expected).toBe(3_400);
  });

  test("old bill cancelled today by Vijay hits Vijay's expected, not the original creator", () => {
    const vijay = computeStaffSlipFormula({
      billed: 0,
      duesCollected: 0,
      cancelledBills: 3_400,
      refundsRecorded: 3_400,
      refundsOnBillsICancelled: 3_400,
      outstanding: 0,
      expense: 0,
    });
    expect(vijay.expected).toBe(-3_400);
  });
});
