import { describe, expect, test } from "vitest";
import { computeDueReceivedForWindow, computeStaffSlipFormula } from "./staffSlipFormula";

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

  test("partial test cancel ₹1500: restore Vijay billed; Abinash owns cancel+refund", () => {
    // Bill total mutated 10000→8500; restore +1500 on Vijay's slip.
    const vijay = computeStaffSlipFormula({
      billed: 8_500 + 1_500,
      duesCollected: 0,
      cancelledBills: 0,
      refundsRecorded: 0,
      refundsOnBillsICancelled: 0,
      outstanding: 0,
      expense: 0,
    });
    expect(vijay.expected).toBe(10_000);

    const abinash = computeStaffSlipFormula({
      billed: 0,
      duesCollected: 0,
      cancelledBills: 1_500,
      refundsRecorded: 1_500,
      refundsOnBillsICancelled: 1_500,
      outstanding: 0,
      expense: 0,
    });
    expect(abinash.refunds).toBe(0);
    expect(abinash.expected).toBe(-1_500);
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

describe("computeDueReceivedForWindow", () => {
  test("Suraj #170: PINKI ₹3000 collected 11:16am before close counts as dues", () => {
    // Payment is inside the drawer window (UPI+CASH already includes it).
    // Bill #20260918133 is not in Suraj's window Bill Gen — My Daily Summary
    // correctly shows Dues Collected ₹3000; the slip used createdAt≤from and
    // printed Dues 0 / Expected 132900 while UPI+CASH = 135900.
    const surajWindowBillIds = [101, 102, 103];
    const payments = [
      { billId: 101, amount: 1_500 }, // own window bill — not dues
      { billId: 999, amount: 3_000 }, // PINKI — bill outside Suraj Bill Gen
      { billId: 102, amount: 2_000 },
    ];
    const dues = computeDueReceivedForWindow({
      windowBillIds: surajWindowBillIds,
      payments,
    });
    expect(dues).toBe(3_000);

    const f = computeStaffSlipFormula({
      billed: 132_900,
      duesCollected: dues,
      cancelledBills: 0,
      refundsRecorded: 0,
      refundsOnBillsICancelled: 0,
      outstanding: 0,
      expense: 0,
    });
    expect(f.expected).toBe(135_900);
    expect(57_500 + 78_400).toBe(f.expected);
  });

  test("classic prior-day dues still count (bill not in window set)", () => {
    expect(
      computeDueReceivedForWindow({
        windowBillIds: [10, 11],
        payments: [
          { billId: 10, amount: 500 },
          { billId: 55, amount: 5_500 }, // Sanjeev-style prior bill
        ],
      }),
    ).toBe(5_500);
  });

  test("payments on own window bills are not dues (already in Bill Gen)", () => {
    expect(
      computeDueReceivedForWindow({
        windowBillIds: [1, 2],
        payments: [
          { billId: 1, amount: 1_000 },
          { billId: 2, amount: 2_000 },
        ],
      }),
    ).toBe(0);
  });

  test("ignores refunds, null billId, and non-finite amounts", () => {
    expect(
      computeDueReceivedForWindow({
        windowBillIds: [1],
        payments: [
          { billId: 9, amount: -500 },
          { billId: null, amount: 300 },
          { billId: 9, amount: "2000" },
          { billId: 9, amount: "nope" },
        ],
      }),
    ).toBe(2_000);
  });

  test("first-ever close (empty Bill Gen set): all positive bill-linked payments are dues", () => {
    // from=null loads all of this staff's historical bills into Bill Gen; when
    // that set is empty (new cashier), others' bill payments must still land
    // in dues so Expected matches UPI+CASH.
    expect(
      computeDueReceivedForWindow({
        windowBillIds: [],
        payments: [{ billId: 42, amount: 1_200 }],
      }),
    ).toBe(1_200);
  });
});
